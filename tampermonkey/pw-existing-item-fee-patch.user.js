// ==UserScript==
// @name         PW Existing Tournament Patch
// @namespace    pw-existing-item-fee-patch
// @version      0.2.5
// @description  Patch existing tournament item fees, EN/RE chips, and/or tournament names from TSV. Uses pasted URL/TournamentId, Shared Cache, then OPEN/CLOSED URL pool.
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-existing-item-fee-patch.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-existing-item-fee-patch.user.js
// @author       xhpc007 + ChatGPT
// @match        https://japanopt.pokerweb.com.br/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    sharedUrlCacheKey: "PW_SHARED_TOURNAMENT_URL_CACHE_V1",
    inputKey: "PW_EXISTING_ITEM_FEE_PATCH_INPUT_V01",
    candidateKey: "PW_EXISTING_ITEM_FEE_PATCH_CANDIDATES_V01",
    reportKey: "PW_EXISTING_ITEM_FEE_PATCH_REPORT_V01",
    searchWaitTimeoutMs: 10000,
    betweenTournamentsMs: 120,
    afterItemMs: 50
  };

  const DEFAULT_INPUT = `大会名\tURL\t新大会名\tEN手数料\tENチップ数\tREチップ数
【Test】NLH Main Event / Day 1A\t\t\t0\t\t`;

  const PATCH_FIELDS = [
    { header: "EN手数料", key: "EN", property: "taxa", valueLabel: "taxa", nome: "Entry", siglas: "En", label: "Entry/En" },
    { header: "RE手数料", key: "RE", property: "taxa", valueLabel: "taxa", nome: "Re Entry", siglas: "Re", label: "Re Entry/Re" },
    { header: "TE手数料", key: "TE", property: "taxa", valueLabel: "taxa", nome: "Ticket Entry", siglas: "TE", label: "Ticket/TE" },
    { header: "ENチップ数", key: "EN", property: "fichas", valueLabel: "chips", nome: "Entry", siglas: "En", label: "Entry/En" },
    { header: "REチップ数", key: "RE", property: "fichas", valueLabel: "chips", nome: "Re Entry", siglas: "Re", label: "Re Entry/Re" }
  ];

  const CANDIDATE_HEADERS = [
    "本次处理",
    "大会名",
    "新大会名",
    "Patch",
    "TournamentId",
    "URL",
    "判定",
    "理由"
  ];

  let running = false;
  let stopRequested = false;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const $ = sel => document.querySelector(sel);

  function norm(value) {
    return String(value ?? "")
      .replace(/\u3000/g, " ")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t\r\n]+/g, " ")
      .trim();
  }

  function cleanTournamentName(name) {
    return String(name || "")
      .replace(/\s*-\s*PokerWeb\s*$/i, "")
      .replace(/\s*監査(?:済み|待ち)\s*$/g, "")
      .trim();
  }

  function compact(value) {
    return norm(value)
      .replace(/[\/／]/g, "")
      .replace(/\s+/g, "")
      .replace(/監査(?:済み|待ち)/g, "")
      .toLowerCase();
  }

  function isSameTournamentExactSafe(a, b) {
    const ca = compact(cleanTournamentName(a));
    const cb = compact(cleanTournamentName(b));
    return ca && cb && ca === cb;
  }

  function normalizeAmount(value) {
    const s = norm(value);
    if (!s) return "";
    return s.replace(/[￥¥,\s]/g, "");
  }

  function getEventPrefixFromTournamentName(name) {
    const m = norm(name).match(/【[^】]+】/);
    return m ? m[0] : "";
  }

  function uniqueArray(values) {
    return [...new Set((values || []).filter(Boolean))];
  }

  function amountDisplay(value) {
    const s = norm(value);
    return s || "0";
  }

  function nowText() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function logLine(line) {
    const box = $("#pw-fee-patch-report");
    if (!box) return;
    box.value += `${line}\n`;
    box.scrollTop = box.scrollHeight;
    localStorage.setItem(CONFIG.reportKey, box.value);
    console.log("[PW-FEE-PATCH]", line);
  }

  function clearReport() {
    const box = $("#pw-fee-patch-report");
    if (box) box.value = "";
    localStorage.removeItem(CONFIG.reportKey);
  }

  function setStatus(text) {
    const el = $("#pw-fee-patch-status");
    if (el) el.textContent = text;
  }

  function escTsv(value) {
    if (Array.isArray(value)) value = value.join(" | ");
    if (value && typeof value === "object") value = JSON.stringify(value);
    return String(value ?? "").replace(/\r?\n/g, " ").replace(/\t/g, " ").trim();
  }

  function toTsv(rows, headers) {
    return [
      headers.join("\t"),
      ...rows.map(row => headers.map(h => escTsv(row[h])).join("\t"))
    ].join("\n");
  }

  function parseTsv(text) {
    const lines = String(text || "")
      .split(/\r?\n/)
      .map(line => line.replace(/\uFEFF/g, ""))
      .filter(line => norm(line));

    if (!lines.length) return [];

    const headers = lines[0].split("\t").map(norm);
    return lines.slice(1).map((line, index) => {
      const cols = line.split("\t");
      const row = { __rowNo: index + 2 };
      headers.forEach((h, i) => {
        row[h] = norm(cols[i] || "");
      });
      return row;
    });
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

  function getTournamentUrl(id) {
    return `${location.origin}/cb/torneio/painel/${id}`;
  }

  function extractTournamentIdFromUrl(url) {
    const m = String(url || "").match(/\/cb\/torneio\/painel\/(\d+)/);
    return m ? m[1] : "";
  }

  function normalizeCacheUrl(id, url) {
    const urlId = extractTournamentIdFromUrl(url);
    return getTournamentUrl(id || urlId);
  }

  function loadSharedCache() {
    try {
      const raw = localStorage.getItem(CONFIG.sharedUrlCacheKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      console.warn("[PW-FEE-PATCH] shared cache parse failed", e);
      return {};
    }
  }

  function saveSharedCache(cache) {
    localStorage.setItem(CONFIG.sharedUrlCacheKey, JSON.stringify(cache));
  }

  function setSharedCacheItem(name, data) {
    const cleanName = cleanTournamentName(name);
    const id = String(data.tournamentId || extractTournamentIdFromUrl(data.url || "") || "").trim();
    if (!cleanName || !id) return;

    const cache = loadSharedCache();
    const key = `${cleanName}||${id}`;
    cache[key] = {
      name: cleanName,
      tournamentId: id,
      url: normalizeCacheUrl(id, data.url || ""),
      actualName: cleanTournamentName(data.actualName || data.name || cleanName),
      matchedRow: String(data.matchedRow || ""),
      savedAt: nowText(),
      source: String(data.source || "fee-patch-open")
    };
    saveSharedCache(cache);
  }

  function validateUrlCacheItem(item) {
    const name = cleanTournamentName(item.name || item.Name || "");
    const actualName = cleanTournamentName(item.actualName || item.Actual_Name || item.name || item.Name || "");
    const id = norm(item.tournamentId || item.TournamentId || "");
    const url = norm(item.url || item.URL || "");
    const urlId = extractTournamentIdFromUrl(url);

    if (!name) return { ok: false, reason: "CACHE_NAME_EMPTY" };
    if (!id && !urlId) return { ok: false, reason: "CACHE_ID_EMPTY" };
    if (id && urlId && id !== urlId) return { ok: false, reason: `CACHE_ID_MISMATCH id=${id} urlId=${urlId}` };

    if (actualName && !isSameTournamentExactSafe(name, actualName)) {
      return { ok: false, reason: "CACHE_NAME_ACTUAL_MISMATCH" };
    }

    const finalId = id || urlId;
    return {
      ok: true,
      name,
      actualName,
      tournamentId: finalId,
      url: normalizeCacheUrl(finalId, url),
      matchedRow: item.matchedRow || item.Matched_Row || "",
      source: item.source || item.Source || "shared-cache"
    };
  }

  function findSharedCacheByName(name) {
    const cleanName = cleanTournamentName(name);
    const matches = [];
    const badRows = [];

    for (const item of Object.values(loadSharedCache())) {
      const checked = validateUrlCacheItem(item);
      const itemName = cleanTournamentName(item.name || item.Name || "");
      const itemActual = cleanTournamentName(item.actualName || item.Actual_Name || "");

      if (!checked.ok) {
        if (isSameTournamentExactSafe(cleanName, itemName) || isSameTournamentExactSafe(cleanName, itemActual)) {
          badRows.push(checked.reason);
        }
        continue;
      }

      if (isSameTournamentExactSafe(cleanName, checked.name) || isSameTournamentExactSafe(cleanName, checked.actualName)) {
        matches.push(checked);
      }
    }

    const seen = new Set();
    const unique = matches.filter(item => {
      const key = item.tournamentId || item.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (unique.length === 1) return { status: "OK_CACHE", row: unique[0], reason: "" };
    if (unique.length > 1) return { status: "URL_AMBIGUOUS", row: null, reason: `${unique.length} cache rows matched: ${unique.map(x => x.tournamentId).join(",")}` };
    if (badRows.length) return { status: "URL_CACHE_BAD_ROW", row: null, reason: badRows.join(" / ") };
    return { status: "URL未解決", row: null, reason: "URL pool検索してください" };
  }

  function parsePatchInput(raw) {
    const rows = parseTsv(raw);
    const errors = [];
    const warnings = [];
    const tasks = [];

    if (!rows.length) {
      errors.push("入力が空です。大会名 + 新大会名、手数料、またはチップ数列のTSVを貼ってください。");
      return { tasks, errors, warnings };
    }

    const first = rows[0] || {};
    const headers = Object.keys(first).filter(h => h !== "__rowNo");
    if (!headers.includes("大会名")) errors.push("必須列がありません: 大会名");

    const activeFields = PATCH_FIELDS.filter(f => headers.includes(f.header));
    const hasNewNameField = headers.includes("新大会名");
    if (!activeFields.length && !hasNewNameField) {
      errors.push("修正列がありません: 新大会名 / EN手数料 / RE手数料 / TE手数料 / ENチップ数 / REチップ数 のどれかを入れてください。");
    }

    if (errors.length) return { tasks, errors, warnings };

    const noUrlNameRows = new Map();

    for (const row of rows) {
      const name = cleanTournamentName(row["大会名"]);
      const rowNo = row.__rowNo;

      if (!name) {
        warnings.push(`Row ${rowNo}: 大会名が空なのでSKIP`);
        continue;
      }

      const rawUrl = norm(row["URL"] || row["Url"] || row["url"] || "");
      const rawId = norm(row["TournamentId"] || row["TournamentID"] || row["tournamentId"] || row["id_torneio"] || "");
      const urlId = extractTournamentIdFromUrl(rawUrl);
      if (rawUrl && !urlId) {
        errors.push(`Row ${rowNo}: URLからTournamentIdを読めません: ${rawUrl}`);
        continue;
      }
      if (rawId && urlId && rawId !== urlId) {
        errors.push(`Row ${rowNo}: TournamentIdとURLのIDが一致しません: ${rawId} / ${urlId}`);
        continue;
      }

      const tournamentId = rawId || urlId;
      const url = tournamentId ? getTournamentUrl(tournamentId) : "";

      if (!tournamentId) {
        const duplicateKey = compact(name);
        const firstRowNo = noUrlNameRows.get(duplicateKey);
        if (firstRowNo) {
          errors.push(`Row ${rowNo}: URLなしの大会名が重複しています。Row ${firstRowNo} と同名です。重複するDay1/店舗別大会はURLまたはTournamentIdを入れてください: ${name}`);
          continue;
        }
        noUrlNameRows.set(duplicateKey, rowNo);
      }

      const patches = [];
      for (const field of activeFields) {
        const rawValue = row[field.header];
        if (rawValue === undefined || rawValue === "") continue;
        const targetValue = normalizeAmount(rawValue);
        if (targetValue === "") continue;
        const validValue = field.property === "fichas"
          ? /^\d+$/.test(targetValue)
          : /^-?\d+(?:\.\d+)?$/.test(targetValue);
        if (!validValue) {
          const expected = field.property === "fichas" ? "0以上の整数" : "数値";
          errors.push(`Row ${rowNo}: ${field.header} が${expected}ではありません: ${rawValue}`);
          continue;
        }

        patches.push({
          key: field.key,
          header: field.header,
          property: field.property,
          valueLabel: field.valueLabel,
          nome: field.nome,
          siglas: field.siglas,
          label: field.label,
          targetValue
        });
      }

      const newName = hasNewNameField ? cleanTournamentName(row["新大会名"]) : "";
      if (!patches.length && !newName) {
        warnings.push(`Row ${rowNo}: 修正値が空なのでSKIP: ${name}`);
        continue;
      }

      tasks.push({ rowNo, name, newName, patches, tournamentId, url });
    }

    if (!tasks.length && !errors.length) errors.push("実行対象がありません。");
    return { tasks, errors, warnings };
  }

  function buildPatchText(patches) {
    return patches.map(p => `${p.header}=${p.targetValue}`).join(" | ");
  }

  function parsePatchText(text) {
    const patchMap = new Map(PATCH_FIELDS.map(f => [f.header, f]));
    return String(text || "")
      .split("|")
      .map(part => norm(part))
      .filter(Boolean)
      .map(part => {
        const m = part.match(/^(.+?)=(.*)$/);
        if (!m) return null;
        const field = patchMap.get(norm(m[1]));
        if (!field) return null;
        return {
          key: field.key,
          header: field.header,
          property: field.property,
          valueLabel: field.valueLabel,
          nome: field.nome,
          siglas: field.siglas,
          label: field.label,
          targetValue: normalizeAmount(m[2])
        };
      })
      .filter(Boolean);
  }

  function buildCandidateRows(parsed) {
    return parsed.tasks.map(task => {
      if (task.tournamentId && task.url) {
        return {
          "本次处理": "使用",
          "大会名": task.name,
          "新大会名": task.newName,
          "Patch": buildPatchText(task.patches),
          "TournamentId": task.tournamentId,
          "URL": task.url,
          "判定": "OK_INPUT_URL",
          "理由": ""
        };
      }

      const cache = findSharedCacheByName(task.name);
      const row = cache.row || null;
      return {
        "本次处理": row ? "使用" : "不使用",
        "大会名": task.name,
        "新大会名": task.newName,
        "Patch": buildPatchText(task.patches),
        "TournamentId": row ? row.tournamentId : "",
        "URL": row ? row.url : "",
        "判定": cache.status,
        "理由": cache.reason
      };
    });
  }

  function setCandidateRows(rows) {
    const tsv = toTsv(rows, CANDIDATE_HEADERS);
    const box = $("#pw-fee-patch-candidates");
    if (box) box.value = tsv;
    localStorage.setItem(CONFIG.candidateKey, tsv);
    return tsv;
  }

  function getCandidateRows() {
    return parseTsv($("#pw-fee-patch-candidates")?.value || "");
  }

  function getUseCandidateRows() {
    return getCandidateRows().filter(row => {
      const use = norm(row["本次处理"]);
      return use === "使用" || use === "1" || use.toUpperCase() === "TRUE" || use.toUpperCase() === "Y" || use === "○" || use === "〇";
    });
  }

  function previewBuildCandidates() {
    const raw = $("#pw-fee-patch-input")?.value || "";
    localStorage.setItem(CONFIG.inputKey, raw);
    clearReport();

    const parsed = parsePatchInput(raw);
    logLine(`[${nowText()}] PREVIEW Fee Patch`);

    if (parsed.warnings.length) {
      logLine("");
      logLine("[WARN]");
      parsed.warnings.forEach(w => logLine(`- ${w}`));
    }

    if (parsed.errors.length) {
      logLine("");
      logLine("[ERROR]");
      parsed.errors.forEach(e => logLine(`- ${e}`));
      alert(`Preview NG: ERROR ${parsed.errors.length}件`);
      return;
    }

    const rows = buildCandidateRows(parsed);
    setCandidateRows(rows);

    logLine("");
    logLine(`対象大会: ${rows.length}`);
    logLine(`URL解決済み: ${rows.filter(r => r["TournamentId"] && r["URL"]).length}`);
    logLine(`URL未解決: ${rows.filter(r => !r["TournamentId"] || !r["URL"]).length}`);
    logLine("");
    rows.forEach((row, i) => {
      logLine(`${i + 1}. ${row["大会名"]}`);
      logLine(`   ${row["Patch"]}`);
      logLine(`   ${row["判定"]} ${row["URL"] || ""} ${row["理由"] || ""}`);
    });

    setStatus("Preview OK");
  }

  function isVisibleInWindow(win, el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = win.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function rowHasPanelLink(row) {
    return String(row.innerHTML || "").includes("/cb/torneio/painel/");
  }

  function extractTournamentTitleFromRow(rowText) {
    const s = norm(rowText);

    const m = s.match(/(【[^】]+】\s*(?:#\d+[A-Za-z]?|\(s\d+\)|s\d+)\s+.+?)(?:\s+\d{1,2}\/\d{1,2}\/\d{4}|\s+Aberto|\s+Fechado|\s+オープン|\s+クローズ|$)/i);
    if (m) return cleanTournamentName(m[1]);

    const m2 = s.match(/(【[^】]+】.+?)(?:\s+\d{1,2}\/\d{1,2}\/\d{4}|\s+Aberto|\s+Fechado|$)/i);
    if (m2) return cleanTournamentName(m2[1]);

    const m3 = s.match(/(【[^】]+】.+)/);
    if (m3) return cleanTournamentName(m3[1]);

    return cleanTournamentName(s);
  }

  function extractTournamentFromVisibleRow(row, inputName) {
    const rowText = norm(row.innerText || "");
    const actualName = extractTournamentTitleFromRow(rowText);
    if (!isSameTournamentExactSafe(inputName, actualName)) return null;

    const links = Array.from(row.querySelectorAll("a[href]"));
    const panelLink =
      links.find(a => String(a.getAttribute("href") || "").includes("/cb/torneio/painel/")) ||
      links.find(a => String(a.href || "").includes("/cb/torneio/painel/"));

    const href = panelLink ? (panelLink.getAttribute("href") || panelLink.href) : row.innerHTML;
    const m = String(href || "").match(/\/cb\/torneio\/painel\/(\d+)/);
    if (!m) return null;

    return {
      tournamentId: m[1],
      url: getTournamentUrl(m[1]),
      actualName,
      matchedRow: rowText
    };
  }

  function getDataTableInWindow(win) {
    try {
      if (!win || win.closed || !win.jQuery || !win.jQuery.fn || !win.jQuery.fn.dataTable) return null;

      const tables = Array.from(win.document.querySelectorAll("table"));
      for (const table of tables) {
        try {
          const $table = win.jQuery(table);
          if (!win.jQuery.fn.dataTable.isDataTable(table)) continue;
          const dt = $table.DataTable();
          if (dt) return dt;
        } catch (_) {}
      }

      const apiTables = win.jQuery.fn.dataTable.tables ? win.jQuery.fn.dataTable.tables() : [];
      if (apiTables && apiTables.length) return win.jQuery(apiTables[0]).DataTable();
      return null;
    } catch (_) {
      return null;
    }
  }

  function getDataTableTbodyRows(win, dt) {
    try {
      const node = dt.table().node();
      const tbody = node ? node.querySelector("tbody") : null;
      if (tbody) {
        return Array.from(tbody.querySelectorAll("tr"))
          .filter(row => isVisibleInWindow(win, row))
          .filter(rowHasPanelLink);
      }
    } catch (_) {}

    return Array.from(win.document.querySelectorAll("table tbody tr, tr"))
      .filter(row => isVisibleInWindow(win, row))
      .filter(rowHasPanelLink);
  }

  function isDataTableProcessing(win, dt) {
    try {
      const container = dt.table().container();
      const processing = container
        ? container.querySelector(".dataTables_processing")
        : win.document.querySelector(".dataTables_processing");
      return processing ? isVisibleInWindow(win, processing) : false;
    } catch (_) {
      const processing = win.document.querySelector(".dataTables_processing");
      return processing ? isVisibleInWindow(win, processing) : false;
    }
  }

  async function waitForProcessingGone(win, dt, timeoutMs = CONFIG.searchWaitTimeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!win || win.closed) throw new Error("WINDOW_CLOSED");
      if (!isDataTableProcessing(win, dt)) return true;
      await sleep(100);
    }
    return false;
  }

  async function waitForDataTableReadyInWindow(win, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!win || win.closed) throw new Error("WINDOW_CLOSED");
      const dt = getDataTableInWindow(win);
      if (dt) {
        await waitForProcessingGone(win, dt, timeoutMs);
        return dt;
      }
      await sleep(300);
    }
    return null;
  }

  function waitForNextDraw(win, dt, timeoutMs = CONFIG.searchWaitTimeoutMs) {
    return new Promise(resolve => {
      let done = false;
      let timer = null;
      const finish = value => {
        if (done) return;
        done = true;
        if (timer !== null) clearTimeout(timer);
        try {
          win.jQuery(dt.table().node()).off("draw.dt", onDraw);
        } catch (_) {}
        resolve(value);
      };
      const onDraw = () => finish(true);

      try {
        win.jQuery(dt.table().node()).one("draw.dt", onDraw);
      } catch (_) {
        finish(false);
        return;
      }

      timer = setTimeout(() => finish(false), timeoutMs);
    });
  }

  async function dataTableSearchAndWait(win, dt, keyword) {
    if (!dt) throw new Error("DataTable not found");
    try { dt.page.len(100); } catch (_) {}
    try { dt.search(keyword || ""); } catch (e) { throw new Error("DataTable search failed: " + (e.message || String(e))); }
    try { dt.page(0); } catch (_) {}

    const drawPromise = waitForNextDraw(win, dt, CONFIG.searchWaitTimeoutMs);
    try { dt.draw(); } catch (e) { throw new Error("DataTable draw failed: " + (e.message || String(e))); }
    const drawn = await drawPromise;
    if (!drawn) throw new Error("DataTable search draw timeout");
    const processingGone = await waitForProcessingGone(win, dt, CONFIG.searchWaitTimeoutMs);
    if (!processingGone) throw new Error("DataTable search processing timeout");
    await sleep(150);
  }

  function findTournamentFromCurrentDataTablePage(win, dt, inputName) {
    const rows = getDataTableTbodyRows(win, dt);
    const matches = [];
    for (const row of rows) {
      const found = extractTournamentFromVisibleRow(row, inputName);
      if (found) matches.push(found);
    }

    const seen = new Set();
    const unique = matches.filter(x => {
      if (seen.has(x.url)) return false;
      seen.add(x.url);
      return true;
    });

    if (unique.length === 1) return unique[0];
    if (unique.length > 1) return { error: "AMBIGUOUS", candidates: unique };
    return null;
  }

  async function waitForWindowLoad(win, timeoutMs = 25000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!win || win.closed) throw new Error("WINDOW_CLOSED");
      try {
        if (win.document && win.document.readyState === "complete") return true;
      } catch (_) {}
      await sleep(300);
    }
    throw new Error("window load timeout");
  }

  async function openTournamentListWindow(path, label) {
    const win = window.open(path, `pw_fee_patch_${label}_${Date.now()}`, "width=1280,height=900");
    if (!win) throw new Error(`${label} tournaments: popup blocked`);
    await waitForWindowLoad(win, 25000);
    const dt = await waitForDataTableReadyInWindow(win, 15000);
    if (!dt) throw new Error(`${label} tournaments: DataTable not found`);
    return win;
  }

  function getDataTablePageInfo(dt) {
    try {
      if (!dt) return { page: 0, pages: 1, length: 100, recordsDisplay: null };
      const info = dt.page.info();
      return {
        page: Number(info.page || 0),
        pages: Math.max(1, Number(info.pages || 1)),
        length: Number(info.length || 100),
        recordsDisplay: typeof info.recordsDisplay === "number" ? info.recordsDisplay : null
      };
    } catch (_) {
      return { page: 0, pages: 1, length: 100, recordsDisplay: null };
    }
  }

  async function goDataTablePageAndWait(win, dt, pageIndex) {
    if (!dt) return;
    const drawPromise = waitForNextDraw(win, dt, CONFIG.searchWaitTimeoutMs);
    try {
      dt.page(pageIndex).draw("page");
    } catch (e) {
      throw new Error(`DataTable page ${pageIndex + 1} draw failed: ${e.message || e}`);
    }

    const drawn = await drawPromise;
    if (!drawn) throw new Error(`DataTable page ${pageIndex + 1} draw timeout`);
    const processingGone = await waitForProcessingGone(win, dt, CONFIG.searchWaitTimeoutMs);
    if (!processingGone) throw new Error(`DataTable page ${pageIndex + 1} processing timeout`);
    await sleep(150);

    if (!win || win.closed) throw new Error("WINDOW_CLOSED");
    const info = getDataTablePageInfo(dt);
    if (info.page !== pageIndex) {
      throw new Error(`DataTable page mismatch expected=${pageIndex + 1} actual=${info.page + 1}`);
    }
  }

  function extractTournamentFromPoolRow(row) {
    const rowText = norm(row.innerText || "");
    const actualName = extractTournamentTitleFromRow(rowText);

    const links = Array.from(row.querySelectorAll("a[href]"));
    const panelLink =
      links.find(a => String(a.getAttribute("href") || "").includes("/cb/torneio/painel/")) ||
      links.find(a => String(a.href || "").includes("/cb/torneio/painel/"));

    const href = panelLink ? (panelLink.getAttribute("href") || panelLink.href) : row.innerHTML;
    const id = extractTournamentIdFromUrl(href);
    if (!id) return null;

    return {
      tournamentId: id,
      url: getTournamentUrl(id),
      actualName,
      matchedRow: rowText
    };
  }

  function collectUrlPoolFromCurrentPage(win, dt, prefix, source) {
    const compactPrefix = compact(prefix);
    const rows = getDataTableTbodyRows(win, dt);
    const out = [];

    for (const row of rows) {
      const item = extractTournamentFromPoolRow(row);
      if (!item) continue;

      const hay = `${item.actualName || ""} ${item.matchedRow || ""}`;
      if (prefix && !norm(hay).includes(prefix) && !compact(hay).includes(compactPrefix)) continue;

      out.push({ ...item, source });
    }

    return out;
  }

  async function collectUrlPoolInWindow(win, label, prefix) {
    const dt = await waitForDataTableReadyInWindow(win, 15000);
    if (!dt) throw new Error(`${label}: DataTable not found`);

    await dataTableSearchAndWait(win, dt, prefix);
    const info = getDataTablePageInfo(dt);
    const pages = info.pages || 1;
    const found = [];
    const seen = new Set();

    logLine(`URL_POOL_PAGE_INFO ${label} ${prefix} pages=${pages} records=${info.recordsDisplay ?? "?"}`);

    for (let page = 0; page < pages; page++) {
      if (stopRequested) break;
      if (page > 0) await goDataTablePageAndWait(win, dt, page);

      const rows = collectUrlPoolFromCurrentPage(win, dt, prefix, label);
      logLine(`URL_POOL_PAGE ${label} ${prefix} ${page + 1}/${pages} rows=${rows.length}`);

      for (const row of rows) {
        const key = row.tournamentId || row.url;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        found.push(row);
      }
    }

    return found;
  }

  function getPrefixesForUrlPool(rows) {
    return uniqueArray((rows || [])
      .map(row => getEventPrefixFromTournamentName(row["大会名"] || ""))
      .filter(Boolean));
  }

  function matchUrlPoolByName(pool, name) {
    const target = compact(cleanTournamentName(name));
    const matches = (pool || []).filter(item =>
      compact(cleanTournamentName(item.actualName || "")) === target
    );

    const seen = new Map();
    for (const item of matches) {
      const id = String(item.tournamentId || extractTournamentIdFromUrl(item.url || "") || "");
      if (!id) continue;
      if (!seen.has(id)) seen.set(id, item);
    }

    const unique = [...seen.values()];
    if (unique.length === 1) return unique[0];
    if (unique.length > 1) return { error: "AMBIGUOUS", candidates: unique };
    return null;
  }

  async function resolveUrlForCandidates() {
    if (running) return alert("処理中です");

    const candidates = getCandidateRows();
    if (!candidates.length) return alert("Candidates が空です。先にPreviewしてください。");

    const targets = candidates.filter(row =>
      row["大会名"] &&
      (!row["TournamentId"] || !row["URL"] || ["URL未解決", "URL_NOT_FOUND", "URL_CACHE_BAD_ROW", "URL_AMBIGUOUS", "AMBIGUOUS"].includes(row["判定"]))
    );

    if (!targets.length) return alert("URL未解決候補はありません。");
    const prefixes = getPrefixesForUrlPool(targets);
    if (!prefixes.length) {
      return alert("Event Prefix を取得できません。URL / TournamentId をTSVに入れてください。");
    }
    if (!confirm(
      `URL未解決候補を URL pool 方式で検索します。\n\n` +
      `対象: ${targets.length}件\n` +
      `Event Prefix: ${prefixes.join(" / ")}\n` +
      `検索: OPEN / CLOSED をPrefix単位で一括収集\n\n続行しますか？`
    )) return;

    running = true;
    stopRequested = false;
    let openWin = null;
    let closedWin = null;
    let okCount = 0;
    let ngCount = 0;
    let ambiguousCount = 0;

    try {
      clearReport();
      logLine(`[${nowText()}] URL POOL SEARCH`);
      setStatus("OPEN / CLOSED大会一覧を開いています...");
      closedWin = await openTournamentListWindow("/cb/torneio/fechados", "closed");
      openWin = await openTournamentListWindow("/cb/torneio/abertos", "open");

      const pool = [];
      const poolSeen = new Set();
      for (const prefix of prefixes) {
        if (stopRequested) break;
        logLine(`URL_POOL_SCAN ${prefix}`);

        for (const item of [
          { win: closedWin, label: "closed" },
          { win: openWin, label: "open" }
        ]) {
          try {
            const rows = await collectUrlPoolInWindow(item.win, item.label, prefix);
            for (const row of rows) {
              const key = row.tournamentId || row.url;
              if (!key || poolSeen.has(key)) continue;
              poolSeen.add(key);
              pool.push(row);
            }
          } catch (e) {
            console.warn("[PW-FEE-PATCH] URL pool failed", e);
            logLine(`URL_POOL_ERROR ${item.label} ${prefix} ${e.message || e}`);
          }
        }
      }
      logLine(`URL_POOL_COLLECTED ${pool.length}`);

      for (let i = 0; i < candidates.length; i++) {
        if (stopRequested) break;

        const row = candidates[i];
        if (!row["大会名"]) continue;
        if (row["TournamentId"] && row["URL"] && !["URL未解決", "URL_NOT_FOUND", "URL_CACHE_BAD_ROW", "URL_AMBIGUOUS", "AMBIGUOUS"].includes(row["判定"])) {
          continue;
        }

        const name = cleanTournamentName(row["大会名"]);
        logLine(`${i + 1}/${candidates.length} POOL_MATCH ${name}`);
        const found = matchUrlPoolByName(pool, name);

        if (!found) {
          row["本次处理"] = "不使用";
          row["判定"] = "URL_NOT_FOUND";
          row["理由"] = "URL poolに完全一致がありません";
          ngCount++;
          logLine(`   NOT_FOUND`);
          continue;
        }

        if (found.error === "AMBIGUOUS") {
          row["本次处理"] = "不使用";
          row["判定"] = "AMBIGUOUS";
          row["理由"] = `${found.candidates.length} candidates`;
          ambiguousCount++;
          logLine(`   AMBIGUOUS ${found.candidates.length} candidates`);
          console.table(found.candidates);
          continue;
        }

        row["本次处理"] = "使用";
        row["TournamentId"] = found.tournamentId;
        row["URL"] = found.url;
        row["判定"] = found.source === "closed" ? "OK_POOL_CLOSED" : "OK_POOL_OPEN";
        row["理由"] = "";
        setSharedCacheItem(name, {
          tournamentId: found.tournamentId,
          url: found.url,
          actualName: found.actualName || name,
          matchedRow: found.matchedRow || "",
          source: `fee-patch-pool-${found.source || "unknown"}`
        });
        okCount++;
        logLine(`   OK ${found.url}`);
      }

      setCandidateRows(candidates);
      setStatus(`URL検索完了 OK=${okCount} NG=${ngCount}`);
      alert(`URL検索完了\n\nOK: ${okCount}\nNOT_FOUND: ${ngCount}\nAMBIGUOUS: ${ambiguousCount}`);
    } catch (e) {
      console.error(e);
      logLine(`ERROR ${e.message || e}`);
      alert("ERROR: " + (e.message || String(e)));
    } finally {
      try { if (closedWin && !closedWin.closed) closedWin.close(); } catch (_) {}
      try { if (openWin && !openWin.closed) openWin.close(); } catch (_) {}
      running = false;
      stopRequested = false;
    }
  }

  async function fetchTournamentDoc(id) {
    const res = await fetch(`/cb/torneio/painel/${id}`, {
      credentials: "same-origin",
      cache: "no-store"
    });
    const html = await res.text();
    if (!res.ok) throw new Error(`FETCH painel failed status=${res.status}`);
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.__pwFeePatchRawHtml = html;
    return doc;
  }

  function getPageTournamentTitleFromDoc(doc) {
    const input = doc.querySelector('input[name="nome"], input[name="ddTrn[nome]"], input[id*="nome"]');
    if (input && input.value) return cleanTournamentName(input.value);

    const titleCandidates = [
      ".page-title",
      "h1",
      "h2",
      ".box-title",
      ".content-header h1"
    ];

    for (const sel of titleCandidates) {
      const text = cleanTournamentName(doc.querySelector(sel)?.textContent || "");
      if (text && text !== "Configuração" && text !== "Configuracao") return text;
    }

    const title = cleanTournamentName(doc.title || "");
    const m = title.match(/(.+?)\s*-\s*PokerWeb/i);
    if (m) return cleanTournamentName(m[1]);
    return title;
  }

  function validateFetchedTournamentName(doc, expectedName) {
    const actual = getPageTournamentTitleFromDoc(doc);
    if (!actual) return { ok: true, actual: "" };
    if (!isSameTournamentExactSafe(expectedName, actual)) {
      return { ok: false, actual, reason: `NAME_MISMATCH actual=${actual}` };
    }
    return { ok: true, actual };
  }

  function existingItems(doc) {
    return [...doc.querySelectorAll('a[href="#modal_item_editar"][data-id_item], button[href="#modal_item_editar"][data-id_item], [data-id_item][data-nome]')]
      .map(el => ({
        id_item: el.getAttribute("data-id_item") || "",
        nome: norm(el.getAttribute("data-nome") || ""),
        siglas: norm(el.getAttribute("data-siglas") || ""),
        valor: norm(el.getAttribute("data-valor") || ""),
        taxa: norm(el.getAttribute("data-taxa") || ""),
        taxa_extras: norm(el.getAttribute("data-taxa_extras") || ""),
        rake: norm(el.getAttribute("data-rake") || ""),
        fichas: norm(el.getAttribute("data-fichas") || ""),
        limite: norm(el.getAttribute("data-limite") || ""),
        reposicionar: norm(el.getAttribute("data-reposicionar") || ""),
        direito_img: norm(el.getAttribute("data-direito_img") || ""),
        pts_ranking: norm(el.getAttribute("data-pts_ranking") || ""),
        gameid_bloqueio: norm(el.getAttribute("data-gameid_bloqueio") || ""),
        raw: el.outerHTML
      }))
      .filter(x => x.id_item);
  }

  function findExistingItem(items, patch) {
    return items.find(x => patch.siglas && x.siglas === patch.siglas) ||
      items.find(x => patch.nome && x.nome === patch.nome) ||
      null;
  }

  function setIfPresentOrDefault(fd, key, value, fallback = "") {
    const finalValue = value !== undefined && value !== null && String(value) !== "" ? value : fallback;
    fd.set(key, finalValue);
  }

  async function patchItemByHtml(id, doc, patch) {
    const form = doc.querySelector('form[action*="item_editar"]');
    if (!form) throw new Error(`${patch.label}: item_editar form not found`);

    const items = existingItems(doc);
    const existing = findExistingItem(items, patch);
    if (!existing) throw new Error(`${patch.label}: existing item not found`);

    const currentValue = normalizeAmount(existing[patch.property] || "0");
    const targetValue = normalizeAmount(patch.targetValue);
    if (currentValue === targetValue) {
      return {
        status: "SKIP",
        id_item: existing.id_item,
        currentValue,
        targetValue,
        message: "already target"
      };
    }

    const fd = new FormData(form);
    fd.set("id_torneio", id);
    fd.set("id_item", existing.id_item);
    setIfPresentOrDefault(fd, "nome", existing.nome, patch.nome);
    setIfPresentOrDefault(fd, "siglas", existing.siglas, patch.siglas);
    setIfPresentOrDefault(fd, "fichas", existing.fichas, "0");
    setIfPresentOrDefault(fd, "limite", existing.limite, "0");
    setIfPresentOrDefault(fd, "reposicionar", existing.reposicionar, "0");
    setIfPresentOrDefault(fd, "direito_img", existing.direito_img, "1");
    setIfPresentOrDefault(fd, "pts_ranking", existing.pts_ranking, "0");
    setIfPresentOrDefault(fd, "gameid_bloqueio", existing.gameid_bloqueio, "1");
    setIfPresentOrDefault(fd, "valor", normalizeAmount(existing.valor), "0");
    fd.set(patch.property, targetValue);
    setIfPresentOrDefault(fd, "rake", normalizeAmount(existing.rake), "0");
    setIfPresentOrDefault(fd, "taxa_extras", existing.taxa_extras, "");

    const action = form.getAttribute("action") || "/cb/torneio/abas/configuracao/item_editar";
    const res = await fetch(action, {
      method: "POST",
      body: fd,
      credentials: "same-origin",
      redirect: "follow"
    });

    if (!res.ok) {
      throw new Error(`${patch.label}: save failed status=${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    return {
      status: "OK",
      id_item: existing.id_item,
      currentValue,
      targetValue
    };
  }

  function extractCodbloqFromRawHtml(html) {
    const source = String(html || "");
    const patterns = [
      /name\s*=\s*["']codbloq["'][^>]*value\s*=\s*["']([^"']+)["']/i,
      /value\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']codbloq["']/i,
      /["']codbloq["']\s*:\s*["']([^"']+)["']/i,
      /\bcodbloq\s*=\s*["']([^"']+)["']/i
    ];

    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match) return norm(match[1]);
    }
    return "";
  }

  function readTournamentRenameContext(doc, id) {
    let sourceDoc = doc;
    let form = sourceDoc.querySelector('form[action*="/cb/torneio/alterar_nome"]');
    let codbloq = norm(
      form?.querySelector('[name="codbloq"]')?.value ||
      sourceDoc.querySelector('[name="codbloq"]')?.value ||
      extractCodbloqFromRawHtml(sourceDoc.__pwFeePatchRawHtml) ||
      ""
    );

    const currentPageId = extractTournamentIdFromUrl(location.href);
    if (!codbloq && currentPageId === String(id)) {
      sourceDoc = document;
      form = sourceDoc.querySelector('form[action*="/cb/torneio/alterar_nome"]');
      codbloq = norm(
        form?.querySelector('[name="codbloq"]')?.value ||
        sourceDoc.querySelector('[name="codbloq"]')?.value ||
        ""
      );
    }

    const painel = norm(
      form?.querySelector('[name="painel"]')?.value ||
      sourceDoc.querySelector('[name="painel"]')?.value ||
      "1"
    );

    return {
      form,
      codbloq,
      painel,
      action: form?.getAttribute("action") || "/cb/torneio/alterar_nome"
    };
  }

  async function patchTournamentNameByHtml(id, doc, currentName, newName) {
    const targetName = cleanTournamentName(newName);
    if (!targetName) throw new Error("New tournament name is empty");
    if (isSameTournamentExactSafe(currentName, targetName)) {
      return { status: "SKIP", currentName, targetName, message: "already target" };
    }

    const context = readTournamentRenameContext(doc, id);
    if (!context.codbloq) {
      throw new Error("Tournament rename codbloq not found in tournament page");
    }

    const fd = context.form ? new FormData(context.form) : new FormData();
    fd.set("nome_caixa_input", targetName);
    fd.set("codbloq", context.codbloq);
    fd.set("id_torneio", id);
    fd.set("painel", context.painel || "1");

    const res = await fetch(context.action, {
      method: "POST",
      body: fd,
      credentials: "same-origin",
      redirect: "follow"
    });

    if (!res.ok) {
      throw new Error(`Tournament rename failed status=${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    return { status: "OK", currentName, targetName };
  }

  async function executeTournamentPatch() {
    if (running) return alert("処理中です");

    const rows = getUseCandidateRows();
    if (!rows.length) return alert("使用対象のCandidatesがありません。Preview / URL検索を確認してください。");

    const unresolved = rows.filter(row => !row["TournamentId"] || !row["URL"]);
    if (unresolved.length) {
      return alert(`URL未解決の使用対象があります: ${unresolved.length}件。先にURL pool検索してください。`);
    }

    const summary = rows.map((row, i) => {
      const changes = [];
      if (row["Patch"]) changes.push(`Item: ${row["Patch"]}`);
      if (row["新大会名"]) changes.push(`大会名: ${row["大会名"]} -> ${row["新大会名"]}`);
      return `${i + 1}. ${row["大会名"]}\n   ${changes.join("\n   ")}\n   ${row["URL"]}`;
    }).join("\n\n");
    if (!confirm(`既存大会の設定を修正します。Item修正の後、最後に大会名を変更します。\n\n対象: ${rows.length}大会\n\n${summary}\n\n続行しますか？`)) return;

    running = true;
    stopRequested = false;
    clearReport();
    logLine(`[${nowText()}] EXECUTE Tournament Patch`);

    let ok = 0;
    let skip = 0;
    let error = 0;

    try {
      for (let i = 0; i < rows.length; i++) {
        if (stopRequested) break;

        const row = rows[i];
        const name = cleanTournamentName(row["大会名"]);
        const newName = cleanTournamentName(row["新大会名"]);
        const id = row["TournamentId"] || extractTournamentIdFromUrl(row["URL"]);
        const patches = parsePatchText(row["Patch"]);

        setStatus(`EXEC ${i + 1}/${rows.length}: ${name}`);
        logLine("");
        logLine(`${i + 1}/${rows.length} ${name}`);
        logLine(`   id=${id} url=${row["URL"] || getTournamentUrl(id)}`);

        if (!id) {
          error++;
          logLine("   ERROR TournamentId empty");
          continue;
        }

        if (!patches.length && !newName) {
          error++;
          logLine("   ERROR Item patch and new tournament name are both empty");
          continue;
        }

        try {
          let doc = await fetchTournamentDoc(id);
          const nameCheck = validateFetchedTournamentName(doc, name);
          if (!nameCheck.ok) throw new Error(nameCheck.reason);
          if (nameCheck.actual) logLine(`   actual=${nameCheck.actual}`);

          for (const patch of patches) {
            const result = await patchItemByHtml(id, doc, patch);
            if (result.status === "SKIP") {
              skip++;
              logLine(`   SKIP ${patch.label} ${patch.valueLabel}=${amountDisplay(result.currentValue)} already target`);
            } else {
              ok++;
              logLine(`   OK ${patch.label} id_item=${result.id_item} ${patch.valueLabel} ${amountDisplay(result.currentValue)} -> ${amountDisplay(result.targetValue)}`);
              doc = await fetchTournamentDoc(id);
            }
            await sleep(CONFIG.afterItemMs);
          }

          if (newName) {
            const currentName = nameCheck.actual || name;
            const result = await patchTournamentNameByHtml(id, doc, currentName, newName);
            if (result.status === "SKIP") {
              skip++;
              logLine(`   SKIP 大会名 already target: ${result.targetName}`);
            } else {
              ok++;
              logLine(`   OK 大会名 ${result.currentName} -> ${result.targetName}`);
            }
          }
        } catch (e) {
          error++;
          console.error(e);
          logLine(`   ERROR ${e.message || e}`);
        }

        await sleep(CONFIG.betweenTournamentsMs);
      }

      logLine("");
      logLine(`DONE OK=${ok} SKIP=${skip} ERROR=${error}`);
      setStatus(`DONE OK=${ok} SKIP=${skip} ERROR=${error}`);
      alert(`完了\n\nOK: ${ok}\nSKIP: ${skip}\nERROR: ${error}`);
    } finally {
      running = false;
      stopRequested = false;
    }
  }

  function stopRun() {
    stopRequested = true;
    setStatus("Stop requested");
  }

  function addPanel() {
    if ($("#pw-fee-patch-panel")) return;

    const panel = document.createElement("div");
    panel.id = "pw-fee-patch-panel";
    panel.style.cssText = [
      "position:fixed",
      "right:18px",
      "top:90px",
      "z-index:999999",
      "width:620px",
      "max-height:88vh",
      "overflow:auto",
      "background:#111827",
      "color:#f9fafb",
      "border:2px solid #38bdf8",
      "border-radius:8px",
      "padding:12px",
      "font:12px/1.45 Arial,sans-serif",
      "box-shadow:0 10px 30px rgba(0,0,0,.35)"
    ].join(";");

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
        <strong>PW Existing Tournament Patch</strong>
        <div style="display:flex;gap:6px;align-items:center;">
          <span id="pw-fee-patch-status" style="color:#bae6fd;">idle</span>
          <button id="pw-fee-patch-min" type="button" style="cursor:pointer;">Min</button>
          <button id="pw-fee-patch-close" type="button" style="cursor:pointer;">x</button>
        </div>
      </div>
      <textarea id="pw-fee-patch-input" style="width:100%;height:92px;box-sizing:border-box;background:#fff;color:#111;font:12px Consolas,monospace;"></textarea>
      <div style="display:flex;gap:6px;margin:8px 0;flex-wrap:wrap;">
        <button id="pw-fee-patch-preview" type="button" style="flex:1;padding:7px;cursor:pointer;">Preview</button>
        <button id="pw-fee-patch-resolve" type="button" style="flex:1;padding:7px;cursor:pointer;background:#dbeafe;">URL pool検索</button>
        <button id="pw-fee-patch-execute" type="button" style="flex:1;padding:7px;cursor:pointer;background:#fef3c7;">EXECUTE</button>
        <button id="pw-fee-patch-stop" type="button" style="padding:7px;cursor:pointer;background:#fecaca;">Stop</button>
        <button id="pw-fee-patch-copy" type="button" style="padding:7px;cursor:pointer;">Copy Report</button>
        <button id="pw-fee-patch-clear" type="button" style="padding:7px;cursor:pointer;">Clear</button>
      </div>
      <div id="pw-fee-patch-body">
        <div style="margin:6px 0;color:#cbd5e1;">Candidates</div>
        <textarea id="pw-fee-patch-candidates" style="width:100%;height:118px;box-sizing:border-box;background:#fff;color:#111;font:12px Consolas,monospace;"></textarea>
        <div style="margin:6px 0;color:#cbd5e1;">Report</div>
        <textarea id="pw-fee-patch-report" readonly style="width:100%;height:220px;box-sizing:border-box;background:#0f172a;color:#e0f2fe;border:1px solid #475569;font:12px Consolas,monospace;"></textarea>
      </div>
    `;

    document.body.appendChild(panel);

    $("#pw-fee-patch-input").value = localStorage.getItem(CONFIG.inputKey) || DEFAULT_INPUT;
    $("#pw-fee-patch-candidates").value = localStorage.getItem(CONFIG.candidateKey) || "";
    $("#pw-fee-patch-report").value = localStorage.getItem(CONFIG.reportKey) || "";

    $("#pw-fee-patch-close").addEventListener("click", () => panel.remove());
    $("#pw-fee-patch-min").addEventListener("click", () => {
      const body = $("#pw-fee-patch-body");
      const hidden = body.style.display === "none";
      body.style.display = hidden ? "" : "none";
      $("#pw-fee-patch-min").textContent = hidden ? "Min" : "復元";
    });
    $("#pw-fee-patch-preview").addEventListener("click", previewBuildCandidates);
    $("#pw-fee-patch-resolve").addEventListener("click", resolveUrlForCandidates);
    $("#pw-fee-patch-execute").addEventListener("click", executeTournamentPatch);
    $("#pw-fee-patch-stop").addEventListener("click", stopRun);
    $("#pw-fee-patch-copy").addEventListener("click", () => {
      copyText($("#pw-fee-patch-report")?.value || "");
      setStatus("Report copied");
    });
    $("#pw-fee-patch-clear").addEventListener("click", () => {
      $("#pw-fee-patch-input").value = DEFAULT_INPUT;
      $("#pw-fee-patch-candidates").value = "";
      $("#pw-fee-patch-report").value = "";
      localStorage.removeItem(CONFIG.candidateKey);
      localStorage.removeItem(CONFIG.reportKey);
      localStorage.setItem(CONFIG.inputKey, DEFAULT_INPUT);
      setStatus("cleared");
    });
  }

  function addLauncher() {
    if ($("#pw-fee-patch-launcher")) return;
    const btn = document.createElement("button");
    btn.id = "pw-fee-patch-launcher";
    btn.type = "button";
    btn.textContent = "Tournament Patch";
    btn.style.cssText = [
      "position:fixed",
      "right:18px",
      "bottom:72px",
      "z-index:999998",
      "padding:8px 10px",
      "border:1px solid #0284c7",
      "border-radius:6px",
      "background:#0369a1",
      "color:white",
      "font:12px Arial,sans-serif",
      "cursor:pointer"
    ].join(";");
    btn.addEventListener("click", addPanel);
    document.body.appendChild(btn);
  }

  addLauncher();
})();
