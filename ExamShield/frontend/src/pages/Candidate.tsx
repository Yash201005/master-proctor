import { useEffect, useState, useRef, useCallback } from "react";
import {
  Shield,
  Wifi,
  Clock,
  Maximize,
  Minimize,
  AlertTriangle,
  Info,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  StopCircle,
  Lock,
  LogOut,
  FileCheck,
  Eye,
  Monitor,
  Ban,
  Activity,
  CameraOff,
  EyeOff
} from "lucide-react";
import { api, type Auth } from "../api";
import { startHeartbeat, type NetState } from "../detection/network";
import { useEventPipeline } from "../useEventPipeline";

interface Question {
  id: number;
  title: string;
  type: "mcq" | "text";
  options?: string[];
}

const DEFAULT_QUESTIONS: Question[] = [
  {
    id: 1,
    title: "Explain the difference between a stack and a queue, and give one real-world use case for each data structure.",
    type: "text"
  },
  {
    id: 2,
    title: "Which data structure operates on a First-In, First-Out (FIFO) principle?",
    type: "mcq",
    options: ["Stack", "Queue", "Binary Search Tree", "Min Heap"]
  },
  {
    id: 3,
    title: "What is the worst-case time complexity of QuickSort?",
    type: "mcq",
    options: ["O(n log n)", "O(n)", "O(n²)", "O(log n)"]
  },
  {
    id: 4,
    title: "What is the time complexity of binary search?",
    type: "mcq",
    options: ["O(n)", "O(log n)", "O(n log n)", "O(n²)"]
  },
  {
    id: 5,
    title: "Which data structure uses pointers to connect nodes sequentially in memory?",
    type: "mcq",
    options: ["Array", "Linked List", "Hash Map", "Binary Heap"]
  },
  {
    id: 6,
    title: "In a balanced binary search tree with n nodes, what is the height of the tree?",
    type: "mcq",
    options: ["O(log n)", "O(n)", "O(n²)", "O(1)"]
  },
  {
    id: 7,
    title: "Which algorithm finds the shortest path between all pairs of vertices in a weighted graph?",
    type: "mcq",
    options: ["Dijkstra's Algorithm", "Floyd-Warshall Algorithm", "Prim's Algorithm", "Kruskal's Algorithm"]
  },
  {
    id: 8,
    title: "What is the average time complexity of a lookup operation in a hash table?",
    type: "mcq",
    options: ["O(1)", "O(n)", "O(log n)", "O(n log n)"]
  },
  {
    id: 9,
    title: "Which sorting algorithm is known to be stable and has O(n log n) worst-case time complexity?",
    type: "mcq",
    options: ["Merge Sort", "Quick Sort", "Heap Sort", "Selection Sort"]
  },
  {
    id: 10,
    title: "What data structure is typically used to implement Breadth-First Search (BFS)?",
    type: "mcq",
    options: ["Queue", "Stack", "Priority Queue", "Hash Table"]
  },
  {
    id: 11,
    title: "What data structure is typically used to implement Depth-First Search (DFS)?",
    type: "mcq",
    options: ["Stack", "Queue", "Array List", "Linked List"]
  },
  {
    id: 12,
    title: "Which algorithmic paradigm does the Merge Sort algorithm use?",
    type: "mcq",
    options: ["Divide and Conquer", "Dynamic Programming", "Greedy Approach", "Backtracking"]
  },
  {
    id: 13,
    title: "What is the auxiliary space complexity of standard iterative binary search?",
    type: "mcq",
    options: ["O(1)", "O(log n)", "O(n)", "O(n²)"]
  },
  {
    id: 14,
    title: "Which traversal of a Binary Search Tree produces elements in sorted ascending order?",
    type: "mcq",
    options: ["In-order Traversal", "Pre-order Traversal", "Post-order Traversal", "Level-order Traversal"]
  },
  {
    id: 15,
    title: "What is the primary condition for an AVL tree to maintain balance?",
    type: "mcq",
    options: [
      "Balance factor between -1, 0, and 1 for every node",
      "All leaves must be at exactly the same depth",
      "Left subtree size equals right subtree size",
      "Tree height cannot exceed 10"
    ]
  },
  {
    id: 16,
    title: "Which collision resolution technique stores all colliding elements in linked lists at each slot?",
    type: "mcq",
    options: ["Separate Chaining", "Linear Probing", "Quadratic Probing", "Double Hashing"]
  },
  {
    id: 17,
    title: "What is the time complexity to insert an element into a binary max heap of size n?",
    type: "mcq",
    options: ["O(log n)", "O(1)", "O(n)", "O(n log n)"]
  },
  {
    id: 18,
    title: "Which of the following problems can be solved in polynomial time using Dijkstra's algorithm?",
    type: "mcq",
    options: [
      "Single-source shortest path with non-negative edge weights",
      "Single-source shortest path with negative cycles",
      "Traveling Salesperson Problem",
      "Graph coloring with minimum colors"
    ]
  },
  {
    id: 19,
    title: "What is the time complexity of building a heap from an unsorted array of n elements?",
    type: "mcq",
    options: ["O(n)", "O(n log n)", "O(n²)", "O(log n)"]
  },
  {
    id: 20,
    title: "Which data structure is most efficient for implementing a priority queue?",
    type: "mcq",
    options: ["Binary Heap", "Unsorted Array", "Singly Linked List", "Binary Search Tree"]
  }
];

