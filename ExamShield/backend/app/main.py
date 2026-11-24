import os, csv, io, json, hashlib, hmac, uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
import jwt
from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, String, Integer, Float, DateTime, JSON, Text, select, func, UniqueConstraint, delete
from sqlalchemy.orm import declarative_base, sessionmaker, Mapped, mapped_column, Session

DB_URL = os.getenv("DATABASE_URL", "sqlite:///./examshield.db")
SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
engine = create_engine(DB_URL, connect_args={"check_same_thread": False} if DB_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(bind=engine, autoflush=False)
Base = declarative_base()

def now(): return datetime.now(timezone.utc)

def hash_pw(pw, salt=None):
    salt = salt or os.urandom(16).hex()
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 120_000).hex()
    return f"{salt}${h}"

def verify_pw(pw, stored):
    salt, _ = stored.split("$")
    return hmac.compare_digest(hash_pw(pw, salt), stored)

class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(20))
    password_hash: Mapped[str] = mapped_column(String(200))

class Event(Base):
    __tablename__ = "events"
    __table_args__ = (UniqueConstraint("event_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(String(64), index=True)
    session_id: Mapped[Optional[str]] = mapped_column(String(64), index=True, nullable=True)
    candidate_id: Mapped[str] = mapped_column(String(40), index=True)
    exam_id: Mapped[str] = mapped_column(String(40), index=True)
    event_type: Mapped[str] = mapped_column(String(40), index=True)
    event_category: Mapped[str] = mapped_column(String(30))
    severity: Mapped[str] = mapped_column(String(10), index=True)
    detection_source: Mapped[str] = mapped_column(String(30))
    confidence: Mapped[str] = mapped_column(String(12))
    event_description: Mapped[str] = mapped_column(Text)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    duration: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    meta: Mapped[dict] = mapped_column("metadata", JSON, default=dict)

class Session_(Base):
    __tablename__ = "candidate_sessions"
    session_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    candidate_id: Mapped[str] = mapped_column(String(40), index=True)
    exam_id: Mapped[str] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    end_time: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_heartbeat: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    latency_ms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    network: Mapped[str] = mapped_column(String(12), default="STABLE")

class Exam(Base):
    __tablename__ = "exams"
    exam_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=30)
    created_by: Mapped[str] = mapped_column(String(40), default="proctor1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    settings: Mapped[dict] = mapped_column("settings", JSON, default=dict)
    questions: Mapped[list] = mapped_column("questions", JSON, default=list)

class AIAudit(Base):
    __tablename__ = "ai_audits"
    audit_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(String(64), index=True)
    candidate_id: Mapped[str] = mapped_column(String(40), index=True)
    exam_id: Mapped[str] = mapped_column(String(40), index=True)
    risk_score: Mapped[int] = mapped_column(Integer)
    verdict: Mapped[str] = mapped_column(String(30))
    confidence: Mapped[str] = mapped_column(String(20))
    summary: Mapped[str] = mapped_column(Text)
    anomalies: Mapped[list] = mapped_column(JSON, default=list)
    telemetry_stats: Mapped[dict] = mapped_column(JSON, default=dict)
    recommendation: Mapped[str] = mapped_column(Text)
    audited_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

DEFAULT_EXAM_SETTINGS = {
    "fullscreenLock": True,
    "netflixShield": True,
    "aiScanner": True,
    "lensBlock": True,
    "antiPaste": True,
}

DEFAULT_QUESTIONS = [
    {
        "id": 1,
        "title": "Explain the difference between a stack and a queue, and give one real-world use case for each data structure.",
        "type": "text"
    },
    {
        "id": 2,
        "title": "Which data structure operates on a First-In, First-Out (FIFO) principle?",
        "type": "mcq",
        "options": ["Stack", "Queue", "Binary Search Tree", "Min Heap"]
    },
    {
        "id": 3,
        "title": "What is the worst-case time complexity of QuickSort?",
        "type": "mcq",
        "options": ["O(n log n)", "O(n)", "O(n²)", "O(log n)"]
    },
    {
        "id": 4,
        "title": "What is the time complexity of binary search?",
        "type": "mcq",
        "options": ["O(n)", "O(log n)", "O(n log n)", "O(n²)"]
    },
    {
        "id": 5,
        "title": "Which data structure uses pointers to connect nodes sequentially in memory?",
        "type": "mcq",
        "options": ["Array", "Linked List", "Hash Map", "Binary Heap"]
    },
    {
        "id": 6,
        "title": "In a balanced binary search tree with n nodes, what is the height of the tree?",
        "type": "mcq",
        "options": ["O(log n)", "O(n)", "O(n²)", "O(1)"]
    },
    {
        "id": 7,
        "title": "Which algorithm finds the shortest path between all pairs of vertices in a weighted graph?",
        "type": "mcq",
        "options": ["Dijkstra's Algorithm", "Floyd-Warshall Algorithm", "Prim's Algorithm", "Kruskal's Algorithm"]
    },
    {
        "id": 8,
        "title": "What is the average time complexity of a lookup operation in a hash table?",
        "type": "mcq",
        "options": ["O(1)", "O(n)", "O(log n)", "O(n log n)"]
    },
    {
        "id": 9,
        "title": "Which sorting algorithm is known to be stable and has O(n log n) worst-case time complexity?",
        "type": "mcq",
        "options": ["Merge Sort", "Quick Sort", "Heap Sort", "Selection Sort"]
    },
    {
        "id": 10,
        "title": "What data structure is typically used to implement Breadth-First Search (BFS)?",
        "type": "mcq",
        "options": ["Queue", "Stack", "Priority Queue", "Hash Table"]
    },
    {
        "id": 11,
        "title": "What data structure is typically used to implement Depth-First Search (DFS)?",
        "type": "mcq",
        "options": ["Stack", "Queue", "Array List", "Linked List"]
    },
    {
        "id": 12,
        "title": "Which algorithmic paradigm does the Merge Sort algorithm use?",
        "type": "mcq",
        "options": ["Divide and Conquer", "Dynamic Programming", "Greedy Approach", "Backtracking"]
    },
    {
        "id": 13,
        "title": "What is the auxiliary space complexity of standard iterative binary search?",
        "type": "mcq",
        "options": ["O(1)", "O(log n)", "O(n)", "O(n²)"]
    },
    {
        "id": 14,
        "title": "Which traversal of a Binary Search Tree produces elements in sorted ascending order?",
        "type": "mcq",
        "options": ["In-order Traversal", "Pre-order Traversal", "Post-order Traversal", "Level-order Traversal"]
    },
    {
        "id": 15,
        "title": "What is the primary condition for an AVL tree to maintain balance?",
        "type": "mcq",
        "options": [
            "Balance factor between -1, 0, and 1 for every node",
            "All leaves must be at exactly the same depth",
            "Left subtree size equals right subtree size",
            "Tree height cannot exceed 10"
        ]
    },
    {
        "id": 16,
        "title": "Which collision resolution technique stores all colliding elements in linked lists at each slot?",
        "type": "mcq",
        "options": ["Separate Chaining", "Linear Probing", "Quadratic Probing", "Double Hashing"]
    },
    {
        "id": 17,
        "title": "What is the time complexity to insert an element into a binary max heap of size n?",
        "type": "mcq",
        "options": ["O(log n)", "O(1)", "O(n)", "O(n log n)"]
    },
    {
        "id": 18,
        "title": "Which of the following problems can be solved in polynomial time using Dijkstra's algorithm?",
        "type": "mcq",
        "options": [
            "Single-source shortest path with non-negative edge weights",
            "Single-source shortest path with negative cycles",
            "Traveling Salesperson Problem",
            "Graph coloring with minimum colors"
        ]
    },
    {
        "id": 19,
        "title": "What is the time complexity of building a heap from an unsorted array of n elements?",
        "type": "mcq",
        "options": ["O(n)", "O(n log n)", "O(n²)", "O(log n)"]
    },
    {
        "id": 20,
        "title": "Which data structure is most efficient for implementing a priority queue?",
        "type": "mcq",
        "options": ["Binary Heap", "Unsorted Array", "Singly Linked List", "Binary Search Tree"]
    }
]

SEED = [("candidate1", "Alice Candidate", "candidate", "candidate123"),
        ("candidate2", "Bob Candidate", "candidate", "candidate123"),
        ("proctor1", "Pat Proctor", "proctor", "proctor123")]

def init_db():
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        for uid, name, role, pw in SEED:
            if not db.get(User, uid):
                db.add(User(id=uid, name=name, role=role, password_hash=hash_pw(pw)))
        if not db.get(Exam, "EXAM-001"):
            db.add(Exam(
                exam_id="EXAM-001",
                title="Data Structures & Algorithms Assessment",
                description="Comprehensive technical assessment covering core data structures, graph traversals, and asymptotic complexity.",
                duration_minutes=30,
                created_by="proctor1",
                settings=DEFAULT_EXAM_SETTINGS,
                questions=DEFAULT_QUESTIONS
            ))
        db.commit()

def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()

app = FastAPI(title="ExamShield")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "*").split(",") if os.getenv("CORS_ORIGINS") else ["*"],
                   allow_methods=["*"], allow_headers=["*"])

