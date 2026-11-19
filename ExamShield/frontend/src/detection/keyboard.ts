import type { Detector } from "./types";
type Rule = { type: string; cat: string; sev: "LOW" | "MEDIUM" | "HIGH"; label: string; warn: string };
const R = (type: string, cat: string, sev: Rule["sev"], label: string, warn: string): Rule => ({ type, cat, sev, label, warn });

export function matchShortcut(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">): Rule | null {
  const k = (e.key || "").toLowerCase();

  // Screenshot / screen capture detection (Greenshot, PrintScreen, Win+Shift+S, Win+S, Cmd+Shift+3/4/5, Ctrl+Shift+S, etc.)
  if (k === "printscreen" || k === "print" || k === "snapshot" || (e as any).code === "PrintScreen" || (e as any).keyCode === 44) {
    const prefix = e.altKey ? "Alt+" : e.ctrlKey ? "Ctrl+" : e.shiftKey ? "Shift+" : "";
    const label = `${prefix}PrintScreen (Greenshot / System Screenshot)`;
    return R("SCREENSHOT_ATTEMPT", "SCREENSHOT", "HIGH", label, "Screenshot attempt detected (Greenshot / PrintScreen) — screen capture is strictly prohibited.");
  }
  // Greenshot custom hotkeys (Alt+G, Ctrl+Shift+G, Shift+PrintScreen)
  if ((e.ctrlKey && e.shiftKey && k === "g") || (e.altKey && k === "g")) {
    return R("SCREENSHOT_ATTEMPT", "SCREENSHOT", "HIGH", "Greenshot Hotkey", "Greenshot screen capture shortcut intercepted — screen capture is strictly prohibited.");
  }
  // Windows Snipping Tool (Win+Shift+S, Win+S, Cmd+Shift+3/4/5, custom snip hotkeys)
  if (e.metaKey && ["s", "p", "prtscn", "printscreen", "3", "4", "5"].includes(k)) {
    const label = `Win+${e.shiftKey ? "Shift+" : ""}${k.toUpperCase()}`;
    return R("SCREENSHOT_ATTEMPT", "SCREENSHOT", "HIGH", label, "Screen capture shortcut detected — screen capture is strictly prohibited.");
  }
  if (e.ctrlKey && e.shiftKey && ["s", "3", "4", "5", "p"].includes(k)) {
    return R("SCREENSHOT_ATTEMPT", "SCREENSHOT", "HIGH", `Ctrl+Shift+${k.toUpperCase()}`, "Screen capture shortcut detected — screen capture is strictly prohibited.");
  }
  // Copyfish OCR Screen Capture shortcut (Alt+Shift+C, Ctrl+Shift+C, Alt+C)
  if ((e.altKey && e.shiftKey && k === "c") || (e.ctrlKey && e.shiftKey && k === "c") || (e.altKey && k === "c")) {
    return R("SCREENSHOT_ATTEMPT", "SCREENSHOT", "HIGH", "Copyfish OCR Shortcut", "Copyfish screen OCR shortcut intercepted — screen captures are strictly prohibited.");
  }
  // Context Menu & Google Lens shortcuts (ContextMenu key, Shift+F10)
  if (k === "contextmenu" || (e.shiftKey && k === "f10")) {
    return R("RIGHT_CLICK", "MOUSE", "MEDIUM", "ContextMenu Shortcut", "Right-click context menu and Google Lens are permanently disabled during the examination.");
  }
  // Monica AI Agent shortcut (Ctrl+M, Alt+M, Meta+M)
  if ((e.ctrlKey || e.altKey || e.metaKey) && k === "m") {
    return R("AI_COPILOT_SHORTCUT", "BROWSER", "HIGH", "Monica AI Shortcut", "AI Copilot shortcut intercepted — external AI agents are strictly prohibited.");
  }

  if (k === "f12") return R("F12_ATTEMPT", "DEVTOOLS", "HIGH", "F12", "Developer tools shortcut detected — please close it.");
  if (e.ctrlKey && e.shiftKey && ["i", "j", "c"].includes(k)) return R("DEVTOOLS_SHORTCUT", "DEVTOOLS", "HIGH", `Ctrl+Shift+${k.toUpperCase()}`, "Developer tools shortcut detected — please close it.");
  if (e.ctrlKey && e.shiftKey && k === "t") return R("BROWSER_SHORTCUT", "BROWSER", "MEDIUM", "Ctrl+Shift+T", "Browser shortcut detected — stay on the examination.");
  if (e.ctrlKey && e.shiftKey && k === "tab") return R("BROWSER_SHORTCUT", "BROWSER", "MEDIUM", "Ctrl+Shift+Tab", "Browser shortcut detected — stay on the examination.");
  if (e.ctrlKey && !e.shiftKey && ["c", "v", "x", "a"].includes(k)) {
    const t = { c: "COPY_ATTEMPT", v: "PASTE_ATTEMPT", x: "CUT_ATTEMPT", a: "SELECT_ALL_ATTEMPT" }[k as "c"];
    return R(t, "CLIPBOARD", "MEDIUM", `Ctrl+${k.toUpperCase()}`, "Clipboard activity detected — avoid copy and paste.");
  }
  if (e.ctrlKey && !e.shiftKey && ["t", "n", "w", "tab", "r", "l", "p", "u"].includes(k)) {
    const type = k === "p" ? "PRINT_ATTEMPT" : k === "r" ? "RELOAD_ATTEMPT" : "BROWSER_SHORTCUT";
    return R(type, "BROWSER", "MEDIUM", `Ctrl+${k.length > 1 ? "Tab" : k.toUpperCase()}`, "Browser shortcut detected — stay on the examination.");
  }
  if (e.altKey && k === "f4") return R("OS_SHORTCUT", "OS", "MEDIUM", "Alt+F4", "Window-close shortcut detected.");
  if (e.altKey && (k === "tab" || (e as any).code === "Tab")) return R("ALT_TAB", "FOCUS", "HIGH", "Alt+Tab", "Alt + Tab window-switch shortcut detected — stay on the examination.");
  if (e.metaKey && (k === "tab" || (e as any).code === "Tab")) return R("WINDOW_SWITCH", "FOCUS", "HIGH", "Win+Tab", "Win + Tab window-switch shortcut detected — stay on the examination.");
  if (e.metaKey && ["d", "l", "e"].includes(k)) return R("OS_SHORTCUT", "OS", "MEDIUM", `Win+${k.toUpperCase()}`, "System shortcut detected.");
  return null;
}

