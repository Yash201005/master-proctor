import type { Detector } from "./types";

export interface DetectedExtension {
  id: string;
  name: string;
  category: "AI_ASSISTANT" | "DEVELOPER_TOOL" | "SCRIPT_MANAGER" | "WRITING_ASSISTANT" | "TRANSLATOR" | "UTILITY";
  risk: "HIGH" | "MEDIUM" | "LOW" | "INFO";
  detectionMethod: "DOM_PROBE" | "WINDOW_GLOBAL" | "STYLE_MUTATION" | "CONTENT_SCRIPT";
  details: string;
}

let adBlockChecked = false;
let adBlockDetected = false;

export function scanBrowserExtensions(doc: Document = document, win: any = window): DetectedExtension[] {
  const found: DetectedExtension[] = [];
  const seen = new Set<string>();

  const add = (ext: DetectedExtension) => {
    if (!seen.has(ext.id)) {
      seen.add(ext.id);
      found.push(ext);
    }
  };

  try {
    // 1. Google Gemini / Chrome Ask Gemini & AI Side Panels
    const isSidePanelOpen =
      (win.outerWidth && win.innerWidth && win.outerWidth - win.innerWidth >= 280) ||
      (win.screen?.availWidth && win.innerWidth && win.screen.availWidth - win.innerWidth >= 280);

    if (
      doc.querySelector(
        "side-panel, #side-panel, [data-side-panel], [side-panel], gemini-side-panel, #ask-gemini, .ask-gemini-root, [data-gemini], [aria-label*='Gemini' i], [title*='Gemini' i]"
      ) ||
      win.gemini ||
      win.__GEMINI__ ||
      win.googleGemini ||
      win.ai ||
      win.model ||
      win.chrome?.sidePanel ||
      (isSidePanelOpen && doc.querySelector("[class*='side-panel'], [id*='side-panel']"))
    ) {
      add({
        id: "ask_gemini",
        name: "Google Gemini / Ask Gemini Side Panel",
        category: "AI_ASSISTANT",
        risk: "HIGH",
        detectionMethod: "DOM_PROBE",
        details: "Detected active Google Gemini AI side panel / assistant capable of reading screen context"
      });
    }

    // 2. ChatGPT & OpenAI Copilots
    if (
      doc.querySelector(
        "#chatgpt-sidebar, [data-chatgpt], #chatgpt-floating-button, .chatgpt-extension, #chatgpt-icon, #chatgpt-root, [class*='chatgpt' i], [id*='chatgpt' i]"
      ) ||
      win.__CHATGPT__ ||
      win.chatgpt
    ) {
      add({
        id: "chatgpt",
        name: "ChatGPT / OpenAI Copilot Assistant",
        category: "AI_ASSISTANT",
        risk: "HIGH",
        detectionMethod: "DOM_PROBE",
        details: "Detected active ChatGPT copilot floating interface in DOM"
      });
    }

    // 3. Monica: All-In-One AI Assist & Smartest AI Agent (Side Panel & Agent)
    const isMonicaMargin = doc.body && parseFloat(win.getComputedStyle ? win.getComputedStyle(doc.body).marginRight || "0" : "0") >= 250;
    if (
      doc.querySelector(
        "monica-root, monica-app, monica-app-box, monica-main-frame, #monica-app, #monica-content-root, .monica-sidebar, .monica-quick-action-icon, monica-action-bar, [data-monica], [data-monica-root], div[monica-version], div[monica-id], [class*='monica' i], [id*='monica' i], iframe[src*='monica.im'], iframe[src*='fddhonoimnefhimaflglackihmiphoip'], [src*='fddhonoimnefhimaflglackihmiphoip']"
      ) ||
      doc.body?.classList?.contains?.("monica-sidebar-open") ||
      doc.documentElement?.hasAttribute("data-monica") ||
      doc.body?.hasAttribute("data-monica") ||
      win.monica ||
      win.__monica ||
      win.__MONICA__ ||
      win._monica_ ||
      win.MonicaAgent ||
      win.__monica_bridge__ ||
      isMonicaMargin
    ) {
      add({
        id: "monica_ai",
        name: "Monica: All-In-One AI Assist & Smartest AI Agent",
        category: "AI_ASSISTANT",
        risk: "HIGH",
        detectionMethod: "DOM_PROBE",
        details: "Detected active Monica AI Assistant side panel & floating copilot capable of reading exam questions"
      });
    }

    // 4. Copyfish Free OCR Software & UI.Vision Screen Capture Tool
    const hasCopyfishOrUiVision = () => {
      try {
        if (
          doc.querySelector(
            "[id*='copyfish' i], [class*='copyfish' i], #copyfish-select-box, #copyfishModal, .copyfish-dialog, .copyfish-overlay, iframe[src*='eenjdnjldapjajjofmldgmkjaienebbj'], [src*='copyfish' i], [href*='copyfish' i], [id*='ui-vision' i], [class*='ui-vision' i], [id*='ocr' i], [class*='ocr' i], #ocr-select-container, #ocr-select-div, #ocr-overlay, [id*='a9t9' i], [class*='a9t9' i]"
          )
        ) return true;
        const bText = doc.body?.innerText || "";
        if (bText.includes("UI.Vision") || bText.includes("Select an area with the mouse")) return true;
      } catch {}
      return false;
    };
    if (
      hasCopyfishOrUiVision() ||
      win.copyfish ||
      win.__copyfish__ ||
      win.__COPYFISH__ ||
      win.uivision ||
      win.a9t9
    ) {
      add({
        id: "copyfish_ocr",
        name: "Copyfish Free OCR Software (UI.Vision)",
        category: "UTILITY",
        risk: "HIGH",
        detectionMethod: "DOM_PROBE",
        details: "Detected Copyfish / UI.Vision OCR screen capture tool actively attempting to screenshot and OCR exam questions"
      });
    }

    // 5. Always active Window - Always Visible (Visibility & Focus Spoofer)
    const isVisibilitySpoofed = () => {
      try {
        if (Object.prototype.hasOwnProperty.call(doc, "visibilityState")) return true;
        if (Object.prototype.hasOwnProperty.call(doc, "hidden")) return true;
        const dVis = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
        if (dVis?.get && !dVis.get.toString().includes("[native code]")) return true;
        if (typeof doc.hasFocus === "function" && !doc.hasFocus.toString().includes("[native code]")) return true;
      } catch {}
      return false;
    };

    if (
      isVisibilitySpoofed() ||
      doc.querySelector("[data-always-active], [data-active-window], script[src*='always-active']") ||
      win.__always_active__ ||
      win.__alwaysVisible__
    ) {
      add({
        id: "always_active_window",
        name: "Always active Window - Always Visible",
        category: "UTILITY",
        risk: "HIGH",
        detectionMethod: "WINDOW_GLOBAL",
        details: "Detected active visibility state & focus spoofer extension attempting to bypass proctoring focus checks"
      });
    }

    // 6. Don't F*** With Paste (Clipboard Policy Bypass)
    const isClipboardSpoofed = () => {
      try {
        if (!EventTarget.prototype.addEventListener.toString().includes("[native code]")) return true;
        if (!doc.addEventListener.toString().includes("[native code]")) return true;
      } catch {}
      return false;
    };

    if (
      isClipboardSpoofed() ||
      doc.querySelector("[data-allow-paste], [data-paste-unblocker], [src*='nkgllhigbddgockgcifahgeakgbakhbh']") ||
      win.__dont_f_with_paste__
    ) {
      add({
        id: "dont_f_with_paste",
        name: "Don't F*** With Paste",
        category: "UTILITY",
        risk: "HIGH",
        detectionMethod: "WINDOW_GLOBAL",
        details: "Detected clipboard unblocker extension attempting to bypass exam copy and paste restrictions"
      });
    }

    // 7. Chat with all AI models / Aitopia / Sider AI Agent & Sidebar
    const hasAitopiaOrSider = () => {
      try {
        if (
          doc.querySelector(
            "aitopia-root, aitopia-app, aitopia-sidebar, #aitopia-root, [data-aitopia], [class*='aitopia' i], [id*='aitopia' i], sider-root, sider-app, sider-sidebar, [data-sider], [class*='sider' i], [id*='sider' i], #chathub-, [data-chathub], [class*='chathub' i], [id*='ai-sidebar' i], [class*='ai-sidebar' i], [data-ai-sidebar], deepseek-sidebar, div[id*='deepseek' i], div[class*='deepseek' i], div[class*='selection-popup' i], div[class*='quick-bar' i], div[class*='floating-menu' i]"
          )
        ) return true;
        const bText = doc.body?.innerText || "";
        if (bText.includes("AITOPIA") || bText.includes("Compare with GPT") || bText.includes("Paste selection Web Access")) return true;
      } catch {}
      return false;
    };
    if (
      hasAitopiaOrSider() ||
      win.aitopia ||
      win.chathub ||
      win.chatAll ||
      win.sider ||
      win.__sider__ ||
      win.__AI_SIDEBAR__ ||
      win.__deepseek__
    ) {
      add({
        id: "chat_all_ai_models",
        name: "Chat with all AI models (Aitopia / Sider / DeepSeek / Gemini)",
        category: "AI_ASSISTANT",
        risk: "HIGH",
        detectionMethod: "DOM_PROBE",
        details: "Detected active Aitopia / Sider AI floating assistant & overlapping chat sidebar"
      });
    }

    // 8. Other Third-party AI Copilots & Overlapping Assistant Tools
    if (
      doc.querySelector(
        "#sider-container, #harpa-root, #merlin-container, [id*='scispace' i], [id*='maxai' i], [class*='floating-toolbar' i], [class*='action-bar' i]"
      )
    ) {
      add({
        id: "ai_copilot",
        name: "AI Browser Copilot (Sider / Harpa / Merlin / MaxAI)",
        category: "AI_ASSISTANT",
        risk: "HIGH",
        detectionMethod: "DOM_PROBE",
        details: "Detected third-party multi-model AI sidebar / overlapping assistant in DOM"
      });
    }

    // 9. Foreign Injected Overlapping Elements Outside #root
    if (doc.body) {
      try {
        const foreignChildren = Array.from(doc.body.children || []).filter((el: any) => {
          if (!el || el.id === "root" || el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "LINK") return false;
          try {
            const style = win.getComputedStyle ? win.getComputedStyle(el) : null;
            const pos = style?.position;
            const zIdx = parseInt(style?.zIndex || "0", 10);
            const isFixed = pos === "fixed" || pos === "absolute";
            return isFixed || zIdx > 100 || Boolean(el.shadowRoot) || el.tagName.includes("-");
          } catch {
            return false;
          }
        });
        if (foreignChildren.length > 0) {
          // Immediately hide foreign overlays so they cannot display or overlap
          foreignChildren.forEach((el: any) => {
            try {
              el.style?.setProperty?.("display", "none", "important");
              el.style?.setProperty?.("visibility", "hidden", "important");
              el.style?.setProperty?.("pointer-events", "none", "important");
            } catch {}
          });
          add({
            id: "foreign_injected_overlay",
            name: "Foreign Injected Browser Extension / Overlay",
            category: "AI_ASSISTANT",
            risk: "HIGH",
            detectionMethod: "DOM_PROBE",
            details: `Detected and neutralized ${foreignChildren.length} foreign overlapping injected element(s) outside application root`
          });
        }
      } catch {}
    }

    // 4. Userscript Managers (Tampermonkey, Violentmonkey, Greasemonkey)
    if (
      win.tampermonkey ||
      win.GM_info ||
      win.violentmonkey ||
      win.GM_xmlhttpRequest ||
      doc.querySelector("[data-tampermonkey], [data-violentmonkey]")
    ) {
      add({
        id: "tampermonkey",
        name: "Tampermonkey / Userscript Manager",
        category: "SCRIPT_MANAGER",
        risk: "HIGH",
        detectionMethod: "WINDOW_GLOBAL",
        details: "Detected active Userscript engine (can execute arbitrary cheating scripts)"
      });
    }

    // 5. Developer Inspection Tools (React / Redux / Vue DevTools)
    if (
      win.__REACT_DEVTOOLS_GLOBAL_HOOK__ ||
      win.__REDUX_DEVTOOLS_EXTENSION__ ||
      win.__VUE_DEVTOOLS_GLOBAL_HOOK__ ||
      win.__ANGULAR_DEVTOOLS_GLOBAL_HOOK__
    ) {
      add({
        id: "devtools_extension",
        name: "Developer Inspection Tools (React/Redux DevTools)",
        category: "DEVELOPER_TOOL",
        risk: "HIGH",
        detectionMethod: "WINDOW_GLOBAL",
        details: "Detected browser developer hooks attached to window object"
      });
    }

    // 6. Grammarly Writing Assistant
    if (
      doc.querySelector(
        "grammarly-desktop-integration, grammarly-extension, [data-grammarly-part], [data-grammarly-shadow-root]"
      ) ||
      doc.body?.hasAttribute("data-new-gr-c-s-check-loaded") ||
      doc.documentElement?.hasAttribute("data-gr-ext-installed") ||
      win.grammarly
    ) {
      add({
        id: "grammarly",
        name: "Grammarly Writing Assistant",
        category: "WRITING_ASSISTANT",
        risk: "MEDIUM",
        detectionMethod: "DOM_PROBE",
        details: "Detected Grammarly content script injection in DOM"
      });
    }

    // 7. QuillBot & Paraphrasing Tools
    if (doc.querySelector("quillbot-extension, [data-quillbot], .quillbot-smart-paste")) {
      add({
        id: "quillbot",
        name: "QuillBot Paraphrasing Assistant",
        category: "WRITING_ASSISTANT",
        risk: "MEDIUM",
        detectionMethod: "DOM_PROBE",
        details: "Detected QuillBot rewriting overlay elements"
      });
    }

    // 8. LanguageTool
    if (doc.querySelector("lt-toolbar, lt-mirror, [data-lt-installed], lt-comp-container")) {
      add({
        id: "languagetool",
        name: "LanguageTool Grammar Checker",
        category: "WRITING_ASSISTANT",
        risk: "MEDIUM",
        detectionMethod: "DOM_PROBE",
        details: "Detected LanguageTool proofreading nodes"
      });
    }

    // 9. AdBlocker / Content Filter (uBlock Origin, AdBlock Plus, AdGuard)
    if (!adBlockChecked && doc.body) {
      adBlockChecked = true;
      try {
        const bait = doc.createElement("div");
        bait.className = "ads-banner adsbox pub_300x250 pub_300x250m pub_728x90 text-ad textAd text_ad text_ads text-ads text-ad-links";
        bait.style.position = "absolute";
        bait.style.left = "-9999px";
        bait.style.top = "-9999px";
        bait.style.width = "1px";
        bait.style.height = "1px";
        doc.body.appendChild(bait);
        const style = win.getComputedStyle ? win.getComputedStyle(bait) : null;
        adBlockDetected =
          bait.offsetHeight === 0 ||
          bait.offsetParent === null ||
          style?.display === "none" ||
          style?.visibility === "hidden";
        bait.remove();
      } catch {}
    }

    if (adBlockDetected) {
      add({
        id: "adblocker",
        name: "AdBlocker / Content Filter (uBlock / AdBlock / AdGuard)",
        category: "UTILITY",
        risk: "LOW",
        detectionMethod: "STYLE_MUTATION",
        details: "Detected active ad-blocking stylesheet / filter rule injection"
      });
    }

    // 10. Password Managers & Autofill (Bitwarden, 1Password, LastPass, Dashlane)
    if (
      doc.querySelector(
        "div[id*='bitwarden'], [data-bw-autofill], com-1password-button, [data-1p-ignore], [data-lastpass-root], [data-dashlane-rid], [data-nordpass-icon], [data-protonpass-icon]"
      ) ||
      win.bitwarden ||
      win.__1Password__ ||
      win.lpInProcess ||
      win.__dashlane__
    ) {
      add({
        id: "password_manager",
        name: "Password Manager & Autofill Utility",
        category: "UTILITY",
        risk: "LOW",
        detectionMethod: "DOM_PROBE",
        details: "Detected password manager extension autofill injection"
      });
    }

    // 11. Translation Extensions (Google Translate, DeepL, TransOver)
    if (
      doc.querySelector(".goog-te-banner-frame, #google_translate_element, deepl-input-container, [data-deepl], transover-type") ||
      win.google?.translate
    ) {
      add({
        id: "translator",
        name: "Language Translation Extension (Google/DeepL)",
        category: "TRANSLATOR",
        risk: "MEDIUM",
        detectionMethod: "DOM_PROBE",
        details: "Detected in-page translation overlay"
      });
    }

    // 12. Dark Reader & Theme Modifiers
    if (
      doc.querySelector('meta[name="darkreader"], style.darkreader') ||
      doc.documentElement?.hasAttribute("data-darkreader-mode")
    ) {
      add({
        id: "darkreader",
        name: "Dark Reader / Visual Theme Modifier",
        category: "UTILITY",
        risk: "LOW",
        detectionMethod: "STYLE_MUTATION",
        details: "Detected custom stylesheet injection for night mode"
      });
    }

    // 13. Screen Capture & Screen Recording Extensions (Loom, Nimbus, Awesome Screenshot)
    if (
      doc.querySelector("[id*='loom' i], [class*='loom' i], [id*='nimbus' i], [class*='nimbus' i], [id*='screencastify' i]") ||
      win.__LOOM__ ||
      win.nimbus
    ) {
      add({
        id: "screen_recorder_extension",
        name: "Screen Capture / Recording Extension (Loom / Nimbus)",
        category: "UTILITY",
        risk: "HIGH",
        detectionMethod: "DOM_PROBE",
        details: "Detected browser extension screen recording overlay"
      });
    }

    // 14. Generic chrome-extension / moz-extension URLs
    const extElements = doc.querySelectorAll("[src*='chrome-extension://'], [href*='chrome-extension://'], [src*='moz-extension://']");
    if (extElements.length > 0) {
      add({
        id: "generic_extension_script",
        name: `Injected Extension Resources (${extElements.length} elements)`,
        category: "UTILITY",
        risk: "MEDIUM",
        detectionMethod: "CONTENT_SCRIPT",
        details: `Detected ${extElements.length} third-party extension resource URIs in DOM`
      });
    }
  } catch (err) {
    console.error("Extension scan error:", err);
  }

  return found;
}

