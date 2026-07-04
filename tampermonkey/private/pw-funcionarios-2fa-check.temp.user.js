// ==UserScript==
// @name         PW Funcionarios 2FA Check TEMP
// @namespace    pw-funcionarios-2fa-check-temp
// @version      0.1.0
// @description  Read-only checker for funcionarios without bound 2FA.
// @author       xhpc007 + Codex
// @match        https://japanopt.pokerweb.com.br/cb/funcionarios*
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const HEADERS = ["index", "login", "painelId", "nome", "twoFaStatus", "reason", "painelUrl"];
  const state = {
    running: false,
    rows: []
  };

  const $ = selector => document.querySelector(selector);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function pageWindow() {
    try {
      return typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    } catch (_) {
      return window;
    }
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

  function absoluteUrl(url) {
    return new URL(url, location.origin).href;
  }

  function parseHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    doc.__rawHtml = String(html || "");
    return doc;
  }

  async function requestText(url, options = {}) {
    const response = await fetch(absoluteUrl(url), {
      credentials: "same-origin",
      cache: "no-store",
      ...options
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}: ${normalize(text).slice(0, 160)}`);
    return { response, text, doc: parseHtml(text) };
  }

  function dataTable() {
    const win = pageWindow();
    const jq = win.jQuery || window.jQuery;
    if (!jq?.fn?.dataTable) return null;
    const table = jq("#table_funcionarios");
    if (!table?.length) return null;
    return table.DataTable();
  }

  function dataTableAjaxUrl(dt) {
    const ajax = dt?.settings?.()[0]?.ajax;
    if (typeof ajax === "string") return absoluteUrl(ajax);
    if (ajax?.url) return absoluteUrl(ajax.url);
    return absoluteUrl("/cb/funcionarios/datatables/listar");
  }

  function cloneDataTableParams(dt) {
    const settings = dt?.settings?.()[0];
    const ajaxParams = settings?.oAjaxData;
    if (ajaxParams) return JSON.parse(JSON.stringify(ajaxParams));
    return {
      draw: 1,
      start: 0,
      length: 100,
      search: { value: "", regex: false },
      order: [],
      columns: []
    };
  }

  function paramsToUrlSearchParams(data) {
    const params = new URLSearchParams();
    function add(prefix, value) {
      if (Array.isArray(value)) {
        value.forEach((item, index) => add(`${prefix}[${index}]`, item));
      } else if (value && typeof value === "object") {
        Object.keys(value).forEach(key => add(`${prefix}[${key}]`, value[key]));
      } else {
        params.append(prefix, value == null ? "" : String(value));
      }
    }
    Object.keys(data).forEach(key => add(key, data[key]));
    return params;
  }

  function extractRowsFromHtml(html) {
    const doc = parseHtml(`<table><tbody>${html || ""}</tbody></table>`);
    return [...doc.querySelectorAll("tr")].map((tr, index) => {
      const painelLink = tr.querySelector('a[href*="/cb/funcionarios/painel/"]');
      const painelUrl = painelLink ? absoluteUrl(painelLink.getAttribute("href")) : "";
      const painelId = painelUrl.match(/\/painel\/(\d+)/)?.[1] || "";
      const cells = [...tr.querySelectorAll("td")].map(td => normalize(td.textContent));
      const text = normalize(tr.textContent);
      const login = cells[2] || guessLogin(text);
      const nome = cells[1] || "";
      return { index, login, painelId, painelUrl, nome, text };
    }).filter(row => row.painelUrl && row.painelId);
  }

  function guessLogin(text) {
    const match = String(text || "").match(/\b[a-z][a-z0-9._-]{2,}\b/i);
    return match?.[0] || "";
  }

  function parseTargetLogins(raw) {
    const ignored = new Set(["false", "true", "spadie", "tokyo", "osaka", "japan", "brasil", "user", "admin"]);
    const found = [];
    const seen = new Set();
    String(raw || "").split(/\r?\n/).forEach(line => {
      const cells = line.split(/\t/).map(cell => normalize(cell));
      const candidates = [
        ...cells,
        ...(line.match(/\b[a-z][a-z0-9._-]{2,}\b/gi) || [])
      ];
      candidates.forEach(value => {
        const login = String(value || "").trim();
        const key = login.toLowerCase();
        if (!/^[a-z][a-z0-9._-]{2,}$/i.test(login)) return;
        if (ignored.has(key)) return;
        if (!/[0-9]/.test(login) && !/^uketuke/i.test(login)) return;
        if (seen.has(key)) return;
        seen.add(key);
        found.push(login);
      });
    });
    return found;
  }

  async function findFuncionarioByLogin(login) {
    const dt = dataTable();
    const base = cloneDataTableParams(dt);
    const data = JSON.parse(JSON.stringify(base));
    data.draw = Number(data.draw || 1) + 1;
    data.start = 0;
    data.length = 10;
    if (!data.search) data.search = { value: "", regex: false };
    data.search.value = login;
    data.search.regex = false;

    const page = await requestText(dataTableAjaxUrl(dt), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: paramsToUrlSearchParams(data)
    });

    let json;
    try {
      json = JSON.parse(page.text);
    } catch (_) {
      throw new Error(`datatables/listar returned non-JSON: ${normalize(page.text).slice(0, 120)}`);
    }

    const rows = extractRowsFromHtml(json.conteudo || "");
    const target = login.toLowerCase();
    return rows.find(row => String(row.login || "").toLowerCase() === target) ||
      rows.find(row => String(row.text || "").toLowerCase().includes(target)) ||
      null;
  }

  async function fetchTargetFuncionariosRows(logins) {
    const rows = [];
    for (let i = 0; i < logins.length; i += 1) {
      const login = logins[i];
      setStatus(`Finding ${i + 1}/${logins.length}: ${login}`);
      try {
        const row = await findFuncionarioByLogin(login);
        if (row) {
          rows.push({ ...row, requestedLogin: login });
        } else {
          rows.push({ login, requestedLogin: login, painelId: "", painelUrl: "", nome: "", twoFaStatus: "NOT_FOUND", reason: "login not found in funcionarios list" });
        }
      } catch (error) {
        rows.push({ login, requestedLogin: login, painelId: "", painelUrl: "", nome: "", twoFaStatus: "ERROR", reason: error.message || String(error) });
      }
      await sleep(80);
    }
    return rows;
  }

  async function fetchAllFuncionariosRows() {
    const dt = dataTable();
    const base = cloneDataTableParams(dt);
    const info = dt?.page?.info?.();
    const total = Number(info?.recordsTotal || info?.recordsDisplay || 1000);
    const length = Math.max(100, Number(base.length || 100));
    const rows = [];
    const seen = new Set();

    for (let start = 0; start < total + length; start += length) {
      setStatus(`Scanning list ${rows.length}/${total || "?"}`);
      const data = JSON.parse(JSON.stringify(base));
      data.draw = Number(data.draw || 1) + start + 1;
      data.start = start;
      data.length = length;
      if (!data.search) data.search = { value: "", regex: false };
      data.search.value = "";

      const page = await requestText(dataTableAjaxUrl(dt), {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: paramsToUrlSearchParams(data)
      });

      let json;
      try {
        json = JSON.parse(page.text);
      } catch (_) {
        throw new Error(`datatables/listar returned non-JSON: ${normalize(page.text).slice(0, 120)}`);
      }

      const html = json.conteudo || "";
      const batch = extractRowsFromHtml(html);
      batch.forEach(row => {
        if (seen.has(row.painelId)) return;
        seen.add(row.painelId);
        rows.push(row);
      });

      const filtered = Number(json.recordsFiltered || json.recordsTotal || total || 0);
      if (!batch.length || rows.length >= filtered) break;
      await sleep(80);
    }

    return rows;
  }

  function findNome(doc) {
    return doc.querySelector('form[action*="/cb/funcionarios/editar"] [name="nome"]')?.value ||
      doc.querySelector('[name="nome"]')?.value ||
      "";
  }

  function check2fa(doc, html) {
    const text = normalize(doc.body?.textContent || "");
    const raw = String(html || "");
    const qrLike = [
      'img[src*="qr"]',
      'img[src*="qrcode"]',
      'img[src*="chart.googleapis"]',
      'canvas',
      'svg'
    ].some(selector => doc.querySelector(selector));
    const rawQrLike = /otpauth:|qrcode|qr-code|google_auth|googleauth|authenticator|2fa|2FA|二段階|二要素|認証コード|QRCode/i.test(raw);
    const resetLike = /resetar_2fa_code|reset.*2fa|2fa.*reset|リセット|解除/i.test(raw + " " + text);

    if (qrLike || /otpauth:/i.test(raw)) {
      return { twoFaStatus: "NOT_BOUND", reason: "QR/otpauth present" };
    }
    if (rawQrLike && !resetLike) {
      return { twoFaStatus: "NOT_BOUND", reason: "2FA QR-like markup present" };
    }
    if (resetLike) {
      return { twoFaStatus: "BOUND_OR_RESET_AVAILABLE", reason: "reset 2FA action present, no QR detected" };
    }
    return { twoFaStatus: "UNKNOWN", reason: "no QR/reset marker detected" };
  }

  async function scan2fa() {
    if (state.running) return;
    state.running = true;
    state.rows = [];
    renderRows();
    updateButtons();
    try {
      const targets = parseTargetLogins($("#pw2fa-targets")?.value || "");
      if (!targets.length) throw new Error("paste target logins first");
      const employees = await fetchTargetFuncionariosRows(targets);
      setStatus(`Found ${employees.filter(row => row.painelUrl).length}/${employees.length} target funcionarios. Checking panels...`);
      for (let i = 0; i < employees.length; i += 1) {
        const employee = employees[i];
        if (!employee.painelUrl) {
          state.rows.push({
            index: i + 1,
            login: employee.requestedLogin || employee.login,
            painelId: employee.painelId || "",
            nome: employee.nome || "",
            twoFaStatus: employee.twoFaStatus || "NOT_FOUND",
            reason: employee.reason || "no painelUrl",
            painelUrl: ""
          });
          renderRows();
          continue;
        }
        setStatus(`Checking ${i + 1}/${employees.length}: ${employee.login || employee.painelId}`);
        try {
          const page = await requestText(employee.painelUrl);
          const check = check2fa(page.doc, page.text);
          state.rows.push({
            index: i + 1,
            login: employee.login,
            painelId: employee.painelId,
            nome: findNome(page.doc) || employee.nome,
            twoFaStatus: check.twoFaStatus,
            reason: check.reason,
            painelUrl: employee.painelUrl
          });
        } catch (error) {
          state.rows.push({
            index: i + 1,
            login: employee.login,
            painelId: employee.painelId,
            nome: employee.nome,
            twoFaStatus: "ERROR",
            reason: error.message || String(error),
            painelUrl: employee.painelUrl
          });
        }
        renderRows();
        await sleep(120);
      }
      const missingCount = state.rows.filter(row => row.twoFaStatus === "NOT_BOUND").length;
      setStatus(`Done. NOT_BOUND=${missingCount}, total=${state.rows.length}`);
    } catch (error) {
      setStatus(`Stopped: ${error.message || error}`, true);
    } finally {
      state.running = false;
      updateButtons();
    }
  }

  function setStatus(text, isError = false) {
    const el = $("#pw2fa-status");
    if (el) {
      el.textContent = text;
      el.style.color = isError ? "#ffd0d0" : "#d7f8ff";
    }
    console[isError ? "error" : "log"]("[PW-2FA-CHECK]", text);
  }

  function renderRows() {
    const text = toTsv(state.rows);
    const area = $("#pw2fa-output");
    if (area) area.value = text;
  }

  function updateButtons() {
    const scan = $("#pw2fa-scan");
    if (scan) scan.disabled = state.running;
  }

  function installPanel() {
    if ($("#pw2fa-panel")) return;
    const panel = document.createElement("div");
    panel.id = "pw2fa-panel";
    panel.innerHTML = `
      <style>
        #pw2fa-panel {
          position: fixed;
          left: 12px;
          bottom: 12px;
          width: 560px;
          max-width: calc(100vw - 24px);
          z-index: 999998;
          background: #10202a;
          color: #f5f7fa;
          border: 1px solid #55717d;
          box-shadow: 0 10px 30px rgba(0,0,0,.35);
          font: 12px/1.45 Arial, sans-serif;
        }
        #pw2fa-panel.pw2fa-minimized .pw2fa-body { display: none; }
        #pw2fa-panel button {
          border: 1px solid #6f8396;
          background: #eef2f5;
          color: #17202a;
          padding: 6px 8px;
          cursor: pointer;
        }
        #pw2fa-panel button:disabled { opacity: .45; cursor: not-allowed; }
        #pw2fa-panel textarea {
          width: 100%;
          box-sizing: border-box;
          background: #071018;
          color: #dff;
          border: 1px solid #355;
          padding: 6px;
          font: 12px/1.35 Consolas, monospace;
          resize: vertical;
        }
        #pw2fa-panel .pw2fa-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 8px 10px;
          background: #18313f;
          font-weight: bold;
        }
        #pw2fa-panel .pw2fa-body { padding: 10px; }
        #pw2fa-panel .pw2fa-row { display: flex; gap: 6px; margin: 7px 0; }
        #pw2fa-panel #pw2fa-status { min-height: 18px; color: #d7f8ff; }
      </style>
      <div class="pw2fa-head">
        <span>PW Funcionarios 2FA Check TEMP</span>
        <button id="pw2fa-toggle" type="button">_</button>
      </div>
      <div class="pw2fa-body">
        <div id="pw2fa-status">Ready. Paste target logins or dirty TSV. This checker is read-only.</div>
        <textarea id="pw2fa-targets" rows="5" spellcheck="false" placeholder="Paste target logins or dirty TSV here. Example: uketuke231&#10;uketuke232"></textarea>
        <div class="pw2fa-row">
          <button id="pw2fa-scan" type="button" style="flex:1;background:#b7f7c1;">CHECK TARGETS</button>
          <button id="pw2fa-copy" type="button">Copy TSV</button>
          <button id="pw2fa-only-missing" type="button">Copy NOT_BOUND</button>
          <button id="pw2fa-clear" type="button">Clear</button>
        </div>
        <textarea id="pw2fa-output" rows="14" spellcheck="false" readonly>${HEADERS.join("\t")}</textarea>
      </div>
    `;
    document.body.appendChild(panel);
    $("#pw2fa-toggle").addEventListener("click", () => panel.classList.toggle("pw2fa-minimized"));
    $("#pw2fa-scan").addEventListener("click", scan2fa);
    $("#pw2fa-copy").addEventListener("click", () => copyText($("#pw2fa-output").value || ""));
    $("#pw2fa-only-missing").addEventListener("click", () => {
      const rows = state.rows.filter(row => row.twoFaStatus === "NOT_BOUND");
      copyText(toTsv(rows));
      setStatus(`Copied NOT_BOUND rows: ${rows.length}`);
    });
    $("#pw2fa-clear").addEventListener("click", () => {
      state.rows = [];
      $("#pw2fa-targets").value = "";
      renderRows();
      setStatus("Cleared.");
    });
  }

  installPanel();
})();
