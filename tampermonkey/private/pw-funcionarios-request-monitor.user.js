// ==UserScript==
// @name         PW Funcionarios Request Monitor
// @namespace    pw-funcionarios-request-monitor
// @version      0.2.1
// @description  Request monitor for PokerWeb funcionarios password/access debugging.
// @author       xhpc007 + Codex
// @match        https://japanopt.pokerweb.com.br/cb/funcionarios*
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(() => {
  "use strict";

  const KEY = "__PW_FUNC_REQ_MONITOR__";
  const STORAGE_KEY = "PW_FUNC_REQ_MONITOR_LOGS_V02";
  const INTERCEPT_SUBMIT = false;
  const win = pageWindow();
  const state = win[KEY] || {
    logs: loadLogs(),
    installed: false
  };
  win[KEY] = state;

  function pageWindow() {
    try {
      return typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    } catch (_) {
      return window;
    }
  }

  function loadLogs() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveLogs() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.logs));
    } catch (_) {}
  }

  function nowText() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
  }

  function maskBody(value) {
    return String(value || "")
      .replace(/((?:senha|password|pass)[^=&]*=)[^&]*/gi, "$1[PASSWORD]")
      .replace(/((?:senha|password|pass)[^:]*:\s*["'])[^"']*/gi, "$1[PASSWORD]");
  }

  function short(value, max = 1200) {
    const text = String(value || "");
    return text.length > max ? `${text.slice(0, max)}...` : text;
  }

  function shouldLog(url, body) {
    return /funcionarios|acesso|senha|password|identitytoolkit/i.test(`${url || ""} ${body || ""}`);
  }

  function shouldIntercept(url, body) {
    if (!INTERCEPT_SUBMIT) return false;
    const haystack = `${url || ""} ${body || ""}`;
    return /senha|password|pass/i.test(haystack) && /funcionarios|acesso|identitytoolkit/i.test(haystack);
  }

  function push(entry) {
    state.logs.push({
      time: nowText(),
      ...entry
    });
    if (state.logs.length > 300) state.logs.shift();
    saveLogs();
    console.log("[PW-FUNC-MON]", state.logs[state.logs.length - 1]);
    renderPanel();
  }

  function logRows() {
    return [
      ["time", "kind", "method", "status", "url", "body", "response"],
      ...state.logs.map(row => [
        row.time,
        row.kind,
        row.method,
        row.status ?? "",
        row.url,
        row.body || "",
        row.response || ""
      ])
    ].map(cols => cols.map(cell => String(cell ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ")).join("\t")).join("\n");
  }

  function copyText(text) {
    try {
      if (typeof GM_setClipboard === "function") {
        GM_setClipboard(text);
        return;
      }
    } catch (_) {}
    navigator.clipboard?.writeText(text);
  }

  function installHooks() {
    if (state.installed) return;
    state.installed = true;

    const originalFetch = win.fetch;
    if (typeof originalFetch === "function") {
      win.fetch = async function (...args) {
        const url = String(args[0]?.url || args[0] || "");
        const method = String(args[1]?.method || "GET").toUpperCase();
        const body = maskBody(args[1]?.body || "");
        if (shouldIntercept(url, body)) {
          push({
            kind: "fetch-intercept",
            method,
            status: "BLOCKED",
            url,
            body: short(body),
            response: "blocked by PW Funcionarios Monitor"
          });
          return new Response("", { status: 200, statusText: "PW Monitor Blocked" });
        }
        const response = await originalFetch.apply(this, args);
        if (shouldLog(url || response.url, body)) {
          let responseText = "";
          try {
            responseText = short(maskBody(await response.clone().text()), 800);
          } catch (_) {}
          push({
            kind: "fetch",
            method,
            status: response.status,
            url: response.url || url,
            body: short(body),
            response: responseText
          });
        }
        return response;
      };
    }

    const OriginalXHR = win.XMLHttpRequest;
    if (typeof OriginalXHR === "function") {
      win.XMLHttpRequest = function () {
        const xhr = new OriginalXHR();
        let method = "GET";
        let url = "";
        let body = "";

        const originalOpen = xhr.open;
        xhr.open = function (m, u, ...rest) {
          method = String(m || "GET").toUpperCase();
          url = String(u || "");
          return originalOpen.call(this, m, u, ...rest);
        };

        const originalSend = xhr.send;
        xhr.send = function (b) {
          body = maskBody(b || "");
          if (shouldIntercept(url, body)) {
            push({
              kind: "xhr-intercept",
              method,
              status: "BLOCKED",
              url,
              body: short(body),
              response: "blocked by PW Funcionarios Monitor"
            });
            return undefined;
          }
          return originalSend.call(this, b);
        };

        xhr.addEventListener("loadend", () => {
          if (!shouldLog(url, body)) return;
          push({
            kind: "xhr",
            method,
            status: xhr.status,
            url,
            body: short(body),
            response: short(maskBody(xhr.responseText || ""), 800)
          });
        });

        return xhr;
      };
    }

    try {
      const proto = win.HTMLFormElement && win.HTMLFormElement.prototype;
      if (proto && !proto.__pwFuncMonPatched) {
        proto.__pwFuncMonPatched = true;
        const originalSubmit = proto.submit;
        const originalRequestSubmit = proto.requestSubmit;

        proto.submit = function (...args) {
          if (logFormSnapshot(this, "form.submit-intercept") && INTERCEPT_SUBMIT) return undefined;
          return originalSubmit.apply(this, args);
        };

        if (typeof originalRequestSubmit === "function") {
          proto.requestSubmit = function (...args) {
            if (logFormSnapshot(this, "form.requestSubmit-intercept") && INTERCEPT_SUBMIT) return undefined;
            return originalRequestSubmit.apply(this, args);
          };
        }
      }
    } catch (_) {}

    document.addEventListener("submit", event => {
      const form = event.target;
      if (!form || !form.querySelectorAll) return;
      if (logFormSnapshot(form, "submit-intercept") && INTERCEPT_SUBMIT) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);

    document.addEventListener("click", event => {
      const button = event.target?.closest?.('button, input[type="submit"], input[type="button"], a');
      if (!button) return;
      const form = button.form || button.closest?.("form");
      if (!form) return;
      logFormSnapshot(form, "click");
    }, true);

    document.addEventListener("change", event => {
      const el = event.target;
      if (!el || !/senha|password|pass|login/i.test(`${el.name || ""} ${el.id || ""} ${el.type || ""}`)) return;
      const form = el.form || el.closest?.("form");
      if (!form) return;
      logFormSnapshot(form, "field-change");
    }, true);
  }

  function formBody(form) {
    const params = new URLSearchParams();
    [...form.querySelectorAll("input, select, textarea")].forEach(el => {
      if (!el.name) return;
      if ((el.type === "checkbox" || el.type === "radio") && !el.checked) return;
      params.append(el.name, el.value || "");
    });
    return params.toString();
  }

  function logFormSnapshot(form, kind) {
    try {
      const action = form.action || location.href;
      const body = formBody(form);
      if (!/funcionarios|acesso|senha|password|login/i.test(action + " " + form.innerText + " " + body)) return false;
      push({
        kind,
        method: (form.method || "GET").toUpperCase(),
        status: kind.includes("intercept") && INTERCEPT_SUBMIT ? "BLOCKED" : "",
        url: action,
        body: short(maskBody(body)),
        response: kind.includes("intercept") && INTERCEPT_SUBMIT ? "blocked by PW Funcionarios Monitor" : ""
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  function renderPanel() {
    let panel = document.querySelector("#pw-func-mon-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "pw-func-mon-panel";
      panel.style.cssText = [
        "position:fixed",
        "left:12px",
        "bottom:12px",
        "z-index:999999",
        "background:#111b24",
        "color:#e8f4ff",
        "border:1px solid #577",
        "padding:8px",
        "font:12px Arial",
        "width:420px",
        "box-shadow:0 6px 20px rgba(0,0,0,.3)"
      ].join(";");
      panel.innerHTML = `
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
          <strong style="flex:1;">PW Funcionarios Monitor</strong>
          <button id="pw-func-mon-copy" type="button">Copy</button>
          <button id="pw-func-mon-clear" type="button">Clear</button>
        </div>
        <textarea id="pw-func-mon-log" rows="8" readonly style="width:100%;box-sizing:border-box;background:#071018;color:#dff;border:1px solid #355;font:11px Consolas,monospace;"></textarea>
      `;
      document.body.appendChild(panel);
      panel.querySelector("#pw-func-mon-copy").addEventListener("click", () => copyText(logRows()));
      panel.querySelector("#pw-func-mon-clear").addEventListener("click", () => {
        state.logs = [];
        saveLogs();
        renderPanel();
      });
    }
    const box = panel.querySelector("#pw-func-mon-log");
    if (box) box.value = logRows();
  }

  function scanFormsOnce() {
    try {
      [...document.querySelectorAll("form")].forEach((form, index) => {
        const action = form.action || location.href;
        const body = formBody(form);
        if (!/funcionarios|acesso|senha|password|login/i.test(action + " " + form.innerText + " " + body)) return;
        push({
          kind: `form-scan-${index}`,
          method: (form.method || "GET").toUpperCase(),
          status: "",
          url: action,
          body: short(maskBody(body)),
          response: ""
        });
      });
    } catch (_) {}
  }

  installHooks();
  window.addEventListener("DOMContentLoaded", () => {
    renderPanel();
    scanFormsOnce();
  });
  setTimeout(() => {
    renderPanel();
    scanFormsOnce();
  }, 1000);
})();