@app.on_event("startup")
def _startup(): init_db()

oauth = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

def make_token(u: User):
    return jwt.encode({"sub": u.id, "role": u.role, "exp": now() + timedelta(hours=8)}, SECRET, "HS256")

def decode(token):
    try: return jwt.decode(token, SECRET, ["HS256"])
    except jwt.PyJWTError: raise HTTPException(401, "Invalid token")

def current(token: str = Depends(oauth)): return decode(token)

def proctor(c=Depends(current)):
    if c["role"] != "proctor": raise HTTPException(403, "Proctor only")
    return c

class Login(BaseModel):
    username: str
    password: str

@app.post("/api/auth/login")
def login(b: Login, db: Session = Depends(get_db)):
    u = db.get(User, b.username)
    if not u or not verify_pw(b.password, u.password_hash): raise HTTPException(401, "Bad credentials")
    return {"access_token": make_token(u), "role": u.role, "id": u.id, "name": u.name}

class SessionStartIn(BaseModel):
    exam_id: str = "EXAM-001"

@app.post("/api/sessions/start")
async def start_session(b: Optional[SessionStartIn] = None, c=Depends(current), db: Session = Depends(get_db)):
    if c["role"] != "candidate": raise HTTPException(403, "Candidates only")
    exam_id = b.exam_id if b else "EXAM-001"
    new_sid = f"SESS-{c['sub']}-{uuid.uuid4().hex[:8]}"
    sess = Session_(session_id=new_sid, candidate_id=c["sub"], exam_id=exam_id, status="ACTIVE", start_time=now())
    db.add(sess)
    eid = uuid.uuid4().hex
    e = Event(event_id=eid, session_id=new_sid, candidate_id=c["sub"], exam_id=exam_id,
              event_type="EXAM_STARTED", event_category="SESSION", severity="INFO",
              detection_source="candidate_action", confidence="CONFIRMED",
              event_description="Candidate accepted proctoring terms and initiated the examination",
              timestamp=now(), duration=None, meta={"session_id": new_sid})
    db.add(e)
    db.commit()
    await hub.broadcast({"type": "session_started", "session": {"session_id": sess.session_id, "candidate_id": sess.candidate_id, "exam_id": sess.exam_id, "status": sess.status}})
    await hub.broadcast({"type": "event", "event": ev_out(e)})
    return {"session_id": new_sid, "exam_id": exam_id, "candidate_id": c["sub"], "status": "ACTIVE", "start_time": sess.start_time.isoformat()}

