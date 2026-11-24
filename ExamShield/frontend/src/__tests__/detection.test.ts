import { describe, it, expect, vi, afterEach } from "vitest";
import { matchShortcut } from "../detection/keyboard";
import { keyboardDetector } from "../detection/keyboard";
import { clipboardDetector, contextMenuDetector, fullscreenDetector, focusDetector } from "../detection/browser";
import { classify, startHeartbeat } from "../detection/network";
import { scanBrowserExtensions } from "../detection/extensions";

const k = (key: string, o: any = {}) => new KeyboardEvent("keydown", { key, ...o });
afterEach(() => vi.useRealTimers());

describe("keyboard", () => {
  it("matches clipboard, devtools, browser shortcuts", () => {
    expect(matchShortcut({ key: "c", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false })?.type).toBe("COPY_ATTEMPT");
    expect(matchShortcut({ key: "F12", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false })?.type).toBe("F12_ATTEMPT");
    expect(matchShortcut({ key: "I", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false })?.cat).toBe("DEVTOOLS");
    expect(matchShortcut({ key: "p", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false })?.type).toBe("PRINT_ATTEMPT");
    expect(matchShortcut({ key: "PrintScreen", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false })?.type).toBe("SCREENSHOT_ATTEMPT");
    expect(matchShortcut({ key: "s", ctrlKey: false, shiftKey: true, altKey: false, metaKey: true })?.type).toBe("SCREENSHOT_ATTEMPT");
    // Remapped Win+S shortcut
    expect(matchShortcut({ key: "s", ctrlKey: false, shiftKey: false, altKey: false, metaKey: true })?.type).toBe("SCREENSHOT_ATTEMPT");
    expect(matchShortcut({ key: "x", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false })).toBeNull();
  });
  it("emits confirmed event on keydown", () => {
    const emit = vi.fn(); const off = keyboardDetector(emit); document.dispatchEvent(k("v", { ctrlKey: true }));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ event_type: "PASTE_ATTEMPT", confidence: "CONFIRMED" })); off();
  });
  it("emits screenshot event on PrintScreen", () => {
    const emit = vi.fn(); const off = keyboardDetector(emit); document.dispatchEvent(k("PrintScreen"));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ event_type: "SCREENSHOT_ATTEMPT", severity: "HIGH" })); off();
  });
  it("intercepts Greenshot shortcuts (Alt+PrintScreen, Shift+PrintScreen, Alt+G)", () => {
    expect(matchShortcut({ key: "PrintScreen", ctrlKey: false, shiftKey: false, altKey: true, metaKey: false })?.type).toBe("SCREENSHOT_ATTEMPT");
    expect(matchShortcut({ key: "PrintScreen", ctrlKey: false, shiftKey: true, altKey: false, metaKey: false })?.type).toBe("SCREENSHOT_ATTEMPT");
    expect(matchShortcut({ key: "g", ctrlKey: false, shiftKey: false, altKey: true, metaKey: false })?.type).toBe("SCREENSHOT_ATTEMPT");
    expect(matchShortcut({ key: "g", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false })?.type).toBe("SCREENSHOT_ATTEMPT");
  });
  it("emits screenshot event on Win+S custom screenshot hotkey", () => {
    const emit = vi.fn(); const off = keyboardDetector(emit); document.dispatchEvent(k("s", { metaKey: true }));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ event_type: "SCREENSHOT_ATTEMPT", severity: "HIGH" })); off();
  });
  it("intercepts Copyfish OCR shortcut (Alt+Shift+C)", () => {
    expect(matchShortcut({ key: "c", ctrlKey: false, shiftKey: true, altKey: true, metaKey: false })?.type).toBe("SCREENSHOT_ATTEMPT");
    expect(matchShortcut({ key: "c", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false })?.type).toBe("SCREENSHOT_ATTEMPT");
  });
  it("intercepts Monica AI shortcut (Ctrl+M)", () => {
    expect(matchShortcut({ key: "m", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false })?.type).toBe("AI_COPILOT_SHORTCUT");
  });
});

