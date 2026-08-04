// ==UserScript==
// @name         PW Ticket Link Semi Auto
// @namespace    pw-ticket-link-semi-auto
// @version      1.1.1
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-ticket-link-semi-auto.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-ticket-link-semi-auto.user.js
// @description  TicketLink用ルール表から候補作成 → URL確認 → 独立大会workerで后台Ticket Link実行。大会内は逐次処理、Ticket optionはtn_のみ。通信段階/worker耗时をReport出力。
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
    forceUrlInputKey: "PW_TICKET_LINK_MANUAL_V10_FORCE_URL",
    candidateKey: "PW_TICKET_LINK_MANUAL_V10_CANDIDATES",
    reportKey: "PW_TICKET_LINK_MANUAL_V10_REPORT",
    flowKey: "PW_TICKET_LINK_MANUAL_V10_FLOW",

    maxConcurrentTournaments: 10,
    searchWaitTimeoutMs: 10000,
    searchPollMs: 350,
    afterSearchMs: 250,
    afterPageLoadMs: 0,
    betweenTicketsMs: 120,
    betweenTournamentsMs: 180,

    blockStartOnSuspiciousRows: true,
    previewTicketDisplayLimit: 30
  };

  const CANDIDATE_HEADERS = [
    "本次处理",
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

  function monotonicNowMs() {
    return typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  }

  function elapsedMs(startMs) {
    return Math.max(0, Math.round(monotonicNowMs() - startMs));
  }

  function formatDurationMs(value) {
    const ms = Math.max(0, Number(value) || 0);
    if (ms < 60000) return `${(ms / 1000).toFixed(3)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(3).padStart(6, "0");
    return `${minutes}m${seconds}s`;
  }

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
      .replace(/監査(?:済み|待ち)/g, "")
      .toLowerCase();
  }

  function cleanTournamentName(name) {
    return String(name || "")
      .replace(/\s*-\s*PokerWeb\s*$/i, "")
      .replace(/\s*監査(?:済み|待ち)\s*$/g, "")
      .trim();
  }

  function nowText() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
  }

  function configuredConcurrency() {
    const value = Number(CONFIG.maxConcurrentTournaments);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`CONFIG.maxConcurrentTournaments must be a positive integer: ${CONFIG.maxConcurrentTournaments}`);
    }
    return value;
  }

  function log(...args) {
    console.log("[PW-TICKET-LINK-v1.1.1]", ...args);
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

  function replaceSharedCacheItemForName(name, data) {
    const cleanName = cleanTournamentName(name);
    if (!cleanName) return [];

    const cache = loadSharedCache();
    const removed = [];

    for (const [key, item] of Object.entries(cache)) {
      const itemName = cleanTournamentName(item?.name || item?.Name || "");
      const actualName = cleanTournamentName(item?.actualName || item?.Actual_Name || "");
      if (!isSameTournamentExactSafe(itemName, cleanName) && !isSameTournamentExactSafe(actualName, cleanName)) continue;
      removed.push(String(item?.tournamentId || item?.TournamentId || extractTournamentIdFromUrl(item?.url || item?.URL || "") || ""));
      delete cache[key];
    }

    saveSharedCache(cache);
    setSharedCacheItem(cleanName, data);
    return uniqueArray(removed);
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
        "本次处理": cache ? "使用" : "不使用",
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
    rows.forEach(row => {
      const old = norm(row["本次处理"] || row["USE"]);
      row["本次处理"] = old === "使用" || old === "1" || old.toUpperCase() === "TRUE" || old.toUpperCase() === "Y" ? "使用" : "不使用";
      delete row["USE"];
    });
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
      const use = norm(row["本次处理"] || row["USE"]);
      return use === "使用" || use === "1" || use.toUpperCase() === "TRUE" || use.toUpperCase() === "Y" || use === "〇" || use === "○";
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

  function extractTournamentFromRow(row) {
    const rowText = norm(row.innerText || "");
    const rowHtml = row.innerHTML || "";
    const actualName = extractTournamentTitleFromRow(rowText);
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

  function getDataTablePageInfo(dt) {
    try {
      return dt?.page?.info?.() || null;
    } catch (_) {
      return null;
    }
  }

  async function goDataTablePageAndWait(win, dt, pageIndex) {
    if (!dt) throw new Error("DataTable not found");
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
    await sleep(120);

    const info = getDataTablePageInfo(dt);
    if (info.page !== pageIndex) {
      throw new Error(`DataTable page mismatch expected=${pageIndex + 1} actual=${info.page + 1}`);
    }
    return true;
  }

  function collectUrlPoolFromCurrentPage(win, dt, prefix, source) {
    const rows = getDataTableTbodyRows(win, dt);
    const out = [];
    const compactPrefix = compact(prefix);

    for (const row of rows) {
      const found = extractTournamentFromRow(row);
      if (!found) continue;

      const hay = `${found.actualName || ""} ${found.matchedRow || ""}`;
      if (!hay.includes(prefix) && !compact(hay).includes(compactPrefix)) continue;
      out.push({ ...found, source });
    }

    return out;
  }

  async function collectUrlPoolInWindow(win, label, prefix) {
    const dt = await waitForDataTableReadyInWindow(win, 15000);
    if (!dt) throw new Error(`${label}: DataTable not found`);

    await dataTableSearchAndWait(win, dt, prefix);
    const info = getDataTablePageInfo(dt);
    const pages = info && info.pages ? info.pages : 1;
    const found = [];
    const seen = new Set();

    for (let page = 0; page < pages; page++) {
      if (stopRequested) break;
      if (page > 0) await goDataTablePageAndWait(win, dt, page);

      const rows = collectUrlPoolFromCurrentPage(win, dt, prefix, label);
      log(`URL pool ${label} ${prefix} page ${page + 1}/${pages}: ${rows.length}`);

      for (const row of rows) {
        if (!row.url || seen.has(row.url)) continue;
        seen.add(row.url);
        found.push(row);
      }
    }

    return found;
  }

  function matchUrlPoolByName(pool, name) {
    const cleanName = cleanTournamentName(name);
    const matches = (pool || []).filter(row => isSameTournamentExactSafe(cleanName, row.actualName));
    const seen = new Set();
    const unique = matches.filter(row => {
      const key = row.tournamentId || row.url;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (unique.length === 1) return unique[0];
    if (unique.length > 1) return { error: "AMBIGUOUS", candidates: unique };
    return null;
  }

  function getPrefixesForUrlPool(rows) {
    return uniqueArray((rows || [])
      .map(row => getEventPrefixFromTournamentName(row["大会名"]))
      .filter(Boolean));
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

    const prefixes = getPrefixesForUrlPool(targets);

    if (!prefixes.length) {
      alert("Event Prefix を認識できません。URL ManagerでURLを補完するか、CandidatesにURL/TournamentIdを貼ってください。");
      return;
    }

    if (!confirm(
      `URL未解決・疑似汚染候補を URL pool 方式で検索します。\n\n` +
      `対象：${targets.length}件\n` +
      `Event Prefix：${prefixes.join(" / ")}\n` +
      `検索：OPEN / CLOSED 両方をPrefix単位で一括収集\n\n` +
      `続行しますか？`
    )) return;

    running = true;
    stopRequested = false;

    let closedWin = null;
    let openWin = null;
    let okCount = 0;
    let ngCount = 0;
    let ambiguousCount = 0;
    const pool = [];

    try {
      log("CLOSED大会一覧を開いています...");
      closedWin = await openTournamentListWindow("/cb/torneio/fechados", "closed");

      log("OPEN大会一覧を開いています...");
      openWin = await openTournamentListWindow("/cb/torneio/abertos", "open");

      const poolSeen = new Set();
      for (const prefix of prefixes) {
        if (stopRequested) break;
        log(`URL pool scan: ${prefix}`);

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
            console.warn(`${item.label} pool search error`, e);
          }
        }
      }

      log(`URL pool collected: ${pool.length}`);

      for (let i = 0; i < candidates.length; i++) {
        if (stopRequested) break;

        const row = candidates[i];
        if (!row["大会名"]) continue;

        if (row["TournamentId"] && row["URL"] && !["URL未解決", "URL_NOT_FOUND", "URL_CACHE_BAD_ROW", "URL_AMBIGUOUS", "AMBIGUOUS"].includes(row["判定"])) {
          continue;
        }

        const name = cleanTournamentName(row["大会名"]);
        log(`URL pool match ${i + 1}/${candidates.length}: ${name}`);

        const found = matchUrlPoolByName(pool, name);

        if (!found) {
          row["本次处理"] = "不使用";
          row["判定"] = "URL_NOT_FOUND";
          row["理由"] = "URL poolに完全一致がありません";
          ngCount++;
          continue;
        }

        if (found.error === "AMBIGUOUS") {
          row["本次处理"] = "不使用";
          row["判定"] = "AMBIGUOUS";
          row["理由"] = `${found.candidates.length} candidates`;
          ambiguousCount++;
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
          source: `ticket-link-v1.0-pool-${found.source || "unknown"}`
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

  function parseForcedUrlRows(raw) {
    const rows = [];
    const errors = [];

    splitNonEmptyLines(raw).forEach((line, index) => {
      const cols = splitTSVLine(line).map(norm);
      const urlIndex = cols.findIndex(value => extractTournamentIdFromUrl(value));

      if (urlIndex < 0) {
        errors.push(`第${index + 1}行に有効な大会URLがありません: ${line}`);
        return;
      }

      const tournamentId = extractTournamentIdFromUrl(cols[urlIndex]);
      const name = cleanTournamentName(cols.find((value, colIndex) => colIndex !== urlIndex && value) || "");
      rows.push({
        lineNo: index + 1,
        name,
        tournamentId,
        url: getTournamentUrl(tournamentId)
      });
    });

    return { rows, errors };
  }

  async function forceSetTournamentUrls() {
    if (running) {
      alert("処理中です");
      return;
    }

    const input = document.querySelector("#pw-ticket-link-force-url")?.value || "";
    const parsed = parseForcedUrlRows(input);
    if (parsed.errors.length) {
      alert(`強制URL入力エラー\n\n${parsed.errors.join("\n")}`);
      return;
    }
    if (!parsed.rows.length) {
      alert("強制設定する大会URLを入力してください。");
      return;
    }

    const candidates = getCandidateRows();
    if (!candidates.length) {
      alert("Candidates が空です。先に候補作成してください。");
      return;
    }

    running = true;
    const prepared = [];
    const usedCandidateIndexes = new Set();

    try {
      for (const forced of parsed.rows) {
        let matches = [];
        if (forced.name) {
          matches = candidates
            .map((row, candidateIndex) => ({ row, candidateIndex }))
            .filter(item => isSameTournamentExactSafe(forced.name, item.row["大会名"]));
        } else if (candidates.length === 1) {
          matches = [{ row: candidates[0], candidateIndex: 0 }];
        } else {
          throw new Error(`第${forced.lineNo}行: Candidates が複数あるため、比赛名[TAB]URL で指定してください。`);
        }

        if (matches.length !== 1) {
          throw new Error(`第${forced.lineNo}行: Candidate一致件数=${matches.length}。比赛名を確認してください: ${forced.name || "(空)"}`);
        }

        const { row, candidateIndex } = matches[0];
        if (usedCandidateIndexes.has(candidateIndex)) {
          throw new Error(`第${forced.lineNo}行: 同じCandidateが複数回指定されています: ${row["大会名"]}`);
        }
        usedCandidateIndexes.add(candidateIndex);

        log(`強制URL確認 ${prepared.length + 1}/${parsed.rows.length}: ${forced.url}`);
        const doc = await fetchTicketLinkPage(forced.url);
        const actualName = getPageTournamentTitleFromDoc(doc);
        if (!actualName) {
          throw new Error(`第${forced.lineNo}行: PAGE_TITLE_EMPTY ${forced.url}`);
        }
        if (!isSameTournamentExactSafe(row["大会名"], actualName)) {
          throw new Error(`第${forced.lineNo}行: PAGE_TITLE_MISMATCH expected=${row["大会名"]} / actual=${actualName}`);
        }

        const formInfo = getTicketLinkFormFromDoc(doc, forced.tournamentId);
        if (String(formInfo.idTorneio) !== String(forced.tournamentId)) {
          throw new Error(`第${forced.lineNo}行: TOURNAMENT_ID_MISMATCH URL=${forced.tournamentId} / PAGE=${formInfo.idTorneio}`);
        }

        prepared.push({
          row,
          candidateIndex,
          name: cleanTournamentName(row["大会名"]),
          actualName,
          tournamentId: forced.tournamentId,
          url: forced.url,
          oldTournamentId: norm(row["TournamentId"] || "")
        });
      }

      const details = prepared.map((item, index) =>
        `${index + 1}. ${item.name}\n   旧ID: ${item.oldTournamentId || "(なし)"}\n   新ID: ${item.tournamentId}\n   URL: ${item.url}`
      ).join("\n\n");

      if (!confirm(
        `以下のURLを強制設定します。\nCandidatesを上書きし、同名の旧Shared Cacheを削除して新URLへ置換します。\n\n${details}\n\n続行しますか？`
      )) return;

      for (const item of prepared) {
        const removedIds = replaceSharedCacheItemForName(item.name, {
          tournamentId: item.tournamentId,
          url: item.url,
          actualName: item.actualName,
          matchedRow: "manual-force-url",
          source: "ticket-link-v1.0.5-manual-force"
        });

        item.row["本次处理"] = "使用";
        item.row["TournamentId"] = item.tournamentId;
        item.row["URL"] = item.url;
        item.row["判定"] = "OK_MANUAL";
        item.row["理由"] = `強制URL設定 / 旧Cache ID: ${removedIds.filter(Boolean).join(",") || "なし"}`;
        appendReportLine(`[FORCE_URL] ${item.name} / ${item.oldTournamentId || "-"} -> ${item.tournamentId} / removed=${removedIds.filter(Boolean).join(",") || "-"}`);
      }

      setCandidateRows(candidates);
      localStorage.setItem(CONFIG.forceUrlInputKey, input);
      alert(`強制URL設定完了\n\n${prepared.length}件のCandidatesとShared Cacheを更新しました。`);
      log(`強制URL設定完了: ${prepared.length}件`);
    } catch (e) {
      console.error(e);
      alert("強制URL設定ERROR: " + (e.message || String(e)));
      warn("強制URL設定ERROR:", e.message || e);
    } finally {
      running = false;
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

  function parseHtmlDocument(html, url = location.href) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    doc.__pwTicketLinkRawHtml = String(html || "");
    doc.__pwTicketLinkUrl = url;
    return doc;
  }

  async function fetchTicketLinkPage(url) {
    const finalUrl = String(url || "").startsWith("http")
      ? String(url)
      : `${location.origin}${url || ""}`;
    const res = await fetch(finalUrl, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "follow"
    });
    const html = await res.text();
    if (!res.ok) {
      throw new Error(`PAGE_FETCH_HTTP_${res.status}: ${finalUrl}`);
    }
    return parseHtmlDocument(html, finalUrl);
  }

  function htmlAttrValue(html, name) {
    const escaped = String(name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`name=["']${escaped}["'][^>]*value=["']([^"']*)["']`, "i"),
      new RegExp(`value=["']([^"']*)["'][^>]*name=["']${escaped}["']`, "i")
    ];
    for (const pattern of patterns) {
      const m = String(html || "").match(pattern);
      if (m) return m[1] || "";
    }
    return "";
  }

  function getPageTournamentTitleFromDoc(doc) {
    const input = doc.querySelector('input[name="titulo_torneio"]');
    if (input && input.value) return cleanTournamentName(input.value);

    const candidates = [
      doc.querySelector("h1"),
      doc.querySelector("h2"),
      doc.querySelector(".page-title"),
      doc.querySelector(".box-title"),
      doc.querySelector(".panel-title"),
      doc.querySelector(".breadcrumb"),
      doc.querySelector(".content-header")
    ];

    for (const el of candidates) {
      const text = cleanTournamentName(el?.textContent || "");
      if (text.includes("【") && text.includes("】")) return text;
    }

    const title = cleanTournamentName(doc.title || "");
    const m = title.match(/(.+?)\s*-\s*PokerWeb/i);
    if (m) return cleanTournamentName(m[1]);

    const body = norm(doc.body?.textContent || "");
    const m2 = body.match(/(【[^】]+】\s*(?:#\d+[A-Za-z]?|\(s\d+\)|s\d+)\s+[^ \n\r\t]+)/i);
    if (m2) return cleanTournamentName(m2[1]);

    return title;
  }

  function verifyFetchedPageMatchesExpected(doc, expectedName) {
    const actual = getPageTournamentTitleFromDoc(doc);

    if (!actual) {
      throw new Error(`PAGE_TITLE_EMPTY: expected=${expectedName}`);
    }

    if (!isSameTournamentExactSafe(expectedName, actual)) {
      throw new Error(`PAGE_TITLE_MISMATCH: expected=${expectedName} / actual=${actual}`);
    }

    return actual;
  }

  function getTicketLinkFormFromDoc(doc, fallbackTournamentId = "") {
    const form =
      doc.querySelector('form[action*="vincular_grupos_vagas"]') ||
      [...doc.querySelectorAll("form")].find(f => {
        const html = f.innerHTML || "";
        return html.includes("grupo_vagas") && html.includes("vincular_grupos_vagas");
      }) ||
      [...doc.querySelectorAll("form")].find(f => {
        const html = f.innerHTML || "";
        return html.includes("grupo_vagas");
      });

    if (!form) throw new Error("Ticket Link form not found in fetched page");

    const select = form.querySelector('select[name="grupo_vagas"]');
    if (!select) throw new Error("select[name='grupo_vagas'] not found in fetched page");

    const rawHtml = doc.__pwTicketLinkRawHtml || "";
    const codbloq =
      form.querySelector('[name="codbloq"]')?.value ||
      doc.querySelector('form[action*="vincular_grupos_vagas"] [name="codbloq"]')?.value ||
      doc.querySelector('[name="codbloq"]')?.value ||
      htmlAttrValue(form.outerHTML, "codbloq") ||
      htmlAttrValue(rawHtml, "codbloq") ||
      "";

    const idTorneio =
      form.querySelector('[name="id_torneio"]')?.value ||
      doc.querySelector('[name="id_torneio"]')?.value ||
      htmlAttrValue(form.outerHTML, "id_torneio") ||
      htmlAttrValue(rawHtml, "id_torneio") ||
      fallbackTournamentId ||
      extractTournamentIdFromUrl(doc.__pwTicketLinkUrl || "") ||
      "";

    if (!codbloq) throw new Error("codbloq not found in fetched page");
    if (!idTorneio) throw new Error("id_torneio not found in fetched page");

    return { form, select, codbloq, idTorneio };
  }

  async function postTicketLinkByDoc(doc, tournamentId, ticketName, optionValue) {
    const { form, codbloq, idTorneio } = getTicketLinkFormFromDoc(doc, tournamentId);

    const fd = new FormData();
    fd.set("grupo_vagas", optionValue);
    fd.set("codbloq", codbloq);
    fd.set("id_torneio", idTorneio);

    console.log("[PW-TICKET-LINK] background link payload");
    for (const [k, v] of fd.entries()) {
      console.log(k, "=", v);
    }

    const action = form.getAttribute("action") || "/cb/torneio/abas/configuracao/vincular_grupos_vagas";
    const res = await fetch(action, {
      method: "POST",
      body: fd,
      credentials: "same-origin",
      redirect: "follow"
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`TICKET_LINK_POST_HTTP_${res.status}: ${ticketName} / ${text.slice(0, 300)}`);
    }

    return res;
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
    return ["OK_CACHE", "OK_POOL_CLOSED", "OK_POOL_OPEN", "OK_SEARCH_CLOSED", "OK_SEARCH_OPEN", "OK_MANUAL"].includes(norm(status));
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
      throw new Error("本次处理设为“使用”的比赛为空");
    }

    const unsafe = rows.filter(r => !isSafeUrlStatus(r["判定"]));
    if (unsafe.length) {
      throw new Error(`存在尚未安全确认的比赛URL：${unsafe.length}件。请先在URL Manager人工核查。`);
    }

    const usable = rows.filter(r => r["大会名"] && r["TournamentId"] && r["URL"] && parseTicketListFromCandidate(r).length > 0);

    if (!usable.length) {
      throw new Error("使用可能な候補がありません。TournamentId / URL / Ticket一覧 を確認してください。");
    }

    return usable;
  }

  function findDuplicateExecutionTournamentIds(rows) {
    const byId = new Map();

    rows.forEach((row, index) => {
      const id = norm(row["TournamentId"] || extractTournamentIdFromUrl(row["URL"]));
      if (!id) return;
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push({ index, name: cleanTournamentName(row["大会名"]) });
    });

    return [...byId.entries()]
      .filter(([, matches]) => matches.length > 1)
      .map(([id, matches]) => ({ id, matches }));
  }

  async function processTicketLinkTournament(context) {
    const { row, index, total, workerId, tickets } = context;
    const expectedName = cleanTournamentName(row["大会名"]);
    const expectedUrl = row["URL"] || getTournamentUrl(row["TournamentId"]);
    context.startedAtMs = monotonicNowMs();
    context.stageStartedAtMs = context.startedAtMs;

    appendReportLine(
      `[${nowText()}] TASK_START worker=${workerId} task=${index + 1}/${total} id=${row["TournamentId"]} tickets=${tickets.length} / ${expectedName}`
    );

    try {
      for (let ticketIndex = 0; ticketIndex < tickets.length; ticketIndex++) {
        if (stopRequested) {
          context.stopped = true;
          context.stage = "STOPPED";
          context.elapsedMs = elapsedMs(context.startedAtMs);
          appendReportLine(
            `[${nowText()}] TASK_STOPPED worker=${workerId} task=${index + 1}/${total} id=${row["TournamentId"]} linked=${context.linkedTickets}/${tickets.length} task_elapsed_ms=${context.elapsedMs} task_elapsed=${formatDurationMs(context.elapsedMs)} / ${expectedName}`
          );
          return context;
        }

        const ticketName = tickets[ticketIndex];
        const ticketStartedAtMs = monotonicNowMs();
        context.stage = `TICKET_${ticketIndex + 1}_PAGE_FETCH`;
        context.stageStartedAtMs = monotonicNowMs();
        const doc = await fetchTicketLinkPage(expectedUrl);
        const pageFetchMs = elapsedMs(context.stageStartedAtMs);
        const actualTitle = verifyFetchedPageMatchesExpected(doc, expectedName);
        const { select } = getTicketLinkFormFromDoc(doc, row["TournamentId"]);

        context.stage = `TICKET_${ticketIndex + 1}_OPTION_MATCH`;
        context.stageStartedAtMs = monotonicNowMs();
        log(`LINK worker=${workerId} task=${index + 1}/${total} ticket=${ticketIndex + 1}/${tickets.length}: ${ticketName}`);
        const found = findTicketOptionStrict(select, ticketName);
        context.stage = `TICKET_${ticketIndex + 1}_LINK`;
        context.stageStartedAtMs = monotonicNowMs();
        const res = await postTicketLinkByDoc(doc, row["TournamentId"], ticketName, found.option.value);
        const postMs = elapsedMs(context.stageStartedAtMs);
        const ticketTotalMs = elapsedMs(ticketStartedAtMs);
        context.linkedTickets = ticketIndex + 1;
        context.ticketTimings.push({
          ticketIndex,
          pageFetchMs,
          postMs,
          ticketTotalMs
        });

        appendReportLine(
          `[${nowText()}] LINK_OK worker=${workerId} task=${index + 1}/${total} ticket=${ticketIndex + 1}/${tickets.length} id=${row["TournamentId"]} page_fetch_ms=${pageFetchMs} post_ms=${postMs} ticket_total_ms=${ticketTotalMs} ticket_elapsed=${formatDurationMs(ticketTotalMs)} / ${expectedName} / actual=${actualTitle} / ticket=${ticketName} / value=${found.option.value} / match=${found.matchType} / status=${res.status} / mode=BACKGROUND`
        );

        await sleep(CONFIG.betweenTicketsMs);
      }

      context.stage = "DONE";
      context.elapsedMs = elapsedMs(context.startedAtMs);
      appendReportLine(
        `[${nowText()}] TASK_OK worker=${workerId} task=${index + 1}/${total} id=${row["TournamentId"]} tickets=${context.linkedTickets}/${tickets.length} task_elapsed_ms=${context.elapsedMs} task_elapsed=${formatDurationMs(context.elapsedMs)} / ${expectedName}`
      );
    } catch (e) {
      console.error("[PW-TICKET-LINK] execute error", e);
      context.failed = true;
      context.error = e?.message || String(e || "UNKNOWN_ERROR");
      context.elapsedMs = elapsedMs(context.startedAtMs);
      const stageElapsedMs = elapsedMs(context.stageStartedAtMs);
      appendReportLine(
        `[${nowText()}] TASK_ERROR worker=${workerId} task=${index + 1}/${total} id=${row["TournamentId"] || ""} stage=${context.stage} stage_elapsed_ms=${stageElapsedMs} task_elapsed_ms=${context.elapsedMs} task_elapsed=${formatDurationMs(context.elapsedMs)} linked=${context.linkedTickets}/${tickets.length} / ${expectedName} / ${context.error}`
      );
      warn("失敗:", context.error);
    }

    return context;
  }

  async function runExecuteWorkers(rows, ticketTotal, maxConcurrency) {
    const contexts = rows.map((row, index) => ({
      row,
      index,
      total: rows.length,
      workerId: 0,
      tickets: parseTicketListFromCandidate(row),
      linkedTickets: 0,
      failed: false,
      stopped: false,
      stage: "QUEUED",
      error: "",
      startedAtMs: 0,
      stageStartedAtMs: 0,
      elapsedMs: 0,
      ticketTimings: []
    }));
    const workerCount = Math.min(maxConcurrency, contexts.length);
    const runStartedAtMs = monotonicNowMs();
    const workerStats = Array.from({ length: workerCount }, (_, index) => ({
      workerId: index + 1,
      startedAtMs: 0,
      endedAtMs: 0,
      tournaments: 0,
      successful: 0,
      failed: 0,
      stopped: 0,
      linkedTickets: 0
    }));
    let nextIndex = 0;
    let completed = 0;

    setFlowState({ running: true, total: contexts.length, completed, nextIndex, workers: workerCount });
    appendReportLine(`[${nowText()}] WORKERS_START tournaments=${contexts.length} workers=${workerCount}`);

    const worker = async workerId => {
      const stats = workerStats[workerId - 1];
      while (!stopRequested) {
        const contextIndex = nextIndex++;
        if (contextIndex >= contexts.length) return;

        const context = contexts[contextIndex];
        context.workerId = workerId;
        if (!stats.startedAtMs) stats.startedAtMs = monotonicNowMs();
        appendReportLine(
          `[${nowText()}] WORKER_CLAIM worker=${workerId} task=${context.index + 1}/${context.total} id=${context.row["TournamentId"]} / ${context.row["大会名"]}`
        );
        setFlowState({ running: true, total: contexts.length, completed, nextIndex, workers: workerCount });

        await processTicketLinkTournament(context);
        stats.tournaments++;
        stats.linkedTickets += context.linkedTickets;
        if (context.failed) stats.failed++;
        else if (context.stopped) stats.stopped++;
        else if (context.stage === "DONE") stats.successful++;
        stats.endedAtMs = monotonicNowMs();
        completed++;
        appendReportLine(
          `[${nowText()}] WORKER_RELEASE worker=${workerId} task=${context.index + 1}/${context.total} completed=${completed}/${contexts.length} status=${context.failed ? "ERROR" : context.stopped ? "STOPPED" : "OK"} id=${context.row["TournamentId"]} task_elapsed_ms=${context.elapsedMs}`
        );
        setFlowState({ running: true, total: contexts.length, completed, nextIndex, workers: workerCount, stopRequested });

        await sleep(CONFIG.betweenTournamentsMs);
      }
    };

    try {
      await Promise.all(Array.from({ length: workerCount }, (_, index) => worker(index + 1)));

      const successful = contexts.filter(context => context.stage === "DONE");
      const failed = contexts.filter(context => context.failed);
      const stopped = contexts.filter(context => context.stopped);
      const queued = contexts.filter(context => context.workerId === 0);
      const finalLabel = stopRequested ? "STOPPED" : "DONE";
      const runElapsedMs = elapsedMs(runStartedAtMs);
      appendReportLine(
        `[${nowText()}] ${finalLabel} tournaments=${contexts.length} workers=${workerCount} ok=${successful.length} failed=${failed.length} stopped=${stopped.length} queued=${queued.length} tickets=${contexts.reduce((sum, context) => sum + context.linkedTickets, 0)}/${ticketTotal} run_elapsed_ms=${runElapsedMs} run_elapsed=${formatDurationMs(runElapsedMs)}`
      );
      workerStats.forEach(stats => {
        const workerElapsedMs = stats.startedAtMs && stats.endedAtMs
          ? Math.max(0, Math.round(stats.endedAtMs - stats.startedAtMs))
          : 0;
        appendReportLine(
          `WORKER_SUMMARY worker=${stats.workerId} tournaments=${stats.tournaments} tickets=${stats.linkedTickets} ok=${stats.successful} failed=${stats.failed} stopped=${stats.stopped} worker_elapsed_ms=${workerElapsedMs} worker_elapsed=${formatDurationMs(workerElapsedMs)}`
        );
      });
      contexts.forEach(context => appendReportLine(
        `RESULT ${context.index + 1}. status=${context.failed ? "ERROR" : context.stopped ? "STOPPED" : context.stage === "DONE" ? "OK" : "QUEUED"} worker=${context.workerId || "-"} id=${context.row["TournamentId"]} stage=${context.stage} tickets=${context.linkedTickets}/${context.tickets.length} task_elapsed_ms=${context.elapsedMs} task_elapsed=${formatDurationMs(context.elapsedMs)} ${context.row["大会名"]}${context.error ? ` error=${context.error}` : ""}`
      ));

      log(stopRequested ? "停止完了" : "全部完成");
      alert(stopRequested
        ? "Ticket Link停止完了。進行中だった処理の結果はReportを確認してください。"
        : `Ticket Link 全部完成。\n\nOK: ${successful.length}\nERROR: ${failed.length}\nReportを確認してください。`
      );
    } finally {
      clearFlowState();
      running = false;
      stopRequested = false;
    }
  }

  function startExecuteLink() {
    if (running) {
      alert("処理中です");
      return;
    }

    let rows;
    let maxConcurrency;

    try {
      rows = prepareExecutionRows();
      maxConcurrency = configuredConcurrency();
      const duplicateIds = findDuplicateExecutionTournamentIds(rows);
      if (duplicateIds.length) {
        const detail = duplicateIds.map(({ id, matches }) =>
          `TournamentId ${id}: ${matches.map(match => `${match.index + 1}:${match.name}`).join(" / ")}`
        ).join("\n");
        throw new Error(`同じTournamentIdが複数の使用対象にあります。\n${detail}`);
      }
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
      `この版はページを開かず、確認済みURLを后台fetchしてhidden formを直接使用します。\n` +
      `Ticket optionは value=tn_ のものだけを対象にします。\n\n` +
      `${summary}`
    );

    if (!ok) return;

    running = true;
    stopRequested = false;

    const startReport = [
      `[${nowText()}] START  Ticket Link実行`,
      `大会数=${rows.length} / Ticket Link予定数=${ticketTotal} / workers=${Math.min(maxConcurrency, rows.length)}`,
      ""
    ].join("\n");

    setReportText(startReport);
    runExecuteWorkers(rows, ticketTotal, maxConcurrency).catch(e => {
      console.error("[PW-TICKET-LINK] worker pool error", e);
      appendReportLine(`[${nowText()}] FATAL_ERROR ${e.message || e}`);
      alert("FATAL ERROR: " + (e.message || String(e)) + "\n\nReportとConsoleを確認してください。");
    });
  }

  function stopRun() {
    if (!running) {
      stopRequested = false;
      clearFlowState();
      log("停止状態をクリアしました。");
      return;
    }

    stopRequested = true;
    appendReportLine(`[${nowText()}] STOP_REQUESTED active workers will stop before the next Ticket`);
    log("停止要求を受け付けました。進行中のTicket完了後、新しいTicketと大会を開始しません。");
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

    ["#pw-ticket-link-tournaments", "#pw-ticket-link-simple-tickets", "#pw-ticket-link-rules", "#pw-ticket-link-overrides", "#pw-ticket-link-force-url", "#pw-ticket-link-candidates", "#pw-ticket-link-report"].forEach(sel => {
      const el = document.querySelector(sel);
      if (el) el.value = "";
    });

    localStorage.removeItem(CONFIG.tournamentInputKey);
    localStorage.removeItem(CONFIG.simpleTicketInputKey);
    localStorage.removeItem(CONFIG.matrixInputKey);
    localStorage.removeItem(CONFIG.overrideInputKey);
    localStorage.removeItem(CONFIG.forceUrlInputKey);
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
    const savedForceUrl = localStorage.getItem(CONFIG.forceUrlInputKey) || "";
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
        <div style="font-weight:bold;">PW Ticket Link Semi Auto v1.1.1</div>
        <div style="display:flex;gap:4px;">
          <button id="pw-ticket-link-minimize" style="font-size:11px;padding:2px 6px;cursor:pointer;">Min</button>
          <button id="pw-ticket-link-close" style="font-size:11px;padding:2px 6px;cursor:pointer;">x</button>
        </div>
      </div>

      <div id="pw-ticket-link-body" style="overflow-y:auto;padding-right:2px;">
        <div style="font-size:11px;color:#ccc;line-height:1.35;margin-bottom:6px;">
          流れ：候補作成 → URL pool検索 → 已确认比赛へ后台fetchでTicket Link<br>
          URLは完整大会名で厳密照合。Ticket optionは value=tn_ のみ対象。ページ遷移/Config/Modalクリックなし。
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
          <button id="pw-ticket-link-resolve" style="flex:1;padding:7px;cursor:pointer;background:#d9ecff;border:1px solid #88a;">2. URL pool検索</button>
          <button id="pw-ticket-link-execute" style="flex:1;padding:7px;cursor:pointer;background:#bff0c2;border:1px solid #8a8;">3. 已确认比赛执行Link</button>
        </div>

        <div style="display:flex;gap:6px;margin-top:6px;">
          <button id="pw-ticket-link-stop" style="flex:1;padding:7px;cursor:pointer;background:#f3cccc;border:1px solid #c88;">Stop / Clear State</button>
          <button id="pw-ticket-link-copy-candidates" style="flex:1;padding:7px;cursor:pointer;background:#eee;border:1px solid #aaa;">Copy Candidates</button>
          <button id="pw-ticket-link-copy-cache" style="flex:1;padding:7px;cursor:pointer;background:#eee;border:1px solid #aaa;">Copy Shared URL Cache</button>
        </div>

        <div style="font-size:12px;font-weight:bold;margin-top:6px;">Candidates / 候補確認欄</div>
        <textarea id="pw-ticket-link-candidates"
          style="width:100%;height:160px;background:#111;color:#fff;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

        <div style="font-size:12px;font-weight:bold;color:#ffcf70;margin-top:6px;">強制URL設定 / 强制设置URL</div>
        <div style="font-size:11px;color:#ccc;line-height:1.35;margin-bottom:3px;">
          比赛名[TAB]URL。Candidatesが1行だけならURLのみでも可。页面核对后覆盖Candidate并修正Shared Cache。
        </div>
        <textarea id="pw-ticket-link-force-url"
          placeholder="例：&#10;【SPADIE Season 41st】#01 NLH Main Event Day 1A&#9;https://japanopt.pokerweb.com.br/cb/torneio/painel/12345"
          style="width:100%;height:58px;background:#111;color:#fff;border:1px solid #b87920;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>
        <button id="pw-ticket-link-force-url-button" style="width:100%;padding:7px;cursor:pointer;background:#ffcf70;border:1px solid #b87920;margin-top:4px;">强制设置URL并修正库</button>

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
    document.querySelector("#pw-ticket-link-force-url").value = savedForceUrl;
    document.querySelector("#pw-ticket-link-candidates").value = savedCandidates;
    document.querySelector("#pw-ticket-link-report").value = savedReport;

    document.querySelectorAll('input[name="pw-ticket-link-mode"]').forEach(el => {
      el.onchange = () => updateModeUI();
    });

    document.querySelector("#pw-ticket-link-build").onclick = () => previewBuildCandidates();
    document.querySelector("#pw-ticket-link-resolve").onclick = () => resolveUrlForCandidates();
    document.querySelector("#pw-ticket-link-force-url-button").onclick = () => forceSetTournamentUrls();
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
      forceSetTournamentUrls,
      startExecuteLink,
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
        clearFlowState();
        appendReportLine(`[${nowText()}] PREVIOUS_RUN_INTERRUPTED automatic resume disabled; confirm current Ticket Link state before rerun`);
        log("前回の実行状態を検出しました。並行処理は自動再開しません。Reportと各大会のTicket Link状態を確認してください。");
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