class EventIn(BaseModel):
    event_id: str = Field(min_length=8, max_length=64)
    session_id: Optional[str] = None
    exam_id: str = "EXAM-001"
    event_type: str
    event_category: str
    severity: str = Field(pattern="^(INFO|LOW|MEDIUM|HIGH)$")
    detection_source: str
    confidence: str = Field(pattern="^(CONFIRMED|INFERRED)$")
    event_description: str = Field(max_length=500)
    timestamp: Optional[datetime] = None
    duration: Optional[float] = None
    metadata: dict = {}

def ev_out(e: Event):
    return {"event_id": e.event_id, "session_id": e.session_id, "candidate_id": e.candidate_id, "exam_id": e.exam_id, "event_type": e.event_type,
            "event_category": e.event_category, "severity": e.severity, "detection_source": e.detection_source,
            "confidence": e.confidence, "event_description": e.event_description,
            "timestamp": e.timestamp.isoformat() if e.timestamp else None, "duration": e.duration, "metadata": e.meta}

class Hub:
    def __init__(self): self.conns: list[WebSocket] = []
    async def broadcast(self, msg):
        for ws in list(self.conns):
            try: await ws.send_text(json.dumps(msg))
            except Exception: self.conns.remove(ws)
hub = Hub()

@app.post("/api/events")
async def post_event(b: EventIn, c=Depends(current), db: Session = Depends(get_db)):
    if c["role"] != "candidate": raise HTTPException(403, "Candidates only")
    if db.scalar(select(Event).where(Event.event_id == b.event_id)):
        return {"status": "duplicate"}
    ts = b.timestamp or now()
    if ts.tzinfo is None: ts = ts.replace(tzinfo=timezone.utc)
    
    # Resolve or create session
    sess = None
    if b.session_id:
        sess = db.get(Session_, b.session_id)
    if not sess:
        sess = db.scalars(select(Session_).where(Session_.candidate_id == c["sub"]).order_by(Session_.start_time.desc())).first()
    if not sess:
        sess = Session_(session_id=f"SESS-{c['sub']}-{uuid.uuid4().hex[:8]}", candidate_id=c["sub"], exam_id=b.exam_id, status="ACTIVE", start_time=now())
        db.add(sess); db.commit()

    sid = b.session_id or (sess.session_id if sess else None)
    e = Event(event_id=b.event_id, session_id=sid, candidate_id=c["sub"], exam_id=b.exam_id, event_type=b.event_type,
              event_category=b.event_category, severity=b.severity, detection_source=b.detection_source,
              confidence=b.confidence, event_description=b.event_description, timestamp=ts,
              duration=b.duration, meta=b.metadata)
    db.add(e)
    if sess and b.event_type == "EXAM_STOPPED":
        sess.status = "STOPPED"
        sess.end_time = ts
    elif sess and b.event_type.startswith("NETWORK_"):
        sess.network = {"NETWORK_SLOW": "SLOW", "NETWORK_DISCONNECTED": "DOWN"}.get(b.event_type, "STABLE")
    db.commit()
    await hub.broadcast({"type": "event", "event": ev_out(e)})
    return {"status": "stored"}

@app.post("/api/exam/stop")
async def stop_exam(session_id: Optional[str] = None, c=Depends(current), db: Session = Depends(get_db)):
    if c["role"] != "candidate": raise HTTPException(403, "Candidates only")
    sess = None
    if session_id:
        sess = db.get(Session_, session_id)
    if not sess:
        sess = db.scalars(select(Session_).where(Session_.candidate_id == c["sub"]).order_by(Session_.start_time.desc())).first()
    ts = now()
    if sess:
        sess.status = "STOPPED"
        sess.end_time = ts
    sid = session_id or (sess.session_id if sess else None)
    eid = uuid.uuid4().hex
    e = Event(event_id=eid, session_id=sid, candidate_id=c["sub"], exam_id=sess.exam_id if sess else "EXAM-001",
              event_type="EXAM_STOPPED", event_category="SESSION", severity="INFO",
              detection_source="candidate_action", confidence="CONFIRMED",
              event_description="Candidate voluntarily stopped the examination",
              timestamp=ts, duration=None, meta={"session_id": sid, "reason": "voluntary_exit"})
    db.add(e)
    db.commit()
    await hub.broadcast({"type": "event", "event": ev_out(e)})
    return {"ok": True, "event": ev_out(e), "session_id": sid}

