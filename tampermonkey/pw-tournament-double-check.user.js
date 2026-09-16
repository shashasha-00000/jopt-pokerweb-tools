// ==UserScript==
// @name         PW Tournament DC 表照合
// @namespace    pw-tournament-double-check
// @version      3.0.2
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-tournament-double-check.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-tournament-double-check.user.js
// @description  大会管理表を基準にPokerWeb OPEN大会の名称・開始時刻・Chips・Fee・上限・Settingsを読取専用で照合し、TSVを出力する。
// @author       xhpc007 + ChatGPT
// @match        https://japanopt.bt.pokerweb.com.br/*
// @match        https://japanopt.pokerweb.com.br/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const APP = {
    version: "3.0.2",
    openListPath: "/torneio/abertos",
    pageLength: 100,
    waitMs: 25000,
    pollMs: 300,
    betweenPagesMs: 180,
    nextDayBeforeHour: 6,
    storagePrefix: "PW_TOURNAMENT_DC_TABLE_V3_",
    sharedUrlCacheKey: "PW_SHARED_TOURNAMENT_URL_CACHE_V1"
  };

  const SETTINGS = [
    { key: "Sale_Ticket_View", campo: "config_imprimirutilizados", expected: true, label: "販売チケットを見る" },
    { key: "Ticket_Print_Direct", campo: "config_imprimirdireto", expected: true, label: "チケット印刷" },
    { key: "Default_No_Seat", campo: "config_sentarjog", expected: false, label: "配置しない default" },
    { key: "Ticket_Image_Rights", campo: "ticket_direitoimg", expected: true, label: "画像の権利 statement" },
    { key: "USDT", campo: "vendas_moeda_virtual", expected: true, label: "USDT" }
  ];

  const OUTPUT_HEADERS = [
    "Overall", "表行", "Match", "Candidates", "TournamentId", "URL",
    "表_大会名", "PW_大会名", "大会名_Check",
    "表_赛事日", "表_Start", "換算後_期待Start", "PW_Start", "Start_Check",
    "表_Chips", "期待_Chips", "PW_Chips", "Chips_Check",
    "表_Entry", "PW_Entry", "Entry_Check",
    "表_ReEntry", "PW_ReEntry", "ReEntry_Check",
    "表_Entry上限", "PW_Entry上限", "Entry上限_Check",
    "表_ReEntry上限", "PW_ReEntry上限", "ReEntry上限_Check",
    "Settings_Check",
    "Sale_Ticket_View", "Ticket_Print_Direct", "Default_No_Seat", "Ticket_Image_Rights", "USDT",
    "Source_Check", "Notes", "Error", "CheckedAt"
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

  function canonical(value) {
    return norm(value)
      .normalize("NFKC")
      .replace(/[＃]/g, "#")
      .replace(/[／]/g, "/")
      .replace(/\s+/g, "")
      .toLowerCase();
  }

  function cleanTournamentName(value) {
    return norm(value)
      .replace(/\s*-\s*PokerWeb\s*$/i, "")
      .replace(/\s*監査(?:済み|待ち)\s*$/g, "");
  }

  function nowText() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date());
    const v = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${v.year}-${v.month}-${v.day} ${v.hour}:${v.minute}:${v.second}`;
  }

  function setStatus(text) {
    const el = document.querySelector("#pw-dc-v3-status");
    if (el) el.textContent = text;
    console.log("[PW-TOURNAMENT-DC-v3]", text);
  }

  function copyText(text) {
    try {
      if (typeof GM_setClipboard === "function") {
        GM_setClipboard(text);
        return;
      }
    } catch (_) {}
    navigator.clipboard.writeText(text).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    });
  }

  function escTsv(value) {
    return String(value ?? "").replace(/\r?\n/g, " ").replace(/\t/g, " ").trim();
  }

  function toTsv(rows) {
    return [
      OUTPUT_HEADERS.join("\t"),
      ...rows.map(row => OUTPUT_HEADERS.map(header => escTsv(row[header])).join("\t"))
    ].join("\n");
  }

  function splitTsv(raw) {
    return String(raw || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map(line => line.replace(/\uFEFF/g, "").split("\t"));
  }

  function findCell(row, names) {
    const wanted = names.map(canonical);
    return row.findIndex(cell => wanted.includes(canonical(cell)));
  }

  function normalizeDate(value) {
    const s = norm(value);
    let m = s.match(/(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
    if (!m) m = s.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/);
    if (!m) return "";
    return `${m[1]}/${String(Number(m[2])).padStart(2, "0")}/${String(Number(m[3])).padStart(2, "0")}`;
  }

  function addCalendarDays(dateText, days) {
    const m = String(dateText).match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    if (!m) return "";
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
    return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
  }

  function normalizeTime(value) {
    const m = norm(value).match(/(\d{1,2}):(\d{2})/);
    if (!m) return "";
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour > 23 || minute > 59) return "";
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  function buildExpectedStart(operationDate, timeText) {
    const time = normalizeTime(timeText);
    if (!operationDate || !time) return "";
    const hour = Number(time.slice(0, 2));
    const calendarDate = hour < APP.nextDayBeforeHour ? addCalendarDays(operationDate, 1) : operationDate;
    return `${calendarDate} ${time}`;
  }

  function moneyNumber(value) {
    const s = norm(value);
    if (!s || s === "-") return null;
    const cleaned = s.replace(/[￥¥,，\s]/g, "");
    if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  function numericExpectation(value, expressionAllowed = false) {
    const raw = norm(value);
    if (!raw) return { kind: "BLANK", value: null, raw };
    if (raw === "-") return { kind: "NONE", value: null, raw };
    if (expressionAllowed) {
      const expression = raw.replace(/[￥¥,，\s]/g, "");
      if (/^\d+(?:\*\d+)*(?:\+\d+(?:\*\d+)*)*$/.test(expression)) {
        const valueNumber = expression.split("+").reduce((sum, term) =>
          sum + term.split("*").reduce((product, factor) => product * Number(factor), 1), 0);
        return { kind: "VALUE", value: valueNumber, raw };
      }
    }
    const parsed = moneyNumber(raw);
    return parsed == null
      ? { kind: "INVALID", value: null, raw }
      : { kind: "VALUE", value: parsed, raw };
  }

  function tournamentCode(value) {
    const s = norm(value).normalize("NFKC");
    if (/^\d{1,3}$/.test(s)) return `#${String(Number(s)).padStart(2, "0")}`;
    if (/^s\d{1,3}$/i.test(s)) return `s${String(Number(s.replace(/\D/g, ""))).padStart(2, "0")}`;
    const sat = s.match(/(?:#|\()?\s*s\s*0*(\d{1,3})\s*\)?/i);
    if (sat) return `s${String(Number(sat[1])).padStart(2, "0")}`;
    const no = s.match(/#\s*0*(\d{1,3})([A-Za-z])?/);
    if (no) return `#${String(Number(no[1])).padStart(2, "0")}${(no[2] || "").toUpperCase()}`;
    if (/sit\s*(?:&|and)?\s*go/i.test(s)) return "Sit";
    return "";
  }

  function buildNameFromParts(prefix, noRaw, name) {
    const no = norm(noRaw);
    if (!prefix) return norm(`${no} ${name}`);
    if (/^s\d+$/i.test(no)) return norm(`${prefix}(${no}) ${name}`);
    if (no === "-" || /^sit/i.test(no)) return norm(`${prefix}${name}`);
    if (/^\d+$/.test(no)) return norm(`${prefix}#${String(Number(no)).padStart(2, "0")} ${name}`);
    return norm(`${prefix}${no} ${name}`);
  }

  function categoryColumn(rows, headerIndex, label) {
    for (let r = Math.max(0, headerIndex - 3); r <= headerIndex; r++) {
      const index = findCell(rows[r] || [], [label]);
      if (index >= 0) return index;
    }
    return -1;
  }

  function parseSourceTable(raw, prefix) {
    const rows = splitTsv(raw);
    const headerIndex = rows.findIndex(row =>
      findCell(row, ["Start"]) >= 0 &&
      findCell(row, ["トナメ名"]) >= 0 &&
      findCell(row, ["Name"]) >= 0 &&
      findCell(row, ["エントリー"]) >= 0
    );
    if (headerIndex < 0) {
      throw new Error("表頭を検出できません。Start / トナメ名 / Name / エントリーを含む行を貼り付けてください。");
    }

    const header = rows[headerIndex];
    const startCol = findCell(header, ["Start"]);
    const dateCol = Math.max(0, startCol - 1);
    const fullNameCol = findCell(header, ["トナメ名"]);
    const noCol = findCell(header, ["#"]);
    const nameCol = findCell(header, ["Name"]);
    const chipsCol = categoryColumn(rows, headerIndex, "Chips");
    const entryCol = findCell(header, ["エントリー"]);
    const reentryCol = findCell(header, ["リエントリー"]);
    const entryLimitCol = findCell(header, ["エントリー上限"]);
    const reentryLimitCol = findCell(header, ["リエントリー上限"]);

    const required = { startCol, fullNameCol, nameCol, chipsCol, entryCol, reentryCol, entryLimitCol, reentryLimitCol };
    const missing = Object.entries(required).filter(([, index]) => index < 0).map(([key]) => key);
    if (missing.length) throw new Error(`必要列を検出できません: ${missing.join(", ")}`);

    let currentDate = "";
    const tournaments = [];
    for (let r = headerIndex + 1; r < rows.length; r++) {
      const cols = rows[r];
      const date = normalizeDate(cols[dateCol]);
      if (date) currentDate = date;

      const startRaw = norm(cols[startCol]);
      const shortName = norm(cols[nameCol]);
      const noRaw = noCol >= 0 ? norm(cols[noCol]) : "";
      const suppliedFullName = cleanTournamentName(cols[fullNameCol]);
      const fullName = suppliedFullName || buildNameFromParts(prefix, noRaw, shortName);
      if (!fullName || !shortName || !normalizeTime(startRaw)) continue;

      const conflicts = [];
      const fullCanonical = canonical(fullName);
      if (prefix && !fullCanonical.startsWith(canonical(prefix))) conflicts.push("総大会名とトナメ名の大会Prefixが不一致");
      if (shortName && !fullCanonical.includes(canonical(shortName))) conflicts.push("トナメ名とNameが不一致");
      const sourceCode = tournamentCode(noRaw);
      const fullCode = tournamentCode(fullName);
      if (sourceCode && fullCode && sourceCode !== fullCode) conflicts.push(`#列(${sourceCode})とトナメ名(${fullCode})が不一致`);
      if (!currentDate) conflicts.push("Datesが空または認識不可");

      tournaments.push({
        sourceRow: r + 1,
        operationDate: currentDate,
        startRaw,
        expectedStart: buildExpectedStart(currentDate, startRaw),
        noRaw,
        shortName,
        fullName,
        code: fullCode || sourceCode,
        chips: numericExpectation(cols[chipsCol], true),
        entry: numericExpectation(cols[entryCol]),
        reentry: numericExpectation(cols[reentryCol]),
        entryLimit: numericExpectation(cols[entryLimitCol]),
        reentryLimit: numericExpectation(cols[reentryLimitCol]),
        conflicts
      });
    }
    if (!tournaments.length) throw new Error("大会データ行を1件も抽出できませんでした。");
    return { headerIndex, tournaments };
  }

  function isVisible(win, el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = win.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function waitForWindowLoad(win) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        try {
          if (!win || win.closed) return reject(new Error("OPEN一覧ウィンドウが閉じられました"));
          if (win.document?.readyState === "complete") return resolve();
        } catch (e) {
          return reject(e);
        }
        if (Date.now() - started > APP.waitMs) return reject(new Error("OPEN一覧の読込がtimeoutしました"));
        setTimeout(tick, APP.pollMs);
      };
      tick();
    });
  }

  async function waitForInWindow(win, fn, timeout = 18000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      try {
        const result = fn(win);
        if (result) return result;
      } catch (_) {}
      await sleep(APP.pollMs);
    }
    return null;
  }

  function dataTable(win) {
    try {
      if (!win.jQuery?.fn?.dataTable) return null;
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

  function listRows(win, searchApplied) {
    const result = [];
    const seen = new Set();
    const add = row => {
      if (!row || !String(row.innerHTML || "").includes("/torneio/painel/")) return;
      const key = row.outerHTML || row.innerText;
      if (seen.has(key)) return;
      seen.add(key);
      result.push(row);
    };
    const dt = dataTable(win);
    try {
      if (dt) {
        dt.rows(searchApplied ? { search: "applied" } : {}).nodes().each(add);
        const node = dataTableNode(dt);
        if (node) [...node.querySelectorAll("tbody tr")].forEach(add);
      }
      [...win.document.querySelectorAll("tr")].forEach(add);
    } catch (_) {}
    return result;
  }

  function waitDraw(win, dt) {
    return new Promise(resolve => {
      const node = dataTableNode(dt);
      if (!node || !win.jQuery) return resolve(false);
      let done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        win.clearTimeout(timer);
        try { win.jQuery(node).off("draw.dt", onDraw); } catch (_) {}
        resolve(ok);
      };
      const onDraw = () => finish(true);
      const timer = win.setTimeout(() => finish(false), APP.waitMs);
      try { win.jQuery(node).one("draw.dt", onDraw); } catch (_) { finish(false); }
    });
  }

  async function searchOpenTable(win, prefix) {
    const dt = dataTable(win);
    if (dt) {
      const draw = waitDraw(win, dt);
      const query = norm(prefix).replace(/[【】\[\]]/g, " ");
      dt.search(query || prefix);
      dt.page.len(APP.pageLength);
      dt.page(0);
      dt.draw();
      await draw;
      await sleep(200);
      return dt;
    }
    const input = [...win.document.querySelectorAll('.dataTables_filter input[type="search"],input[type="search"]')].find(el => isVisible(win, el));
    if (input) {
      input.value = prefix;
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
      input.dispatchEvent(new win.Event("change", { bubbles: true }));
      await sleep(900);
    }
    return dataTable(win);
  }

  async function goTablePage(win, dt, page) {
    if (!dt) return;
    const draw = waitDraw(win, dt);
    dt.page(page).draw("page");
    if (!(await draw)) throw new Error(`OPEN一覧 ${page + 1}ページの描画timeout`);
    await sleep(APP.betweenPagesMs);
  }

  function extractListTitle(rowText) {
    let s = norm(rowText);
    const m = s.match(/(【[^】]+】\s*(?:(?:#|\()?s?\d+[A-Za-z]?\)?|-)?\s*.+?)(?:\s+\d{1,2}\/\d{1,2}\/\d{4}|\s+Aberto|\s+オープン|$)/i);
    if (m) return cleanTournamentName(m[1]);
    s = s
      .replace(/^アクション\s+/i, "")
      .replace(/^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s+/, "")
      .replace(/\s+\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}$/, "")
      .replace(/\s+(?:Aberto|オープン)$/i, "");
    return cleanTournamentName(s);
  }

  function extractListTournament(row) {
    const match = String(row.innerHTML || "").match(/\/torneio\/painel\/(\d+)/);
    if (!match) return null;
    const matchedRow = norm(row.innerText || row.textContent || "");
    const actualName = extractListTitle(matchedRow);
    return {
      tournamentId: match[1],
      url: `/torneio/painel/${match[1]}`,
      actualName,
      code: tournamentCode(actualName),
      matchedRow
    };
  }

  function readCache() {
    try {
      const cache = JSON.parse(localStorage.getItem(APP.sharedUrlCacheKey) || "{}");
      return cache && typeof cache === "object" ? cache : {};
    } catch (_) { return {}; }
  }

  function cacheOpenEntry(entry, pageNo) {
    if (!entry.actualName || !entry.tournamentId) return;
    const cache = readCache();
    const key = `${entry.actualName}||${entry.tournamentId}`;
    const previous = cache[key] || {};
    cache[key] = {
      name: entry.actualName,
      tournamentId: entry.tournamentId,
      url: entry.url,
      painelUrl: entry.url,
      actualName: entry.actualName,
      matchedRow: entry.matchedRow,
      sameNameStatus: previous.sameNameStatus || "",
      savedAt: nowText(),
      source: `tournament-dc-OPEN-p${pageNo}`
    };
    localStorage.setItem(APP.sharedUrlCacheKey, JSON.stringify(cache));
  }

  async function scanOpen(prefix) {
    const win = window.open(APP.openListPath, `pw_tournament_dc_open_${Date.now()}`, "width=1280,height=900");
    if (!win) throw new Error("Popupがブロックされました。OPEN一覧を開けません。");
    const found = [];
    const seen = new Set();
    try {
      await waitForWindowLoad(win);
      await waitForInWindow(win, w => dataTable(w) || listRows(w, false).length);
      await sleep(500);
      const dt = await searchOpenTable(win, prefix);
      const pages = dt?.page?.info?.()?.pages || 1;
      for (let page = 0; page < pages; page++) {
        if (stopRequested) break;
        if (dt) await goTablePage(win, dt, page);
        for (const row of listRows(win, true)) {
          const entry = extractListTournament(row);
          if (!entry) continue;
          const hay = canonical(`${entry.actualName} ${entry.matchedRow}`);
          if (!hay.includes(canonical(prefix))) continue;
          if (seen.has(entry.url)) continue;
          seen.add(entry.url);
          found.push(entry);
          cacheOpenEntry(entry, page + 1);
        }
      }
    } finally {
      try { if (!win.closed) win.close(); } catch (_) {}
    }
    return found;
  }

  function nameWithoutPrefix(value) {
    return cleanTournamentName(value).replace(/^【[^】]+】\s*/, "");
  }

  function matchSourceTournament(source, entries) {
    const exact = entries.filter(entry => canonical(entry.actualName) === canonical(source.fullName));
    if (exact.length === 1) return { status: "EXACT", entry: exact[0], candidates: exact };
    if (exact.length > 1) return { status: "AMBIGUOUS_EXACT", entry: null, candidates: exact };

    const sourceName = canonical(source.shortName);
    const codeAndName = entries.filter(entry =>
      source.code && entry.code === source.code && canonical(nameWithoutPrefix(entry.actualName)).includes(sourceName)
    );
    if (codeAndName.length === 1) return { status: "KEY_NAME", entry: codeAndName[0], candidates: codeAndName };

    const sameName = entries.filter(entry => canonical(nameWithoutPrefix(entry.actualName)).includes(sourceName));
    if (sameName.length === 1) return { status: "NAME_UNIQUE", entry: sameName[0], candidates: sameName };

    const candidates = codeAndName.length ? codeAndName : entries.filter(entry => source.code && entry.code === source.code);
    return { status: candidates.length > 1 ? "AMBIGUOUS" : "NOT_FOUND", entry: null, candidates };
  }

  function parseDateTimeText(value) {
    const s = norm(value);
    let m = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})\s+(\d{1,2}):(\d{2})/);
    if (m) return `${m[3]}/${String(Number(m[2])).padStart(2, "0")}/${String(Number(m[1])).padStart(2, "0")} ${String(Number(m[4])).padStart(2, "0")}:${m[5]}`;
    m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})/);
    if (m) return `${m[1]}/${String(Number(m[2])).padStart(2, "0")}/${String(Number(m[3])).padStart(2, "0")} ${String(Number(m[4])).padStart(2, "0")}:${m[5]}`;
    return "";
  }

  function getDataAttrs(el) {
    const data = {};
    for (const attr of el.attributes || []) {
      if (attr.name.startsWith("data-")) data[attr.name.slice(5)] = attr.value;
    }
    return data;
  }

  function extractPriceItems(doc) {
    const items = [...doc.querySelectorAll("[data-nome], [data-siglas], [data-valor]")].map(el => {
      const data = getDataAttrs(el);
      const name = norm(data.nome || el.getAttribute("data-nome") || "");
      const sigla = norm(data.siglas || el.getAttribute("data-siglas") || "");
      if (!name && !sigla) return null;
      const value = moneyNumber(data.valor ?? el.getAttribute("data-valor") ?? "");
      const tax = moneyNumber(data.taxa ?? el.getAttribute("data-taxa") ?? "");
      const chips = moneyNumber(data.fichas ?? el.getAttribute("data-fichas") ?? "");
      const limit = moneyNumber(data.limite ?? el.getAttribute("data-limite") ?? "");
      return { name, sigla, value, tax, total: (value ?? 0) + (tax ?? 0), chips, limit };
    }).filter(Boolean);
    const bySigla = sigla => items.find(item => canonical(item.sigla) === canonical(sigla));
    return {
      items,
      en: bySigla("En") || items.find(item => /entry/i.test(item.name) && !/re|ticket/i.test(item.name)),
      re: bySigla("Re") || items.find(item => /re[\s-]*entry/i.test(item.name))
    };
  }

  function extractSettings(doc) {
    const actualByCampo = {};
    const re = /configGeraisTornStatus\(\s*['"]([^'"]+)['"]/;
    for (const box of [...doc.querySelectorAll('input[type="checkbox"]')]) {
      const match = String(box.getAttribute("onchange") || "").match(re);
      if (match) actualByCampo[match[1]] = !!box.checked;
    }
    return Object.fromEntries(SETTINGS.map(setting => [setting.key, {
      expected: setting.expected,
      found: Object.prototype.hasOwnProperty.call(actualByCampo, setting.campo),
      actual: Object.prototype.hasOwnProperty.call(actualByCampo, setting.campo) ? actualByCampo[setting.campo] : null
    }]));
  }

  async function fetchActual(entry) {
    const response = await fetch(new URL(entry.url, location.origin).href, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error(`GET ${response.status}: ${entry.url}`);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const titleInput = doc.querySelector('input[name="titulo_torneio"]');
    const name = cleanTournamentName(titleInput?.value || doc.title);
    const start = parseDateTimeText(doc.querySelector('input[name="data_hora_torneio"]')?.value || "");
    if (!titleInput || (!doc.querySelector("[data-nome]") && !doc.querySelector('input[onchange*="configGeraisTornStatus"]'))) {
      throw new Error("大会ページを確認できません");
    }
    return { name, start, prices: extractPriceItems(doc), settings: extractSettings(doc) };
  }

  function compareText(expected, actual) {
    if (!expected) return "SOURCE_BLANK";
    if (!actual) return "CANNOT_READ";
    return canonical(expected) === canonical(actual) ? "OK" : "DIFF";
  }

  function compareExpected(expected, actualItem, field) {
    if (expected.kind === "BLANK") return "SOURCE_BLANK";
    if (expected.kind === "INVALID") return "SOURCE_INVALID";
    const actual = actualItem ? actualItem[field] : null;
    if (expected.kind === "NONE") return actualItem == null ? "OK" : "DIFF";
    if (actual == null) return "CANNOT_READ";
    return Number(expected.value) === Number(actual) ? "OK" : "DIFF";
  }

  function settingsStatus(settings) {
    const states = SETTINGS.map(setting => {
      const value = settings[setting.key];
      if (!value?.found) return "CANNOT_READ";
      return value.actual === value.expected ? "OK" : "DIFF";
    });
    if (states.includes("CANNOT_READ")) return "CANNOT_READ";
    return states.includes("DIFF") ? "DIFF" : "OK";
  }

  function settingDisplay(setting, values) {
    const value = values[setting.key];
    if (!value?.found) return `期待:${setting.expected ? "ON" : "OFF"} / 実際:CANNOT_READ`;
    return `期待:${setting.expected ? "ON" : "OFF"} / 実際:${value.actual ? "ON" : "OFF"} / ${value.actual === setting.expected ? "OK" : "DIFF"}`;
  }

  function overallFromRow(row, sourceConflicts) {
    if (row.Error) return "ERROR";
    if (!/^(EXACT|KEY_NAME|NAME_UNIQUE)$/.test(row.Match)) return "要人工確認";
    if (sourceConflicts.length) return "表側要確認";
    const checks = [
      row["大会名_Check"], row["Start_Check"], row["Chips_Check"], row["Entry_Check"],
      row["ReEntry_Check"], row["Entry上限_Check"], row["ReEntry上限_Check"], row["Settings_Check"]
    ];
    if (checks.some(check => check === "DIFF" || check === "CANNOT_READ")) return "不一致";
    if (checks.some(check => check === "SOURCE_BLANK" || check === "SOURCE_INVALID")) return "表側要確認";
    return "一致";
  }

  function baseOutput(source, match) {
    return {
      "Overall": "",
      "表行": source.sourceRow,
      "Match": match.status,
      "Candidates": match.candidates.map(item => `${item.tournamentId}:${item.actualName}`).join(" | "),
      "TournamentId": match.entry?.tournamentId || "",
      "URL": match.entry?.url || "",
      "表_大会名": source.fullName,
      "PW_大会名": "",
      "大会名_Check": "",
      "表_赛事日": source.operationDate,
      "表_Start": source.startRaw,
      "換算後_期待Start": source.expectedStart,
      "PW_Start": "",
      "Start_Check": "",
      "表_Chips": source.chips.raw,
      "期待_Chips": source.chips.value ?? (source.chips.kind === "NONE" ? "NONE" : ""),
      "PW_Chips": "",
      "Chips_Check": "",
      "表_Entry": source.entry.raw,
      "PW_Entry": "",
      "Entry_Check": "",
      "表_ReEntry": source.reentry.raw,
      "PW_ReEntry": "",
      "ReEntry_Check": "",
      "表_Entry上限": source.entryLimit.raw,
      "PW_Entry上限": "",
      "Entry上限_Check": "",
      "表_ReEntry上限": source.reentryLimit.raw,
      "PW_ReEntry上限": "",
      "ReEntry上限_Check": "",
      "Settings_Check": "",
      "Sale_Ticket_View": "", "Ticket_Print_Direct": "", "Default_No_Seat": "", "Ticket_Image_Rights": "", "USDT": "",
      "Source_Check": source.conflicts.length ? "CHECK" : "OK",
      "Notes": source.conflicts.join(" | "),
      "CheckedAt": nowText(),
      "Error": ""
    };
  }

  async function checkTournament(source, match) {
    const row = baseOutput(source, match);
    if (!match.entry) {
      row.Overall = "要人工確認";
      row.Notes = [row.Notes, match.status === "NOT_FOUND" ? "OPEN大会が見つかりません" : "候補が複数あります"].filter(Boolean).join(" | ");
      return row;
    }
    try {
      const actual = await fetchActual(match.entry);
      row["PW_大会名"] = actual.name;
      row["大会名_Check"] = compareText(source.fullName, actual.name);
      row["PW_Start"] = actual.start;
      row["Start_Check"] = compareText(source.expectedStart, actual.start);
      row["PW_Chips"] = actual.prices.en?.chips ?? "NONE";
      row["Chips_Check"] = compareExpected(source.chips, actual.prices.en, "chips");
      row["PW_Entry"] = actual.prices.en?.total ?? "NONE";
      row["Entry_Check"] = compareExpected(source.entry, actual.prices.en, "total");
      row["PW_ReEntry"] = actual.prices.re?.total ?? "NONE";
      row["ReEntry_Check"] = compareExpected(source.reentry, actual.prices.re, "total");
      row["PW_Entry上限"] = actual.prices.en?.limit ?? "NONE";
      row["Entry上限_Check"] = compareExpected(source.entryLimit, actual.prices.en, "limit");
      row["PW_ReEntry上限"] = actual.prices.re?.limit ?? "NONE";
      row["ReEntry上限_Check"] = compareExpected(source.reentryLimit, actual.prices.re, "limit");
      row["Settings_Check"] = settingsStatus(actual.settings);
      for (const setting of SETTINGS) row[setting.key] = settingDisplay(setting, actual.settings);
    } catch (e) {
      row.Error = e?.message || String(e);
      row.Notes = [row.Notes, row.Error].filter(Boolean).join(" | ");
    }
    row.Overall = overallFromRow(row, source.conflicts);
    return row;
  }

  async function runDc() {
    if (running) return alert("処理中です");
    const prefix = norm(document.querySelector("#pw-dc-v3-prefix")?.value || "");
    const raw = document.querySelector("#pw-dc-v3-source")?.value || "";
    if (!prefix) return alert("総大会名を入力してください。例：【SPADIE OSAKA 1st】");
    if (!norm(raw)) return alert("大会管理表を貼り付けてください。");

    localStorage.setItem(APP.storagePrefix + "PREFIX", prefix);
    localStorage.setItem(APP.storagePrefix + "SOURCE", raw);
    running = true;
    stopRequested = false;
    try {
      setStatus("大会管理表を解析中...");
      const parsed = parseSourceTable(raw, prefix);
      setStatus(`OPEN URLスキャン中... 表 ${parsed.tournaments.length}件`);
      const entries = await scanOpen(prefix);
      if (!entries.length) throw new Error("OPEN一覧から対象大会を1件も検出できませんでした。");

      const results = [];
      for (let i = 0; i < parsed.tournaments.length; i++) {
        if (stopRequested) break;
        const source = parsed.tournaments[i];
        const match = matchSourceTournament(source, entries);
        setStatus(`照合中 ${i + 1}/${parsed.tournaments.length}: ${source.fullName}`);
        results.push(await checkTournament(source, match));
        await sleep(100);
      }

      const tsv = toTsv(results);
      const output = document.querySelector("#pw-dc-v3-output");
      if (output) output.value = tsv;
      localStorage.setItem(APP.storagePrefix + "OUTPUT", tsv);
      const counts = results.reduce((acc, row) => {
        acc[row.Overall] = (acc[row.Overall] || 0) + 1;
        return acc;
      }, {});
      setStatus(`完了 / 一致 ${counts["一致"] || 0} / 不一致 ${counts["不一致"] || 0} / 表側要確認 ${counts["表側要確認"] || 0} / 要人工確認 ${counts["要人工確認"] || 0} / ERROR ${counts.ERROR || 0}`);
      alert(`PW Tournament DC 完了\n\nOPEN検出: ${entries.length}件\n表: ${parsed.tournaments.length}件\n一致: ${counts["一致"] || 0}\n不一致: ${counts["不一致"] || 0}\n表側要確認: ${counts["表側要確認"] || 0}\n要人工確認: ${counts["要人工確認"] || 0}\nERROR: ${counts.ERROR || 0}`);
    } catch (e) {
      console.error("[PW-TOURNAMENT-DC-v3]", e);
      setStatus(`ERROR: ${e?.message || e}`);
      alert("ERROR: " + (e?.message || String(e)));
    } finally {
      running = false;
      stopRequested = false;
    }
  }

  function clearInputs() {
    if (!confirm("大会名・入力表・出力TSVをクリアしますか？")) return;
    for (const id of ["#pw-dc-v3-prefix", "#pw-dc-v3-source", "#pw-dc-v3-output"]) {
      const el = document.querySelector(id);
      if (el) el.value = "";
    }
    for (const key of ["PREFIX", "SOURCE", "OUTPUT"]) localStorage.removeItem(APP.storagePrefix + key);
    setStatus("クリアしました");
  }

  function addPanel() {
    if (document.querySelector("#pw-dc-v3-panel")) return;
    const panel = document.createElement("div");
    panel.id = "pw-dc-v3-panel";
    panel.style.cssText = "position:fixed;right:16px;top:16px;z-index:2147483646;width:min(760px,calc(100vw - 32px));max-height:94vh;overflow:auto;background:#111827;color:#fff;border:1px solid #64748b;border-radius:12px;padding:12px;box-shadow:0 12px 32px rgba(0,0,0,.45);font-family:Arial,sans-serif;";
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="font-size:16px;font-weight:bold;color:#fde68a;">PW Tournament DC 表照合 v${APP.version}</div>
        <div><button id="pw-dc-v3-min">Min</button> <button id="pw-dc-v3-close">x</button></div>
      </div>
      <div id="pw-dc-v3-body">
        <div style="font-size:11px;color:#cbd5e1;line-height:1.45;margin:7px 0;">大会管理表を基準にOPEN大会だけを読取専用で照合します。同名候補が複数ある場合は自動選択せず、Candidatesへ全TournamentIdを表示して要人工確認にします。Ticket LinkはPW Ticket Link Semi Auto側で確認します。00:00–05:59は表の赛事日から翌日へ換算します。</div>
        <div style="font-weight:bold;margin-top:6px;">1. 総大会名</div>
        <input id="pw-dc-v3-prefix" placeholder="【SPADIE OSAKA 1st】" style="width:100%;box-sizing:border-box;background:#020617;color:#fff;border:1px solid #475569;padding:8px;">
        <div style="font-weight:bold;margin-top:8px;">2. 大会管理表</div>
        <div style="font-size:11px;color:#cbd5e1;">Start / トナメ名 / Name / Chips / エントリー / リエントリー / 上限を含む範囲を貼り付け</div>
        <textarea id="pw-dc-v3-source" style="width:100%;height:180px;box-sizing:border-box;background:#020617;color:#fff;border:1px solid #475569;padding:8px;font-family:Consolas,monospace;"></textarea>
        <div style="display:flex;gap:6px;margin-top:7px;">
          <button id="pw-dc-v3-run" style="flex:2;padding:8px;background:#bbf7d0;border:1px solid #16a34a;cursor:pointer;">OPENをスキャンしてDC</button>
          <button id="pw-dc-v3-stop" style="flex:1;padding:8px;background:#fecaca;border:1px solid #dc2626;cursor:pointer;">Stop</button>
          <button id="pw-dc-v3-clear" style="flex:1;padding:8px;cursor:pointer;">Clear</button>
        </div>
        <div style="font-weight:bold;margin-top:8px;">DC TSV / Output</div>
        <textarea id="pw-dc-v3-output" readonly style="width:100%;height:220px;box-sizing:border-box;background:#020617;color:#a7f3d0;border:1px solid #475569;padding:8px;font-family:Consolas,monospace;"></textarea>
        <button id="pw-dc-v3-copy" style="width:100%;padding:8px;margin-top:5px;cursor:pointer;">Copy DC TSV</button>
        <div id="pw-dc-v3-status" style="font-size:11px;color:#93c5fd;white-space:pre-wrap;margin-top:7px;">ready</div>
      </div>`;
    document.body.appendChild(panel);

    document.querySelector("#pw-dc-v3-prefix").value = localStorage.getItem(APP.storagePrefix + "PREFIX") || "";
    document.querySelector("#pw-dc-v3-source").value = localStorage.getItem(APP.storagePrefix + "SOURCE") || "";
    document.querySelector("#pw-dc-v3-output").value = localStorage.getItem(APP.storagePrefix + "OUTPUT") || "";
    document.querySelector("#pw-dc-v3-run").onclick = runDc;
    document.querySelector("#pw-dc-v3-stop").onclick = () => { stopRequested = true; setStatus("停止要求を受け付けました"); };
    document.querySelector("#pw-dc-v3-clear").onclick = clearInputs;
    document.querySelector("#pw-dc-v3-copy").onclick = () => {
      const text = document.querySelector("#pw-dc-v3-output")?.value || "";
      if (!norm(text)) return alert("出力TSVがありません。");
      copyText(text);
      alert("DC TSVをコピーしました。");
    };
    document.querySelector("#pw-dc-v3-min").onclick = () => {
      const body = document.querySelector("#pw-dc-v3-body");
      const hidden = body.style.display === "none";
      body.style.display = hidden ? "block" : "none";
      document.querySelector("#pw-dc-v3-min").textContent = hidden ? "Min" : "Open";
    };
    document.querySelector("#pw-dc-v3-close").onclick = () => { panel.style.display = "none"; };
  }

  function boot() {
    addPanel();
    window.PWTournamentDC = { run: runDc, parseSourceTable, scanOpen, stop: () => { stopRequested = true; } };
    setStatus("ready / OPENのみ / Ticket Link DCなし");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