describe("extensions detector", () => {
  it("detects injected DOM elements and globals", () => {
    const fakeDoc = {
      querySelector: (selector: string) => selector.includes("chatgpt") ? {} : null,
      querySelectorAll: () => [],
      body: { hasAttribute: () => false },
      documentElement: { hasAttribute: () => false }
    } as any;
    const exts = scanBrowserExtensions(fakeDoc, {});
    expect(exts.length).toBeGreaterThan(0);
    expect(exts[0].id).toBe("chatgpt");
    expect(exts[0].risk).toBe("HIGH");
  });
  it("detects Monica AI Agent", () => {
    const fakeDoc = {
      querySelector: (selector: string) => selector.includes("monica") ? {} : null,
      querySelectorAll: () => [],
      body: { hasAttribute: () => false, classList: { contains: () => false } },
      documentElement: { hasAttribute: () => false }
    } as any;
    const exts = scanBrowserExtensions(fakeDoc, {});
    const monica = exts.find((e) => e.id === "monica_ai");
    expect(monica).toBeDefined();
    expect(monica?.risk).toBe("HIGH");
  });
  it("detects Copyfish OCR Software", () => {
    const fakeDoc = {
      querySelector: (selector: string) => selector.includes("copyfish") ? {} : null,
      querySelectorAll: () => [],
      body: { hasAttribute: () => false, classList: { contains: () => false } },
      documentElement: { hasAttribute: () => false }
    } as any;
    const exts = scanBrowserExtensions(fakeDoc, {});
    const copyfish = exts.find((e) => e.id === "copyfish_ocr");
    expect(copyfish).toBeDefined();
    expect(copyfish?.risk).toBe("HIGH");
  });
  it("detects Always Active Window Visibility Spoofer", () => {
    const fakeDoc = {
      querySelector: (selector: string) => selector.includes("always-active") ? {} : null,
      querySelectorAll: () => [],
      body: { hasAttribute: () => false, classList: { contains: () => false } },
      documentElement: { hasAttribute: () => false }
    } as any;
    const exts = scanBrowserExtensions(fakeDoc, { __always_active__: true });
    const spoofer = exts.find((e) => e.id === "always_active_window");
    expect(spoofer).toBeDefined();
    expect(spoofer?.risk).toBe("HIGH");
  });
});
describe("browser", () => {
  it("clipboard events never record content", () => {
    const emit = vi.fn(); const off = clipboardDetector(emit); document.dispatchEvent(new Event("copy"));
    expect(emit.mock.calls[0][0].event_type).toBe("COPY_ATTEMPT"); expect(JSON.stringify(emit.mock.calls[0][0])).not.toMatch(/clipboardData/); off();
  });
  it("right-click", () => { const emit = vi.fn(); const off = contextMenuDetector(emit); document.dispatchEvent(new Event("contextmenu")); expect(emit).toHaveBeenCalledOnce(); off(); });
  it("fullscreen exit", () => { const emit = vi.fn(); const off = fullscreenDetector(emit); document.dispatchEvent(new Event("fullscreenchange"));
    expect(emit.mock.calls[0][0].event_type).toBe("FULLSCREEN_EXIT"); off(); });
  it("tab switch is confirmed; blur alone is only inferred", () => {
    const emit = vi.fn(); const off = focusDetector(emit); window.dispatchEvent(new Event("blur"));
    expect(emit.mock.calls[0][0]).toMatchObject({ event_type: "WINDOW_FOCUS_LOST", confidence: "INFERRED" });
    window.dispatchEvent(new Event("focus")); expect(emit.mock.calls[1][0].event_type).toBe("WINDOW_FOCUS_REGAINED");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange"));
    expect(emit.mock.calls[2][0]).toMatchObject({ event_type: "TAB_SWITCH", confidence: "CONFIRMED" }); off();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
  it("detects Alt+Tab when Alt key was pressed before blur", () => {
    const emit = vi.fn(); const off = focusDetector(emit);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt" }));
    window.dispatchEvent(new Event("blur"));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ event_type: "ALT_TAB", severity: "HIGH", confidence: "CONFIRMED" }));
    off();
  });
  it("detects tab/desktop shift in fullscreen mode via blur", () => {
    const emit = vi.fn();
    Object.defineProperty(document, "fullscreenElement", { value: document.documentElement, configurable: true });
    const off = focusDetector(emit);
    window.dispatchEvent(new Event("blur"));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ event_type: "TAB_SWITCH", severity: "HIGH", confidence: "CONFIRMED" }));
    off();
    Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
  });
});
describe("network", () => {
  it("classifies", () => { expect(classify(100, 0)).toBe("STABLE"); expect(classify(2000, 0)).toBe("SLOW"); expect(classify(null, 2)).toBe("DOWN"); });
  it("detects loss and restoration", async () => {
    vi.useFakeTimers(); let ok = true; const states: string[] = [];
    const stop = startHeartbeat(async () => { if (!ok) throw new Error("x"); }, (s) => states.push(s), { intervalMs: 100, slowMs: 800, failuresToDisconnect: 2 });
    await vi.advanceTimersByTimeAsync(50); ok = false; await vi.advanceTimersByTimeAsync(350); ok = true; await vi.advanceTimersByTimeAsync(150);
    expect(states).toContain("DOWN"); expect(states.at(-1)).toBe("STABLE"); stop();
  });
});