@app.post("/api/heartbeat")
def heartbeat(latency_ms: Optional[float] = None, session_id: Optional[str] = None, c=Depends(current), db: Session = Depends(get_db)):
    sess = None
    if session_id:
        sess = db.get(Session_, session_id)
    if not sess:
        sess = db.scalars(select(Session_).where(Session_.candidate_id == c["sub"]).order_by(Session_.start_time.desc())).first()
    if sess:
        sess.last_heartbeat, sess.latency_ms = now(), latency_ms; db.commit()
    return {"ok": True, "server_time": now().isoformat()}

@app.get("/api/ping")
def ping(): return {"ok": True}

@app.get("/api/dashboard/summary")
def summary(_=Depends(proctor), db: Session = Depends(get_db)):
    sessions = db.scalars(select(Session_)).all()
    flagged = db.scalar(select(func.count(func.distinct(Event.candidate_id))).where(Event.severity.in_(["MEDIUM", "HIGH"])))
    return {"total_candidates": db.scalar(select(func.count()).select_from(User).where(User.role == "candidate")),
            "active_candidates": sum(s.status == "ACTIVE" for s in sessions),
            "candidates_with_suspicious_events": flagged or 0,
            "total_events": db.scalar(select(func.count()).select_from(Event)),
            "network_problems": sum(s.network != "STABLE" for s in sessions)}

@app.get("/api/dashboard/candidates")
def candidates(q: str = "", _=Depends(proctor), db: Session = Depends(get_db)):
    out = []
    for u in db.scalars(select(User).where(User.role == "candidate")):
        if q and q.lower() not in (u.id + u.name).lower(): continue
        s = db.scalars(select(Session_).where(Session_.candidate_id == u.id).order_by(Session_.start_time.desc())).first()
        last = db.scalars(select(Event).where(Event.candidate_id == u.id).order_by(Event.timestamp.desc()).limit(1)).first()
        cnt = db.scalar(select(func.count()).select_from(Event).where(Event.candidate_id == u.id, Event.severity != "INFO"))
        ext_ev = db.scalars(select(Event).where(Event.candidate_id == u.id, Event.event_type == "BROWSER_EXTENSIONS_DETECTED").order_by(Event.timestamp.desc()).limit(1)).first()
        ext_meta = ext_ev.meta if ext_ev and ext_ev.meta else {}
        latest_audit = db.scalars(select(AIAudit).where(AIAudit.candidate_id == u.id).order_by(AIAudit.audited_at.desc())).first()
        out.append({"candidate_id": u.id, "name": u.name, "status": s.status if s else "NOT_STARTED",
                    "session_id": s.session_id if s else None,
                    "alert_count": cnt, "last_activity": last.event_type if last else None,
                    "network": s.network if s else "UNKNOWN", "latency_ms": s.latency_ms if s else None,
                    "extensions_count": ext_meta.get("count", 0),
                    "has_high_risk_extensions": ext_meta.get("has_high_risk", False),
                    "extensions": ext_meta.get("extensions", []),
                    "ai_risk_score": latest_audit.risk_score if latest_audit else None,
                    "ai_verdict": latest_audit.verdict if latest_audit else None})
    return out

@app.get("/api/candidates/{cid}/extensions")
def candidate_extensions(cid: str, _=Depends(proctor), db: Session = Depends(get_db)):
    ev = db.scalars(
        select(Event)
        .where(Event.candidate_id == cid, Event.event_type == "BROWSER_EXTENSIONS_DETECTED")
        .order_by(Event.timestamp.desc())
        .limit(1)
    ).first()
    if not ev or not ev.meta:
        return {"candidate_id": cid, "extensions": [], "count": 0, "has_high_risk": False, "last_scan": None}
    return {
        "candidate_id": cid,
        "extensions": ev.meta.get("extensions", []),
        "count": ev.meta.get("count", 0),
        "has_high_risk": ev.meta.get("has_high_risk", False),
        "last_scan": ev.timestamp.isoformat() if ev.timestamp else None,
        "event_id": ev.event_id
    }

@app.get("/api/candidates/{cid}/sessions")
def candidate_sessions(cid: str, _=Depends(proctor), db: Session = Depends(get_db)):
    sessions = db.scalars(select(Session_).where(Session_.candidate_id == cid).order_by(Session_.start_time.desc())).all()
    out = []
    for s in sessions:
        cnt = db.scalar(select(func.count()).select_from(Event).where(Event.session_id == s.session_id)) or 0
        alerts = db.scalar(select(func.count()).select_from(Event).where(Event.session_id == s.session_id, Event.severity != "INFO")) or 0
        out.append({"session_id": s.session_id, "candidate_id": s.candidate_id, "exam_id": s.exam_id,
                    "status": s.status, "start_time": s.start_time.isoformat() if s.start_time else None,
                    "end_time": s.end_time.isoformat() if s.end_time else None,
                    "total_events": cnt, "alert_count": alerts, "network": s.network, "latency_ms": s.latency_ms})
    return out

