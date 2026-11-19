import os, uuid
os.environ["DATABASE_URL"] = "sqlite:///./test.db"
import pytest
from fastapi.testclient import TestClient
from app.main import app, init_db, Base, engine

@pytest.fixture(autouse=True)
def client():
    Base.metadata.drop_all(engine); init_db()
    with TestClient(app) as c: yield c

def tok(c, u, p): return c.post("/api/auth/login", json={"username": u, "password": p}).json()["access_token"]
def hdr(c, u, p): return {"Authorization": "Bearer " + tok(c, u, p)}
def ev(t="COPY_ATTEMPT", **k):
    d = dict(event_id=uuid.uuid4().hex, event_type=t, event_category="CLIPBOARD", severity="MEDIUM",
             detection_source="clipboard", confidence="CONFIRMED", event_description="x"); d.update(k); return d
C = ("candidate1", "candidate123"); C2 = ("candidate2", "candidate123"); P = ("proctor1", "proctor123")

def test_login_bad(client): assert client.post("/api/auth/login", json={"username": "candidate1", "password": "no"}).status_code == 401
def test_protected(client): assert client.get("/api/dashboard/summary").status_code == 401
def test_candidate_forbidden(client): assert client.get("/api/dashboard/summary", headers=hdr(client, *C)).status_code == 403
def test_persist_and_dedupe(client):
    h = hdr(client, *C); e = ev()
    assert client.post("/api/events", json=e, headers=h).json()["status"] == "stored"
    assert client.post("/api/events", json=e, headers=h).json()["status"] == "duplicate"
    assert client.get("/api/events", headers=hdr(client, *P)).json()["total"] == 1
def test_candidate_logs_and_summary(client):
    client.post("/api/events", json=ev(), headers=hdr(client, *C)); client.post("/api/events", json=ev("RIGHT_CLICK"), headers=hdr(client, *C2))
    p = hdr(client, *P)
    assert len(client.get("/api/candidates/candidate1/events", headers=p).json()) == 1
    assert client.get("/api/dashboard/summary", headers=p).json()["total_events"] == 2
def test_validation(client): assert client.post("/api/events", json=ev(severity="BAD"), headers=hdr(client, *C)).status_code == 422
def test_csv(client):
    client.post("/api/events", json=ev(), headers=hdr(client, *C))
    assert "COPY_ATTEMPT" in client.get("/api/export/events.csv", headers=hdr(client, *P)).text
def test_ws_notification(client):
    with client.websocket_connect(f"/ws/proctor?token={tok(client, *P)}") as ws:
        client.post("/api/events", json=ev(), headers=hdr(client, *C))
        assert ws.receive_json()["event"]["event_type"] == "COPY_ATTEMPT"
def test_ws_rejects_candidate(client):
    with pytest.raises(Exception):
        with client.websocket_connect(f"/ws/proctor?token={tok(client, *C)}"): pass

def test_candidate_extensions(client):
    c_hdr = hdr(client, *C)
    p_hdr = hdr(client, *P)
    # Post extension event
    ext_data = [
        {"id": "chatgpt", "name": "ChatGPT Assistant", "category": "AI_ASSISTANT", "risk": "HIGH", "detectionMethod": "DOM_PROBE", "details": "Found sidebar"}
    ]
    ext_event = ev(t="BROWSER_EXTENSIONS_DETECTED", severity="HIGH", metadata={"extensions": ext_data, "count": 1, "has_high_risk": True})
    client.post("/api/events", json=ext_event, headers=c_hdr)
    
    # Query extension API
    res = client.get("/api/candidates/candidate1/extensions", headers=p_hdr)
    assert res.status_code == 200
    data = res.json()
    assert data["count"] == 1
    assert data["has_high_risk"] is True
    assert data["extensions"][0]["id"] == "chatgpt"

    # Query candidate list
    cands_res = client.get("/api/dashboard/candidates", headers=p_hdr)
    assert cands_res.status_code == 200
    c1 = next(x for x in cands_res.json() if x["candidate_id"] == "candidate1")
    assert c1["extensions_count"] == 1
    assert c1["has_high_risk_extensions"] is True

def test_delete_session_and_candidate_sessions(client):
    c_hdr = hdr(client, *C)
    p_hdr = hdr(client, *P)
    # Start session
    s_res = client.post("/api/sessions/start", json={"exam_id": "EXAM-001"}, headers=c_hdr)
    assert s_res.status_code == 200
    sid = s_res.json()["session_id"]
    
    # Check session exists
    sessions = client.get("/api/candidates/candidate1/sessions", headers=p_hdr).json()
    assert any(s["session_id"] == sid for s in sessions)
    
    # Delete single session
    del_res = client.delete(f"/api/sessions/{sid}", headers=p_hdr)
    assert del_res.status_code == 200
    assert del_res.json()["ok"] is True
    
    # Check session is removed
    sessions_after = client.get("/api/candidates/candidate1/sessions", headers=p_hdr).json()
    assert not any(s["session_id"] == sid for s in sessions_after)
    
    # Start another session and test delete all sessions for candidate
    s_res2 = client.post("/api/sessions/start", json={"exam_id": "EXAM-001"}, headers=c_hdr)
    assert s_res2.status_code == 200
    
    del_all = client.delete("/api/candidates/candidate1/sessions", headers=p_hdr)
    assert del_all.status_code == 200
    assert del_all.json()["ok"] is True
    
    sessions_final = client.get("/api/candidates/candidate1/sessions", headers=p_hdr).json()
    assert len(sessions_final) == 0

