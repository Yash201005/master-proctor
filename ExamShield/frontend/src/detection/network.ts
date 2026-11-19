export type NetState = "STABLE" | "SLOW" | "DOWN";
export interface NetConfig { intervalMs: number; slowMs: number; failuresToDisconnect: number }
export const DEFAULT_NET: NetConfig = { intervalMs: 5000, slowMs: 800, failuresToDisconnect: 2 };
export function classify(latency: number | null, failures: number, cfg = DEFAULT_NET): NetState {
  if (latency === null) return failures >= cfg.failuresToDisconnect ? "DOWN" : "SLOW";
  return latency > cfg.slowMs ? "SLOW" : "STABLE";
}
export function startHeartbeat(ping: () => Promise<void>, onChange: (s: NetState, latency: number | null) => void, cfg = DEFAULT_NET) {
  let state: NetState = "STABLE"; let failures = 0; let stopped = false;
  const tick = async () => {
    const t0 = performance.now(); let lat: number | null = null;
    try { await ping(); lat = Math.round(performance.now() - t0); failures = 0; } catch { failures++; }
    if (stopped) return;
    if (lat === null && failures < cfg.failuresToDisconnect) return;
    const next = classify(lat, failures, cfg);
    if (next !== state || next === "STABLE") { const changed = next !== state; state = next; onChange(next, lat); void changed; }
  };
  void tick(); const id = setInterval(tick, cfg.intervalMs);
  return () => { stopped = true; clearInterval(id); };
}