export default function Candidate({ auth, onLogout }: { auth: Auth; onLogout?: () => void }) {
  // Dynamic Exam loaded via URL param ?exam=EXAM-ID (default EXAM-001)
  const [examId, setExamId] = useState<string>(() => {
    try {
      return new URLSearchParams(window.location.search).get("exam") || "EXAM-001";
    } catch {
      return "EXAM-001";
    }
  });
  const [examTitle, setExamTitle] = useState<string>("Data Structures Assessment");
  const [examDescription, setExamDescription] = useState<string>(
    "Comprehensive technical assessment covering core data structures, graph traversals, and asymptotic complexity."
  );
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [questions, setQuestions] = useState<Question[]>(DEFAULT_QUESTIONS);

  // Exam Stage: 'instructions' -> 'active' -> 'ended'
  const [stage, setStage] = useState<"instructions" | "active" | "ended">(() => {
    try {
      return (new URLSearchParams(window.location.search).get("stage") as any) || "instructions";
    } catch {
      return "instructions";
    }
  });
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Navigation & Answers
  const [currentQ, setCurrentQ] = useState(() => {
    try {
      const qParam = new URLSearchParams(window.location.search).get("q");
      if (qParam !== null) return parseInt(qParam, 10);
    } catch {}
    return 0; // Default to Question 1
  });
  const [answers, setAnswers] = useState<Record<number, string>>({
    0: "Stack is LIFO and Queue is FIFO (Stack: Function call stack, Queue: Task scheduling)",
    1: "Queue",
    2: "O(n²)"
  });
  const [visited, setVisited] = useState<Set<number>>(new Set([0, 1, 2, 3]));
  const [marked, setMarked] = useState<Set<number>>(new Set());

  // Proctoring & Status States
  const [warning, setWarning] = useState<string | null>(() => {
    try {
      return new URLSearchParams(window.location.search).get("mockWarning");
    } catch {
      return null;
    }
  });
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [screenshotBlocked, setScreenshotBlocked] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("mockScreenshot") === "true";
    } catch {
      return false;
    }
  });
  const screenshotTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerScreenshotBlock = useCallback((reason?: string) => {
    try {
      (window as any).__activateNetflixBlackout?.(reason || "Screenshot Trigger");
      document.documentElement.classList.add("netflix-blackout-active");
      if (document.body) document.body.classList.add("netflix-blackout-active");
    } catch {}
    setScreenshotBlocked(true);
    if (screenshotTimeoutRef.current) clearTimeout(screenshotTimeoutRef.current);
    screenshotTimeoutRef.current = setTimeout(() => {
      setScreenshotBlocked(false);
      if (document.hasFocus && document.hasFocus() && !document.hidden && document.visibilityState === "visible") {
        document.documentElement.classList.remove("netflix-blackout-active");
        if (document.body) document.body.classList.remove("netflix-blackout-active");
      }
    }, 2800);
  }, []);

  const [net, setNet] = useState<NetState>("STABLE");
  const [lat, setLat] = useState<number | null>(42);
  const [left, setLeft] = useState(1800); // 30:00 default

  // Load exam definition from server
  useEffect(() => {
    api(`/api/exams/${encodeURIComponent(examId)}`, auth.access_token)
      .then((data) => {
        if (data) {
          if (data.title) setExamTitle(data.title);
          if (data.description) setExamDescription(data.description);
          if (data.duration_minutes) {
            setDurationMinutes(data.duration_minutes);
            setLeft(data.duration_minutes * 60);
          }
          if (data.questions && Array.isArray(data.questions) && data.questions.length > 0) {
            setQuestions(data.questions);
          }
        }
      })
      .catch((err) => {
        console.warn("Using default assessment questions:", err);
      });
  }, [examId, auth.access_token]);
  const [fs, setFs] = useState(() => {
    try {
      if (new URLSearchParams(window.location.search).get("mockFs") === "true") return true;
      return !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (window.innerHeight >= (window.screen.availHeight - 15) && window.innerWidth >= (window.screen.availWidth - 15))
      );
    } catch {
      return !!document.fullscreenElement;
    }
  });

  // Track window focus & visibility: catches tab switches, Alt+Tab, and touchpad gestures even in fullscreen
  const [isExamFocused, setIsExamFocused] = useState(() => {
    try {
      if (new URLSearchParams(window.location.search).get("mockFocusLost") === "true") return false;
      return (
        (typeof document.hasFocus === "function" ? document.hasFocus() : true) &&
        document.visibilityState === "visible" &&
        !document.hidden
      );
    } catch {
      return true;
    }
  });

  // Track browser AI side panel (Ask Gemini / Copilot / docked sidebars)
  // Only flags when in fullscreen and a side panel reduces content width relative to browser window
  const [isSidebarDetected, setIsSidebarDetected] = useState(() => {
    try {
      if (new URLSearchParams(window.location.search).get("mockSidebar") === "true") return true;
      const isDomFs = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement
      );
      if (!isDomFs) return false;
      return (window.outerWidth - window.innerWidth >= 280);
    } catch {
      return false;
    }
  });

  const isAnsweringLocked = !fs || !isExamFocused || isSidebarDetected;

  // Stop Examination Flow States
  const [showStopModal, setShowStopModal] = useState(false);
  const [isSubmittingStop, setIsSubmittingStop] = useState(false);
  const stopHeartbeatRef = useRef<(() => void) | null>(null);

  // Warning handler with auto-dismiss after 6 seconds
  const handleWarning = (w: string) => {
    setWarning(w);
    if (w.toLowerCase().includes("screenshot") || w.toLowerCase().includes("screen capture")) {
      triggerScreenshotBlock();
    }
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
    }
    warningTimerRef.current = setTimeout(() => {
      setWarning(null);
    }, 6000);
  };

  useEffect(() => {
    return () => {
      if (warningTimerRef.current) {
        clearTimeout(warningTimerRef.current);
      }
      if (screenshotTimeoutRef.current) {
        clearTimeout(screenshotTimeoutRef.current);
      }
    };
  }, []);

  // Initialize event pipeline tagged with candidate's active session_id & exam_id
  const emit = useEventPipeline(
    auth.access_token,
    handleWarning,
    1500,
    sessionId,
    stage === "active",
    examId
  );

  // Track visited questions
  const selectQuestion = (idx: number) => {
    setCurrentQ(idx);
    setVisited((prev) => new Set(prev).add(idx));
  };

  const handleSelectOption = (opt: string) => {
    if (isAnsweringLocked || stage !== "active") return; // Prevent answering when not in fullscreen or lost focus
    setAnswers((prev) => ({ ...prev, [currentQ]: opt }));
  };

  const toggleMarkForReview = () => {
    if (isAnsweringLocked || stage !== "active") return; // Prevent review mark modifications while locked
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(currentQ)) next.delete(currentQ);
      else next.add(currentQ);
      return next;
    });
  };

  // Handler for blocked clipboard attempts inside the text box response field
  const handleBlockedClipboardAction = useCallback(
    (action: "PASTE" | "COPY" | "CUT" | "DROP" | "PASTE_SHORTCUT" | "COPY_SHORTCUT" | "CONTEXT_MENU", message: string) => {
      handleWarning(message);
      try {
        if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText("ExamShield: Copying and pasting are prohibited in the examination text field.").catch(() => {});
        }
      } catch {}

      emit({
        session_id: sessionId,
        exam_id: examId,
        event_type: action.includes("PASTE") ? "PASTE_ATTEMPT" : action.includes("COPY") || action === "CUT" ? "COPY_ATTEMPT" : "CLIPBOARD_VIOLATION",
        event_category: "CLIPBOARD",
        severity: "HIGH",
        detection_source: "textbox_integrity_guard",
        confidence: "CONFIRMED",
        event_description: `Candidate attempted unauthorized ${action.toLowerCase().replace(/_/g, " ")} in Question ${currentQ + 1} response field`,
        metadata: {
          question_id: questions[currentQ]?.id,
          question_num: currentQ + 1,
          action,
          session_id: sessionId,
          exam_id: examId
        },
        warning: message
      });
    },
    [handleWarning, emit, sessionId, currentQ, examId, questions]
  );

  // Strict Text Selection Blocker: Collapses any text selection inside the exam immediately
  useEffect(() => {
    if (stage !== "active") return;
    const preventTextSelection = () => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().length > 0) {
        sel.removeAllRanges();
      }
    };
    document.addEventListener("selectionchange", preventTextSelection);
    return () => {
      document.removeEventListener("selectionchange", preventTextSelection);
    };
  }, [stage]);

  // Universal Right-Click & Google Lens Blocker: Ensures NOTHING opens on right click
  useEffect(() => {
    if (stage !== "active") return;
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e as any).stopImmediatePropagation?.();
      handleWarning("Right-click context menu and Google Lens are permanently disabled!");
      emit({
        session_id: sessionId,
        event_type: "RIGHT_CLICK",
        event_category: "MOUSE",
        severity: "MEDIUM",
        detection_source: "contextmenu_shield",
        confidence: "CONFIRMED",
        event_description: "Right-click context menu / Google Lens attempt intercepted and suppressed",
        metadata: { button: e.button, x: e.clientX, y: e.clientY, session_id: sessionId },
        warning: "Right-click context menu is permanently disabled."
      });
      return false;
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 2) { // Right mouse button
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("contextmenu", handleContextMenu, { capture: true, passive: false });
    document.addEventListener("contextmenu", handleContextMenu, { capture: true, passive: false });
    window.addEventListener("mousedown", handleMouseDown, { capture: true });
    window.addEventListener("mouseup", handleMouseDown, { capture: true });

    return () => {
      window.removeEventListener("contextmenu", handleContextMenu, { capture: true });
      document.removeEventListener("contextmenu", handleContextMenu, { capture: true });
      window.removeEventListener("mousedown", handleMouseDown, { capture: true });
      window.removeEventListener("mouseup", handleMouseDown, { capture: true });
    };
  }, [stage, sessionId, handleWarning, emit]);

  // Netflix-Style Screenshot Blankout: Triggered on screenshot attempts (PrtScn / Greenshot)
  useEffect(() => {
    if (stage !== "active") return;
    if (screenshotBlocked) {
      document.documentElement.classList.add("netflix-blackout-active");
      if (document.body) document.body.classList.add("netflix-blackout-active");
      const shield = document.getElementById("exam-netflix-shield");
      if (shield) shield.style.display = "block";
    } else {
      document.documentElement.classList.remove("netflix-blackout-active");
      if (document.body) document.body.classList.remove("netflix-blackout-active");
      const shield = document.getElementById("exam-netflix-shield");
      if (shield) shield.style.display = "none";
    }
  }, [stage, screenshotBlocked]);

  // Immediate Zero-Latency Greenshot & PrintScreen Blackout Watcher
  useEffect(() => {
    if (stage !== "active") return;
    const handleScreenCaptureKey = (e: KeyboardEvent) => {
      const k = (e.key || "").toLowerCase();
      const code = (e.code || "").toLowerCase();
      const isPrtScn = k === "printscreen" || k === "snapshot" || k === "print" || code === "printscreen" || e.keyCode === 44 || (e as any).which === 44;
      const isSnip = (e.metaKey && (k === "s" || k === "p" || code === "keys" || e.shiftKey)) ||
                     (e.ctrlKey && e.shiftKey && (k === "s" || k === "3" || k === "4" || k === "5" || k === "g")) ||
                     (e.altKey && (isPrtScn || k === "g"));

      if (isPrtScn || isSnip) {
        e.preventDefault?.();
        triggerScreenshotBlock("Greenshot / PrintScreen Hotkey");
        handleWarning("Screenshot attempt detected (Greenshot / PrintScreen). Screen blanked to prevent data leaks.");
        emit({
          session_id: sessionId,
          event_type: "SCREENSHOT_ATTEMPT",
          event_category: "SCREENSHOT",
          severity: "HIGH",
          detection_source: "greenshot_synchronous_shield",
          confidence: "CONFIRMED",
          event_description: "Candidate attempted screenshot via Greenshot / PrintScreen — screen blanked out",
          metadata: { key: e.key, code: e.code, session_id: sessionId },
          warning: "Screen capture attempt blocked. Screen blanked."
        });
      }
    };

    window.addEventListener("keydown", handleScreenCaptureKey, { capture: true, passive: false });
    window.addEventListener("keyup", handleScreenCaptureKey, { capture: true, passive: false });
    return () => {
      window.removeEventListener("keydown", handleScreenCaptureKey, { capture: true });
      window.removeEventListener("keyup", handleScreenCaptureKey, { capture: true });
    };
  }, [stage, sessionId, triggerScreenshotBlock, handleWarning, emit]);

  // Copyfish & Screen OCR Overlay Watcher + Foreign Overlapping AI Assistant Blocker
  useEffect(() => {
    if (stage !== "active") return;
    const checkCopyfishAndOverlays = () => {
      // 1. Detect Copyfish / UI.Vision OCR capture banners and selection overlays
      const copyfishElem = document.querySelector(
        "#ocr-select-container, #ocr-overlay, #ocr-select-div, [id*='ui-vision' i], [class*='ui-vision' i], [id*='ocr' i], [class*='ocr' i], [id*='a9t9' i], [class*='a9t9' i], #copyfish-select-box, #copyfishModal, .copyfish-dialog, .copyfish-overlay, [id*='copyfish' i], [class*='copyfish' i], iframe[src*='eenjdnjldapjajjofmldgmkjaienebbj']"
      );
      const bText = document.body?.innerText || "";
      const hasUiVisionBanner = bText.includes("UI.Vision") || bText.includes("Select an area with the mouse");

      if (copyfishElem || hasUiVisionBanner) {
        // Dispatch Escape to cancel Copyfish mouse capture
        try {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
        } catch {}
        triggerScreenshotBlock();
        if (copyfishElem) {
          try { (copyfishElem as HTMLElement).remove(); } catch {}
        }
        handleWarning("Screen OCR Capture tool (Copyfish / UI.Vision) detected and blocked!");
        emit({
          session_id: sessionId,
          event_type: "SCREENSHOT_ATTEMPT",
          event_category: "SCREENSHOT",
          severity: "HIGH",
          detection_source: "copyfish_uivision_guard",
          confidence: "CONFIRMED",
          event_description: "Copyfish / UI.Vision OCR screen capture overlay detected in DOM — screenshot blocked and content obscured",
          metadata: { tool: "Copyfish / UI.Vision OCR", session_id: sessionId },
          warning: "Screen capture attempt detected (Copyfish / UI.Vision). Content obscured."
        });
      }

      // 2. Detect & Neutralize Overlapping Foreign Elements (Aitopia, Sider, Monica, Copilot)
      try {
        const foreignElements = Array.from(document.body.children || []).filter((el: any) => {
          if (!el || el.id === "root" || el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "LINK") return false;
          return true;
        });

        if (foreignElements.length > 0) {
          foreignElements.forEach((el: any) => {
            try {
              el.style?.setProperty?.("display", "none", "important");
              el.style?.setProperty?.("visibility", "hidden", "important");
              el.style?.setProperty?.("opacity", "0", "important");
              el.style?.setProperty?.("pointer-events", "none", "important");
              el.remove();
            } catch {}
          });
          handleWarning("Unauthorized overlapping AI assistant detected and removed from screen!");
          emit({
            session_id: sessionId,
            event_type: "AI_COPILOT_SHORTCUT",
            event_category: "BROWSER_INTEGRITY",
            severity: "HIGH",
            detection_source: "sandbox_overlay_guard",
            confidence: "CONFIRMED",
            event_description: "Foreign overlapping AI assistant container detected outside application root and neutralized",
            metadata: { count: foreignElements.length, session_id: sessionId }
          });
        }
      } catch {}
    };

    const interval = setInterval(checkCopyfishAndOverlays, 800);
    return () => clearInterval(interval);
  }, [stage, sessionId, emit, handleWarning, triggerScreenshotBlock]);

  // Heartbeat monitoring (active only once exam has begun)
  useEffect(() => {
    if (stage !== "active") return;
    const stopHb = startHeartbeat(
      () => {
        const q = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
        return api(`/api/heartbeat${q}`, auth.access_token, { method: "POST" }).then(() => undefined);
      },
      (s, l) => {
        setNet((p) => {
          if (p !== s) {
            emit({
              session_id: sessionId,
              event_type: s === "STABLE" ? "NETWORK_RESTORED" : s === "SLOW" ? "NETWORK_SLOW" : "NETWORK_DISCONNECTED",
              event_category: "NETWORK",
              severity: s === "DOWN" ? "MEDIUM" : s === "SLOW" ? "LOW" : "INFO",
              detection_source: "heartbeat",
              confidence: "CONFIRMED",
              event_description: `Network ${s.toLowerCase()}`,
              metadata: { latency_ms: l, session_id: sessionId }
            });
          }
          return s;
        });
        setLat(l);
      }
    );
    stopHeartbeatRef.current = stopHb;
    return () => stopHb();
  }, [auth.access_token, emit, stage, sessionId]);

  // Countdown timer: only ticks down when exam is active
  useEffect(() => {
    if (stage !== "active") return;
    const t = setInterval(() => setLeft((x) => Math.max(0, x - 1)), 1000);
    return () => clearInterval(t);
  }, [stage]);

  // Fullscreen change listener: checks DOM fullscreen & F11 browser fullscreen
  useEffect(() => {
    const checkFs = () => {
      const isDomFs = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      );
      const isF11Fs =
        window.innerHeight >= (window.screen.availHeight - 15) &&
        window.innerWidth >= (window.screen.availWidth - 15);
      setFs(isDomFs || isF11Fs);
    };

    checkFs();
    document.addEventListener("fullscreenchange", checkFs);
    document.addEventListener("webkitfullscreenchange", checkFs);
    document.addEventListener("mozfullscreenchange", checkFs);
    window.addEventListener("resize", checkFs);
    return () => {
      document.removeEventListener("fullscreenchange", checkFs);
      document.removeEventListener("webkitfullscreenchange", checkFs);
      document.removeEventListener("mozfullscreenchange", checkFs);
      window.removeEventListener("resize", checkFs);
    };
  }, []);

  // Focus & visibility monitoring: catches tab shifts, touchpad gestures, and Alt+Tab even while staying in fullscreen
  useEffect(() => {
    if (stage !== "active") return;
    try {
      if (new URLSearchParams(window.location.search).get("mockFocusLost") === "true") {
        setIsExamFocused(false);
        return;
      }
    } catch {}

    const onFocus = () => setIsExamFocused(true);
    const onBlur = () => {
      setIsExamFocused(false);
      handleWarning("Tab or window switch detected — stay on the examination window!");
    };
    const onVis = () => {
      const active = document.visibilityState === "visible" && !document.hidden;
      setIsExamFocused(active);
      if (!active) {
        handleWarning("Tab or window switch detected — stay on the examination window!");
      }
    };
    const onInteract = () => setIsExamFocused(true);

    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    window.addEventListener("click", onInteract);
    window.addEventListener("pointerdown", onInteract);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("click", onInteract);
      window.removeEventListener("pointerdown", onInteract);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [stage]);

  // Monitor viewport dimensions for AI Side Panels (Ask Gemini / Edge Copilot)
  useEffect(() => {
    if (stage !== "active") return;
    const checkSidebar = () => {
      try {
        if (new URLSearchParams(window.location.search).get("mockSidebar") === "true") {
          setIsSidebarDetected(true);
          return;
        }
        // ONLY evaluate when in fullscreen!
        // In fullscreen, outerWidth and innerWidth are equal unless an AI side panel is docked.
        const isDomFs = !!(
          document.fullscreenElement ||
          (document as any).webkitFullscreenElement ||
          (window.innerHeight >= (window.screen.availHeight - 15) && window.innerWidth >= (window.screen.availWidth - 15))
        );
        if (!isDomFs) {
          setIsSidebarDetected(false);
          return;
        }

        const diff = window.outerWidth - window.innerWidth;
        setIsSidebarDetected(diff >= 280);
      } catch {
        setIsSidebarDetected(false);
      }
    };

    checkSidebar();
    window.addEventListener("resize", checkSidebar);
    const interval = setInterval(checkSidebar, 1500);

    return () => {
      window.removeEventListener("resize", checkSidebar);
      clearInterval(interval);
    };
  }, [stage]);

  // Block text selection across the examination page
  useEffect(() => {
    if (stage !== "active") return;
    const preventSelect = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      e.preventDefault();
      return false;
    };

    document.addEventListener("selectstart", preventSelect);
    return () => {
      document.removeEventListener("selectstart", preventSelect);
    };
  }, [stage]);

  // Screen capture & screenshot blocking listener
  useEffect(() => {
    if (stage !== "active") return;

    const handleScreenshotKeys = (e: KeyboardEvent) => {
      const k = (e.key || "").toLowerCase();
      const isScreenshotKey =
        k === "printscreen" ||
        k === "print" ||
        k === "snapshot" ||
        k === "meta" ||
        (e.metaKey && ["s", "p", "prtscn", "printscreen", "3", "4", "5"].includes(k)) ||
        ((e.metaKey || e.ctrlKey) && e.shiftKey && ["s", "3", "4", "5", "p"].includes(k)) ||
        (e.altKey && (k === "printscreen" || (e.shiftKey && k === "s")));

      if (isScreenshotKey) {
        triggerScreenshotBlock();
        try {
          if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText("ExamShield Security: Screen captures are strictly prohibited during examination.").catch(() => {});
          }
        } catch {}
      }
    };

    window.addEventListener("keydown", handleScreenshotKeys, true);
    window.addEventListener("keyup", handleScreenshotKeys, true);

    return () => {
      window.removeEventListener("keydown", handleScreenshotKeys, true);
      window.removeEventListener("keyup", handleScreenshotKeys, true);
    };
  }, [stage, triggerScreenshotBlock]);

  const toggleFullscreen = () => {
    const isFs = !!(
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement
    );
    if (isFs) {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      }
    } else {
      const el = document.documentElement as any;
      const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
      if (rfs) {
        rfs.call(el).catch(() => {});
      }
    }
  };

  // Start examination after accepting rules - initiates a distinct new session on backend
  const handleProceedToExam = async () => {
    if (!acceptedTerms) return;
    let newSid: string | null = null;
    try {
      const res = await api<{ session_id: string; status: string }>("/api/sessions/start", auth.access_token, {
        method: "POST",
        body: JSON.stringify({ exam_id: examId })
      });
      newSid = res.session_id;
      setSessionId(res.session_id);
    } catch (err) {
      console.error("Failed to start session:", err);
    }

    const el = document.documentElement as any;
    const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (rfs) {
      rfs.call(el).catch(() => {});
    }
    setStage("active");
    emit({
      session_id: newSid,
      exam_id: examId,
      event_type: "EXAM_STARTED",
      event_category: "SESSION",
      severity: "INFO",
      detection_source: "candidate_action",
      confidence: "CONFIRMED",
      event_description: `Candidate accepted proctoring terms and initiated examination ${examId}`,
      metadata: { exam_id: examId, session_id: newSid }
    });
  };

  // Stop examination handler - finalizes this specific candidate session
  const handleConfirmStopExam = async () => {
    setIsSubmittingStop(true);
    try {
      emit({
        session_id: sessionId,
        exam_id: examId,
        event_type: "EXAM_STOPPED",
        event_category: "SESSION",
        severity: "INFO",
        detection_source: "candidate_action",
        confidence: "CONFIRMED",
        event_description: "Candidate voluntarily stopped the examination",
        metadata: {
          session_id: sessionId,
          exam_id: examId,
          questions_answered: Object.keys(answers).length,
          total_questions: questions.length,
          time_remaining: left
        }
      });

      try {
        const q = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
        await api(`/api/exam/stop${q}`, auth.access_token, { method: "POST" });
      } catch {}

      if (stopHeartbeatRef.current) {
        stopHeartbeatRef.current();
      }

      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }

      setShowStopModal(false);
      setStage("ended");
    } catch {
      setShowStopModal(false);
      setStage("ended");
    } finally {
      setIsSubmittingStop(false);
    }
  };

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const currentQuestionData = questions[currentQ] || questions[0];
  const isCurrentMarked = marked.has(currentQ);

  // -------------------------------------------------------------
  // VIEW 1: PRE-EXAMINATION RULES & INSTRUCTIONS ("Start Examination")
  // -------------------------------------------------------------
  if (stage === "instructions") {
    return (
      <div className="min-h-screen bg-slate-100 p-4 sm:p-6 flex items-center justify-center font-sans">
        <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl border-2 border-blue-500 overflow-hidden flex flex-col">
          {/* Top Bar */}
          <div className="h-2 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 w-full" />

          {/* Header */}
          <div className="p-6 sm:p-8 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
                <Shield className="w-6 h-6 stroke-[2.2]" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">{examTitle}</h1>
                <p className="text-xs text-slate-500">{examDescription || "ExamShield Candidate Verification & Proctoring Briefing"}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-xs font-bold text-slate-800">{auth.name}</div>
                <div className="text-[11px] text-slate-500 font-mono">ID: {auth.id}</div>
              </div>
              <button
                onClick={() => onLogout?.()}
                className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:text-rose-600 hover:bg-slate-50 transition-colors"
                title="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Body Content */}
          <div className="p-6 sm:p-8 space-y-6 flex-1 overflow-y-auto">
            {/* Exam Quick Specs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80">
                <div className="text-[11px] font-semibold text-slate-500">Duration</div>
                <div className="text-base font-bold text-blue-600 mt-0.5">{durationMinutes} Minutes</div>
              </div>
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80">
                <div className="text-[11px] font-semibold text-slate-500">Total Questions</div>
                <div className="text-base font-bold text-slate-800 mt-0.5">{questions.length} Questions</div>
              </div>
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80">
                <div className="text-[11px] font-semibold text-slate-500">Format</div>
                <div className="text-base font-bold text-slate-800 mt-0.5">MCQ + Subjective</div>
              </div>
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80">
                <div className="text-[11px] font-semibold text-slate-500">Proctoring Mode</div>
                <div className="text-base font-bold text-emerald-600 mt-0.5">Strict Shield</div>
              </div>
            </div>

            {/* Rules & Anti-Cheating Guidelines */}
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-blue-600" />
                <span>Examination Rules & Anti-Cheating Regulations</span>
              </h2>

              <div className="space-y-2.5 text-xs text-slate-700 bg-slate-50 border border-slate-200/90 rounded-xl p-4 leading-relaxed">
                <div className="flex items-start gap-2.5">
                  <Monitor className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-slate-900">Mandatory Fullscreen Mode: </span>
                    The examination runs strictly in fullscreen. If you exit fullscreen, answering is immediately locked, the border pulses red, and an alert is logged.
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <Eye className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-slate-900">Tab Switching & Focus Loss: </span>
                    Switching tabs, minimizing your browser, or interacting with background windows is prohibited and recorded with exact durations.
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <Ban className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-slate-900">Prohibited Shortcuts & Actions: </span>
                    Copying, pasting, right-clicking, Alt+Tab, and Developer Tools (F12, Ctrl+Shift+I) are intercepted and flagged to the proctor.
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <Activity className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-slate-900">Heartbeat & Network Connectivity: </span>
                    Your connection stability is monitored in real-time. Do not close the window if your network slows down; it will automatically reconnect.
                  </div>
                </div>
              </div>
            </div>

            {/* Terms Checkbox */}
            <div className="p-4 bg-blue-50/60 border border-blue-200/70 rounded-xl">
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded border-blue-300 text-blue-600 focus:ring-blue-500 cursor-pointer flex-shrink-0"
                />
                <span className="text-xs font-semibold text-slate-800">
                  I confirm that I have read, understood, and accept all the examination rules and anti-cheating regulations.
                  I consent to active proctoring monitoring throughout this session.
                </span>
              </label>
            </div>
          </div>

          {/* Action Footer */}
          <div className="p-6 sm:p-8 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4">
            <div className="text-xs text-slate-500">
              {acceptedTerms ? (
                <span className="text-emerald-700 font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> Ready to launch examination
                </span>
              ) : (
                <span>Please check the box above to proceed.</span>
              )}
            </div>

            <button
              type="button"
              disabled={!acceptedTerms}
              onClick={handleProceedToExam}
              className="py-3 px-6 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-sm shadow-md shadow-blue-500/25 transition-all flex items-center gap-2 cursor-pointer"
            >
              <span>I Accept & Proceed to Examination</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // VIEW 2: EXAMINATION ENDED / COMPLETED SCREEN
  // -------------------------------------------------------------
  if (stage === "ended") {
    return (
      <div className="min-h-screen bg-slate-100 p-4 sm:p-6 flex items-center justify-center font-sans">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border-2 border-blue-500 overflow-hidden">
          <div className="h-2 bg-gradient-to-r from-blue-600 to-indigo-600 w-full" />
          <div className="p-8 sm:p-10 text-center">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-4 border border-blue-100 shadow-sm">
              <Shield className="w-8 h-8 stroke-[2.2]" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Examination Ended</h2>
            <p className="text-sm text-slate-600 mb-6">
              Your examination session has been safely closed and your responses have been preserved.
              The proctor has been notified.
            </p>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-left text-xs space-y-2 mb-6">
              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-500 font-medium">Candidate Name:</span>
                <span className="text-slate-800 font-semibold">{auth.name} ({auth.id})</span>
              </div>
              {sessionId && (
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500 font-medium">Session ID:</span>
                  <span className="text-blue-600 font-mono font-semibold">{sessionId}</span>
                </div>
              )}
              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-500 font-medium">Examination:</span>
                <span className="text-slate-800 font-semibold">{examTitle}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-500 font-medium">Questions Answered:</span>
                <span className="text-blue-600 font-semibold">{Object.keys(answers).length} of {questions.length}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500 font-medium">Session Status:</span>
                <span className="text-emerald-700 font-bold bg-emerald-100/70 px-2 py-0.5 rounded">Voluntarily Stopped</span>
              </div>
            </div>

            <button
              onClick={() => onLogout?.()}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl text-sm shadow-md shadow-blue-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Return to Sign In</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // VIEW 3: ACTIVE EXAMINATION VIEW
  // -------------------------------------------------------------
  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }}
      className="min-h-screen bg-slate-100/70 p-2.5 sm:p-3.5 flex flex-col font-sans select-none exam-no-select"
    >
      {/* Perimeter Border surrounding the entire examination viewport - shrinks & pulses red smoothly when fullscreen is exited or focus is lost */}
      <div
        className={`flex-1 rounded-2xl bg-white flex flex-col overflow-hidden ${
          isAnsweringLocked ? "fullscreen-warning-border" : "fullscreen-normal-border"
        }`}
      >
        {/* Top Header */}
        <header className="h-14 bg-white border-b border-slate-200/90 px-4 sm:px-6 flex items-center justify-between gap-3 text-xs sm:text-sm select-none z-10 flex-shrink-0">
          {/* Left: Logo & Exam Title */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 font-bold text-blue-600 tracking-tight text-base sm:text-lg">
              <Shield className="w-5 h-5 text-blue-600 fill-blue-50" />
              <span>ExamShield</span>
            </div>
            <div className="h-4 w-px bg-slate-200 hidden md:block" />
            <div className="font-semibold text-slate-800 text-xs sm:text-sm hidden sm:block truncate max-w-xs md:max-w-md">
              {examTitle}
            </div>
          </div>

          {/* Center: Inline Warning Notice */}
          {!fs ? (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 px-3.5 py-1 bg-rose-50 border border-rose-200 text-rose-900 rounded-lg text-xs font-medium shadow-xs"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 animate-pulse" />
              <span>Fullscreen exited — please return to fullscreen</span>
              <button
                type="button"
                onClick={toggleFullscreen}
                className="ml-1.5 px-2.5 py-0.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white font-semibold text-[11px] shadow-xs transition-colors cursor-pointer"
              >
                Return to Fullscreen
              </button>
            </div>
          ) : isSidebarDetected ? (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 px-3.5 py-1 bg-rose-50 border border-rose-200 text-rose-900 rounded-lg text-xs font-semibold shadow-xs animate-pulse"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
              <span>AI Sidebar Detected (Ask Gemini / Copilot) — close side panel to continue!</span>
            </div>
          ) : !isExamFocused ? (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 px-3.5 py-1 bg-rose-50 border border-rose-200 text-rose-900 rounded-lg text-xs font-semibold shadow-xs animate-pulse"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
              <span>Focus lost: Tab or app switch detected — return to examination window!</span>
            </div>
          ) : warning ? (
            <div
              role="status"
              aria-live="polite"
              className="hidden lg:flex items-center gap-2 px-3.5 py-1 bg-amber-50/90 border border-amber-200 text-amber-900 rounded-lg text-xs font-medium shadow-xs"
            >
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span>{warning}</span>
            </div>
          ) : null}

          {/* Right Controls */}
          <div className="flex items-center gap-2 sm:gap-2.5">
            {/* Network Status Pill */}
            <div
              data-testid="network"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                net === "STABLE"
                  ? "bg-emerald-50 border-emerald-200/90 text-emerald-800"
                  : net === "SLOW"
                  ? "bg-amber-50 border-amber-200/90 text-amber-800"
                  : "bg-rose-50 border-rose-200/90 text-rose-800"
              }`}
            >
              <Wifi className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Network:</span>
              <span>{net === "STABLE" ? "Stable" : net === "SLOW" ? "Slow" : "Down"}</span>
              {lat !== null && <span className="opacity-80">({Math.round(lat)} ms)</span>}
            </div>

            {/* Countdown Timer Pill */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-50 border border-blue-200/90 text-blue-800">
              <Clock className="w-3.5 h-3.5 text-blue-600" />
              <span>{fmt(left)}</span>
            </div>

            {/* Stop Examination Button (New Feature: Requirement 5) */}
            <button
              type="button"
              onClick={() => setShowStopModal(true)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 transition-colors shadow-xs cursor-pointer"
              title="Stop Examination"
            >
              <StopCircle className="w-3.5 h-3.5 text-rose-600" />
              <span>Stop Examination</span>
            </button>

            {/* Fullscreen Toggle */}
            <button
              type="button"
              onClick={toggleFullscreen}
              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                !fs
                  ? "border-rose-300 bg-rose-50 text-rose-700 animate-pulse"
                  : "border-slate-200 hover:bg-slate-50 text-slate-600 hover:text-slate-900"
              }`}
              title={fs ? "Exit Fullscreen" : "Enter Fullscreen"}
            >
              {fs ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* Small Screen Warning Fallback */}
        {warning && (
          <div className="lg:hidden bg-amber-50 border-b border-amber-200 px-4 py-1.5 text-xs text-amber-900 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <span className="truncate">{warning}</span>
          </div>
        )}

        {/* Main Examination View: Question Container + Right Palette */}
        <main className="flex-1 bg-slate-50/70 p-4 sm:p-6 flex flex-col lg:flex-row gap-5 overflow-auto">
          {/* Main Question Card */}
          <div className="flex-1 bg-white border border-slate-200/80 rounded-2xl p-6 sm:p-8 flex flex-col justify-between shadow-xs min-w-0 relative overflow-hidden">
            {/* Inactive Window / Minimized / Background App Privacy Protection Shield */}
            {isAnsweringLocked && (
              <div
                data-testid="privacy-shield-overlay"
                onClick={() => setIsExamFocused(true)}
                className="absolute inset-0 z-30 bg-slate-950/95 backdrop-blur-2xl flex flex-col items-center justify-center p-6 text-center text-white select-none animate-fadeIn cursor-pointer"
              >
                <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border-2 border-rose-500/80 text-rose-400 flex items-center justify-center mb-4 shadow-xl shadow-rose-500/20 animate-pulse">
                  <EyeOff className="w-8 h-8" />
                </div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-semibold uppercase tracking-wider mb-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                  <span>Security Privacy Shield Active</span>
                </div>
                <h3 className="text-lg font-bold text-white mb-2">
                  {!fs
                    ? "Fullscreen Mode Exited"
                    : isSidebarDetected
                    ? "AI Side Panel Detected (Ask Gemini / Copilot)"
                    : "Examination Window Inactive"}
                </h3>
                <p className="text-xs text-slate-300 max-w-md mb-5 leading-relaxed">
                  {!fs
                    ? "Question contents are hidden while outside fullscreen mode to protect examination integrity. Return to fullscreen mode to view questions."
                    : isSidebarDetected
                    ? "ExamShield detected a browser AI side panel (e.g. Ask Gemini / Copilot) or split-screen sharing exam context. Please close all browser sidebars to resume."
                    : "ExamShield detected a tab, window, or background application switch (e.g. Notepad, Discord, Snipping Tool). Question contents are obscured to prevent unauthorized screen captures."}
                </p>
                {!fs ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFullscreen();
                    }}
                    className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-xs shadow-lg shadow-blue-600/30 transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <Maximize className="w-4 h-4" />
                    <span>Return to Fullscreen to View Questions</span>
                  </button>
                ) : isSidebarDetected ? (
                  <div className="text-xs text-rose-300 font-medium bg-rose-950/60 border border-rose-600/40 px-3.5 py-1.5 rounded-lg flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-400" />
                    <span>Close the 'Ask Gemini' or browser side panel to continue</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsExamFocused(true);
                    }}
                    className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-xs shadow-lg shadow-blue-600/30 transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <Eye className="w-4 h-4" />
                    <span>Click Here to Resume Examination</span>
                  </button>
                )}
              </div>
            )}

            <div className={`transition-all duration-200 ${isAnsweringLocked ? "exam-content-obscured pointer-events-none select-none" : ""}`}>
              {/* Question Number */}
              <div className="text-xs sm:text-sm font-bold text-blue-600 tracking-wide uppercase">
                Question {currentQ + 1} of {questions.length}
              </div>

              {/* Question Title */}
              <h2 className="text-base sm:text-lg font-bold text-slate-900 mt-2 mb-6 leading-relaxed">
                {isAnsweringLocked ? "Exam Question Content Protected & Obscured" : currentQuestionData.title}
              </h2>

              {/* Fullscreen Paused or Focus Lost Notice */}
              {isAnsweringLocked && (
                <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-center justify-between gap-3 animate-fadeIn">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-rose-600 flex-shrink-0" />
                    <span>
                      {!fs
                        ? "Answering is locked while outside fullscreen mode."
                        : isSidebarDetected
                        ? "Answering is locked: Browser AI side panel (Ask Gemini) active. Close side panel to continue."
                        : "Answering is locked: Tab or window switch detected. Return focus to this window to continue."}
                    </span>
                  </div>
                  {!fs && (
                    <button
                      type="button"
                      onClick={toggleFullscreen}
                      className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer flex-shrink-0"
                    >
                      Return to Fullscreen
                    </button>
                  )}
                </div>
              )}

              {/* Options Area */}
              {currentQuestionData.type === "mcq" && currentQuestionData.options ? (
                <div className="space-y-3 max-w-3xl">
                  {(isAnsweringLocked
                    ? currentQuestionData.options.map(() => "••••••••••••••••••••••••••••••••••••••••")
                    : currentQuestionData.options
                  ).map((opt, i) => {
                    const isSelected = answers[currentQ] === opt;
                    return (
                      <button
                        key={i}
                        type="button"
                        disabled={isAnsweringLocked}
                        onClick={() => handleSelectOption(opt)}
                        className={`w-full text-left p-3.5 sm:p-4 rounded-xl border text-sm transition-all flex items-center gap-3.5 ${
                          isAnsweringLocked
                            ? "cursor-not-allowed opacity-80 border-slate-200 text-slate-600"
                            : isSelected
                            ? "border-blue-500 bg-blue-50/40 text-blue-950 font-medium ring-1 ring-blue-500 shadow-xs cursor-pointer"
                            : "border-slate-200 hover:border-slate-300 hover:bg-slate-50/80 text-slate-800 cursor-pointer"
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors ${
                            isSelected ? "border-blue-600 bg-blue-600" : "border-slate-300 bg-white"
                          }`}
                        >
                          {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </div>
                        <span className="text-xs sm:text-sm">{opt}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-3 max-w-3xl">
                  {/* Security Notice Pill above the text box */}
                  <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-blue-50/80 border border-blue-200/80 text-xs text-blue-900 font-medium">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-blue-600 flex-shrink-0" />
                      <span>
                        <strong className="font-bold text-blue-950">Direct Typing Only:</strong> Copying, pasting, and drag-and-drop are permanently blocked and logged.
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-blue-700 bg-white px-2 py-0.5 rounded-md border border-blue-200">
                      {(answers[currentQ] || "").length} chars
                    </span>
                  </div>

                  <div className="relative">
                    <textarea
                      disabled={isAnsweringLocked}
                      value={isAnsweringLocked ? "••••••••••••••••••••••••••••••••••••••••" : answers[currentQ] || ""}
                      onChange={(e) => {
                        if (isAnsweringLocked) return;
                        const inputType = (e.nativeEvent as any)?.inputType;
                        if (inputType === "insertFromPaste" || inputType === "insertFromDrop") {
                          e.preventDefault();
                          handleBlockedClipboardAction("PASTE", "Pasting is strictly prohibited in the exam text field. Please type your response directly.");
                          return;
                        }
                        handleSelectOption(e.target.value);
                      }}
                      onPaste={(e) => {
                        e.preventDefault();
                        handleBlockedClipboardAction("PASTE", "Pasting is strictly prohibited in the exam text field. Please type your response directly.");
                      }}
                      onCopy={(e) => {
                        e.preventDefault();
                        handleBlockedClipboardAction("COPY", "Copying examination answer content is strictly prohibited.");
                      }}
                      onCut={(e) => {
                        e.preventDefault();
                        handleBlockedClipboardAction("CUT", "Cutting examination answer content is strictly prohibited.");
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleBlockedClipboardAction("DROP", "Drag-and-drop text insertion is strictly prohibited.");
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        handleBlockedClipboardAction("CONTEXT_MENU", "Right-click context menu is disabled in the text box.");
                      }}
                      onSelect={(e) => {
                        // Immediately collapse selection so candidate cannot select text
                        const el = e.currentTarget;
                        if (el.selectionStart !== el.selectionEnd) {
                          el.selectionStart = el.value.length;
                          el.selectionEnd = el.value.length;
                          handleWarning("Selecting text inside the examination text box is prohibited.");
                        }
                      }}
                      onMouseUp={(e) => {
                        const el = e.currentTarget;
                        if (el.selectionStart !== el.selectionEnd) {
                          el.selectionStart = el.selectionEnd;
                        }
                      }}
                      onMouseMove={(e) => {
                        if (e.buttons === 1) {
                          const el = e.currentTarget;
                          if (el.selectionStart !== el.selectionEnd) {
                            el.selectionStart = el.selectionEnd;
                          }
                        }
                      }}
                      onKeyDown={(e) => {
                        if (isAnsweringLocked) return;
                        const k = e.key.toLowerCase();
                        const isCtrl = e.ctrlKey || e.metaKey;
                        if (isCtrl && (k === "v" || e.key === "Insert")) {
                          e.preventDefault();
                          handleBlockedClipboardAction("PASTE_SHORTCUT", "Paste shortcut (Ctrl+V) blocked! Pasting is prohibited in this field.");
                        } else if (isCtrl && (k === "c" || k === "x")) {
                          e.preventDefault();
                          handleBlockedClipboardAction("COPY_SHORTCUT", "Copy shortcut blocked! Copying text from this field is prohibited.");
                        } else if (isCtrl && k === "a") {
                          e.preventDefault();
                          handleWarning("Select All (Ctrl+A) is disabled in the examination text box.");
                        } else if (e.shiftKey && (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End" || e.key === "PageUp" || e.key === "PageDown")) {
                          e.preventDefault();
                          handleWarning("Text selection and highlighting are disabled in the examination text box.");
                        }
                      }}
                      placeholder={isAnsweringLocked ? "Return to examination to answer..." : "Type your detailed answer directly using your keyboard..."}
                      rows={7}
                      className={`w-full rounded-xl border p-4 text-sm resize-none transition-all font-sans leading-relaxed select-none exam-no-select ${
                        isAnsweringLocked
                          ? "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
                          : "border-slate-300 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-xs"
                      }`}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-500 px-1">
                    <span>Use your keyboard to provide a concise explanation.</span>
                    <span>Words: {(answers[currentQ] || "").trim() ? (answers[currentQ] || "").trim().split(/\s+/).length : 0}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Actions Row */}
            <div className="mt-8 pt-5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4">
              {/* Left: Mark for Review Checkbox */}
              <label
                className={`flex items-center gap-2.5 text-xs sm:text-sm font-semibold select-none ${
                  isAnsweringLocked ? "text-slate-400 cursor-not-allowed" : "text-slate-700 cursor-pointer"
                }`}
              >
                <input
                  type="checkbox"
                  disabled={isAnsweringLocked}
                  checked={isCurrentMarked}
                  onChange={toggleMarkForReview}
                  className={`w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 ${
                    isAnsweringLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                  }`}
                />
                <span>Mark for Review</span>
              </label>

              {/* Right: Previous & Next Controls */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={currentQ === 0}
                  onClick={() => selectQuestion(currentQ - 1)}
                  className="px-4 sm:px-5 py-2 border border-slate-300 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 font-semibold rounded-xl text-xs sm:text-sm transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Previous</span>
                </button>

                {currentQ < questions.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => selectQuestion(currentQ + 1)}
                    className="px-5 sm:px-6 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold rounded-xl text-xs sm:text-sm shadow-md shadow-blue-500/20 transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Next</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowStopModal(true)}
                    className="px-5 sm:px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-xs sm:text-sm shadow-md shadow-emerald-600/20 transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Submit Exam</span>
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right Sidebar: Question Palette (Exact match to Reference Design) */}
          <div className={`w-full lg:w-80 bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 flex flex-col shadow-xs flex-shrink-0 transition-all ${
            isAnsweringLocked ? "opacity-25 filter blur-[2px] pointer-events-none select-none" : ""
          }`}>
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-slate-900 text-sm">Question Palette</h3>
              <Info className="w-4 h-4 text-slate-400 hover:text-slate-600 cursor-pointer" />
            </div>

            {/* 5-Column Grid of Question Buttons */}
            <div className="grid grid-cols-5 gap-2.5 mb-6">
              {questions.map((q, idx) => {
                const isCurrent = idx === currentQ;
                const isAnswered = answers[idx] !== undefined && answers[idx].trim() !== "";
                const isMarked = marked.has(idx);

                let btnStyle = "border border-slate-200 text-slate-700 bg-white hover:bg-slate-50";

                if (isCurrent) {
                  btnStyle = "border-2 border-blue-600 text-blue-600 font-bold bg-white ring-2 ring-blue-100 shadow-sm";
                } else if (isMarked) {
                  btnStyle = "bg-purple-200 text-purple-900 font-semibold hover:bg-purple-300";
                } else if (isAnswered) {
                  btnStyle = "bg-blue-600 text-white font-semibold shadow-xs hover:bg-blue-700";
                }

                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => selectQuestion(idx)}
                    className={`h-10 w-full rounded-xl text-xs sm:text-sm flex items-center justify-center transition-all cursor-pointer ${btnStyle}`}
                  >
                    {q.id}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="mt-auto pt-4 border-t border-slate-100 space-y-2.5 text-xs text-slate-600">
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-3.5 h-3.5 rounded bg-blue-600 flex-shrink-0" />
                  <span>Answered</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3.5 h-3.5 rounded border border-slate-300 bg-white flex-shrink-0" />
                  <span>Not Visited</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3.5 h-3.5 rounded border-2 border-blue-600 bg-white flex-shrink-0" />
                  <span>Current</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3.5 h-3.5 rounded bg-purple-200 flex-shrink-0" />
                  <span>Marked for Review</span>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Confirmation Dialog: Stop Examination */}
      {showStopModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 sm:p-7 relative">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-4 border border-rose-100">
              <AlertCircle className="w-6 h-6 stroke-[2.2]" />
            </div>

            <h3 className="text-lg font-bold text-center text-slate-900 mb-2">
              Are you sure you want to stop the examination?
            </h3>
            <p className="text-xs sm:text-sm text-center text-slate-600 mb-6 leading-relaxed">
              Stopping the examination will finalize your submission. Your activity will be safely recorded,
              the proctor will be notified, and you will not be able to resume this session.
            </p>

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={isSubmittingStop}
                onClick={() => setShowStopModal(false)}
                className="flex-1 py-2.5 px-4 border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold rounded-xl text-xs sm:text-sm transition-all cursor-pointer"
              >
                Continue Examination
              </button>
              <button
                type="button"
                disabled={isSubmittingStop}
                onClick={handleConfirmStopExam}
                className="flex-1 py-2.5 px-4 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white font-semibold rounded-xl text-xs sm:text-sm shadow-md shadow-rose-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSubmittingStop ? (
                  <span>Stopping...</span>
                ) : (
                  <>
                    <StopCircle className="w-4 h-4" />
                    <span>Stop Examination</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Netflix-Grade Screenshot Blankout Shield Overlay */}
      {screenshotBlocked && (
        <div
          data-testid="netflix-screenshot-shield"
          className="fixed inset-0 z-[2147483647] bg-black flex flex-col items-center justify-center text-white p-6 select-none animate-fadeIn"
          style={{ backgroundColor: "#000000" }}
        >
          <div className="w-20 h-20 rounded-3xl bg-zinc-900 border border-zinc-800 text-rose-500 flex items-center justify-center mb-6 shadow-2xl animate-pulse">
            <CameraOff className="w-10 h-10" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-wide uppercase mb-3 text-center">
            Screen Capture Prohibited
          </h2>
          <p className="text-zinc-400 text-sm sm:text-base max-w-md text-center leading-relaxed mb-6 font-medium">
            Capturing screenshots (Greenshot, Snipping Tool, PrintScreen) is strictly prohibited. The screen is blanked to prevent examination data leakage.
          </p>
          <div className="px-4 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-500">
            Security Incident Logged • Screen Blackout Active
          </div>
        </div>
      )}
    </div>
  );
}