@app.get("/api/candidates/{cid}/events")
def candidate_events(cid: str, session_id: Optional[str] = None, _=Depends(proctor), db: Session = Depends(get_db)):
    st = select(Event).where(Event.candidate_id == cid)
    if session_id and session_id != "all":
        st = st.where(Event.session_id == session_id)
    rows = db.scalars(st.order_by(Event.timestamp.desc())).all()
    return [ev_out(e) for e in rows]

@app.get("/api/sessions/{sid}/events")
def session_events(sid: str, _=Depends(proctor), db: Session = Depends(get_db)):
    rows = db.scalars(select(Event).where(Event.session_id == sid).order_by(Event.timestamp.desc())).all()
    return [ev_out(e) for e in rows]

@app.delete("/api/sessions/{sid}")
def delete_session(sid: str, _=Depends(proctor), db: Session = Depends(get_db)):
    db.execute(delete(Event).where(Event.session_id == sid))
    db.execute(delete(Session_).where(Session_.session_id == sid))
    db.commit()
    return {"ok": True, "deleted_session_id": sid}

@app.delete("/api/candidates/{cid}/sessions")
def delete_candidate_sessions(cid: str, _=Depends(proctor), db: Session = Depends(get_db)):
    # Find all sessions for this candidate
    sids = db.scalars(select(Session_.session_id).where(Session_.candidate_id == cid)).all()
    db.execute(delete(Event).where((Event.candidate_id == cid) | (Event.session_id.in_(sids))))
    db.execute(delete(Session_).where(Session_.candidate_id == cid))
    db.commit()
    return {"ok": True, "deleted_candidate_id": cid, "deleted_sessions_count": len(sids)}

def filtered(candidate_id, session_id, event_type, severity, q, date_from, date_to, sort, order):
    st = select(Event)
    if candidate_id: st = st.where(Event.candidate_id == candidate_id)
    if session_id: st = st.where(Event.session_id == session_id)
    if event_type: st = st.where(Event.event_type == event_type)
    if severity: st = st.where(Event.severity == severity)
    if q: st = st.where(Event.event_description.ilike(f"%{q}%") | Event.candidate_id.ilike(f"%{q}%"))
    if date_from: st = st.where(Event.timestamp >= date_from)
    if date_to: st = st.where(Event.timestamp <= date_to)
    col = getattr(Event, sort if sort in ("timestamp", "severity", "event_type", "candidate_id") else "timestamp")
    return st.order_by(col.desc() if order == "desc" else col.asc())

@app.get("/api/events")
def list_events(candidate_id: Optional[str] = None, session_id: Optional[str] = None, event_type: Optional[str] = None,
                severity: Optional[str] = None, q: Optional[str] = None, date_from: Optional[datetime] = None,
                date_to: Optional[datetime] = None, sort: str = "timestamp", order: str = "desc",
                page: int = Query(1, ge=1), page_size: int = Query(25, le=200),
                _=Depends(proctor), db: Session = Depends(get_db)):
    st = filtered(candidate_id, session_id, event_type, severity, q, date_from, date_to, sort, order)
    total = db.scalar(select(func.count()).select_from(st.order_by(None).subquery()))
    rows = db.scalars(st.offset((page - 1) * page_size).limit(page_size)).all()
    return {"total": total, "page": page, "items": [ev_out(e) for e in rows]}

@app.get("/api/export/events.csv")
def export_csv(candidate_id: Optional[str] = None, session_id: Optional[str] = None, event_type: Optional[str] = None,
               severity: Optional[str] = None, _=Depends(proctor), db: Session = Depends(get_db)):
    rows = db.scalars(filtered(candidate_id, session_id, event_type, severity, None, None, None, "timestamp", "asc")).all()
    buf = io.StringIO(); w = csv.writer(buf)
    cols = ["event_id", "session_id", "candidate_id", "exam_id", "event_type", "event_category", "severity",
            "detection_source", "confidence", "event_description", "timestamp", "duration"]
    w.writerow(cols)
    for e in rows:
        o = ev_out(e); w.writerow([o[c] for c in cols])
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=activity_logs.csv"})

@app.get("/api/reports/exam/{exam_id}")
def report(exam_id: str, _=Depends(proctor), db: Session = Depends(get_db)):
    by_type = dict(db.execute(select(Event.event_type, func.count()).where(Event.exam_id == exam_id).group_by(Event.event_type)).all())
    per_c = db.execute(select(Event.candidate_id, Event.severity, func.count()).where(Event.exam_id == exam_id)
                       .group_by(Event.candidate_id, Event.severity)).all()
    cands = {}
    for cid, sev, n in per_c: cands.setdefault(cid, {})[sev] = n
    return {"exam_id": exam_id, "events_by_type": by_type, "candidates": cands,
            "note": "Activity records for human review; not a determination of misconduct."}

