// ==UserScript==
// @name         PW Receipt Full Auto v6.0
// @version      6.0.2
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-receipt-full-auto.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-receipt-full-auto.user.js
// @description  申請管理から申請キー単位で読み、PDF管理庫で重複防止する統合版
// @description  SheetからGame IDとイベント設定を読み、PW APIで参加大会・支払い情報を取得してReceiverへ送信する統合版
// @match        https://japanopt.pokerweb.com.br/*
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      docs.google.com
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @connect      japanopt.pokerweb.com.br
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const LS_KEYS = {
    sheetId: "PW_RECEIPT_FULL_AUTO_V5_SHEET_ID",
    autoEnabled: "PW_RECEIPT_FULL_AUTO_V5_AUTO_ENABLED",
    runStatus: "PW_RECEIPT_FULL_AUTO_V5_RUN_STATUS",
    panelCollapsed: "PW_RECEIPT_FULL_AUTO_V5_PANEL_COLLAPSED"
  };

  const CONFIG = {
    eventYear: 2026,

    sheetNames: {
      applications: "申請管理",
      system: "システム設定",
      gameIds: "Game ID入力",
      eventConfig: "イベント設定",
      urlCacheDefault: "大会URL一覧"
    },

    fetchInformacoes: true,
    autoWatchIntervalMs: 180000,

    betweenPlayersDelay: 300,
    betweenTournamentsDelay: 200,
    betweenDetailFetchMs: 80
  };

  const STATE = {
    isRunning: false,
    autoTimer: null,
    nextCheckAt: null
  };

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

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

  function cleanGameId(value) {
    const digits = String(value ?? "").replace(/\D/g, "");
    return digits.length === 8 ? digits : "";
  }

  function rawToSearchGameId(value) {
    const digits = String(value ?? "").replace(/\D/g, "");
    if (digits.length !== 8) return String(value ?? "");
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

  function stripHtml(html) {
    return norm(
      String(html ?? "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(div|tr|td|th|p|li|h1|h2|h3)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#165;/g, "¥")
    );
  }

  function stripHtmlKeepLines(html) {
    return String(html ?? "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(div|tr|td|th|p|li|h1|h2|h3)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#165;/g, "¥");
  }

  function simpleHash(text) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;

    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }

    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return `${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}`;
  }

  function getSheetId() {
    let id = localStorage.getItem(LS_KEYS.sheetId) || "";

    if (!id) {
      const input = prompt("Google Sheet URL または Spreadsheet ID を入力してください");
      if (!input) throw new Error("Spreadsheet ID が未設定です");

      const m = input.match(/\/d\/([a-zA-Z0-9-_]+)/);
      id = m ? m[1] : input.trim();

      localStorage.setItem(LS_KEYS.sheetId, id);
    }

    return id;
  }

  function resetSheetId() {
    localStorage.removeItem(LS_KEYS.sheetId);
    alert("Sheet ID設定をリセットしました。次回実行時に再入力してください。");
  }

  function csvToRows(csv) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < csv.length; i++) {
      const ch = csv[i];
      const next = csv[i + 1];

      if (ch === '"' && inQuotes && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        row.push(cell);
        cell = "";
      } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
        if (ch === "\r" && next === "\n") i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += ch;
      }
    }

    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }

    return rows;
  }

  function fetchSheetCsv(sheetName) {
    const ssid = getSheetId();
    const url = `https://docs.google.com/spreadsheets/d/${ssid}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        onload: res => {
          if (res.status !== 200) {
            reject(new Error(`Sheet読込失敗 ${sheetName}: HTTP ${res.status}`));
            return;
          }

          resolve(csvToRows(res.responseText));
        },
        onerror: reject
      });
    });
  }

  function rowsToObjects(rows) {
    if (!rows.length) return [];

    const headers = rows[0].map(norm);

    return rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = norm(row[i]);
      });
      return obj;
    });
  }

  function getSingleColumnValues(rows) {
    return rows
      .slice(1)
      .map(row => norm(row[0]))
      .filter(Boolean);
  }

  function readKeyValue(rows) {
    const out = {};

    for (const row of rows.slice(1)) {
      const key = norm(row[0]);
      const value = norm(row[1]);
      if (key) out[key] = value;
    }

    return out;
  }

  async function readInputData() {
    const eventRows = await fetchSheetCsv(CONFIG.sheetNames.eventConfig);
    const eventConfig = readKeyValue(eventRows);

    const gameIdRows = await fetchSheetCsv(CONFIG.sheetNames.gameIds);

    const eventName = eventConfig.eventName || "";
    const namePrefix = eventConfig.namePrefix || "";
    const dateRange = eventConfig.dateRange || "";
    const urlCacheSheet = eventConfig.urlCacheSheet || CONFIG.sheetNames.urlCacheDefault;
    const receiverUrl = eventConfig.receiverUrl || "";

    if (!eventName) throw new Error("PW_EVENT_CONFIG eventName が空です");
    if (!namePrefix) throw new Error("PW_EVENT_CONFIG namePrefix が空です");
    if (!dateRange) throw new Error("PW_EVENT_CONFIG dateRange が空です");
    if (!receiverUrl) throw new Error("PW_EVENT_CONFIG receiverUrl が空です");

    const cacheRowsRaw = await fetchSheetCsv(urlCacheSheet);

    const gameIds = getSingleColumnValues(gameIdRows).map(cleanGameId).filter(Boolean);
    const cacheRows = rowsToObjects(cacheRowsRaw);

    if (!cacheRows.length) throw new Error(`${urlCacheSheet} が空です`);

    return {
      gameIds,
      eventConfig: {
        eventName,
        namePrefix,
        dateRange,
        urlCacheSheet,
        receiverUrl
      },
      cacheRows
    };
  }

  async function readApplicationInputData() {
    const applicationRowsRaw = await fetchSheetCsv(CONFIG.sheetNames.applications);
    const applicationRows = rowsToObjects(applicationRowsRaw);
    const systemRows = await fetchSheetCsv(CONFIG.sheetNames.system).catch(() => []);
    const systemConfig = systemRows.length ? readKeyValue(systemRows) : {};

    let receiverUrl = systemConfig.receiverUrl || "";

    if (!receiverUrl) {
      const eventRows = await fetchSheetCsv(CONFIG.sheetNames.eventConfig).catch(() => []);
      const eventConfig = eventRows.length ? readKeyValue(eventRows) : {};
      receiverUrl = eventConfig.receiverUrl || "";
    }

    if (!receiverUrl) throw new Error("システム設定 receiverUrl が空です");

    const cacheRowsRaw = await fetchSheetCsv(CONFIG.sheetNames.urlCacheDefault);
    const cacheRows = rowsToObjects(cacheRowsRaw);
    if (!cacheRows.length) throw new Error(`${CONFIG.sheetNames.urlCacheDefault} が空です`);

    const applications = applicationRows
      .map(normalizeApplicationRow)
      .filter(app => CONFIG.processStatuses.includes(app.status));

    return {
      applications,
      receiverUrl,
      cacheRows
    };
  }

  CONFIG.processStatuses = ["", "未処理", "OK"];

  function normalizeApplicationRow(row) {
    const gameId = cleanGameId(row["Game ID"] || row.GameID || row.gameId);
    const targetEvent = norm(row["対象イベント"]);
    const applicationKey = norm(row["申請キー"]) || makeApplicationKey(row, gameId, targetEvent);

    return {
      ...row,
      "申請キー": applicationKey,
      applicationKey,
      "Game ID": gameId,
      gameId,
      "本名": norm(row["本名"] || row["顧客名"]),
      customerName: norm(row["本名"] || row["顧客名"]),
      "メールアドレス": norm(row["メールアドレス"] || row.email),
      email: norm(row["メールアドレス"] || row.email),
      "宛名": norm(row["宛名"]),
      recipient: norm(row["宛名"]),
      "対象イベント": targetEvent,
      eventName: norm(row.eventName || row["eventName"]),
      namePrefix: norm(row.namePrefix || row["namePrefix"]),
      dateRange: norm(row.dateRange || row["dateRange"]),
      status: norm(row["ステータス"] || row.status)
    };
  }

  function makeApplicationKey(row, gameId, targetEvent) {
    return [
      norm(row["申請日"]),
      gameId,
      norm(row["メールアドレス"] || row.email).toLowerCase(),
      norm(row["宛名"]),
      norm(targetEvent)
    ].join("__");
  }

  function makeInputHash(inputData) {
    if (inputData.applications) {
      return simpleHash(JSON.stringify({
        applications: inputData.applications.map(app => ({
          applicationKey: app.applicationKey,
          gameId: app.gameId,
          email: app.email,
          recipient: app.recipient,
          eventName: app.eventName,
          namePrefix: app.namePrefix,
          dateRange: app.dateRange,
          status: app.status
        }))
      }));
    }

    const payload = {
      gameIds: inputData.gameIds,
      eventConfig: inputData.eventConfig,
      cacheRows: inputData.cacheRows.map(r => ({
        Name: r.Name || "",
        TournamentId: r.TournamentId || "",
        URL: r.URL || "",
        Actual_Name: r.Actual_Name || ""
      }))
    };

    return simpleHash(JSON.stringify(payload));
  }

  function loadRunStatus() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEYS.runStatus) || "{}");
    } catch (_) {
      return {};
    }
  }

  function saveRunStatus(status) {
    const current = loadRunStatus();

    const next = {
      ...current,
      ...status,
      updatedAt: nowText()
    };

    localStorage.setItem(LS_KEYS.runStatus, JSON.stringify(next));
    updateStatusDisplay();
  }

  function isAutoEnabled() {
    return localStorage.getItem(LS_KEYS.autoEnabled) === "1";
  }

  function setAutoEnabled(enabled) {
    localStorage.setItem(LS_KEYS.autoEnabled, enabled ? "1" : "0");
    updateAutoButton();
    updateStatusDisplay();

    if (enabled) {
      startAutoWatch();
    } else {
      stopAutoWatch();
    }
  }

  function isPanelCollapsed() {
    return localStorage.getItem(LS_KEYS.panelCollapsed) === "1";
  }

  function setPanelCollapsed(collapsed) {
    localStorage.setItem(LS_KEYS.panelCollapsed, collapsed ? "1" : "0");
    updatePanelCollapsed();
  }

  function updatePanelCollapsed() {
    const panel = document.getElementById("pw-full-auto-v5-panel");
    const body = document.getElementById("pw-full-auto-v5-panel-body");
    const toggle = document.getElementById("pw-full-auto-v5-minimize");

    if (!panel || !body || !toggle) return;

    const collapsed = isPanelCollapsed();

    body.style.display = collapsed ? "none" : "block";
    toggle.textContent = collapsed ? "展開" : "最小化";
    panel.style.width = collapsed ? "150px" : "310px";
    panel.style.opacity = collapsed ? "0.82" : "1";
  }

  async function pwPost(url, bodyObj) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: new URLSearchParams(bodyObj),
      credentials: "same-origin"
    });

    if (!res.ok) {
      throw new Error(`${url} HTTP ${res.status}`);
    }

    return await res.text();
  }

  async function searchInternalId(gameId) {
    const searchGameId = rawToSearchGameId(gameId);

    const html = await pwPost("/cb/jogadores/search", {
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

    const getRes = await fetch(pageUrl, {
      method: "GET",
      credentials: "same-origin"
    });

    if (!getRes.ok) {
      throw new Error(`player page GET HTTP ${getRes.status}`);
    }

    const pageHtml = await getRes.text();
    const doc = parseHtml(pageHtml);

    const form = Array.from(doc.querySelectorAll("form")).find(f =>
      f.querySelector('input[name="torneio_aba"]') &&
      f.querySelector('input[name="data"]') &&
      f.querySelector('button[name="action"][value="torneio"]')
    );

    if (!form) {
      throw new Error("player tournament filter form not found");
    }

    const codbloq = form.querySelector('input[name="codbloq"]')?.value || "";

    const body = {
      torneio_aba: "1",
      data: dateRange,
      action: "torneio"
    };

    if (codbloq) {
      body.codbloq = codbloq;
    }

    return await pwPost(pageUrl, body);
  }

function extractEventRowsFromHtml(html, namePrefix) {
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
      const tds = Array.from(tr.querySelectorAll("td"))
        .map(td => norm(td.innerText || td.textContent || ""));

      const date = tds[dateIndex] || "";
      const name = cleanTournamentName(tds[nameIndex] || "");

      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) continue;
      if (!name) continue;
      if (compact(namePrefix) && !compact(name).includes(compact(namePrefix))) continue;

      out.push({
        date,
        name,
        rowText: norm(tr.innerText || tr.textContent || "")
      });
    }
  }

  return out;
}

function extractTournamentIdFromUrl(url) {
  const m = String(url || "").match(/\/cb\/torneio\/painel\/(\d+)/);
  return m ? m[1] : "";
}

function normalizeCacheUrl(id, url) {
  const urlId = extractTournamentIdFromUrl(url);
  const finalId = String(id || urlId || "").trim();

  if (!finalId) return "";

  return `/cb/torneio/painel/${finalId}`;
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

function isSameTournamentLooseSafe(inputName, actualName) {
  const a = cleanTournamentName(inputName);
  const b = cleanTournamentName(actualName);

  if (!a || !b) return false;

  return compact(a) === compact(b);
}

function validateUrlCacheRow(row) {
  const name = cleanTournamentName(row.Name || "");
  const actualName = cleanTournamentName(row.Actual_Name || row.Name || "");
  const id = norm(row.TournamentId || "");
  const url = norm(row.URL || "");
  const urlId = extractTournamentIdFromUrl(url);

  if (!name) return { ok: false, reason: "CACHE_NAME_EMPTY" };
  if (!id && !urlId) return { ok: false, reason: "CACHE_ID_EMPTY" };
  if (id && urlId && id !== urlId) return { ok: false, reason: `CACHE_ID_MISMATCH id=${id} urlId=${urlId}` };

  if (actualName && !isSameTournamentLooseSafe(name, actualName)) {
    return { ok: false, reason: "CACHE_NAME_ACTUAL_MISMATCH" };
  }

  const finalId = id || urlId;
  const finalUrl = normalizeCacheUrl(finalId, url);

  return {
    ok: true,
    name,
    actualName,
    tournamentId: finalId,
    url: finalUrl
  };
}

function findUrlCache(tournamentName, cacheRows) {
  const matches = [];

  for (const row of cacheRows || []) {
    const checked = validateUrlCacheRow(row);

    if (!checked.ok) continue;

    if (
      isSameTournamentLooseSafe(tournamentName, checked.name) ||
      isSameTournamentLooseSafe(tournamentName, checked.actualName)
    ) {
      matches.push({
        Name: checked.name,
        Actual_Name: checked.actualName,
        TournamentId: checked.tournamentId,
        URL: checked.url
      });
    }
  }

  const seen = new Set();
  const unique = matches.filter(row => {
    const key = row.TournamentId || row.URL;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (unique.length === 1) {
    return {
      status: "OK",
      row: unique[0]
    };
  }

  if (unique.length > 1) {
    return {
      status: "URL_AMBIGUOUS",
      reason: `${unique.length} cache rows matched: ${unique.map(x => x.TournamentId).join(",")}`
    };
  }

  return {
    status: "URL_NOT_FOUND",
    reason: "URL_CACHEに安全一致する大会名なし"
  };
}

  async function discoverTournaments(gameIds, eventConfig, cacheRows) {
    const discoveredRows = [];

    for (const gameId of gameIds) {
      try {
        setStatus(`Discovery API: ${gameId}`);

        const search = await searchInternalId(gameId);
        const html = await requestPlayerTournamentHtml(search.internalId, eventConfig.dateRange);
        const rows = extractEventRowsFromHtml(html, eventConfig.namePrefix);

        if (!rows.length) {
          discoveredRows.push({
            "Game ID": gameId,
            "internalId": search.internalId,
            "参加日": "",
            "大会名": "",
            "Matched_Name": "",
            "TournamentId": "",
            "URL": "",
            "判定": "NO_EVENT_TOURNAMENT",
            "理由": `${eventConfig.eventName} の参加大会なし`
          });
          continue;
        }

        for (const row of rows) {
const cacheResult = findUrlCache(row.name, cacheRows);
const cache = cacheResult.row || null;

discoveredRows.push({
  "Game ID": gameId,
  "internalId": search.internalId,
  "参加日": row.date,
  "大会名": row.name,
  "Matched_Name": cache ? (cache.Actual_Name || cache.Name || "") : "",
  "TournamentId": cache ? (cache.TournamentId || "") : "",
  "URL": cache ? (cache.URL || "") : "",
  "判定": cacheResult.status,
  "理由": cacheResult.status === "OK" ? "" : cacheResult.reason
});
        }

      } catch (e) {
        discoveredRows.push({
          "Game ID": gameId,
          "internalId": "",
          "参加日": "",
          "大会名": "",
          "Matched_Name": "",
          "TournamentId": "",
          "URL": "",
          "判定": "ERROR",
          "理由": e.message || String(e)
        });
      }

      await sleep(CONFIG.betweenPlayersDelay);
    }

    return discoveredRows;
  }

  function buildTournamentsFromDiscovery(discoveredRows) {
    const seen = new Set();
    const out = [];

    for (const row of discoveredRows) {
      if (row["判定"] !== "OK") continue;

      const tournamentId = norm(row["TournamentId"]);
      const name = cleanTournamentName(row["大会名"]);
      const tournamentNo = getTournamentNoFromName(name);

      if (!tournamentId || !name) continue;

      const key = tournamentId || name;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        name,
        tournamentId,
        tournamentNo
      });
    }

    return out;
  }

  function parsePurchaseDateParts(timeText) {
    const m = String(timeText || "").match(/(\d{1,2})\/(\d{1,2})/);

    if (!m) {
      return {
        年: CONFIG.eventYear,
        月: "",
        日: ""
      };
    }

    return {
      年: CONFIG.eventYear,
      月: Number(m[2]),
      日: Number(m[1])
    };
  }

  function parseTimeSortValue(timeText) {
    const m = String(timeText || "").match(/(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2}):(\d{2})/);
    if (!m) return 999999999999;

    return new Date(
      CONFIG.eventYear,
      Number(m[2]) - 1,
      Number(m[1]),
      Number(m[3]),
      Number(m[4])
    ).getTime();
  }

  function getTournamentNoFromName(name) {
    const m = String(name || "").match(/#\s*(\d+)/);
    return m ? Number(m[1]) : "";
  }

  function findHeaderIndex(headers, patterns) {
    return headers.findIndex(h => patterns.some(p => h.includes(p)));
  }

  function extractCellsFromRowHtml(trHtml, tagName) {
    const re = new RegExp(`<${tagName}\\b[\\s\\S]*?>([\\s\\S]*?)<\\/${tagName}>`, "gi");
    const cells = [];
    let m;

    while ((m = re.exec(trHtml)) !== null) {
      cells.push({
        html: m[1],
        text: stripHtml(m[1])
      });
    }

    return cells;
  }

  function requestRegistroInformacoes(tournamentId) {
    return pwPost("/cb/torneio/abas/registros/informacoes", {
      id_torneio: String(tournamentId)
    });
  }

  function requestDadosCaixa(idJogador, idTorneio) {
    return pwPost("/cb/torneio/abas/caixa/dados_caixa", {
      id_jogador: String(idJogador),
      id_torneio: String(idTorneio),
      premiacao_origem: "0"
    });
  }

  function requestInformacoes(idVenda, idJogador, idTorneio) {
    return pwPost("/cb/torneio/abas/caixa/informacoes", {
      id_venda: String(idVenda),
      id_jogador: String(idJogador),
      id_torneio: String(idTorneio)
    });
  }

  function parsePlayersFromTournamentHtml(html, tournamentId) {
    const players = [];
    const rowMatches = String(html).match(/<tr[\s\S]*?<\/tr>/gi) || [];

    for (const trHtml of rowMatches) {
      const m = trHtml.match(/abrirCadastro\(\s*(\d+)\s*,\s*(\d+)\s*,\s*1\s*\)/);
      if (!m) continue;

      const idJogador = m[1];
      const idTorneio = m[2] || tournamentId;
      const text = stripHtml(trHtml);

      const gameIdMatch = text.match(/\b\d{4}\.\d{4}\b/);
      const gameId = gameIdMatch ? gameIdMatch[0].replace(".", "") : "";

      if (!gameId) continue;

      let playerName = "";
      const nameMatch = text.match(/\d{4}\.\d{4}\s+(.+?)\s+\d+\s+\d+/);
      if (nameMatch) {
        playerName = norm(nameMatch[1].replace(/\s*-\s*$/, "").replace(/\s*-\s*\d+$/, ""));
      }

      players.push({
        gameId,
        idJogador,
        idTorneio,
        playerName,
        rowText: text
      });
    }

    return players;
  }

  function parseCashRecords(html) {
    const trMatches = String(html).match(/<tr[\s\S]*?<\/tr>/gi) || [];

    let headerIndex = -1;
    let headers = [];

    for (let i = 0; i < trMatches.length; i++) {
      const ths = extractCellsFromRowHtml(trMatches[i], "th").map(c => c.text);
      const joined = ths.join(" ");

      if (joined.includes("時間") && joined.includes("購入") && joined.includes("ユーザー")) {
        headerIndex = i;
        headers = ths;
        break;
      }
    }

    if (headerIndex < 0 || !headers.length) {
      return [];
    }

    const timeIndex = findHeaderIndex(headers, ["時間"]);
    const purchaseIndex = findHeaderIndex(headers, ["購入", "引き出し"]);
    const enIndex = headers.findIndex(h => h === "En" || h.includes("En"));
    const reIndex = headers.findIndex(h => h === "Re" || h.includes("Re"));
    const userIndex = findHeaderIndex(headers, ["ユーザー"]);

    const records = [];

    for (let i = headerIndex + 1; i < trMatches.length; i++) {
      const trHtml = trMatches[i];
      const tds = extractCellsFromRowHtml(trHtml, "td");

      if (tds.length < 2) continue;

      const time = timeIndex >= 0 ? norm(tds[timeIndex]?.text) : norm(tds[0]?.text);
      const purchaseAmount = purchaseIndex >= 0 ? cleanNumber(tds[purchaseIndex]?.text) : cleanNumber(tds[1]?.text);

      if (!time) continue;

      const vendaMatch = trHtml.match(/informacoes_venda\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);

      const idVenda = vendaMatch ? vendaMatch[1] : "";
      const idJogadorFromVenda = vendaMatch ? vendaMatch[2] : "";
      const idTorneioFromVenda = vendaMatch ? vendaMatch[3] : "";

      const enCount = enIndex >= 0 ? toNumber(tds[enIndex]?.text) : 0;
      const reCount = reIndex >= 0 ? toNumber(tds[reIndex]?.text) : 0;
      const user = userIndex >= 0 ? norm(tds[userIndex]?.text) : "";

      const itemPairs = [];

      for (let j = 0; j < headers.length && j < tds.length; j++) {
        const h = headers[j];
        if (!h) continue;
        if (j === timeIndex || j === purchaseIndex || j === enIndex || j === reIndex || j === userIndex) continue;

        const val = cleanNumber(tds[j]?.text);
        if (val && Number(val) !== 0) {
          itemPairs.push(`${h}:${val}`);
        }
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
        row_text: stripHtml(trHtml)
      });
    }

    return records;
  }

  function parseInformacoes(html) {
    const rawText = stripHtmlKeepLines(html);

    const lines = rawText
      .split(/\r?\n/)
      .map(s => norm(s))
      .filter(Boolean);

    const text = norm(lines.join(" "));

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

        if (isSectionTitle(line) && !line.includes(sectionTitle)) {
          break;
        }

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
          rows.push({
            desc: line,
            amount: nextAmount
          });
          i++;
          continue;
        }

        rows.push({
          desc: line,
          amount: ""
        });
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

    return (
      s.includes("使用済みチケット") ||
      s.includes("選手契約履行") ||
      s.includes("プライズ") ||
      s.includes("ITM")
    );
  }

  function detectTypeFromRecord(rec, info) {
    if (rec.re_count > 0) return "Re";
    if (rec.en_count > 0) return "En";

    const saleText = norm(
      [
        info?.sale_item || "",
        ...(info?.saleRows || []).map(r => r.desc || ""),
        rec?.item_summary || ""
      ].join(" ")
    );

    if (/Re\s*Entry/i.test(saleText) || /\bRe\b/i.test(saleText) || saleText.includes("Re:")) {
      return "Re";
    }

    if (/Entry/i.test(saleText) || /\bEn\b/i.test(saleText) || saleText.includes("En:")) {
      return "En";
    }

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

    for (const fr of financeRows || []) {
      addPaymentToColumns(cols, fr.desc, fr.amount);
    }

    return cols;
  }

  function classifyDetailToOutput(detail) {
    const dateParts = parsePurchaseDateParts(detail.time);
    const type = detail.type || "";
    const cols = makeColsFromFinanceRows(detail.financeRows || []);

    const knownPaymentTotal =
      Number(cols["現金"] || 0) +
      Number(cols["クレジットカード"] || 0) +
      Number(cols["ポイント"] || 0) +
      Number(cols["USDT"] || 0);

    const hasUnknownPayment = cols.__unknown_payment.length > 0;

    const base = {
      "Game ID": detail.raw_game_id,
      "購入時間": detail.time,
      "年": dateParts["年"],
      "月": dateParts["月"],
      "日": dateParts["日"],
      "大会名": cleanTournamentName(detail.tournamentName),
      "種別": type,
      "現金": cols["現金"],
      "クレジットカード": cols["クレジットカード"],
      "ポイント": cols["ポイント"],
      "USDT": cols["USDT"],

      __targetIndex: detail.targetIndex,
      __sortTime: parseTimeSortValue(detail.time),
      __sortTournamentNo: detail.tournamentNo,
      __tournamentId: detail.tournamentId,
      __unique_key: `${detail.raw_game_id}_${detail.tournamentId}_${detail.id_venda || detail.time || ""}`,
      __unknown_payment: cols.__unknown_payment.join("|"),
      __ignored_payment: cols.__ignored_payment.join("|")
    };

    if (detail.purchase_amount_num <= 0) {
      return {
        kind: "IGNORE",
        reason: "購入・引き出しが0以下",
        row: base
      };
    }

    if (hasUnknownPayment) {
      return {
        kind: "NEED_CHECK",
        reason: "支払い方法確認",
        message: `支払い方法が自動分類できません：${cols.__unknown_payment.join("|")}`,
        row: base
      };
    }

    if (knownPaymentTotal <= 0) {
      return {
        kind: "NEED_CHECK",
        reason: "支払い金額取得なし（PDF対象外）",
        message: "購入金額はありますが、現金・クレジットカード・ポイント・USDTの金額が取得できませんでした。この明細はPDF対象外として処理を継続しました。",
        row: base
      };
    }

    return {
      kind: "PASTE",
      reason: "OK",
      row: base
    };
  }

  async function fetchDetailsForPlayer(player, tournament, targetIndex) {
    const rows = [];

    try {
      const caixaHtml = await requestDadosCaixa(player.idJogador, player.idTorneio);
      const records = parseCashRecords(caixaHtml);

      if (!records.length) {
        rows.push({
          tournamentNo: tournament.tournamentNo,
          tournamentName: tournament.name,
          tournamentId: tournament.tournamentId,
          raw_game_id: player.gameId,
          targetIndex,
          id_jogador: player.idJogador,
          id_torneio: player.idTorneio,
          time: "",
          purchase_amount: "",
          purchase_amount_num: 0,
          item_summary: "",
          user: "",
          id_venda: "",
          type: "",
          financeRows: [],
          saleRows: [],
          payment_method: "",
          payment_amount: "",
          sale_item: "",
          sale_amount: "",
          status: "NO_CASH_RECORD",
          error: ""
        });

        return rows;
      }

      for (const rec of records) {
        if (rec.purchase_amount_num <= 0) {
          rows.push({
            tournamentNo: tournament.tournamentNo,
            tournamentName: tournament.name,
            tournamentId: tournament.tournamentId,
            raw_game_id: player.gameId,
            targetIndex,
            id_jogador: player.idJogador,
            id_torneio: player.idTorneio,
            time: rec.time,
            purchase_amount: rec.purchase_amount,
            purchase_amount_num: rec.purchase_amount_num,
            item_summary: rec.item_summary,
            user: rec.user,
            id_venda: rec.id_venda,
            type: "",
            financeRows: [],
            saleRows: [],
            payment_method: "",
            payment_amount: "",
            sale_item: "",
            sale_amount: "",
            status: "IGNORE_NON_PURCHASE",
            error: ""
          });
          continue;
        }

        let info = {
          financeRows: [],
          saleRows: [],
          payment_method: "",
          payment_amount: "",
          sale_item: "",
          sale_amount: ""
        };

        let infoError = "";

        if (CONFIG.fetchInformacoes && rec.id_venda) {
          try {
            await sleep(CONFIG.betweenDetailFetchMs);

            const infoHtml = await requestInformacoes(
              rec.id_venda,
              player.idJogador,
              player.idTorneio
            );

            info = parseInformacoes(infoHtml);
          } catch (e) {
            infoError = e?.message || String(e);
          }
        }

        rows.push({
          tournamentNo: tournament.tournamentNo,
          tournamentName: tournament.name,
          tournamentId: tournament.tournamentId,
          raw_game_id: player.gameId,
          targetIndex,
          id_jogador: player.idJogador,
          id_torneio: player.idTorneio,
          time: rec.time,
          purchase_amount: rec.purchase_amount,
          purchase_amount_num: rec.purchase_amount_num,
          item_summary: rec.item_summary,
          user: rec.user,
          id_venda: rec.id_venda,
          type: detectTypeFromRecord(rec, info),
          financeRows: info.financeRows || [],
          saleRows: info.saleRows || [],
          payment_method: info.payment_method,
          payment_amount: info.payment_amount,
          sale_item: info.sale_item,
          sale_amount: info.sale_amount,
          status: infoError ? `INFO_FETCH_ERROR: ${infoError}` : "OK",
          error: infoError
        });
      }

      return rows;
    } catch (e) {
      rows.push({
        tournamentNo: tournament.tournamentNo,
        tournamentName: tournament.name,
        tournamentId: tournament.tournamentId,
        raw_game_id: player.gameId,
        targetIndex,
        id_jogador: player.idJogador,
        id_torneio: player.idTorneio,
        time: "",
        purchase_amount: "",
        purchase_amount_num: 0,
        item_summary: "",
        user: "",
        id_venda: "",
        type: "",
        financeRows: [],
        saleRows: [],
        payment_method: "",
        payment_amount: "",
        sale_item: "",
        sale_amount: "",
        status: `DETAIL_FETCH_ERROR: ${e.message}`,
        error: e?.message || String(e)
      });

      return rows;
    }
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
    return [...(rows || [])].sort((a, b) => {
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

  function buildOutputRows(pasteRows, needCheckRows, reportRows) {
    const sortedPasteRows = sortRows(dedupeRowsByKey(pasteRows || []));
    const sortedNeedCheckRows = sortRows(dedupeRowsByKey(needCheckRows || []));

    const pasteRowsForReceiver = sortedPasteRows.map(r => ({
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

    const needCheckRowsForReceiver = sortedNeedCheckRows.map(r => ({
      "Game ID": r["Game ID"],
      "購入時間": r["購入時間"],
      "大会名": cleanTournamentName(r["大会名"]),
      "確認区分": r["確認区分"],
      "確認内容": r["確認内容"]
    }));

    const reportRowsForReceiver = [...(reportRows || [])].map(r => ({
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

    return {
      pasteRowsForReceiver,
      needCheckRowsForReceiver,
      reportRowsForReceiver
    };
  }

  async function runPaymentScan(gameIds, tournaments) {
    const targetIndexMap = {};
    gameIds.forEach((gid, idx) => {
      targetIndexMap[gid] = idx;
    });

    const pasteRows = [];
    const needCheckRows = [];
    const reportRows = [];

    for (const tournament of tournaments) {
      setStatus(`支払い取得: ${tournament.name}`);

      let players = [];

      try {
        const registroHtml = await requestRegistroInformacoes(tournament.tournamentId);
        players = parsePlayersFromTournamentHtml(registroHtml, tournament.tournamentId);
      } catch (e) {
        reportRows.push({
          "大会番号": tournament.tournamentNo ? `#${tournament.tournamentNo}` : "",
          "大会名": tournament.name,
          "処理結果": "取得エラー",
          "対象Game ID数": gameIds.length,
          "該当プレイヤー数": 0,
          "出力行数": 0,
          "確認必要件数": 1,
          "対象外件数": 0,
          "読込人数": 0,
          "備考": e.message || String(e)
        });
        continue;
      }

      let hitPlayers = 0;
      let tournamentPaste = 0;
      let tournamentNeedCheck = 0;
      let tournamentIgnored = 0;

      for (const gid of gameIds) {
        const hits = players.filter(p => p.gameId === gid);

        if (!hits.length) {
          continue;
        }

        for (const p of hits) {
          hitPlayers++;

          setStatus(`明細取得: ${tournament.name} / ${gid}`);

          const details = await fetchDetailsForPlayer(
            p,
            tournament,
            targetIndexMap[gid]
          );

          for (const d of details) {
            if (d.status === "IGNORE_NON_PURCHASE") {
              tournamentIgnored++;
              continue;
            }

            if (d.status === "NO_CASH_RECORD") {
              needCheckRows.push({
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
              tournamentNeedCheck++;
              continue;
            }

            if (d.status !== "OK") {
              needCheckRows.push({
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
              tournamentNeedCheck++;
              continue;
            }

            const classified = classifyDetailToOutput(d);

            if (classified.kind === "PASTE") {
              pasteRows.push(classified.row);
              tournamentPaste++;
            } else if (classified.kind === "NEED_CHECK") {
              needCheckRows.push({
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
              tournamentNeedCheck++;
            } else {
              tournamentIgnored++;
            }
          }
        }
      }

      let note = "正常に完了しました";

      if (tournamentNeedCheck > 0) {
        note = `確認必要：${tournamentNeedCheck}件`;
      }

      reportRows.push({
        "大会番号": tournament.tournamentNo ? `#${tournament.tournamentNo}` : "",
        "大会名": tournament.name,
        "処理結果": "完了",
        "対象Game ID数": gameIds.length,
        "該当プレイヤー数": hitPlayers,
        "出力行数": tournamentPaste,
        "確認必要件数": tournamentNeedCheck,
        "対象外件数": tournamentIgnored,
        "読込人数": players.length,
        "備考": note
      });

      await sleep(CONFIG.betweenTournamentsDelay);
    }

    return buildOutputRows(pasteRows, needCheckRows, reportRows);
  }

  function postFullAutoToReceiver(receiverUrl, payload) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: receiverUrl,
        headers: {
          "Content-Type": "application/json"
        },
        data: JSON.stringify(payload),
        onload: res => {
          console.log("[PW-FULL-AUTO-v5.1] receiver response", res.status, res.responseText);

          if (res.status < 200 || res.status >= 300) {
            reject(new Error(`Receiver HTTP ${res.status}: ${res.responseText}`));
            return;
          }

          let json = null;

          try {
            json = JSON.parse(res.responseText);
          } catch (e) {
            reject(new Error("Receiver response is not JSON: " + res.responseText.slice(0, 300)));
            return;
          }

          if (!json.ok) {
            reject(new Error(json.error || "Receiver returned ok=false"));
            return;
          }

          resolve(json);
        },
        onerror: err => {
          console.error("[PW-FULL-AUTO-v5.1] receiver error", err);
          reject(new Error("Receiver POST failed"));
        }
      });
    });
  }

  async function runFullAuto(options = {}) {
    if (STATE.isRunning) {
      throw new Error("すでに実行中です");
    }

    const mode = options.mode || "manual";
    let inputHash = options.inputHash || "";

    STATE.isRunning = true;
    updateStatusDisplay();

    try {
      setStatus(mode === "auto" ? "自動実行開始..." : "手動実行開始...");

      const inputData = options.inputData || await readApplicationInputData();

      if (!inputHash) {
        inputHash = makeInputHash(inputData);
      }

      if (!inputData.applications.length) {
        saveRunStatus({
          lastInputHash: inputHash,
          lastRunAt: nowText(),
          lastMode: mode,
          status: "IDLE_NO_APPLICATION",
          discoveredRowsCount: 0,
          pasteRowsCount: 0,
          needCheckRowsCount: 0,
          reportRowsCount: 0,
          error: ""
        });

        setStatus("待機中: 未処理の申請なし");

        if (mode !== "auto") {
          alert("未処理の申請はありません。");
        }

        return;
      }

      const total = {
        discovered: 0,
        paste: 0,
        needCheck: 0,
        report: 0,
        applications: 0
      };

      for (let i = 0; i < inputData.applications.length; i++) {
        const app = inputData.applications[i];
        setStatus(`申請処理 ${i + 1}/${inputData.applications.length}: ${app.gameId} / ${app.eventName}`);

        const eventConfig = {
          eventName: app.eventName,
          namePrefix: app.namePrefix,
          dateRange: app.dateRange
        };

        if (!eventConfig.eventName || !eventConfig.namePrefix || !eventConfig.dateRange) {
          await postFullAutoToReceiver(inputData.receiverUrl, {
            type: "full_auto_v6",
            applications: [app],
            discoveredRows: [{
              "申請キー": app.applicationKey,
              "Game ID": app.gameId,
              "判定": "ERROR",
              "理由": "申請管理のeventName/namePrefix/dateRangeが空です"
            }],
            pasteRows: [],
            needCheckRows: [],
            reportRows: []
          });
          total.applications++;
          continue;
        }

        const discoveredRows = addApplicationKeyToRows(
          await discoverTournaments([app.gameId], eventConfig, inputData.cacheRows),
          app
        );

        const tournaments = buildTournamentsFromDiscovery(discoveredRows);
        let payment = {
          pasteRowsForReceiver: [],
          needCheckRowsForReceiver: [],
          reportRowsForReceiver: []
        };

        if (tournaments.length) {
          setStatus(`支払い取得 ${i + 1}/${inputData.applications.length}: ${tournaments.length}大会`);
          payment = await runPaymentScan([app.gameId], tournaments);
          payment.pasteRowsForReceiver = addApplicationKeyToRows(payment.pasteRowsForReceiver, app);
          payment.needCheckRowsForReceiver = addApplicationKeyToRows(payment.needCheckRowsForReceiver, app);
          payment.reportRowsForReceiver = addApplicationKeyToRows(payment.reportRowsForReceiver, app);
        }

        await postFullAutoToReceiver(inputData.receiverUrl, {
          type: "full_auto_v6",
          applications: [app],
          discoveredRows,
          pasteRows: payment.pasteRowsForReceiver,
          needCheckRows: payment.needCheckRowsForReceiver,
          reportRows: payment.reportRowsForReceiver
        });

        total.discovered += discoveredRows.length;
        total.paste += payment.pasteRowsForReceiver.length;
        total.needCheck += payment.needCheckRowsForReceiver.length;
        total.report += payment.reportRowsForReceiver.length;
        total.applications++;
      }

      saveRunStatus({
        lastInputHash: inputHash,
        lastRunAt: nowText(),
        lastMode: mode,
        status: "OK",
        discoveredRowsCount: total.discovered,
        pasteRowsCount: total.paste,
        needCheckRowsCount: total.needCheck,
        reportRowsCount: total.report,
        error: ""
      });

      setStatus(
        `完了: 申請 ${total.applications} / DISCOVERY ${total.discovered} / ` +
        `PASTE ${total.paste} / CHECK ${total.needCheck} / REPORT ${total.report}`
      );

      if (mode !== "auto") {
        alert(
          `Full Auto 完了\n\n` +
          `申請: ${total.applications}\n` +
          `DISCOVERY: ${total.discovered}\n` +
          `PASTE_ROWS: ${total.paste}\n` +
          `NEED_CHECK: ${total.needCheck}\n` +
          `REPORT: ${total.report}`
        );
      }

    } catch (e) {
      console.error(e);

      saveRunStatus({
        status: "ERROR",
        lastMode: mode,
        lastRunAt: nowText(),
        error: e.message || String(e)
      });

      setStatus("ERROR: " + e.message);

      if (mode !== "auto") {
        alert("ERROR: " + e.message);
      }

      throw e;

    } finally {
      STATE.isRunning = false;
      updateStatusDisplay();
    }
  }

  function addApplicationKeyToRows(rows, app) {
    return (rows || []).map(row => ({
      ...row,
      "申請キー": app.applicationKey,
      applicationKey: app.applicationKey,
      eventName: app.eventName,
      namePrefix: app.namePrefix,
      dateRange: app.dateRange
    }));
  }

  async function checkAutoWatch() {
    if (!isAutoEnabled()) return;

    if (STATE.isRunning) {
      setStatus("自動監視: 実行中のためスキップ");
      scheduleNextAutoCheck();
      return;
    }

    try {
      setStatus("自動監視: 入力確認中...");

      const inputData = await readApplicationInputData();
      const inputHash = makeInputHash(inputData);
      const runStatus = loadRunStatus();

      if (runStatus.lastInputHash === inputHash && ["OK", "IDLE_NO_APPLICATION"].includes(runStatus.status)) {
        setStatus("自動監視: 変更なし");
        scheduleNextAutoCheck();
        return;
      }

      setStatus("自動監視: 変更検知 → Full Auto 実行");

      await runFullAuto({
        mode: "auto",
        inputData,
        inputHash
      });

    } catch (e) {
      console.error("[PW-FULL-AUTO-v5.1] auto watch error", e);
      setStatus("自動監視 ERROR: " + e.message);
    }

    scheduleNextAutoCheck();
  }

  function startAutoWatch() {
    stopAutoWatch();

    if (!isAutoEnabled()) return;

    setStatus("自動監視 ON");
    checkAutoWatch();
  }

  function stopAutoWatch() {
    if (STATE.autoTimer) {
      clearTimeout(STATE.autoTimer);
      STATE.autoTimer = null;
    }

    STATE.nextCheckAt = null;
    updateStatusDisplay();
  }

  function scheduleNextAutoCheck() {
    stopAutoWatch();

    if (!isAutoEnabled()) return;

    STATE.nextCheckAt = new Date(Date.now() + CONFIG.autoWatchIntervalMs);
    STATE.autoTimer = setTimeout(checkAutoWatch, CONFIG.autoWatchIntervalMs);

    updateStatusDisplay();
  }

  function setStatus(text) {
    const el = document.getElementById("pw-full-auto-v5-status");
    if (el) el.textContent = text;
    console.log("[PW-FULL-AUTO-v5.1]", text);
  }

  function updateAutoButton() {
    const btn = document.getElementById("pw-full-auto-v5-auto");

    if (!btn) return;

    if (isAutoEnabled()) {
      btn.textContent = "自動監視 OFF";
      btn.style.background = "#3b7";
    } else {
      btn.textContent = "自動監視 ON";
      btn.style.background = "#555";
    }

    btn.style.color = "#fff";
  }

  function updateStatusDisplay() {
    const el = document.getElementById("pw-full-auto-v5-run-status");
    if (!el) return;

    const s = loadRunStatus();

    const lines = [
      `running: ${STATE.isRunning ? "YES" : "NO"}`,
      `auto: ${isAutoEnabled() ? "ON" : "OFF"}`,
      `last: ${s.lastRunAt || "-"}`,
      `status: ${s.status || "-"}`,
      `DISCOVERY: ${s.discoveredRowsCount ?? "-"}`,
      `PASTE: ${s.pasteRowsCount ?? "-"}`,
      `CHECK: ${s.needCheckRowsCount ?? "-"}`,
      `REPORT: ${s.reportRowsCount ?? "-"}`,
      `next: ${STATE.nextCheckAt ? STATE.nextCheckAt.toLocaleTimeString() : "-"}`
    ];

    if (s.error) lines.push(`error: ${s.error}`);

    el.textContent = lines.join("\n");
  }

  function addPanel() {
    if (document.getElementById("pw-full-auto-v5-panel")) return;

    const panel = document.createElement("div");
    panel.id = "pw-full-auto-v5-panel";
    panel.style.position = "fixed";
    panel.style.zIndex = "999999";
    panel.style.top = "80px";
    panel.style.right = "20px";
    panel.style.background = "#111";
    panel.style.color = "#fff";
    panel.style.padding = "10px";
    panel.style.borderRadius = "8px";
    panel.style.fontSize = "12px";
    panel.style.width = "310px";
    panel.style.boxShadow = "0 2px 10px rgba(0,0,0,0.35)";

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.gap = "8px";

    const title = document.createElement("div");
    title.textContent = "PW Receipt Full Auto";
    title.style.fontWeight = "bold";

    const minimizeBtn = document.createElement("button");
    minimizeBtn.id = "pw-full-auto-v5-minimize";
    minimizeBtn.textContent = "最小化";
    minimizeBtn.style.padding = "4px 8px";
    minimizeBtn.style.cursor = "pointer";
    minimizeBtn.style.border = "none";
    minimizeBtn.style.borderRadius = "4px";
    minimizeBtn.style.background = "#444";
    minimizeBtn.style.color = "#fff";

    header.appendChild(title);
    header.appendChild(minimizeBtn);

    const body = document.createElement("div");
    body.id = "pw-full-auto-v5-panel-body";
    body.style.marginTop = "8px";

    const manualBtn = document.createElement("button");
    manualBtn.id = "pw-full-auto-v5-run";
    manualBtn.textContent = "手動：Full Auto 実行";
    manualBtn.style.width = "100%";
    manualBtn.style.padding = "8px";
    manualBtn.style.cursor = "pointer";
    manualBtn.style.marginBottom = "6px";

    const autoBtn = document.createElement("button");
    autoBtn.id = "pw-full-auto-v5-auto";
    autoBtn.textContent = "自動監視 ON";
    autoBtn.style.width = "100%";
    autoBtn.style.padding = "8px";
    autoBtn.style.cursor = "pointer";
    autoBtn.style.marginBottom = "8px";
    autoBtn.style.border = "none";
    autoBtn.style.borderRadius = "4px";

    const status = document.createElement("div");
    status.id = "pw-full-auto-v5-status";
    status.textContent = "ready";
    status.style.marginTop = "8px";
    status.style.color = "#9fe";
    status.style.whiteSpace = "pre-wrap";

    const runStatus = document.createElement("div");
    runStatus.id = "pw-full-auto-v5-run-status";
    runStatus.textContent = "";
    runStatus.style.marginTop = "8px";
    runStatus.style.color = "#ddd";
    runStatus.style.whiteSpace = "pre-wrap";
    runStatus.style.fontSize = "11px";
    runStatus.style.borderTop = "1px solid #444";
    runStatus.style.paddingTop = "8px";

    body.appendChild(manualBtn);
    body.appendChild(autoBtn);
    body.appendChild(status);
    body.appendChild(runStatus);

    panel.appendChild(header);
    panel.appendChild(body);
    document.body.appendChild(panel);

    manualBtn.onclick = () => {
      runFullAuto({ mode: "manual" }).catch(() => {});
    };

    autoBtn.onclick = () => {
      setAutoEnabled(!isAutoEnabled());
    };

    minimizeBtn.onclick = () => {
      setPanelCollapsed(!isPanelCollapsed());
    };

    updateAutoButton();
    updateStatusDisplay();
    updatePanelCollapsed();

    if (isAutoEnabled()) {
      startAutoWatch();
    }
  }

  function boot() {
    console.log("[PW-FULL-AUTO-v5.1] loaded");
    addPanel();
  }

  GM_registerMenuCommand("PW Full Auto 実行", () => runFullAuto({ mode: "manual" }).catch(() => {}));
  GM_registerMenuCommand("PW Full Auto 自動監視 ON/OFF", () => setAutoEnabled(!isAutoEnabled()));
  GM_registerMenuCommand("PW Full Auto Sheet ID リセット", resetSheetId);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
