// ==UserScript==
// @name         PW 大会 Double Check
// @namespace    pw-tournament-double-check
// @version      2.0.7
// @description  3つの入力（大会名 / Portal Tournament / 受付Portal Ticket Link）から、Start・EN・RE・TE・Chips・Ticket Link・Settings・USDTを一括DC
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-tournament-double-check.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-tournament-double-check.user.js
// @author       xhpc007 + ChatGPT
// @match        https://japanopt.bt.pokerweb.com.br/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    storagePrefix: "PW_DC_V20_",
    popupBaseName: "PW_DC_V20_POPUP",
    sharedUrlCacheKey: "PW_SHARED_TOURNAMENT_URL_CACHE_V1",
    pageTimeoutMs: 30000,
    pollMs: 300,
    betweenPagesMs: 350,
    fetchPageMode: true,
    closePopupAfterEach: true,

    // 受付PortalのTicket Link表で、1はリンク済み、空白は未リンク。
    trueValues: new Set(["1", "true", "yes", "はい", "○", "on"]),

    // USDTは全大会ONを正解とする。
    expectedUsdt: true,

    // 1 Ticket の固定価値
    ticketUnitValue: 10000,

    // 深夜扱い：Portalの運用日から翌日にする時刻
    nextDayBeforeHour: 6
  };

  const GENERAL_SETTING_CHECKS = [
    { key: "Sale_Ticket_View", campo: "config_imprimirutilizados", expected: true, label: "販売チケットを見る" },
    { key: "Ticket_Print_Direct", campo: "config_imprimirdireto", expected: true, label: "チケット印刷" },
    { key: "Default_No_Seat", campo: "config_sentarjog", expected: false, label: "配置しない default" },
    { key: "Ticket_Image_Rights", campo: "ticket_direitoimg", expected: true, label: "画像の権利 statement" },
    { key: "USDT", campo: "vendas_moeda_virtual", expected: true, label: "USDT" }
  ];

  let running = false;
  let stopRequested = false;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function norm(value) {
    return String(value ?? "")
      .replace(/\u3000/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function compact(value) {
    return norm(value)
      .toLowerCase()
      .replace(/[【】［］\[\]()（）]/g, "")
      .replace(/[・･]/g, "")
      .replace(/\s+/g, "");
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/\t/g, " ")
      .replace(/\r?\n/g, " ")
      .trim();
  }

  function moneyToNumber(value) {
    const s = String(value ?? "")
      .replace(/[￥¥,\s]/g, "")
      .replace(/[^\d+\-.]/g, "");

    if (!s || s === "-" || s === "+") return null;

    // "9000+1000" のような形式にも対応
    if (/^-?\d+(?:\.\d+)?(?:[+-]\d+(?:\.\d+)?)+$/.test(s)) {
      const nums = s.match(/[+-]?\d+(?:\.\d+)?/g) || [];
      const total = nums.reduce((sum, n) => sum + Number(n), 0);
      return Number.isFinite(total) ? total : null;
    }

    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function parseMoneyExpression(value) {
    const raw = norm(value);
    if (!raw || raw === "-" || raw === "Invitation") {
      return { raw, value: null, isSimple: false };
    }

    // 20,000*3 は1人あたり20,000として比較候補を保持
    const multi = raw.match(/([\d,]+)\s*[×x*]\s*(\d+)/i);
    if (multi) {
      return {
        raw,
        value: Number(multi[1].replace(/,/g, "")),
        multiplier: Number(multi[2]),
        total: Number(multi[1].replace(/,/g, "")) * Number(multi[2]),
        isSimple: false
      };
    }

    return {
      raw,
      value: moneyToNumber(raw),
      multiplier: 1,
      total: moneyToNumber(raw),
      isSimple: true
    };
  }

  function toTsv(rows, headers) {
    return [
      headers.join("\t"),
      ...rows.map(row => headers.map(h => esc(row[h])).join("\t"))
    ].join("\n");
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

  function log(message) {
    console.log("[PW-DC-V20]", message);
    const el = document.querySelector("#pw-dc-v20-status");
    if (el) el.textContent = message;
  }

  function cleanTournamentName(name) {
    return norm(name)
      .replace(/\s*-\s*PokerWeb\s*$/i, "")
      .replace(/\s*監査(?:済み|待ち)\s*$/g, "")
      .trim();
  }

  function getTournamentUrl(tournamentId) {
    return `/torneio/painel/${String(tournamentId || "").trim()}`;
  }

  function extractTournamentIdFromUrl(url) {
    const m = String(url || "").match(/\/torneio\/painel\/(\d+)/);
    return m ? m[1] : "";
  }

  function normalizeCacheUrl(id, url) {
    const urlId = extractTournamentIdFromUrl(url);
    const finalId = String(id || urlId || "").trim();
    return finalId ? getTournamentUrl(finalId) : "";
  }

  function loadSharedUrlCache() {
    try {
      const manager = window.PWUrlCacheManagerV06 || window.PWUrlCacheManagerV05;
      if (manager && typeof manager.loadCache === "function") {
        return manager.loadCache();
      }

      const raw = localStorage.getItem(CONFIG.sharedUrlCacheKey);
      if (!raw) return {};

      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      console.warn("[PW-DC-V20] shared URL cache parse failed", e);
      return {};
    }
  }

  function isSameTournamentExactSafe(inputName, actualName) {
    const a = cleanTournamentName(inputName);
    const b = cleanTournamentName(actualName);
    if (!a || !b) return false;
    return compact(a) === compact(b);
  }

  function validateUrlCacheItem(item) {
    if (!item || typeof item !== "object") {
      return { ok: false, reason: "CACHE_ROW_NOT_OBJECT" };
    }

    const name = cleanTournamentName(item.name || item.Name || "");
    const actualName = cleanTournamentName(item.actualName || item.Actual_Name || item.name || item.Name || "");
    const id = norm(item.tournamentId || item.TournamentId || "");
    const url = norm(item.url || item.URL || "");
    const urlId = extractTournamentIdFromUrl(url);

    if (!name) return { ok: false, reason: "CACHE_NAME_EMPTY" };
    if (!id && !urlId) return { ok: false, reason: "CACHE_ID_EMPTY" };
    if (id && urlId && id !== urlId) return { ok: false, reason: `CACHE_ID_MISMATCH id=${id} urlId=${urlId}` };

    const finalId = id || urlId;
    const finalUrl = normalizeCacheUrl(finalId, url);
    if (!finalId || !finalUrl) return { ok: false, reason: "CACHE_URL_EMPTY" };

    return {
      ok: true,
      name,
      actualName,
      tournamentId: finalId,
      url: finalUrl,
      source: item.source || item.Source || "shared-url-cache"
    };
  }

  function findSharedUrlByName(name, preferredTournamentId = "") {
    const cleanName = cleanTournamentName(name);
    const preferredId = norm(preferredTournamentId);
    const matches = [];
    const cache = loadSharedUrlCache();

    for (const item of Object.values(cache)) {
      const checked = validateUrlCacheItem(item);
      if (!checked.ok) continue;

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

    if (preferredId) {
      const sameId = unique.filter(item => item.tournamentId === preferredId);
      if (sameId.length === 1) {
        return { status: "OK", row: sameId[0], reason: "" };
      }
    }

    if (unique.length === 1) {
      return { status: "OK", row: unique[0], reason: "" };
    }

    if (unique.length > 1) {
      return {
        status: "AMBIGUOUS",
        row: null,
        reason: unique.map(item => item.tournamentId).join(",")
      };
    }

    return { status: "NOT_FOUND", row: null, reason: "" };
  }

  function resolveTournamentUrl(tournamentId, expectedName = "") {
    const fallbackId = norm(tournamentId);
    const cacheMatch = expectedName ? findSharedUrlByName(expectedName, fallbackId) : null;

    if (cacheMatch?.status === "OK" && cacheMatch.row) {
      return {
        tournamentId: cacheMatch.row.tournamentId,
        url: cacheMatch.row.url,
        source: "URL_MANAGER",
        status: cacheMatch.row.tournamentId === fallbackId ? "OK" : "ID_OVERRIDE"
      };
    }

    return {
      tournamentId: fallbackId,
      url: getTournamentUrl(fallbackId),
      source: cacheMatch?.status ? `FALLBACK_${cacheMatch.status}` : "FALLBACK",
      status: cacheMatch?.reason || "OK"
    };
  }

  function parseTsv(raw) {
    return String(raw || "")
      .replace(/\r/g, "")
      .split("\n")
      .map(line => line.split("\t"));
  }

  function normalizeDate(value) {
    const m = String(value || "").match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (!m) return "";
    return `${m[1]}/${String(Number(m[2])).padStart(2, "0")}/${String(Number(m[3])).padStart(2, "0")}`;
  }

  function normalizeShortDate(value, defaultYear = "") {
    const s = norm(value);
    let m = s.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (m) return `${m[1]}/${String(Number(m[2])).padStart(2, "0")}/${String(Number(m[3])).padStart(2, "0")}`;

    m = s.match(/(\d{1,2})[\/\-](\d{1,2})/);
    if (m && defaultYear) {
      return `${defaultYear}/${String(Number(m[1])).padStart(2, "0")}/${String(Number(m[2])).padStart(2, "0")}`;
    }
    return "";
  }

  function addDays(dateText, days) {
    const m = normalizeDate(dateText).match(/(\d{4})\/(\d{2})\/(\d{2})/);
    if (!m) return "";
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  }

  function buildExpectedStart(operationDate, startTime) {
    const date = normalizeDate(operationDate);
    const tm = String(startTime || "").match(/(\d{1,2}):(\d{2})/);
    if (!date || !tm) return "";

    const hour = Number(tm[1]);
    const minute = Number(tm[2]);
    const actualDate = hour < CONFIG.nextDayBeforeHour ? addDays(date, 1) : date;

    return `${actualDate} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  function parseRules(raw) {
    const result = {
      defaultFee: 1000,
      entries: []
    };

    String(raw || "")
      .split(/\r?\n/)
      .map(norm)
      .filter(Boolean)
      .forEach(line => {
        const m = line.match(/^(.+?)\s*[:：\t=]\s*\+?\s*([\d,]+)\s*$/);
        if (!m) return;

        const key = norm(m[1]);
        const fee = Number(m[2].replace(/,/g, ""));
        if (!Number.isFinite(fee)) return;

        if (/^(default|默认|デフォルト)$/i.test(key)) {
          result.defaultFee = fee;
        } else {
          result.entries.push({ keyword: key, fee });
        }
      });

    // 長いキーワード優先
    result.entries.sort((a, b) => b.keyword.length - a.keyword.length);
    const ensureRule = (keyword, fee) => {
      const key = compact(keyword);
      if (!result.entries.some(entry => compact(entry.keyword) === key)) {
        result.entries.push({ keyword, fee });
      }
    };

    ensureRule("Satellite", 0);
    ensureRule("Sattelite", 0);
    ensureRule("Satelite", 0);

    result.entries.sort((a, b) => b.keyword.length - a.keyword.length);
    return result;
  }

  function getDrinkFee(name, rules) {
    const s = compact(name);
    for (const rule of rules.entries) {
      if (s.includes(compact(rule.keyword))) return rule.fee;
    }
    return rules.defaultFee;
  }

  function parseTicketCondition(raw) {
    const s = norm(raw);
    if (!s) {
      return {
        raw: "",
        count: 0,
        cash: 0,
        hasTicket: false
      };
    }

    const countMatch = s.match(/(\d+)\s*Tickets?/i);
    const cashMatch = s.match(/[+＋]\s*[￥¥]?\s*([\d,]+)/);

    const count = countMatch ? Number(countMatch[1]) : 0;
    const cash = cashMatch ? Number(cashMatch[1].replace(/,/g, "")) : 0;

    return {
      raw: s,
      count,
      cash,
      hasTicket: count > 0
    };
  }

  function findHeaderRow(rows, requiredHeaders) {
    for (let i = 0; i < rows.length; i++) {
      const values = rows[i].map(norm);
      if (requiredHeaders.every(h => values.includes(h))) return i;
    }
    return -1;
  }

  function parsePortal(raw, eventPrefix, rules) {
    const rows = parseTsv(raw);
    const headerIndex = findHeaderRow(rows, ["Date", "Start", "#", "Name", "Chips", "DBI", "Ticket"]);
    if (headerIndex < 0) {
      throw new Error("Portal表頭を検出できません。Date / Start / # / Name / Chips / DBI / Ticket を含めてコピーしてください。");
    }

    const headers = rows[headerIndex].map(norm);
    const idx = name => headers.indexOf(name);

    let currentDate = "";
    const result = [];

    for (let r = headerIndex + 1; r < rows.length; r++) {
      const cols = rows[r];
      const dateCell = norm(cols[idx("Date")] || "");
      const parsedDate = normalizeDate(dateCell);
      if (parsedDate) currentDate = parsedDate;

      const noRaw = norm(cols[idx("#")] || "");
      const name = norm(cols[idx("Name")] || "");
      const start = norm(cols[idx("Start")] || "");
      const chipsRaw = norm(cols[idx("Chips")] || "");
      const dbiRaw = norm(cols[idx("DBI")] || "");
      const ticketRaw = norm(cols[idx("Ticket")] || "");

      // 実データ行だけ残す
      if (!name || !start || !currentDate) continue;
      if (!/\d{1,2}:\d{2}/.test(start)) continue;

      const no = normalizeTournamentNo(noRaw, name);
      const expectedStart = buildExpectedStart(currentDate, start);
      const drinkFee = getDrinkFee(name, rules);
      const dbi = moneyToNumber(dbiRaw);
      const chips = parseMoneyExpression(chipsRaw);
      const ticket = parseTicketCondition(ticketRaw);

      const expectedEn = dbi == null ? null : dbi + drinkFee;
      const expectedRe = dbi;
      const expectedTe = ticket.hasTicket && dbi != null
        ? ticket.cash - dbi + ticket.count * CONFIG.ticketUnitValue
        : null;

      result.push({
        portalRow: r + 1,
        operationDate: currentDate,
        no,
        noRaw,
        name,
        fullExpectedName: buildExpectedName(eventPrefix, no, name),
        startRaw: start,
        expectedStart,
        chipsRaw,
        expectedChips: chips.value,
        expectedChipsTotal: chips.total,
        chipsIsSimple: chips.isSimple,
        dbiRaw,
        dbi,
        ticketRaw,
        ticketCount: ticket.count,
        ticketCash: ticket.cash,
        drinkFee,
        expectedEn,
        expectedRe,
        expectedTe,
        matrixAlias: buildMatrixAlias(no, name)
      });
    }

    if (!result.length) {
      throw new Error("Portalから大会行を1件も抽出できませんでした。");
    }

    return result;
  }

  function normalizeTournamentNo(noRaw, name) {
    const s = norm(noRaw);

    if (/^s\d+$/i.test(s)) {
      return `s${String(Number(s.replace(/\D/g, ""))).padStart(2, "0")}`;
    }

    if (/^\d+$/.test(s)) {
      return `#${String(Number(s)).padStart(2, "0")}`;
    }

    if (/sit\s*&?\s*go/i.test(name)) return "Sit";
    if (/fukuoka/i.test(name)) return "Fukuoka";
    if (s === "-") return "-";

    return s || "";
  }

  function buildExpectedName(prefix, no, name) {
    const p = norm(prefix);
    if (!p) return norm(`${no} ${name}`);

    if (/^s\d+$/i.test(no)) return norm(`${p}(${no}) ${name}`);
    if (no === "Sit" || no === "Fukuoka" || no === "-") return norm(`${p}${name}`);
    return norm(`${p}${no} ${name}`);
  }

  function buildMatrixAlias(no, name) {
    if (no === "Sit") return "Sit";
    if (no === "Fukuoka") return "Fukuoka";
    if (/^s\d+$/i.test(no)) return no;

    const day1 = name.match(/Day\s*1\s*([A-Z])/i);
    if (day1) return `${no}(${day1[1].toUpperCase()})`;

    const day2 = name.match(/Day\s*2/i);
    if (day2) return `${no}(D2)`;

    const day3 = name.match(/Day\s*3/i);
    if (day3) return `${no}(D3)`;

    return no;
  }

  function parseTicketMatrix(raw, portalRows) {
    const rows = parseTsv(raw).filter(row => row.some(cell => norm(cell)));
    if (rows.length < 4) throw new Error("Ticket Link表の行数が不足しています。");

    const idRowIndex = rows.findIndex(row =>
      row.some(cell => /^\d{4,}$/.test(norm(cell))) &&
      row.some(cell => /メイン/i.test(norm(cell)))
    );

    if (idRowIndex < 1) {
      throw new Error("Ticket Link表のTournament ID行（メイン行）を検出できません。");
    }

    const labelRowIndex = idRowIndex - 1;
    const dateRowIndex = Math.max(0, idRowIndex - 2);

    const labelRow = rows[labelRowIndex];
    const idRow = rows[idRowIndex];
    const dateRow = rows[dateRowIndex];

    const defaultYear = portalRows.map(x => x.operationDate.slice(0, 4)).find(Boolean) || "";
    let currentDate = "";

    const columns = [];
    const maxCols = Math.max(labelRow.length, idRow.length, dateRow.length);

    for (let c = 0; c < maxCols; c++) {
      const dateCandidate = normalizeShortDate(dateRow[c], defaultYear);
      if (dateCandidate) currentDate = dateCandidate;

      const label = norm(labelRow[c]);
      const tournamentId = norm(idRow[c]);

      if (!label || !/^\d+$/.test(tournamentId)) continue;

      columns.push({
        col: c,
        operationDate: currentDate,
        label: normalizeMatrixLabel(label),
        tournamentId
      });
    }

    if (!columns.length) {
      throw new Error("Ticket Link表から大会列を抽出できませんでした。");
    }

    const ticketRows = [];
    for (let r = idRowIndex + 1; r < rows.length; r++) {
      const row = rows[r];
      const firstCells = row.slice(0, Math.min(...columns.map(x => x.col))).map(norm);
      const ticketName = detectTicketName(firstCells);

      if (!ticketName) continue;

      const links = new Map();
      for (const col of columns) {
        const rawValue = norm(row[col.col]);
        const state = parseLinkState(rawValue);
        links.set(col.tournamentId, {
          raw: rawValue,
          state
        });
      }

      ticketRows.push({
        row: r + 1,
        ticketName,
        normalizedName: normalizeTicketName(ticketName),
        links
      });
    }

    const columnByKey = new Map();
    columns.forEach(col => {
      columnByKey.set(`${col.operationDate}|${col.label}`, col);
    });

    return {
      columns,
      columnByKey,
      ticketRows
    };
  }

  function normalizeMatrixLabel(label) {
    return norm(label)
      .replace(/^(\d+)/, "#$1")
      .replace(/\((d2|d3)\)/i, m => m.toUpperCase())
      .replace(/\s+/g, "");
  }

  function detectTicketName(firstCells) {
    // Ticket名らしい長いセルを優先
    const candidates = firstCells
      .filter(Boolean)
      .filter(x => !/^(Tokyo|Osaka|Sapporo|Fukuoka|メイン|特殊メイン|Voucher|Invitaion|Invitation)$/i.test(x))
      .filter(x => /JOPT|Voucher|Ticket|Invitation|PASS|オンライン/i.test(x));

    return candidates
      .filter(x => !/^(En|Re|TE|Ti|Dr|0)\s*(Entry|Ticket Entry|Drink)?$/i.test(x))
      .filter(x => !/ticket\s*entry|配席|seat|seating/i.test(x))
      .sort((a, b) => b.length - a.length)[0] || "";
  }

  function normalizeTicketName(name) {
    return compact(name)
      .replace(/ticket/g, "")
      .replace(/メインチケット/g, "main")
      .replace(/main event/g, "main")
      .replace(/\/-\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}.*/i, "")
      .replace(/期限.*$/i, "");
  }

  function parseLinkState(value) {
    const s = norm(value).toLowerCase();
    if (CONFIG.trueValues.has(s)) return "LINKED";
    if (!s) return "NOT_LINKED";
    if (s === "≈") return "SPECIAL";
    return "UNKNOWN";
  }

  function matchPortalToMatrix(portal, matrix) {
    const directKey = `${portal.operationDate}|${normalizeMatrixLabel(portal.matrixAlias)}`;
    const direct = matrix.columnByKey.get(directKey);
    if (direct) return { ...direct, matchStatus: "OK" };

    const sameLabel = matrix.columns.filter(c => c.label === normalizeMatrixLabel(portal.matrixAlias));
    if (sameLabel.length === 1) return { ...sameLabel[0], matchStatus: "DATE_FALLBACK" };

    return {
      operationDate: portal.operationDate,
      label: portal.matrixAlias,
      tournamentId: "",
      matchStatus: sameLabel.length > 1 ? "AMBIGUOUS" : "NOT_FOUND"
    };
  }

  function getExpectedTicketLinks(matrix, tournamentId) {
    const linked = [];
    const special = [];

    for (const ticket of matrix.ticketRows) {
      const info = ticket.links.get(String(tournamentId));
      if (!info) continue;

      if (info.state === "LINKED") linked.push(ticket.ticketName);
      if (info.state === "SPECIAL") special.push(ticket.ticketName);
    }

    return { linked, special };
  }

  function popupSnapshot(w) {
    try {
      return {
        href: String(w.location.href || ""),
        title: String(w.document?.title || ""),
        body: String(w.document?.body?.innerText || "")
      };
    } catch (e) {
      return { href: "", title: "", body: "", error: e?.message || String(e) };
    }
  }

  function isRealPage(w, id) {
    const s = popupSnapshot(w);
    return (
      s.href.includes(`/torneio/painel/${id}`) &&
      s.href !== "about:blank" &&
      s.body.length > 80
    );
  }

  function parseHtml(html, url = location.href) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    try {
      Object.defineProperty(doc, "URL", { value: url, configurable: true });
    } catch (_) {}
    return doc;
  }

  function documentLooksLikeTournamentPage(d, id) {
    const url = String(d.URL || "");
    const body = String(d.body?.textContent || "");
    return (
      url.includes(`/torneio/painel/${id}`) &&
      body.length > 80 &&
      !/login|entrar|senha/i.test(String(d.title || ""))
    );
  }

  async function fetchTournamentDocument(tournamentId, expectedName = "") {
    const resolved = resolveTournamentUrl(tournamentId, expectedName);
    const url = resolved.url.startsWith("http")
      ? resolved.url
      : `${location.origin}${resolved.url}`;

    const res = await fetch(url, {
      method: "GET",
      credentials: "same-origin",
      redirect: "follow",
      cache: "no-store"
    });

    if (!res.ok) {
      throw new Error(`PAGE_FETCH_HTTP_${res.status}: ${resolved.tournamentId}`);
    }

    const html = await res.text();
    const doc = parseHtml(html, url);

    if (!documentLooksLikeTournamentPage(doc, resolved.tournamentId)) {
      throw new Error(`PAGE_FETCH_NOT_TOURNAMENT: ${resolved.tournamentId}`);
    }

    return { doc, resolved };
  }

  async function openPopupById(tournamentId, expectedName = "") {
    const resolved = resolveTournamentUrl(tournamentId, expectedName);
    const url = resolved.url.startsWith("http")
      ? resolved.url
      : `${location.origin}${resolved.url}`;

    const w = window.open("", `${CONFIG.popupBaseName}_${resolved.tournamentId}_${Date.now()}`, "width=1280,height=900");
    if (!w) throw new Error("POPUP_BLOCKED");

    w.location.href = url;

    const start = Date.now();
    while (Date.now() - start < CONFIG.pageTimeoutMs) {
      if (!w || w.closed) throw new Error("POPUP_CLOSED");
      if (isRealPage(w, resolved.tournamentId)) {
        w.__PW_DC_V20_RESOLVED_URL = resolved;
        return w;
      }
      await sleep(CONFIG.pollMs);
    }

    throw new Error(`REAL_PAGE_TIMEOUT: ${resolved.tournamentId}`);
  }

  function parseDateTimeText(raw) {
    const s = norm(raw);

    let m = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})\s+(\d{1,2}):(\d{1,2})/);
    if (m) {
      return `${m[3]}/${String(Number(m[2])).padStart(2, "0")}/${String(Number(m[1])).padStart(2, "0")} ${String(Number(m[4])).padStart(2, "0")}:${String(Number(m[5])).padStart(2, "0")}`;
    }

    m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{1,2})/);
    if (m) {
      return `${m[1]}/${String(Number(m[2])).padStart(2, "0")}/${String(Number(m[3])).padStart(2, "0")} ${String(Number(m[4])).padStart(2, "0")}:${String(Number(m[5])).padStart(2, "0")}`;
    }

    return "";
  }

  function extractActualName(d) {
    const input = d.querySelector('input[name="titulo_torneio"]');
    if (input?.value) return norm(input.value);

    const title = norm(d.title || "");
    return title.replace(/\s*-\s*PokerWeb.*$/i, "");
  }

  function extractActualStart(d) {
    const input = d.querySelector('input[name="data_hora_torneio"]');
    if (input?.value) return parseDateTimeText(input.value);
    return "";
  }

  function getDataAttrs(el) {
    const data = {};
    for (const attr of el.attributes || []) {
      if (attr.name.startsWith("data-")) {
        data[attr.name.replace(/^data-/, "")] = attr.value;
      }
    }
    return data;
  }

  function extractPriceItems(d) {
    const els = [...d.querySelectorAll("[data-nome], [data-siglas], [data-valor]")];

    const items = els.map(el => {
      const data = getDataAttrs(el);
      const nome = norm(data.nome || el.getAttribute("data-nome") || "");
      const siglas = norm(data.siglas || el.getAttribute("data-siglas") || "");
      if (!nome && !siglas) return null;

      const value = moneyToNumber(data.valor ?? el.getAttribute("data-valor") ?? "");
      const tax = moneyToNumber(data.taxa ?? el.getAttribute("data-taxa") ?? "");
      const chips = moneyToNumber(data.fichas ?? el.getAttribute("data-fichas") ?? "");
      const limit = norm(data.limite ?? el.getAttribute("data-limite") ?? "");

      return {
        nome,
        siglas,
        value,
        tax,
        total: (value ?? 0) + (tax ?? 0),
        chips,
        limit
      };
    }).filter(Boolean);

    const bySigla = sigla => items.find(x => compact(x.siglas) === compact(sigla));
    const en = bySigla("En") || items.find(x => /entry/i.test(x.nome) && !/re|ticket/i.test(x.nome));
    const re = bySigla("Re") || items.find(x => /re[\s-]*entry/i.test(x.nome));
    const te = bySigla("TE") || bySigla("Ti") || items.find(x => /ticket/i.test(x.nome));

    return { items, en, re, te };
  }

  function extractGeneralSettings(d) {
    const byCampo = {};
    const re = /configGeraisTornStatus\(\s*['"]([^'"]+)['"]/;

    for (const box of [...d.querySelectorAll('input[type="checkbox"]')]) {
      const onchange = box.getAttribute("onchange") || "";
      const m = onchange.match(re);
      if (!m) continue;

      const row = box.closest("tr") || box.parentElement;
      byCampo[m[1]] = {
        found: true,
        checked: !!box.checked,
        id: box.id || "",
        text: norm(row?.innerText || row?.textContent || "")
      };
    }

    const settings = {};
    for (const check of GENERAL_SETTING_CHECKS) {
      settings[check.key] = byCampo[check.campo] || {
        found: false,
        checked: null,
        id: "",
        text: ""
      };
    }
    return settings;
  }

  function generalSettingToStatus(setting) {
    if (!setting?.found) return "CANNOT_READ";
    return setting.checked ? "ON" : "OFF";
  }

  function compareGeneralSetting(setting, expected) {
    if (!setting?.found) return "CHECK";
    return setting.checked === expected ? "OK" : "CHECK";
  }

  function cleanTicketRowText(text) {
    return norm(text)
      .replace(/仮想通貨を使用した販売を許可する/g, "")
      .replace(/\b(on|off)\b/gi, "")
      .replace(/\s+/g, " ");
  }

  function extractActualTicketLinks(d, usdtInfo) {
    const result = [];

    const boxes = [...d.querySelectorAll('input[id^="imp_ticket_"][type="checkbox"]')];
    for (const box of boxes) {
      if (usdtInfo?.id && box.id === usdtInfo.id) continue;

      const row = box.closest("tr") || box.parentElement?.parentElement || box.parentElement;
      const rowText = cleanTicketRowText(row?.innerText || row?.textContent || "");
      const rowKey = compact(rowText);

      if (
        /^(en|re|te|ti|dr|0)$/.test(rowKey) ||
        /^(enentry|reentry|teticketentry|titicketentry|drdrink|drink)$/.test(rowKey) ||
        /ticketentry/i.test(rowText) ||
        /配席|seat|seating/i.test(rowText) ||
        (/\b(en|re|te|ti|dr)\b/i.test(rowText) && /\b(entry|drink)\b/i.test(rowText)) ||
        !/JOPT|Voucher|Invitation|Invitaion|PASS|Ticket|チケット|券|招待/i.test(rowText)
      ) {
        continue;
      }

      result.push({
        id: box.id,
        checked: !!box.checked,
        rowText,
        normalizedName: normalizeTicketName(rowText)
      });
    }

    return result;
  }

  function ticketNameMatches(expectedName, actualRow) {
    const e = normalizeTicketName(expectedName);
    const a = actualRow.normalizedName;
    if (!e || !a) return false;
    return a.includes(e) || e.includes(a);
  }

  function compareTicketLinks(expectedNames, actualRows) {
    const actualLinked = actualRows.filter(x => x.checked);

    const missing = expectedNames.filter(expected =>
      !actualLinked.some(actual => ticketNameMatches(expected, actual))
    );

    const unexpected = actualLinked.filter(actual =>
      !expectedNames.some(expected => ticketNameMatches(expected, actual))
    );

    return {
      status: missing.length || unexpected.length ? "NG" : "OK",
      missing,
      unexpected: unexpected.map(x => x.rowText || x.id),
      actualLinked: actualLinked.map(x => x.rowText || x.id)
    };
  }

  async function extractTournament(tournamentId, expectedName = "") {
    if (CONFIG.fetchPageMode) {
      const { doc, resolved } = await fetchTournamentDocument(tournamentId, expectedName);
      const prices = extractPriceItems(doc);
      const generalSettings = extractGeneralSettings(doc);
      const usdt = generalSettings.USDT;
      const ticketLinks = extractActualTicketLinks(doc, usdt);

      return {
        resolvedTournamentId: resolved.tournamentId,
        resolvedUrl: resolved.url,
        urlSource: resolved.source,
        urlStatus: resolved.status,

        actualName: extractActualName(doc),
        actualStart: extractActualStart(doc),

        actualEn: prices.en?.total ?? null,
        actualRe: prices.re?.total ?? null,
        actualTe: prices.te?.total ?? null,

        actualEnChips: prices.en?.chips ?? null,
        actualReChips: prices.re?.chips ?? null,
        actualTeChips: prices.te?.chips ?? null,

        actualEnLimit: prices.en?.limit || "",
        actualReLimit: prices.re?.limit || "",
        actualTeLimit: prices.te?.limit || "",

        usdtFound: usdt.found,
        usdtOn: usdt.checked,
        usdtId: usdt.id,
        generalSettings,

        ticketLinks
      };
    }

    const w = await openPopupById(tournamentId, expectedName);

    try {
      const resolvedUrl = w.__PW_DC_V20_RESOLVED_URL || resolveTournamentUrl(tournamentId, expectedName);
      const d = w.document;
      const prices = extractPriceItems(d);
      const generalSettings = extractGeneralSettings(d);
      const usdt = generalSettings.USDT;
      const ticketLinks = extractActualTicketLinks(d, usdt);

      return {
        resolvedTournamentId: resolvedUrl.tournamentId,
        resolvedUrl: resolvedUrl.url,
        urlSource: resolvedUrl.source,
        urlStatus: resolvedUrl.status,

        actualName: extractActualName(d),
        actualStart: extractActualStart(d),

        actualEn: prices.en?.total ?? null,
        actualRe: prices.re?.total ?? null,
        actualTe: prices.te?.total ?? null,

        actualEnChips: prices.en?.chips ?? null,
        actualReChips: prices.re?.chips ?? null,
        actualTeChips: prices.te?.chips ?? null,

        actualEnLimit: prices.en?.limit || "",
        actualReLimit: prices.re?.limit || "",
        actualTeLimit: prices.te?.limit || "",

        usdtFound: usdt.found,
        usdtOn: usdt.checked,
        usdtId: usdt.id,
        generalSettings,

        ticketLinks
      };
    } finally {
      if (CONFIG.closePopupAfterEach) {
        try { w.close(); } catch (_) {}
      }
    }
  }

  function eqNum(expected, actual) {
    if (expected == null && actual == null) return true;
    if (expected == null || actual == null) return false;
    return Number(expected) === Number(actual);
  }

  function compareName(expected, actual) {
    if (!expected || !actual) return "CHECK";
    return compact(actual).includes(compact(expected)) || compact(expected).includes(compact(actual))
      ? "OK"
      : "NG";
  }

  function compareSimple(expected, actual) {
    return norm(expected) === norm(actual) ? "OK" : "NG";
  }

  function reviewStatus(status) {
    return status === "NG" ? "CHECK" : status;
  }

  function compareReviewSimple(expected, actual) {
    return reviewStatus(compareSimple(expected, actual));
  }

  function compareReviewName(expected, actual) {
    return reviewStatus(compareName(expected, actual));
  }

  function compareReviewNum(expected, actual) {
    if (expected == null && actual == null) return "OK";
    if (expected == null || actual == null) return "CHECK";
    return eqNum(expected, actual) ? "OK" : "CHECK";
  }

  function joinErrors(parts) {
    return parts.filter(Boolean).join(" | ");
  }

  const OUT_HEADERS = [
    "Overall",
    "TournamentId",
    "Resolved_TournamentId",
    "Resolved_URL",
    "URL_Source",
    "URL_Status",
    "Matrix_Label",
    "Portal_Row",
    "Operation_Date",
    "No",
    "Portal_Name",
    "Actual_Name",
    "Name_Check",

    "Expected_Start",
    "Actual_Start",
    "Start_Check",

    "Portal_Chips",
    "Expected_Chips",
    "Actual_EN_Chips",
    "Chips_Check",

    "DBI",
    "Drink_Fee",
    "Expected_EN",
    "Actual_EN",
    "EN_Check",

    "Expected_RE",
    "Actual_RE",
    "RE_Check",

    "Portal_Ticket",
    "Ticket_Count",
    "Ticket_Cash",
    "Expected_TE",
    "Actual_TE",
    "TE_Check",

    "Expected_Ticket_Link_Count",
    "Actual_Ticket_Link_Count",
    "Ticket_Link_Check",
    "Ticket_Missing",
    "Ticket_Unexpected",

    "USDT_Expected",
    "USDT_Actual",
    "USDT_Check",
    "USDT_Element_Id",

    "General_Settings_Check",
    "Sale_Ticket_View_Expected",
    "Sale_Ticket_View_Actual",
    "Sale_Ticket_View_Check",
    "Ticket_Print_Direct_Expected",
    "Ticket_Print_Direct_Actual",
    "Ticket_Print_Direct_Check",
    "Default_No_Seat_Expected",
    "Default_No_Seat_Actual",
    "Default_No_Seat_Check",
    "Ticket_Image_Rights_Expected",
    "Ticket_Image_Rights_Actual",
    "Ticket_Image_Rights_Check",

    "Matrix_Match",
    "Error"
  ];

  async function runDoubleCheck() {
    if (running) return alert("処理中です");

    const prefix = norm(document.querySelector("#pw-dc-v20-prefix")?.value || "");
    const portalRaw = document.querySelector("#pw-dc-v20-portal")?.value || "";
    const ticketRaw = document.querySelector("#pw-dc-v20-ticket")?.value || "";
    const rulesRaw = document.querySelector("#pw-dc-v20-rules")?.value || "";

    if (!prefix) return alert("① 総大会名を入力してください");
    if (!portalRaw.trim()) return alert("② Portal Tournamentページを貼り付けてください");
    if (!ticketRaw.trim()) return alert("③ 受付Portal Ticket Linkページを貼り付けてください");

    localStorage.setItem(CONFIG.storagePrefix + "prefix", prefix);
    localStorage.setItem(CONFIG.storagePrefix + "portal", portalRaw);
    localStorage.setItem(CONFIG.storagePrefix + "ticket", ticketRaw);
    localStorage.setItem(CONFIG.storagePrefix + "rules", rulesRaw);

    running = true;
    stopRequested = false;

    try {
      log("入力データ解析中…");

      const rules = parseRules(rulesRaw);
      const portalRows = parsePortal(portalRaw, prefix, rules);
      const matrix = parseTicketMatrix(ticketRaw, portalRows);

      const results = [];

      for (let i = 0; i < portalRows.length; i++) {
        if (stopRequested) break;

        const portal = portalRows[i];
        const matrixMatch = matchPortalToMatrix(portal, matrix);
        const base = {};
        OUT_HEADERS.forEach(h => base[h] = "");

        base.Portal_Row = portal.portalRow;
        base.Operation_Date = portal.operationDate;
        base.No = portal.no;
        base.Portal_Name = portal.name;
        base.Expected_Start = portal.expectedStart;
        base.Portal_Chips = portal.chipsRaw;
        base.Expected_Chips = portal.expectedChips ?? "";
        base.DBI = portal.dbi ?? "";
        base.Drink_Fee = portal.drinkFee;
        base.Expected_EN = portal.expectedEn ?? "";
        base.Expected_RE = portal.expectedRe ?? "";
        base.Portal_Ticket = portal.ticketRaw;
        base.Ticket_Count = portal.ticketCount;
        base.Ticket_Cash = portal.ticketCash;
        base.Expected_TE = portal.expectedTe ?? "";
        base.Matrix_Label = matrixMatch.label || portal.matrixAlias;
        base.TournamentId = matrixMatch.tournamentId || "";
        base.Matrix_Match = matrixMatch.matchStatus;

        if (!matrixMatch.tournamentId) {
          base.Overall = "CHECK";
          base.Error = `MATRIX_${matrixMatch.matchStatus}`;
          results.push(base);
          continue;
        }

        try {
          log(`(${i + 1}/${portalRows.length}) fetch #${matrixMatch.tournamentId} ${portal.name}`);

          const actual = await extractTournament(matrixMatch.tournamentId, portal.fullExpectedName);
          const expectedLinks = getExpectedTicketLinks(matrix, actual.resolvedTournamentId || matrixMatch.tournamentId);

          base.Resolved_TournamentId = actual.resolvedTournamentId || "";
          base.Resolved_URL = actual.resolvedUrl || "";
          base.URL_Source = actual.urlSource || "";
          base.URL_Status = actual.urlStatus || "";

          base.Actual_Name = actual.actualName;
          base.Name_Check = compareReviewName(portal.fullExpectedName, actual.actualName);

          base.Actual_Start = actual.actualStart;
          base.Start_Check = compareReviewSimple(portal.expectedStart, actual.actualStart);

          base.Actual_EN_Chips = actual.actualEnChips ?? "";
          if (portal.expectedChips == null || actual.actualEnChips == null) {
            base.Chips_Check = "CHECK";
          } else if (!portal.chipsIsSimple) {
            // 20,000*3 等は1人分との一致を確認しつつCHECK扱い
            base.Chips_Check = eqNum(portal.expectedChips, actual.actualEnChips) ? "CHECK" : "CHECK";
          } else {
            base.Chips_Check = eqNum(portal.expectedChips, actual.actualEnChips) ? "OK" : "CHECK";
          }

          base.Actual_EN = actual.actualEn ?? "";
          base.EN_Check = compareReviewNum(portal.expectedEn, actual.actualEn);

          base.Actual_RE = actual.actualRe ?? "";
          base.RE_Check = compareReviewNum(portal.expectedRe, actual.actualRe);

          base.Actual_TE = actual.actualTe ?? "";
          if (portal.expectedTe == null) {
            base.TE_Check = actual.actualTe == null ? "OK" : "CHECK";
          } else {
            base.TE_Check = compareReviewNum(portal.expectedTe, actual.actualTe);
          }

          const ticketCheck = compareTicketLinks(expectedLinks.linked, actual.ticketLinks);
          base.Expected_Ticket_Link_Count = expectedLinks.linked.length;
          base.Actual_Ticket_Link_Count = ticketCheck.actualLinked.length;
          base.Ticket_Link_Check = expectedLinks.special.length
            ? (ticketCheck.status === "OK" ? "CHECK" : "CHECK")
            : reviewStatus(ticketCheck.status);
          base.Ticket_Missing = ticketCheck.missing.join(" || ");
          base.Ticket_Unexpected = ticketCheck.unexpected.join(" || ");

          base.USDT_Expected = CONFIG.expectedUsdt ? "ON" : "OFF";
          base.USDT_Actual = !actual.usdtFound ? "CANNOT_READ" : (actual.usdtOn ? "ON" : "OFF");
          base.USDT_Check = !actual.usdtFound
            ? "CHECK"
            : actual.usdtOn === CONFIG.expectedUsdt ? "OK" : "CHECK";
          base.USDT_Element_Id = actual.usdtId;

          const generalSettingChecks = [];
          for (const check of GENERAL_SETTING_CHECKS) {
            const setting = actual.generalSettings?.[check.key];
            const expected = check.expected ? "ON" : "OFF";
            const actualStatus = generalSettingToStatus(setting);
            const status = compareGeneralSetting(setting, check.expected);
            if (check.key !== "USDT") {
              base[`${check.key}_Expected`] = expected;
              base[`${check.key}_Actual`] = actualStatus;
              base[`${check.key}_Check`] = status;
              generalSettingChecks.push(status);
            }
          }
          base.General_Settings_Check = generalSettingChecks.every(x => x === "OK") ? "OK" : "CHECK";

          const checks = [
            base.Name_Check,
            base.Start_Check,
            base.Chips_Check,
            base.EN_Check,
            base.RE_Check,
            base.TE_Check,
            base.Ticket_Link_Check,
            base.USDT_Check,
            base.General_Settings_Check
          ];

          base.Overall = checks.includes("CHECK") || checks.includes("NG")
            ? "CHECK"
            : "OK";

          const errors = [];
          if (base.Name_Check === "CHECK") errors.push(`NAME: ${portal.fullExpectedName} <> ${actual.actualName}`);
          if (base.Start_Check === "CHECK") errors.push(`START: ${portal.expectedStart} <> ${actual.actualStart}`);
          if (base.Chips_Check === "CHECK") errors.push(`CHIPS: ${portal.expectedChips ?? "NONE"} <> ${actual.actualEnChips ?? "NONE"}`);
          if (base.EN_Check === "CHECK") errors.push(`EN: ${portal.expectedEn ?? "NONE"} <> ${actual.actualEn ?? "NONE"}`);
          if (base.RE_Check === "CHECK") errors.push(`RE: ${portal.expectedRe ?? "NONE"} <> ${actual.actualRe ?? "NONE"}`);
          if (base.TE_Check === "CHECK") errors.push(`TE: ${portal.expectedTe ?? "NONE"} <> ${actual.actualTe ?? "NONE"}`);
          if (base.Ticket_Link_Check === "CHECK") {
            if (ticketCheck.missing.length) errors.push(`TICKET_MISSING: ${ticketCheck.missing.join(", ")}`);
            if (ticketCheck.unexpected.length) errors.push(`TICKET_UNEXPECTED: ${ticketCheck.unexpected.join(", ")}`);
          }
          if (base.USDT_Check === "CHECK") errors.push(`USDT: EXPECTED ${base.USDT_Expected} <> ACTUAL ${base.USDT_Actual}`);
          for (const check of GENERAL_SETTING_CHECKS.filter(x => x.key !== "USDT")) {
            if (base[`${check.key}_Check`] === "CHECK") {
              errors.push(`${check.label}: EXPECTED ${base[`${check.key}_Expected`]} <> ACTUAL ${base[`${check.key}_Actual`]}`);
            }
          }

          base.Error = joinErrors(errors);

        } catch (e) {
          base.Overall = "ERROR";
          base.Error = e?.message || String(e);
        }

        results.push(base);

        const partial = toTsv(results, OUT_HEADERS);
        window.PW_DC_V20_LAST_TSV = partial;
        localStorage.setItem(CONFIG.storagePrefix + "output", partial);

        await sleep(CONFIG.betweenPagesMs);
      }

      const tsv = toTsv(results, OUT_HEADERS);
      window.PW_DC_V20_LAST_TSV = tsv;
      localStorage.setItem(CONFIG.storagePrefix + "output", tsv);
      const ok = results.filter(x => x.Overall === "OK").length;
      const ng = results.filter(x => x.Overall === "NG").length;
      const check = results.filter(x => x.Overall === "CHECK").length;
      const error = results.filter(x => x.Overall === "ERROR").length;

      showResultModal(results, tsv, { ok, ng, check, error });


      log(`Done: OK ${ok} / CHECK ${check} / ERROR ${error} / Total ${results.length}`);

    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
      log(`ERROR: ${e?.message || String(e)}`);
    } finally {
      running = false;
    }
  }

  function htmlEsc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function resultBadgeStyle(status) {
    if (status === "OK") return "background:#173b25;color:#b9efc0;border-color:#357a4f;";
    if (status === "NG" || status === "ERROR") return "background:#4a1f1f;color:#ffd1d1;border-color:#a55;";
    return "background:#3b3217;color:#ffe6a6;border-color:#9a7a2a;";
  }

  function buildIssueLines(row) {
    const lines = [];
    const add = (label, check, expected, actual) => {
      if (check === "OK" || !check) return;
      lines.push(`${label}: ${check} / expected ${expected || "-"} / actual ${actual || "-"}`);
    };

    add("Name", row.Name_Check, row.Portal_Name, row.Actual_Name);
    add("Start", row.Start_Check, row.Expected_Start, row.Actual_Start);
    add("Chips", row.Chips_Check, row.Expected_Chips, row.Actual_EN_Chips);
    add("EN", row.EN_Check, row.Expected_EN, row.Actual_EN);
    add("RE", row.RE_Check, row.Expected_RE, row.Actual_RE);
    add("TE", row.TE_Check, row.Expected_TE, row.Actual_TE);
    add("Ticket Link", row.Ticket_Link_Check, row.Expected_Ticket_Link_Count, row.Actual_Ticket_Link_Count);
    add("Settings", row.General_Settings_Check, "1/2/4/5 ON, 3 OFF", settingsDetail(row));
    add("USDT", row.USDT_Check, row.USDT_Expected, row.USDT_Actual);

    if (row.Ticket_Missing) lines.push(`Missing ticket: ${row.Ticket_Missing}`);
    if (row.Ticket_Unexpected) lines.push(`Unexpected ticket: ${row.Ticket_Unexpected}`);
    if (row.Error && !lines.length) lines.push(row.Error);

    return lines;
  }

  function buildReadableSummary(results, counts) {
    const title = `Double Check: OK ${counts.ok} / CHECK ${counts.check} / ERROR ${counts.error} / Total ${results.length}`;
    const headers = ["Overall", "Tournament", "Start", "EN", "RE", "TE", "Chips", "Settings", "USDT", "Ticket Link", "Notes"];
    const lines = [
      title,
      "",
      headers.join("\t"),
      ...results.map(row => headers.map(h => humanCell(row, h)).join("\t"))
    ];

    const checkRows = results.filter(row => row.Overall !== "OK");
    if (checkRows.length) {
      lines.push("", "CHECK LIST");
      for (const row of checkRows) {
        lines.push(`${row.Portal_Name || "-"}\t${buildIssueLines(row).join(" / ") || row.Error || "Needs review"}`);
      }
    }

    return lines.join("\n");
  }

  function statusDetail(check, expected, actual) {
    const e = expected === "" || expected == null ? "-" : expected;
    const a = actual === "" || actual == null ? "-" : actual;
    return check === "OK" ? `OK ${a}` : `CHECK ${e} <> ${a}`;
  }

  function ticketLinkDetail(row) {
    if (row.Ticket_Link_Check === "OK") {
      return `OK ${row.Actual_Ticket_Link_Count || 0}/${row.Expected_Ticket_Link_Count || 0}`;
    }

    const parts = [`CHECK ${row.Actual_Ticket_Link_Count || 0}/${row.Expected_Ticket_Link_Count || 0}`];
    if (row.Ticket_Missing) parts.push(`missing: ${row.Ticket_Missing}`);
    if (row.Ticket_Unexpected) parts.push(`unexpected: ${row.Ticket_Unexpected}`);
    return parts.join(" / ");
  }

  function settingsDetail(row) {
    const parts = GENERAL_SETTING_CHECKS
      .filter(x => x.key !== "USDT")
      .map(check => {
        const actual = row[`${check.key}_Actual`] || "-";
        const ok = row[`${check.key}_Check`] === "OK";
        return `${ok ? "OK" : "CHECK"} ${check.label}:${actual}`;
      });
    return parts.join(" / ");
  }

  function humanCell(row, key) {
    if (key === "Overall") return row.Overall || "";
    if (key === "Tournament") return row.Portal_Name || "";
    if (key === "Start") return statusDetail(row.Start_Check, row.Expected_Start, row.Actual_Start);
    if (key === "EN") return statusDetail(row.EN_Check, row.Expected_EN, row.Actual_EN);
    if (key === "RE") return statusDetail(row.RE_Check, row.Expected_RE, row.Actual_RE);
    if (key === "TE") return statusDetail(row.TE_Check, row.Expected_TE, row.Actual_TE);
    if (key === "Chips") return statusDetail(row.Chips_Check, row.Expected_Chips, row.Actual_EN_Chips);
    if (key === "Settings") return row.General_Settings_Check === "OK" ? `OK ${settingsDetail(row)}` : `CHECK ${settingsDetail(row)}`;
    if (key === "USDT") return statusDetail(row.USDT_Check, row.USDT_Expected, row.USDT_Actual);
    if (key === "Ticket Link") return ticketLinkDetail(row);
    if (key === "Notes") return buildIssueLines(row).join(" / ");
    return "";
  }

  function humanTableHtml(results) {
    const headers = ["Overall", "Tournament", "Start", "EN", "RE", "TE", "Chips", "Settings", "USDT", "Ticket Link"];
    return `
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr>
            ${headers.map(h => `<th style="position:sticky;top:0;background:#252525;border:1px solid #444;padding:5px;text-align:left;">${htmlEsc(h)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${results.map(row => `
            <tr>
              ${headers.map(h => {
                const isStatus = h === "Overall";
                const isCheck = String(humanCell(row, h)).startsWith("CHECK") || row.Overall === "ERROR";
                const style = isStatus
                  ? resultBadgeStyle(row.Overall)
                  : isCheck
                    ? "background:#332816;color:#ffe6a6;"
                    : "background:#17251b;color:#c7f6d0;";
                return `<td style="border:1px solid #444;padding:5px;vertical-align:top;${style}">${htmlEsc(humanCell(row, h))}</td>`;
              }).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function showResultModal(results, tsv, counts) {
    document.querySelector("#pw-dc-v20-modal")?.remove();

    const problemRows = results.filter(row => row.Overall !== "OK");
    const readable = buildReadableSummary(results, counts);

    const div = document.createElement("div");
    div.id = "pw-dc-v20-modal";
    div.style.cssText = `
      position:fixed;inset:32px;z-index:1000001;background:#111;color:#fff;
      border:2px solid #6aa9ff;border-radius:10px;padding:14px;
      display:flex;flex-direction:column;gap:10px;font-family:Arial,sans-serif;
    `;

    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong>PW Tournament Double Check v2.0 Result</strong>
        <button id="pw-dc-v20-modal-close">Close</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <span style="padding:5px 9px;border:1px solid #357a4f;background:#173b25;color:#b9efc0;">OK ${counts.ok}</span>
        <span style="padding:5px 9px;border:1px solid #9a7a2a;background:#3b3217;color:#ffe6a6;">CHECK ${counts.check}</span>
        <span style="padding:5px 9px;border:1px solid #a55;background:#4a1f1f;color:#ffd1d1;">ERROR ${counts.error}</span>
        <span style="padding:5px 9px;border:1px solid #555;background:#222;color:#ddd;">Total ${results.length}</span>
      </div>
      <div style="flex:1;min-height:320px;overflow:auto;background:#181818;border:1px solid #444;padding:8px;">
        ${humanTableHtml(results)}
      </div>
      <details ${problemRows.length ? "open" : ""}>
        <summary style="cursor:pointer;color:#ffe6a6;">CHECK List (${problemRows.length})</summary>
        <div style="margin-top:8px;max-height:180px;overflow:auto;background:#181818;border:1px solid #444;padding:8px;">
          ${
            problemRows.length
              ? problemRows.map(row => `
                <div style="border-bottom:1px solid #333;padding:6px 0;">
                  <strong>${htmlEsc(row.Portal_Name || "-")}</strong>
                  <ul style="margin:4px 0 0 20px;padding:0;color:#eee;">
                    ${buildIssueLines(row).map(line => `<li>${htmlEsc(line)}</li>`).join("") || `<li>${htmlEsc(row.Error || "Needs review")}</li>`}
                  </ul>
                </div>
              `).join("")
              : `<div style="color:#b9efc0;">All rows OK.</div>`
          }
        </div>
      <details>
        <summary style="cursor:pointer;color:#9ecbff;">Raw TSV LOG</summary>
        <textarea id="pw-dc-v20-output"
          style="margin-top:8px;width:100%;height:180px;box-sizing:border-box;background:#222;color:#fff;border:1px solid #555;padding:8px;
          font-family:Consolas,monospace;font-size:12px;"></textarea>
      </details>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button id="pw-dc-v20-modal-copy-summary">Copy Summary</button>
        <button id="pw-dc-v20-modal-copy">Copy Raw TSV</button>
      </div>
    `;

    document.body.appendChild(div);
    div.querySelector("#pw-dc-v20-output").value = tsv;
    div.querySelector("#pw-dc-v20-modal-copy-summary").onclick = () => copyText(readable);
    div.querySelector("#pw-dc-v20-modal-copy").onclick = () => copyText(div.querySelector("#pw-dc-v20-output").value);
    div.querySelector("#pw-dc-v20-modal-close").onclick = () => div.remove();
  }

  function stopRun() {
    stopRequested = true;
    log("停止要求：現在の1件が終わったら停止します");
  }

  function addPanel() {
    if (document.querySelector("#pw-dc-v20-panel")) return;

    const panel = document.createElement("div");
    panel.id = "pw-dc-v20-panel";
    panel.style.cssText = `
      position:fixed;right:16px;bottom:16px;z-index:999999;background:#202124;color:#fff;
      width:560px;max-height:92vh;overflow:auto;padding:12px;border-radius:10px;
      box-shadow:0 3px 16px rgba(0,0,0,.45);font:13px Arial,sans-serif;
    `;

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <strong>PW Tournament Double Check v2.0</strong>
        <div>
          <button id="pw-dc-v20-min">Min</button>
          <button id="pw-dc-v20-close">×</button>
        </div>
      </div>

      <div id="pw-dc-v20-body" style="margin-top:10px;">
        <div style="font-weight:bold;margin-top:8px;">① 総大会名</div>
        <div style="font-size:11px;color:#bbb;margin:3px 0;">
          例：【JOPT 2026 Tokyo #02】
        </div>
        <input id="pw-dc-v20-prefix"
          style="width:100%;box-sizing:border-box;background:#111;color:#fff;border:1px solid #555;padding:7px;"
          placeholder="【JOPT 2026 Tokyo #02】">

        <div style="font-weight:bold;margin-top:10px;">② Portal の Tournament ページ</div>
        <div style="font-size:11px;color:#bbb;margin:3px 0;">
          Date / Start / # / Name / Chips / DBI / Ticket を含む表を、そのまま全体コピー
        </div>
        <textarea id="pw-dc-v20-portal"
          style="width:100%;height:150px;box-sizing:border-box;background:#111;color:#fff;border:1px solid #555;padding:7px;font-family:Consolas,monospace;"
          placeholder="Portal Tournamentページを貼り付け"></textarea>

        <div style="font-weight:bold;margin-top:10px;">③ 受付Portal の Ticket Link ページ</div>
        <div style="font-size:11px;color:#bbb;margin:3px 0;">
          上部の日付・大会番号・Tournament ID（メイン行）・Ticket行を含めて、そのまま全体コピー
        </div>
        <textarea id="pw-dc-v20-ticket"
          style="width:100%;height:150px;box-sizing:border-box;background:#111;color:#fff;border:1px solid #555;padding:7px;font-family:Consolas,monospace;"
          placeholder="受付Portal Ticket Linkページを貼り付け"></textarea>

        <details style="margin-top:10px;">
          <summary style="cursor:pointer;font-weight:bold;">詳細設定：ドリンク券ルール</summary>
          <textarea id="pw-dc-v20-rules"
            style="width:100%;height:105px;box-sizing:border-box;margin-top:6px;background:#111;color:#fff;border:1px solid #555;padding:7px;font-family:Consolas,monospace;"></textarea>
        </details>

        <div style="display:flex;gap:8px;margin-top:12px;">
          <button id="pw-dc-v20-run"
            style="flex:1;padding:9px;background:#b9efc0;border:1px solid #7a8;cursor:pointer;font-weight:bold;">
            Double Check
          </button>
          <button id="pw-dc-v20-stop"
            style="padding:9px;background:#f3cccc;border:1px solid #c88;cursor:pointer;">
            Stop
          </button>
        </div>

        <button id="pw-dc-v20-copy"
          style="width:100%;margin-top:8px;padding:8px;background:#d9ecff;border:1px solid #88a;cursor:pointer;">
          Copy Last LOG
        </button>

        <div id="pw-dc-v20-status"
          style="margin-top:8px;font-size:11px;color:#9fe;white-space:pre-wrap;">ready</div>
      </div>
    `;

    document.body.appendChild(panel);

    panel.querySelector("#pw-dc-v20-prefix").value =
      localStorage.getItem(CONFIG.storagePrefix + "prefix") || "";

    panel.querySelector("#pw-dc-v20-portal").value =
      localStorage.getItem(CONFIG.storagePrefix + "portal") || "";

    panel.querySelector("#pw-dc-v20-ticket").value =
      localStorage.getItem(CONFIG.storagePrefix + "ticket") || "";

    panel.querySelector("#pw-dc-v20-rules").value =
      localStorage.getItem(CONFIG.storagePrefix + "rules") ||
`DEFAULT: 1000
Tag Team: 2000
Tag: 2000
3on3: 3000
Crown: 0
Platinum: 0
Satellite: 0
Sattelite: 0`;

    panel.querySelector("#pw-dc-v20-run").onclick = runDoubleCheck;
    panel.querySelector("#pw-dc-v20-stop").onclick = stopRun;

    panel.querySelector("#pw-dc-v20-copy").onclick = () => {
      const tsv = window.PW_DC_V20_LAST_TSV ||
        localStorage.getItem(CONFIG.storagePrefix + "output") || "";
      if (!tsv) return alert("まだLOGがありません");
      copyText(tsv);
      alert("LOGをコピーしました");
    };

    panel.querySelector("#pw-dc-v20-min").onclick = () => {
      const body = panel.querySelector("#pw-dc-v20-body");
      const hidden = body.style.display === "none";
      body.style.display = hidden ? "block" : "none";
      panel.querySelector("#pw-dc-v20-min").textContent = hidden ? "Min" : "Open";
    };

    panel.querySelector("#pw-dc-v20-close").onclick = () => {
      panel.style.display = "none";
    };
  }

  function boot() {
    addPanel();

    window.PWTournamentDC = {
      run: runDoubleCheck,
      stop: stopRun,
      parsePortal,
      parseTicketMatrix
    };

    log("ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