class ExamCreateIn(BaseModel):
    exam_id: Optional[str] = None
    title: str
    description: Optional[str] = ""
    duration_minutes: int = 30
    settings: Optional[dict] = None
    questions: list = []

def exam_out(e: Exam):
    return {
        "exam_id": e.exam_id,
        "title": e.title,
        "description": e.description or "",
        "duration_minutes": e.duration_minutes,
        "created_by": e.created_by,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "settings": e.settings or {},
        "question_count": len(e.questions or []),
        "questions": e.questions or []
    }

@app.get("/api/exams")
def list_exams(db: Session = Depends(get_db)):
    exams = db.scalars(select(Exam).order_by(Exam.created_at.desc())).all()
    return [exam_out(e) for e in exams]

@app.post("/api/exams")
def create_exam(b: ExamCreateIn, c=Depends(proctor), db: Session = Depends(get_db)):
    eid = b.exam_id.strip() if b.exam_id and b.exam_id.strip() else f"EXAM-{uuid.uuid4().hex[:6].upper()}"
    if db.get(Exam, eid):
        raise HTTPException(400, f"Exam with ID '{eid}' already exists")
    
    settings = b.settings if b.settings is not None else DEFAULT_EXAM_SETTINGS
    new_exam = Exam(
        exam_id=eid,
        title=b.title,
        description=b.description,
        duration_minutes=max(1, b.duration_minutes),
        created_by=c["sub"],
        created_at=now(),
        settings=settings,
        questions=b.questions
    )
    db.add(new_exam)
    db.commit()
    return exam_out(new_exam)

@app.get("/api/exams/{exam_id}")
def get_exam(exam_id: str, db: Session = Depends(get_db)):
    e = db.get(Exam, exam_id)
    if not e:
        raise HTTPException(404, "Exam not found")
    return exam_out(e)

@app.delete("/api/exams/{exam_id}")
def delete_exam(exam_id: str, _=Depends(proctor), db: Session = Depends(get_db)):
    e = db.get(Exam, exam_id)
    if not e:
        raise HTTPException(404, "Exam not found")
    db.delete(e)
    db.commit()
    return {"status": "deleted", "exam_id": exam_id}

# ==============================================================
# AI PROCTOR TELEMETRY AUDIT ENGINE (PROMPT-INJECTION PROOF)
# Consumes strictly typed, sanitized telemetry logs (0 candidate prose)
# ==============================================================

