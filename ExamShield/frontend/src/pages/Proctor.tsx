import { useCallback, useEffect, useState } from "react";
import {
  Shield,
  LayoutDashboard,
  Radio,
  FileText,
  BarChart3,
  Settings,
  Search,
  LogOut,
  AlertTriangle,
  Monitor,
  Maximize,
  Copy,
  Download,
  StopCircle,
  MousePointer,
  Keyboard,
  Clock,
  User,
  Users,
  ChevronRight,
  Filter,
  ArrowLeft,
  RefreshCw,
  ExternalLink,
  Calendar,
  Layers,
  History,
  Camera,
  Puzzle,
  X,
  CheckCircle,
  Columns,
  Trash2,
  Plus,
  Play,
  Check,
  Sparkles,
  BookOpen,
  Bot,
  TrendingUp,
  Zap,
  CheckCircle2
} from "lucide-react";
import {
  api,
  downloadCsv,
  WS,
  deleteSession,
  deleteCandidateSessions,
  getExams,
  createExam,
  deleteExam,
  runAIAudit,
  getAIAudit,
  getCandidateAIAudit,
  type Auth,
  type ExamData,
  type ExamQuestion,
  type AIAuditResult
} from "../api";

type Ev = {
  event_id: string;
  session_id?: string | null;
  candidate_id: string;
  exam_id: string;
  event_type: string;
  event_category: string;
  severity: string;
  detection_source: string;
  confidence: string;
  event_description: string;
  duration?: number;
  timestamp: string;
  metadata?: Record<string, any>;
};

type SessionInfo = {
  session_id: string;
  candidate_id: string;
  exam_id: string;
  status: string;
  start_time: string | null;
  end_time: string | null;
  total_events: number;
  alert_count: number;
  network?: string;
  latency_ms?: number | null;
};

