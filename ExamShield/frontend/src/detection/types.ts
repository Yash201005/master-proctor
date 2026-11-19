export type Severity = "INFO" | "LOW" | "MEDIUM" | "HIGH";
export interface DetectedEvent {
  event_id: string;
  session_id?: string | null;
  candidate_id?: string;
  exam_id?: string;
  event_type: string;
  event_category: string;
  severity: Severity;
  detection_source: string;
  confidence: "CONFIRMED" | "INFERRED";
  event_description: string;
  timestamp: string;
  duration?: number;
  metadata: Record<string, unknown>;
  warning?: string;
}
export type Emit = (
  e: Omit<DetectedEvent, "event_id" | "timestamp" | "metadata"> & {
    session_id?: string | null;
    metadata?: Record<string, unknown>;
  }
) => void;
export type Detector = (emit: Emit, target?: Document) => () => void;

