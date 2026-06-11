// ==UserScript==
// @name         PW 領収書抜き出し 人工確認版 v1.6
// @namespace    https://japanopt.pokerweb.com.br/
// @version      1.6.13
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-receipt-manual-confirm.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-receipt-manual-confirm.user.js
// @description  Game ID + キーワードで候補大会をAPI検索し、URL Cacheを厳密照合しながら支払い情報を高速取得する版
// @author       xhpc007 + ChatGPT
// @match        https://japanopt.pokerweb.com.br/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    eventYear: 2026,
    defaultDateRange: "02/01/2025 - 31/12/2026",
    fetchInformacoes: true,
    betweenPlayerMs: 300,
    betweenTournamentMs: 200,
    betweenDetailFetchMs: 80,
    searchWaitTimeoutMs: 9000,
    searchPollMs: 350,
    sharedUrlCacheKey: "PW_SHARED_TOURNAMENT_URL_CACHE_V1",
    inputKey: "PW_MANUAL_RECEIPT_V15_INPUT",
    candidateKey: "PW_MANUAL_RECEIPT_V15_CANDIDATES",
    dateRangeKey: "PW_MANUAL_RECEIPT_V15_DATE_RANGE",
    outputKey: "PW_MANUAL_RECEIPT_V15_OUTPUT",
    copyModeKey: "PW_MANUAL_RECEIPT_V15_COPY_MODE"
  };

  const CANDIDATE_HEADERS = [
    "本次处理", "Game ID", "internalId", "参加日", "対象キーワード", "大会名",
    "TournamentId", "URL", "判定", "理由"
  ];

  let running = false;
  let stopRequested = false;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

  function normalizeGameId(raw) {
    const digits = String(raw ?? "").replace(/\D/g, "");
    return digits.length === 8 ? digits : "";
  }

  function rawToSearchGameId(raw) {
    const digits = String(raw ?? "").replace(/\D/g, "");
    if (digits.length !== 8) return String(raw ?? "");
    return `${digits.slice(0, 4)}.${digits.slice(4)}`;
  }

  function cleanNumber(value) {
    return String(value ?? "").replace(/[^\d.-]/g, "") || "";
  }

  function toNumber(value) {
    const n = Number(cleanNumber(value));
    return Number.isFinite(n) ? n : 0;
  }

  function parseHtml(html) {
    return new DOMParser().parseFromString(String(html || ""), "text/html");
  }

  function nowText() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function log(...args) {
    console.log("[PW-MANUAL-v1.5]", ...args);
  }

  function warn(...args) {
    console.warn("[PW-MANUAL-v1.5]", ...args);
  }

  function setStatus(text) {
    log(text);
    const el = document.querySelector("#pw-manual-status");
    if (el) el.textContent = text;
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
      return `#${num}${suffix}`;
    }

    return "";
  }

  function isSameTournamentExactSafe(inputName, actualName) {
    const a = cleanTournamentName(inputName);
    const b = cleanTournamentName(actualName);

    if (!a || !b) return false;

    return compact(a) === compact(b);
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

  function getTournamentNoFromName(name) {
    const m = String(name || "").match(/#\s*(\d+)/);
    return m ? Number(m[1]) : "";
  }

  function parsePurchaseDateParts(timeText) {
    const m = String(timeText || "").match(/(\d{1,2})\/(\d{1,2})/);
    if (!m) return { 年: CONFIG.eventYear, 月: "", 日: "" };

    return { 年: CONFIG.eventYear, 月: Number(m[2]), 日: Number(m[1]) };
  }

  function parseTimeSortValue(timeText) {
    const m = String(timeText || "").match(/(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2}):(\d{2})/);
    if (!m) return 999999999999;

    return new Date(CONFIG.eventYear, Number(m[2]) - 1, Number(m[1]), Number(m[3]), Number(m[4])).getTime();
  }

  function loadSharedCache() {
    try {
      const raw = localStorage.getItem(CONFIG.sharedUrlCacheKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      warn("shared cache parse failed", e);
      return {};
    }
  }

  function saveSharedCache(cache) {
    localStorage.setItem(CONFIG.sharedUrlCacheKey, JSON.stringify(cache));
  }

  function setSharedCacheItem(name, data) {
    const cleanName = cleanTournamentName(name);
    if (!cleanName) return;

    const id = String(data.tournamentId || "").trim();
    const url = data.url || (id ? getTournamentUrl(id) : "");
    if (!id || !url) return;

    const cache = loadSharedCache();
    const key = `${cleanName}||${id}`;

    cache[key] = {
      name: cleanName,
      tournamentId: id,
      url,
      actualName: cleanTournamentName(data.actualName || data.name || cleanName),
      matchedRow: String(data.matchedRow || ""),
      savedAt: nowText(),
      source: String(data.source || "manual-v1.5")
    };

    saveSharedCache(cache);
  }

  function getSharedCacheMatchesByName(name) {
    const cleanName = cleanTournamentName(name);
    const seen = new Set();

    return Object.values(loadSharedCache())
      .map(item => validateUrlCacheItem(item))
      .filter(item => item.ok)
      .filter(item =>
        isSameTournamentExactSafe(cleanName, item.name) ||
        isSameTournamentExactSafe(cleanName, item.actualName)
      )
      .filter(item => {
        if (seen.has(item.tournamentId)) return false;
        seen.add(item.tournamentId);
        return true;
      });
  }

  function replaceSharedCacheForName(name, data) {
    const cleanName = cleanTournamentName(name);
    const cache = loadSharedCache();

    for (const [key, item] of Object.entries(cache)) {
      const itemName = cleanTournamentName(item?.name || "");
      const actualName = cleanTournamentName(item?.actualName || "");
      if (
        isSameTournamentExactSafe(cleanName, itemName) ||
        isSameTournamentExactSafe(cleanName, actualName)
      ) {
        delete cache[key];
      }
    }

    saveSharedCache(cache);
    setSharedCacheItem(cleanName, data);
  }

  function findSharedCacheByName(name) {
    const cleanName = cleanTournamentName(name);
    const matches = [];
    const badRows = [];
    const cache = loadSharedCache();

    for (const item of Object.values(cache)) {
      const checked = validateUrlCacheItem(item);

      if (!checked.ok) {
        const itemName = cleanTournamentName(item.name || "");
        const itemActual = cleanTournamentName(item.actualName || "");
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
      reason: "大会一覧ページでURL検索してください"
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

  function parseManualTasks(text) {
    const lines = String(text || "")
      .split(/\r?\n/)
      .map(line => line.replace(/\uFEFF/g, "").trim())
      .filter(Boolean);

    const tasks = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^(Game ID|GameID|対象キーワード|Keyword)\b/i.test(line)) continue;

      const m = line.match(/^\s*(\d{4}\.?\d{4}|\d{8})\s*(?:\t|,|，|、|\||｜|:|：|\s+)\s*(.+?)\s*$/);
      if (!m) continue;

      const gameId = normalizeGameId(m[1]);
      const keyword = norm(m[2]);
      if (!gameId || !keyword) continue;

      tasks.push({ rowNo: i + 1, gameId, keyword });
    }

    return tasks;
  }

  function keywordMatches(name, keyword) {
    const n = compact(name);
    const k = compact(keyword);
    if (!n || !k) return false;

    const parts = k.split(/[ ,，、]+/).map(x => x.trim()).filter(Boolean);
    return parts.length <= 1 ? n.includes(k) : parts.every(p => n.includes(p));
  }

  async function postForm(url, dataObj) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: new URLSearchParams(dataObj),
      credentials: "same-origin"
    });

    if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
    return await res.text();
  }

  async function searchInternalId(gameId) {
    const searchGameId = rawToSearchGameId(gameId);

    const html = await postForm("/cb/jogadores/search", {
      query: gameId,
      identifier: "string"
    });

    const doc = parseHtml(html);
    const candidates = [];

    for (const el of Array.from(doc.querySelectorAll("[rel], [onclick], a, li, tr, div"))) {
      const rowHtml = el.outerHTML || "";
      const rowText = norm(el.innerText || el.textContent || "");

      if (!rowText.includes(searchGameId)) continue;

      const relMatch = rowHtml.match(/rel=["'][^"']*?(\d+)[^"']*?["']/);
      const painelMatch = rowHtml.match(/jogadores\/painel\/(\d+)/);
      const leadingMatch = rowText.match(/^\s*(\d+)\s*-/);
      const internalId = relMatch?.[1] || painelMatch?.[1] || leadingMatch?.[1] || "";

      if (internalId) {
        candidates.push({
          internalId,
          searchText: rowText
        });
      }
    }

    const unique = [];
    const seen = new Set();

    for (const c of candidates) {
      if (seen.has(c.internalId)) continue;
      seen.add(c.internalId);
      unique.push(c);
    }

    if (unique.length === 1) return unique[0];

    if (unique.length > 1) {
      throw new Error(`Game ID ${gameId}: 複数プレイヤーが精確一致しました (${unique.map(x => x.internalId).join(",")})`);
    }

    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    throw new Error(`Game ID ${gameId}: 精確一致するプレイヤーなし / search=${searchGameId} / result=${text.slice(0, 200)}`);
  }

  async function requestPlayerTournamentHtml(internalId, dateRange) {
    const pageUrl = `/cb/jogadores/painel/${internalId}`;

    const getRes = await fetch(pageUrl, { method: "GET", credentials: "same-origin" });
    if (!getRes.ok) throw new Error(`player page GET HTTP ${getRes.status}`);

    const pageHtml = await getRes.text();
    const doc = parseHtml(pageHtml);

    const form = Array.from(doc.querySelectorAll("form")).find(f =>
      f.querySelector('input[name="torneio_aba"]') &&
      f.querySelector('input[name="data"]') &&
      f.querySelector('button[name="action"][value="torneio"]')
    );

    if (!form) throw new Error("player tournament filter form not found");

    const codbloq = form.querySelector('input[name="codbloq"]')?.value || "";
    const body = { torneio_aba: "1", data: dateRange, action: "torneio" };
    if (codbloq) body.codbloq = codbloq;

    return await postForm(pageUrl, body);
  }

  function extractPlayerTournamentRowsFromHtml(html) {
    const doc = parseHtml(html);
    const out = [];

    for (const table of Array.from(doc.querySelectorAll("table"))) {
      const trs = Array.from(table.querySelectorAll("tr"));
      if (!trs.length) continue;

      const header = Array.from(trs[0].querySelectorAll("th,td"))
        .map(td => norm(td.innerText || td.textContent || ""));

      const dateIndex = header.indexOf("日付");
      const nameIndex = header.indexOf("名前");

      if (dateIndex < 0 || nameIndex < 0 || !header.includes("ショッピング")) {
        continue;
      }

      for (const tr of trs.slice(1)) {
        const tdNodes = Array.from(tr.querySelectorAll("td"));
        const tds = tdNodes.map(td => norm(td.innerText || td.textContent || ""));

        const date = tds[dateIndex] || "";
        const name = cleanTournamentName(tds[nameIndex] || "");
        const rowText = norm(tr.innerText || tr.textContent || "");
        const tournamentIds = new Set();

        for (const m of String(tr.innerHTML || "").matchAll(/\/cb\/torneio\/painel\/(\d+)/g)) {
          tournamentIds.add(m[1]);
        }

        for (const m of String(tr.innerHTML || "").matchAll(/(?:id_torneio|idTorneio)\D{0,30}(\d+)/gi)) {
          tournamentIds.add(m[1]);
        }

        const tournamentId = tournamentIds.size === 1 ? Array.from(tournamentIds)[0] : "";

        if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) continue;
        if (!name) continue;

        out.push({
          index: out.length,
          date,
          name,
          tournamentId,
          url: tournamentId ? getTournamentUrl(tournamentId) : "",
          rowText
        });
      }
    }

    return out;
  }

  async function discoverCandidatesFromTasks(tasks, dateRange) {
    const candidates = [];

    for (let i = 0; i < tasks.length; i++) {
      if (stopRequested) break;

      const task = tasks[i];

      try {
        setStatus(`候補検索 ${i + 1}/${tasks.length}: ${task.gameId} / ${task.keyword}`);

        const search = await searchInternalId(task.gameId);
        const html = await requestPlayerTournamentHtml(search.internalId, dateRange);
        const rows = extractPlayerTournamentRowsFromHtml(html).filter(row => keywordMatches(row.name, task.keyword));

        if (!rows.length) {
          candidates.push({
            本次处理: "不使用", "Game ID": task.gameId, internalId: search.internalId, 参加日: "",
            対象キーワード: task.keyword, 大会名: "", TournamentId: "", URL: "",
            判定: "NO_MATCH", 理由: "指定キーワードに一致する参加大会なし"
          });
          continue;
        }

        for (const row of rows) {
          const sharedCacheResult = findSharedCacheByName(row.name);
          let cacheResult = sharedCacheResult;

          if (row.tournamentId && sharedCacheResult.status === "OK_CACHE") {
            if (sharedCacheResult.row.tournamentId === row.tournamentId) {
              cacheResult = {
                status: "OK_PLAYER_PAGE_CACHE_MATCH",
                row: { tournamentId: row.tournamentId, url: row.url },
                reason: "player page TournamentId matches Shared Cache"
              };
            } else {
              cacheResult = {
                status: "URL_CACHE_POLLUTION_SUSPECT",
                row: { tournamentId: row.tournamentId, url: row.url },
                reason: `Shared Cache污染疑い: player page=${row.tournamentId} / cache=${sharedCacheResult.row.tournamentId}`
              };
            }
          } else if (row.tournamentId && sharedCacheResult.status === "URL_AMBIGUOUS") {
            cacheResult = {
              status: "URL_CACHE_POLLUTION_SUSPECT",
              row: { tournamentId: row.tournamentId, url: row.url },
              reason: `Shared Cache污染疑い: player page=${row.tournamentId} / ${sharedCacheResult.reason}`
            };
          } else if (row.tournamentId) {
            cacheResult = {
              status: "OK_PLAYER_PAGE",
              row: { tournamentId: row.tournamentId, url: row.url },
              reason: "TournamentId extracted from player page"
            };
          }

          const cache = cacheResult.row || null;
          const autoUse = ["OK_CACHE", "OK_PLAYER_PAGE_CACHE_MATCH", "OK_PLAYER_PAGE"].includes(cacheResult.status);

          if (row.tournamentId && cacheResult.status === "OK_PLAYER_PAGE") {
            setSharedCacheItem(row.name, {
              tournamentId: row.tournamentId,
              url: row.url,
              actualName: row.name,
              matchedRow: row.rowText,
              source: "manual-v1.11-player-page"
            });
          }

          candidates.push({
            本次处理: autoUse ? "使用" : "不使用",
            "Game ID": task.gameId,
            internalId: search.internalId,
            参加日: row.date,
            対象キーワード: task.keyword,
            大会名: row.name,
            TournamentId: cache ? cache.tournamentId : "",
            URL: cache ? cache.url : "",
            判定: cacheResult.status,
            理由: cacheResult.reason
          });
        }

      } catch (e) {
        candidates.push({
          本次处理: "不使用", "Game ID": task.gameId, internalId: "", 参加日: "",
          対象キーワード: task.keyword, 大会名: "", TournamentId: "", URL: "",
          判定: "ERROR", 理由: e.message || String(e)
        });
      }

      await sleep(CONFIG.betweenPlayerMs);
    }

    return candidates;
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
    const rows = [];
    const seen = new Set();

    const add = row => {
      if (!row || !rowHasPanelLink(row)) return;
      const key = row.outerHTML || row.innerHTML || row.innerText || row;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(row);
    };

    try {
      dt.rows({ search: "applied" }).nodes().each(add);
    } catch (_) {}

    try {
      const node = dt.table().node();
      Array.from(node?.querySelectorAll("tbody tr") || []).forEach(add);
    } catch (_) {}

    if (!rows.length) {
      Array.from(win.document.querySelectorAll("table tbody tr, tr")).forEach(add);
    }

    return rows;
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
      const table = dt.table().node();

      const finish = value => {
        if (done) return;
        done = true;
        try {
          win.jQuery(table).off(".pwManualUrlWait");
        } catch (_) {}
        resolve(value);
      };

      const onComplete = () => finish(true);

      try {
        win.jQuery(table).one("draw.dt.pwManualUrlWait", onComplete);
      } catch (_) {
        finish(false);
        return;
      }

      setTimeout(() => finish(false), timeoutMs);
    });
  }

  async function waitForSearchResultStable(win, dt, timeoutMs = 3000) {
    const start = Date.now();
    let lastSignature = "";
    let stableSince = 0;

    while (Date.now() - start < timeoutMs) {
      if (!win || win.closed) throw new Error("WINDOW_CLOSED");

      const signature = getDataTableTbodyRows(win, dt)
        .map(row => String(row.outerHTML || row.innerText || "").slice(0, 500))
        .join("||");

      if (!isDataTableProcessing(win, dt) && signature === lastSignature) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= 350) return true;
      } else {
        lastSignature = signature;
        stableSince = 0;
      }

      await sleep(75);
    }

    return false;
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
    if (!drawn) throw new Error("DataTable draw timeout");

    const processingGone = await waitForProcessingGone(win, dt, CONFIG.searchWaitTimeoutMs);
    if (!processingGone) throw new Error("DataTable processing timeout");

    const stable = await waitForSearchResultStable(win, dt);
    if (!stable) throw new Error("DataTable result unstable");
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

    log(`URL search result: query=${inputName} / rows=${rows.length} / exact=${unique.length}`);

    if (unique.length === 1) return unique[0];
    if (unique.length > 1) return { error: "AMBIGUOUS", candidates: unique };
    return null;
  }

  function extractTournamentFromListRow(row) {
    const rowText = norm(row?.innerText || row?.textContent || "");
    const rowHtml = row?.innerHTML || "";
    const m = String(rowHtml).match(/\/cb\/torneio\/painel\/(\d+)/);
    if (!m) return null;

    return {
      tournamentId: m[1],
      url: getTournamentUrl(m[1]),
      actualName: extractTournamentTitleFromRow(rowText),
      matchedRow: rowText
    };
  }

  async function collectEventPrefixRowsAllPages(win, prefix, source) {
    const dt = await waitForDataTableReadyInWindow(win, 15000);
    if (!dt) throw new Error(`${source}: DataTable not found`);

    await dataTableSearchAndWait(win, dt, prefix);

    let pages = 1;
    try {
      pages = Math.max(1, Number(dt.page.info()?.pages || 1));
    } catch (_) {}

    const found = [];
    const seen = new Set();

    for (let page = 0; page < pages; page++) {
      if (stopRequested) break;

      if (page > 0) {
        const drawPromise = waitForNextDraw(win, dt, CONFIG.searchWaitTimeoutMs);
        dt.page(page).draw("page");
        if (!await drawPromise) throw new Error(`${source}: page ${page + 1} draw timeout`);
        await waitForSearchResultStable(win, dt);
      }

      for (const row of getDataTableTbodyRows(win, dt)) {
        const item = extractTournamentFromListRow(row);
        if (!item || seen.has(item.url)) continue;

        const all = `${item.actualName} ${item.matchedRow}`;
        if (!compact(all).includes(compact(prefix))) continue;

        seen.add(item.url);
        found.push({ ...item, source });
      }
    }

    log(`Event Prefix result: ${source} / ${prefix} / pages=${pages} / rows=${found.length}`);
    return found;
  }

  function findExactTournamentFromCollected(rows, inputName) {
    const matches = rows.filter(row => isSameTournamentExactSafe(inputName, row.actualName));
    const seen = new Set();
    const unique = matches.filter(row => {
      if (seen.has(row.url)) return false;
      seen.add(row.url);
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
    const win = window.open(path, `pw_manual_url_${label}_${Date.now()}`, "width=1280,height=900");
    if (!win) throw new Error(`${label}: popup blocked`);

    await waitForWindowLoad(win, 25000);

    const dt = await waitForDataTableReadyInWindow(win, 15000);
    if (!dt) throw new Error(`${label}: DataTable not found`);

    return win;
  }

  async function searchTournamentInListWindow(win, name) {
    const dt = await waitForDataTableReadyInWindow(win, 15000);
    if (!dt) throw new Error("DataTable not found");

    for (let attempt = 1; attempt <= 2; attempt++) {
      if (stopRequested) return null;

      try {
        if (attempt > 1) setStatus(`URL検索 retry ${attempt}/2: ${name}`);

        await dataTableSearchAndWait(win, dt, name);
        return findTournamentFromCurrentDataTablePage(win, dt, name);
      } catch (e) {
        warn(`URL search retry ${attempt}/2 failed`, e);
        if (attempt < 2) await sleep(500);
      }
    }

    return null;
  }

  function getCandidateText() {
    return document.querySelector("#pw-manual-candidates")?.value || "";
  }

  function normalizeCandidateProcessing(rows) {
    return rows.map(row => {
      const oldValue = norm(row["本次处理"] || row["USE"]);
      const use = oldValue === "使用" || oldValue === "1" || oldValue.toUpperCase() === "TRUE" ||
        oldValue.toUpperCase() === "Y" || oldValue === "〇" || oldValue === "○";
      row["本次处理"] = use ? "使用" : "不使用";
      delete row["USE"];
      return row;
    });
  }

  function setCandidateRows(rows) {
    const normalizedRows = normalizeCandidateProcessing(rows);
    const tsv = toTsv(normalizedRows, CANDIDATE_HEADERS);
    const box = document.querySelector("#pw-manual-candidates");
    if (box) box.value = tsv;
    localStorage.setItem(CONFIG.candidateKey, tsv);
    renderManualReview(normalizedRows);
    return tsv;
  }

  const MANUAL_REVIEW_STATUSES = new Set([
    "URL_CACHE_POLLUTION_SUSPECT",
    "URL_AMBIGUOUS",
    "URL_CACHE_BAD_ROW",
    "URL未解決",
    "URL_NOT_FOUND",
    "AMBIGUOUS",
    "ERROR"
  ]);

  function getManualReviewRows(rows = parseTsv(getCandidateText())) {
    return rows.filter(row => row["大会名"] && MANUAL_REVIEW_STATUSES.has(row["判定"]));
  }

  function applyConfirmedUrlToCandidates(name, tournamentId, url, status, reason) {
    const rows = parseTsv(getCandidateText());
    for (const row of rows) {
      if (!isSameTournamentExactSafe(name, row["大会名"])) continue;
      row["本次处理"] = "使用";
      delete row["USE"];
      row["TournamentId"] = tournamentId;
      row["URL"] = url;
      row["判定"] = status;
      row["理由"] = reason || "";
    }
    setCandidateRows(rows);
  }

  function confirmAndRepairCache(name, tournamentId, url, sourceLabel) {
    const id = norm(tournamentId);
    const finalUrl = normalizeCacheUrl(id, url);
    if (!id || !finalUrl || extractTournamentIdFromUrl(finalUrl) !== id) {
      alert("TournamentId / URL が不正です。");
      return;
    }

    if (!confirm(
      `このURLを正しい大会URLとして採用し、同名の旧Cacheを削除します。\n\n` +
      `${name}\n\nTournamentId: ${id}\nURL: ${finalUrl}\n\n続行しますか？`
    )) return;

    replaceSharedCacheForName(name, {
      tournamentId: id,
      url: finalUrl,
      actualName: name,
      matchedRow: `manual repair: ${sourceLabel}`,
      source: `manual-v1.11-repair-${sourceLabel}`
    });

    applyConfirmedUrlToCandidates(name, id, finalUrl, "OK_MANUAL_REPAIRED", `人工確認済み: ${sourceLabel}`);
    setStatus(`Cache修復完了: ${name} → ${id}`);
  }

  function skipCandidateForThisRun(name) {
    if (!confirm(`本次处理暂时排除这场比赛吗？\n\n${name}`)) return;

    const rows = parseTsv(getCandidateText());
    for (const row of rows) {
      if (!isSameTournamentExactSafe(name, row["大会名"])) continue;
      row["本次处理"] = "不使用";
      row["判定"] = "SKIPPED_THIS_RUN";
      row["理由"] = "本次人工排除";
      delete row["USE"];
    }
    setCandidateRows(rows);
  }

  function userFacingReviewStatus(status) {
    const labels = {
      URL_CACHE_POLLUTION_SUSPECT: "发现历史URL冲突，需要确认",
      URL_AMBIGUOUS: "同名比赛存在多个历史URL",
      URL_CACHE_BAD_ROW: "历史URL记录异常",
      URL未解決: "尚未取得比赛URL",
      URL_NOT_FOUND: "未找到比赛URL",
      AMBIGUOUS: "搜索结果存在多个同名比赛",
      ERROR: "读取时发生错误"
    };
    return labels[status] || status;
  }

  function renderManualReview(rows = parseTsv(getCandidateText())) {
    const box = document.querySelector("#pw-manual-review");
    const summary = document.querySelector("#pw-manual-summary");
    if (!box || !summary) return;

    const reviewRows = getManualReviewRows(rows);
    const existing = rows.filter(row => row["判定"] === "OK_PLAYER_PAGE_CACHE_MATCH" || row["判定"] === "OK_CACHE").length;
    const added = rows.filter(row => row["判定"] === "OK_PLAYER_PAGE").length;
    const pollution = rows.filter(row => row["判定"] === "URL_CACHE_POLLUTION_SUSPECT").length;
    const conflicts = rows.filter(row => ["URL_AMBIGUOUS", "AMBIGUOUS"].includes(row["判定"])).length;
    const unresolved = reviewRows.length - pollution - conflicts;

    summary.textContent =
      `符合比赛 ${rows.filter(row => row["大会名"]).length} / 已有一致 ${existing} / 新增 ${added} / ` +
      `疑似污染 ${pollution} / 重名冲突 ${conflicts} / 其他待确认 ${Math.max(0, unresolved)}`;

    box.replaceChildren();
    if (!reviewRows.length) {
      const ok = document.createElement("div");
      ok.textContent = "需要人工确认的项目：0";
      ok.style.color = "#9f9";
      box.appendChild(ok);
      return;
    }

    const unique = new Map();
    for (const row of reviewRows) {
      const key = compact(row["大会名"]);
      if (!unique.has(key)) unique.set(key, row);
    }

    for (const row of unique.values()) {
      const name = cleanTournamentName(row["大会名"]);
      const card = document.createElement("div");
      card.style.cssText = "border:1px solid #955;background:#2b2020;padding:7px;margin-top:6px;line-height:1.45;";

      const title = document.createElement("div");
      title.style.fontWeight = "bold";
      title.textContent = name;
      card.appendChild(title);

      const detail = document.createElement("div");
      detail.style.cssText = "font-size:11px;color:#fbb;white-space:pre-wrap;";
      detail.textContent = `${userFacingReviewStatus(row["判定"])}\n${row["理由"] || ""}`;
      card.appendChild(detail);

      const actions = document.createElement("div");
      actions.style.cssText = "display:flex;flex-wrap:wrap;gap:5px;margin-top:5px;";

      const playerId = norm(row["TournamentId"]);
      const playerUrl = normalizeCacheUrl(playerId, row["URL"]);
      if (playerId && playerUrl) {
        const open = document.createElement("button");
        open.textContent = `打开玩家页面URL ${playerId}`;
        open.onclick = () => window.open(playerUrl, "_blank");
        actions.appendChild(open);

        const adopt = document.createElement("button");
        adopt.textContent = `采用 ${playerId} 并清除旧记录`;
        adopt.style.background = "#bff0c2";
        adopt.onclick = () => confirmAndRepairCache(name, playerId, playerUrl, "player-page");
        actions.appendChild(adopt);
      }

      for (const cached of getSharedCacheMatchesByName(name)) {
        if (cached.tournamentId === playerId) continue;

        const open = document.createElement("button");
        open.textContent = `打开Cache URL ${cached.tournamentId}`;
        open.onclick = () => window.open(cached.url, "_blank");
        actions.appendChild(open);

        const adopt = document.createElement("button");
        adopt.textContent = `采用Cache ${cached.tournamentId}`;
        adopt.onclick = () => confirmAndRepairCache(name, cached.tournamentId, cached.url, "shared-cache");
        actions.appendChild(adopt);
      }

      const skip = document.createElement("button");
      skip.textContent = "本次暂不处理";
      skip.onclick = () => skipCandidateForThisRun(name);
      actions.appendChild(skip);

      card.appendChild(actions);
      box.appendChild(card);
    }
  }

  function getUseCandidateRows() {
    return parseTsv(getCandidateText()).filter(row => {
      const use = norm(row["本次处理"] || row["USE"]);
      return use === "使用" || use === "1" || use.toUpperCase() === "TRUE" || use.toUpperCase() === "Y" || use === "〇" || use === "○";
    });
  }

  async function resolveUrlForCandidates() {
    if (running) {
      alert("処理中です");
      return;
    }

    const candidates = parseTsv(getCandidateText());
    const unresolvedStatuses = ["URL未解決", "URL_NOT_FOUND", "URL_CACHE_BAD_ROW", "URL_AMBIGUOUS", "AMBIGUOUS"];
    const targets = candidates.filter(row =>
      row["大会名"] &&
      (!row["TournamentId"] || !row["URL"] || unresolvedStatuses.includes(row["判定"]))
    );

    if (!targets.length) {
      alert("URL未解決の候補はありません。");
      return;
    }

    if (!confirm(`URL未解決・疑似汚染候補を OPEN / CLOSED 両方の大会一覧で検索します。\n\n対象：${targets.length}件\n\n続行しますか？`)) return;

    running = true;
    stopRequested = false;

    let closedWin = null;
    let openWin = null;
    let okCount = 0;
    let ngCount = 0;
    let ambiguousCount = 0;

    try {
      setStatus("OPEN / CLOSED大会一覧を開いています...");
      await Promise.all([
        openTournamentListWindow("/cb/torneio/fechados", "closed").then(win => { closedWin = win; }),
        openTournamentListWindow("/cb/torneio/abertos", "open").then(win => { openWin = win; })
      ]);

      const targetGroups = new Map();
      for (const row of targets) {
        const name = cleanTournamentName(row["大会名"]);
        if (!name) continue;
        const key = compact(name);
        if (!targetGroups.has(key)) targetGroups.set(key, { name, rows: [] });
        targetGroups.get(key).rows.push(row);
      }

      const groups = Array.from(targetGroups.values());
      const prefixGroups = new Map();
      for (const group of groups) {
        const prefix = getEventPrefixFromTournamentName(group.name);
        if (!prefixGroups.has(prefix)) prefixGroups.set(prefix, []);
        prefixGroups.get(prefix).push(group);
      }

      const prefixEntries = Array.from(prefixGroups.entries());
      for (let i = 0; i < prefixEntries.length; i++) {
        if (stopRequested) break;

        const [prefix, prefixTargets] = prefixEntries[i];
        setStatus(`URL一括検索 ${i + 1}/${prefixEntries.length}: ${prefix} (${prefixTargets.length}大会名)`);

        const collected = [];
        try {
          collected.push(...await collectEventPrefixRowsAllPages(closedWin, prefix, "closed"));
        } catch (e) {
          warn("closed prefix search error", e);
        }
        try {
          collected.push(...await collectEventPrefixRowsAllPages(openWin, prefix, "open"));
        } catch (e) {
          warn("open prefix search error", e);
        }

        for (const group of prefixTargets) {
          const name = group.name;
          const found = findExactTournamentFromCollected(collected, name);

          if (!found) {
            for (const row of group.rows) {
              row["判定"] = "URL_NOT_FOUND";
              row["理由"] = `${prefix} 一括検索で完全一致なし`;
            }
            ngCount += group.rows.length;
            continue;
          }

          if (found.error === "AMBIGUOUS") {
            for (const row of group.rows) {
              row["判定"] = "AMBIGUOUS";
              row["理由"] = `${found.candidates.length} exact candidates`;
            }
            ambiguousCount += group.rows.length;
            console.table(found.candidates);
            continue;
          }

          for (const row of group.rows) {
            row["本次处理"] = "使用";
            delete row["USE"];
            row["TournamentId"] = found.tournamentId;
            row["URL"] = found.url;
            row["判定"] = found.source === "closed" ? "OK_SEARCH_CLOSED" : "OK_SEARCH_OPEN";
            row["理由"] = "";
          }

          setSharedCacheItem(name, {
            tournamentId: found.tournamentId,
            url: found.url,
            actualName: found.actualName || name,
            matchedRow: found.matchedRow || "",
            source: `manual-v1.7-prefix-${found.source}`
          });

          okCount += group.rows.length;
        }
      }

      setCandidateRows(candidates);
      alert(`URL検索完了\n\nOK: ${okCount}\nNOT_FOUND: ${ngCount}\nAMBIGUOUS: ${ambiguousCount}`);
      setStatus("URL検索完了");

    } catch (e) {
      console.error(e);
      alert("ERROR: " + (e.message || String(e)));
      setStatus("ERROR: " + (e.message || String(e)));

    } finally {
      try { if (closedWin && !closedWin.closed) closedWin.close(); } catch (_) {}
      try { if (openWin && !openWin.closed) openWin.close(); } catch (_) {}
      running = false;
      stopRequested = false;
    }
  }

  async function fetchRegistroInformacoes(tournamentId) {
    return await postForm("/cb/torneio/abas/registros/informacoes", { id_torneio: String(tournamentId) });
  }

  async function fetchDadosCaixa(idJogador, idTorneio) {
    return await postForm("/cb/torneio/abas/caixa/dados_caixa", {
      id_jogador: String(idJogador),
      id_torneio: String(idTorneio),
      premiacao_origem: "0"
    });
  }

  async function fetchInformacoes(idVenda, idJogador, idTorneio) {
    return await postForm("/cb/torneio/abas/caixa/informacoes", {
      id_venda: String(idVenda),
      id_jogador: String(idJogador),
      id_torneio: String(idTorneio)
    });
  }

  function parsePlayersFromTournamentHtml(html, tournamentId) {
    const players = [];
    const doc = parseHtml(html);

    for (const tr of Array.from(doc.querySelectorAll("tr"))) {
      const trHtml = tr.outerHTML || "";
      const m = trHtml.match(/abrirCadastro\(\s*(\d+)\s*,\s*(\d+)\s*,\s*1\s*\)/);
      if (!m) continue;

      const idJogador = m[1];
      const idTorneio = m[2] || tournamentId;
      const text = norm(tr.innerText || tr.textContent || "");
      const gameIdMatch = text.match(/\b\d{4}\.\d{4}\b/);
      const rawGameId = gameIdMatch ? gameIdMatch[0].replace(".", "") : "";
      if (!rawGameId) continue;

      players.push({
        raw_game_id: rawGameId,
        search_game_id: rawToSearchGameId(rawGameId),
        player_name: "",
        id_jogador: idJogador,
        id_torneio: idTorneio,
        row_text: text
      });
    }

    return players;
  }

  function findHeaderIndex(headers, patterns) {
    return headers.findIndex(h => patterns.some(p => h.includes(p)));
  }

  function parseCashRecords(html) {
    const doc = parseHtml(html);
    const tables = Array.from(doc.querySelectorAll("table"));
    let targetTable = null;
    let headerRow = null;

    for (const table of tables) {
      for (const tr of Array.from(table.querySelectorAll("tr"))) {
        const ths = Array.from(tr.querySelectorAll("th")).map(th => norm(th.innerText || th.textContent || ""));
        const joined = ths.join(" ");
        if (joined.includes("時間") && joined.includes("購入") && joined.includes("ユーザー")) {
          targetTable = table;
          headerRow = tr;
          break;
        }
      }
      if (targetTable) break;
    }

    if (!targetTable || !headerRow) return [];

    const headers = Array.from(headerRow.querySelectorAll("th")).map(th => norm(th.innerText || th.textContent || ""));
    const timeIndex = findHeaderIndex(headers, ["時間"]);
    const purchaseIndex = findHeaderIndex(headers, ["購入", "引き出し"]);
    const enIndex = headers.findIndex(h => h === "En" || h.includes("En"));
    const reIndex = headers.findIndex(h => h === "Re" || h.includes("Re"));
    const userIndex = findHeaderIndex(headers, ["ユーザー"]);

    const allRows = Array.from(targetTable.querySelectorAll("tr"));
    const dataRows = allRows.slice(allRows.indexOf(headerRow) + 1);
    const records = [];

    for (const tr of dataRows) {
      const tds = Array.from(tr.querySelectorAll("td"));
      if (tds.length < 2) continue;

      const time = timeIndex >= 0 ? norm(tds[timeIndex]?.innerText) : norm(tds[0]?.innerText);
      const purchaseAmount = purchaseIndex >= 0 ? cleanNumber(tds[purchaseIndex]?.innerText) : cleanNumber(tds[1]?.innerText);
      if (!time) continue;

      const trHtml = tr.outerHTML || "";
      const vendaMatch = trHtml.match(/informacoes_venda\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);

      const idVenda = vendaMatch ? vendaMatch[1] : "";
      const idJogadorFromVenda = vendaMatch ? vendaMatch[2] : "";
      const idTorneioFromVenda = vendaMatch ? vendaMatch[3] : "";
      const enCount = enIndex >= 0 ? toNumber(tds[enIndex]?.innerText) : 0;
      const reCount = reIndex >= 0 ? toNumber(tds[reIndex]?.innerText) : 0;
      const user = userIndex >= 0 ? norm(tds[userIndex]?.innerText) : "";
      const itemPairs = [];

      for (let i = 0; i < headers.length && i < tds.length; i++) {
        const h = headers[i];
        if (!h) continue;
        if (i === timeIndex || i === purchaseIndex || i === enIndex || i === reIndex || i === userIndex) continue;
        const val = cleanNumber(tds[i]?.innerText);
        if (val && Number(val) !== 0) itemPairs.push(`${h}:${val}`);
      }

      records.push({
        time,
        purchase_amount: purchaseAmount,
        purchase_amount_num: toNumber(purchaseAmount),
        en_count: enCount,
        re_count: reCount,
        item_summary: itemPairs.join("|"),
        user,
        id_venda: idVenda,
        id_jogador_from_venda: idJogadorFromVenda,
        id_torneio_from_venda: idTorneioFromVenda,
        row_text: norm(tr.innerText || tr.textContent || "")
      });
    }

    return records;
  }

  function parseInformacoes(html) {
    const doc = parseHtml(html);
    const text = norm(doc.body.innerText || doc.body.textContent || "");
    const lines = (doc.body.innerText || doc.body.textContent || "")
      .split(/\r?\n/)
      .map(s => norm(s))
      .filter(Boolean);

    function isSectionTitle(line) {
      return line.includes("財務の移動") || line.includes("セール商品");
    }

    function isSkipLine(line) {
      return !line || line.includes("説明") || line.includes("金額") || line === "-" || line === "—";
    }

    function amountFromLine(line) {
      const m = String(line).match(/¥\s*([-\d,]+)/);
      return m ? cleanNumber(m[1]) : "";
    }

    function cleanDesc(line) {
      return norm(String(line).replace(/¥\s*[-\d,]+/g, ""));
    }

    function collectSection(sectionTitle) {
      const start = lines.findIndex(line => line === sectionTitle || line.includes(sectionTitle));
      if (start < 0) return [];

      const rows = [];
      for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i];
        if (isSectionTitle(line) && !line.includes(sectionTitle)) break;
        if (isSkipLine(line)) continue;

        const sameLineAmount = amountFromLine(line);
        if (sameLineAmount) {
          const desc = cleanDesc(line);
          if (desc) rows.push({ desc, amount: sameLineAmount });
          continue;
        }

        const next = lines[i + 1] || "";
        const nextAmount = amountFromLine(next);
        if (nextAmount) {
          rows.push({ desc: line, amount: nextAmount });
          i++;
          continue;
        }

        rows.push({ desc: line, amount: "" });
      }
      return rows;
    }

    const financeRows = collectSection("財務の移動");
    const saleRows = collectSection("セール商品");

    return {
      financeRows,
      saleRows,
      payment_method: financeRows.map(r => r.desc).filter(Boolean).join("|"),
      payment_amount: financeRows.map(r => r.amount).filter(Boolean).join("|"),
      sale_item: saleRows.map(r => r.desc).filter(Boolean).join("|"),
      sale_amount: saleRows.map(r => r.amount).filter(Boolean).join("|"),
      info_text: text
    };
  }

  function isIgnoredText(text) {
    const s = norm(text);
    return s.includes("使用済みチケット") || s.includes("選手契約履行") || s.includes("プライズ") || s.includes("ITM");
  }

  function detectTypeFromRecord(rec, info) {
    if (rec.re_count > 0) return "Re";
    if (rec.en_count > 0) return "En";

    const saleText = norm([
      info?.sale_item || "",
      ...(info?.saleRows || []).map(r => r.desc || ""),
      rec?.item_summary || ""
    ].join(" "));

    if (/Re\s*Entry/i.test(saleText) || /\bRe\b/i.test(saleText) || saleText.includes("Re:")) return "Re";
    if (/Entry/i.test(saleText) || /\bEn\b/i.test(saleText) || saleText.includes("En:")) return "En";
    return "";
  }

  function addPaymentToColumns(cols, method, amount) {
    const desc = norm(method);
    const n = toNumber(amount);
    if (!n) return;

    if (n < 0 || isIgnoredText(desc)) {
      cols.__ignored_payment.push(`${desc}:${n}`);
      return;
    }

    if (desc.includes("現金")) {
      cols["現金"] += n;
      return;
    }

    if (desc.includes("クレジット") || desc.toLowerCase().includes("credit")) {
      cols["クレジットカード"] += n;
      return;
    }

    if (desc.includes("コイン") || desc.includes("ポイント") || desc.toLowerCase().includes("coin")) {
      cols["ポイント"] += n;
      return;
    }

    if (desc.toUpperCase().includes("USDT") || desc.toUpperCase().includes("USD")) {
      cols["USDT"] += n;
      return;
    }

    cols.__unknown_payment.push(`${desc}:${n}`);
  }

  function makeColsFromFinanceRows(financeRows) {
    const cols = {
      "現金": 0,
      "クレジットカード": 0,
      "ポイント": 0,
      "USDT": 0,
      __unknown_payment: [],
      __ignored_payment: []
    };

    for (const fr of financeRows || []) addPaymentToColumns(cols, fr.desc, fr.amount);
    return cols;
  }

  function classifyDetailToOutput(detail) {
    const dateParts = parsePurchaseDateParts(detail.time);
    const cols = makeColsFromFinanceRows(detail.financeRows || []);
    const knownPaymentTotal = Number(cols["現金"] || 0) + Number(cols["クレジットカード"] || 0) + Number(cols["ポイント"] || 0) + Number(cols["USDT"] || 0);

    const base = {
      "Game ID": detail.raw_game_id,
      "購入時間": detail.time,
      "年": dateParts["年"],
      "月": dateParts["月"],
      "日": dateParts["日"],
      "大会名": cleanTournamentName(detail.tournamentName),
      "種別": detail.type || "",
      "現金": cols["現金"],
      "クレジットカード": cols["クレジットカード"],
      "ポイント": cols["ポイント"],
      "USDT": cols["USDT"],
      __targetIndex: detail.targetIndex,
      __sortTime: parseTimeSortValue(detail.time),
      __sortTournamentNo: detail.tournamentNo,
      __tournamentId: detail.tournamentId,
      __unique_key: `${detail.raw_game_id}_${detail.tournamentId}_${detail.id_venda || detail.time || ""}`
    };

    if (detail.purchase_amount_num <= 0) return { kind: "IGNORE", reason: "購入・引き出しが0以下", row: base };

    if (cols.__unknown_payment.length > 0) {
      return { kind: "NEED_CHECK", reason: "支払い方法確認", message: `支払い方法が自動分類できません：${cols.__unknown_payment.join("|")}`, row: base };
    }

    if (knownPaymentTotal <= 0) {
      return { kind: "NEED_CHECK", reason: "支払い金額確認", message: "購入金額はありますが、現金・クレジットカード・ポイント・USDTの金額が取得できませんでした。", row: base };
    }

    return { kind: "PASTE", reason: "OK", row: base };
  }

  async function fetchDetailsForPlayer(player, tournament, targetIndex) {
    const rows = [];

    try {
      const caixaHtml = await fetchDadosCaixa(player.id_jogador, player.id_torneio);
      const records = parseCashRecords(caixaHtml);

      if (!records.length) {
        return [{
          tournamentNo: tournament.tournamentNo,
          tournamentName: tournament.fullName,
          tournamentId: tournament.tournamentId,
          raw_game_id: player.raw_game_id,
          targetIndex,
          id_jogador: player.id_jogador,
          id_torneio: player.id_torneio,
          time: "",
          purchase_amount_num: 0,
          id_venda: "",
          type: "",
          financeRows: [],
          saleRows: [],
          status: "NO_CASH_RECORD",
          error: ""
        }];
      }

      for (const rec of records) {
        if (rec.purchase_amount_num <= 0) {
          rows.push({
            tournamentNo: tournament.tournamentNo,
            tournamentName: tournament.fullName,
            tournamentId: tournament.tournamentId,
            raw_game_id: player.raw_game_id,
            targetIndex,
            id_jogador: player.id_jogador,
            id_torneio: player.id_torneio,
            time: rec.time,
            purchase_amount_num: rec.purchase_amount_num,
            id_venda: rec.id_venda,
            type: "",
            financeRows: [],
            saleRows: [],
            status: "IGNORE_NON_PURCHASE",
            error: ""
          });
          continue;
        }

        let info = { financeRows: [], saleRows: [], payment_method: "", payment_amount: "", sale_item: "", sale_amount: "" };
        let infoError = "";

        if (CONFIG.fetchInformacoes && rec.id_venda) {
          try {
            await sleep(CONFIG.betweenDetailFetchMs);
            const infoHtml = await fetchInformacoes(rec.id_venda, player.id_jogador, player.id_torneio);
            info = parseInformacoes(infoHtml);
          } catch (e) {
            infoError = e?.message || String(e);
          }
        }

        rows.push({
          tournamentNo: tournament.tournamentNo,
          tournamentName: tournament.fullName,
          tournamentId: tournament.tournamentId,
          raw_game_id: player.raw_game_id,
          targetIndex,
          id_jogador: player.id_jogador,
          id_torneio: player.id_torneio,
          time: rec.time,
          purchase_amount_num: rec.purchase_amount_num,
          id_venda: rec.id_venda,
          type: detectTypeFromRecord(rec, info),
          financeRows: info.financeRows || [],
          saleRows: info.saleRows || [],
          status: infoError ? `INFO_FETCH_ERROR: ${infoError}` : "OK",
          error: infoError
        });
      }

      return rows;

    } catch (e) {
      return [{
        tournamentNo: tournament.tournamentNo,
        tournamentName: tournament.fullName,
        tournamentId: tournament.tournamentId,
        raw_game_id: player.raw_game_id,
        targetIndex,
        id_jogador: player.id_jogador,
        id_torneio: player.id_torneio,
        time: "",
        purchase_amount_num: 0,
        id_venda: "",
        type: "",
        financeRows: [],
        saleRows: [],
        status: `DETAIL_FETCH_ERROR: ${e.message}`,
        error: e?.message || String(e)
      }];
    }
  }

  async function scanTournament(tournament, targetSet, targetIndexMap) {
    const result = {
      tournamentNo: tournament.tournamentNo,
      tournamentName: cleanTournamentName(tournament.name),
      tournamentId: tournament.tournamentId,
      url: tournament.url,
      status: "INIT",
      candidateRows: 0,
      parsedPlayers: 0,
      hitPlayers: 0,
      pasteRows: [],
      needCheckRows: [],
      ignoredRows: 0,
      error: ""
    };

    try {
      setStatus(`大会データ取得中：${tournament.name}`);
      const registroHtml = await fetchRegistroInformacoes(tournament.tournamentId);
      const players = parsePlayersFromTournamentHtml(registroHtml, tournament.tournamentId);

      result.candidateRows = players.length;
      result.parsedPlayers = players.length;

      const hitPlayers = players.filter(player => targetSet.has(player.raw_game_id));
      result.hitPlayers = hitPlayers.length;

      for (let i = 0; i < hitPlayers.length; i++) {
        const player = hitPlayers[i];
        const targetIndex = targetIndexMap[player.raw_game_id] ?? 999999;
        setStatus(`${tournament.name}: 明細取得 ${i + 1}/${hitPlayers.length} / ${player.raw_game_id}`);

        const details = await fetchDetailsForPlayer(player, tournament, targetIndex);

        for (const d of details) {
          if (d.status === "IGNORE_NON_PURCHASE") {
            result.ignoredRows++;
            continue;
          }

          if (d.status === "NO_CASH_RECORD") {
            result.needCheckRows.push({
              "Game ID": d.raw_game_id,
              "購入時間": "",
              "大会名": cleanTournamentName(d.tournamentName),
              "確認区分": "購入明細なし",
              "確認内容": "大会のプレイヤー一覧には存在しますが、購入・支払い明細がありません。",
              __tournamentId: d.tournamentId,
              __unique_key: `${d.raw_game_id}_${d.tournamentId}_NO_CASH_RECORD`,
              __targetIndex: d.targetIndex,
              __sortTime: 999999999999,
              __sortTournamentNo: d.tournamentNo
            });
            continue;
          }

          if (d.status !== "OK") {
            result.needCheckRows.push({
              "Game ID": d.raw_game_id,
              "購入時間": d.time,
              "大会名": cleanTournamentName(d.tournamentName),
              "確認区分": "取得エラー",
              "確認内容": d.error || d.status,
              __tournamentId: d.tournamentId,
              __unique_key: `${d.raw_game_id}_${d.tournamentId}_${d.id_venda || d.time || d.status}`,
              __targetIndex: d.targetIndex,
              __sortTime: parseTimeSortValue(d.time),
              __sortTournamentNo: d.tournamentNo
            });
            continue;
          }

          const classified = classifyDetailToOutput(d);

          if (classified.kind === "PASTE") {
            result.pasteRows.push(classified.row);
          } else if (classified.kind === "NEED_CHECK") {
            result.needCheckRows.push({
              "Game ID": d.raw_game_id,
              "購入時間": d.time,
              "大会名": cleanTournamentName(d.tournamentName),
              "確認区分": classified.reason,
              "確認内容": classified.message || classified.reason,
              __tournamentId: d.tournamentId,
              __unique_key: `${d.raw_game_id}_${d.tournamentId}_${d.id_venda || d.time || classified.reason}`,
              __targetIndex: d.targetIndex,
              __sortTime: parseTimeSortValue(d.time),
              __sortTournamentNo: d.tournamentNo
            });
          } else {
            result.ignoredRows++;
          }
        }
      }

      result.status = "DONE";
      return result;

    } catch (e) {
      result.status = "ERROR";
      result.error = e?.message || String(e);
      return result;
    }
  }

  function makeReportRowFromResult(r, targetCount) {
    let resultText = "完了";
    let note = "正常に完了しました";

    if (r.status !== "DONE") {
      resultText = "確認必要";
      note = r.error || r.status;
    } else if (r.needCheckRows.length > 0) {
      note = `確認必要：${r.needCheckRows.length}件`;
    }

    return {
      "大会番号": r.tournamentNo ? `#${r.tournamentNo}` : "",
      "大会名": cleanTournamentName(r.tournamentName),
      "処理結果": resultText,
      "対象Game ID数": targetCount,
      "該当プレイヤー数": r.hitPlayers,
      "出力行数": r.pasteRows.length,
      "確認必要件数": r.needCheckRows.length,
      "対象外件数": r.ignoredRows,
      "読込人数": r.parsedPlayers,
      "備考": note
    };
  }

  function dedupeRowsByKey(rows) {
    const seen = new Set();
    const out = [];
    for (const row of rows || []) {
      const key = row.__unique_key || JSON.stringify(row);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    return out;
  }

  function sortRows(rows) {
    return Array.from(rows || []).sort((a, b) => {
      const ai = Number(a.__targetIndex ?? 9999999);
      const bi = Number(b.__targetIndex ?? 9999999);
      if (ai !== bi) return ai - bi;

      const at = Number(a.__sortTime ?? 999999999999);
      const bt = Number(b.__sortTime ?? 999999999999);
      if (at !== bt) return at - bt;

      const an = Number(a.__sortTournamentNo ?? 999999);
      const bn = Number(b.__sortTournamentNo ?? 999999);
      return an - bn;
    });
  }

  function buildFinalOutput(pasteRows, needCheckRows, reportRows) {
    const pasteHeaders = ["Game ID", "購入時間", "年", "月", "日", "大会名", "種別", "現金", "クレジットカード", "ポイント", "USDT"];
    const needCheckHeaders = ["Game ID", "購入時間", "大会名", "確認区分", "確認内容"];
    const reportHeaders = ["大会番号", "大会名", "処理結果", "対象Game ID数", "該当プレイヤー数", "出力行数", "確認必要件数", "対象外件数", "読込人数", "備考"];

    const sortedPaste = sortRows(dedupeRowsByKey(pasteRows)).map(r => ({
      "Game ID": r["Game ID"],
      "購入時間": r["購入時間"],
      "年": r["年"],
      "月": r["月"],
      "日": r["日"],
      "大会名": cleanTournamentName(r["大会名"]),
      "種別": r["種別"],
      "現金": r["現金"],
      "クレジットカード": r["クレジットカード"],
      "ポイント": r["ポイント"],
      "USDT": r["USDT"]
    }));

    const sortedNeedCheck = sortRows(dedupeRowsByKey(needCheckRows)).map(r => ({
      "Game ID": r["Game ID"],
      "購入時間": r["購入時間"],
      "大会名": cleanTournamentName(r["大会名"]),
      "確認区分": r["確認区分"],
      "確認内容": r["確認内容"]
    }));

    const report = Array.from(reportRows || []).map(r => ({
      "大会番号": r["大会番号"],
      "大会名": cleanTournamentName(r["大会名"]),
      "処理結果": r["処理結果"],
      "対象Game ID数": r["対象Game ID数"],
      "該当プレイヤー数": r["該当プレイヤー数"],
      "出力行数": r["出力行数"],
      "確認必要件数": r["確認必要件数"],
      "対象外件数": r["対象外件数"],
      "読込人数": r["読込人数"],
      "備考": r["備考"]
    }));

    const pasteText = toTsv(sortedPaste, pasteHeaders);

    return {
      pasteText,
      allText: [
        pasteText,
        "",
        "===== NEED_CHECK =====",
        toTsv(sortedNeedCheck, needCheckHeaders),
        "",
        "===== REPORT =====",
        toTsv(report, reportHeaders)
      ].join("\n"),
      pasteCount: sortedPaste.length,
      needCheckCount: sortedNeedCheck.length,
      reportCount: report.length
    };
  }

  function getOutputCopyText(outputText) {
    const cleanOutputText = String(outputText || "").replace(/^===== PASTE_ROWS =====\r?\n/, "");
    const mode = document.querySelector("#pw-manual-copy-mode")?.value || "paste-only";
    if (mode === "with-report") return cleanOutputText;

    return cleanOutputText.split(/\n===== NEED_CHECK =====\n/, 1)[0].trimEnd();
  }

  async function runDiscoverCandidates() {
    if (running) {
      alert("処理中です");
      return;
    }

    const inputText = document.querySelector("#pw-manual-input")?.value || "";
    const dateRange = norm(document.querySelector("#pw-manual-date-range")?.value || CONFIG.defaultDateRange);
    const tasks = parseManualTasks(inputText);

    if (!tasks.length) {
      alert("入力が空、または形式が不正です。\n例：51763548 【JOPT 2026 Grand Final】");
      return;
    }

    if (!confirm(`候補大会をAPI検索します。\n\n対象タスク：${tasks.length}件\n検索期間：${dateRange}\n\n続行しますか？`)) return;

    running = true;
    stopRequested = false;

    try {
      localStorage.setItem(CONFIG.inputKey, inputText);
      localStorage.setItem(CONFIG.dateRangeKey, dateRange);

      const candidates = await discoverCandidatesFromTasks(tasks, dateRange);
      setCandidateRows(candidates);

      const existingCount = candidates.filter(r => ["OK_CACHE", "OK_PLAYER_PAGE_CACHE_MATCH"].includes(r["判定"])).length;
      const addedCount = candidates.filter(r => r["判定"] === "OK_PLAYER_PAGE").length;
      const pollutionCount = candidates.filter(r => r["判定"] === "URL_CACHE_POLLUTION_SUSPECT").length;
      const conflictCount = candidates.filter(r => ["URL_AMBIGUOUS", "AMBIGUOUS"].includes(r["判定"])).length;
      const reviewCount = getManualReviewRows(candidates).length;

      alert(
        `候補検索完了\n\n` +
        `符合条件比赛：${candidates.filter(r => r["大会名"]).length}\n` +
        `已有URL且一致：${existingCount}\n` +
        `新增URL：${addedCount}\n` +
        `疑似污染：${pollutionCount}\n` +
        `重名冲突：${conflictCount}\n` +
        `需要人工确认：${reviewCount}`
      );

      setStatus("候補検索完了");

    } catch (e) {
      console.error(e);
      alert("ERROR: " + (e.message || String(e)));
      setStatus("ERROR: " + (e.message || String(e)));

    } finally {
      running = false;
      stopRequested = false;
    }
  }

  async function runPaymentFromCandidates() {
    if (running) {
      alert("処理中です");
      return;
    }

    const allRows = parseTsv(getCandidateText());
    const pendingReview = getManualReviewRows(allRows);
    if (pendingReview.length) {
      alert(`人工確認が未完了の候補があります。\n\n対象：${pendingReview.length}件\n\n人工核查欄で確認・修復してください。`);
      return;
    }

    const rows = getUseCandidateRows();
    if (!rows.length) {
      alert("本次处理设为“使用”的比赛为空。");
      return;
    }

    const unsafe = rows.filter(r => MANUAL_REVIEW_STATUSES.has(r["判定"]));
    if (unsafe.length) {
      alert(`URLが安全確定していない候補があります。\n\n対象：${unsafe.length}件\n\nURL未解決検索または候補欄の修正後に再実行してください。`);
      return;
    }

    const usable = rows.filter(r => r["Game ID"] && r["大会名"] && r["TournamentId"] && r["URL"]);
    if (!usable.length) {
      alert("使用可能な候補がありません。TournamentId / URL を確認してください。");
      return;
    }

    if (!confirm(`从已确认使用的比赛取得支付信息。\n\n本次处理：${usable.length}行\n\n继续吗？`)) return;

    running = true;
    stopRequested = false;

    try {
      const gameIds = [];
      const targetIndexMap = {};
      const gameIdSet = new Set();

      for (const row of usable) {
        const gid = normalizeGameId(row["Game ID"]);
        if (!gid) continue;

        if (!gameIdSet.has(gid)) {
          targetIndexMap[gid] = gameIds.length;
          gameIds.push(gid);
          gameIdSet.add(gid);
        }
      }

      const targetSet = new Set(gameIds);
      const tournamentMap = new Map();

      for (const row of usable) {
        const tournamentId = norm(row["TournamentId"]);
        const name = cleanTournamentName(row["大会名"]);
        const url = row["URL"] || getTournamentUrl(tournamentId);

        if (!tournamentId || !name) continue;

        if (!tournamentMap.has(tournamentId)) {
          tournamentMap.set(tournamentId, {
            tournamentNo: getTournamentNoFromName(name),
            tournamentId,
            name,
            fullName: name,
            url
          });
        }

        setSharedCacheItem(name, {
          tournamentId,
          url,
          actualName: name,
          matchedRow: row["大会名"] || "",
          source: "manual-v1.5-confirmed"
        });
      }

      const tournaments = Array.from(tournamentMap.values());
      const pasteRows = [];
      const needCheckRows = [];
      const reportRows = [];

      for (let i = 0; i < tournaments.length; i++) {
        if (stopRequested) break;

        const t = tournaments[i];
        setStatus(`支払い取得 ${i + 1}/${tournaments.length}: ${t.name}`);

        const result = await scanTournament(t, targetSet, targetIndexMap);

        pasteRows.push(...result.pasteRows);
        needCheckRows.push(...result.needCheckRows);
        reportRows.push(makeReportRowFromResult(result, gameIds.length));

        await sleep(CONFIG.betweenTournamentMs);
      }

      const output = buildFinalOutput(pasteRows, needCheckRows, reportRows);
      const outBox = document.querySelector("#pw-manual-output");
      if (outBox) outBox.value = output.allText;

      localStorage.setItem(CONFIG.outputKey, output.allText);
      copyText(getOutputCopyText(output.allText));

      alert(
        `支払い取得完了\n\n` +
        `PASTE_ROWS：${output.pasteCount}\n` +
        `NEED_CHECK：${output.needCheckCount}\n` +
        `REPORT：${output.reportCount}\n\n` +
        `選択中の形式で結果をコピーしました。`
      );

      setStatus("支払い取得完了");

    } catch (e) {
      console.error(e);
      alert("ERROR: " + (e.message || String(e)));
      setStatus("ERROR: " + (e.message || String(e)));

    } finally {
      running = false;
      stopRequested = false;
    }
  }

  function stopRun() {
    stopRequested = true;
    setStatus("停止要求：現在処理中の1件が終わったら停止します");
  }

  function copyCandidates() {
    copyText(getCandidateText());
    alert("候補TSVをコピーしました。");
  }

  function copyOutput() {
    const text = document.querySelector("#pw-manual-output")?.value || "";
    copyText(getOutputCopyText(text));
    alert("選択中の形式で出力をコピーしました。");
  }

  function copySharedCache() {
    const text = cacheToTsv();
    copyText(text);
    alert(`共有URL Cache TSVをコピーしました。\n件数：${cacheToRows().length}`);
  }

  function addPanel() {
    if (document.querySelector("#pw-manual-panel")) return;

    const savedInput = localStorage.getItem(CONFIG.inputKey) || "";
    const savedCandidate = localStorage.getItem(CONFIG.candidateKey) || CANDIDATE_HEADERS.join("\t");
    const savedDateRange = localStorage.getItem(CONFIG.dateRangeKey) || CONFIG.defaultDateRange;
    const savedOutput = localStorage.getItem(CONFIG.outputKey) || "";
    const savedCopyMode = localStorage.getItem(CONFIG.copyModeKey) || "paste-only";

    const panel = document.createElement("div");
    panel.id = "pw-manual-panel";
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
      width: 720px;
      max-height: 94vh;
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="font-weight:bold;">PW 領収書抜き出し 人工確認版 v1.6.13</div>
        <div style="display:flex;gap:4px;">
          <button id="pw-manual-minimize" style="font-size:11px;padding:2px 6px;cursor:pointer;">Min</button>
          <button id="pw-manual-close" style="font-size:11px;padding:2px 6px;cursor:pointer;">x</button>
        </div>
      </div>

      <div id="pw-manual-body">
        <div style="font-size:11px;color:#ccc;line-height:1.35;margin-bottom:6px;">
          入力例：<code>51763548 【JOPT 2026 Grand Final】</code><br>
          候補検索も支払い取得もAPIで取得します。URL Cacheは完整大会名で厳密照合します。<br>
          流れ：候補検索 → 必要な大会を確認 → 人工核查 → 支払い取得
        </div>

        <div id="pw-manual-summary"
          style="background:#17324a;border:1px solid #477;padding:7px;color:#cff;font-weight:bold;margin-bottom:6px;">
          尚未搜索
        </div>

        <div style="font-size:12px;font-weight:bold;">検索期間 / dateRange</div>
        <input id="pw-manual-date-range"
          style="width:100%;background:#111;color:#fff;border:1px solid #555;padding:7px;font-family:Consolas,monospace;font-size:12px;" />

        <div style="font-size:12px;font-weight:bold;margin-top:6px;">Input: Game ID + 対象キーワード</div>
        <textarea id="pw-manual-input"
          placeholder="51763548 【JOPT 2026 Grand Final】"
          style="width:100%;height:100px;background:#111;color:#fff;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

        <div style="display:flex;gap:6px;margin-top:6px;">
          <button id="pw-manual-discover" style="flex:1;padding:7px;cursor:pointer;background:#ffe08a;border:1px solid #c99;">1. 候補大会をAPI検索</button>
          <button id="pw-manual-resolve-url" style="flex:1;padding:7px;cursor:pointer;background:#d9ecff;border:1px solid #88a;">2. URL未解決/疑似汚染を検索</button>
          <button id="pw-manual-run-payment" style="flex:1;padding:7px;cursor:pointer;background:#bff0c2;border:1px solid #8a8;">3. 已确认比赛的支付信息</button>
        </div>

        <div style="display:flex;gap:6px;margin-top:6px;">
          <button id="pw-manual-stop" style="flex:1;padding:7px;cursor:pointer;background:#f3cccc;border:1px solid #c88;">Stop</button>
          <button id="pw-manual-copy-candidates" style="flex:1;padding:7px;cursor:pointer;background:#eee;border:1px solid #aaa;">Copy Candidates</button>
          <button id="pw-manual-copy-cache" style="flex:1;padding:7px;cursor:pointer;background:#eee;border:1px solid #aaa;">Copy Shared URL Cache</button>
        </div>

        <div style="font-size:12px;font-weight:bold;margin-top:6px;">Candidates / 候補確認欄</div>
        <textarea id="pw-manual-candidates"
          style="width:100%;height:165px;background:#111;color:#fff;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

        <div style="font-size:12px;font-weight:bold;margin-top:6px;">人工核查 / 仅显示需要确认的比赛</div>
        <div id="pw-manual-review"
          style="max-height:220px;overflow:auto;background:#181818;border:1px solid #555;padding:6px;font-size:12px;"></div>

        <div style="font-size:12px;font-weight:bold;margin-top:6px;">Output / TSV + NEED_CHECK + REPORT</div>
        <textarea id="pw-manual-output"
          readonly
          style="width:100%;height:145px;background:#111;color:#fff;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

        <div style="display:flex;gap:6px;margin-top:6px;">
          <select id="pw-manual-copy-mode" style="flex:1;padding:7px;background:#fff;border:1px solid #aaa;">
            <option value="paste-only">只复制可粘贴的领收书结果</option>
            <option value="with-report">复制结果 + NEED_CHECK + REPORT</option>
          </select>
          <button id="pw-manual-copy-output" style="flex:1;padding:7px;cursor:pointer;background:#eee;border:1px solid #aaa;">按所选格式复制</button>
        </div>

        <div id="pw-manual-status" style="font-size:11px;color:#9fe;line-height:1.35;white-space:pre-wrap;margin-top:6px;">ready</div>
      </div>
    `;

    document.body.appendChild(panel);
    document.querySelector("#pw-manual-input").value = savedInput;
    document.querySelector("#pw-manual-candidates").value = savedCandidate;
    document.querySelector("#pw-manual-date-range").value = savedDateRange;
    document.querySelector("#pw-manual-output").value = savedOutput;
    document.querySelector("#pw-manual-copy-mode").value = savedCopyMode;
    document.querySelector("#pw-manual-copy-mode").addEventListener("change", event => {
      localStorage.setItem(CONFIG.copyModeKey, event.target.value);
    });
    renderManualReview(parseTsv(savedCandidate));
    document.querySelector("#pw-manual-candidates").addEventListener("change", () => {
      const text = getCandidateText();
      localStorage.setItem(CONFIG.candidateKey, text);
      renderManualReview(parseTsv(text));
    });

    document.querySelector("#pw-manual-discover").onclick = () => runDiscoverCandidates();
    document.querySelector("#pw-manual-resolve-url").onclick = () => resolveUrlForCandidates();
    document.querySelector("#pw-manual-run-payment").onclick = () => runPaymentFromCandidates();
    document.querySelector("#pw-manual-stop").onclick = () => stopRun();
    document.querySelector("#pw-manual-copy-candidates").onclick = () => copyCandidates();
    document.querySelector("#pw-manual-copy-output").onclick = () => copyOutput();
    document.querySelector("#pw-manual-copy-cache").onclick = () => copySharedCache();

    document.querySelector("#pw-manual-minimize").onclick = () => {
      const body = document.querySelector("#pw-manual-body");
      const btn = document.querySelector("#pw-manual-minimize");
      if (!body || !btn) return;

      const hidden = body.style.display === "none";
      body.style.display = hidden ? "block" : "none";
      btn.textContent = hidden ? "Min" : "Open";
    };

    document.querySelector("#pw-manual-close").onclick = () => {
      const p = document.querySelector("#pw-manual-panel");
      if (p) p.style.display = "none";
    };

    setStatus(`ready / Shared URL Cache: ${cacheToRows().length}件`);
  }

  function boot() {
    addPanel();
    window.PWManualReceiptV15 = {
      loadSharedCache,
      saveSharedCache,
      setSharedCacheItem,
      replaceSharedCacheForName,
      cacheToTsv,
      renderManualReview,
      runDiscoverCandidates,
      resolveUrlForCandidates,
      runPaymentFromCandidates
    };
    log("loaded");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