def analyze_telemetry_stream(session: Session_, events: list[Event]) -> dict:
    total_events = len(events)
    focus_losses = [e for e in events if e.event_type in ("WINDOW_FOCUS_LOST", "TAB_SWITCH", "WINDOW_SWITCH", "ALT_TAB")]
    total_unfocused_sec = round(sum(e.duration or 0.0 for e in focus_losses), 1)
    
    screenshots = [e for e in events if "SCREENSHOT" in e.event_type or "PRINT" in e.event_type]
    pastes = [e for e in events if "PASTE" in e.event_type or e.event_category == "CLIPBOARD"]
    devtools = [e for e in events if "DEVTOOLS" in e.event_type or e.event_type == "F12_ATTEMPT"]
    right_clicks = [e for e in events if e.event_type in ("RIGHT_CLICK", "CONTEXT_MENU_ATTEMPT")]
    fullscreen_exits = [e for e in events if e.event_type in ("FULLSCREEN_EXIT", "WINDOW_RESIZED")]
    
    ext_events = [e for e in events if e.event_type == "BROWSER_EXTENSIONS_DETECTED"]
    voice_events = [e for e in events if "VOICE" in e.event_type or e.event_category == "AUDIO"]
    high_risk_exts = []
    if ext_events:
        last_ext_meta = ext_events[-1].meta or {}
        ext_list = last_ext_meta.get("extensions", [])
        high_risk_exts = [x for x in ext_list if x.get("risk") == "HIGH"]

    stats = {
        "total_events": total_events,
        "focus_lost_count": len(focus_losses),
        "total_unfocused_sec": total_unfocused_sec,
        "screenshot_attempts": len(screenshots),
        "paste_attempts": len(pastes),
        "devtools_attempts": len(devtools),
        "right_click_attempts": len(right_clicks),
        "fullscreen_exits": len(fullscreen_exits),
        "high_risk_extensions_count": len(high_risk_exts),
        "voice_detections_count": len(voice_events),
    }

    anomalies = []
    score = 0

    if high_risk_exts:
        score += 40
        names = ", ".join(x.get("name", x.get("id", "Unknown")) for x in high_risk_exts[:3])
        anomalies.append({
            "pattern": "Active AI Assistant / Proctor Bypass Extension",
            "severity": "HIGH",
            "confidence": "CONFIRMED",
            "evidence": f"Detected high-risk extension(s) running in candidate browser: {names}.",
            "timestamp": ext_events[-1].timestamp.isoformat() if ext_events else None
        })

    if screenshots:
        add_score = min(40, 25 + (len(screenshots) - 1) * 10)
        score += add_score
        exfiltration_correlated = False
        for sc in screenshots:
            sc_ts = sc.timestamp
            for fl in focus_losses:
                delta = (fl.timestamp - sc_ts).total_seconds()
                if 0 <= delta <= 20:
                    exfiltration_correlated = True
                    break
        
        evidence_text = f"Candidate triggered {len(screenshots)} unauthorized screenshot capture attempt(s) (e.g. PrintScreen, Greenshot hotkeys)."
        if exfiltration_correlated:
            score += 15
            evidence_text += " Telemetry shows window departure directly following screenshot, indicating external exfiltration."

        anomalies.append({
            "pattern": "Content Extraction via Screenshot",
            "severity": "HIGH",
            "confidence": "HIGH",
            "evidence": evidence_text,
            "timestamp": screenshots[0].timestamp.isoformat()
        })

    if pastes:
        score += min(30, 20 + len(pastes) * 5)
        anomalies.append({
            "pattern": "Unauthorized Clipboard Injection Attempt",
            "severity": "HIGH",
            "confidence": "CONFIRMED",
            "evidence": f"Candidate attempted unauthorized paste/clipboard operations ({len(pastes)} times) into protected examination response fields.",
            "timestamp": pastes[0].timestamp.isoformat()
        })

    if total_unfocused_sec >= 45 or len(focus_losses) >= 4:
        sev = "HIGH" if (total_unfocused_sec >= 60 or len(focus_losses) >= 6) else "MEDIUM"
        score += (25 if sev == "HIGH" else 15)
        anomalies.append({
            "pattern": "Chronic Window Focus Departure",
            "severity": sev,
            "confidence": "HIGH",
            "evidence": f"Candidate navigated away from examination window {len(focus_losses)} times, spending a cumulative {total_unfocused_sec}s outside proctored viewport.",
            "timestamp": focus_losses[0].timestamp.isoformat() if focus_losses else None
        })
    elif total_unfocused_sec >= 15 or len(focus_losses) >= 2:
        score += 10
        anomalies.append({
            "pattern": "Moderate External Window Switching",
            "severity": "MEDIUM",
            "confidence": "MEDIUM",
            "evidence": f"Candidate navigated away from examination window {len(focus_losses)} times ({total_unfocused_sec}s unfocused).",
            "timestamp": focus_losses[0].timestamp.isoformat() if focus_losses else None
        })

    if devtools:
        score += 20
        anomalies.append({
            "pattern": "Developer Tools & DOM Inspection Attempt",
            "severity": "HIGH",
            "confidence": "CONFIRMED",
            "evidence": f"Candidate triggered DevTools or inspection shortcuts ({len(devtools)} time(s)).",
            "timestamp": devtools[0].timestamp.isoformat()
        })

    if len(right_clicks) >= 4:
        score += 10
        anomalies.append({
            "pattern": "Frequent Context Menu Interception",
            "severity": "LOW",
            "confidence": "MEDIUM",
            "evidence": f"Candidate made {len(right_clicks)} right-click attempts to access browser context menus.",
            "timestamp": right_clicks[0].timestamp.isoformat()
        })

    if voice_events:
        score += min(35, 20 + (len(voice_events) - 1) * 10)
        anomalies.append({
            "pattern": "Acoustic Speech / Verbal Communication Detected",
            "severity": "HIGH" if len(voice_events) >= 2 else "MEDIUM",
            "confidence": "CONFIRMED",
            "evidence": f"Voice isolation detector flagged {len(voice_events)} human vocal speech event(s) during the proctored session.",
            "timestamp": voice_events[0].timestamp.isoformat()
        })

    risk_score = min(100, max(0, score))

    if risk_score >= 60:
        verdict = "HIGH_RISK"
        confidence = "HIGH"
        summary = (
            f"Candidate exhibited multiple high-risk behavioral anomalies (Score: {risk_score}/100). "
            f"Key telemetry indicators include {len(anomalies)} critical pattern violation(s) including "
            f"{'AI copilot detection, ' if high_risk_exts else ''}"
            f"{'screen extraction attempts, ' if screenshots else ''}"
            f"{'anti-paste violations, ' if pastes else ''}"
            f"{'verbal communication detected, ' if voice_events else ''}"
            f"{'significant unfocused window duration (' + str(total_unfocused_sec) + 's).' if total_unfocused_sec > 30 else 'prohibited shortcuts.'}"
        )
        recommendation = "Recommend immediate manual review of the event timeline. Candidate telemetry strongly correlates with external assistance or unauthorized software."
    elif risk_score >= 25:
        verdict = "SUSPICIOUS"
        confidence = "MEDIUM"
        summary = (
            f"Candidate exhibited moderate telemetry anomalies (Score: {risk_score}/100) requiring proctor attention. "
            f"Detected {len(anomalies)} anomaly pattern(s), primarily involving focus shifts or UI probing."
        )
        recommendation = "Recommend spot-checking the activity timeline. Verify whether focus switches correspond with difficult questions."
    else:
        verdict = "CLEAN"
        confidence = "HIGH" if total_events >= 2 else "MEDIUM"
        summary = (
            f"Candidate telemetry demonstrated high examination integrity (Score: {risk_score}/100). "
            f"Normal session flow with zero unauthorized extensions, zero paste attempts, and no evidence of content exfiltration."
        )
        recommendation = "No suspicious behavior detected. Session meets standard integrity thresholds."

    return {
        "session_id": session.session_id,
        "candidate_id": session.candidate_id,
        "exam_id": session.exam_id,
        "risk_score": risk_score,
        "verdict": verdict,
        "confidence": confidence,
        "summary": summary,
        "anomalies": anomalies,
        "telemetry_stats": stats,
        "recommendation": recommendation,
        "audited_at": now().isoformat()
    }

