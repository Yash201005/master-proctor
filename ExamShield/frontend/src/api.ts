const API = (import.meta as any).env?.VITE_API_URL ?? "";
export const WS = API
  ? API.replace(/^http/, "ws")
  : (typeof window !== "undefined"
    ? (window.location.protocol === "https:" ? "wss://" : "ws://") + window.location.host
    : "ws://localhost:8000");
export interface Auth { access_token: string; role: "candidate" | "proctor"; id: string; name: string }
export async function api<T = any>(path: string, token?: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(API + path, {
    keepalive: true,
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {})
    }
  });
  if (!r.ok) throw new Error(String(r.status)); return r.json();
}
export const login = (username: string, password: string) => api<Auth>("/api/auth/login", undefined, { method: "POST", body: JSON.stringify({ username, password }) });
export const deleteSession = (sid: string, token: string) => api(`/api/sessions/${encodeURIComponent(sid)}`, token, { method: "DELETE" });
export const deleteCandidateSessions = (cid: string, token: string) => api(`/api/candidates/${encodeURIComponent(cid)}/sessions`, token, { method: "DELETE" });

export interface ExamQuestion {
  id: number;
  title: string;
  type: "mcq" | "text";
  options?: string[];
}

export interface ExamSettings {
  fullscreenLock?: boolean;
  netflixShield?: boolean;
  aiScanner?: boolean;
  lensBlock?: boolean;
  antiPaste?: boolean;
}

export interface ExamData {
  exam_id: string;
  title: string;
  description?: string;
  duration_minutes: number;
  created_by?: string;
  created_at?: string;
  settings?: ExamSettings;
  questions?: ExamQuestion[];
  question_count?: number;
}

export const getExams = (token?: string) => api<ExamData[]>("/api/exams", token);
export const getExam = (examId: string, token?: string) => api<ExamData>(`/api/exams/${encodeURIComponent(examId)}`, token);
export const createExam = (exam: Partial<ExamData>, token: string) =>
  api<ExamData>("/api/exams", token, { method: "POST", body: JSON.stringify(exam) });
export const deleteExam = (examId: string, token: string) =>
  api<{ status: string; exam_id: string }>(`/api/exams/${encodeURIComponent(examId)}`, token, { method: "DELETE" });

export interface AIAuditResult {
  audit_id: string;
  session_id: string;
  candidate_id: string;
  exam_id: string;
  risk_score: number;
  verdict: "CLEAN" | "SUSPICIOUS" | "HIGH_RISK";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  summary: string;
  anomalies: Array<{
    pattern: string;
    severity: "HIGH" | "MEDIUM" | "LOW";
    confidence: string;
    evidence: string;
    timestamp: string | null;
  }>;
  telemetry_stats: {
    total_events: number;
    focus_lost_count: number;
    total_unfocused_sec: number;
    screenshot_attempts: number;
    paste_attempts: number;
    devtools_attempts: number;
    right_click_attempts: number;
    fullscreen_exits: number;
    high_risk_extensions_count: number;
    voice_detections_count?: number;
  };
  recommendation: string;
  audited_at: string | null;
}

export const getAIAudit = (sessionId: string, token: string) =>
  api<AIAuditResult>(`/api/proctor/ai-audit/${encodeURIComponent(sessionId)}`, token);

export const runAIAudit = (sessionId: string, token: string) =>
  api<AIAuditResult>(`/api/proctor/ai-audit/${encodeURIComponent(sessionId)}`, token, { method: "POST" });

export const getCandidateAIAudit = (candidateId: string, token: string) =>
  api<AIAuditResult>(`/api/candidates/${encodeURIComponent(candidateId)}/ai-audit`, token);

export async function downloadCsv(token: string) {
  const r = await fetch(API + "/api/export/events.csv", { headers: { Authorization: `Bearer ${token}` } });
  const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = "activity_logs.csv"; a.click();
}