def test_exams_crud(client):
    c_hdr = hdr(client, *C)
    p_hdr = hdr(client, *P)
    
    # 1. Check default seeded EXAM-001
    exams = client.get("/api/exams").json()
    assert len(exams) >= 1
    e001 = next(x for x in exams if x["exam_id"] == "EXAM-001")
    assert e001["title"] == "Data Structures & Algorithms Assessment"
    assert e001["question_count"] == 20
    assert len(e001["questions"]) == 20
    
    # 2. Get single exam
    single = client.get("/api/exams/EXAM-001").json()
    assert single["exam_id"] == "EXAM-001"
    assert single["questions"][0]["type"] == "text"
    assert single["questions"][1]["type"] == "mcq"
    
    # 3. Candidate cannot create an exam (proctor only)
    new_exam_data = {
        "exam_id": "EXAM-PYTHON-101",
        "title": "Python & Backend Systems Assessment",
        "description": "Custom HackerRank-style test for Backend Engineers",
        "duration_minutes": 45,
        "settings": {"fullscreenLock": True, "netflixShield": True},
        "questions": [
            {"id": 1, "title": "Explain Python GIL.", "type": "text"},
            {"id": 2, "title": "What is FastAPI built on?", "type": "mcq", "options": ["Starlette", "Django", "Flask", "Tornado"]}
        ]
    }
    cand_create = client.post("/api/exams", json=new_exam_data, headers=c_hdr)
    assert cand_create.status_code == 403
    
    # 4. Proctor creates exam
    proctor_create = client.post("/api/exams", json=new_exam_data, headers=p_hdr)
    assert proctor_create.status_code == 200
    created = proctor_create.json()
    assert created["exam_id"] == "EXAM-PYTHON-101"
    assert created["question_count"] == 2
    assert created["duration_minutes"] == 45
    
    # 5. Fetch all exams and single created exam
    all_exams = client.get("/api/exams").json()
    assert any(x["exam_id"] == "EXAM-PYTHON-101" for x in all_exams)
    
    fetched = client.get("/api/exams/EXAM-PYTHON-101").json()
    assert fetched["title"] == "Python & Backend Systems Assessment"
    assert len(fetched["questions"]) == 2
    
    # 6. Delete created exam
    del_res = client.delete("/api/exams/EXAM-PYTHON-101", headers=p_hdr)
    assert del_res.status_code == 200
    assert del_res.json()["status"] == "deleted"
    
    # Verify 404 after delete
    assert client.get("/api/exams/EXAM-PYTHON-101").status_code == 404

def test_ai_proctor_audit(client):
    c_hdr = hdr(client, *C)
    p_hdr = hdr(client, *P)
    
    # Start candidate session
    s_res = client.post("/api/sessions/start", json={"exam_id": "EXAM-001"}, headers=c_hdr)
    assert s_res.status_code == 200
    sid = s_res.json()["session_id"]
    
    # 1. Clean session audit
    clean_audit = client.post(f"/api/proctor/ai-audit/{sid}", headers=p_hdr)
    assert clean_audit.status_code == 200
    clean_data = clean_audit.json()
    assert clean_data["verdict"] == "CLEAN"
    assert clean_data["risk_score"] < 25
    assert len(clean_data["anomalies"]) == 0
    
    # Candidate cannot run audit (proctor only)
    assert client.post(f"/api/proctor/ai-audit/{sid}", headers=c_hdr).status_code == 403
    
    # 2. Inject suspicious telemetry: Screenshot, Focus loss, Paste, and AI Extension
    client.post("/api/events", json=ev(t="SCREENSHOT_ATTEMPT", session_id=sid, severity="HIGH"), headers=c_hdr)
    client.post("/api/events", json=ev(t="WINDOW_FOCUS_LOST", session_id=sid, severity="MEDIUM", duration=55.0), headers=c_hdr)
    client.post("/api/events", json=ev(t="PASTE_ATTEMPT", session_id=sid, severity="HIGH"), headers=c_hdr)
    
    ext_data = [{"id": "chatgpt", "name": "ChatGPT Assistant", "risk": "HIGH"}]
    client.post("/api/events", json=ev(t="BROWSER_EXTENSIONS_DETECTED", session_id=sid, severity="HIGH", metadata={"extensions": ext_data, "count": 1, "has_high_risk": True}), headers=c_hdr)
    
    # 3. Re-run AI audit
    flagged_audit = client.post(f"/api/proctor/ai-audit/{sid}", headers=p_hdr)
    assert flagged_audit.status_code == 200
    flagged_data = flagged_audit.json()
    assert flagged_data["verdict"] == "HIGH_RISK"
    assert flagged_data["risk_score"] >= 60
    assert len(flagged_data["anomalies"]) >= 3
    pattern_names = [a["pattern"] for a in flagged_data["anomalies"]]
    assert any("Screenshot" in p for p in pattern_names)
    assert any("Clipboard" in p for p in pattern_names)
    assert any("AI Assistant" in p for p in pattern_names)
    
    # 4. Verify candidate list reflects AI verdict
    cands_res = client.get("/api/dashboard/candidates", headers=p_hdr)
    assert cands_res.status_code == 200
    c1 = next(x for x in cands_res.json() if x["candidate_id"] == "candidate1")
    assert c1["ai_risk_score"] >= 60
    assert c1["ai_verdict"] == "HIGH_RISK"