export const extensionDetector: Detector = (emit, doc = document) => {
  let lastReportedKey = "";

  const runScan = () => {
    const list = scanBrowserExtensions(doc, doc.defaultView ?? window);
    const key = list.map((e) => e.id).sort().join(",");

    // Emit whenever new extensions are detected or list changes
    if (list.length > 0 && key !== lastReportedKey) {
      lastReportedKey = key;
      const highRisk = list.filter((e) => e.risk === "HIGH");
      const sev = highRisk.length > 0 ? "HIGH" : "MEDIUM";
      const names = list.map((e) => e.name).join(", ");

      emit({
        event_type: "BROWSER_EXTENSIONS_DETECTED",
        event_category: "SYSTEM",
        severity: sev,
        detection_source: "extension_scanner",
        confidence: "CONFIRMED",
        event_description: `Detected ${list.length} browser extension(s): ${names}`,
        metadata: {
          extensions: list,
          count: list.length,
          has_high_risk: highRisk.length > 0
        },
        warning: highRisk.length > 0
          ? `Unauthorized extension detected (${highRisk[0].name}). Please disable browser extensions during the exam.`
          : undefined
      });
    }
  };

  // Safe interval scans (no MutationObserver to prevent recursive main thread locks / crashes)
  const t1 = setTimeout(runScan, 1000);
  const t2 = setTimeout(runScan, 3000);
  const interval = setInterval(runScan, 5000);

  return () => {
    clearTimeout(t1);
    clearTimeout(t2);
    clearInterval(interval);
  };
};
