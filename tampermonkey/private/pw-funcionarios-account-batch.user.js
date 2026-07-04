// ==UserScript==
// @name         PW Funcionarios Account Batch
// @namespace    pw-funcionarios-account-batch
// @version      0.2.0
// @description  Batch update PokerWeb funcionarios names, passwords, and access status by background GET/POST with DRY RUN first.
// @author       xhpc007 + Codex
// @match        https://japanopt.pokerweb.com.br/cb/*
// @match        https://japanopt.pokerweb.com.br/*
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const APP = {
    inputKey: "PW_FUNCIONARIOS_ACCOUNT_BATCH_INPUT_V01",
    previewKey: "PW_FUNCIONARIOS_ACCOUNT_BATCH_PREVIEW_V01",
    logKey: "PW_FUNCIONARIOS_ACCOUNT_BATCH_LOG_V01",
    workerKey: "PW_FUNCIONARIOS_ACCOUNT_BATCH_WORKER_V01",
    workerWindowName: "pwfab_worker",
    listUrl: "/cb/funcionarios",
    editPath: "/cb/funcionarios/editar",
    accessCreatePath: "/cb/funcionarios/acesso_cadastrar",
    accessStatusPath: "/cb/funcionarios/acesso_status",
    minDelayMs: 80
  };

  const SAMPLE_INPUT = [
    "FALSE\t受付（貸出用）　231\tSPADIE TOKYO 42nd\tuketuke231\t54792\t\tFALSE\tFALSE",
    "FALSE\t受付（貸出用）　232\tSPADIE TOKYO 42nd\tuketuke232\t69218\t\tFALSE\tFALSE"
  ].join("\n");

  const PREVIEW_HEADERS = [
    "lineNo", "status", "prefix", "newEvent", "login", "passwordMasked",
    "painelId", "painelUrl", "currentNome", "newNome", "reason"
  ];

  const LOG_HEADERS = [
    "lineNo", "login", "painelId", "step", "result", "status", "message", "time"
  ];

  const state = {
    running: false,
    dryRunOk: false,
    tasks: [],
    logs: []
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

  function compactKey(value) {
    return normalize(value).toLowerCase().replace(/\s+/g, "");
  }

  function escTsv(value) {
    return String(value ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ").trim();
  }

  function toTsv(rows, headers) {
    return [
      headers.join("\t"),
      ...rows.map(row => headers.map(header => escTsv(row[header])).join("\t"))
    ].join("\n");
  }

  function maskPassword(value) {
    const text = String(value || "");
    if (!text) return "";
    if (text.length <= 2) return "*".repeat(text.length);
    return `${text.slice(0, 1)}${"*".repeat(Math.max(1, text.length - 2))}${text.slice(-1)}`;
  }

  function parseHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    doc.__rawHtml = String(html || "");
    return doc;
  }

  function absoluteUrl(url) {
    return new URL(url, location.origin).href;
  }

  function setStatus(text, isError = false) {
    const el = $("#pwfab-status");
    if (el) {
      el.textContent = text;
      el.style.color = isError ? "#ffd0d0" : "#d7f8ff";
    }
    console[isError ? "error" : "log"]("[PW-FUNCIONARIOS-BATCH]", text);
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

  async function requestText(url, options = {}) {
    const response = await fetch(absoluteUrl(url), {
      credentials: "same-origin",
      cache: "no-store",
      ...options
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${url} HTTP ${response.status}: ${normalize(text).slice(0, 180)}`);
    }
    return { response, text, doc: parseHtml(text) };
  }

  async function postUrlEncoded(url, params) {
    return requestText(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: params instanceof URLSearchParams ? params : new URLSearchParams(params)
    });
  }

  function waitIframeLoad(iframe, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        iframe.removeEventListener("load", onLoad);
        reject(new Error("iframe load timeout"));
      }, timeoutMs);

      function onLoad() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        iframe.removeEventListener("load", onLoad);
        resolve(iframe);
      }

      iframe.addEventListener("load", onLoad);
    });
  }

  async function loadIframeUrl(iframe, url, timeoutMs = 15000) {
    const waiting = waitIframeLoad(iframe, timeoutMs);
    iframe.src = absoluteUrl(url);
    await waiting;
    return iframe.contentDocument;
  }

  function setFormValue(form, name, value) {
    let input = form.querySelector(`[name="${cssEscape(name)}"]`);
    if (!input) {
      input = form.ownerDocument.createElement("input");
      input.type = "hidden";
      input.name = name;
      form.appendChild(input);
    }
    input.value = value;
    input.setAttribute("value", value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function submitAccessFormPageCycle(task) {
    const page = await requestText(`${task.painelUrl}?_pwfab_load=${Date.now()}`);
    const accessForm = findAccessForm(page.doc, task.login);
    if (!accessForm) throw new Error(`access form for login not found: ${task.login}`);

    const codbloq = extractCodbloq(page.doc, accessForm);
    if (!codbloq) throw new Error("access codbloq not found");

    const iframeName = `pwfab_submit_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const iframe = document.createElement("iframe");
    const form = document.createElement("form");
    iframe.name = iframeName;
    iframe.style.cssText = "position:absolute;width:1px;height:1px;left:-9999px;top:-9999px;border:0;";
    form.method = "POST";
    form.action = formAction(accessForm, APP.accessCreatePath);
    form.target = iframeName;
    form.style.display = "none";

    [
      ["login", task.login],
      ["senha", task.password],
      ["codbloq", codbloq],
      ["id_funcionario", task.painelId]
    ].forEach(([name, value]) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    });

    document.body.appendChild(iframe);
    document.body.appendChild(form);
    form.submit();
    await sleep(1800);
    await requestText(`/cb/funcionarios?_pwfab_refresh=${Date.now()}`);
    await sleep(700);
    setTimeout(() => {
      iframe.remove();
      form.remove();
    }, 500);
    return { status: 200, message: "password submitted via form iframe with light refresh" };
  }

  function parseInput(raw) {
    const lines = String(raw || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n");

    const tasks = [];
    const errors = [];

    lines.forEach((line, index) => {
      if (!normalize(line)) return;

      const cols = line.split("\t").map(cell => String(cell || "").replace(/\uFEFF/g, "").trim());
      const loginIndex = cols.findIndex(cell => /^[a-z][a-z0-9_-]*\d+$/i.test(cell) || /^uketuke\d+$/i.test(cell));
      if (loginIndex < 0) {
        errors.push({ lineNo: index + 1, reason: "login column not found" });
        return;
      }

      const password = cols.slice(loginIndex + 1).find(cell => normalize(cell) && !/^(true|false)$/i.test(normalize(cell))) || "";
      const newEvent = findPreviousDataCell(cols, loginIndex - 1);
      const prefix = findPreviousDataCell(cols, loginIndex - 2);
      const login = normalize(cols[loginIndex]);

      if (!prefix || !newEvent || !password) {
        errors.push({
          lineNo: index + 1,
          reason: `missing ${!prefix ? "prefix " : ""}${!newEvent ? "newEvent " : ""}${!password ? "password" : ""}`.trim()
        });
        return;
      }

      tasks.push({
        lineNo: index + 1,
        rawLine: line,
        prefix,
        newEvent,
        login,
        password,
        painelId: "",
        painelUrl: "",
        currentNome: "",
        newNome: "",
        status: "parsed",
        reason: ""
      });
    });

    return { tasks, errors };
  }

  function findPreviousDataCell(cols, startIndex) {
    for (let i = startIndex; i >= 0; i -= 1) {
      const value = String(cols[i] || "").trim();
      if (!value || /^(true|false)$/i.test(value)) continue;
      return value;
    }
    return "";
  }

  function dataTable() {
    const win = pageWindow();
    try {
      if (!win.jQuery || !win.jQuery.fn || !win.jQuery.fn.dataTable) return null;
      for (const table of Array.from(win.jQuery.fn.dataTable.tables() || [])) {
        if (!win.jQuery.fn.DataTable.isDataTable(table)) continue;
        const dt = win.jQuery(table).DataTable();
        if (dt) return dt;
      }
    } catch (_) {}
    return null;
  }

  function dataTableNode(dt) {
    try { return dt?.table?.().node?.() || null; } catch (_) { return null; }
  }

  function extractFuncionariosRows(doc) {
    return [...doc.querySelectorAll("tr")]
      .map(tr => {
        const painelUrl = [...tr.querySelectorAll("a[href]")]
          .map(a => absoluteUrl(a.getAttribute("href")))
          .find(href => /\/cb\/funcionarios\/painel\/\d+$/i.test(href));
        if (!painelUrl) return null;
        const painelId = painelUrl.match(/\/painel\/(\d+)$/i)?.[1] || "";
        const cells = [...tr.querySelectorAll("th,td")].map(td => td.innerText || "");
        const text = tr.innerText || "";
        return { painelId, painelUrl, text, cells };
      })
      .filter(Boolean);
  }


  function waitDraw(dt, timeoutMs = 5000) {
    const win = pageWindow();
    return new Promise(resolve => {
      const node = dataTableNode(dt);
      if (!node || !win.jQuery) return resolve(false);
      let done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        try { win.jQuery(node).off('draw.dt', onDraw); } catch (_) {}
        resolve(ok);
      };
      const timer = win.setTimeout(() => finish(false), timeoutMs);
      function onDraw() {
        win.clearTimeout(timer);
        finish(true);
      }
      try { win.jQuery(node).one('draw.dt', onDraw); } catch (_) { finish(false); }
    });
  }

  function dataTableAjaxUrl(dt) {
    try {
      const url = dt?.ajax?.url?.();
      if (url) return absoluteUrl(url);
    } catch (_) {}
    try {
      const settings = dt?.settings?.()?.[0];
      const ajax = settings?.ajax;
      if (typeof ajax === "string") return absoluteUrl(ajax);
      if (ajax?.url) return absoluteUrl(ajax.url);
      if (settings?.sAjaxSource) return absoluteUrl(settings.sAjaxSource);
    } catch (_) {}
    return absoluteUrl("/cb/funcionarios/datatables/listar");
  }

  function cloneDataTableParams(dt) {
    try {
      const params = dt?.ajax?.params?.();
      if (params && typeof params === "object") return JSON.parse(JSON.stringify(params));
    } catch (_) {}
    return {
      draw: 1,
      start: 0,
      length: 10,
      search: { value: "", regex: false }
    };
  }

  function appendParam(params, key, value) {
    if (value == null) {
      params.append(key, "");
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => appendParam(params, `${key}[${index}]`, item));
      return;
    }
    if (typeof value === "object") {
      Object.keys(value).forEach(child => appendParam(params, `${key}[${child}]`, value[child]));
      return;
    }
    params.append(key, String(value));
  }

  function dataTableParamsToUrlSearchParams(data) {
    const params = new URLSearchParams();
    Object.keys(data || {}).forEach(key => appendParam(params, key, data[key]));
    return params;
  }

  async function postDataTablesSearch(login) {
    const dt = dataTable();
    const data = cloneDataTableParams(dt);
    data.draw = Number(data.draw || 0) + 1;
    data.start = 0;
    data.length = 10;
    data.search = data.search && typeof data.search === "object" ? data.search : {};
    data.search.value = login;
    data.search.regex = false;

    const response = await fetch(dataTableAjaxUrl(dt), {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: dataTableParamsToUrlSearchParams(data)
    });

    const text = await response.text();
    if (!response.ok) throw new Error(`datatables/listar HTTP ${response.status}: ${normalize(text).slice(0, 180)}`);

    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`datatables/listar returned non-JSON: ${normalize(text).slice(0, 180)}`);
    }
  }

  function extractPainelFromPayload(payload) {
    const raw = typeof payload === "string" ? payload : JSON.stringify(payload || {});
    const match = raw.match(/\/cb\/funcionarios\/painel\/(\d+)/i);
    if (!match) return null;
    return {
      painelId: match[1],
      painelUrl: absoluteUrl(`/cb/funcionarios/painel/${match[1]}`),
      text: raw
    };
  }

  async function findPainelByLogin(login) {
    const dt = dataTable();
    if (dt) {
      try {
        const draw = waitDraw(dt);
        dt.search(login);
        dt.page.len(10);
        dt.page(0);
        dt.draw();
        await draw;
        await sleep(120);

        const rows = extractFuncionariosRows(document);
        const loginPattern = new RegExp(escapeRegExp(login), "i");
        const candidates = rows.filter(row => loginPattern.test(String(row.text || "")));
        if (candidates.length === 1) return candidates[0];
        if (candidates.length > 1) return { ...candidates[0], ambiguous: true, ambiguityCount: candidates.length };
        if (rows.length === 1) return rows[0];

        let info = null;
        try { info = dt.page.info(); } catch (_) {}
        return {
          error: `DataTable search returned no unique painel URL. rows=${rows.length} recordsDisplay=${info?.recordsDisplay ?? ""}`
        };
      } catch (error) {
        return { error: `DataTable search failed: ${error.message || error}` };
      }
    }

    const json = await postDataTablesSearch(login);
    const rows = Array.isArray(json?.data) ? json.data : [];
    const candidates = rows
      .map(row => ({ row, raw: typeof row === "string" ? row : JSON.stringify(row || {}) }))
      .filter(item => new RegExp(escapeRegExp(login), "i").test(item.raw))
      .map(item => extractPainelFromPayload(item.row))
      .filter(Boolean);

    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) return { ...candidates[0], ambiguous: true, ambiguityCount: candidates.length };

    const fallback = rows.map(extractPainelFromPayload).filter(Boolean);
    if (fallback.length === 1) return fallback[0];
    if (fallback.length > 1) return { ...fallback[0], ambiguous: true, ambiguityCount: fallback.length };

    return {
      error: `login search returned no painel URL. recordsFiltered=${json?.recordsFiltered ?? ""} dataRows=${rows.length}`
    };
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function findEditForm(doc) {
    return [...doc.querySelectorAll("form")]
      .find(form => /\/cb\/funcionarios\/editar$/i.test(absoluteUrl(form.getAttribute("action") || "")));
  }

  function findAccessForm(doc, login) {
    const forms = [...doc.querySelectorAll("form")]
      .filter(form => {
        const action = absoluteUrl(form.getAttribute("action") || "");
        if (/\/cb\/funcionarios\/acesso_cadastrar(?:$|[?#])/i.test(action)) return true;
        return form.querySelector('[name="login"]') &&
          form.querySelector('[name="senha"]') &&
          form.querySelector('[name="codbloq"]');
      });
    const target = compactKey(login);
    return forms.find(form => {
      const loginInput = form.querySelector('[name="login"]');
      const haystack = [
        loginInput?.value || "",
        loginInput?.getAttribute("value") || "",
        loginInput?.placeholder || "",
        form.innerText || "",
        form.outerHTML || ""
      ].map(compactKey).join(" ");
      return haystack.includes(target);
    }) || forms[0] || null;
  }

  function formAction(form, fallbackPath) {
    return absoluteUrl(form.getAttribute("action") || fallbackPath);
  }

  function getFormValue(form, name) {
    return form.querySelector(`[name="${cssEscape(name)}"]`)?.value || "";
  }

  function extractCodbloq(doc, form) {
    return getFormValue(form, "codbloq") ||
      doc.querySelector('form[action*="acesso_cadastrar"] [name="codbloq"]')?.value ||
      doc.querySelector('[name="codbloq"]')?.value ||
      htmlAttrValue(form?.outerHTML || "", "codbloq") ||
      htmlAttrValue(doc.__rawHtml || "", "codbloq") ||
      document.querySelector('form[action*="acesso_cadastrar"] [name="codbloq"]')?.value ||
      document.querySelector('[name="codbloq"]')?.value ||
      "";
  }

  function htmlAttrValue(html, name) {
    const text = String(html || "");
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`name\\\\s*=\\\\s*["']${escaped}["'][^>]*value\\\\s*=\\\\s*["']([^"']+)["']`, "i"),
      new RegExp(`value\\\\s*=\\\\s*["']([^"']+)["'][^>]*name\\\\s*=\\\\s*["']${escaped}["']`, "i"),
      new RegExp(`["']${escaped}["']\\\\s*:\\\\s*["']([^"']+)["']`, "i"),
      new RegExp(`\\\\b${escaped}\\\\s*=\\\\s*["']([^"']+)["']`, "i")
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return match[1];
    }
    return "";
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function paramsFromForm(form, overrides = {}) {
    const params = new URLSearchParams();
    [...form.querySelectorAll("input, select, textarea")].forEach(el => {
      if (!el.name) return;
      if ((el.type === "checkbox" || el.type === "radio") && !el.checked) return;
      params.append(el.name, Object.prototype.hasOwnProperty.call(overrides, el.name) ? overrides[el.name] : el.value);
    });
    Object.keys(overrides).forEach(name => {
      if (!params.has(name)) params.set(name, overrides[name]);
    });
    return params;
  }

  function makeNewNome(currentNome, prefix, newEvent) {
    const raw = String(currentNome || '');
    const separatorMatch = raw.match(/^(.+?)([\t \u3000]+)(SPADIE\b.*)$/i);
    if (separatorMatch) {
      return `${separatorMatch[1]}${separatorMatch[2]}${newEvent}`;
    }

    const exactIndex = raw.indexOf(prefix);
    if (exactIndex >= 0) {
      const before = raw.slice(0, exactIndex);
      const afterPrefix = raw.slice(exactIndex + prefix.length);
      const separator = afterPrefix.match(/^[\t \u3000]+/)?.[0] || '\t';
      return `${before}${prefix}${separator}${newEvent}`;
    }

    const normalizedCurrent = normalize(raw);
    const normalizedPrefix = normalize(prefix);
    if (normalizedPrefix && normalizedCurrent.startsWith(normalizedPrefix)) {
      return `${prefix}\t${newEvent}`;
    }

    throw new Error(`current nome does not contain replaceable SPADIE event. current=${raw}`);
  }

  async function loadPainel(task) {
    const page = await requestText(task.painelUrl);
    const editForm = findEditForm(page.doc);
    if (!editForm) throw new Error("editar form not found");
    const currentNome = getFormValue(editForm, "nome");
    return { ...page, editForm, currentNome };
  }

  async function resolveTasks(tasks, progress) {
    const resolved = [];

    for (let index = 0; index < tasks.length; index += 1) {
      const task = { ...tasks[index] };
      progress?.(`DRY RUN search ${index + 1}/${tasks.length}: ${task.login}`);

      try {
        const row = await findPainelByLogin(task.login);
        if (!row || row.error) {
          resolved.push({ ...task, status: "ERROR", reason: row?.error || "login search returned no result" });
          continue;
        }
        if (row.ambiguous) {
          resolved.push({ ...task, status: "ERROR", reason: `ambiguous login search: ${row.ambiguityCount}` });
          continue;
        }

        task.painelId = row.painelId;
        task.painelUrl = row.painelUrl;

        const painel = await loadPainel(task);
        task.currentNome = painel.currentNome;
        task.newNome = makeNewNome(painel.currentNome, task.prefix, task.newEvent);
        task.status = task.currentNome === task.newNome ? "SKIP" : "OK";
        task.reason = task.status === "SKIP" ? "name already matches target event" : "";
      } catch (error) {
        task.status = "ERROR";
        task.reason = error.message || String(error);
      }

      resolved.push(task);
      await sleep(APP.minDelayMs);
    }

    return resolved;
  }

  async function updateName(task) {
    const painel = await loadPainel(task);
    const newNome = makeNewNome(painel.currentNome, task.prefix, task.newEvent);
    if (painel.currentNome === newNome) {
      return { skipped: true, status: 200, message: "name already target" };
    }

    const params = paramsFromForm(painel.editForm, { nome: newNome });
    const posted = await postUrlEncoded(formAction(painel.editForm, APP.editPath), params);
    await sleep(APP.minDelayMs);

    const verify = await loadPainel(task);
    if (verify.currentNome !== newNome) {
      throw new Error(`name verify failed: ${verify.currentNome}`);
    }

    task.currentNome = painel.currentNome;
    task.newNome = newNome;
    return { skipped: false, status: posted.response.status, message: "name updated" };
  }

  async function updatePassword(task) {
    const posted = await submitAccessFormPageCycle(task);
    return { status: posted.status, message: posted.message };
  }

  async function enableAccess(task) {
    const params = new URLSearchParams();
    params.set("id_usuario", task.painelId);
    params.set("status", "1");
    const posted = await postUrlEncoded(APP.accessStatusPath, params);
    return { status: posted.response.status, message: "access status posted" };
  }

  async function verifyTask(task) {
    const page = await requestText(task.painelUrl);
    const editForm = findEditForm(page.doc);
    const nome = editForm ? getFormValue(editForm, "nome") : "";
    const expectedNome = task.newNome || makeNewNome(nome, task.prefix, task.newEvent);
    const accessForm = findAccessForm(page.doc, task.login);

    return {
      status: 200,
      message: `name=${nome === expectedNome ? "OK" : "NG"} accessForm=${accessForm ? "OK" : "NG"}`,
      nome,
      expectedNome,
      hasAccessForm: !!accessForm
    };
  }

  function pushLog(task, step, result, status, message) {
    state.logs.push({
      lineNo: task.lineNo,
      login: task.login,
      painelId: task.painelId,
      step,
      result,
      status: status || "",
      message: String(message || "").replace(task.password || "__NO_PASSWORD__", "[PASSWORD]"),
      time: nowText()
    });
    saveLog();
    renderLog();
  }

  function workerUrl(task) {
    const url = new URL(task.painelUrl, location.origin);
    url.searchParams.set("_pwfab_worker", Date.now());
    url.hash = "pwfab-worker";
    return url.href;
  }

  function loadWorkerSession() {
    try {
      const parsed = JSON.parse(localStorage.getItem(APP.workerKey) || "null");
      return parsed && Array.isArray(parsed.tasks) ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function saveWorkerSession(session) {
    localStorage.setItem(APP.workerKey, JSON.stringify(session));
  }

  function clearWorkerSession() {
    localStorage.removeItem(APP.workerKey);
  }

  function appendStoredLog(task, step, result, status, message) {
    const row = {
      lineNo: task?.lineNo || "",
      login: task?.login || "",
      painelId: task?.painelId || "",
      step,
      result,
      status: status || "",
      message: String(message || "").replace(task?.password || "__NO_PASSWORD__", "[PASSWORD]"),
      time: nowText()
    };
    const current = localStorage.getItem(APP.logKey) || LOG_HEADERS.join("\t");
    localStorage.setItem(APP.logKey, `${current.replace(/\s+$/g, "")}\n${LOG_HEADERS.map(header => escTsv(row[header])).join("\t")}`);
    console.log("[PW-FUNCIONARIOS-WORKER]", row);
  }

  function isWorkerWindow() {
    return window.name === APP.workerWindowName && !!loadWorkerSession()?.running;
  }

  function goWorker(task) {
    location.href = workerUrl(task);
  }

  async function submitPasswordInCurrentPage(task, session) {
    const form = findAccessForm(document, task.login);
    if (!form) throw new Error(`access form not found in current page: ${task.login}`);
    const codbloq = extractCodbloq(document, form);
    if (!codbloq) throw new Error("access codbloq not found in current page");

    setFormValue(form, "login", task.login);
    setFormValue(form, "senha", task.password);
    setFormValue(form, "codbloq", codbloq);
    setFormValue(form, "id_funcionario", task.painelId);
    form.method = "POST";
    form.action = formAction(form, APP.accessCreatePath);

    session.stage = "access";
    session.updatedAt = nowText();
    saveWorkerSession(session);
    appendStoredLog(task, "password", "SUBMIT", "", "password form submitted; waiting page refresh");
    form.submit();
  }

  async function runWorkerWindow() {
    const session = loadWorkerSession();
    if (!session?.running || window.name !== APP.workerWindowName) return false;

    const task = session.tasks[session.index];
    if (!task) {
      session.running = false;
      session.finishedAt = nowText();
      saveWorkerSession(session);
      appendStoredLog({}, "worker", "DONE", "", "all tasks finished");
      return true;
    }

    try {
      if (!location.href.includes(`/cb/funcionarios/painel/${task.painelId}`) && session.stage !== "access") {
        setTimeout(() => goWorker(task), 300);
        return true;
      }

      if (!session.stage || session.stage === "name") {
        appendStoredLog(task, "name", "START", "", "worker name step");
        const nameResult = await updateName(task);
        appendStoredLog(task, "name", nameResult.skipped ? "SKIP" : "OK", nameResult.status, nameResult.message);
        session.stage = "password";
        session.updatedAt = nowText();
        saveWorkerSession(session);
        setTimeout(() => goWorker(task), 500);
        return true;
      }

      if (session.stage === "password") {
        if (!location.href.includes(`/cb/funcionarios/painel/${task.painelId}`)) {
          setTimeout(() => goWorker(task), 300);
          return true;
        }
        await submitPasswordInCurrentPage(task, session);
        return true;
      }

      if (session.stage === "access") {
        appendStoredLog(task, "access", "START", "", "worker access step after refresh");
        await sleep(700);
        const accessResult = await enableAccess(task);
        appendStoredLog(task, "access", "OK", accessResult.status, accessResult.message);

        try {
          const verify = await verifyTask(task);
          appendStoredLog(task, "verify", verify.message.includes("name=OK") && verify.message.includes("accessForm=OK") ? "OK" : "WARN", verify.status, verify.message);
        } catch (error) {
          appendStoredLog(task, "verify", "ERROR", "", error.message || String(error));
        }

        session.index += 1;
        session.stage = "name";
        session.updatedAt = nowText();
        saveWorkerSession(session);
        const next = session.tasks[session.index];
        if (next) {
          setTimeout(() => goWorker(next), 700);
        } else {
          session.running = false;
          session.finishedAt = nowText();
          saveWorkerSession(session);
          appendStoredLog(task, "worker", "DONE", "", "all tasks finished");
        }
        return true;
      }
    } catch (error) {
      appendStoredLog(task, session.stage || "worker", "ERROR", "", error.message || String(error));
      session.error = error.message || String(error);
      session.running = false;
      session.updatedAt = nowText();
      saveWorkerSession(session);
      return true;
    }

    return true;
  }

  async function runDryRun() {
    if (state.running) return;
    state.running = true;
    state.dryRunOk = false;
    try {
      const input = $("#pwfab-input").value || "";
      localStorage.setItem(APP.inputKey, input);
      const parsed = parseInput(input);
      if (parsed.errors.length) {
        state.tasks = parsed.errors.map(error => ({
          lineNo: error.lineNo,
          status: "ERROR",
          prefix: "",
          newEvent: "",
          login: "",
          passwordMasked: "",
          painelId: "",
          painelUrl: "",
          currentNome: "",
          newNome: "",
          reason: error.reason
        }));
        renderPreview();
        throw new Error(`input parse error: ${parsed.errors.length} rows`);
      }
      if (!parsed.tasks.length) throw new Error("no valid input rows");

      setStatus(`DRY RUN start: ${parsed.tasks.length} rows`);
      state.tasks = await resolveTasks(parsed.tasks, setStatus);
      state.dryRunOk = state.tasks.length > 0 && state.tasks.every(task => task.status === "OK" || task.status === "SKIP");
      renderPreview();
      setStatus(state.dryRunOk ? `DRY RUN OK: ${state.tasks.length} rows` : "DRY RUN has errors", !state.dryRunOk);
    } catch (error) {
      setStatus(`DRY RUN stopped: ${error.message || error}`, true);
    } finally {
      state.running = false;
      updateButtons();
    }
  }

  async function runExecute() {
    if (state.running) return;
    if (!state.dryRunOk) {
      alert("Run DRY RUN successfully before EXECUTE.");
      return;
    }
    const count = state.tasks.filter(task => task.status === "OK" || task.status === "SKIP").length;
    if (!confirm(`EXECUTE will update ${count} accounts.\n\nIt will POST name, password, and access status in PokerWeb.\nContinue?`)) return;

    state.running = true;
    updateButtons();
    try {
      setStatus(`EXECUTE start: ${count} rows`);
      for (let index = 0; index < state.tasks.length; index += 1) {
        const task = state.tasks[index];
        if (!(task.status === "OK" || task.status === "SKIP")) continue;

        setStatus(`EXECUTE ${index + 1}/${state.tasks.length}: ${task.login} name`);
        try {
          const nameResult = await updateName(task);
          pushLog(task, "name", nameResult.skipped ? "SKIP" : "OK", nameResult.status, nameResult.message);
        } catch (error) {
          pushLog(task, "name", "ERROR", "", error.message || String(error));
        }

        await sleep(APP.minDelayMs);
        setStatus(`EXECUTE ${index + 1}/${state.tasks.length}: ${task.login} password`);
        try {
          const passResult = await updatePassword(task);
          pushLog(task, "password", "OK", passResult.status, passResult.message);
        } catch (error) {
          pushLog(task, "password", "ERROR", "", error.message || String(error));
        }

        await sleep(APP.minDelayMs);
        setStatus(`EXECUTE ${index + 1}/${state.tasks.length}: ${task.login} access`);
        try {
          const accessResult = await enableAccess(task);
          pushLog(task, "access", "OK", accessResult.status, accessResult.message);
        } catch (error) {
          pushLog(task, "access", "ERROR", "", error.message || String(error));
        }

        await sleep(APP.minDelayMs);
        try {
          const verify = await verifyTask(task);
          pushLog(task, "verify", verify.message.includes("name=OK") && verify.message.includes("accessForm=OK") ? "OK" : "WARN", verify.status, verify.message);
        } catch (error) {
          pushLog(task, "verify", "ERROR", "", error.message || String(error));
        }

        await sleep(APP.minDelayMs);
      }
      setStatus("EXECUTE finished. Check log.");
    } finally {
      state.running = false;
      updateButtons();
    }
  }

  function runExecutePopup() {
    if (state.running) return;
    if (!state.dryRunOk) {
      alert("Run DRY RUN successfully before EXECUTE POPUP.");
      return;
    }
    const tasks = state.tasks.filter(task => task.status === "OK" || task.status === "SKIP");
    if (!tasks.length) {
      alert("No executable rows.");
      return;
    }
    if (!confirm(`EXECUTE POPUP will open a worker window and update ${tasks.length} accounts.\n\nThe worker window will navigate and refresh by itself. Continue?`)) return;

    const session = {
      running: true,
      index: 0,
      stage: "name",
      tasks,
      createdAt: nowText(),
      updatedAt: nowText()
    };
    saveWorkerSession(session);
    localStorage.setItem(APP.logKey, LOG_HEADERS.join("\t"));
    $("#pwfab-log").value = LOG_HEADERS.join("\t");

    const worker = window.open(workerUrl(tasks[0]), APP.workerWindowName, "width=1100,height=820");
    if (!worker) {
      setStatus("Popup blocked. Allow popup for this site, then try EXECUTE POPUP again.", true);
      return;
    }
    try { worker.name = APP.workerWindowName; } catch (_) {}
    setStatus(`Popup worker started: ${tasks.length} rows`);
  }

  function previewRows() {
    return state.tasks.map(task => ({
      lineNo: task.lineNo,
      status: task.status,
      prefix: task.prefix,
      newEvent: task.newEvent,
      login: task.login,
      passwordMasked: maskPassword(task.password),
      painelId: task.painelId,
      painelUrl: task.painelUrl,
      currentNome: task.currentNome,
      newNome: task.newNome,
      reason: task.reason
    }));
  }

  function renderPreview() {
    const text = toTsv(previewRows(), PREVIEW_HEADERS);
    $("#pwfab-preview").value = text;
    localStorage.setItem(APP.previewKey, text);
  }

  function renderLog() {
    const text = toTsv(state.logs, LOG_HEADERS);
    $("#pwfab-log").value = text;
    localStorage.setItem(APP.logKey, text);
  }

  function saveLog() {
    localStorage.setItem(APP.logKey, toTsv(state.logs, LOG_HEADERS));
  }

  function clearAll() {
    if (!confirm("Clear input, preview, and log?")) return;
    localStorage.removeItem(APP.inputKey);
    localStorage.removeItem(APP.previewKey);
    localStorage.removeItem(APP.logKey);
    state.dryRunOk = false;
    state.tasks = [];
    state.logs = [];
    $("#pwfab-input").value = SAMPLE_INPUT;
    $("#pwfab-preview").value = PREVIEW_HEADERS.join("\t");
    $("#pwfab-log").value = LOG_HEADERS.join("\t");
    updateButtons();
    setStatus("Cleared.");
  }

  function updateButtons() {
    const dry = $("#pwfab-dry-run");
    const exec = $("#pwfab-execute");
    const popup = $("#pwfab-execute-popup");
    if (dry) dry.disabled = state.running;
    if (exec) exec.disabled = state.running || !state.dryRunOk;
    if (popup) popup.disabled = state.running || !state.dryRunOk;
  }

  async function runDiagnose() {
    try {
      const dt = dataTable();
      const params = cloneDataTableParams(dt);
      const currentUrls = [...document.querySelectorAll('a[href*="/cb/funcionarios/painel/"]')]
        .map(a => a.href)
        .filter((href, index, list) => list.indexOf(href) === index);
      let info = null;
      try { info = dt?.page?.info?.() || null; } catch (_) {}
      const report = [
        `ajaxUrl	${dataTableAjaxUrl(dt)}`,
        `location	${location.href}`,
        `title	${document.title || ""}`,
        `currentDomPainelUrls	${currentUrls.length}`,
        `recordsTotal	${info?.recordsTotal ?? ""}`,
        `recordsDisplay	${info?.recordsDisplay ?? ""}`,
        `pages	${info?.pages ?? ""}`,
        `lastStart	${params.start ?? ""}`,
        `lastLength	${params.length ?? ""}`,
        `lastSearch	${params.search?.value ?? ""}`
      ].join("\n");
      $("#pwfab-preview").value = report;
      copyText(report);
      setStatus("Diagnose copied: datatables/listar mode");
    } catch (error) {
      setStatus(`Diagnose failed: ${error.message || error}`, true);
    }
  }

  function installPanel() {
    if ($("#pwfab-panel")) return;
    const panel = document.createElement("div");
    panel.id = "pwfab-panel";
    panel.innerHTML = `
      <style>
        #pwfab-panel {
          position: fixed;
          right: 12px;
          bottom: 12px;
          width: 560px;
          max-width: calc(100vw - 24px);
          z-index: 999999;
          background: #17202a;
          color: #f5f7fa;
          border: 1px solid #5a6b7c;
          box-shadow: 0 10px 30px rgba(0,0,0,.35);
          font: 12px/1.45 Arial, sans-serif;
        }
        #pwfab-panel.pwfab-minimized .pwfab-body { display: none; }
        #pwfab-panel button {
          border: 1px solid #6f8396;
          background: #eef2f5;
          color: #17202a;
          padding: 6px 8px;
          cursor: pointer;
        }
        #pwfab-panel button:disabled { opacity: .45; cursor: not-allowed; }
        #pwfab-panel textarea {
          width: 100%;
          box-sizing: border-box;
          background: #0d141b;
          color: #f7fbff;
          border: 1px solid #46596b;
          padding: 6px;
          font: 12px/1.35 Consolas, monospace;
          resize: vertical;
        }
        #pwfab-panel .pwfab-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 8px 10px;
          background: #22303d;
          font-weight: bold;
        }
        #pwfab-panel .pwfab-body { padding: 10px; }
        #pwfab-panel .pwfab-row { display: flex; gap: 6px; margin: 7px 0; }
        #pwfab-panel .pwfab-label { margin: 8px 0 4px; color: #cdd9e5; font-weight: bold; }
        #pwfab-panel #pwfab-status { min-height: 18px; color: #d7f8ff; }
      </style>
      <div class="pwfab-head">
        <span>PW Funcionarios Account Batch v0.2.0</span>
        <button id="pwfab-toggle" type="button">_</button>
      </div>
      <div class="pwfab-body">
        <div id="pwfab-status">Ready. Paste dirty TSV, then DRY RUN.</div>
        <div class="pwfab-label">Input TSV</div>
        <textarea id="pwfab-input" rows="7" spellcheck="false"></textarea>
        <div class="pwfab-row">
          <button id="pwfab-dry-run" type="button" style="flex:1;background:#ffe08a;">DRY RUN</button>
          <button id="pwfab-execute" type="button" style="flex:1;background:#ffb3b3;" disabled>EXECUTE</button>
          <button id="pwfab-execute-popup" type="button" style="flex:1;background:#b7f7c1;" disabled>EXECUTE POPUP</button>
          <button id="pwfab-diagnose" type="button">Diagnose</button>
          <button id="pwfab-copy-preview" type="button">Copy Preview</button>
          <button id="pwfab-copy-log" type="button">Copy Log</button>
          <button id="pwfab-clear" type="button">Clear</button>
        </div>
        <div class="pwfab-label">Preview</div>
        <textarea id="pwfab-preview" rows="7" spellcheck="false" readonly></textarea>
        <div class="pwfab-label">Log</div>
        <textarea id="pwfab-log" rows="7" spellcheck="false" readonly></textarea>
      </div>
    `;
    document.body.appendChild(panel);

    $("#pwfab-input").value = localStorage.getItem(APP.inputKey) || SAMPLE_INPUT;
    $("#pwfab-preview").value = localStorage.getItem(APP.previewKey) || PREVIEW_HEADERS.join("\t");
    $("#pwfab-log").value = localStorage.getItem(APP.logKey) || LOG_HEADERS.join("\t");

    $("#pwfab-toggle").addEventListener("click", () => {
      panel.classList.toggle("pwfab-minimized");
    });
    $("#pwfab-dry-run").addEventListener("click", runDryRun);
    $("#pwfab-execute").addEventListener("click", runExecute);
    $("#pwfab-execute-popup").addEventListener("click", runExecutePopup);
    $("#pwfab-diagnose").addEventListener("click", runDiagnose);
    $("#pwfab-copy-preview").addEventListener("click", () => copyText($("#pwfab-preview").value || ""));
    $("#pwfab-copy-log").addEventListener("click", () => copyText($("#pwfab-log").value || ""));
    $("#pwfab-clear").addEventListener("click", clearAll);
    $("#pwfab-input").addEventListener("input", () => {
      localStorage.setItem(APP.inputKey, $("#pwfab-input").value || "");
      state.dryRunOk = false;
      updateButtons();
    });
  }

  setTimeout(async () => {
    if (await runWorkerWindow()) return;
    installPanel();
  }, 300);
})();
