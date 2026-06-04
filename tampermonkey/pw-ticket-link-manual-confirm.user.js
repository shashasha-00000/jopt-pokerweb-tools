// ==UserScript==
// @name         PW Ticket Link 人工確認版 v1.0
// @namespace    pw-ticket-link-manual-confirm
// @version      1.0.0
// @description  TicketLink用ルール表から候補作成 → URL厳密確認 → USE候補でTicket Link実行。URL検索はOPEN/CLOSED両方、Ticket optionはtn_のみ。
// @author       xhpc007 + ChatGPT
// @match        https://japanopt.pokerweb.com.br/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    sharedUrlCacheKey: "PW_SHARED_TOURNAMENT_URL_CACHE_V1",

    modeKey: "PW_TICKET_LINK_MANUAL_V10_MODE",
    tournamentInputKey: "PW_TICKET_LINK_MANUAL_V10_TOURNAMENTS",
    simpleTicketInputKey: "PW_TICKET_LINK_MANUAL_V10_SIMPLE_TICKETS",
    matrixInputKey: "PW_TICKET_LINK_MANUAL_V10_MATRIX",
    overrideInputKey: "PW_TICKET_LINK_MANUAL_V10_OVERRIDES",
    candidateKey: "PW_TICKET_LINK_MANUAL_V10_CANDIDATES",
    reportKey: "PW_TICKET_LINK_MANUAL_V10_REPORT",
    flowKey: "PW_TICKET_LINK_MANUAL_V10_FLOW",

    searchWaitTimeoutMs: 10000,
    searchPollMs: 350,
    afterSearchMs: 250,
    afterPageLoadMs: 1400,
    betweenTicketsMs: 600,
    betweenTournamentsMs: 800,

    blockStartOnSuspiciousRows: true,
    previewTicketDisplayLimit: 30
  };

  const CANDIDATE_HEADERS = [
    "USE",
    "大会名",
    "Key",
    "Key来源",
    "Ticket数",
    "Ticket一覧",
    "TournamentId",
    "URL",
    "判定",
    "理由"
  ];

  let running = false;
  let stopRequested = false;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  // ============================================================
  // Basic Utils
  // ============================================================

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
      .replace(/監査済み/g, "")
      .toLowerCase();
  }

  function cleanTournamentName(name) {
    return String(name || "")
      .replace(/\s*-\s*PokerWeb\s*$/i, "")
      .replace(/\s*監査済み\s*$/g, "")
      .trim();
  }

  function nowText() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function log(...args) {
    console.log("[PW-TICKET-LINK-v1.0]", ...args);
    const el = document.querySelector("#pw-ticket-link-status");
    if (el) el.textContent = args.map(String).join(" ");
  }

  function warn(...args) {
    console.warn("[PW-TICKET-LINK-v1.0]", ...args);
    const el = document.querySelector("#pw-ticket-link-status");
    if (el) el.textContent = "⚠ " + args.map(String).join(" ");
  }

  function isVisibleInWindow(win, el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = win.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
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

  function escTsv(value) {
    if (Array.isArray(value)) value = value.join(" | ");
    if (value && typeof value === "object") value = JSON.stringify(value);

    return String(value ?? "")
      .replace(/\r?\n/g, " ")
      .replace(/\t/g, " ")
      .trim();
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

    return lines.slice(1).map(line => {
      const cols = line.split("\t");
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = norm(cols[i] || "");
      });
      return obj;
    });
  }

  function splitNonEmptyLines(raw) {
    return String(raw || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map(x => x.replace(/\uFEFF/g, ""))
      .filter(x => norm(x));
  }

  function splitTSVLine(line) {
    return String(line || "").split("\t");
  }

  function uniqueArray(arr) {
    const seen = new Set();
    const out = [];

    for (const x of arr || []) {
      const k = norm(x);
      if (!k) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }

    return out;
  }

  function getTournamentUrl(tournamentId) {
    return `/cb/torneio/painel/${tournamentId}`;
  }

  function extractTournamentIdFromUrl(url) {
    const m = String(url || "").match(/\/cb\/torneio\/painel\/(\d+)/);
    return m ? m[1] : "";
  }

  function normalizeCacheUrl(id, url) {
    const urlId = extractTournamentIdFromUrl(url);
    const finalId = String(id || urlId || "").trim();
    return finalId ? getTournamentUrl(finalId) : "";
  }

  function isPainelPage() {
    return /\/cb\/torneio\/painel\/\d+/.test(location.href);
  }

  function getCurrentTournamentIdFromUrl() {
    return extractTournamentIdFromUrl(location.href);
  }

  // ============================================================
  // Tournament Name / Key
  // ============================================================

  function getEventPrefixFromTournamentName(name) {
    const m = norm(name).match(/【[^】]+】/);
    return m ? m[0] : "";
  }

  function getTournamentNoKeyFromName(name) {
    const s = norm(name);

    const sat = s.match(/\(?\s*s\s*0*(\d{1,3})\s*\)?/i);
    if (sat) return `s${String(Number(sat[1])).padStart(2, "0")}`;

    const m = s.match(/#\s*0*(\d{1,3})([A-Za-z])?/);
    if (m) {
      const num = String(Number(m[1])).padStart(2, "0");
      const suffix = m[2] ? m[2].toUpperCase() : "";

      if (suffix) return `#${num}${suffix}`;

      const after = s.slice(m.index);
      const day1 = after.match(/\bday\s*1\s*([A-Za-z])\b/i);
      if (day1) return `#${num}${day1[1].toUpperCase()}`;

      const day1Alt = after.match(/\bday1([A-Za-z])\b/i);
      if (day1Alt) return `#${num}${day1Alt[1].toUpperCase()}`;

      return `#${num}`;
    }

    return "";
  }

  function isSameTournamentExactSafe(inputName, actualName) {
    const a = cleanTournamentName(inputName);
    const b = cleanTournamentName(actualName);

    if (!a || !b) return false;
    return compact(a) === compact(b);
  }

  function normalizeKey(raw) {
    let s = norm(raw)
      .replace(/[＃]/g, "#")
      .replace(/\s+/g, "")
      .replace(/[－ー―]/g, "-");

    if (!s) return "";

    const m = s.match(/^#0*(\d{1,3})([A-Za-z])?$/);
    if (m) {
      const num = String(Number(m[1])).padStart(2, "0");
      const suffix = m[2] ? m[2].toUpperCase() : "";
      return `#${num}${suffix}`;
    }

    const sat = s.match(/^s0*(\d{1,3})$/i);
    if (sat) {
      return `s${String(Number(sat[1])).padStart(2, "0")}`;
    }

    return s;
  }

  function looksLikeMatrixKey(raw) {
    const k = normalizeKey(raw);
    return /^#\d{2,3}[A-Z]?$/.test(k) || /^s\d{2,3}$/.test(k);
  }

  function extractTournamentKeyAuto(tournamentName) {
    const key = getTournamentNoKeyFromName(tournamentName);

    if (!key) {
      return {
        key: "",
        source: "認識不可 / 无法识别"
      };
    }

    if (/^s\d+$/i.test(key)) {
      return {
        key,
        source: "自動認識 / 自动识别: s番号"
      };
    }

    if (/^#\d+[A-Z]$/.test(key)) {
      return {
        key,
        source: "自動認識 / 自动识别: #番号+Day1後ろ文字"
      };
    }

    return {
      key,
      source: "自動認識 / 自动识别: #番号"
    };
  }

  function parseManualOverrides(raw) {
    const lines = splitNonEmptyLines(raw);
    const overrides = [];
    const warnings = [];

    lines.forEach((line, i) => {
      const cols = splitTSVLine(line).map(norm);

      if (cols.length < 2 || !cols[0] || !cols[1]) {
        warnings.push(`手動修正 第${i + 1}行を解析できません / 手动修正第${i + 1}行无法解析。形式：大会名キーワード[TAB]修正Key`);
        return;
      }

      const keyword = cols[0];
      const key = normalizeKey(cols[1]);

      if (!looksLikeMatrixKey(key)) {
        warnings.push(`手動修正 第${i + 1}行のKeyが標準形式ではない可能性があります / key看起来不标准：${cols[1]} → ${key}`);
      }

      overrides.push({
        keyword,
        key,
        line: i + 1
      });
    });

    overrides.sort((a, b) => b.keyword.length - a.keyword.length);

    return { overrides, warnings };
  }

  function resolveKeyByManualOverride(tournamentName, overrides) {
    const tn = norm(tournamentName);

    for (const ov of overrides || []) {
      if (tn.includes(ov.keyword)) {
        return {
          key: ov.key,
          source: `手動修正 / 手动修正: ${ov.keyword}`
        };
      }
    }

    return null;
  }

  function resolveTournamentKey(tournamentName, overrides) {
    const manual = resolveKeyByManualOverride(tournamentName, overrides);
    if (manual) return manual;
    return extractTournamentKeyAuto(tournamentName);
  }

  // ============================================================
  // Shared URL Cache
  // ============================================================

  function loadSharedCache() {
    try {
      const raw = localStorage.getItem(CONFIG.sharedUrlCacheKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      console.warn("shared cache parse failed", e);
      return {};
    }
  }

  function saveSharedCache(cache) {
    localStorage.setItem(CONFIG.sharedUrlCacheKey, JSON.stringify(cache));
  }

  function setSharedCacheItem(name, data) {
    const cleanName = cleanTournamentName(name);
    if (!cleanName) return;

    const id = String(data.tournamentId || extractTournamentIdFromUrl(data.url || "") || "").trim();
    const url = data.url || (id ? getTournamentUrl(id) : "");
    if (!id || !url) return;

    const cache = loadSharedCache();
    const key = `${cleanName}||${id}`;

    cache[key] = {
      name: cleanName,
      tournamentId: id,
      url: normalizeCacheUrl(id, url),
      actualName: cleanTournamentName(data.actualName || data.name || cleanName),
      matchedRow: String(data.matchedRow || ""),
      savedAt: nowText(),
      source: String(data.source || "ticket-link-v1.0")
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
    const finalUrl = normalizeCacheUrl(finalId, url);

    return {
      ok: true,
      name,
      actualName,
      tournamentId: finalId,
      url: finalUrl,
      matchedRow: item.matchedRow || item.Matched_Row || "",
      source: item.source || item.Source || "shared-cache"
    };
  }

  function findSharedCacheByName(name) {
    const cleanName = cleanTournamentName(name);
    const matches = [];
    const badRows = [];
    const cache = loadSharedCache();

    for (const item of Object.values(cache)) {
      const checked = validateUrlCacheItem(item);

      if (!checked.ok) {
        const itemName = cleanTournamentName(item.name || item.Name || "");
        const itemActual = cleanTournamentName(item.actualName || item.Actual_Name || "");
        if (
          isSameTournamentExactSafe(cleanName, itemName) ||
          isSameTournamentExactSafe(cleanName, itemActual)
        ) {
          badRows.push(checked.reason);
        }
        continue;
      }

      if (
        isSameTournamentExactSafe(cleanName, checked.name) ||
        isSameTournamentExactSafe(cleanName, checked.actualName)
      ) {
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

    if (unique.length === 1) {
      return {
        status: "OK_CACHE",
        row: unique[0],
        reason: ""
      };
    }

    if (unique.length > 1) {
      return {
        status: "URL_AMBIGUOUS",
        row: null,
        reason: `${unique.length} cache rows matched: ${unique.map(x => x.tournamentId).join(",")}`
      };
    }

    if (badRows.length) {
      return {
        status: "URL_CACHE_BAD_ROW",
        row: null,
        reason: badRows.join(" / ")
      };
    }

    return {
      status: "URL未解決",
      row: null,
      reason: "OPEN/CLOSED大会一覧でURL検索してください"
    };
  }

  function cacheToRows() {
    const seen = new Set();

    return Object.values(loadSharedCache())
      .map(item => validateUrlCacheItem(item))
      .filter(item => item.ok)
      .filter(item => {
        const key = item.tournamentId || item.url;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ja"))
      .map(x => ({
        Name: x.name || "",
        TournamentId: x.tournamentId || "",
        URL: x.url || "",
        Actual_Name: x.actualName || "",
        Source: x.source || "",
        SavedAt: "",
        Matched_Row: x.matchedRow || ""
      }));
  }

  function cacheToTsv() {
    return toTsv(cacheToRows(), ["Name", "TournamentId", "URL", "Actual_Name", "Source", "SavedAt", "Matched_Row"]);
  }

  // ============================================================
  // Parse Ticket Inputs
  // ============================================================

  function isTrueCell(v) {
    const s = norm(v).toUpperCase();
    return s === "TRUE" || s === "✓" || s === "○" || s === "〇" || s === "1";
  }

  function parseSimpleTicketInput(raw) {
    const rawLines = String(raw || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map(x => x.replace(/\uFEFF/g, ""));

    const errors = [];
    const warnings = [];
    const tickets = [];

    const nonEmptyLines = rawLines.filter(x => norm(x));

    if (!nonEmptyLines.length) {
      errors.push("Ticket名入力欄が空です / Ticket名框为空");
      return { tickets, errors, warnings, mode: "simple" };
    }

    let headerIndex = -1;
    let ticketColIndex = -1;

    for (let i = 0; i < nonEmptyLines.length; i++) {
      const cells = splitTSVLine(nonEmptyLines[i]).map(norm);

      const idx = cells.findIndex(c => {
        const lower = c.toLowerCase();
        return c === "チケット名称" ||
          c === "チケット名" ||
          lower === "ticket" ||
          lower === "ticket name" ||
          lower === "ticketname";
      });

      if (idx >= 0) {
        headerIndex = i;
        ticketColIndex = idx;
        break;
      }
    }

    if (headerIndex >= 0) {
      for (let i = headerIndex + 1; i < nonEmptyLines.length; i++) {
        const cells = splitTSVLine(nonEmptyLines[i]).map(norm);
        const ticketName = norm(cells[ticketColIndex] || "");
        if (ticketName) tickets.push(ticketName);
      }
    } else {
      for (const line of nonEmptyLines) {
        const cells = splitTSVLine(line).map(norm);
        const firstNonEmpty = cells.find(c => norm(c));
        if (firstNonEmpty) tickets.push(firstNonEmpty);
      }
    }

    const uniqueTickets = uniqueArray(tickets);

    if (!uniqueTickets.length) {
      errors.push("Ticket名を認識できません / 无法识别 Ticket 名");
    }

    if (tickets.length !== uniqueTickets.length) {
      warnings.push(`重複Ticketを削除しました / 已去重 Ticket：${tickets.length} → ${uniqueTickets.length}`);
    }

    return {
      tickets: uniqueTickets,
      errors,
      warnings,
      mode: "simple",
      headerIndex,
      ticketColIndex
    };
  }

  function parseTicketMatrix(raw) {
    const rawLines = String(raw || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map(x => x.replace(/\uFEFF/g, ""));

    const errors = [];
    const warnings = [];
    const suspiciousRows = [];
    const blankRows = [];

    if (!rawLines.some(x => norm(x))) {
      errors.push("Ticketルール表が空です / Ticket规则表为空");
      return {
        errors,
        warnings,
        suspiciousRows,
        blankRows,
        headerIndex: -1,
        ticketNameCol: -1,
        keyCols: [],
        keyToTickets: {},
        ticketRows: []
      };
    }

    let headerIndex = -1;
    let headerCells = [];

    for (let i = 0; i < rawLines.length; i++) {
      const cells = splitTSVLine(rawLines[i]).map(norm);
      const hasTicketName = cells.some(c => c === "チケット名称" || c === "チケット名" || c.toLowerCase() === "ticket" || c.toLowerCase() === "ticket name");
      const hasKeys = cells.some(looksLikeMatrixKey);

      if (hasTicketName && hasKeys) {
        headerIndex = i;
        headerCells = cells;
        break;
      }
    }

    if (headerIndex < 0) {
      errors.push("Ticketルール表のヘッダー行が見つかりません / 找不到表头行。请从包含「チケット名称」和「#02 / #01A / s01」的行开始复制。");
      return {
        errors,
        warnings,
        suspiciousRows,
        blankRows,
        headerIndex: -1,
        ticketNameCol: -1,
        keyCols: [],
        keyToTickets: {},
        ticketRows: []
      };
    }

    const ticketNameCol = headerCells.findIndex(c => c === "チケット名称" || c === "チケット名" || c.toLowerCase() === "ticket" || c.toLowerCase() === "ticket name");

    if (ticketNameCol < 0) {
      errors.push("ヘッダー内に「チケット名称」列が見つかりません / 表头里找不到「チケット名称」列");
    }

    const keyCols = [];

    headerCells.forEach((cell, colIndex) => {
      if (!looksLikeMatrixKey(cell)) return;

      keyCols.push({
        colIndex,
        raw: cell,
        key: normalizeKey(cell)
      });
    });

    if (!keyCols.length) {
      errors.push("ヘッダー内に大会Key列が見つかりません / 表头里没有识别到任何比赛Key列，例如 #02 / #01A / s01");
    }

    const keyToTickets = {};
    keyCols.forEach(k => {
      if (!keyToTickets[k.key]) keyToTickets[k.key] = [];
    });

    const ticketRows = [];

    for (let r = headerIndex + 1; r < rawLines.length; r++) {
      const line = rawLines[r];

      if (!norm(line)) {
        blankRows.push(r + 1);
        continue;
      }

      const cellsRaw = splitTSVLine(line);
      const cells = cellsRaw.map(norm);

      const ticketName = norm(cells[ticketNameCol] || "");

      if (!ticketName) {
        suspiciousRows.push({
          line: r + 1,
          reason: "チケット名称列が空ですが、この行は空行ではありません。コピー時の改行崩れの可能性があります / チケット名称列为空，但这一行不是空行，可能复制断行。",
          raw: line.slice(0, 300)
        });
        continue;
      }

      const trueKeys = [];

      for (const kc of keyCols) {
        const value = cells[kc.colIndex] || "";
        if (isTrueCell(value)) {
          trueKeys.push(kc.key);
          keyToTickets[kc.key].push(ticketName);
        }
      }

      ticketRows.push({
        line: r + 1,
        ticketName,
        trueKeys
      });

      if (!trueKeys.length) {
        warnings.push(`第${r + 1}行のTicketにTRUEがありません / 第${r + 1}行 ticket 没有任何 TRUE：${ticketName}`);
      }
    }

    for (const k of Object.keys(keyToTickets)) {
      keyToTickets[k] = uniqueArray(keyToTickets[k]);
    }

    if (ticketRows.length === 0) {
      errors.push("Ticket行を1件も認識できません / 没有识别到任何 ticket 行。请确认复制范围包含 ticket 数据行。");
    }

    if (suspiciousRows.length) {
      const msg = `疑似改行崩れ・異常行が ${suspiciousRows.length} 行あります / 发现 ${suspiciousRows.length} 行疑似断行或异常行`;
      if (CONFIG.blockStartOnSuspiciousRows) {
        errors.push(`${msg}。現在はSTART禁止設定です / 当前设定为禁止START。请修正复制内容后再Preview。`);
      } else {
        warnings.push(msg);
      }
    }

    return {
      errors,
      warnings,
      suspiciousRows,
      blankRows,
      headerIndex,
      headerCells,
      ticketNameCol,
      keyCols,
      keyToTickets,
      ticketRows
    };
  }

  // ============================================================
  // Build Candidates
  // ============================================================

  function getCurrentMode() {
    const el = document.querySelector('input[name="pw-ticket-link-mode"]:checked');
    return el ? el.value : (localStorage.getItem(CONFIG.modeKey) || "simple");
  }

  function saveCurrentInputs() {
    const mode = getCurrentMode();
    localStorage.setItem(CONFIG.modeKey, mode);
    localStorage.setItem(CONFIG.tournamentInputKey, document.querySelector("#pw-ticket-link-tournaments")?.value || "");
    localStorage.setItem(CONFIG.simpleTicketInputKey, document.querySelector("#pw-ticket-link-simple-tickets")?.value || "");
    localStorage.setItem(CONFIG.matrixInputKey, document.querySelector("#pw-ticket-link-rules")?.value || "");
    localStorage.setItem(CONFIG.overrideInputKey, document.querySelector("#pw-ticket-link-overrides")?.value || "");
  }

  function buildTasksSimpleMode(tournamentRaw, ticketRaw) {
    const errors = [];
    const warnings = [];

    const tournamentNames = splitNonEmptyLines(tournamentRaw).map(cleanTournamentName);

    if (!tournamentNames.length) {
      errors.push("大会名入力欄が空です / 比赛名框为空");
    }

    const ticketParsed = parseSimpleTicketInput(ticketRaw);
    errors.push(...ticketParsed.errors);
    warnings.push(...ticketParsed.warnings);

    const tasks = [];

    if (!errors.length) {
      for (const name of tournamentNames) {
        tasks.push({
          name,
          key: "SIMPLE",
          keySource: "簡単モード / 简单模式",
          tickets: ticketParsed.tickets
        });
      }
    }

    return {
      ok: errors.length === 0,
      mode: "simple",
      errors,
      warnings,
      tasks,
      tournamentNames,
      simpleTicketParsed: ticketParsed
    };
  }

  function buildTasksDetailMode(tournamentRaw, matrixRaw, overrideRaw) {
    const errors = [];
    const warnings = [];

    const tournamentNames = splitNonEmptyLines(tournamentRaw).map(cleanTournamentName);

    if (!tournamentNames.length) {
      errors.push("大会名入力欄が空です / 比赛名框为空");
    }

    const overrideResult = parseManualOverrides(overrideRaw);
    warnings.push(...overrideResult.warnings);

    const matrix = parseTicketMatrix(matrixRaw);
    errors.push(...matrix.errors);
    warnings.push(...matrix.warnings);

    const tasks = [];

    if (!errors.length) {
      tournamentNames.forEach((name, i) => {
        const resolved = resolveTournamentKey(name, overrideResult.overrides);
        const key = normalizeKey(resolved.key);

        if (!key) {
          errors.push(`大会 第${i + 1}行のKeyを認識できません / 比赛第${i + 1}行无法识别Key：${name}`);
          return;
        }

        if (!matrix.keyToTickets[key]) {
          errors.push(`大会 第${i + 1}行 Key=${key} がTicketルール表に存在しません / 规则表中没有这个列：${name}`);
          return;
        }

        const tickets = matrix.keyToTickets[key] || [];

        if (!tickets.length) {
          errors.push(`大会 第${i + 1}行 Key=${key} に対応するTicketが0件です / 对应Ticket数为0：${name}`);
          return;
        }

        tasks.push({
          name,
          key,
          keySource: resolved.source,
          tickets
        });
      });
    }

    return {
      ok: errors.length === 0,
      mode: "detail",
      errors,
      warnings,
      tasks,
      tournamentNames,
      overrides: overrideResult.overrides,
      matrix
    };
  }

  function buildTasksFromCurrentInputs() {
    const mode = getCurrentMode();
    const tournamentRaw = document.querySelector("#pw-ticket-link-tournaments")?.value || "";

    if (mode === "simple") {
      const ticketRaw = document.querySelector("#pw-ticket-link-simple-tickets")?.value || "";
      return buildTasksSimpleMode(tournamentRaw, ticketRaw);
    }

    const matrixRaw = document.querySelector("#pw-ticket-link-rules")?.value || "";
    const overrideRaw = document.querySelector("#pw-ticket-link-overrides")?.value || "";
    return buildTasksDetailMode(tournamentRaw, matrixRaw, overrideRaw);
  }

  function buildCandidateRowsFromParsed(parsed) {
    const rows = [];

    for (const t of parsed.tasks || []) {
      const cacheResult = findSharedCacheByName(t.name);
      const cache = cacheResult.row || null;

      rows.push({
        "USE": cache ? "1" : "",
        "大会名": cleanTournamentName(t.name),
        "Key": t.key || "",
        "Key来源": t.keySource || "",
        "Ticket数": String((t.tickets || []).length),
        "Ticket一覧": (t.tickets || []).join(" | "),
        "TournamentId": cache ? cache.tournamentId : "",
        "URL": cache ? cache.url : "",
        "判定": cacheResult.status,
        "理由": cacheResult.reason
      });
    }

    return rows;
  }

  function setCandidateRows(rows) {
    const tsv = toTsv(rows, CANDIDATE_HEADERS);
    const box = document.querySelector("#pw-ticket-link-candidates");
    if (box) box.value = tsv;
    localStorage.setItem(CONFIG.candidateKey, tsv);
    return tsv;
  }

  function getCandidateText() {
    return document.querySelector("#pw-ticket-link-candidates")?.value || "";
  }

  function getCandidateRows() {
    return parseTsv(getCandidateText());
  }

  function getUseCandidateRows() {
    return getCandidateRows().filter(row => {
      const use = norm(row["USE"]);
      return use === "1" || use.toUpperCase() === "TRUE" || use.toUpperCase() === "Y" || use === "〇" || use === "○";
    });
  }

  function previewBuildCandidates() {
    saveCurrentInputs();

    const parsed = buildTasksFromCurrentInputs();
    console.log("[PW-TICKET-LINK] parsed", parsed);

    const lines = [];
    lines.push(`[${nowText()}] PREVIEW  Ticket Link候補作成`);
    lines.push("");
    lines.push(`処理モード / 处理模式：${parsed.mode === "simple" ? "簡単モード / 简单模式" : "詳細モード / 详细模式"}`);

    if (parsed.warnings.length) {
      lines.push("");
      lines.push("【WARN】");
      parsed.warnings.forEach(w => lines.push(`- ${w}`));
    }

    if (parsed.errors.length) {
      lines.push("");
      lines.push("【ERROR / 候補作成不可】");
      parsed.errors.forEach(e => lines.push(`- ${e}`));
      setReportText(lines.join("\n"));
      alert(`Preview NG：ERROR ${parsed.errors.length}件。候補作成不可。`);
      return;
    }

    const rows = buildCandidateRowsFromParsed(parsed);

    lines.push("");
    lines.push(`大会数 / 比赛数：${rows.length}`);
    lines.push(`Ticket Link予定数 / 预计Link次数：${rows.reduce((sum, r) => sum + Number(r["Ticket数"] || 0), 0)}`);
    lines.push("");
    lines.push("【候補 / Candidates】");

    rows.forEach((r, i) => {
      lines.push("");
      lines.push(`${i + 1}. ${r["大会名"]}`);
      lines.push(`   Key=${r["Key"]} / Tickets=${r["Ticket数"]} / 判定=${r["判定"]}`);
      lines.push(`   URL=${r["URL"] || "(未解決)"}`);

      const tickets = String(r["Ticket一覧"] || "").split("|").map(norm).filter(Boolean);
      tickets.slice(0, CONFIG.previewTicketDisplayLimit).forEach(t => lines.push(`   → ${t}`));
      if (tickets.length > CONFIG.previewTicketDisplayLimit) {
        lines.push(`   ...ほか ${tickets.length - CONFIG.previewTicketDisplayLimit} 件`);
      }
    });

    setCandidateRows(rows);
    setReportText(lines.join("\n"));

    alert(
      `候補作成完了\n\n` +
      `大会数：${rows.length}\n` +
      `URL解決済み：${rows.filter(r => r["判定"] === "OK_CACHE").length}\n` +
      `URL未解決：${rows.filter(r => r["判定"] === "URL未解決").length}\n` +
      `URL同名複数：${rows.filter(r => r["判定"] === "URL_AMBIGUOUS").length}\n` +
      `URL疑似汚染：${rows.filter(r => r["判定"] === "URL_CACHE_BAD_ROW").length}\n\n` +
      `候補欄を確認してください。`
    );
  }

  // ============================================================
  // URL Search OPEN/CLOSED
  // ============================================================

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
    const rowHtml = row.innerHTML || "";
    const actualName = extractTournamentTitleFromRow(rowText);

    if (!isSameTournamentExactSafe(inputName, actualName)) return null;

    const links = Array.from(row.querySelectorAll("a[href]"));
    const panelLink =
      links.find(a => String(a.getAttribute("href") || "").includes("/cb/torneio/painel/")) ||
      links.find(a => String(a.href || "").includes("/cb/torneio/painel/"));

    const href = panelLink ? (panelLink.getAttribute("href") || panelLink.href) : rowHtml;
    const m = String(href).match(/\/cb\/torneio\/painel\/(\d+)/);
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
      if (apiTables && apiTables.length) {
        return win.jQuery(apiTables[0]).DataTable();
      }

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

      if (!processing) return false;

      return isVisibleInWindow(win, processing);
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

      const finish = value => {
        if (done) return;
        done = true;
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

      setTimeout(() => finish(false), timeoutMs);
    });
  }

  async function dataTableSearchAndWait(win, dt, keyword) {
    if (!dt) throw new Error("DataTable not found");

    try {
      dt.page.len(100);
    } catch (_) {}

    try {
      dt.search(keyword || "");
    } catch (e) {
      throw new Error("DataTable search failed: " + (e.message || String(e)));
    }

    try {
      dt.page(0);
    } catch (_) {}

    const drawPromise = waitForNextDraw(win, dt, CONFIG.searchWaitTimeoutMs);

    try {
      dt.draw();
    } catch (e) {
      throw new Error("DataTable draw failed: " + (e.message || String(e)));
    }

    await drawPromise;
    await waitForProcessingGone(win, dt, CONFIG.searchWaitTimeoutMs);
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
        if (win.document && win.document.readyState === "complete") {
          return true;
        }
      } catch (_) {}

      await sleep(300);
    }

    throw new Error("window load timeout");
  }
  async function openTournamentListWindow(path, label) {
    const win = window.open(path, `pw_ticket_url_${label}_${Date.now()}`, "width=1280,height=900");
    if (!win) throw new Error(`${label}: popup blocked`);

    await waitForWindowLoad(win, 25000);

    const dt = await waitForDataTableReadyInWindow(win, 15000);
    if (!dt) throw new Error(`${label}: DataTable not found`);

    return win;
  }

  async function searchTournamentInListWindow(win, name) {
    const dt = await waitForDataTableReadyInWindow(win, 15000);
    if (!dt) throw new Error("DataTable not found");

    let lastFound = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      if (stopRequested) return null;

      try {
        log(`URL検索 retry ${attempt}/2: ${name}`);

        await dataTableSearchAndWait(win, dt, name);

        const found = findTournamentFromCurrentDataTablePage(win, dt, name);
        if (found) {
          lastFound = found;
          break;
        }

        await sleep(300);
      } catch (e) {
        warn(`URL search retry ${attempt}/2 failed`, e.message || e);
        await sleep(500);
      }
    }

    return lastFound;
  }

  async function resolveUrlForCandidates() {
    if (running) {
      alert("処理中です");
      return;
    }

    const candidates = getCandidateRows();

    if (!candidates.length) {
      alert("Candidates が空です。先に候補作成してください。");
      return;
    }

    const targets = candidates.filter(row =>
      row["大会名"] &&
      (!row["TournamentId"] ||
        !row["URL"] ||
        ["URL未解決", "URL_NOT_FOUND", "URL_CACHE_BAD_ROW", "URL_AMBIGUOUS", "AMBIGUOUS"].includes(row["判定"]))
    );

    if (!targets.length) {
      alert("URL未解決・疑似汚染候補はありません。");
      return;
    }

    if (!confirm(
      `URL未解決・疑似汚染候補を OPEN / CLOSED 両方の大会一覧で検索します。\n\n` +
      `対象：${targets.length}件\n\n続行しますか？`
    )) return;

    running = true;
    stopRequested = false;

    let closedWin = null;
    let openWin = null;
    let okCount = 0;
    let ngCount = 0;
    let ambiguousCount = 0;

    try {
      log("CLOSED大会一覧を開いています...");
      closedWin = await openTournamentListWindow("/cb/torneio/fechados", "closed");

      log("OPEN大会一覧を開いています...");
      openWin = await openTournamentListWindow("/cb/torneio/abertos", "open");

      for (let i = 0; i < candidates.length; i++) {
        if (stopRequested) break;

        const row = candidates[i];
        if (!row["大会名"]) continue;

        if (row["TournamentId"] && row["URL"] && !["URL未解決", "URL_NOT_FOUND", "URL_CACHE_BAD_ROW", "URL_AMBIGUOUS", "AMBIGUOUS"].includes(row["判定"])) {
          continue;
        }

        const name = cleanTournamentName(row["大会名"]);
        log(`URL検索 ${i + 1}/${candidates.length}: ${name}`);

        let found = null;
        let source = "";

        try {
          found = await searchTournamentInListWindow(closedWin, name);
          source = "closed";
        } catch (e) {
          console.warn("closed search error", e);
        }

        if (!found) {
          try {
            found = await searchTournamentInListWindow(openWin, name);
            source = "open";
          } catch (e) {
            console.warn("open search error", e);
          }
        }

        if (!found) {
          row["USE"] = "";
          row["判定"] = "URL_NOT_FOUND";
          row["理由"] = "OPEN/CLOSED大会一覧検索で見つかりません";
          ngCount++;
          continue;
        }

        if (found.error === "AMBIGUOUS") {
          row["USE"] = "";
          row["判定"] = "AMBIGUOUS";
          row["理由"] = `${found.candidates.length} candidates`;
          ambiguousCount++;
          console.table(found.candidates);
          continue;
        }

        row["USE"] = "1";
        row["TournamentId"] = found.tournamentId;
        row["URL"] = found.url;
        row["判定"] = source === "closed" ? "OK_SEARCH_CLOSED" : "OK_SEARCH_OPEN";
        row["理由"] = "";

        setSharedCacheItem(name, {
          tournamentId: found.tournamentId,
          url: found.url,
          actualName: found.actualName || name,
          matchedRow: found.matchedRow || "",
          source: `ticket-link-v1.0-${source}`
        });

        okCount++;
      }

      setCandidateRows(candidates);

      alert(
        `URL検索完了\n\n` +
        `OK: ${okCount}\n` +
        `NOT_FOUND: ${ngCount}\n` +
        `AMBIGUOUS: ${ambiguousCount}`
      );

      log("URL検索完了");

    } catch (e) {
      console.error(e);
      alert("ERROR: " + (e.message || String(e)));
      warn("ERROR:", e.message || e);

    } finally {
      try { if (closedWin && !closedWin.closed) closedWin.close(); } catch (_) {}
      try { if (openWin && !openWin.closed) openWin.close(); } catch (_) {}
      running = false;
      stopRequested = false;
    }
  }

  // ============================================================
  // Ticket Link Direct
  // ============================================================

  function normalizeTicketText(s) {
    return norm(s)
      .replace(/\s+/g, " ")
      .trim();
  }

  function compactTicketText(s) {
    return normalizeTicketText(s)
      .replace(/\s+/g, "")
      .toLowerCase();
  }

  function stripNationalPrefix(s) {
    return normalizeTicketText(s)
      .replace(/^ナショナルチケット\s*-\s*/i, "")
      .trim();
  }

  function getTicketLinkFormDirect() {
    const form =
      document.querySelector('form[action*="vincular_grupos_vagas"]') ||
      [...document.querySelectorAll("form")].find(f => {
        const html = f.innerHTML || "";
        return html.includes("grupo_vagas") && html.includes("id_torneio");
      });

    if (!form) throw new Error("Ticket Link form not found");

    const select = form.querySelector('select[name="grupo_vagas"]');
    if (!select) throw new Error("select[name='grupo_vagas'] not found");

    const codbloq = form.querySelector('[name="codbloq"]')?.value || document.querySelector('[name="codbloq"]')?.value || "";
    const idTorneio =
      form.querySelector('[name="id_torneio"]')?.value ||
      getCurrentTournamentIdFromUrl() ||
      "";

    if (!codbloq) throw new Error("codbloq not found");
    if (!idTorneio) throw new Error("id_torneio not found");

    return { form, select, codbloq, idTorneio };
  }

  function getTicketOptions(select) {
    return [...select.querySelectorAll("option")]
      .map((o, i) => ({
        i,
        value: norm(o.value),
        text: normalizeTicketText(o.innerText || o.textContent || "")
      }))
      .filter(x => x.value && x.text)
      .filter(x => /^tn_\d+$/i.test(x.value));
  }

  function findTicketOptionStrict(select, ticketName) {
    const target = normalizeTicketText(ticketName);
    const targetNoPrefix = stripNationalPrefix(target);
    const targetWithPrefix = /^ナショナルチケット\s*-\s*/i.test(target)
      ? target
      : `ナショナルチケット - ${target}`;

    const options = getTicketOptions(select);

    if (!options.length) {
      throw new Error("TICKET_OPTION_EMPTY: tn_ option がありません / tn_ ticket option 为空");
    }

    const exact = options.filter(x => x.text === target);
    if (exact.length === 1) return { option: exact[0], matchType: "EXACT" };
    if (exact.length > 1) {
      console.table(exact);
      throw new Error(`TICKET_AMBIGUOUS_EXACT: ${ticketName}`);
    }

    const exactWithPrefix = options.filter(x => x.text === targetWithPrefix);
    if (exactWithPrefix.length === 1) return { option: exactWithPrefix[0], matchType: "EXACT_WITH_PREFIX" };
    if (exactWithPrefix.length > 1) {
      console.table(exactWithPrefix);
      throw new Error(`TICKET_AMBIGUOUS_EXACT_WITH_PREFIX: ${ticketName}`);
    }

    const compactTarget = compactTicketText(target);
    const compactTargetWithPrefix = compactTicketText(targetWithPrefix);
    const compactNoPrefix = compactTicketText(targetNoPrefix);

    const compactMatches = options.filter(x => {
      const opt = compactTicketText(x.text);
      const optNoPrefix = compactTicketText(stripNationalPrefix(x.text));
      return opt === compactTarget ||
        opt === compactTargetWithPrefix ||
        optNoPrefix === compactNoPrefix;
    });

    if (compactMatches.length === 1) return { option: compactMatches[0], matchType: "COMPACT_EXACT" };
    if (compactMatches.length > 1) {
      console.table(compactMatches);
      throw new Error(`TICKET_AMBIGUOUS_COMPACT: ${ticketName}`);
    }

    const includeMatches = options.filter(x => {
      const opt = compactTicketText(x.text);
      return opt.includes(compactTarget) ||
        opt.includes(compactTargetWithPrefix) ||
        opt.includes(compactNoPrefix);
    });

    if (includeMatches.length === 1) return { option: includeMatches[0], matchType: "INCLUDES_UNIQUE_WARN" };

    if (includeMatches.length > 1) {
      console.table(includeMatches);
      throw new Error(`TICKET_AMBIGUOUS_INCLUDE: ${ticketName}`);
    }

    console.table(options);
    throw new Error(`TICKET_NOT_FOUND: ${ticketName}`);
  }

  async function postTicketLinkDirect(ticketName, optionValue) {
    const { form, codbloq, idTorneio } = getTicketLinkFormDirect();

    const fd = new FormData();
    fd.set("grupo_vagas", optionValue);
    fd.set("codbloq", codbloq);
    fd.set("id_torneio", idTorneio);

    console.log("[PW-TICKET-LINK] link payload");
    for (const [k, v] of fd.entries()) {
      console.log(k, "=", v);
    }

    const res = await fetch(form.action || "/cb/torneio/abas/configuracao/vincular_grupos_vagas", {
      method: "POST",
      body: fd,
      credentials: "same-origin",
      redirect: "follow"
    });

    return res;
  }

  function getPageTournamentTitle() {
    const input = document.querySelector('input[name="titulo_torneio"]');
    if (input && input.value) return cleanTournamentName(input.value);

    const candidates = [
      document.querySelector("h1"),
      document.querySelector("h2"),
      document.querySelector(".page-title"),
      document.querySelector(".box-title"),
      document.querySelector(".panel-title"),
      document.querySelector(".breadcrumb"),
      document.querySelector(".content-header")
    ];

    for (const el of candidates) {
      const text = cleanTournamentName(el?.innerText || el?.textContent || "");
      if (text.includes("【") && text.includes("】")) return text;
    }

    const title = cleanTournamentName(document.title || "");
    const m = title.match(/(.+?)\s*-\s*PokerWeb/i);
    if (m) return cleanTournamentName(m[1]);

    const body = norm(document.body?.innerText || "");
    const m2 = body.match(/(【[^】]+】\s*(?:#\d+[A-Za-z]?|\(s\d+\)|s\d+)\s+[^ \n\r\t]+)/i);
    if (m2) return cleanTournamentName(m2[1]);

    return title;
  }

  function verifyCurrentPageMatchesExpected(expectedName) {
    const actual = getPageTournamentTitle();

    if (!actual) {
      throw new Error(`PAGE_TITLE_EMPTY: expected=${expectedName}`);
    }

    if (!isSameTournamentExactSafe(expectedName, actual)) {
      throw new Error(`PAGE_TITLE_MISMATCH: expected=${expectedName} / actual=${actual}`);
    }

    return actual;
  }

  // ============================================================
  // Execute Flow
  // ============================================================

  function parseTicketListFromCandidate(row) {
    return String(row["Ticket一覧"] || "")
      .split("|")
      .map(norm)
      .filter(Boolean);
  }

  function isSafeUrlStatus(status) {
    return ["OK_CACHE", "OK_SEARCH_CLOSED", "OK_SEARCH_OPEN", "OK_MANUAL"].includes(norm(status));
  }

  function getFlowState() {
    try {
      return JSON.parse(sessionStorage.getItem(CONFIG.flowKey) || "{}");
    } catch (_) {
      return {};
    }
  }

  function setFlowState(state) {
    sessionStorage.setItem(CONFIG.flowKey, JSON.stringify(state));
  }

  function clearFlowState() {
    sessionStorage.removeItem(CONFIG.flowKey);
  }

  function setReportText(text) {
    const box = document.querySelector("#pw-ticket-link-report");
    if (box) box.value = text;
    localStorage.setItem(CONFIG.reportKey, text);
  }

  function appendReportLine(line) {
    const box = document.querySelector("#pw-ticket-link-report");
    const old = box?.value || localStorage.getItem(CONFIG.reportKey) || "";
    const text = old ? `${old}\n${line}` : line;
    setReportText(text);
  }

  function prepareExecutionRows() {
    const rows = getUseCandidateRows();

    if (!rows.length) {
      throw new Error("USE=1 の候補行がありません");
    }

    const unsafe = rows.filter(r => !isSafeUrlStatus(r["判定"]));
    if (unsafe.length) {
      throw new Error(`URLが安全確定していない候補があります：${unsafe.length}件。URL検索または候補欄修正後に再実行してください。`);
    }

    const usable = rows.filter(r => r["大会名"] && r["TournamentId"] && r["URL"] && parseTicketListFromCandidate(r).length > 0);

    if (!usable.length) {
      throw new Error("使用可能な候補がありません。TournamentId / URL / Ticket一覧 を確認してください。");
    }

    return usable;
  }

  function startExecuteLink() {
    if (running) {
      alert("処理中です");
      return;
    }

    let rows;

    try {
      rows = prepareExecutionRows();
    } catch (e) {
      alert("ERROR: " + (e.message || String(e)));
      return;
    }

    const ticketTotal = rows.reduce((sum, r) => sum + parseTicketListFromCandidate(r).length, 0);

    const summary = rows.map((r, i) => {
      return `${i + 1}. ${r["大会名"]}\n   Tickets=${parseTicketListFromCandidate(r).length} / URL=${r["URL"]}`;
    }).join("\n\n");

    const ok = confirm(
      `Ticket Linkを開始しますか？\n\n` +
      `大会数：${rows.length}\n` +
      `Ticket Link予定数：${ticketTotal}\n\n` +
      `この版はConfigタブ/Modalをクリックせず、詳細ページDOM内のhidden formを直接使用します。\n` +
      `Ticket optionは value=tn_ のものだけを対象にします。\n\n` +
      `${summary}`
    );

    if (!ok) return;

    running = true;
    stopRequested = false;

    const startReport = [
      `[${nowText()}] START  Ticket Link実行`,
      `大会数=${rows.length} / Ticket Link予定数=${ticketTotal}`,
      ""
    ].join("\n");

    setReportText(startReport);

    const state = {
      running: true,
      rowIndex: 0,
      ticketIndex: 0,
      rows
    };

    setFlowState(state);

    runExecuteCurrentStep();
  }

  async function runExecuteCurrentStep() {
    const state = getFlowState();

    if (!state.running) return;

    if (stopRequested) {
      appendReportLine(`[${nowText()}] STOP_REQUESTED`);
      state.running = false;
      setFlowState(state);
      return;
    }

    const rows = state.rows || [];
    const rowIndex = Number(state.rowIndex || 0);

    if (rowIndex >= rows.length) {
      appendReportLine(`[${nowText()}] DONE  全大会Ticket Link完了`);
      clearFlowState();
      running = false;
      stopRequested = false;
      log("全部完成");
      alert("Ticket Link 全部完成。Reportを確認してください。");
      return;
    }

    const row = rows[rowIndex];
    const tickets = parseTicketListFromCandidate(row);
    const ticketIndex = Number(state.ticketIndex || 0);

    try {
      const expectedName = cleanTournamentName(row["大会名"]);
      const expectedUrl = row["URL"] || getTournamentUrl(row["TournamentId"]);

      if (!isPainelPage() || getCurrentTournamentIdFromUrl() !== String(row["TournamentId"])) {
        appendReportLine(`[${nowText()}] MOVE  ${rowIndex + 1}/${rows.length} ${expectedName} → ${expectedUrl}`);
        location.href = expectedUrl;
        return;
      }

      await sleep(CONFIG.afterPageLoadMs);

      const actualTitle = verifyCurrentPageMatchesExpected(expectedName);
      const { select } = getTicketLinkFormDirect();

      if (ticketIndex >= tickets.length) {
        appendReportLine(`[${nowText()}] TASK_OK  ${expectedName} / ${tickets.length} tickets 完了`);
        state.rowIndex = rowIndex + 1;
        state.ticketIndex = 0;
        setFlowState(state);

        await sleep(CONFIG.betweenTournamentsMs);
        runExecuteCurrentStep();
        return;
      }

      const ticketName = tickets[ticketIndex];
      log(`LINK ${rowIndex + 1}/${rows.length} ticket ${ticketIndex + 1}/${tickets.length}: ${ticketName}`);

      const found = findTicketOptionStrict(select, ticketName);
      const res = await postTicketLinkDirect(ticketName, found.option.value);

      appendReportLine(
        `[${nowText()}] LINK_OK  ${expectedName} / actual=${actualTitle} / ticket=${ticketName} / value=${found.option.value} / match=${found.matchType} / status=${res.status}`
      );

      state.ticketIndex = ticketIndex + 1;
      setFlowState(state);

      await sleep(CONFIG.betweenTicketsMs);
      runExecuteCurrentStep();

    } catch (e) {
      console.error("[PW-TICKET-LINK] execute error", e);
      appendReportLine(`[${nowText()}] ERROR  row=${rowIndex + 1} ticket=${ticketIndex + 1} / ${row?.["大会名"] || ""} / ${e.message || e}`);
      warn("失敗:", e.message || e);

      state.running = false;
      setFlowState(state);
      running = false;
      stopRequested = false;

      alert("ERROR: " + (e.message || String(e)) + "\n\n状態は残しています。ReportとConsoleを確認してください。");
    }
  }

  function stopRun() {
    stopRequested = true;
    running = false;
    clearFlowState();
    log("停止しました。状態をクリアしました。");
  }

  // ============================================================
  // UI Actions
  // ============================================================

  function copyCandidates() {
    copyText(getCandidateText());
    alert("Candidates TSVをコピーしました。");
  }

  function copyReport() {
    const text = document.querySelector("#pw-ticket-link-report")?.value || localStorage.getItem(CONFIG.reportKey) || "";
    copyText(text);
    alert("Reportをコピーしました。");
  }

  function copySharedCache() {
    const text = cacheToTsv();
    copyText(text);
    alert(`共有URL Cache TSVをコピーしました。\n件数：${cacheToRows().length}`);
  }

  function clearInputs() {
    const ok = confirm(
      "入力欄・Candidates・Reportをクリアしますか？\n\n" +
      "保存済み入力内容も削除します。"
    );

    if (!ok) return;

    ["#pw-ticket-link-tournaments", "#pw-ticket-link-simple-tickets", "#pw-ticket-link-rules", "#pw-ticket-link-overrides", "#pw-ticket-link-candidates", "#pw-ticket-link-report"].forEach(sel => {
      const el = document.querySelector(sel);
      if (el) el.value = "";
    });

    localStorage.removeItem(CONFIG.tournamentInputKey);
    localStorage.removeItem(CONFIG.simpleTicketInputKey);
    localStorage.removeItem(CONFIG.matrixInputKey);
    localStorage.removeItem(CONFIG.overrideInputKey);
    localStorage.removeItem(CONFIG.candidateKey);
    localStorage.removeItem(CONFIG.reportKey);

    log("入力欄をクリアしました");
  }

  function updateModeUI() {
    const mode = getCurrentMode();

    const simpleBlock = document.querySelector("#pw-ticket-link-simple-block");
    const detailBlock = document.querySelector("#pw-ticket-link-detail-block");
    const modeNote = document.querySelector("#pw-ticket-link-mode-note");

    if (simpleBlock) simpleBlock.style.display = mode === "simple" ? "block" : "none";
    if (detailBlock) detailBlock.style.display = mode === "detail" ? "block" : "none";

    if (modeNote) {
      modeNote.textContent = mode === "simple"
        ? "簡単モード：全大会に同じTicketをLinkします / 简单模式：所有比赛Link同一批Ticket"
        : "詳細モード：TicketLink用ルール表のTRUEから判定します / 详细模式：根据TicketLink用规则表的TRUE判断";
    }

    localStorage.setItem(CONFIG.modeKey, mode);
  }

  // ============================================================
  // Panel
  // ============================================================

  function addPanel() {
    if (document.querySelector("#pw-ticket-link-panel")) return;

    const savedMode = localStorage.getItem(CONFIG.modeKey) || "simple";
    const savedTournaments = localStorage.getItem(CONFIG.tournamentInputKey) || "";
    const savedSimpleTickets = localStorage.getItem(CONFIG.simpleTicketInputKey) || "";
    const savedMatrix = localStorage.getItem(CONFIG.matrixInputKey) || "";
    const savedOverrides = localStorage.getItem(CONFIG.overrideInputKey) || "";
    const savedCandidates = localStorage.getItem(CONFIG.candidateKey) || CANDIDATE_HEADERS.join("\t");
    const savedReport = localStorage.getItem(CONFIG.reportKey) || "";

    const panel = document.createElement("div");
    panel.id = "pw-ticket-link-panel";

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
      width: 760px;
      max-height: 94vh;
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="font-weight:bold;">PW Ticket Link 人工確認版 v1.0</div>
        <div style="display:flex;gap:4px;">
          <button id="pw-ticket-link-minimize" style="font-size:11px;padding:2px 6px;cursor:pointer;">Min</button>
          <button id="pw-ticket-link-close" style="font-size:11px;padding:2px 6px;cursor:pointer;">x</button>
        </div>
      </div>

      <div id="pw-ticket-link-body" style="overflow-y:auto;padding-right:2px;">
        <div style="font-size:11px;color:#ccc;line-height:1.35;margin-bottom:6px;">
          流れ：候補作成 → URL未解決検索 → USE候補でTicket Link実行<br>
          URLは完整大会名で厳密照合。Ticket optionは value=tn_ のみ対象。Config/Modalクリックなし。
        </div>

        <div style="border:1px solid #555;border-radius:8px;padding:8px;margin-bottom:8px;background:#2a2a2a;">
          <div style="font-weight:bold;margin-bottom:5px;">処理モード / 处理模式</div>

          <label style="display:block;margin-bottom:4px;cursor:pointer;">
            <input type="radio" name="pw-ticket-link-mode" value="simple" ${savedMode === "simple" ? "checked" : ""}>
            簡単モード / 简单模式：全大会に同じTicketをLink
          </label>

          <label style="display:block;cursor:pointer;">
            <input type="radio" name="pw-ticket-link-mode" value="detail" ${savedMode === "detail" ? "checked" : ""}>
            詳細モード / 详细模式：TicketLink用ルール表から判定
          </label>

          <div id="pw-ticket-link-mode-note" style="font-size:11px;color:#f6d365;margin-top:6px;line-height:1.35;"></div>
        </div>

        <div style="font-size:12px;font-weight:bold;color:#fff;margin-bottom:3px;">
          1. 大会名入力欄 / 比赛名框：1行につき1大会
        </div>
        <textarea id="pw-ticket-link-tournaments"
          placeholder="例：
【SPADIE Season 41st】#01 NLH Main Event Day 1A
【SPADIE Season 41st】#05 NLH Sugar Rush Sponsored by Timee"
          style="width:100%;height:86px;background:#111;color:#fff;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

        <div id="pw-ticket-link-simple-block" style="margin-top:8px;">
          <div style="font-size:12px;font-weight:bold;color:#fff;margin-bottom:3px;">
            2. Ticket名入力欄 / Ticket名框：全大会にLinkするTicket
          </div>
          <textarea id="pw-ticket-link-simple-tickets"
            placeholder="例：
【SPADIE Season 41st】Main Event / -2026.05.31
JOPT 2026 Osaka #02 / Main Event / -2027.09.30"
            style="width:100%;height:90px;background:#111;color:#fff;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>
        </div>

        <div id="pw-ticket-link-detail-block" style="margin-top:8px;">
          <div style="font-size:12px;font-weight:bold;color:#fff;margin-bottom:3px;">
            2. TicketLink用ルール表 / TicketLink规则表
          </div>
          <textarea id="pw-ticket-link-rules"
            placeholder="Sheetから、チケット名称列 + #01/#01A/s01列を含めて貼り付け"
            style="width:100%;height:125px;background:#111;color:#fff;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

          <div style="font-size:12px;font-weight:bold;color:#fff;margin-top:6px;margin-bottom:3px;">
            3. 手動修正 / 手动修正：大会名キーワード[TAB]修正Key
          </div>
          <textarea id="pw-ticket-link-overrides"
            placeholder="例：
Main Event Day 1A	#01A
Satellite	s01"
            style="width:100%;height:60px;background:#111;color:#fff;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>
        </div>

        <div style="display:flex;gap:6px;margin-top:8px;">
          <button id="pw-ticket-link-build" style="flex:1;padding:7px;cursor:pointer;background:#ffe08a;border:1px solid #c99;">1. 候補作成</button>
          <button id="pw-ticket-link-resolve" style="flex:1;padding:7px;cursor:pointer;background:#d9ecff;border:1px solid #88a;">2. URL未解決検索</button>
          <button id="pw-ticket-link-execute" style="flex:1;padding:7px;cursor:pointer;background:#bff0c2;border:1px solid #8a8;">3. USE候補でLink実行</button>
        </div>

        <div style="display:flex;gap:6px;margin-top:6px;">
          <button id="pw-ticket-link-stop" style="flex:1;padding:7px;cursor:pointer;background:#f3cccc;border:1px solid #c88;">Stop / Clear State</button>
          <button id="pw-ticket-link-copy-candidates" style="flex:1;padding:7px;cursor:pointer;background:#eee;border:1px solid #aaa;">Copy Candidates</button>
          <button id="pw-ticket-link-copy-cache" style="flex:1;padding:7px;cursor:pointer;background:#eee;border:1px solid #aaa;">Copy Shared URL Cache</button>
        </div>

        <div style="font-size:12px;font-weight:bold;margin-top:6px;">Candidates / 候補確認欄</div>
        <textarea id="pw-ticket-link-candidates"
          style="width:100%;height:160px;background:#111;color:#fff;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

        <div style="font-size:12px;font-weight:bold;margin-top:6px;">Report</div>
        <textarea id="pw-ticket-link-report"
          readonly
          style="width:100%;height:145px;background:#111;color:#9fe;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

        <div style="display:flex;gap:6px;margin-top:6px;">
          <button id="pw-ticket-link-copy-report" style="flex:1;padding:7px;cursor:pointer;background:#eee;border:1px solid #aaa;">Copy Report</button>
          <button id="pw-ticket-link-clear" style="flex:1;padding:7px;cursor:pointer;background:#eee;border:1px solid #aaa;">Clear Inputs</button>
        </div>

        <div id="pw-ticket-link-status" style="font-size:11px;color:#9fe;line-height:1.35;white-space:pre-wrap;margin-top:6px;">ready</div>
      </div>
    `;

    document.body.appendChild(panel);

    document.querySelector("#pw-ticket-link-tournaments").value = savedTournaments;
    document.querySelector("#pw-ticket-link-simple-tickets").value = savedSimpleTickets;
    document.querySelector("#pw-ticket-link-rules").value = savedMatrix;
    document.querySelector("#pw-ticket-link-overrides").value = savedOverrides;
    document.querySelector("#pw-ticket-link-candidates").value = savedCandidates;
    document.querySelector("#pw-ticket-link-report").value = savedReport;

    document.querySelectorAll('input[name="pw-ticket-link-mode"]').forEach(el => {
      el.onchange = () => updateModeUI();
    });

    document.querySelector("#pw-ticket-link-build").onclick = () => previewBuildCandidates();
    document.querySelector("#pw-ticket-link-resolve").onclick = () => resolveUrlForCandidates();
    document.querySelector("#pw-ticket-link-execute").onclick = () => startExecuteLink();
    document.querySelector("#pw-ticket-link-stop").onclick = () => stopRun();
    document.querySelector("#pw-ticket-link-copy-candidates").onclick = () => copyCandidates();
    document.querySelector("#pw-ticket-link-copy-cache").onclick = () => copySharedCache();
    document.querySelector("#pw-ticket-link-copy-report").onclick = () => copyReport();
    document.querySelector("#pw-ticket-link-clear").onclick = () => clearInputs();

    document.querySelector("#pw-ticket-link-minimize").onclick = () => {
      const body = document.querySelector("#pw-ticket-link-body");
      const btn = document.querySelector("#pw-ticket-link-minimize");
      if (!body || !btn) return;

      const hidden = body.style.display === "none";
      body.style.display = hidden ? "block" : "none";
      btn.textContent = hidden ? "Min" : "Open";
    };

    document.querySelector("#pw-ticket-link-close").onclick = () => {
      const p = document.querySelector("#pw-ticket-link-panel");
      if (p) p.style.display = "none";
    };

    updateModeUI();
    log(`ready / Shared URL Cache: ${cacheToRows().length}件`);
  }

  function boot() {
    addPanel();

    window.PWTicketLinkManualV10 = {
      previewBuildCandidates,
      resolveUrlForCandidates,
      startExecuteLink,
      runExecuteCurrentStep,
      stopRun,
      loadSharedCache,
      saveSharedCache,
      setSharedCacheItem,
      cacheToTsv,
      getTicketLinkFormDirect,
      findTicketOptionStrict
    };

    setTimeout(() => {
      const state = getFlowState();

      if (state.running) {
        running = true;
        runExecuteCurrentStep();
      } else {
        log(`ready / Shared URL Cache: ${cacheToRows().length}件`);
      }
    }, 1200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