export const keyboardDetector: Detector = (emit, doc = document) => {
  const clearClip = () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText("ExamShield: Screen captures and copying are prohibited during examination.").catch(() => {});
      }
    } catch {}
  };

  const handleKey = (ev: Event) => {
    const e = ev as KeyboardEvent;
    const r = matchShortcut(e);
    if (!r) return;
    if (r.type === "SCREENSHOT_ATTEMPT" || r.type === "AI_COPILOT_SHORTCUT" || r.type === "SELECT_ALL_ATTEMPT" || r.type === "COPY_ATTEMPT" || r.type === "PRINT_ATTEMPT") {
      ev.preventDefault?.();
      if (r.type === "SCREENSHOT_ATTEMPT" || r.type === "AI_COPILOT_SHORTCUT" || r.type === "COPY_ATTEMPT") {
        clearClip();
      }
      if (r.type === "SCREENSHOT_ATTEMPT") {
        try {
          (window as any).__activateNetflixBlackout?.(r.label);
          doc.documentElement?.classList?.add("netflix-blackout-active");
          doc.body?.classList?.add("netflix-blackout-active");
        } catch {}
      }
    }
    emit({
      event_type: r.type,
      event_category: r.cat,
      severity: r.sev,
      detection_source: "keyboard",
      confidence: "CONFIRMED",
      event_description: `Keyboard shortcut observed: ${r.label}`,
      metadata: { shortcut: r.label },
      warning: r.warn
    });
  };

  doc.addEventListener("keydown", handleKey, true);
  doc.addEventListener("keyup", handleKey, true);
  return () => {
    doc.removeEventListener("keydown", handleKey, true);
    doc.removeEventListener("keyup", handleKey, true);
  };
};