def audit_out(a: AIAudit):
    return {
        "audit_id": a.audit_id,
        "session_id": a.session_id,
        "candidate_id": a.candidate_id,
        "exam_id": a.exam_id,
        "risk_score": a.risk_score,
        "verdict": a.verdict,
        "confidence": a.confidence,
        "summary": a.summary,
        "anomalies": a.anomalies or [],
        "telemetry_stats": a.telemetry_stats or {},
        "recommendation": a.recommendation,
        "audited_at": a.audited_at.isoformat() if a.audited_at else None
    }

@app.post("/api/proctor/ai-audit/{session_id}")
def run_ai_audit(session_id: str, _=Depends(proctor), db: Session = Depends(get_db)):
    sess = db.get(Session_, session_id)
    if not sess:
        # Gracefully check if session_id passed was actually candidate_id
        cand_sess = db.scalars(select(Session_).where(Session_.candidate_id == session_id).order_by(Session_.start_time.desc())).first()
        if cand_sess:
            sess = cand_sess
            session_id = cand_sess.session_id
        else:
            raise HTTPException(404, f"Session '{session_id}' not found")
    
    events = db.scalars(
        select(Event)
        .where(Event.session_id == session_id)
        .order_by(Event.timestamp.asc())
    ).all()

    if not events:
        events = db.scalars(
            select(Event)
            .where(Event.candidate_id == sess.candidate_id)
            .order_by(Event.timestamp.asc())
        ).all()

    analysis = analyze_telemetry_stream(sess, events)

    existing = db.scalars(select(AIAudit).where(AIAudit.session_id == session_id)).first()
    if existing:
        existing.risk_score = analysis["risk_score"]
        existing.verdict = analysis["verdict"]
        existing.confidence = analysis["confidence"]
        existing.summary = analysis["summary"]
        existing.anomalies = analysis["anomalies"]
        existing.telemetry_stats = analysis["telemetry_stats"]
        existing.recommendation = analysis["recommendation"]
        existing.audited_at = now()
        audit_record = existing
    else:
        audit_record = AIAudit(
            audit_id=f"AUDIT-{uuid.uuid4().hex[:8]}",
            session_id=sess.session_id,
            candidate_id=sess.candidate_id,
            exam_id=sess.exam_id,
            risk_score=analysis["risk_score"],
            verdict=analysis["verdict"],
            confidence=analysis["confidence"],
            summary=analysis["summary"],
            anomalies=analysis["anomalies"],
            telemetry_stats=analysis["telemetry_stats"],
            recommendation=analysis["recommendation"],
            audited_at=now()
        )
        db.add(audit_record)

    db.commit()
    return audit_out(audit_record)

@app.get("/api/proctor/ai-audit/{session_id}")
def get_ai_audit(session_id: str, _=Depends(proctor), db: Session = Depends(get_db)):
    existing = db.scalars(select(AIAudit).where(AIAudit.session_id == session_id).order_by(AIAudit.audited_at.desc())).first()
    if existing:
        return audit_out(existing)
    return run_ai_audit(session_id, _, db)

@app.get("/api/candidates/{cid}/ai-audit")
def get_candidate_ai_audit(cid: str, _=Depends(proctor), db: Session = Depends(get_db)):
    existing = db.scalars(select(AIAudit).where(AIAudit.candidate_id == cid).order_by(AIAudit.audited_at.desc())).first()
    if existing:
        return audit_out(existing)
    sess = db.scalars(select(Session_).where(Session_.candidate_id == cid).order_by(Session_.start_time.desc())).first()
    if not sess:
        return {
            "audit_id": f"AUDIT-{cid}-BASELINE",
            "session_id": "NONE",
            "candidate_id": cid,
            "exam_id": "NONE",
            "risk_score": 0,
            "verdict": "CLEAN",
            "confidence": "BASELINE",
            "summary": f"No active exam session or telemetry logs found for candidate '{cid}'. Baseline examination status is clean.",
            "anomalies": [],
            "telemetry_stats": {
                "total_events": 0,
                "unfocused_duration_sec": 0,
                "focus_loss_count": 0,
                "screenshot_attempts": 0,
                "paste_attempts": 0,
                "devtools_attempts": 0,
                "right_click_attempts": 0,
                "fullscreen_exits": 0,
                "high_risk_extensions_count": 0,
            },
            "recommendation": "Candidate has not initiated an examination session. No violations or telemetry recorded.",
            "audited_at": now().isoformat()
        }
    return run_ai_audit(sess.session_id, _, db)

@app.websocket("/ws/proctor")
async def ws_proctor(ws: WebSocket, token: str = Query("")):
    try:
        c = decode(token)
        if c["role"] != "proctor": raise HTTPException(403)
    except HTTPException:
        await ws.close(code=4401); return
    await ws.accept(); hub.conns.append(ws)
    try:
        while True: await ws.receive_text()
    except WebSocketDisconnect:
        if ws in hub.conns: hub.conns.remove(ws)