export default function Proctor({ auth, onLogout }: { auth: Auth; onLogout?: () => void }) {
  const t = auth.access_token;
  const [tab, setTab] = useState<"live" | "logs" | "reports" | "dashboard" | "settings" | "assessments">(() => {
    try {
      return (new URLSearchParams(window.location.search).get("tab") as any) || "live";
    } catch {
      return "live";
    }
  });

  // Assessment Studio (HackerRank-style) State
  const [examsList, setExamsList] = useState<ExamData[]>([]);
  const [isLoadingExams, setIsLoadingExams] = useState(false);
  const [isCreateExamOpen, setIsCreateExamOpen] = useState(false);
  const [copiedExamId, setCopiedExamId] = useState<string | null>(null);
  const [examSearch, setExamSearch] = useState("");

  // Create Assessment Form State
  const [newExamTitle, setNewExamTitle] = useState("");
  const [newExamId, setNewExamId] = useState("");
  const [newExamDesc, setNewExamDesc] = useState("");
  const [newExamDuration, setNewExamDuration] = useState(30);
  const [newExamSettings, setNewExamSettings] = useState({
    fullscreenLock: true,
    netflixShield: true,
    aiScanner: true,
    lensBlock: true,
    antiPaste: true
  });
  const [newExamQuestions, setNewExamQuestions] = useState<ExamQuestion[]>([
    {
      id: 1,
      title: "Explain the architecture of your most complex system, detailing scalability and security tradeoffs.",
      type: "text"
    },
    {
      id: 2,
      title: "Which data structure provides average O(1) time complexity for lookup, insert, and delete?",
      type: "mcq",
      options: ["Hash Table", "Binary Search Tree", "Linked List", "Array"]
    }
  ]);

  // Live state
  const [sum, setSum] = useState<any>({});
  const [cands, setCands] = useState<any[]>([]);
  const [q, setQ] = useState("");

  // Selected candidate & session segregation in Live Monitoring
  const [selectedCand, setSelectedCand] = useState<string>("candidate1");
  const [candSessions, setCandSessions] = useState<SessionInfo[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("all");
  const [candLogs, setCandLogs] = useState<Ev[]>([]);

  // Dedicated "View Full Logs" Page State
  const [viewingFullLogsCand, setViewingFullLogsCand] = useState<string | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("fullLogs");
    } catch {
      return null;
    }
  });
  const [fullLogsSessionId, setFullLogsSessionId] = useState<string>("all");
  const [fullLogsSearch, setFullLogsSearch] = useState("");
  const [fullLogsSev, setFullLogsSev] = useState("");
  const [fullLogsType, setFullLogsType] = useState("");

  // Logs tab state: selected candidate & session filter for clean separation
  const [filterCandInLogs, setFilterCandInLogs] = useState<string>("all");
  const [filterSessionInLogs, setFilterSessionInLogs] = useState<string>("all");
  const [logs, setLogs] = useState<{ total: number; items: Ev[] }>({ total: 0, items: [] });
  const [page, setPage] = useState(1);
  const [type, setType] = useState("");
  const [sev, setSev] = useState("");
  const [from, setFrom] = useState("");
  const [order, setOrder] = useState("desc");

  // Reports tab state
  const [report, setReport] = useState<any>(null);

  // Browser Extensions Inspector Modal State
  const [viewingExtensionsCand, setViewingExtensionsCand] = useState<string | null>(null);
  const [candExtensionsData, setCandExtensionsData] = useState<{
    candidate_id: string;
    extensions: any[];
    count: number;
    has_high_risk: boolean;
    last_scan: string | null;
  } | null>(null);
  const [isLoadingExtensions, setIsLoadingExtensions] = useState(false);

  const openExtensionsModal = useCallback(async (candidateId: string) => {
    setViewingExtensionsCand(candidateId);
    setIsLoadingExtensions(true);

    // 1. Immediately look for extensions from currently loaded event logs
    const allEvents = (candLogs || []).concat(logs.items || []);
    const evInLogs = allEvents.find(
      (e) =>
        e.candidate_id === candidateId &&
        e.event_type === "BROWSER_EXTENSIONS_DETECTED" &&
        e.metadata?.extensions &&
        Array.isArray(e.metadata.extensions) &&
        e.metadata.extensions.length > 0
    );

    if (evInLogs && evInLogs.metadata?.extensions) {
      setCandExtensionsData({
        candidate_id: candidateId,
        extensions: evInLogs.metadata.extensions,
        count: evInLogs.metadata.count || evInLogs.metadata.extensions.length,
        has_high_risk: evInLogs.metadata.has_high_risk ?? false,
        last_scan: evInLogs.timestamp
      });
    }

    try {
      const data = await api(`/api/candidates/${candidateId}/extensions`, t);
      if (data && data.extensions && data.extensions.length > 0) {
        setCandExtensionsData(data);
      } else if (!evInLogs) {
        const c = cands.find((x) => x.candidate_id === candidateId);
        if (c?.extensions && c.extensions.length > 0) {
          setCandExtensionsData({
            candidate_id: candidateId,
            extensions: c.extensions,
            count: c.extensions_count || c.extensions.length,
            has_high_risk: c.has_high_risk_extensions || false,
            last_scan: null
          });
        } else {
          setCandExtensionsData(data || {
            candidate_id: candidateId,
            extensions: [],
            count: 0,
            has_high_risk: false,
            last_scan: null
          });
        }
      }
    } catch {
      if (!evInLogs) {
        const c = cands.find((x) => x.candidate_id === candidateId);
        setCandExtensionsData({
          candidate_id: candidateId,
          extensions: c?.extensions || [],
          count: c?.extensions_count || (c?.extensions?.length ?? 0),
          has_high_risk: c?.has_high_risk_extensions || false,
          last_scan: null
        });
      }
    } finally {
      setIsLoadingExtensions(false);
    }
  }, [t, cands, candLogs, logs.items]);

  useEffect(() => {
    try {
      const initExt = new URLSearchParams(window.location.search).get("inspectExt");
      if (initExt) {
        openExtensionsModal(initExt);
      }
    } catch {}
  }, [openExtensionsModal]);

  // AI Proctor Telemetry Audit Modal State
  const [viewingAIAuditCand, setViewingAIAuditCand] = useState<string | null>(null);
  const [aiAuditData, setAiAuditData] = useState<AIAuditResult | null>(null);
  const [isLoadingAIAudit, setIsLoadingAIAudit] = useState(false);
  const [aiAuditError, setAiAuditError] = useState<string | null>(null);

  // Load live candidates & stats
  const loadLive = useCallback(() => {
    api("/api/dashboard/summary", t).then(setSum).catch(() => { });
    api(`/api/dashboard/candidates?q=${encodeURIComponent(q)}`, t)
      .then((data) => {
        setCands(data);
      })
      .catch(() => { });
  }, [t, q]);

  const openAIAuditModal = useCallback(async (candidateId: string, sessionId?: string | null) => {
    setViewingAIAuditCand(candidateId);
    setIsLoadingAIAudit(true);
    setAiAuditError(null);
    setAiAuditData(null);

    try {
      let data: AIAuditResult;
      if (sessionId && sessionId !== "all") {
        data = await getAIAudit(sessionId, t);
      } else {
        data = await getCandidateAIAudit(candidateId, t);
      }
      setAiAuditData(data);
    } catch (err: any) {
      console.error("AI audit failed:", err);
      setAiAuditError(err.message || "Failed to analyze candidate telemetry.");
    } finally {
      setIsLoadingAIAudit(false);
    }
  }, [t]);

  const reRunAIAuditAction = useCallback(async () => {
    if (!viewingAIAuditCand) return;
    setIsLoadingAIAudit(true);
    setAiAuditError(null);
    try {
      let data: AIAuditResult;
      if (aiAuditData?.session_id && aiAuditData.session_id !== "NONE" && aiAuditData.session_id !== "all") {
        data = await runAIAudit(aiAuditData.session_id, t);
      } else {
        data = await getCandidateAIAudit(viewingAIAuditCand, t);
      }
      setAiAuditData(data);
      loadLive();
    } catch (err: any) {
      console.error("Re-run AI audit failed:", err);
      setAiAuditError(err.message || "Failed to re-analyze telemetry stream.");
    } finally {
      setIsLoadingAIAudit(false);
    }
  }, [aiAuditData?.session_id, viewingAIAuditCand, t, loadLive]);

  // Load candidate events (optionally filtered strictly by session)
  const loadCandidateEvents = useCallback(
    (cid: string, sid?: string) => {
      const param = sid && sid !== "all" ? `?session_id=${encodeURIComponent(sid)}` : "";
      api(`/api/candidates/${cid}/events${param}`, t)
        .then((res) => {
          setCandLogs(res);
        })
        .catch(() => {
          setCandLogs([]);
        });
    },
    [t]
  );

  // Load candidate sessions list
  const loadCandidateSessions = useCallback(
    (cid: string, preferredSid?: string) => {
      api(`/api/candidates/${cid}/sessions`, t)
        .then((sessions: SessionInfo[]) => {
          setCandSessions(sessions || []);
          if (sessions && sessions.length > 0) {
            let target = preferredSid && preferredSid !== "latest" ? preferredSid : "";
            if (!target || target === "latest") {
              const active = sessions.find((s) => s.status === "ACTIVE");
              target = active ? active.session_id : sessions[0].session_id;
            }
            setSelectedSessionId(target);
            setFullLogsSessionId(target);
            loadCandidateEvents(cid, target);
          } else {
            setSelectedSessionId("all");
            setFullLogsSessionId("all");
            loadCandidateEvents(cid, "all");
          }
        })
        .catch(() => {
          setCandSessions([]);
          loadCandidateEvents(cid, "all");
        });
    },
    [t, loadCandidateEvents]
  );

  const [isDeletingSession, setIsDeletingSession] = useState(false);

  const handleDeleteSession = async (sessionIdToDelete: string, candidateId: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete session "${sessionIdToDelete}" and all its logged events?`)) {
      return;
    }
    setIsDeletingSession(true);
    try {
      await deleteSession(sessionIdToDelete, t);
      await loadCandidateSessions(candidateId, "latest");
      loadLive();
    } catch {
      alert("Failed to delete session. Please try again.");
    } finally {
      setIsDeletingSession(false);
    }
  };

  const handleClearAllSessions = async (candidateId: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete ALL sessions and event history for ${candidateId}? This action cannot be undone.`)) {
      return;
    }
    setIsDeletingSession(true);
    try {
      await deleteCandidateSessions(candidateId, t);
      setCandSessions([]);
      setCandLogs([]);
      setSelectedSessionId("all");
      setFullLogsSessionId("all");
      loadLive();
    } catch {
      alert("Failed to clear sessions. Please try again.");
    } finally {
      setIsDeletingSession(false);
    }
  };

  // Load logs for logs tab
  const loadLogs = useCallback(() => {
    const p = new URLSearchParams({
      page: String(page),
      order,
      ...(filterCandInLogs !== "all" && { candidate_id: filterCandInLogs }),
      ...(filterSessionInLogs !== "all" && { session_id: filterSessionInLogs }),
      ...(type && { event_type: type }),
      ...(sev && { severity: sev }),
      ...(from && { date_from: from }),
      ...(q && { q })
    });
    api(`/api/events?${p}`, t).then(setLogs).catch(() => { });
  }, [t, page, filterCandInLogs, filterSessionInLogs, type, sev, from, q, order]);

  useEffect(() => {
    loadLive();
  }, [loadLive]);

  useEffect(() => {
    if (tab === "logs") loadLogs();
  }, [tab, loadLogs]);

  useEffect(() => {
    if (tab === "reports") {
      api("/api/reports/exam/EXAM-001", t).then(setReport).catch(() => { });
    }
  }, [tab, t]);

  const loadExams = useCallback(async () => {
    setIsLoadingExams(true);
    try {
      const data = await getExams(t);
      setExamsList(data || []);
    } catch (err) {
      console.error("Failed to load assessments:", err);
    } finally {
      setIsLoadingExams(false);
    }
  }, [t]);

  useEffect(() => {
    if (tab === "assessments") {
      loadExams();
    }
  }, [tab, loadExams]);

  const handleCopyCandidateLink = (examId: string) => {
    const url = `${window.location.origin}/?exam=${encodeURIComponent(examId)}`;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        setCopiedExamId(examId);
        setTimeout(() => setCopiedExamId(null), 2500);
      });
    }
  };

  const handleCreateExamSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExamTitle.trim()) {
      alert("Please provide an assessment title.");
      return;
    }
    if (newExamQuestions.length === 0) {
      alert("Please add at least one question.");
      return;
    }
    try {
      await createExam(
        {
          exam_id: newExamId.trim() || undefined,
          title: newExamTitle.trim(),
          description: newExamDesc.trim(),
          duration_minutes: Number(newExamDuration) || 30,
          settings: newExamSettings,
          questions: newExamQuestions
        },
        t
      );
      setIsCreateExamOpen(false);
      setNewExamTitle("");
      setNewExamId("");
      setNewExamDesc("");
      setNewExamDuration(30);
      loadExams();
    } catch (err: any) {
      alert("Failed to create assessment: " + (err.message || err));
    }
  };

  const handleDeleteExam = async (examId: string) => {
    if (!confirm(`Are you sure you want to delete assessment ${examId}? Candidates will no longer be able to take it.`)) {
      return;
    }
    try {
      await deleteExam(examId, t);
      loadExams();
    } catch (err: any) {
      alert("Failed to delete assessment: " + (err.message || err));
    }
  };

  const addQuestion = (type: "mcq" | "text") => {
    const nextId = newExamQuestions.length > 0 ? Math.max(...newExamQuestions.map((q) => q.id)) + 1 : 1;
    if (type === "mcq") {
      setNewExamQuestions((prev) => [
        ...prev,
        {
          id: nextId,
          title: `Question ${nextId}`,
          type: "mcq",
          options: ["Option A", "Option B", "Option C", "Option D"]
        }
      ]);
    } else {
      setNewExamQuestions((prev) => [
        ...prev,
        {
          id: nextId,
          title: `Question ${nextId}: Explain...`,
          type: "text"
        }
      ]);
    }
  };

  const updateQuestion = (idx: number, updated: Partial<ExamQuestion>) => {
    setNewExamQuestions((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], ...updated };
      return copy;
    });
  };

  const removeQuestion = (idx: number) => {
    setNewExamQuestions((prev) => prev.filter((_, i) => i !== idx));
  };

  const loadTemplate = (type: "fullstack" | "backend" | "python") => {
    if (type === "fullstack") {
      setNewExamTitle("Full-Stack Software Engineer Assessment");
      setNewExamDesc("Comprehensive evaluation testing React, REST/GraphQL APIs, relational database design, and cloud architecture.");
      setNewExamDuration(45);
      setNewExamQuestions([
        {
          id: 1,
          title: "Explain the differences between Server-Side Rendering (SSR), Client-Side Rendering (CSR), and Static Site Generation (SSG), including their impact on Core Web Vitals.",
          type: "text"
        },
        {
          id: 2,
          title: "Which HTTP status code should be returned when a resource is successfully created via a POST request?",
          type: "mcq",
          options: ["200 OK", "201 Created", "202 Accepted", "204 No Content"]
        },
        {
          id: 3,
          title: "In React 18, what is the primary purpose of the useDeferredValue hook?",
          type: "mcq",
          options: [
            "To defer updating a non-urgent part of the UI to keep input responsive",
            "To execute a side effect after the component has completely unmounted",
            "To cache expensive calculation results across server requests",
            "To automatically debounce API calls triggered by text inputs"
          ]
        },
        {
          id: 4,
          title: "How do database indexes (B-Tree vs Hash) affect read vs write query throughput in high-concurrency systems?",
          type: "text"
        }
      ]);
    } else if (type === "backend") {
      setNewExamTitle("Distributed Backend & Systems Engineering Test");
      setNewExamDesc("Senior backend assessment focusing on concurrency, database indexing, caching strategies, and API security.");
      setNewExamDuration(60);
      setNewExamQuestions([
        {
          id: 1,
          title: "Describe how you prevent race conditions and handle distributed locking in a microservices environment without sacrificing horizontal scalability.",
          type: "text"
        },
        {
          id: 2,
          title: "Which isolation level guarantees the highest consistency and completely prevents phantom reads in SQL databases?",
          type: "mcq",
          options: ["Read Committed", "Repeatable Read", "Serializable", "Read Uncommitted"]
        },
        {
          id: 3,
          title: "What is the primary mechanism Redis uses to manage cache eviction under memory constraints?",
          type: "mcq",
          options: ["LRU / LFU algorithms with maxmemory policies", "Automatic disk spilling", "JVM Garbage Collection", "Two-phase commit rollbacks"]
        }
      ]);
    } else if (type === "python") {
      setNewExamTitle("Python Core & Asynchronous Systems Assessment");
      setNewExamDesc("Evaluation of Python internals, GIL constraints, asyncio event loop, and FastAPI/Pydantic architecture.");
      setNewExamDuration(40);
      setNewExamQuestions([
        {
          id: 1,
          title: "Explain how Python's Global Interpreter Lock (GIL) affects multi-threaded vs multi-process execution, and how asyncio achieves high I/O concurrency.",
          type: "text"
        },
        {
          id: 2,
          title: "In Python, which built-in data type has amortized O(1) lookup and insertion time?",
          type: "mcq",
          options: ["dict", "list", "tuple", "collections.deque"]
        },
        {
          id: 3,
          title: "What is the difference between a generator and a normal function in Python?",
          type: "mcq",
          options: [
            "A generator yields values lazily one at a time and maintains state, while a function returns once",
            "Generators cannot be iterated over using a for loop",
            "Generators run on a separate OS thread automatically",
            "Functions cannot take keyword arguments whereas generators can"
          ]
        }
      ]);
    }
  };

  useEffect(() => {
    if (selectedCand) {
      loadCandidateSessions(selectedCand, "latest");
    }
  }, [selectedCand, loadCandidateSessions]);

  useEffect(() => {
    if (viewingFullLogsCand) {
      loadCandidateSessions(viewingFullLogsCand, "latest");
    }
  }, [viewingFullLogsCand, loadCandidateSessions]);

  // WebSocket for real-time live events
  useEffect(() => {
    let ws: WebSocket;
    let retry = 0;
    let dead = false;

    const open = () => {
      try {
        ws = new WebSocket(`${WS}/ws/proctor?token=${t}`);
        ws.onopen = () => {
          retry = 0;
        };
        ws.onmessage = () => {
          loadLive();
          const targetCand = viewingFullLogsCand || selectedCand;
          if (targetCand) {
            loadCandidateSessions(targetCand, selectedSessionId);
          }
        };
        ws.onclose = () => {
          if (!dead) setTimeout(open, Math.min(30000, 1000 * 2 ** retry++));
        };
      } catch { }
    };

    open();
    return () => {
      dead = true;
      ws?.close();
    };
  }, [t, loadLive, selectedCand, viewingFullLogsCand, selectedSessionId, loadCandidateSessions]);

  // Event icon helper
  const getEventIcon = (eventType: string, severity: string) => {
    const s = severity?.toUpperCase();
    if (eventType === "BROWSER_EXTENSIONS_DETECTED" || eventType.includes("EXTENSION")) {
      return <Puzzle className="w-4 h-4 text-purple-600" />;
    }
    if (eventType === "SIDEBAR_DETECTED" || eventType.includes("SIDEBAR")) {
      return <Columns className="w-4 h-4 text-rose-600" />;
    }
    if (eventType === "SCREENSHOT_ATTEMPT" || eventType.includes("SCREENSHOT")) {
      return <Camera className="w-4 h-4 text-rose-600" />;
    }
    if (eventType === "ALT_TAB" || eventType === "WINDOW_SWITCH" || eventType.includes("ALT")) {
      return <AlertTriangle className="w-4 h-4 text-rose-600" />;
    }
    if (eventType === "TAB_SWITCH" || eventType === "WINDOW_FOCUS_LOST") {
      return <AlertTriangle className="w-4 h-4 text-rose-500" />;
    }
    if (eventType === "FULLSCREEN_EXIT") {
      return <Maximize className="w-4 h-4 text-rose-600" />;
    }
    if (eventType.includes("COPY") || eventType.includes("PASTE") || eventType.includes("CLIPBOARD")) {
      return <Copy className="w-4 h-4 text-amber-500" />;
    }
    if (eventType === "EXAM_STOPPED") {
      return <StopCircle className="w-4 h-4 text-rose-600" />;
    }
    if (eventType.includes("KEYBOARD") || eventType.includes("SHORTCUT")) {
      return <Keyboard className="w-4 h-4 text-amber-500" />;
    }
    if (eventType.includes("CLICK")) {
      return <MousePointer className="w-4 h-4 text-blue-500" />;
    }
    if (s === "HIGH" || s === "MEDIUM") {
      return <AlertTriangle className="w-4 h-4 text-amber-500" />;
    }
    return <Monitor className="w-4 h-4 text-slate-500" />;
  };

  const formatEventName = (t: string) => {
    if (t === "BROWSER_EXTENSIONS_DETECTED") return "Browser Extensions Detected";
    if (t === "SIDEBAR_DETECTED") return "AI Sidebar / Split-Screen Detected";
    if (t === "SIDEBAR_CLOSED") return "AI Sidebar Closed";
    if (t === "SCREENSHOT_ATTEMPT") return "Screenshot / OCR Attempt Blocked";
    if (t === "PASTE_ATTEMPT") return "Unauthorized Paste Attempt Blocked";
    if (t === "COPY_ATTEMPT") return "Unauthorized Copy Attempt Blocked";
    if (t === "CLIPBOARD_VIOLATION") return "Clipboard Violation Blocked";
    if (t === "AI_COPILOT_SHORTCUT") return "AI Copilot Shortcut Intercepted";
    if (t === "RIGHT_CLICK") return "Right-Click / Google Lens Blocked";
    if (t === "ALT_TAB") return "Alt + Tab Switch";
    if (t === "WINDOW_SWITCH") return "Window Switch (Win+Tab)";
    return t
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return ts;
    }
  };

  const formatDate = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return "";
    }
  };

  // Full candidate list merging backend with demo pool for rich proctoring
  const fullCandidatesList = [
    ...cands,
    ...(cands.every((c) => c.candidate_id !== "CAND_1004")
      ? [
        {
          candidate_id: "CAND_1004",
          name: "Alice Vance",
          status: "ACTIVE",
          alert_count: 3,
          last_activity: "Tab switch (2m ago)",
          network: "STABLE",
          latency_ms: 38
        },
        {
          candidate_id: "CAND_1005",
          name: "David Miller",
          status: "ACTIVE",
          alert_count: 1,
          last_activity: "Fullscreen exit (5m ago)",
          network: "STABLE",
          latency_ms: 45
        },
        {
          candidate_id: "CAND_1006",
          name: "Sarah Chen",
          status: "ACTIVE",
          alert_count: 0,
          last_activity: null,
          network: "STABLE",
          latency_ms: 41
        }
      ]
      : [])
  ];

  const filteredCandidates = fullCandidatesList.filter((c) => {
    if (!q) return true;
    return (
      c.candidate_id.toLowerCase().includes(q.toLowerCase()) ||
      (c.name && c.name.toLowerCase().includes(q.toLowerCase()))
    );
  });

  const activeCandidateObj = fullCandidatesList.find((c) => c.candidate_id === (viewingFullLogsCand || selectedCand)) || fullCandidatesList[0];
  const activeSessionObj = candSessions.find((s) => s.session_id === (viewingFullLogsCand ? fullLogsSessionId : selectedSessionId)) || candSessions[0];

  // Demo fallback logs if candidate has no events logged yet
  const getCandidateDisplayEvents = (cid: string, sid?: string) => {
    if (cid === selectedCand && candLogs.length > 0) return candLogs;
    const targetSid = sid && sid !== "all" ? sid : "SESS-DEMO-01";
    return [
      {
        event_id: "demo-1",
        session_id: targetSid,
        candidate_id: cid,
        exam_id: "EXAM-001",
        event_type: "EXAM_STARTED",
        event_category: "SESSION",
        severity: "INFO",
        detection_source: "candidate_action",
        confidence: "CONFIRMED",
        event_description: "Candidate accepted proctoring terms and initiated the examination session",
        timestamp: new Date(Date.now() - 1000 * 60 * 35).toISOString()
      },
      {
        event_id: "demo-2",
        session_id: targetSid,
        candidate_id: cid,
        exam_id: "EXAM-001",
        event_type: "ALT_TAB",
        event_category: "FOCUS",
        severity: "HIGH",
        detection_source: "alt_tab_shortcut",
        confidence: "CONFIRMED",
        event_description: "Alt + Tab window-switch shortcut detected — switched away from examination",
        metadata: { shortcut: "Alt+Tab" },
        duration: 3.2,
        timestamp: new Date(Date.now() - 1000 * 60 * 18).toISOString()
      },
      {
        event_id: "demo-3",
        session_id: targetSid,
        candidate_id: cid,
        exam_id: "EXAM-001",
        event_type: "FULLSCREEN_EXIT",
        event_category: "FULLSCREEN",
        severity: "HIGH",
        detection_source: "fullscreenchange",
        confidence: "CONFIRMED",
        event_description: "Exited fullscreen mode — Answering locked",
        timestamp: new Date(Date.now() - 1000 * 60 * 12).toISOString()
      },
      {
        event_id: "demo-4",
        session_id: targetSid,
        candidate_id: cid,
        exam_id: "EXAM-001",
        event_type: "COPY_ATTEMPT",
        event_category: "CLIPBOARD",
        severity: "MEDIUM",
        detection_source: "clipboard",
        confidence: "CONFIRMED",
        event_description: "Ctrl + C keyboard shortcut detected",
        metadata: { shortcut: "Ctrl+C" },
        timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString()
      },
      {
        event_id: "demo-5",
        session_id: targetSid,
        candidate_id: cid,
        exam_id: "EXAM-001",
        event_type: "WINDOW_FOCUS_REGAINED",
        event_category: "FOCUS",
        severity: "INFO",
        detection_source: "window_focus",
        confidence: "CONFIRMED",
        event_description: "Returned to the examination window",
        duration: 1.1,
        timestamp: new Date(Date.now() - 1000 * 60 * 2).toISOString()
      }
    ];
  };

  const sortDesc = (a: Ev, b: Ev) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();

  const displayEvents: Ev[] = [
    ...(candLogs.length > 0 ? candLogs : getCandidateDisplayEvents(selectedCand, selectedSessionId))
  ].sort(sortDesc);

  // Filtered events for the dedicated Full Logs page (respects session filter, latest on top)
  const fullLogsList = [
    ...(viewingFullLogsCand && candLogs.length > 0
      ? candLogs
      : getCandidateDisplayEvents(viewingFullLogsCand || selectedCand, fullLogsSessionId))
  ]
    .filter((e) => {
      if (fullLogsSessionId && fullLogsSessionId !== "all" && e.session_id && e.session_id !== fullLogsSessionId) return false;
      if (fullLogsSev && e.severity !== fullLogsSev) return false;
      if (fullLogsType && e.event_type !== fullLogsType) return false;
      if (fullLogsSearch) {
        const query = fullLogsSearch.toLowerCase();
        return (
          e.event_type.toLowerCase().includes(query) ||
          e.event_description.toLowerCase().includes(query) ||
          e.detection_source.toLowerCase().includes(query) ||
          (e.session_id && e.session_id.toLowerCase().includes(query))
        );
      }
      return true;
    })
    .sort(sortDesc);

  return (
    <div className="flex h-screen bg-slate-100 font-sans text-slate-900 overflow-hidden">
      {/* Left Dark Sidebar */}
      <aside className="w-60 bg-slate-900 text-slate-300 flex flex-col flex-shrink-0 z-20">
        {/* Brand */}
        <div className="h-16 px-6 flex items-center gap-3 border-b border-slate-800">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
            <Shield className="w-5 h-5 stroke-[2.2]" />
          </div>
          <span className="font-bold text-lg text-white tracking-tight">ExamShield</span>
        </div>

        {/* Navigation items */}
        <nav className="p-4 space-y-1.5 flex-1">
          <button
            onClick={() => {
              setViewingFullLogsCand(null);
              setTab("dashboard");
            }}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${tab === "dashboard" && !viewingFullLogsCand ? "bg-blue-600 text-white" : "hover:bg-slate-800 text-slate-300 hover:text-white"
              }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>Dashboard</span>
          </button>

          <button
            onClick={() => {
              setViewingFullLogsCand(null);
              setTab("assessments");
            }}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${tab === "assessments" && !viewingFullLogsCand ? "bg-blue-600 text-white shadow-md shadow-blue-600/20" : "hover:bg-slate-800 text-slate-300 hover:text-white"
              }`}
          >
            <Layers className="w-4 h-4" />
            <span>Assessments</span>
          </button>

          <button
            onClick={() => {
              setViewingFullLogsCand(null);
              setTab("live");
            }}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${tab === "live" && !viewingFullLogsCand ? "bg-blue-600 text-white shadow-md shadow-blue-600/20" : "hover:bg-slate-800 text-slate-300 hover:text-white"
              }`}
          >
            <Radio className="w-4 h-4" />
            <span>Live Monitoring</span>
          </button>

          <button
            onClick={() => {
              setViewingFullLogsCand(null);
              setTab("logs");
            }}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${tab === "logs" && !viewingFullLogsCand ? "bg-blue-600 text-white shadow-md shadow-blue-600/20" : "hover:bg-slate-800 text-slate-300 hover:text-white"
              }`}
          >
            <FileText className="w-4 h-4" />
            <span>Activity Logs</span>
          </button>

          <button
            onClick={() => {
              setViewingFullLogsCand(null);
              setTab("reports");
            }}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${tab === "reports" && !viewingFullLogsCand ? "bg-blue-600 text-white" : "hover:bg-slate-800 text-slate-300 hover:text-white"
              }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Reports</span>
          </button>

          <button
            onClick={() => {
              setViewingFullLogsCand(null);
              setTab("settings");
            }}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${tab === "settings" && !viewingFullLogsCand ? "bg-blue-600 text-white" : "hover:bg-slate-800 text-slate-300 hover:text-white"
              }`}
          >
            <Settings className="w-4 h-4" />
            <span>Settings</span>
          </button>
        </nav>

        {/* User Card & Logout */}
        <div className="p-4 border-t border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5 truncate">
            <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-xs text-blue-400">
              {auth.name.charAt(0)}
            </div>
            <div className="truncate">
              <div className="text-xs font-semibold text-white truncate">{auth.name}</div>
              <div className="text-[10px] text-slate-400 capitalize">{auth.role}</div>
            </div>
          </div>
          <button
            onClick={() => onLogout?.()}
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
            title="Sign Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="h-16 bg-white border-b border-slate-200/80 px-6 flex items-center justify-between gap-4 flex-shrink-0 z-10">
          <div className="flex items-center gap-4">
            {viewingFullLogsCand ? (
              <button
                onClick={() => setViewingFullLogsCand(null)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-all cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            ) : null}

            <h1 className="text-lg font-bold text-slate-900 tracking-tight">
              {viewingFullLogsCand
                ? `Full Activity Log — ${viewingFullLogsCand}`
                : tab === "assessments"
                  ? "Assessment Studio"
                  : tab === "live"
                    ? "Live Monitoring"
                    : tab === "logs"
                      ? "Candidate Activity Logs"
                      : tab === "reports"
                        ? "Assessment Reports"
                        : tab === "settings"
                          ? "Exam Configuration"
                          : "Dashboard"}
            </h1>

            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Exam — Data Structures ({fullCandidatesList.length} candidates)</span>
            </div>
          </div>

          {/* Quick Search */}
          {!viewingFullLogsCand && (
            <div className="relative w-72 sm:w-80">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search candidate (ID / name)..."
                className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all"
              />
            </div>
          )}
        </header>

        {/* View Content */}
        <div className="flex-1 p-6 overflow-hidden bg-slate-50/60">
          {/* ============================================================== */}
          {/* VIEW: DEDICATED FULL LOGS PAGE (PROPERLY LAYOUTED FULL AUDIT)  */}
          {/* ============================================================== */}
          {viewingFullLogsCand ? (
            <div className="flex flex-col h-[calc(100vh-7.5rem)] space-y-4">
              {/* Candidate Info Card */}
              <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-wrap items-center justify-between gap-4 flex-shrink-0">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-bold text-base shadow-sm">
                    {activeCandidateObj?.name?.charAt(0) || "C"}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-slate-900">{activeCandidateObj?.name || "Candidate"}</h2>
                      <span className="text-xs font-mono font-semibold text-blue-600 bg-blue-50 border border-blue-200/70 px-2 py-0.5 rounded-md">
                        {viewingFullLogsCand}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        {activeCandidateObj?.status === "STOPPED" ? "Stopped" : "Active Session"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Exam: Data Structures Assessment (EXAM-001) • Complete Historical Audit Trail
                    </p>
                  </div>
                </div>

                {/* Counters and Quick Actions */}
                <div className="flex items-center gap-3">
                  <div className="text-center px-3.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="text-base font-bold text-slate-800">{fullLogsList.length}</div>
                    <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Total Events</div>
                  </div>

                  <div className="text-center px-3.5 py-1.5 bg-rose-50 border border-rose-200/80 rounded-xl">
                    <div className="text-base font-bold text-rose-600">
                      {fullLogsList.filter((e) => e.severity === "HIGH" || e.severity === "MEDIUM").length}
                    </div>
                    <div className="text-[10px] text-rose-600/80 font-semibold uppercase tracking-wider">Alerts Flagged</div>
                  </div>

                  <button
                    onClick={() => openAIAuditModal(viewingFullLogsCand, fullLogsSessionId)}
                    className="px-3.5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                    title="Run AI Proctor Telemetry Audit"
                  >
                    <Bot className="w-3.5 h-3.5" />
                    <span>AI Audit</span>
                  </button>

                  <button
                    onClick={() => openExtensionsModal(viewingFullLogsCand)}
                    className="px-3.5 py-2.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer"
                    title="Inspect candidate installed browser extensions"
                  >
                    <Puzzle className="w-3.5 h-3.5 text-purple-600" />
                    <span>Extensions</span>
                  </button>

                  <button
                    onClick={() => downloadCsv(t)}
                    className="px-3.5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export CSV</span>
                  </button>
                </div>
              </div>

              {/* Session Selector Toolbar */}
              <div className="bg-white border border-slate-200/80 rounded-2xl px-5 py-3 shadow-xs flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
                <div className="flex items-center gap-2 overflow-x-auto py-0.5">
                  <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5 mr-1 flex-shrink-0">
                    <Layers className="w-4 h-4 text-blue-600" />
                    <span>Exam Session:</span>
                  </span>

                  {candSessions.length > 0 ? (
                    candSessions.map((s, idx) => {
                      const isSel = fullLogsSessionId === s.session_id;
                      const sessNum = candSessions.length - idx;
                      return (
                        <button
                          key={s.session_id}
                          onClick={() => {
                            setFullLogsSessionId(s.session_id);
                            setSelectedSessionId(s.session_id);
                            loadCandidateEvents(viewingFullLogsCand, s.session_id);
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 flex-shrink-0 cursor-pointer ${isSel
                              ? "bg-blue-600 text-white shadow-xs"
                              : "bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200"
                            }`}
                        >
                          <span>Session {sessNum}</span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isSel
                                ? "bg-blue-500 text-white"
                                : s.status === "ACTIVE"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-slate-200 text-slate-600"
                              }`}
                          >
                            {s.status === "ACTIVE" ? "Active" : "Stopped"}
                          </span>
                          {s.alert_count > 0 && (
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isSel ? "bg-rose-500 text-white" : "bg-rose-100 text-rose-700"
                                }`}
                            >
                              {s.alert_count}
                            </span>
                          )}
                        </button>
                      );
                    })
                  ) : (
                    <span className="text-xs text-slate-400 italic">No session history</span>
                  )}

                  <button
                    onClick={() => {
                      setFullLogsSessionId("all");
                      setSelectedSessionId("all");
                      loadCandidateEvents(viewingFullLogsCand, "all");
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1 flex-shrink-0 cursor-pointer ${fullLogsSessionId === "all"
                        ? "bg-blue-600 text-white shadow-xs"
                        : "bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200"
                      }`}
                  >
                    <span>All Sessions</span>
                  </button>

                  {candSessions.length > 0 && (
                    <button
                      type="button"
                      onClick={() => handleClearAllSessions(viewingFullLogsCand || selectedCand)}
                      disabled={isDeletingSession}
                      className="px-2.5 py-1.5 rounded-xl text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-all flex items-center gap-1 flex-shrink-0 cursor-pointer shadow-2xs"
                      title="Permanently clear all session history for this candidate"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                      <span>Clear All Sessions</span>
                    </button>
                  )}
                </div>

                {activeSessionObj && fullLogsSessionId !== "all" && (
                  <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-blue-600 font-semibold">{activeSessionObj.session_id}</span>
                      <span>Started: <strong className="text-slate-700">{activeSessionObj.start_time ? formatTime(activeSessionObj.start_time) : "N/A"}</strong></span>
                      {activeSessionObj.end_time && (
                        <span>Ended: <strong className="text-slate-700">{formatTime(activeSessionObj.end_time)}</strong></span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteSession(activeSessionObj.session_id, viewingFullLogsCand || selectedCand)}
                      disabled={isDeletingSession}
                      className="px-2.5 py-1 text-xs text-rose-600 hover:text-white hover:bg-rose-600 bg-rose-50 border border-rose-200 rounded-lg font-semibold flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                      title="Permanently delete this session and its logs"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Session</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Filter Toolbar */}
              <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
                <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[300px]">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={fullLogsSearch}
                      onChange={(e) => setFullLogsSearch(e.target.value)}
                      placeholder="Search event, description, shortcut..."
                      className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                    />
                  </div>

                  <select
                    value={fullLogsSev}
                    onChange={(e) => setFullLogsSev(e.target.value)}
                    className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                  >
                    <option value="">All Severities</option>
                    <option value="HIGH">High Severity</option>
                    <option value="MEDIUM">Medium Severity</option>
                    <option value="INFO">Info Severity</option>
                  </select>

                  <select
                    value={fullLogsType}
                    onChange={(e) => setFullLogsType(e.target.value)}
                    className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                  >
                    <option value="">All Event Types</option>
                    <option value="TAB_SWITCH">Tab Switch</option>
                    <option value="FULLSCREEN_EXIT">Fullscreen Exit</option>
                    <option value="COPY_ATTEMPT">Copy Attempt</option>
                    <option value="EXAM_STARTED">Exam Started</option>
                    <option value="EXAM_STOPPED">Exam Stopped</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => loadCandidateEvents(viewingFullLogsCand)}
                    className="px-3 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
                    <span>Refresh</span>
                  </button>
                </div>
              </div>

              {/* Full Logs Layouted Cards List */}
              <div className="flex-1 bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden flex flex-col">
                <div className="p-3.5 px-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between text-xs font-semibold text-slate-600">
                  <span>Chronological Audit Trail</span>
                  <span>Showing {fullLogsList.length} Records</span>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                  {fullLogsList.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 text-xs">
                      No logs found matching the selected filters.
                    </div>
                  ) : (
                    fullLogsList.map((e, idx) => {
                      const isAlert = e.severity === "HIGH" || e.event_type === "TAB_SWITCH" || e.event_type === "FULLSCREEN_EXIT";
                      const isWarning = e.severity === "MEDIUM" || e.event_type.includes("COPY");

                      let cardStyle = "border-slate-200/80 bg-white hover:border-slate-300";
                      let badgeStyle = "bg-slate-100 text-slate-700";
                      let titleStyle = "text-slate-900";

                      if (isAlert) {
                        cardStyle = "border-rose-200 bg-rose-50/20 hover:border-rose-300";
                        badgeStyle = "bg-rose-100 text-rose-700 border border-rose-200";
                        titleStyle = "text-rose-700 font-bold";
                      } else if (isWarning) {
                        cardStyle = "border-amber-200 bg-amber-50/20 hover:border-amber-300";
                        badgeStyle = "bg-amber-100 text-amber-800 border border-amber-200";
                        titleStyle = "text-amber-800 font-bold";
                      }

                      return (
                        <div
                          key={e.event_id || idx}
                          className={`p-4 rounded-xl border transition-all shadow-2xs space-y-2.5 ${cardStyle}`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              {getEventIcon(e.event_type, e.severity)}
                              <span className={`text-sm ${titleStyle}`}>{formatEventName(e.event_type)}</span>
                              <span className="text-xs text-slate-400 font-mono">({e.event_type})</span>
                            </div>

                            <div className="flex items-center gap-2.5">
                              <span className="text-xs text-slate-500 font-mono flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5 text-slate-400" />
                                {formatTime(e.timestamp)}
                              </span>
                              <span className="text-xs text-slate-400 flex items-center gap-1">
                                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                {formatDate(e.timestamp)}
                              </span>
                              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${badgeStyle}`}>
                                {e.severity}
                              </span>
                            </div>
                          </div>

                          <div className="text-xs text-slate-800 leading-relaxed font-medium">
                            {e.event_description}
                          </div>

                          {e.metadata?.extensions && Array.isArray(e.metadata.extensions) && (
                            <div className="mt-1 pt-1.5 border-t border-slate-100 flex flex-wrap gap-1.5">
                              {e.metadata.extensions.map((ext: any, i: number) => (
                                <span
                                  key={i}
                                  className={`px-2 py-0.5 rounded-md text-[11px] font-medium flex items-center gap-1 ${
                                    ext.risk === "HIGH"
                                      ? "bg-rose-100 text-rose-800 border border-rose-200"
                                      : ext.risk === "MEDIUM"
                                      ? "bg-amber-100 text-amber-800 border border-amber-200"
                                      : "bg-slate-100 text-slate-700 border border-slate-200"
                                  }`}
                                >
                                  <Puzzle className="w-3 h-3" />
                                  <span>{ext.name}</span>
                                  <span className="text-[9px] uppercase font-bold opacity-75">({ext.risk})</span>
                                </span>
                              ))}
                            </div>
                          )}

                          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between text-[11px] text-slate-500 gap-2">
                            <div className="flex items-center gap-3">
                              <span>Source: <strong className="text-slate-700">{e.detection_source}</strong></span>
                              <span>Confidence: <strong className="text-slate-700">{e.confidence}</strong></span>
                              {e.duration && (
                                <span>Duration: <strong className="text-slate-700">{e.duration.toFixed(1)}s</strong></span>
                              )}
                              {e.metadata?.shortcut && (
                                <span>Shortcut: <strong className="text-slate-700">{e.metadata.shortcut}</strong></span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {e.session_id && (
                                <span className="text-[10px] text-blue-700 bg-blue-50 border border-blue-200/70 font-mono px-2 py-0.5 rounded font-semibold">
                                  {e.session_id}
                                </span>
                              )}
                              <span className="text-[10px] text-slate-400 font-mono">ID: {e.event_id}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {/* ============================================================== */}
          {/* TAB 1: LIVE MONITORING (SYMMETRICAL 50/50 VIEW)                 */}
          {/* ============================================================== */}
          {tab === "live" && !viewingFullLogsCand && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[calc(100vh-7.5rem)]">
              {/* Left Panel: Candidates List */}
              <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs flex flex-col overflow-hidden h-full">
                {/* Panel Header */}
                <div className="p-4 sm:px-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-600" />
                    <h2 className="font-bold text-slate-900 text-xs sm:text-sm">Enrolled Candidates ({filteredCandidates.length})</h2>
                  </div>
                  <span className="text-[11px] text-slate-500 font-medium">Click a candidate to view logs</span>
                </div>

                {/* Candidate Rows (Scrollable) */}
                <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                  {filteredCandidates.map((c, idx) => {
                    const isSelected = selectedCand === c.candidate_id;
                    const alertCount = c.alert_count ?? 0;
                    return (
                      <div
                        key={c.candidate_id}
                        onClick={() => {
                          setSelectedCand(c.candidate_id);
                          loadCandidateSessions(c.candidate_id, "latest");
                        }}
                        className={`p-4 flex items-center justify-between gap-3 transition-all cursor-pointer ${isSelected
                          ? "bg-blue-50/60 border-l-4 border-l-blue-600 shadow-xs"
                          : "hover:bg-slate-50/80 border-l-4 border-l-transparent"
                          }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0 ${isSelected ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
                            }`}>
                            {idx + 1}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900 text-xs sm:text-sm truncate">{c.candidate_id}</span>
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60">
                                <span className="w-1 h-1 rounded-full bg-emerald-500" />
                                {c.status === "STOPPED" ? "Stopped" : "Active"}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500 truncate">{c.name || "Candidate"}</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5 flex-shrink-0">
                          {/* Alert badge */}
                          <div className="text-center mr-1">
                            <span
                              className={`inline-flex items-center justify-center min-w-[24px] h-6 px-2 rounded-full text-xs font-bold ${alertCount >= 3
                                ? "bg-rose-100 text-rose-700 border border-rose-200"
                                : alertCount > 0
                                  ? "bg-amber-100 text-amber-800 border border-amber-200"
                                  : "bg-slate-100 text-slate-500"
                                }`}
                              title={`${alertCount} flagged events`}
                            >
                              {alertCount}
                            </span>
                            <div className="text-[10px] text-slate-400 font-medium">Alerts</div>
                          </div>

                          {/* Browser Extensions Button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openExtensionsModal(c.candidate_id);
                            }}
                            className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs ${
                              c.has_high_risk_extensions
                                ? "bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100"
                                : (c.extensions_count ?? 0) > 0
                                ? "bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100"
                                : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                            }`}
                            title="Inspect installed browser extensions"
                          >
                            <Puzzle className="w-3.5 h-3.5" />
                            <span>{(c.extensions_count ?? 0) > 0 ? `${c.extensions_count} Ext` : "Extensions"}</span>
                          </button>

                          {/* AI Proctor Telemetry Audit Button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openAIAuditModal(c.candidate_id, c.session_id);
                            }}
                            className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs ${
                              c.ai_verdict === "HIGH_RISK"
                                ? "bg-rose-50 border-rose-300 text-rose-700 hover:bg-rose-100"
                                : c.ai_verdict === "SUSPICIOUS"
                                ? "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100"
                                : c.ai_verdict === "CLEAN"
                                ? "bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                                : "bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100"
                            }`}
                            title="Run AI Behavioral Telemetry Audit (Prompt-Injection Immune)"
                          >
                            <Bot className="w-3.5 h-3.5" />
                            <span>{c.ai_risk_score !== null && c.ai_risk_score !== undefined ? `AI: ${c.ai_risk_score}` : "AI Audit"}</span>
                          </button>

                          {/* Dedicated View Full Logs Button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCand(c.candidate_id);
                              loadCandidateSessions(c.candidate_id, "latest");
                              setViewingFullLogsCand(c.candidate_id);
                            }}
                            className="px-3 py-1.5 rounded-xl border border-blue-300 text-blue-600 hover:bg-blue-50 text-xs font-semibold transition-all flex items-center gap-1 bg-white cursor-pointer shadow-2xs"
                            title="View full layouted activity logs"
                          >
                            <span>View Full Logs</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Panel: Selected Candidate's Activity Log */}
              <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs flex flex-col overflow-hidden h-full">
                {/* Panel Header */}
                <div className="p-4 sm:px-5 border-b border-slate-100 bg-slate-50/50 flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
                      <User className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="font-bold text-slate-900 text-xs sm:text-sm">
                          Activity Log — <span className="text-blue-600">{selectedCand}</span>
                        </h2>
                        <span className="text-[11px] font-semibold text-slate-500">
                          ({activeCandidateObj?.name || "Alice Candidate"})
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        {displayEvents.length} events logged • {displayEvents.filter((e) => e.severity === "HIGH" || e.severity === "MEDIUM").length} alerts
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openAIAuditModal(selectedCand, selectedSessionId)}
                      className="px-3 py-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                      title="Run AI Proctor Telemetry Audit"
                    >
                      <Bot className="w-3.5 h-3.5" />
                      <span>AI Audit</span>
                    </button>
                    <button
                      onClick={() => openExtensionsModal(selectedCand)}
                      className="px-3 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer"
                      title="Inspect candidate browser extensions"
                    >
                      <Puzzle className="w-3.5 h-3.5 text-purple-600" />
                      <span>Extensions</span>
                    </button>
                    <button
                      onClick={() => setViewingFullLogsCand(selectedCand)}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow-xs transition-all cursor-pointer"
                    >
                      <span>View Full Logs</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Session Segregation Pill Selector */}
                <div className="px-4 py-2.5 bg-slate-50/80 border-b border-slate-200/80 flex items-center justify-between gap-2 overflow-x-auto flex-shrink-0">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mr-1 flex-shrink-0">
                      <Layers className="w-3.5 h-3.5 text-blue-600" />
                      <span>Session:</span>
                    </span>

                    {candSessions.length > 0 ? (
                      candSessions.map((s, idx) => {
                        const isSel = selectedSessionId === s.session_id;
                        const sessNum = candSessions.length - idx;
                        return (
                          <button
                            key={s.session_id}
                            onClick={() => {
                              setSelectedSessionId(s.session_id);
                              loadCandidateEvents(selectedCand, s.session_id);
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 flex-shrink-0 cursor-pointer ${isSel
                                ? "bg-blue-600 text-white shadow-xs"
                                : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200"
                              }`}
                          >
                            <span>Session {sessNum}</span>
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isSel
                                  ? "bg-blue-500 text-white"
                                  : s.status === "ACTIVE"
                                    ? "bg-emerald-100 text-emerald-700"
                                    : "bg-slate-100 text-slate-600"
                                }`}
                            >
                              {s.status === "ACTIVE" ? "Active" : "Stopped"}
                            </span>
                            {s.alert_count > 0 && (
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isSel ? "bg-rose-500 text-white" : "bg-rose-100 text-rose-700"
                                  }`}
                              >
                                {s.alert_count}
                              </span>
                            )}
                          </button>
                        );
                      })
                    ) : (
                      <span className="text-xs text-slate-400 italic">No session recorded yet</span>
                    )}

                    <button
                      onClick={() => {
                        setSelectedSessionId("all");
                        loadCandidateEvents(selectedCand, "all");
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 flex-shrink-0 cursor-pointer ${selectedSessionId === "all"
                          ? "bg-blue-600 text-white shadow-xs"
                          : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
                        }`}
                    >
                      <span>All Sessions</span>
                    </button>

                    {candSessions.length > 0 && (
                      <button
                        type="button"
                        onClick={() => handleClearAllSessions(selectedCand)}
                        disabled={isDeletingSession}
                        className="px-2 py-1 rounded-lg text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-all flex items-center gap-1 flex-shrink-0 cursor-pointer shadow-2xs"
                        title="Permanently clear all session history for this candidate"
                      >
                        <Trash2 className="w-3 h-3 text-rose-500" />
                        <span>Clear All</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Session Details Stripe */}
                {activeSessionObj && selectedSessionId !== "all" && (
                  <div className="px-4 py-2 bg-blue-50/50 border-b border-blue-100/80 flex items-center justify-between text-xs flex-shrink-0">
                    <div className="flex items-center gap-2 text-slate-600 truncate">
                      <span className="font-mono font-semibold text-blue-700">{activeSessionObj.session_id}</span>
                      <span>•</span>
                      <span>Started: <strong>{activeSessionObj.start_time ? formatTime(activeSessionObj.start_time) : "N/A"}</strong></span>
                      {activeSessionObj.end_time && (
                        <>
                          <span>•</span>
                          <span>Stopped: <strong>{formatTime(activeSessionObj.end_time)}</strong></span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="text-[11px] font-bold text-slate-500">
                        {displayEvents.length} events • {displayEvents.filter((e) => e.severity === "HIGH" || e.severity === "MEDIUM").length} alerts
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteSession(activeSessionObj.session_id, selectedCand)}
                        disabled={isDeletingSession}
                        className="px-2 py-0.5 text-xs text-rose-600 hover:text-white hover:bg-rose-600 bg-white border border-rose-200 rounded-md font-semibold flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                        title="Permanently delete this session and its logs"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Log Event Cards (Scrollable) */}
                <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                  {displayEvents.map((e, i) => {
                    const isAlert = e.severity === "HIGH" || e.event_type === "TAB_SWITCH" || e.event_type === "FULLSCREEN_EXIT";
                    const isWarning = e.severity === "MEDIUM" || e.event_type.includes("COPY");

                    let borderClass = "border-slate-200/80 hover:border-slate-300 bg-white";
                    let textClass = "text-slate-800";
                    let badgeClass = "bg-slate-100 text-slate-600";

                    if (isAlert) {
                      borderClass = "border-rose-200 bg-rose-50/30 hover:border-rose-300";
                      textClass = "text-rose-700 font-bold";
                      badgeClass = "bg-rose-100 text-rose-700 border border-rose-200";
                    } else if (isWarning) {
                      borderClass = "border-amber-200 bg-amber-50/30 hover:border-amber-300";
                      textClass = "text-amber-800 font-bold";
                      badgeClass = "bg-amber-100 text-amber-800 border border-amber-200";
                    }

                    return (
                      <div
                        key={e.event_id || i}
                        className={`p-3.5 rounded-xl border transition-all shadow-2xs space-y-1.5 ${borderClass}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className={`flex items-center gap-2 text-xs ${textClass}`}>
                            {getEventIcon(e.event_type, e.severity)}
                            <span>{formatEventName(e.event_type)}</span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] text-slate-500 flex items-center gap-1">
                              <Clock className="w-3 h-3 text-slate-400" />
                              {formatTime(e.timestamp)}
                            </span>
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${badgeClass}`}>
                              {e.severity}
                            </span>
                          </div>
                        </div>

                        <div className="text-xs text-slate-700 font-medium">
                          {e.event_description}
                        </div>

                        {e.metadata?.extensions && Array.isArray(e.metadata.extensions) && (
                          <div className="mt-1 pt-1.5 border-t border-slate-100 flex flex-wrap gap-1.5">
                            {e.metadata.extensions.map((ext: any, extIdx: number) => (
                              <span
                                key={extIdx}
                                className={`px-2 py-0.5 rounded-md text-[10px] font-medium flex items-center gap-1 ${
                                  ext.risk === "HIGH"
                                    ? "bg-rose-100 text-rose-800 border border-rose-200"
                                    : ext.risk === "MEDIUM"
                                    ? "bg-amber-100 text-amber-800 border border-amber-200"
                                    : "bg-slate-100 text-slate-700 border border-slate-200"
                                }`}
                              >
                                <Puzzle className="w-2.5 h-2.5" />
                                <span>{ext.name}</span>
                                <span className="uppercase font-bold opacity-75">({ext.risk})</span>
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="pt-1 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-100/60">
                          <div className="flex items-center gap-2">
                            <span>Source: {e.detection_source}</span>
                            {e.session_id && (
                              <span className="font-mono text-[10px] text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded font-semibold">
                                {e.session_id}
                              </span>
                            )}
                          </div>
                          <span className="uppercase text-[10px] font-semibold text-slate-500">{e.confidence}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 2: ACTIVITY LOGS                                           */}
          {/* ============================================================== */}
          {tab === "logs" && !viewingFullLogsCand && (
            <div className="flex flex-col h-[calc(100vh-7.5rem)] space-y-4">
              <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
                <div className="flex items-center gap-2 overflow-x-auto py-1">
                  <span className="text-xs font-bold text-slate-700 flex items-center gap-1 mr-2 flex-shrink-0">
                    <Filter className="w-3.5 h-3.5 text-blue-600" />
                    <span>Filter Candidate:</span>
                  </span>

                  <button
                    onClick={() => {
                      setFilterCandInLogs("all");
                      setFilterSessionInLogs("all");
                      setPage(1);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex-shrink-0 ${filterCandInLogs === "all"
                      ? "bg-blue-600 text-white shadow-xs"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                  >
                    All Candidates
                  </button>

                  {fullCandidatesList.map((c) => (
                    <button
                      key={c.candidate_id}
                      onClick={() => {
                        setFilterCandInLogs(c.candidate_id);
                        setFilterSessionInLogs("all");
                        loadCandidateSessions(c.candidate_id);
                        setPage(1);
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex-shrink-0 flex items-center gap-1.5 ${filterCandInLogs === c.candidate_id
                        ? "bg-blue-600 text-white shadow-xs"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                    >
                      <User className="w-3 h-3" />
                      <span>{c.candidate_id}</span>
                      {c.alert_count > 0 && (
                        <span className="w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] flex items-center justify-center font-bold">
                          {c.alert_count}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  {filterCandInLogs !== "all" && candSessions.length > 0 && (
                    <select
                      value={filterSessionInLogs}
                      onChange={(e) => {
                        setFilterSessionInLogs(e.target.value);
                        setPage(1);
                      }}
                      className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold"
                    >
                      <option value="all">All Sessions ({candSessions.length})</option>
                      {candSessions.map((s, idx) => (
                        <option key={s.session_id} value={s.session_id}>
                          Session {candSessions.length - idx} ({s.status})
                        </option>
                      ))}
                    </select>
                  )}

                  {filterCandInLogs !== "all" && (
                    <button
                      onClick={() => {
                        setSelectedCand(filterCandInLogs);
                        loadCandidateSessions(filterCandInLogs, "latest");
                        setViewingFullLogsCand(filterCandInLogs);
                      }}
                      className="px-3.5 py-1.5 border border-blue-300 text-blue-600 hover:bg-blue-50 bg-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer"
                    >
                      <span>View Full Logs</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  )}

                  <select
                    value={sev}
                    onChange={(e) => {
                      setSev(e.target.value);
                      setPage(1);
                    }}
                    className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                  >
                    <option value="">All Severities</option>
                    <option value="INFO">INFO</option>
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                  </select>

                  <button
                    onClick={() => downloadCsv(t)}
                    className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export CSV</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden flex flex-col">
                <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <h3 className="font-bold text-xs sm:text-sm text-slate-800">
                    {filterCandInLogs === "all"
                      ? "Audit Events Across All Candidates"
                      : `Audit Events for ${filterCandInLogs} ${filterSessionInLogs !== "all" ? `(${filterSessionInLogs})` : ""}`}
                  </h3>
                  <span className="text-xs text-slate-500">{logs.total} Total Records</span>
                </div>

                <div className="flex-1 overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 sticky top-0 z-10">
                      <tr>
                        <th className="py-3 px-4">Time</th>
                        <th className="py-3 px-4">Candidate ID</th>
                        <th className="py-3 px-4">Session</th>
                        <th className="py-3 px-4">Event Type</th>
                        <th className="py-3 px-4">Severity</th>
                        <th className="py-3 px-4">Source</th>
                        <th className="py-3 px-4">Description</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {logs.items.map((e) => (
                        <tr key={e.event_id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3 px-4 font-mono text-slate-500">{new Date(e.timestamp).toLocaleTimeString()}</td>
                          <td className="py-3 px-4 font-bold text-blue-600">{e.candidate_id}</td>
                          <td className="py-3 px-4 font-mono text-[11px]">
                            {e.session_id ? (
                              <span className="text-blue-700 bg-blue-50 border border-blue-200/60 font-semibold px-2 py-0.5 rounded">
                                {e.session_id}
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-800">
                            <span className="flex items-center gap-1.5">
                              {getEventIcon(e.event_type, e.severity)}
                              {e.event_type}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${e.severity === "HIGH"
                                ? "bg-rose-100 text-rose-700"
                                : e.severity === "MEDIUM"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-slate-100 text-slate-600"
                                }`}
                            >
                              {e.severity}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-500">{e.detection_source}</td>
                          <td className="py-3 px-4 text-slate-700">{e.event_description}</td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => {
                                setSelectedCand(e.candidate_id);
                                loadCandidateSessions(e.candidate_id, e.session_id || "latest");
                                setViewingFullLogsCand(e.candidate_id);
                              }}
                              className="px-2.5 py-1 text-blue-600 hover:bg-blue-50 border border-blue-200 rounded-lg text-[11px] font-semibold cursor-pointer"
                            >
                              View Full Logs
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 3: REPORTS                                                 */}
          {/* ============================================================== */}
          {tab === "reports" && !viewingFullLogsCand && report && (
            <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs max-w-2xl">
              <h2 className="text-base font-bold text-slate-900 mb-2">{report.exam_id} Summary</h2>
              <p className="text-xs text-slate-500 mb-4">{report.note}</p>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Events by Type</h3>
              <div className="grid grid-cols-2 gap-2 mb-6">
                {Object.entries(report.events_by_type || {}).map(([k, v]) => (
                  <div key={k} className="p-3 bg-slate-50 rounded-xl border border-slate-200/60 flex justify-between text-xs">
                    <span className="font-medium text-slate-700">{k}</span>
                    <span className="font-bold text-blue-600">{v as number}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 4: DASHBOARD                                               */}
          {/* ============================================================== */}
          {tab === "dashboard" && !viewingFullLogsCand && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs">
                <div className="text-xs text-slate-500 font-medium">Total Candidates</div>
                <div className="text-2xl font-bold text-slate-900 mt-1">{sum.total_candidates ?? fullCandidatesList.length}</div>
              </div>
              <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs">
                <div className="text-xs text-slate-500 font-medium">Active Sessions</div>
                <div className="text-2xl font-bold text-emerald-600 mt-1">{sum.active_candidates ?? fullCandidatesList.length}</div>
              </div>
              <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs">
                <div className="text-xs text-slate-500 font-medium">Flagged Candidates</div>
                <div className="text-2xl font-bold text-amber-600 mt-1">{sum.candidates_with_suspicious_events ?? 2}</div>
              </div>
              <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs">
                <div className="text-xs text-slate-500 font-medium">Network Disruptions</div>
                <div className="text-2xl font-bold text-slate-700 mt-1">{sum.network_problems ?? 0}</div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 5: SETTINGS                                                */}
          {/* ============================================================== */}
          {tab === "settings" && !viewingFullLogsCand && (
            <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs max-w-xl">
              <h2 className="text-base font-bold text-slate-900 mb-4">Exam Configuration</h2>
              <div className="space-y-3 text-xs">
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="font-medium text-slate-700">Strict Proctoring Mode</span>
                  <span className="text-emerald-600 font-bold">Enabled</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="font-medium text-slate-700">Auto Fullscreen Enforcement</span>
                  <span className="text-emerald-600 font-bold">Enabled</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="font-medium text-slate-700">Heartbeat Interval</span>
                  <span className="font-mono text-slate-700">3000 ms</span>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 6: ASSESSMENTS STUDIO (HACKERRANK SELF-SERVICE PLATFORM)   */}
          {/* ============================================================== */}
          {tab === "assessments" && !viewingFullLogsCand && (
            <div className="flex flex-col space-y-6">
              {/* Header Banner */}
              <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 rounded-2xl p-6 text-white shadow-md flex flex-wrap items-center justify-between gap-4">
                <div className="max-w-2xl">
                  <div className="flex items-center gap-2.5 text-blue-400 font-semibold text-xs tracking-wide uppercase mb-1">
                    <Sparkles className="w-4 h-4 text-blue-400" />
                    <span>Self-Service Assessment Studio (HackerRank Model)</span>
                  </div>
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Hosted Assessments & Tests</h2>
                  <p className="text-slate-300 text-xs sm:text-sm mt-1 leading-relaxed">
                    Create customized proctored tests, configure anti-cheating shields, formulate questions, and share one-click secure invite links with candidates.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      loadExams();
                    }}
                    className="px-3.5 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold border border-slate-700 transition-all flex items-center gap-2 cursor-pointer"
                    title="Refresh assessments list"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingExams ? "animate-spin" : ""}`} />
                    <span>Refresh</span>
                  </button>
                  <button
                    onClick={() => setIsCreateExamOpen(true)}
                    className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-600/30 transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Create New Assessment</span>
                  </button>
                </div>
              </div>

              {/* Filter and Stats Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs">
                <div className="flex items-center gap-2.5">
                  <span className="text-xs font-bold text-slate-700">Total Assessments:</span>
                  <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-bold text-xs border border-blue-200/60">
                    {examsList.length} Active
                  </span>
                </div>
                <div className="relative w-72 sm:w-80">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search by test title or exam ID..."
                    value={examSearch}
                    onChange={(e) => setExamSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50/50 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  />
                </div>
              </div>

              {/* Assessment Cards Grid */}
              {isLoadingExams ? (
                <div className="p-12 text-center text-slate-500 bg-white rounded-2xl border border-slate-200/80 shadow-xs">
                  <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-500 mb-3" />
                  <p className="text-xs font-semibold">Loading assessments...</p>
                </div>
              ) : examsList.filter((e) =>
                  e.title.toLowerCase().includes(examSearch.toLowerCase()) ||
                  e.exam_id.toLowerCase().includes(examSearch.toLowerCase()) ||
                  (e.description && e.description.toLowerCase().includes(examSearch.toLowerCase()))
                ).length === 0 ? (
                <div className="p-12 text-center bg-white rounded-2xl border border-slate-200/80 shadow-xs">
                  <BookOpen className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <h3 className="text-base font-bold text-slate-800">No Assessments Found</h3>
                  <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 mb-4">
                    {examSearch
                      ? `No assessments match "${examSearch}". Try adjusting your search query.`
                      : "You have not published any custom assessments yet. Create one to test candidates with custom questions."}
                  </p>
                  <button
                    onClick={() => setIsCreateExamOpen(true)}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow-md cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Create Your First Assessment</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                  {examsList
                    .filter((e) =>
                      e.title.toLowerCase().includes(examSearch.toLowerCase()) ||
                      e.exam_id.toLowerCase().includes(examSearch.toLowerCase()) ||
                      (e.description && e.description.toLowerCase().includes(examSearch.toLowerCase()))
                    )
                    .map((exam) => {
                      const isCopied = copiedExamId === exam.exam_id;
                      const qCount = exam.question_count || exam.questions?.length || 0;
                      const isSeed = exam.exam_id === "EXAM-001";

                      return (
                        <div
                          key={exam.exam_id}
                          className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between group"
                        >
                          <div>
                            {/* Card Header Badges */}
                            <div className="flex items-center justify-between gap-2 mb-3">
                              <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200/60">
                                {exam.exam_id}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] font-semibold text-slate-600 px-2 py-0.5 rounded-md bg-slate-100 flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-slate-400" />
                                  <span>{exam.duration_minutes}m</span>
                                </span>
                                <span className="text-[11px] font-semibold text-slate-600 px-2 py-0.5 rounded-md bg-slate-100 flex items-center gap-1">
                                  <FileText className="w-3 h-3 text-slate-400" />
                                  <span>{qCount} Qs</span>
                                </span>
                                {!isSeed && (
                                  <button
                                    onClick={() => handleDeleteExam(exam.exam_id)}
                                    className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                    title="Delete assessment"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Title & Description */}
                            <h3 className="font-bold text-slate-900 text-sm mb-1.5 leading-snug group-hover:text-blue-600 transition-colors">
                              {exam.title}
                            </h3>
                            <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed mb-4">
                              {exam.description || "Self-service proctored assessment."}
                            </p>

                            {/* Proctoring Badges */}
                            <div className="flex flex-wrap gap-1.5 mb-4">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                                Netflix 0ms Blackout
                              </span>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200/60">
                                Fullscreen Lock
                              </span>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200/60">
                                AI Extension Shield
                              </span>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200/60">
                                Anti-Paste Textbox
                              </span>
                            </div>

                            {/* Questions Snippet */}
                            {exam.questions && exam.questions.length > 0 && (
                              <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-3 mb-4 text-[11px] text-slate-600 space-y-1">
                                <div className="font-semibold text-slate-700 truncate">
                                  Q1: {exam.questions[0].title}
                                </div>
                                {exam.questions.length > 1 && (
                                  <div className="text-[10px] text-slate-400">
                                    + {exam.questions.length - 1} more question{exam.questions.length - 1 > 1 ? "s" : ""}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Action Buttons */}
                          <div className="border-t border-slate-100 pt-3.5 flex items-center justify-between gap-2">
                            <button
                              onClick={() => handleCopyCandidateLink(exam.exam_id)}
                              className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                isCopied
                                  ? "bg-emerald-600 text-white shadow-xs"
                                  : "bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200/60"
                              }`}
                            >
                              {isCopied ? (
                                <>
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Link Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>Copy Invite Link</span>
                                </>
                              )}
                            </button>

                            <a
                              href={`/?exam=${encodeURIComponent(exam.exam_id)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                              title="Test this exam in candidate view"
                            >
                              <Play className="w-3 h-3 text-slate-600" />
                              <span>Test</span>
                            </a>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ============================================================== */}
      {/* MODAL: BROWSER EXTENSIONS INSPECTOR                           */}
      {/* ============================================================== */}
      {viewingExtensionsCand && (
        <div
          data-testid="extensions-modal"
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => setViewingExtensionsCand(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl border border-slate-200/90 max-w-2xl w-full overflow-hidden flex flex-col max-h-[85vh] animate-scaleUp"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-3 bg-gradient-to-r from-purple-50 via-white to-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center shadow-xs">
                  <Puzzle className="w-5 h-5 stroke-[2.2]" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <span>Browser Extensions Inspector</span>
                    <span className="font-mono text-xs text-purple-700 bg-purple-100/70 border border-purple-200 px-2 py-0.5 rounded-md">
                      {viewingExtensionsCand}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    Real-time inspection of active plugins, browser extensions & content scripts
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setViewingExtensionsCand(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Status Bar */}
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 font-semibold text-slate-700">
                  <span>Detected Extensions:</span>
                  <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 font-bold text-[11px]">
                    {candExtensionsData?.count ?? 0}
                  </span>
                </div>
                {candExtensionsData?.has_high_risk && (
                  <div className="flex items-center gap-1.5 font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-0.5 rounded-full text-[11px]">
                    <AlertTriangle className="w-3 h-3 text-rose-600" />
                    <span>High Risk Extensions Found</span>
                  </div>
                )}
              </div>

              {candExtensionsData?.last_scan && (
                <div className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>Last Scanned: {formatTime(candExtensionsData.last_scan)}</span>
                </div>
              )}
            </div>

            {/* Modal Body */}
            <div className="p-5 flex-1 overflow-y-auto space-y-3">
              {isLoadingExtensions ? (
                <div className="py-12 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-purple-600" />
                  <span>Scanning candidate browser environment for active extensions...</span>
                </div>
              ) : !candExtensionsData || candExtensionsData.extensions.length === 0 ? (
                <div className="py-10 text-center flex flex-col items-center justify-center p-6 bg-emerald-50/50 border border-emerald-200/60 rounded-xl">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3">
                    <CheckCircle className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-bold text-emerald-900 mb-1">No Unauthorized Extensions Detected</h4>
                  <p className="text-xs text-slate-600 max-w-sm">
                    Candidate browser environment appears clean. No AI copilots, DevTools extensions, paraphrasing assistants, or script managers were found running in the session DOM.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-xs text-slate-500 font-medium">
                    The following browser extensions and script injectors were detected running on the candidate's browser:
                  </div>

                  {candExtensionsData.extensions.map((ext: any, idx: number) => {
                    const isHigh = ext.risk === "HIGH";
                    const isMed = ext.risk === "MEDIUM";
                    return (
                      <div
                        key={idx}
                        className={`p-3.5 rounded-xl border transition-all ${
                          isHigh
                            ? "bg-rose-50/30 border-rose-200"
                            : isMed
                            ? "bg-amber-50/30 border-amber-200"
                            : "bg-slate-50/60 border-slate-200"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2">
                            <Puzzle className={`w-4 h-4 ${isHigh ? "text-rose-600" : isMed ? "text-amber-600" : "text-slate-600"}`} />
                            <span className="text-xs font-bold text-slate-900">{ext.name}</span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">
                              {ext.category}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                isHigh
                                  ? "bg-rose-100 text-rose-700 border border-rose-200"
                                  : isMed
                                  ? "bg-amber-100 text-amber-800 border border-amber-200"
                                  : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {ext.risk} RISK
                            </span>
                          </div>
                        </div>

                        <div className="text-xs text-slate-600 leading-relaxed mb-2">
                          {ext.details}
                        </div>

                        <div className="flex items-center gap-3 text-[10px] text-slate-400 border-t border-slate-100/80 pt-1.5 font-mono">
                          <span>Detection: <strong className="text-slate-600">{ext.detectionMethod}</strong></span>
                          <span>Identifier: <strong className="text-slate-600">{ext.id}</strong></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Proctor Advisory Notice */}
              <div className="p-3 bg-purple-50/60 border border-purple-200/70 rounded-xl text-xs text-purple-900 flex items-start gap-2.5 mt-4">
                <Shield className="w-4 h-4 text-purple-600 flex-shrink-0 mt-0.5" />
                <div className="leading-relaxed text-[11px]">
                  <strong>Proctor Security Protocol:</strong> Third-party extensions such as AI copilots, paraphrasers, and userscript engines can compromise exam integrity. If HIGH-risk extensions are listed, proctors are advised to request the candidate to disable them or launch in a clean browser profile.
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => openExtensionsModal(viewingExtensionsCand)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Re-scan Environment</span>
              </button>

              <button
                type="button"
                onClick={() => setViewingExtensionsCand(null)}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer shadow-xs"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: CREATE ASSESSMENT (HACKERRANK STYLE)                     */}
      {/* ============================================================== */}
      {isCreateExamOpen && (
        <div
          data-testid="create-assessment-modal"
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => setIsCreateExamOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl border border-slate-200/90 max-w-3xl w-full overflow-hidden flex flex-col max-h-[90vh] animate-scaleUp"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-3 bg-gradient-to-r from-blue-50 via-white to-indigo-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
                  <Layers className="w-5 h-5 stroke-[2.2]" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <span>Create New Assessment</span>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                      HackerRank Model
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    Define test structure, proctoring security level, and exam questions.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsCreateExamOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Template Presets */}
            <div className="px-6 py-3 bg-slate-50 border-b border-slate-200/70 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>Quick-Load Industry Presets:</span>
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => loadTemplate("fullstack")}
                  className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 hover:border-blue-500 hover:bg-blue-50 text-[11px] font-semibold text-slate-700 hover:text-blue-700 transition-all cursor-pointer shadow-2xs"
                >
                  Full-Stack Engineer
                </button>
                <button
                  type="button"
                  onClick={() => loadTemplate("backend")}
                  className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 hover:border-blue-500 hover:bg-blue-50 text-[11px] font-semibold text-slate-700 hover:text-blue-700 transition-all cursor-pointer shadow-2xs"
                >
                  Distributed Backend
                </button>
                <button
                  type="button"
                  onClick={() => loadTemplate("python")}
                  className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 hover:border-blue-500 hover:bg-blue-50 text-[11px] font-semibold text-slate-700 hover:text-blue-700 transition-all cursor-pointer shadow-2xs"
                >
                  Python Core
                </button>
              </div>
            </div>

            {/* Form Body */}
            <form onSubmit={handleCreateExamSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Basic Information */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  1. Assessment Information
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Assessment Title <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Senior Software Engineer Technical Screen"
                      value={newExamTitle}
                      onChange={(e) => setNewExamTitle(e.target.value)}
                      className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Duration (Minutes)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={300}
                      value={newExamDuration}
                      onChange={(e) => setNewExamDuration(Math.max(1, parseInt(e.target.value, 10) || 30))}
                      className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Assessment Instructions / Description
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Candidate briefing notes displayed before starting the test..."
                      value={newExamDesc}
                      onChange={(e) => setNewExamDesc(e.target.value)}
                      className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Custom Exam ID (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="Auto-generated if blank"
                      value={newExamId}
                      onChange={(e) => setNewExamId(e.target.value.toUpperCase())}
                      className="w-full px-3.5 py-2 text-xs font-mono rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">e.g. EXAM-PYTHON-2026</span>
                  </div>
                </div>
              </div>

              {/* Proctoring & Security Toggles */}
              <div className="space-y-3 border-t border-slate-100 pt-5">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  2. HackerRank-Grade Proctoring Policy
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={newExamSettings.netflixShield}
                      onChange={(e) => setNewExamSettings((s) => ({ ...s, netflixShield: e.target.checked }))}
                      className="mt-0.5 rounded text-blue-600"
                    />
                    <div>
                      <div className="font-semibold text-slate-800">Netflix 0ms Blackout Shield</div>
                      <div className="text-[11px] text-slate-500">
                        Synchronously blanks screen on PrintScreen, Greenshot & Snipping Tool.
                      </div>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={newExamSettings.fullscreenLock}
                      onChange={(e) => setNewExamSettings((s) => ({ ...s, fullscreenLock: e.target.checked }))}
                      className="mt-0.5 rounded text-blue-600"
                    />
                    <div>
                      <div className="font-semibold text-slate-800">Fullscreen Lockout</div>
                      <div className="text-[11px] text-slate-500">
                        Obscures questions and disables answering if the candidate exits fullscreen.
                      </div>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={newExamSettings.aiScanner}
                      onChange={(e) => setNewExamSettings((s) => ({ ...s, aiScanner: e.target.checked }))}
                      className="mt-0.5 rounded text-blue-600"
                    />
                    <div>
                      <div className="font-semibold text-slate-800">AI Extension Scanner & Neutralizer</div>
                      <div className="text-[11px] text-slate-500">
                        Detects ChatGPT, Sider, Monica AI sidebars, and Copyfish OCR.
                      </div>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={newExamSettings.antiPaste}
                      onChange={(e) => setNewExamSettings((s) => ({ ...s, antiPaste: e.target.checked }))}
                      className="mt-0.5 rounded text-blue-600"
                    />
                    <div>
                      <div className="font-semibold text-slate-800">Anti-Paste Direct Typing Protection</div>
                      <div className="text-[11px] text-slate-500">
                        Prohibits clipboard paste and script injection into candidate text responses.
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Questions Builder */}
              <div className="space-y-4 border-t border-slate-100 pt-5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    3. Assessment Questions ({newExamQuestions.length})
                  </h4>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => addQuestion("mcq")}
                      className="px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 font-semibold text-xs border border-blue-200 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add MCQ Question</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => addQuestion("text")}
                      className="px-2.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-semibold text-xs border border-indigo-200 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Subjective Question</span>
                    </button>
                  </div>
                </div>

                {newExamQuestions.map((q, qIdx) => (
                  <div key={q.id || qIdx} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-800">Q{qIdx + 1}</span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                            q.type === "mcq" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                          }`}
                        >
                          {q.type === "mcq" ? "Multiple Choice" : "Subjective Text"}
                        </span>
                      </div>
                      {newExamQuestions.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeQuestion(qIdx)}
                          className="text-slate-400 hover:text-rose-600 text-xs font-medium cursor-pointer"
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Question Prompt / Problem Statement
                      </label>
                      <input
                        type="text"
                        required
                        value={q.title}
                        onChange={(e) => updateQuestion(qIdx, { title: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="Enter the question here..."
                      />
                    </div>

                    {q.type === "mcq" && (
                      <div className="space-y-2 pt-1">
                        <label className="block text-[11px] font-semibold text-slate-600">
                          Options
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {(q.options || ["Option A", "Option B", "Option C", "Option D"]).map((opt, optIdx) => (
                            <div key={optIdx} className="flex items-center gap-2">
                              <span className="text-[11px] font-bold text-slate-400 w-5">{optIdx + 1}.</span>
                              <input
                                type="text"
                                required
                                value={opt}
                                onChange={(e) => {
                                  const newOpts = [...(q.options || [])];
                                  newOpts[optIdx] = e.target.value;
                                  updateQuestion(qIdx, { options: newOpts });
                                }}
                                className="flex-1 px-2.5 py-1 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {q.type === "text" && (
                      <div className="text-[11px] text-slate-500 bg-white border border-slate-200/80 rounded-lg p-2.5 italic">
                        Candidate will be provided a secure direct-typing response area protected by ExamShield's anti-paste and clipboard injection blocker.
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Modal Footer Actions */}
              <div className="border-t border-slate-200 pt-5 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreateExamOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-500/25 transition-all flex items-center gap-2 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>Publish Assessment</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: AI PROCTOR TELEMETRY AUDITOR (PROMPT-INJECTION PROOF)   */}
      {/* ============================================================== */}
      {viewingAIAuditCand && (
        <div
          data-testid="ai-audit-modal"
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => setViewingAIAuditCand(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl border border-slate-200/90 max-w-3xl w-full overflow-hidden flex flex-col max-h-[90vh] animate-scaleUp"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-3 bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-400/40 text-blue-400 flex items-center justify-center shadow-xs">
                  <Bot className="w-5 h-5 stroke-[2.2]" />
                </div>
                <div>
                  <h3 className="text-base font-bold flex items-center gap-2">
                    <span>AI Behavioral Proctor Audit</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      Prompt-Injection Immune
                    </span>
                  </h3>
                  <p className="text-xs text-slate-300">
                    Candidate: <span className="font-semibold text-white">{viewingAIAuditCand}</span> • Analyzed via Structured Telemetry Stream
                  </p>
                </div>
              </div>
              <button
                onClick={() => setViewingAIAuditCand(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-slate-50/50">
              {isLoadingAIAudit ? (
                <div className="text-center py-16 space-y-3">
                  <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-600 mb-2" />
                  <h4 className="text-sm font-bold text-slate-800">Analyzing Telemetry Event Stream...</h4>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Evaluating focus loss durations, screenshot capture sequences, clipboard anomalies, and browser process signals.
                  </p>
                </div>
              ) : aiAuditError ? (
                <div className="text-center py-12 bg-rose-50 rounded-2xl border border-rose-200 p-6">
                  <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto mb-2" />
                  <h4 className="text-sm font-bold text-rose-900">Audit Computation Failed</h4>
                  <p className="text-xs text-rose-600 mt-1">{aiAuditError}</p>
                </div>
              ) : aiAuditData ? (
                <>
                  {/* Verdict & Score Banner */}
                  <div
                    className={`rounded-2xl p-5 border flex flex-wrap items-center justify-between gap-4 ${
                      aiAuditData.verdict === "HIGH_RISK"
                        ? "bg-rose-50/90 border-rose-200 text-rose-950"
                        : aiAuditData.verdict === "SUSPICIOUS"
                        ? "bg-amber-50/90 border-amber-200 text-amber-950"
                        : "bg-emerald-50/90 border-emerald-200 text-emerald-950"
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-600">Integrity Verdict:</span>
                        <span
                          className={`text-xs font-black px-2.5 py-0.5 rounded-full uppercase tracking-wide ${
                            aiAuditData.verdict === "HIGH_RISK"
                              ? "bg-rose-600 text-white shadow-xs"
                              : aiAuditData.verdict === "SUSPICIOUS"
                              ? "bg-amber-500 text-white shadow-xs"
                              : "bg-emerald-600 text-white shadow-xs"
                          }`}
                        >
                          {aiAuditData.verdict === "HIGH_RISK" ? "HIGH RISK / MISCONDUCT LIKELY" : aiAuditData.verdict === "SUSPICIOUS" ? "SUSPICIOUS ACTIVITY" : "CLEAN / INTEGRITY VERIFIED"}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-500">
                          (Confidence: {aiAuditData.confidence})
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed max-w-xl text-slate-700 font-medium">
                        {aiAuditData.summary}
                      </p>
                    </div>

                    <div className="text-right flex items-center gap-3">
                      <div>
                        <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Risk Score</div>
                        <div
                          className={`text-3xl font-black ${
                            aiAuditData.verdict === "HIGH_RISK"
                              ? "text-rose-600"
                              : aiAuditData.verdict === "SUSPICIOUS"
                              ? "text-amber-600"
                              : "text-emerald-600"
                          }`}
                        >
                          {aiAuditData.risk_score}<span className="text-sm font-semibold text-slate-400">/100</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Telemetry Breakdown Counters */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Unfocused Time</div>
                      <div className="text-lg font-bold text-slate-800 mt-0.5">
                        {aiAuditData.telemetry_stats.total_unfocused_sec}s
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {aiAuditData.telemetry_stats.focus_lost_count} departures
                      </div>
                    </div>

                    <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Screenshot Traps</div>
                      <div className={`text-lg font-bold mt-0.5 ${aiAuditData.telemetry_stats.screenshot_attempts > 0 ? "text-rose-600" : "text-slate-800"}`}>
                        {aiAuditData.telemetry_stats.screenshot_attempts}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        Greenshot/PrtScn
                      </div>
                    </div>

                    <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Paste Violations</div>
                      <div className={`text-lg font-bold mt-0.5 ${aiAuditData.telemetry_stats.paste_attempts > 0 ? "text-rose-600" : "text-slate-800"}`}>
                        {aiAuditData.telemetry_stats.paste_attempts}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        Clipboard injection
                      </div>
                    </div>

                    <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">AI Extensions</div>
                      <div className={`text-lg font-bold mt-0.5 ${aiAuditData.telemetry_stats.high_risk_extensions_count > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                        {aiAuditData.telemetry_stats.high_risk_extensions_count > 0 ? "High Risk" : "None"}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        Copilot/OCR probe
                      </div>
                    </div>
                  </div>

                  {/* Detected Behavioral Patterns */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                      <Zap className="w-3.5 h-3.5 text-blue-600" />
                      <span>Identified Behavioral Anomaly Patterns ({aiAuditData.anomalies.length})</span>
                    </h4>

                    {aiAuditData.anomalies.length === 0 ? (
                      <div className="text-center py-6 bg-slate-50 rounded-xl border border-slate-100">
                        <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-1.5" />
                        <div className="text-xs font-bold text-slate-700">Zero Critical Anomalies Detected</div>
                        <p className="text-[11px] text-slate-400 mt-0.5">Telemetry shows steady focus with zero external exfiltration or clipboard activity.</p>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {aiAuditData.anomalies.map((anom, idx) => (
                          <div
                            key={idx}
                            className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-all flex flex-col space-y-1.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-slate-900 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                                {anom.pattern}
                              </span>
                              <div className="flex items-center gap-2">
                                {anom.timestamp && (
                                  <span className="text-[10px] text-slate-400 font-mono">
                                    {new Date(anom.timestamp).toLocaleTimeString()}
                                  </span>
                                )}
                                <span
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                    anom.severity === "HIGH"
                                      ? "bg-rose-100 text-rose-700 border border-rose-200"
                                      : anom.severity === "MEDIUM"
                                      ? "bg-amber-100 text-amber-800 border border-amber-200"
                                      : "bg-blue-100 text-blue-700 border border-blue-200"
                                  }`}
                                >
                                  {anom.severity} SEVERITY
                                </span>
                              </div>
                            </div>
                            <p className="text-xs text-slate-600 leading-relaxed pl-3.5 border-l-2 border-slate-300">
                              {anom.evidence}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Recommendation Card */}
                  <div className="bg-blue-50/70 border border-blue-200/80 rounded-2xl p-4 flex items-start gap-3">
                    <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <div className="text-xs font-bold text-blue-900">Proctor Recommendation</div>
                      <p className="text-xs text-blue-800 leading-relaxed font-medium">
                        {aiAuditData.recommendation}
                      </p>
                    </div>
                  </div>

                  {/* Security Guarantee Notice */}
                  <div className="text-[11px] text-slate-500 bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-emerald-600" />
                      <span><strong>Prompt-Injection Proof Architecture:</strong> Evaluates purely mathematical telemetry events & durations. Zero candidate prose parsed.</span>
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">
                      ID: {aiAuditData.audit_id}
                    </span>
                  </div>
                </>
              ) : null}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={isLoadingAIAudit}
                onClick={reRunAIAuditAction}
                className="px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAIAudit ? "animate-spin text-blue-600" : ""}`} />
                <span>Re-Analyze Stream</span>
              </button>

              <button
                type="button"
                onClick={() => setViewingAIAuditCand(null)}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer shadow-xs"
              >
                Close Audit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
