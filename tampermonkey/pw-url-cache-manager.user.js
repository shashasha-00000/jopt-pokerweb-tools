// ==UserScript==
// @name         PW URL Cache Manager
// @namespace    pw-shared-url-cache-manager
// @version      0.7.0
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-url-cache-manager.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-url-cache-manager.user.js
// @description  PW大会URL共用缓存管理工具。大会名リスト検索 / イベントPrefix全ページ収集 / 汚染チェック・修復 / Sheet用TSV出力。
// @author       xhpc007 + ChatGPT
// @match        https://japanopt.pokerweb.com.br/cb/*
// @match        https://japanopt.pokerweb.com.br/*
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const SHARED_CACHE_KEY = "PW_SHARED_TOURNAMENT_URL_CACHE_V1";
  const RESOLVE_REQUEST_KEY = "PW_URL_MANAGER_RESOLVE_REQUEST_V1";
  const RESOLVE_RESPONSE_KEY = "PW_URL_MANAGER_RESOLVE_RESPONSE_V1";

  const CONFIG = {
    inputKey: "PW_URL_CACHE_MANAGER_INPUT_V02",
    prefixKey: "PW_URL_CACHE_MANAGER_PREFIX_V02",
    reportKey: "PW_URL_CACHE_MANAGER_REPORT_V02",

    searchTimeoutMs: 25000,
    searchPollMs: 300,
    stablePollCount: 3,
    betweenSearchMs: 900,
    pageLength: 100,
    nameSearchRetry: 2,
    eventScanRounds: 2,
    rowStableAttempts: 3,
    rowStableDelayMs: 220,
    auditIntervalMs: 180000,

    listPages: [
      { label: "CLOSED", path: "/cb/torneio/fechados" },
      { label: "OPEN", path: "/cb/torneio/abertos" }
    ]
  };

  let running = false;
  let stopRequested = false;
  let auditTimer = null;
  let lastAuditSignature = "";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function norm(value) {
    return String(value ?? "")
      .replace(/\u3000/g, " ")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t\r\n]+/g, " ")
      .trim();
  }

  function compact(value) {
    return norm(value)
      .replace(/[\/／]/g, "")
      .replace(/\s+/g, "")
      .replace(/監査(?:済み|待ち)/g, "")
      .toLowerCase();
  }

  function isVisibleInWindow(win, el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = win.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function nowText() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function escTsv(value) {
    return String(value ?? "")
      .replace(/\t/g, " ")
      .replace(/\r?\n/g, " ")
      .trim();
  }

  function copyText(text) {
    try {
      if (typeof GM_setClipboard === "function") {
        GM_setClipboard(text);
        return true;
      }
    } catch (_) {}

    try {
      navigator.clipboard.writeText(text);
      return true;
    } catch (_) {}

    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    return true;
  }

  function setStatus(text) {
    console.log("[PW-URL-CACHE-v0.7]", text);
    const box = document.querySelector("#pw-url-cache-status");
    if (box) box.textContent = text;
  }

  function appendReport(type, msg) {
    const line = `[${nowText()}] ${type}  ${msg}`;
    console.log("[PW-URL-CACHE-v0.7]", line);

    const box = document.querySelector("#pw-url-cache-report");
    if (box) {
      box.value += (box.value ? "\n" : "") + line;
      box.scrollTop = box.scrollHeight;
      localStorage.setItem(CONFIG.reportKey, box.value);
    }
  }

  function clearReport() {
    const box = document.querySelector("#pw-url-cache-report");
    if (box) box.value = "";
    localStorage.removeItem(CONFIG.reportKey);
    setStatus("Report cleared");
  }

  function loadCache() {
    try {
      const raw = localStorage.getItem(SHARED_CACHE_KEY);
      if (!raw) return {};

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

      return parsed;
    } catch (_) {
      return {};
    }
  }

  function saveCache(cache) {
    localStorage.setItem(SHARED_CACHE_KEY, JSON.stringify(cache));
  }

  function cleanTournamentName(name) {
    return String(name || "")
      .replace(/\s*-\s*PokerWeb\s*$/i, "")
      .replace(/\s*監査(?:済み|待ち)\s*$/g, "")
      .trim();
  }

  function replaceCacheForName(name, selected) {
    const cleanName = cleanTournamentName(name);
    const cache = loadCache();

    for (const [key, item] of Object.entries(cache)) {
      if (
        cleanTournamentName(item?.name || "") === cleanName ||
        cleanTournamentName(item?.actualName || "") === cleanName
      ) {
        delete cache[key];
      }
    }

    saveCache(cache);
    setCacheItem(cleanName, {
      ...selected,
      actualName: cleanName,
      source: "url-manager-manual-review"
    });
  }

  function renderManualReview() {
    const box = document.querySelector("#pw-url-cache-review");
    if (!box) return;

    const prefix = getEventPrefixInput();
    const groups = new Map();
    for (const row of cacheToRows(prefix)) {
      const name = cleanTournamentName(row.Name || row.Actual_Name || "");
      if (!name) continue;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(row);
    }

    const conflicts = Array.from(groups.entries()).filter(([, rows]) => {
      return new Set(rows.map(row => row.TournamentId)).size > 1;
    });

    box.replaceChildren();
    if (!conflicts.length) {
      box.textContent = "需要人工确认的同名URL冲突：0";
      box.style.color = "#9f9";
      return;
    }

    box.style.color = "#fff";
    for (const [name, rows] of conflicts) {
      const card = document.createElement("div");
      card.style.cssText = "border:1px solid #955;background:#2b2020;padding:7px;margin-top:6px;";

      const title = document.createElement("div");
      title.style.fontWeight = "bold";
      title.textContent = name;
      card.appendChild(title);

      for (const row of rows) {
        const line = document.createElement("div");
        line.style.cssText = "display:flex;gap:5px;align-items:center;margin-top:5px;";

        const text = document.createElement("span");
        text.textContent = `比赛编号 ${row.TournamentId}`;
        line.appendChild(text);

        const open = document.createElement("button");
        open.textContent = "打开URL";
        open.onclick = () => window.open(row.URL, "_blank");
        line.appendChild(open);

        const adopt = document.createElement("button");
        adopt.textContent = `采用 ${row.TournamentId} 并清除其他记录`;
        adopt.onclick = () => {
          if (!confirm(`采用这个URL并清除同名其他记录吗？\n\n${name}\n${row.URL}`)) return;
          replaceCacheForName(name, {
            tournamentId: row.TournamentId,
            url: row.URL,
            matchedRow: row.Matched_Row || ""
          });
          showCache(prefix);
        };
        line.appendChild(adopt);
        card.appendChild(line);
      }

      box.appendChild(card);
    }
  }

  function setCacheItem(name, data) {
    const cleanName = cleanTournamentName(name);
    if (!cleanName) return false;

    const id = String(data.tournamentId || "").trim();
    const url = String(data.url || (id ? `/cb/torneio/painel/${id}` : "")).trim();

    if (!id || !url) return false;

    const key = `${cleanName}||${id}`;
    const cache = loadCache();

    cache[key] = {
      name: cleanName,
      tournamentId: id,
      url,
      actualName: cleanTournamentName(data.actualName || data.name || cleanName),
      matchedRow: String(data.matchedRow || ""),
      savedAt: nowText(),
      source: String(data.source || "url-cache-v0.6")
    };

    saveCache(cache);
    return true;
  }

  function getCacheCount() {
    return Object.keys(loadCache()).length;
  }

  function getEventPrefixInput() {
    return norm(document.querySelector("#pw-url-cache-prefix")?.value || "");
  }

  function cacheToRows(prefix) {
    const p = norm(prefix || "");
    const cache = loadCache();
    const seen = new Set();

    return Object.values(cache)
      .filter((x) => {
        if (!p) return true;
        return String(x.name || "").includes(p) || String(x.actualName || "").includes(p);
      })
      .filter((x) => {
        const id = String(x.tournamentId || "").trim();
        const url = String(x.url || "").trim();
        const key = id || url || `${x.name || ""}|${x.actualName || ""}`;

        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ja"))
      .map((x) => ({
        Name: x.name || "",
        TournamentId: x.tournamentId || "",
        URL: x.url || "",
        Actual_Name: x.actualName || "",
        Source: x.source || "",
        SavedAt: x.savedAt || "",
        Matched_Row: x.matchedRow || ""
      }));
  }

  function rowsToTsv(rows, headers) {
    return [
      headers.join("\t"),
      ...rows.map((r) => headers.map((h) => escTsv(r[h])).join("\t"))
    ].join("\n");
  }

  function cacheToFullTsv(prefix) {
    return rowsToTsv(
      cacheToRows(prefix),
      ["Name", "TournamentId", "URL", "Actual_Name", "Source", "SavedAt", "Matched_Row"]
    );
  }

  function cacheToSheetTsv(prefix) {
    return rowsToTsv(
      cacheToRows(prefix),
      ["Name", "TournamentId", "URL", "Actual_Name"]
    );
  }

  function showCache(prefix) {
    const usePrefix = prefix === undefined ? "" : prefix;
    const rows = cacheToRows(usePrefix);
    const output = document.querySelector("#pw-url-cache-output");

    if (output) {
      output.value = cacheToFullTsv(usePrefix);
    }

    setStatus(`Cache shown: ${rows.length} / all ${getCacheCount()} 件`);
    appendReport("VIEW_CACHE", `${rows.length} 件`);
    renderManualReview();
  }

  function clearAllCache() {
    const ok = confirm(
      "共有URL Cacheを全部削除します。\n\n" +
      "対象 localStorage key:\n" +
      SHARED_CACHE_KEY + "\n\n" +
      "本当に削除しますか？"
    );

    if (!ok) return;

    localStorage.removeItem(SHARED_CACHE_KEY);

    const output = document.querySelector("#pw-url-cache-output");
    if (output) output.value = "";

    appendReport("CLEAR_ALL", "全URL Cacheを削除");
    setStatus("All URL Cache cleared");
  }

  function clearCurrentEventCache() {
    const prefix = getEventPrefixInput();

    if (!prefix) {
      alert("Event Prefix が空です。例：【JOPT 2026 Grand Final】");
      return;
    }

    const cache = loadCache();
    const keys = Object.keys(cache);
    const targets = keys.filter((k) => k.includes(prefix) || String(cache[k].actualName || "").includes(prefix));

    if (!targets.length) {
      alert(`この Prefix のCacheはありません：${prefix}`);
      return;
    }

    const ok = confirm(
      `Current Event Cache を削除します。\n\n` +
      `Prefix: ${prefix}\n` +
      `対象: ${targets.length} 件\n\n` +
      `本当に削除しますか？`
    );

    if (!ok) return;

    for (const k of targets) delete cache[k];

    saveCache(cache);
    showCache(prefix);

    appendReport("CLEAR_EVENT", `${prefix} / ${targets.length} 件削除`);
    setStatus(`Current Event Cache cleared: ${targets.length} 件`);
  }

  function parseInput(raw) {
    const lines = String(raw || "")
      .split(/\r?\n/)
      .map((x) => x.replace(/\uFEFF/g, ""))
      .filter((x) => norm(x));

    if (!lines.length) return { mode: "empty", rows: [] };

    const first = lines[0].split("\t").map(norm);
    const hasHeader =
      first.includes("Name") ||
      first.includes("大会名") ||
      first.includes("TournamentId") ||
      first.includes("URL");

    if (hasHeader) {
      const header = first;
      const idx = (...names) => {
        for (const name of names) {
          const i = header.findIndex((h) => norm(h).toLowerCase() === norm(name).toLowerCase());
          if (i >= 0) return i;
        }
        return -1;
      };

      const iName = idx("Name", "大会名", "Input_Name");
      const iId = idx("TournamentId", "tournamentId", "ID");
      const iUrl = idx("URL", "Url");
      const iActual = idx("Actual_Name", "ActualName", "PW_Name");
      const iMatched = idx("Matched_Row", "MatchedRow");

      const rows = lines.slice(1).map((line) => {
        const cols = line.split("\t");

        return {
          name: iName >= 0 ? norm(cols[iName]) : "",
          tournamentId: iId >= 0 ? norm(cols[iId]) : "",
          url: iUrl >= 0 ? norm(cols[iUrl]) : "",
          actualName: iActual >= 0 ? norm(cols[iActual]) : "",
          matchedRow: iMatched >= 0 ? norm(cols[iMatched]) : "",
          rawLine: line
        };
      }).filter((r) => r.name || r.url || r.tournamentId);

      const hasUrl = rows.some((r) => r.url || r.tournamentId);

      return {
        mode: hasUrl ? "import_tsv" : "name_list",
        rows
      };
    }

    const rows = lines.map((line) => ({
      name: norm(line),
      tournamentId: "",
      url: "",
      actualName: "",
      matchedRow: "",
      rawLine: line
    })).filter((r) => r.name);

    return { mode: "name_list", rows };
  }

  function normalizeUrlAndId(row) {
    let id = norm(row.tournamentId || "");
    let url = norm(row.url || "");

    const joined = `${url} ${id} ${row.rawLine || ""}`;
    const m = joined.match(/\/cb\/torneio\/painel\/(\d+)/);

    if (m) {
      id = m[1];
      url = `/cb/torneio/painel/${id}`;
    }

    if (!url && id && /^\d+$/.test(id)) {
      url = `/cb/torneio/painel/${id}`;
    }

    if (!id && url) {
      const m2 = url.match(/\/cb\/torneio\/painel\/(\d+)/);
      if (m2) id = m2[1];
    }

    return { id, url };
  }

  function importCacheFromTsv() {
    const raw = document.querySelector("#pw-url-cache-input")?.value || "";
    const parsed = parseInput(raw);

    if (!parsed.rows.length) {
      alert("入力が空です");
      return;
    }

    let okCount = 0;
    let ngCount = 0;

    for (const r of parsed.rows) {
      const name = norm(r.name || r.actualName || "");
      const { id, url } = normalizeUrlAndId(r);

      if (!name || !id || !url) {
        ngCount++;
        appendReport("IMPORT_NG", `name/id/url不足: ${r.rawLine || JSON.stringify(r)}`);
        continue;
      }

      const ok = setCacheItem(name, {
        tournamentId: id,
        url,
        actualName: r.actualName || name,
        matchedRow: r.matchedRow || "",
        source: "import-v0.6"
      });

      if (ok) {
        okCount++;
        appendReport("IMPORT_OK", `${name} → ${url}`);
      } else {
        ngCount++;
        appendReport("IMPORT_NG", `${name} → ${url}`);
      }
    }

    localStorage.setItem(CONFIG.inputKey, raw);
    showCache();

    alert(`Import 完了\nOK: ${okCount}\nNG: ${ngCount}`);
    setStatus(`Import done: OK ${okCount} / NG ${ngCount}`);
  }

  function waitForWindowLoad(win, timeoutMs = 25000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();

      const tick = () => {
        try {
          if (!win || win.closed) {
            reject(new Error("WINDOW_CLOSED"));
            return;
          }

          if (win.document && win.document.readyState === "complete") {
            resolve(true);
            return;
          }
        } catch (e) {
          reject(e);
          return;
        }

        if (Date.now() - start >= timeoutMs) {
          reject(new Error("window load timeout"));
          return;
        }

        setTimeout(tick, 300);
      };

      tick();
    });
  }

  async function waitForInWindow(win, fn, timeoutMs = 15000, intervalMs = 300) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const result = fn(win);
        if (result) return result;
      } catch (_) {}

      await sleep(intervalMs);
    }

    return null;
  }

  function findDataTablesSearchInputInWindow(win) {
    const candidates = [
      ...win.document.querySelectorAll('.dataTables_filter input[type="search"]'),
      ...win.document.querySelectorAll('input[type="search"]')
    ];

    return candidates.find((el) => isVisibleInWindow(win, el)) || candidates[0] || null;
  }

  function setNativeInputValue(input, value) {
    const proto = Object.getPrototypeOf(input);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");

    if (desc && desc.set) desc.set.call(input, value);
    else input.value = value;
  }

  function dispatchSearchInputInWindow(win, input, value) {
    input.focus();
    setNativeInputValue(input, value);

    input.dispatchEvent(new win.Event("input", { bubbles: true }));
    input.dispatchEvent(new win.Event("change", { bubbles: true }));

    input.dispatchEvent(new win.KeyboardEvent("keydown", {
      bubbles: true,
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13
    }));

    input.dispatchEvent(new win.KeyboardEvent("keyup", {
      bubbles: true,
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13
    }));

    try {
      if (win.jQuery) {
        win.jQuery(input)
          .val(value)
          .trigger("input")
          .trigger("keyup")
          .trigger("change");
      }
    } catch (_) {}
  }

  function getDataTableRows(win, searchApplied) {
    const rows = [];

    try {
      if (win.jQuery && win.jQuery.fn && win.jQuery.fn.dataTable) {
        const tables = win.jQuery.fn.dataTable.tables();

        Array.from(tables || []).forEach((table) => {
          try {
            if (!win.jQuery.fn.DataTable.isDataTable(table)) return;

            const dt = win.jQuery(table).DataTable();
            const selector = searchApplied ? { search: "applied" } : {};

            dt.rows(selector).nodes().each((tr) => {
              if (tr) rows.push(tr);
            });
          } catch (_) {}
        });
      }
    } catch (_) {}

    return rows;
  }

  function getPrimaryDataTable(win) {
    try {
      if (!win.jQuery || !win.jQuery.fn || !win.jQuery.fn.dataTable) return null;

      const tables = win.jQuery.fn.dataTable.tables();

      for (const table of Array.from(tables || [])) {
        try {
          if (!win.jQuery.fn.DataTable.isDataTable(table)) continue;
          const dt = win.jQuery(table).DataTable();
          if (dt) return dt;
        } catch (_) {}
      }
    } catch (_) {}

    return null;
  }

  function getPageInfoSafe(dt) {
    try {
      return dt && dt.page && dt.page.info ? dt.page.info() : null;
    } catch (_) {
      return null;
    }
  }

  function getDataTableNodeSafe(dt) {
    try {
      return dt && dt.table && dt.table().node ? dt.table().node() : null;
    } catch (_) {
      return null;
    }
  }

  function getProcessingVisibleInWindow(win, dt) {
    try {
      const tableNode = getDataTableNodeSafe(dt);
      const wrapper = tableNode ? tableNode.closest(".dataTables_wrapper") : null;
      const roots = wrapper ? [wrapper] : [win.document];

      return roots.some((root) => {
        return Array.from(root.querySelectorAll(".dataTables_processing")).some((el) => {
          const style = win.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        });
      });
    } catch (_) {
      return false;
    }
  }

  function waitNextDataTableDraw(win, dt, label) {
    return new Promise((resolve) => {
      const tableNode = getDataTableNodeSafe(dt);

      if (!tableNode || !win.jQuery) {
        resolve({ ok: false, reason: "NO_TABLE", label });
        return;
      }

      let done = false;
      const timer = win.setTimeout(() => {
        if (done) return;
        done = true;
        try {
          win.jQuery(tableNode).off("draw.dt", onDraw);
        } catch (_) {}
        resolve({ ok: false, reason: "DRAW_TIMEOUT", label });
      }, CONFIG.searchTimeoutMs);

      function onDraw() {
        if (done) return;
        done = true;
        win.clearTimeout(timer);
        try {
          win.jQuery(tableNode).off("draw.dt", onDraw);
        } catch (_) {}
        resolve({ ok: true, reason: "DRAW_OK", label });
      }

      try {
        win.jQuery(tableNode).one("draw.dt", onDraw);
      } catch (_) {
        win.clearTimeout(timer);
        resolve({ ok: false, reason: "DRAW_BIND_ERROR", label });
      }
    });
  }

  async function waitProcessingGone(win, dt) {
    const start = Date.now();

    while (Date.now() - start < CONFIG.searchTimeoutMs) {
      if (!getProcessingVisibleInWindow(win, dt)) return true;
      await sleep(CONFIG.searchPollMs);
    }

    return false;
  }

  async function runDataTableActionAndWait(win, dt, action, label) {
    const drawPromise = waitNextDataTableDraw(win, dt, label);

    try {
      action();
    } catch (e) {
      appendReport("DT_ACTION_ERROR", `${label}: ${e.message || String(e)}`);
      return false;
    }

    const drawResult = await drawPromise;
    const processingGone = await waitProcessingGone(win, dt);

    await sleep(0);

    if (!drawResult.ok) {
      appendReport("DT_DRAW_WARN", `${label}: ${drawResult.reason}`);
    }

    if (!processingGone) {
      appendReport("DT_PROCESS_WARN", `${label}: processing timeout`);
    }

    return drawResult.ok || processingGone;
  }

  function rowHasPanelLink(row) {
    return String(row && row.innerHTML || "").includes("/cb/torneio/painel/");
  }

  function getRowsSignature(rows) {
    return (rows || [])
      .map((row) => String(row && row.outerHTML || row && row.innerText || "").slice(0, 500))
      .join("||");
  }

  function getCurrentDataTableTbodyRows(win, dt) {
    const rows = [];

    try {
      const tableNode = getDataTableNodeSafe(dt);
      if (!tableNode) return rows;

      Array.from(tableNode.querySelectorAll("tbody tr")).forEach((tr) => {
        if (rowHasPanelLink(tr)) rows.push(tr);
      });
    } catch (_) {}

    return rows;
  }

  function getRowsForRead(win, searchApplied) {
    const set = new Set();
    const out = [];

    function add(row) {
      if (!row || !rowHasPanelLink(row)) return;
      const key = row.outerHTML || row.innerText || Math.random();
      if (set.has(key)) return;
      set.add(key);
      out.push(row);
    }

    const dt = getPrimaryDataTable(win);

    if (dt) {
      getCurrentDataTableTbodyRows(win, dt).forEach(add);
    }

    getDataTableRows(win, searchApplied).forEach(add);

    if (dt) {
      try {
        const tableNode = getDataTableNodeSafe(dt);
        Array.from(tableNode.querySelectorAll("tbody tr")).forEach(add);
      } catch (_) {}
    }

    return out;
  }

  async function readRowsForReadStable(win, searchApplied) {
    let bestRows = [];
    let lastSig = "";

    for (let i = 0; i < CONFIG.rowStableAttempts; i++) {
      const rows = getRowsForRead(win, searchApplied);
      const sig = getRowsSignature(rows);

      if (rows.length > bestRows.length) bestRows = rows;

      if (sig && sig === lastSig) return rows;
      lastSig = sig;

      await sleep(CONFIG.rowStableDelayMs);
    }

    return bestRows;
  }

  function getVisibleResultSignature(win) {
    const rows = getRowsForRead(win, true);
    return rows
      .map((row) => norm(row.innerText || row.textContent || "").slice(0, 300))
      .join("||");
  }

  async function waitSearchStable(win) {
    let last = "";
    let stable = 0;
    const start = Date.now();

    while (Date.now() - start < CONFIG.searchTimeoutMs) {
      const sig = getVisibleResultSignature(win);

      if (sig && sig === last) {
        stable++;
      } else {
        stable = 0;
        last = sig;
      }

      if (stable >= CONFIG.stablePollCount) {
        return true;
      }

      await sleep(CONFIG.searchPollMs);
    }

    return false;
  }

  async function applySearchAndMaxLength(win, searchText) {
    const dt = getPrimaryDataTable(win);

    if (dt) {
      try {
        await runDataTableActionAndWait(win, dt, () => {
          dt.search(searchText);
          dt.page.len(CONFIG.pageLength);
          dt.page(0);
          dt.draw();
        }, `search:${searchText}`);

        await readRowsForReadStable(win, true);
        return dt;
      } catch (e) {
        appendReport("DT_SEARCH_ERROR", `${searchText}: ${e.message || String(e)}`);
      }
    }

    const input = findDataTablesSearchInputInWindow(win);
    if (input) {
      dispatchSearchInputInWindow(win, input, searchText);
      await waitSearchStable(win);
    }

    return getPrimaryDataTable(win);
  }

  async function clearDataTableSearch(win, dt) {
    if (!dt) return false;

    return runDataTableActionAndWait(win, dt, () => {
      dt.search("");
      dt.page.len(CONFIG.pageLength);
      dt.page(0);
      dt.draw();
    }, "clear-search");
  }

  async function goToDataTablePage(win, dt, pageIndex) {
    try {
      await runDataTableActionAndWait(win, dt, () => {
        dt.page(pageIndex).draw("page");
      }, `page:${pageIndex + 1}`);

      await readRowsForReadStable(win, true);
      return true;
    } catch (e) {
      appendReport("PAGE_ERROR", `page ${pageIndex + 1}: ${e.message || String(e)}`);
      return false;
    }
  }

  function extractTournamentTitleFromRow(rowText) {
    let s = norm(rowText);

    const m = s.match(/(【[^】]+】\s*(?:#\d+[A-Za-z]?|\(s\d+\)|s\d+)\s+.+?)(?:\s+\d{1,2}\/\d{1,2}\/\d{4}|\s+Aberto|\s+Fechado|\s+オープン|\s+クローズ|$)/i);
    if (m) return cleanTournamentName(m[1]);

    const m2 = s.match(/(【[^】]+】.+?)(?:\s+\d{1,2}\/\d{1,2}\/\d{4}|\s+Aberto|\s+Fechado|$)/i);
    if (m2) return cleanTournamentName(m2[1]);

    const m3 = s.match(/(【[^】]+】.+)/);
    if (m3) return cleanTournamentName(m3[1]);

    s = s
      .replace(/^アクション\s+/i, "")
      .replace(/^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s+/, "")
      .replace(/\s+\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}$/, "")
      .replace(/\s+Aberto$/i, "")
      .replace(/\s+Fechado$/i, "")
      .replace(/\s+オープン$/i, "")
      .replace(/\s+クローズ$/i, "")
      .trim();

    return cleanTournamentName(s);
  }

  function getEventPrefixFromTournamentName(name) {
    const s = norm(name);

    const m = s.match(/【[^】]+】/);
    if (m) return m[0];

    if (/自動化領収書/.test(s)) {
      return "自動化領収書";
    }

    return s
      .replace(/\d+$/g, "")
      .trim();
  }

  function getTournamentNoKeyFromName(name) {
    const s = norm(name);

    const sat = s.match(/\(?\s*s\s*0*(\d{1,3})\s*\)?/i);
    if (sat) return `s${String(Number(sat[1])).padStart(2, "0")}`;

    const m = s.match(/#\s*0*(\d{1,3})([A-Za-z])?/);
    if (m) {
      const num = String(Number(m[1])).padStart(2, "0");
      const suffix = m[2] ? m[2].toUpperCase() : "";
      return `#${num}${suffix}`;
    }

    return "";
  }

  function isSameTournamentLooseSafe(inputName, actualName) {
    const inputClean = norm(inputName);
    const actualClean = norm(actualName);

    if (!inputClean || !actualClean) return false;
    if (compact(inputClean) === compact(actualClean)) return true;

    const inputPrefix = getEventPrefixFromTournamentName(inputClean);
    const actualPrefix = getEventPrefixFromTournamentName(actualClean);
    const inputNo = getTournamentNoKeyFromName(inputClean);
    const actualNo = getTournamentNoKeyFromName(actualClean);

    if (!inputPrefix || !actualPrefix || !inputNo || !actualNo) return false;

    return compact(inputPrefix) === compact(actualPrefix) && inputNo === actualNo;
  }

  function extractTournamentFromRow(row) {
    const rowText = norm(row.innerText || row.textContent || "");
    const rowHtml = row.innerHTML || "";

    const m = String(rowHtml).match(/\/cb\/torneio\/painel\/(\d+)/);
    if (!m) return null;

    const actualName = extractTournamentTitleFromRow(rowText);

    return {
      tournamentId: m[1],
      url: `/cb/torneio/painel/${m[1]}`,
      actualName,
      matchedRow: rowText
    };
  }

  function findTournamentFromRows(rows, inputName) {
    const matches = [];

    for (const row of rows) {
      const found = extractTournamentFromRow(row);
      if (!found) continue;
      if (!isSameTournamentLooseSafe(inputName, found.actualName)) continue;
      matches.push(found);
    }

    const seen = new Set();
    const unique = matches.filter((x) => {
      if (seen.has(x.url)) return false;
      seen.add(x.url);
      return true;
    });

    if (unique.length === 1) return unique[0];

    if (unique.length > 1) {
      return {
        error: "AMBIGUOUS",
        candidates: unique
      };
    }

    return null;
  }

  function collectEventPrefixRows(win, prefix) {
    const rows = getRowsForRead(win, true);
    const matches = [];

    for (const row of rows) {
      const found = extractTournamentFromRow(row);
      if (!found) continue;

      const name = found.actualName || "";
      const all = `${name} ${found.matchedRow || ""}`;

      if (all.includes(prefix) || compact(all).includes(compact(prefix))) {
        matches.push(found);
      }
    }

    const seen = new Set();
    return matches.filter((x) => {
      if (seen.has(x.url)) return false;
      seen.add(x.url);
      return true;
    });
  }

  async function collectEventPrefixRowsAllPages(item, prefix) {
    const win = item.win;
    const foundAll = [];
    const seen = new Set();

    const dt = await applySearchAndMaxLength(win, prefix);
    const firstInfo = getPageInfoSafe(dt);
    const pages = firstInfo && firstInfo.pages ? firstInfo.pages : 1;
    const recordsDisplay = firstInfo && typeof firstInfo.recordsDisplay === "number" ? firstInfo.recordsDisplay : "";
    const serverSide = firstInfo && firstInfo.serverSide ? "serverSide" : "clientSide";

    appendReport(
      "EVENT_PAGE_INFO",
      `${item.label}: pages=${pages} / length=${firstInfo ? firstInfo.length : "?"} / records=${recordsDisplay} / ${serverSide}`
    );

    for (let page = 0; page < pages; page++) {
      if (stopRequested) break;

      if (dt) {
        await goToDataTablePage(win, dt, page);
      }

      await readRowsForReadStable(win, true);

      const rows = collectEventPrefixRows(win, prefix);
      appendReport("EVENT_PAGE", `${item.label}: ${page + 1}/${pages} / ${rows.length} 件`);

      for (const row of rows) {
        if (!row || !row.url) continue;
        if (seen.has(row.url)) continue;

        seen.add(row.url);
        foundAll.push({
          ...row,
          sourceLabel: item.label,
          pageNo: page + 1
        });
      }
    }

    return foundAll;
  }

  function reportDuplicateNames(foundRows, context) {
    const map = {};

    for (const row of foundRows || []) {
      const name = cleanTournamentName(row.actualName || "");
      const id = String(row.tournamentId || "").trim();
      if (!name || !id) continue;

      if (!map[name]) map[name] = new Set();
      map[name].add(id);
    }

    Object.keys(map).forEach((name) => {
      const ids = Array.from(map[name]);
      if (ids.length <= 1) return;
      appendReport("DUPLICATE_NAME", `${context}: ${name} / IDs=${ids.join(",")}`);
    });
  }

  function extractTournamentIdFromUrl(url) {
    const m = String(url || "").match(/\/cb\/torneio\/painel\/(\d+)/);
    return m ? m[1] : "";
  }

  function makeAuditIssue(level, type, key, item, message) {
    return {
      level,
      type,
      key,
      name: item && item.name || "",
      tournamentId: item && item.tournamentId || "",
      url: item && item.url || "",
      actualName: item && item.actualName || "",
      message
    };
  }

  function auditCache(prefix) {
    const p = norm(prefix || "");
    const cache = loadCache();
    const issues = [];
    const nameToIds = {};
    const idToNames = {};
    let checked = 0;

    Object.keys(cache).forEach((key) => {
      const item = cache[key] || {};
      const name = cleanTournamentName(item.name || "");
      const actualName = cleanTournamentName(item.actualName || "");
      const id = String(item.tournamentId || "").trim();
      const url = String(item.url || "").trim();

      if (p && !String(name).includes(p) && !String(actualName).includes(p)) {
        return;
      }

      checked++;

      if (!name) {
        issues.push(makeAuditIssue("ERROR", "MISSING_NAME", key, item, "Name が空です"));
      }

      if (!id) {
        issues.push(makeAuditIssue("ERROR", "MISSING_ID", key, item, "TournamentId が空です"));
      }

      if (!url) {
        issues.push(makeAuditIssue("ERROR", "MISSING_URL", key, item, "URL が空です"));
      }

      const urlId = extractTournamentIdFromUrl(url);

      if (url && !urlId) {
        issues.push(makeAuditIssue("ERROR", "BAD_URL", key, item, "URL から TournamentId を取得できません"));
      }

      if (id && urlId && id !== urlId) {
        issues.push(makeAuditIssue("ERROR", "ID_MISMATCH", key, item, `TournamentId=${id} / URL_ID=${urlId}`));
      }

      if (name && actualName && !isSameTournamentLooseSafe(name, actualName)) {
        issues.push(makeAuditIssue("ERROR", "NAME_ACTUAL_MISMATCH", key, item, "Name と Actual_Name が安全一致しません"));
      }

      if (name && id) {
        if (!nameToIds[name]) nameToIds[name] = new Set();
        nameToIds[name].add(id);
      }

      if (id && name) {
        if (!idToNames[id]) idToNames[id] = new Set();
        idToNames[id].add(name);
      }
    });

    Object.keys(nameToIds).forEach((name) => {
      const ids = Array.from(nameToIds[name]);
      if (ids.length <= 1) return;

      issues.push({
        level: "WARN",
        type: "DUPLICATE_NAME",
        key: "",
        name,
        tournamentId: ids.join(","),
        url: "",
        actualName: "",
        message: "同じ Name に複数 TournamentId があります。v0.6では保持します。"
      });
    });

    Object.keys(idToNames).forEach((id) => {
      const names = Array.from(idToNames[id]);
      if (names.length <= 1) return;

      issues.push({
        level: "WARN",
        type: "DUPLICATE_ID",
        key: "",
        name: names.join(" | "),
        tournamentId: id,
        url: `/cb/torneio/painel/${id}`,
        actualName: "",
        message: "同じ TournamentId に複数 Name があります。表記ゆれならOKです。"
      });
    });

    return {
      prefix: p,
      checked,
      errors: issues.filter((x) => x.level === "ERROR"),
      warnings: issues.filter((x) => x.level === "WARN"),
      issues
    };
  }

  function auditResultToTsv(result) {
    const headers = ["Level", "Type", "Name", "TournamentId", "URL", "Actual_Name", "Message"];
    const rows = (result.issues || []).map((x) => ({
      Level: x.level,
      Type: x.type,
      Name: x.name,
      TournamentId: x.tournamentId,
      URL: x.url,
      Actual_Name: x.actualName,
      Message: x.message
    }));

    return rowsToTsv(rows, headers);
  }

  function showAuditResult(result, quiet) {
    const output = document.querySelector("#pw-url-cache-output");
    const summary =
      `Audit: checked ${result.checked} / ERROR ${result.errors.length} / WARN ${result.warnings.length}`;

    if (output) {
      output.value = auditResultToTsv(result);
    }

    setStatus(summary);

    const signature = `${result.prefix}|${result.checked}|${result.errors.length}|${result.warnings.length}`;

    if (!quiet || signature !== lastAuditSignature) {
      appendReport("AUDIT", summary);

      result.errors.slice(0, 30).forEach((x) => {
        appendReport(x.type, `${x.name} / ${x.tournamentId} / ${x.url} / ${x.message}`);
      });

      if (result.errors.length > 30) {
        appendReport("AUDIT_MORE", `ERROR が他に ${result.errors.length - 30} 件あります`);
      }
    }

    lastAuditSignature = signature;
  }

  function auditCurrentEventCache(quiet) {
    const prefix = getEventPrefixInput();

    if (!prefix && !quiet) {
      alert("Event Prefix を入力してください。例：【JOPT 2026 Grand Final】");
      return null;
    }

    const result = auditCache(prefix);
    showAuditResult(result, quiet);
    return result;
  }

  function deleteAuditErrorItems(result) {
    const cache = loadCache();
    let deleted = 0;
    const keys = new Set((result.errors || []).map((x) => x.key).filter(Boolean));

    keys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(cache, key)) {
        delete cache[key];
        deleted++;
      }
    });

    saveCache(cache);
    return deleted;
  }

  async function repairCurrentEventCache() {
    if (running) {
      alert("処理中です");
      return;
    }

    const prefix = getEventPrefixInput();

    if (!prefix) {
      alert("Event Prefix を入力してください。例：【JOPT 2026 Grand Final】");
      return;
    }

    const result = auditCache(prefix);
    showAuditResult(result, false);

    if (!result.errors.length) {
      alert(
        `疑似汚染は見つかりませんでした。\n\n` +
        `CHECK: ${result.checked}\n` +
        `WARN: ${result.warnings.length}`
      );
      return;
    }

    const ok = confirm(
      `疑似汚染を削除して、Event Prefix で再スキャンします。\n\n` +
      `Prefix: ${prefix}\n` +
      `CHECK: ${result.checked}\n` +
      `ERROR削除対象: ${result.errors.length}\n` +
      `WARN: ${result.warnings.length}\n\n` +
      `続行しますか？`
    );

    if (!ok) return;

    const deleted = deleteAuditErrorItems(result);
    appendReport("REPAIR_DELETE", `${prefix}: ${deleted} 件削除`);
    showCache(prefix);

    await buildCacheByEventPrefix({ skipConfirm: true });
  }

  function startPeriodicAudit() {
    if (auditTimer) {
      clearInterval(auditTimer);
      auditTimer = null;
    }

    auditTimer = setInterval(() => {
      if (running) return;
      const prefix = getEventPrefixInput();
      if (!prefix) return;

      const result = auditCache(prefix);

      if (result.errors.length > 0) {
        showAuditResult(result, true);
      }
    }, CONFIG.auditIntervalMs);
  }

  async function openTournamentListWindow(page) {
    const win = window.open(
      page.path,
      `pw_url_cache_${page.label}_${Date.now()}`,
      "width=1280,height=900"
    );

    if (!win) {
      throw new Error(`${page.label}: popup blocked`);
    }

    await waitForWindowLoad(win, 25000);

    await waitForInWindow(
      win,
      (w) => findDataTablesSearchInputInWindow(w) || getRowsForRead(w, false).length > 0,
      18000,
      300
    );

    await sleep(900);

    return win;
  }

  async function openListWindows() {
    const wins = [];

    for (const page of CONFIG.listPages) {
      setStatus(`${page.label} 大会一覧を開いています...`);
      const win = await openTournamentListWindow(page);
      wins.push({ ...page, win });
    }

    return wins;
  }

  function closeListWindows(wins) {
    for (const item of wins || []) {
      try {
        if (item.win && !item.win.closed) item.win.close();
      } catch (_) {}
    }
  }

  async function searchNameInWindow(item, name) {
    const win = item.win;
    const dt = getPrimaryDataTable(win);

    if (dt) {
      let lastFound = null;

      for (let attempt = 1; attempt <= CONFIG.nameSearchRetry; attempt++) {
        if (stopRequested) break;

        if (attempt > 1) {
          appendReport("SEARCH_RETRY", `${item.label}: ${name} / ${attempt}/${CONFIG.nameSearchRetry}`);
        }

        await runDataTableActionAndWait(win, dt, () => {
          dt.search(name);
          dt.page.len(CONFIG.pageLength);
          dt.page(0);
          dt.draw();
        }, `name-search:${item.label}:${attempt}`);

        const rows = await readRowsForReadStable(win, true);
        const found = findTournamentFromRows(rows, name);

        if (found) {
          lastFound = found;
          break;
        }

        await sleep(CONFIG.betweenSearchMs);
      }

      return lastFound;
    }

    const input = findDataTablesSearchInputInWindow(win);

    if (!input) {
      throw new Error(`${item.label}: search input not found`);
    }

    let found = null;

    for (let attempt = 1; attempt <= CONFIG.nameSearchRetry; attempt++) {
      dispatchSearchInputInWindow(win, input, name);
      await waitSearchStable(win);

      found = findTournamentFromRows(await readRowsForReadStable(win, true), name);
      if (found) break;

      dispatchSearchInputInWindow(win, input, "");
      await sleep(CONFIG.betweenSearchMs);
    }

    dispatchSearchInputInWindow(win, input, "");
    await sleep(CONFIG.betweenSearchMs);

    return found;
  }

  async function buildCacheByNames() {
    if (running) {
      alert("処理中です");
      return;
    }

    const raw = document.querySelector("#pw-url-cache-input")?.value || "";
    const parsed = parseInput(raw);
    const names = parsed.rows.map((r) => norm(r.name || "")).filter(Boolean);

    if (!names.length) {
      alert("大会名リストを貼ってください。");
      return;
    }

    const ok = confirm(
      `大会名リストから URL Cache を作成します。\n\n` +
      `対象: ${names.length} 件\n` +
      `検索: OPEN / CLOSED 両方\n\n` +
      `続行しますか？`
    );

    if (!ok) return;

    running = true;
    stopRequested = false;
    localStorage.setItem(CONFIG.inputKey, raw);

    let wins = [];
    let okCount = 0;
    let ngCount = 0;
    let ambiguousCount = 0;

    try {
      wins = await openListWindows();

      for (let i = 0; i < names.length; i++) {
        if (stopRequested) {
          appendReport("STOP", "停止要求により中断");
          break;
        }

        const name = names[i];
        setStatus(`大会名検索 ${i + 1}/${names.length}: ${name}`);
        appendReport("SEARCH", `${i + 1}/${names.length} ${name}`);

        let found = null;
        let source = "";

        for (const item of wins) {
          try {
            found = await searchNameInWindow(item, name);
            source = item.label;
          } catch (e) {
            appendReport("SEARCH_ERROR", `${item.label}: ${name} / ${e.message || String(e)}`);
          }

          if (found) break;
        }

        if (!found) {
          ngCount++;
          appendReport("NOT_FOUND", name);
          continue;
        }

        if (found.error === "AMBIGUOUS") {
          ambiguousCount++;
          appendReport("AMBIGUOUS", `${name} / ${found.candidates.length} candidates`);
          console.table(found.candidates);
          continue;
        }

        setCacheItem(name, {
          tournamentId: found.tournamentId,
          url: found.url,
          actualName: found.actualName || name,
          matchedRow: found.matchedRow || "",
          source: `search-v0.6-${source}`
        });

        okCount++;
        appendReport("SEARCH_OK", `${name} → ${found.url} (${source})`);
      }

      showCache();

      alert(
        `大会名検索 完了\n\n` +
        `OK: ${okCount}\n` +
        `NOT_FOUND: ${ngCount}\n` +
        `AMBIGUOUS: ${ambiguousCount}`
      );

    } catch (e) {
      console.error(e);
      alert("ERROR: " + (e.message || String(e)));
      appendReport("ERROR", e.message || String(e));
    } finally {
      closeListWindows(wins);
      running = false;
      stopRequested = false;
    }
  }

  function findExactCacheCandidates(name) {
    const target = compact(cleanTournamentName(name));
    if (!target) return [];

    const seen = new Set();
    return Object.values(loadCache())
      .filter((item) => {
        const names = [item?.name, item?.actualName]
          .map((value) => compact(cleanTournamentName(value)))
          .filter(Boolean);
        return names.includes(target);
      })
      .map((item) => ({
        tournamentId: String(item.tournamentId || "").trim(),
        url: String(item.url || "").trim(),
        actualName: cleanTournamentName(item.actualName || item.name || name),
        matchedRow: String(item.matchedRow || ""),
        source: String(item.source || "shared-cache")
      }))
      .filter((item) => {
        const id = item.tournamentId || String(item.url).match(/\/cb\/torneio\/painel\/(\d+)/)?.[1] || "";
        if (!id || seen.has(id)) return false;
        seen.add(id);
        item.tournamentId = id;
        item.url = item.url || `/cb/torneio/painel/${id}`;
        return true;
      });
  }

  async function resolveTournamentNames(inputNames) {
    if (running) throw new Error("URL Manager is already running");

    const names = Array.from(new Set((inputNames || []).map(norm).filter(Boolean)));
    if (!names.length) return { results: [], ok: 0, notFound: 0, ambiguous: 0 };

    const resultMap = new Map();
    const unresolved = [];

    for (const name of names) {
      const cached = findExactCacheCandidates(name);
      if (cached.length === 1) {
        resultMap.set(name, { name, status: "OK", ...cached[0], source: `cache:${cached[0].source}` });
      } else if (cached.length > 1) {
        resultMap.set(name, { name, status: "AMBIGUOUS", candidates: cached, source: "shared-cache" });
      } else {
        unresolved.push(name);
      }
    }

    let wins = [];
    running = true;
    stopRequested = false;
    try {
      if (unresolved.length) wins = await openListWindows();

      for (let i = 0; i < unresolved.length; i++) {
        if (stopRequested) break;
        const name = unresolved[i];
        setStatus(`API大会名検索 ${i + 1}/${unresolved.length}: ${name}`);
        appendReport("API_SEARCH", `${i + 1}/${unresolved.length} ${name}`);

        const candidates = [];
        for (const item of wins) {
          try {
            const found = await searchNameInWindow(item, name);
            if (!found) continue;
            const items = found.error === "AMBIGUOUS" ? found.candidates : [found];
            for (const candidate of items) candidates.push({ ...candidate, source: item.label });
          } catch (e) {
            appendReport("API_SEARCH_ERROR", `${item.label}: ${name} / ${e.message || String(e)}`);
          }
        }

        const seen = new Set();
        const unique = candidates.filter((candidate) => {
          const id = String(candidate.tournamentId || "");
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
        });

        if (unique.length === 1) {
          const found = unique[0];
          setCacheItem(name, {
            tournamentId: found.tournamentId,
            url: found.url,
            actualName: found.actualName || name,
            matchedRow: found.matchedRow || "",
            source: `url-manager-api-${found.source}`
          });
          resultMap.set(name, { name, status: "OK", ...found });
          appendReport("API_SEARCH_OK", `${name} → ${found.url} (${found.source})`);
        } else if (unique.length > 1) {
          resultMap.set(name, { name, status: "AMBIGUOUS", candidates: unique, source: "search" });
          appendReport("API_AMBIGUOUS", `${name} / ${unique.length} candidates`);
        } else {
          resultMap.set(name, { name, status: "NOT_FOUND", source: "search" });
          appendReport("API_NOT_FOUND", name);
        }
      }
    } finally {
      closeListWindows(wins);
      running = false;
      stopRequested = false;
    }

    const results = names.map((name) => resultMap.get(name) || { name, status: "STOPPED" });
    return {
      results,
      ok: results.filter((item) => item.status === "OK").length,
      notFound: results.filter((item) => item.status === "NOT_FOUND").length,
      ambiguous: results.filter((item) => item.status === "AMBIGUOUS").length,
      stopped: results.filter((item) => item.status === "STOPPED").length
    };
  }

  async function handleResolveBridgeRequest() {
    let request = null;
    try {
      request = JSON.parse(localStorage.getItem(RESOLVE_REQUEST_KEY) || "null");
      if (!request?.requestId || !Array.isArray(request.names)) return;

      const result = await resolveTournamentNames(request.names);
      localStorage.setItem(RESOLVE_RESPONSE_KEY, JSON.stringify({
        requestId: request.requestId,
        ok: true,
        result,
        finishedAt: Date.now()
      }));
    } catch (e) {
      localStorage.setItem(RESOLVE_RESPONSE_KEY, JSON.stringify({
        requestId: request?.requestId || "",
        ok: false,
        error: e.message || String(e),
        finishedAt: Date.now()
      }));
    } finally {
      document.dispatchEvent(new Event("PW_URL_MANAGER_RESOLVE_RESPONSE"));
    }
  }

  async function buildCacheByEventPrefix(options = {}) {
    if (running) {
      alert("処理中です");
      return;
    }

    const prefix = getEventPrefixInput() || norm((document.querySelector("#pw-url-cache-input")?.value || "").split(/\r?\n/)[0]);

    if (!prefix) {
      alert("Event Prefix を入力してください。例：【JOPT 2026 Grand Final】");
      return;
    }

    if (!options.skipConfirm) {
      const ok = confirm(
        `Event Prefix から大会URLを一括収集します。\n\n` +
        `Prefix: ${prefix}\n` +
        `対象: OPEN / CLOSED 両方\n\n` +
        `続行しますか？`
      );

      if (!ok) return;
    }

    running = true;
    stopRequested = false;
    localStorage.setItem(CONFIG.prefixKey, prefix);

    let wins = [];
    let foundAll = [];

    try {
      wins = await openListWindows();

      for (const item of wins) {
        if (stopRequested) break;

        const rounds = Math.max(1, Number(CONFIG.eventScanRounds || 1));

        for (let round = 1; round <= rounds; round++) {
          if (stopRequested) break;

          setStatus(`${item.label}: Event Prefix 全ページ検索中 ${prefix} / round ${round}/${rounds}`);
          appendReport("EVENT_SEARCH", `${item.label}: ${prefix} / round ${round}/${rounds}`);

          const rows = await collectEventPrefixRowsAllPages(item, prefix);

          appendReport("EVENT_FOUND", `${item.label}: round ${round}/${rounds} / ${rows.length} 件`);

          for (const row of rows) {
            foundAll.push({
              ...row,
              scanRound: round
            });
          }
        }
      }

      const seen = new Set();
      foundAll = foundAll.filter((x) => {
        if (seen.has(x.url)) return false;
        seen.add(x.url);
        return true;
      });

      reportDuplicateNames(foundAll, prefix);

      let okCount = 0;
      let ngCount = 0;

      for (const found of foundAll) {
        const name = cleanTournamentName(found.actualName);

        if (!name || !found.tournamentId || !found.url) {
          ngCount++;
          appendReport("EVENT_NG", found.matchedRow || JSON.stringify(found));
          continue;
        }

        const okSet = setCacheItem(name, {
          tournamentId: found.tournamentId,
          url: found.url,
          actualName: name,
          matchedRow: found.matchedRow || "",
          source: `event-v0.6-${found.sourceLabel}-r${found.scanRound || 1}-p${found.pageNo || ""}`
        });

        if (okSet) {
          okCount++;
          appendReport("EVENT_OK", `${name} → ${found.url}`);
        } else {
          ngCount++;
          appendReport("EVENT_NG", `${name} → ${found.url}`);
        }
      }

      showCache(prefix);

      alert(
        `Event Cache 作成完了\n\n` +
        `Prefix: ${prefix}\n` +
        `OK: ${okCount}\n` +
        `NG: ${ngCount}`
      );

    } catch (e) {
      console.error(e);
      alert("ERROR: " + (e.message || String(e)));
      appendReport("ERROR", e.message || String(e));
    } finally {
      closeListWindows(wins);
      running = false;
      stopRequested = false;
    }
  }

  function stopRun() {
    stopRequested = true;
    appendReport("STOP_REQUEST", "現在の1件が終わったら停止");
    setStatus("停止要求を出しました");
  }

  function addPanel() {
    if (document.querySelector("#pw-url-cache-panel")) return;

    const savedInput = localStorage.getItem(CONFIG.inputKey) || [
      "Name",
      "【JOPT 2026 Grand Final】#41 NLH Turbo"
    ].join("\n");

    const savedPrefix = localStorage.getItem(CONFIG.prefixKey) || "【JOPT 2026 Grand Final】";
    const savedReport = localStorage.getItem(CONFIG.reportKey) || "";

    const panel = document.createElement("div");
    panel.id = "pw-url-cache-panel";

    panel.style.cssText = `
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 999999;
      background: #222;
      color: #fff;
      padding: 12px;
      border-radius: 8px;
      box-shadow: 0 2px 12px rgba(0,0,0,.35);
      font-size: 13px;
      font-family: Arial, sans-serif;
      width: 680px;
      max-height: 94vh;
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div style="font-weight:bold;">PW URL Cache Manager v0.7.0</div>
        <div style="display:flex;gap:4px;">
          <button id="pw-url-cache-minimize" style="font-size:11px;padding:2px 6px;cursor:pointer;">Min</button>
          <button id="pw-url-cache-close" style="font-size:11px;padding:2px 6px;cursor:pointer;">x</button>
        </div>
      </div>

      <div id="pw-url-cache-body">
        <div style="font-size:11px;color:#ccc;line-height:1.35;margin-bottom:6px;">
          共有Cache key: <code>${SHARED_CACHE_KEY}</code><br>
          Sheet用TSVは <code>Name / TournamentId / URL / Actual_Name</code> の4列だけ出力します。
        </div>

        <div style="font-size:12px;font-weight:bold;">Event Prefix</div>
        <input id="pw-url-cache-prefix"
          style="width:100%;background:#111;color:#fff;border:1px solid #555;padding:7px;font-family:Consolas,monospace;font-size:12px;" />

        <div style="font-size:12px;font-weight:bold;margin-top:6px;">Input: 大会名リスト or Name/TournamentId/URL TSV</div>
        <textarea id="pw-url-cache-input"
          style="width:100%;height:120px;background:#111;color:#fff;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

        <div style="display:flex;gap:6px;margin-top:6px;">
          <button id="pw-url-cache-build-event"
            style="flex:1;padding:7px;cursor:pointer;background:#ffe08a;border:1px solid #c99;">
            Build by Event Prefix
          </button>

          <button id="pw-url-cache-build-names"
            style="flex:1;padding:7px;cursor:pointer;background:#d9ecff;border:1px solid #88a;">
            Build by Names
          </button>

          <button id="pw-url-cache-import"
            style="flex:1;padding:7px;cursor:pointer;background:#bff0c2;border:1px solid #8a8;">
            Import TSV
          </button>
        </div>

        <div style="font-size:12px;font-weight:bold;margin-top:6px;">人工核查 / 同名比赛URL冲突</div>
        <div id="pw-url-cache-review"
          style="max-height:220px;overflow:auto;background:#181818;border:1px solid #555;padding:6px;font-size:12px;"></div>

        <div style="display:flex;gap:6px;margin-top:6px;">
          <button id="pw-url-cache-view-current"
            style="flex:1;padding:7px;cursor:pointer;background:#eee;border:1px solid #aaa;">
            View Current Event
          </button>

          <button id="pw-url-cache-copy-sheet-current"
            style="flex:1;padding:7px;cursor:pointer;background:#eee;border:1px solid #aaa;">
            Copy Sheet TSV Current
          </button>

          <button id="pw-url-cache-copy-sheet-all"
            style="flex:1;padding:7px;cursor:pointer;background:#eee;border:1px solid #aaa;">
            Copy Sheet TSV All
          </button>
        </div>

        <div style="display:flex;gap:6px;margin-top:6px;">
          <button id="pw-url-cache-audit"
            style="flex:1;padding:7px;cursor:pointer;background:#fff0b3;border:1px solid #cc9;">
            Audit Current Event
          </button>

          <button id="pw-url-cache-repair"
            style="flex:1;padding:7px;cursor:pointer;background:#ffd6d6;border:1px solid #c88;">
            Repair Current Event Cache
          </button>
        </div>

        <div style="display:flex;gap:6px;margin-top:6px;">
          <button id="pw-url-cache-view-all"
            style="flex:1;padding:7px;cursor:pointer;background:#eee;border:1px solid #aaa;">
            View All
          </button>

          <button id="pw-url-cache-copy-full"
            style="flex:1;padding:7px;cursor:pointer;background:#eee;border:1px solid #aaa;">
            Copy Full Cache
          </button>

          <button id="pw-url-cache-stop"
            style="flex:1;padding:7px;cursor:pointer;background:#f3cccc;border:1px solid #c88;">
            Stop
          </button>
        </div>

        <div style="display:flex;gap:6px;margin-top:6px;">
          <button id="pw-url-cache-clear-event"
            style="flex:1;padding:7px;cursor:pointer;background:#f6d365;border:1px solid #caa;">
            Clear Current Event Cache
          </button>

          <button id="pw-url-cache-clear-all"
            style="flex:1;padding:7px;cursor:pointer;background:#f3cccc;border:1px solid #c88;">
            Clear All Cache
          </button>
        </div>

        <div style="font-size:12px;font-weight:bold;margin-top:6px;">Cache TSV / Output</div>
        <textarea id="pw-url-cache-output"
          readonly
          style="width:100%;height:120px;background:#111;color:#fff;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

        <div style="font-size:12px;font-weight:bold;margin-top:6px;">Report</div>
        <textarea id="pw-url-cache-report"
          readonly
          style="width:100%;height:105px;background:#111;color:#9fe;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

        <div style="display:flex;gap:6px;margin-top:6px;">
          <button id="pw-url-cache-copy-report"
            style="flex:1;padding:6px;cursor:pointer;background:#eee;border:1px solid #aaa;">
            Copy Report
          </button>

          <button id="pw-url-cache-clear-report"
            style="flex:1;padding:6px;cursor:pointer;background:#eee;border:1px solid #aaa;">
            Clear Report
          </button>
        </div>

        <div id="pw-url-cache-status"
          style="font-size:11px;color:#9fe;line-height:1.35;white-space:pre-wrap;margin-top:6px;">
          ready
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    document.querySelector("#pw-url-cache-input").value = savedInput;
    document.querySelector("#pw-url-cache-prefix").value = savedPrefix;
    document.querySelector("#pw-url-cache-report").value = savedReport;

    document.querySelector("#pw-url-cache-build-event").onclick = () => buildCacheByEventPrefix();
    document.querySelector("#pw-url-cache-build-names").onclick = () => buildCacheByNames();
    document.querySelector("#pw-url-cache-import").onclick = () => importCacheFromTsv();

    document.querySelector("#pw-url-cache-view-current").onclick = () => {
      localStorage.setItem(CONFIG.prefixKey, getEventPrefixInput());
      showCache(getEventPrefixInput());
    };

    document.querySelector("#pw-url-cache-view-all").onclick = () => showCache("");

    document.querySelector("#pw-url-cache-audit").onclick = () => auditCurrentEventCache(false);

    document.querySelector("#pw-url-cache-repair").onclick = () => repairCurrentEventCache();

    document.querySelector("#pw-url-cache-copy-sheet-current").onclick = () => {
      const prefix = getEventPrefixInput();
      const tsv = cacheToSheetTsv(prefix);
      copyText(tsv);
      alert(`Sheet TSV copied: ${cacheToRows(prefix).length} 件`);
    };

    document.querySelector("#pw-url-cache-copy-sheet-all").onclick = () => {
      const tsv = cacheToSheetTsv("");
      copyText(tsv);
      alert(`Sheet TSV copied: ${cacheToRows("").length} 件`);
    };

    document.querySelector("#pw-url-cache-copy-full").onclick = () => {
      const tsv = cacheToFullTsv("");
      copyText(tsv);
      alert(`Full Cache TSV copied: ${getCacheCount()} 件`);
    };

    document.querySelector("#pw-url-cache-stop").onclick = () => stopRun();

    document.querySelector("#pw-url-cache-clear-event").onclick = () => {
      localStorage.setItem(CONFIG.prefixKey, getEventPrefixInput());
      clearCurrentEventCache();
    };

    document.querySelector("#pw-url-cache-clear-all").onclick = () => clearAllCache();

    document.querySelector("#pw-url-cache-copy-report").onclick = () => {
      copyText(document.querySelector("#pw-url-cache-report")?.value || "");
      alert("Report copied");
    };

    document.querySelector("#pw-url-cache-clear-report").onclick = () => clearReport();

    document.querySelector("#pw-url-cache-minimize").onclick = () => {
      const body = document.querySelector("#pw-url-cache-body");
      const btn = document.querySelector("#pw-url-cache-minimize");
      if (!body || !btn) return;

      const hidden = body.style.display === "none";
      body.style.display = hidden ? "block" : "none";
      btn.textContent = hidden ? "Min" : "Open";
    };

    document.querySelector("#pw-url-cache-close").onclick = () => {
      const p = document.querySelector("#pw-url-cache-panel");
      if (p) p.style.display = "none";
    };

    showCache(getEventPrefixInput());
    renderManualReview();
  }

  function boot() {
    addPanel();
    document.documentElement.dataset.pwUrlManagerVersion = "0.7.0";
    document.addEventListener("PW_URL_MANAGER_RESOLVE_REQUEST", handleResolveBridgeRequest);

    const publicApi = {
      SHARED_CACHE_KEY,
      loadCache,
      saveCache,
      setCacheItem,
      cacheToSheetTsv,
      cacheToFullTsv,
      showCache,
      resolveTournamentNames,
      buildCacheByNames,
      buildCacheByEventPrefix,
      importCacheFromTsv,
      auditCache,
      auditCurrentEventCache,
      repairCurrentEventCache,
      renderManualReview,
      replaceCacheForName,
      clearCurrentEventCache,
      clearAllCache
    };

    window.PWUrlCacheManagerV06 = publicApi;
    try {
      if (typeof unsafeWindow !== "undefined") unsafeWindow.PWUrlCacheManagerV06 = publicApi;
    } catch (_) {}

    window.PWUrlCacheManagerV05 = window.PWUrlCacheManagerV06;

    setStatus(`ready / Cache count: ${getCacheCount()}`);
    startPeriodicAudit();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
