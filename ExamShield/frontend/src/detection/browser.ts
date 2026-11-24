import type { Detector } from "./types";
import { keyboardDetector } from "./keyboard";
import { extensionDetector } from "./extensions";
import { voiceIsolationDetector } from "./audio";
export const clipboardDetector: Detector = (emit, doc = document) => {
  const mk = (type: string, word: string) => () => emit({
    event_type: type, event_category: "CLIPBOARD", severity: "MEDIUM",
    detection_source: "clipboard_event", confidence: "CONFIRMED", event_description: `${word} event observed (content not recorded)`,
    warning: "Clipboard activity detected — avoid copy and paste."
  });
  const hs: [string, () => void][] = [["copy", mk("COPY_ATTEMPT", "Copy")], ["paste", mk("PASTE_ATTEMPT", "Paste")], ["cut", mk("CUT_ATTEMPT", "Cut")]];
  hs.forEach(([n, f]) => doc.addEventListener(n, f)); return () => hs.forEach(([n, f]) => doc.removeEventListener(n, f));
};
export const contextMenuDetector: Detector = (emit, doc = document) => {
  const h = (e: Event) => {
    try {
      e.preventDefault();
      e.stopPropagation();
      (e as any).stopImmediatePropagation?.();
    } catch {}
    emit({
      event_type: "RIGHT_CLICK",
      event_category: "MOUSE",
      severity: "MEDIUM",
      detection_source: "contextmenu",
      confidence: "CONFIRMED",
      event_description: "Right-click context menu (Google Lens / Inspect) intercepted and blocked",
      warning: "Right-click is permanently disabled during the examination. Google Lens and context menus are prohibited."
    });
    return false;
  };
  doc.addEventListener("contextmenu", h, { capture: true, passive: false });
  const win = doc.defaultView || (typeof window !== "undefined" ? window : null);
  if (win && win !== (doc as any)) {
    try {
      win.addEventListener("contextmenu", h, { capture: true, passive: false });
    } catch {}
  }
  return () => {
    doc.removeEventListener("contextmenu", h, { capture: true });
    if (win && win !== (doc as any)) {
      try {
        win.removeEventListener("contextmenu", h, { capture: true });
      } catch {}
    }
  };
};
export const dragDetector: Detector = (emit, doc = document) => {
  const h = () => emit({
    event_type: "DRAG_DROP_ATTEMPT", event_category: "MOUSE", severity: "LOW", detection_source: "drag_event",
    confidence: "CONFIRMED", event_description: "Drag-and-drop attempt observed"
  });
  doc.addEventListener("dragstart", h); doc.addEventListener("drop", h);
  return () => { doc.removeEventListener("dragstart", h); doc.removeEventListener("drop", h); };
};
export const fullscreenDetector: Detector = (emit, doc = document) => {
  let exitAt: number | null = null;
  const h = () => {
    if (doc.fullscreenElement) {
      emit({
        event_type: "FULLSCREEN_RESTORED", event_category: "FULLSCREEN", severity: "INFO", detection_source: "fullscreenchange",
        confidence: "CONFIRMED", event_description: "Fullscreen entered or restored", duration: exitAt ? (Date.now() - exitAt) / 1000 : undefined
      });
      exitAt = null;
    } else {
      exitAt = Date.now();
      emit({
        event_type: "FULLSCREEN_EXIT", event_category: "FULLSCREEN", severity: "MEDIUM", detection_source: "fullscreenchange",
        confidence: "CONFIRMED", event_description: "Fullscreen exited", warning: "Fullscreen exited — please return to fullscreen."
      });
    }
  };
  doc.addEventListener("fullscreenchange", h); return () => doc.removeEventListener("fullscreenchange", h);
};
// Tab/focus: detects Alt+Tab, Win+Tab, visibility loss (Tab Switch), and window blur.
export const focusDetector: Detector = (emit, doc = document) => {
  const win = doc.defaultView ?? window;
  let lostAt: number | null = null;
  let hidden = false;
  let altDown = false;
  let lastAltDownTime = 0;
  let metaDown = false;
  let lastMetaDownTime = 0;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Alt" || e.code?.startsWith("Alt") || e.altKey) {
      altDown = true;
      lastAltDownTime = Date.now();
    }
    if (e.key === "Meta" || e.code?.startsWith("Meta") || e.metaKey) {
      metaDown = true;
      lastMetaDownTime = Date.now();
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === "Alt" || e.code?.startsWith("Alt")) {
      altDown = false;
    }
    if (e.key === "Meta" || e.code?.startsWith("Meta")) {
      metaDown = false;
    }
  };

  const lost = (
    type: string,
    src: string,
    conf: "CONFIRMED" | "INFERRED",
    desc: string,
    warn: string,
    sev: "LOW" | "MEDIUM" | "HIGH" = "MEDIUM",
    meta: Record<string, any> = {}
  ) => {
    if (lostAt === null) lostAt = Date.now();
    emit({
      event_type: type,
      event_category: "FOCUS",
      severity: sev,
      detection_source: src,
      confidence: conf,
      event_description: desc,
      warning: warn,
      metadata: meta
    });
  };

  const back = (src: string) => {
    if (lostAt === null) return;
    const d = (Date.now() - lostAt) / 1000;
    lostAt = null;
    emit({
      event_type: "WINDOW_FOCUS_REGAINED",
      event_category: "FOCUS",
      severity: "INFO",
      detection_source: src,
      confidence: "CONFIRMED",
      event_description: `Returned to the examination window (${d.toFixed(1)}s away)`,
      duration: d
    });
  };

  const blur = () => {
    const isAlt = altDown || (Date.now() - lastAltDownTime < 2500);
    const isMeta = metaDown || (Date.now() - lastMetaDownTime < 2500);

    if (isAlt) {
      lost(
        "ALT_TAB",
        "alt_tab_shortcut",
        "CONFIRMED",
        "Alt + Tab window-switch shortcut detected — candidate switched away from examination",
        "Alt + Tab detected — stay on the examination window!",
        "HIGH",
        { shortcut: "Alt+Tab" }
      );
    } else if (isMeta) {
      lost(
        "WINDOW_SWITCH",
        "meta_switch_shortcut",
        "CONFIRMED",
        "Win + Tab window-switch shortcut detected — candidate switched away from examination",
        "Window switch detected — stay on the examination window!",
        "HIGH",
        { shortcut: "Win+Tab" }
      );
    } else if (doc.fullscreenElement) {
      lost(
        "TAB_SWITCH",
        "fullscreen_touchpad_switch",
        "CONFIRMED",
        "Switched away from examination in fullscreen mode (touchpad gesture or tab shift)",
        "Tab shift or window switch detected — avoid leaving the examination window!",
        "HIGH",
        { fullscreen: true, detection: "touchpad_or_tab" }
      );
    } else if (!hidden) {
      lost(
        "WINDOW_FOCUS_LOST",
        "window_blur",
        "INFERRED",
        "Window lost focus (cause not determined)",
        "Focus left the examination window."
      );
    }
  };

  const vis = () => {
    if (doc.visibilityState === "hidden") {
      hidden = true;
      const isAlt = altDown || (Date.now() - lastAltDownTime < 2500);
      const isMeta = metaDown || (Date.now() - lastMetaDownTime < 2500);

      if (isAlt) {
        lost(
          "ALT_TAB",
          "alt_tab_shortcut",
          "CONFIRMED",
          "Alt + Tab window-switch shortcut detected — page became hidden",
          "Alt + Tab detected — stay on the examination window!",
          "HIGH",
          { shortcut: "Alt+Tab" }
        );
      } else if (isMeta) {
        lost(
          "WINDOW_SWITCH",
          "meta_switch_shortcut",
          "CONFIRMED",
          "Win + Tab window-switch shortcut detected — page became hidden",
          "Window switch detected — stay on the examination window!",
          "HIGH",
          { shortcut: "Win+Tab" }
        );
      } else {
        lost(
          "TAB_SWITCH",
          doc.fullscreenElement ? "fullscreen_tab_switch" : "visibilitychange",
          "CONFIRMED",
          doc.fullscreenElement
            ? "Tab or desktop switch detected during fullscreen mode (touchpad gesture or shortcut)"
            : "Page became hidden (tab switch or minimise)",
          "Suspicious activity detected — avoid switching tabs or leaving the examination.",
          "HIGH",
          { fullscreen: !!doc.fullscreenElement }
        );
      }
    } else {
      hidden = false;
      back("visibilitychange");
    }
  };

  const focus = () => {
    altDown = false;
    metaDown = false;
    back("window_focus");
  };

  // Active polling guard: catches touchpad gesture desktop switches even if OS suppresses blur events
  const pollInterval = setInterval(() => {
    const isDocFocused = typeof doc.hasFocus === "function" ? doc.hasFocus() : true;
    const isDocHidden = doc.visibilityState === "hidden" || (doc as any).hidden;

    if (!isDocFocused || isDocHidden) {
      if (lostAt === null) {
        const isAlt = altDown || (Date.now() - lastAltDownTime < 2500);
        const isMeta = metaDown || (Date.now() - lastMetaDownTime < 2500);
        if (isAlt) {
          lost(
            "ALT_TAB",
            "alt_tab_shortcut",
            "CONFIRMED",
            "Alt + Tab window-switch shortcut detected — candidate switched away from examination",
            "Alt + Tab detected — stay on the examination window!",
            "HIGH",
            { shortcut: "Alt+Tab" }
          );
        } else if (isMeta) {
          lost(
            "WINDOW_SWITCH",
            "meta_switch_shortcut",
            "CONFIRMED",
            "Win + Tab window-switch shortcut detected — candidate switched away from examination",
            "Window switch detected — stay on the examination window!",
            "HIGH",
            { shortcut: "Win+Tab" }
          );
        } else {
          lost(
            "TAB_SWITCH",
            doc.fullscreenElement ? "fullscreen_touchpad_switch" : "active_focus_guard",
            "CONFIRMED",
            doc.fullscreenElement
              ? "Switched away from examination in fullscreen mode (touchpad gesture or tab shift)"
              : "Examination lost focus (switched away via touchpad or taskbar)",
            "Tab or desktop shift detected — avoid leaving the examination window!",
            "HIGH",
            { fullscreen: !!doc.fullscreenElement }
          );
        }
      }
    } else if (lostAt !== null) {
      back("active_focus_guard");
    }
  }, 250);

  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("keyup", onKeyUp, true);
  doc.addEventListener("visibilitychange", vis);
  win.addEventListener("blur", blur);
  win.addEventListener("focus", focus);

  return () => {
    clearInterval(pollInterval);
    doc.removeEventListener("keydown", onKeyDown, true);
    doc.removeEventListener("keyup", onKeyUp, true);
    doc.removeEventListener("visibilitychange", vis);
    win.removeEventListener("blur", blur);
    win.removeEventListener("focus", focus);
  };
};
export const devtoolsHeuristic: Detector = (emit, doc = document) => {
  const win = doc.defaultView ?? window; let flagged = false;
  const t = setInterval(() => {
    const open = win.outerWidth - win.innerWidth > 200 || win.outerHeight - win.innerHeight > 200;
    if (open && !flagged) {
      flagged = true; emit({
        event_type: "DEVTOOLS_SUSPECTED", event_category: "DEVTOOLS", severity: "MEDIUM", detection_source: "window_size_heuristic",
        confidence: "INFERRED", event_description: "Window size difference suggests docked developer tools (heuristic, not confirmed)", warning: "Possible developer tools detected."
      });
    }
    if (!open) flagged = false;
  }, 2000);
  return () => clearInterval(t);
};
export const navigationDetector: Detector = (emit, doc = document) => {
  const win = doc.defaultView ?? window;
  const h = (e: Event) => {
    e.preventDefault(); (e as BeforeUnloadEvent).returnValue = ""; emit({
      event_type: "NAVIGATION_ATTEMPT", event_category: "NAVIGATION", severity: "MEDIUM",
      detection_source: "beforeunload", confidence: "CONFIRMED", event_description: "Attempt to leave or reload the page", warning: "Navigation attempt detected."
    });
  };
  win.addEventListener("beforeunload", h); return () => win.removeEventListener("beforeunload", h);
};
export const sidebarDetector: Detector = (emit, doc = document) => {
  const win = doc.defaultView ?? window;
  let sidebarActive = false;

  const check = () => {
    try {
      const isFs = !!(
        doc.fullscreenElement ||
        (doc as any).webkitFullscreenElement ||
        (win.innerHeight >= (win.screen.height - 15) && win.innerWidth >= (win.screen.width - 15))
      );

      // Only evaluate docked sidebar reduction when in fullscreen
      if (!isFs) {
        if (sidebarActive) {
          sidebarActive = false;
        }
        return;
      }

      // In fullscreen, outerWidth and innerWidth are equal unless an AI side panel (e.g. Ask Gemini / Monica) is open
      const diff = win.outerWidth - win.innerWidth;
      const isMonicaDocked = doc.body && parseFloat(win.getComputedStyle ? win.getComputedStyle(doc.body).marginRight || "0" : "0") >= 250;
      const isSplit = diff >= 280 || isMonicaDocked;

      if (isSplit && !sidebarActive) {
        sidebarActive = true;
        emit({
          event_type: "SIDEBAR_DETECTED",
          event_category: "BROWSER",
          severity: "HIGH",
          detection_source: "sidebar_monitor",
          confidence: "CONFIRMED",
          event_description: `Browser AI side panel detected: Ask Gemini / Copilot / Monica side panel active (${Math.round(diff || 300)}px reduction in viewport)`,
          warning: "Browser side panel detected (Ask Gemini / Monica / Copilot). Close the side panel immediately to continue the exam.",
          metadata: { reduced_px: Math.round(diff || 300) }
        });
      } else if (!isSplit && sidebarActive) {
        sidebarActive = false;
        emit({
          event_type: "SIDEBAR_CLOSED",
          event_category: "BROWSER",
          severity: "INFO",
          detection_source: "sidebar_monitor",
          confidence: "CONFIRMED",
          event_description: "Browser side panel closed; full examination viewport restored."
        });
      }
    } catch {}
  };

  const timer = setInterval(check, 1500);
  win.addEventListener("resize", check);

  return () => {
    clearInterval(timer);
    win.removeEventListener("resize", check);
  };
};

export const ALL_DETECTORS = [keyboardDetector, clipboardDetector, contextMenuDetector, dragDetector, fullscreenDetector, focusDetector, devtoolsHeuristic, navigationDetector, extensionDetector, sidebarDetector, voiceIsolationDetector];
export { voiceIsolationDetector };
