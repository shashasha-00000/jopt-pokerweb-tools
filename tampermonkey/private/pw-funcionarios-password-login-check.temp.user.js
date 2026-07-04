// ==UserScript==
// @name         PW Funcionarios Password Login Check TEMP
// @namespace    pw-funcionarios-password-login-check-temp
// @version      0.1.0
// @description  TEMP helper to verify funcionario passwords by real login attempts in a separate browser/session.
// @author       xhpc007 + Codex
// @match        https://japanopt.pokerweb.com.br/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const APP = {
    queueKey: "PW_FUNC_PASSWORD_CHECK_QUEUE_V01",
    resultKey: "PW_FUNC_PASSWORD_CHECK_RESULTS_V01",
    runningKey: "PW_FUNC_PASSWORD_CHECK_RUNNING_V01",
    stageKey: "PW_FUNC_PASSWORD_CHECK_STAGE_V01",
    loginUrl: "https://japanopt.pokerweb.com.br/"
  };

  const HEADERS = ["index", "login", "passwordMasked", "result", "reason", "time"];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const $ = selector => document.querySelector(selector);

  function nowText() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function normalize(value) {
    return String(value ?? "")
      .replace(/\uFEFF/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/\u3000/g, " ")
      .replace(/[ \t\r\n]+/g, " ")
      .trim();
  }

  function escTsv(value) {
    return String(value ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ").trim();
  }

  function maskPassword(value) {
    const text = String(value || "");
    if (!text) return "";
    if (text.length <= 2) return "*".repeat(text.length);
    return `${text.slice(0, 1)}${"*".repeat(Math.max(1, text.length - 2))}${text.slice(-1)}`;
  }

  function toTsv(rows) {
    return [
      HEADERS.join("\t"),
      ...rows.map(row => HEADERS.map(header => escTsv(row[header])).join("\t"))
    ].join("\n");
  }

  function copyText(text) {
    try {
      if (typeof GM_setClipboard === "function") {
        GM_setClipboard(text);
        return;
      }
    } catch (_) {}
    navigator.clipboard?.writeText(text).catch(() => {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    });
  }

  function parseCredentials(raw) {
    const rows = [];
    const seen = new Set();
    String(raw || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").forEach((line, index) => {
      if (!normalize(line)) return;
      const cols = line.split(/\t/).map(cell => normalize(cell));
      const loginIndex = cols.findIndex(cell => /^[a-z][a-z0-9._-]*\d+$/i.test(cell) || /^uketuke\d+$/i.test(cell));
      if (loginIndex < 0) return;
      const password = cols.slice(loginIndex + 1).find(cell => cell && !/^(true|false)$/i.test(cell)) || "";
      const login = cols[loginIndex];
      const key = login.toLowerCase();
      if (!password || seen.has(key)) return;
      seen.add(key);
      rows.push({ index: rows.length + 1, sourceLine: index + 1, login, password });
    });
    return rows;
  }

  function loadJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      return parsed ?? fallback;
    } catch (_) {
      return fallback;
    }
  }

  function saveQueue(queue) {
    localStorage.setItem(APP.queueKey, JSON.stringify(queue));
  }

  function loadQueue() {
    return loadJson(APP.queueKey, []);
  }

  function saveResults(rows) {
    localStorage.setItem(APP.resultKey, JSON.stringify(rows));
  }

  function loadResults() {
    return loadJson(APP.resultKey, []);
  }

  function setRunning(value) {
    localStorage.setItem(APP.runningKey, value ? "1" : "0");
  }

  function isRunning() {
    return localStorage.getItem(APP.runningKey) === "1";
  }

  function setStage(stage) {
    localStorage.setItem(APP.stageKey, JSON.stringify(stage));
  }

  function getStage() {
    return loadJson(APP.stageKey, null);
  }

  function appendResult(task, result, reason) {
    const rows = loadResults();
    rows.push({
      index: task?.index || rows.length + 1,
      login: task?.login || "",
      passwordMasked: maskPassword(task?.password || ""),
      result,
      reason,
      time: nowText()
    });
    saveResults(rows);
    renderResults();
  }

  function currentTask() {
    return loadQueue()[0] || null;
  }

  function shiftTask() {
    const queue = loadQueue();
    queue.shift();
    saveQueue(queue);
    return queue[0] || null;
  }

  function visible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null;
  }

  function findLoginForm() {
    const passwordInput = [...document.querySelectorAll('input[type="password"], input[name*="senha" i], input[name*="password" i]')]
      .find(visible);
    if (!passwordInput) return null;
    const form = passwordInput.closest("form") || document.querySelector("form");
    const loginInput = [
      ...document.querySelectorAll('input[name*="login" i], input[name*="usuario" i], input[name*="user" i], input[type="email"], input[type="text"]')
    ].find(input => visible(input) && input !== passwordInput);
    return loginInput && form ? { form, loginInput, passwordInput } : null;
  }

  function submitForm(form) {
    const button = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
    if (button && visible(button)) {
      button.click();
      return;
    }
    form.submit();
  }

  function looksLikeLoginPage() {
    return !!findLoginForm();
  }

  function detect2faState() {
    const text = normalize(document.body?.textContent || "");
    const raw = document.documentElement?.innerHTML || "";
    const hasQr = /otpauth:|qrcode|qr-code|google_auth|googleauth|authenticator|QRCode/i.test(raw) ||
      !!document.querySelector('img[src*="qr"], img[src*="qrcode"], img[src*="chart.googleapis"], canvas');
    const has2faText = /2FA|two.?factor|totp|authenticator|authentication code|verification code|認証|確認コード|二段階|二要素|ワンタイム/i.test(raw + " " + text);
    const hasCodeInput = [...document.querySelectorAll("input")].some(input => {
      const haystack = `${input.name || ""} ${input.id || ""} ${input.placeholder || ""} ${input.type || ""}`;
      return /2fa|totp|token|code|codigo|c[oó]digo|otp|auth/i.test(haystack) && input.type !== "password";
    });

    if (hasQr) return { ok: true, reason: "2FA QR/authenticator setup page detected" };
    if (hasCodeInput || has2faText) return { ok: true, reason: "2FA code page detected" };
    return { ok: false, reason: "no 2FA/QR marker detected" };
  }

  function findLogoutElement() {
    return [...document.querySelectorAll("a, button")]
      .find(el => /logout|sair|logoff|ログアウト|退出/i.test(`${el.textContent || ""} ${el.getAttribute("href") || ""}`));
  }

  function logoutOrReturn() {
    const logout = findLogoutElement();
    if (logout) {
      logout.click();
      return;
    }
    location.href = APP.loginUrl;
  }

  async function runOneStep() {
    if (!isRunning()) return;
    const task = currentTask();
    if (!task) {
      setRunning(false);
      setStatus("Finished password login check.");
      return;
    }

    const stage = getStage();
    if (stage?.login === task.login && stage.stage === "submitted") {
      await sleep(2200);
      const twoFa = detect2faState();
      if (twoFa.ok) {
        appendResult(task, "OK", twoFa.reason);
        shiftTask();
        setStage({ stage: "logout", login: task.login, time: Date.now() });
        logoutOrReturn();
        return;
      }
      if (looksLikeLoginPage()) {
        appendResult(task, "NG", "still on login page after submit");
        shiftTask();
        setStage(null);
        setTimeout(() => { location.href = APP.loginUrl; }, 600);
        return;
      }
      appendResult(task, "UNKNOWN", twoFa.reason);
      shiftTask();
      setStage(null);
      setTimeout(() => { location.href = APP.loginUrl; }, 600);
      return;
    }

    if (stage?.stage === "logout") {
      setStage(null);
      setTimeout(() => { location.href = APP.loginUrl; }, 600);
      return;
    }

    const loginForm = findLoginForm();
    if (!loginForm) {
      setStatus(`Waiting for login form: ${task.login}`, true);
      return;
    }

    setStatus(`Checking ${task.index}/${loadQueue().length + loadResults().length}: ${task.login}`);
    loginForm.loginInput.value = task.login;
    loginForm.passwordInput.value = task.password;
    loginForm.loginInput.dispatchEvent(new Event("input", { bubbles: true }));
    loginForm.loginInput.dispatchEvent(new Event("change", { bubbles: true }));
    loginForm.passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
    loginForm.passwordInput.dispatchEvent(new Event("change", { bubbles: true }));
    setStage({ stage: "submitted", login: task.login, time: Date.now() });
    await sleep(300);
    submitForm(loginForm.form);
  }

  function startCheck() {
    const credentials = parseCredentials($("#pwpass-input")?.value || "");
    if (!credentials.length) {
      setStatus("No credentials parsed. Paste TSV with login + password.", true);
      return;
    }
    if (!confirm("This will try real logins and may replace the current PokerWeb session. Run only in a separate browser/profile. Continue?")) return;
    saveQueue(credentials);
    saveResults([]);
    setStage(null);
    setRunning(true);
    renderResults();
    location.href = APP.loginUrl;
  }

  function stopCheck() {
    setRunning(false);
    setStage(null);
    setStatus("Stopped.");
  }

  function setStatus(text, isError = false) {
    const el = $("#pwpass-status");
    if (el) {
      el.textContent = text;
      el.style.color = isError ? "#ffd0d0" : "#d7f8ff";
    }
    console[isError ? "error" : "log"]("[PW-PASSWORD-CHECK]", text);
  }

  function renderResults() {
    const area = $("#pwpass-output");
    if (area) area.value = toTsv(loadResults());
  }

  function installPanel() {
    if ($("#pwpass-panel")) return;
    const panel = document.createElement("div");
    panel.id = "pwpass-panel";
    panel.innerHTML = `
      <style>
        #pwpass-panel {
          position: fixed;
          right: 12px;
          top: 12px;
          width: 560px;
          max-width: calc(100vw - 24px);
          z-index: 999999;
          background: #241923;
          color: #f5f7fa;
          border: 1px solid #775c75;
          box-shadow: 0 10px 30px rgba(0,0,0,.35);
          font: 12px/1.45 Arial, sans-serif;
        }
        #pwpass-panel.pwpass-minimized .pwpass-body { display: none; }
        #pwpass-panel button {
          border: 1px solid #8c748a;
          background: #eef2f5;
          color: #17202a;
          padding: 6px 8px;
          cursor: pointer;
        }
        #pwpass-panel textarea {
          width: 100%;
          box-sizing: border-box;
          background: #100912;
          color: #fbeaff;
          border: 1px solid #58425b;
          padding: 6px;
          font: 12px/1.35 Consolas, monospace;
          resize: vertical;
        }
        #pwpass-panel .pwpass-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 8px 10px;
          background: #352335;
          font-weight: bold;
        }
        #pwpass-panel .pwpass-body { padding: 10px; }
        #pwpass-panel .pwpass-row { display: flex; gap: 6px; margin: 7px 0; }
        #pwpass-status { min-height: 18px; color: #d7f8ff; }
      </style>
      <div class="pwpass-head">
        <span>PW Password Login Check TEMP</span>
        <button id="pwpass-toggle" type="button">_</button>
      </div>
      <div class="pwpass-body">
        <div id="pwpass-status">Use only in a separate browser/profile. Paste login/password TSV.</div>
        <textarea id="pwpass-input" rows="5" spellcheck="false" placeholder="Paste dirty TSV with login and password"></textarea>
        <div class="pwpass-row">
          <button id="pwpass-start" type="button" style="flex:1;background:#ffd38a;">START REAL LOGIN CHECK</button>
          <button id="pwpass-stop" type="button">Stop</button>
          <button id="pwpass-copy" type="button">Copy Results</button>
          <button id="pwpass-clear" type="button">Clear</button>
        </div>
        <textarea id="pwpass-output" rows="10" spellcheck="false" readonly>${HEADERS.join("\t")}</textarea>
      </div>
    `;
    document.body.appendChild(panel);
    $("#pwpass-toggle").addEventListener("click", () => panel.classList.toggle("pwpass-minimized"));
    $("#pwpass-start").addEventListener("click", startCheck);
    $("#pwpass-stop").addEventListener("click", stopCheck);
    $("#pwpass-copy").addEventListener("click", () => copyText($("#pwpass-output").value || ""));
    $("#pwpass-clear").addEventListener("click", () => {
      saveQueue([]);
      saveResults([]);
      setStage(null);
      setRunning(false);
      renderResults();
      setStatus("Cleared.");
    });
    renderResults();
  }

  installPanel();
  setTimeout(runOneStep, 700);
})();
