import { useEffect, useRef } from "react";
import { api } from "./api";
import { ALL_DETECTORS } from "./detection/browser";
import type { DetectedEvent, Emit } from "./detection/types";

const uid = () => crypto.randomUUID().replace(/-/g, "");

// Suppresses identical events within windowMs (duplicate-warning protection); retries failed submissions.
export function useEventPipeline(
  token: string,
  onWarning: (w: string) => void,
  windowMs = 1500,
  sessionId?: string | null,
  active = true,
  examId = "EXAM-001"
) {
  const last = useRef<Record<string, number>>({});
  const queue = useRef<DetectedEvent[]>([]);
  const sessionRef = useRef<string | null | undefined>(sessionId);
  const examRef = useRef<string>(examId);

  useEffect(() => {
    sessionRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    examRef.current = examId;
  }, [examId]);

  const flush = async () => {
    while (queue.current.length) {
      const e = queue.current[0];
      try {
        await api("/api/events", token, { method: "POST", body: JSON.stringify(e) });
        queue.current.shift();
      } catch {
        return;
      }
    }
  };

  const emit: Emit = (e) => {
    const k = e.event_type + (e.metadata?.shortcut ?? "");
    const n = Date.now();
    const thresh = (e.event_type === "TAB_SWITCH" || e.event_type === "ALT_TAB" || e.event_type === "WINDOW_SWITCH" || e.event_type === "WINDOW_FOCUS_LOST") ? 600 : windowMs;
    if (n - (last.current[k] ?? 0) < thresh) return;
    last.current[k] = n;
    const { warning, ...rest } = e as any;
    queue.current.push({
      ...rest,
      event_id: uid(),
      exam_id: (rest as any).exam_id || examRef.current || "EXAM-001",
      session_id: e.session_id || sessionRef.current || undefined,
      timestamp: new Date().toISOString(),
      metadata: e.metadata ?? {}
    });
    if (warning) onWarning(warning);
    void flush();
  };

  useEffect(() => {
    if (!active) return;
    const offs = ALL_DETECTORS.map((d) => d(emit));
    const t = setInterval(flush, 5000);
    return () => {
      offs.forEach((o) => o());
      clearInterval(t);
    };
    /* eslint-disable-next-line */
  }, [token, active]);

  return emit;
}
