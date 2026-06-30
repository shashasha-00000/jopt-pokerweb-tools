// ==UserScript==
// @name         PW Prize Check Readonly
// @namespace    https://japanopt.pokerweb.com.br/
// @version      1.4.0
// @description  Google Sheet Prize and Portal tournaments readonly checker for PokerWeb.
// @match        https://japanopt.pokerweb.com.br/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const APP = {
    name: 'PW-PRIZE-CHECK',
    panelId: 'pw-prize-check-panel',
    stateKey: 'PW_PRIZE_CHECK_READONLY_STATE_V3',
    scanKey: 'PW_PRIZE_CHECK_READONLY_SCAN_V3',
    urlCacheKey: 'PW_SHARED_TOURNAMENT_URL_CACHE_V1',
    legacyKeys: [
      'PW_PRIZE_CHECK_STATE_V1',
      'PW_PRIZE_CHECK_REPORT_V1',
      'PW_PRIZE_CHECK_PREVIEW_V1',
      'PW_PRIZE_BATCH_MANUAL_STATE_V1',
      'PW_PRIZE_BATCH_MANUAL_REPORT_V1',
      'PW_PRIZE_BATCH_MANUAL_PREVIEW_V1'
    ]
  };

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const debugLines = [];

  function debug(message, data) {
    const line = `[${new Date().toLocaleString('ja-JP')}] ${message}` +
      (data == null ? '' : ` ${typeof data === 'string' ? data : JSON.stringify(data)}`);
    debugLines.push(line);
    const el = document.getElementById('pwPrizeCheckDetailLog');
    if (el) el.value = debugLines.join('\n');
    console.log(`[${APP.name}]`, message, data || '');
  }

  function safeJsonParse(text, fallback = null) {
    try { return JSON.parse(text); } catch (_) { return fallback; }
  }

  function loadState() {
    return safeJsonParse(sessionStorage.getItem(APP.stateKey), null);
  }

  function saveState(state) {
    sessionStorage.setItem(APP.stateKey, JSON.stringify({ ...state, mode: 'READONLY_CHECK' }));
  }

  function clearState() {
    sessionStorage.removeItem(APP.stateKey);
  }

  function loadScan() {
    return safeJsonParse(sessionStorage.getItem(APP.scanKey), null);
  }

  function saveScan(scan) {
    sessionStorage.setItem(APP.scanKey, JSON.stringify(scan));
  }

  function clearLegacyState() {
    for (const key of APP.legacyKeys) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function normalizeSpace(value) {
    return String(value || '').replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalizeText(value) {
    return normalizeSpace(value)
      .toLowerCase()
      .replace(/[【】\[\]（）()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeMoney(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    if (/\$|usdt|usd/i.test(raw)) return null;
    const cleaned = raw
      .replace(/[￥¥,]/g, '')
      .replace(/\s+/g, '')
      .replace(/[^\d.-]/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  function splitTsv(raw) {
    return String(raw || '').replace(/\r/g, '').split('\n').map(line => line.split('\t'));
  }

  function cell(row, index) {
    return row && index >= 0 ? String(row[index] ?? '').trim() : '';
  }

  function inheritedCell(row, index, minIndex = 0) {
    for (let col = index; col >= minIndex; col--) {
      const value = normalizeSpace(cell(row, col));
      if (value) return value;
    }
    return '';
  }

  function blockStatusCell(statusRow, col, block) {
    const left = Math.max(0, block.startCol - 3);
    const right = Math.min(statusRow.length, block.endCol + 3);
    const sameBlock = inheritedCell(statusRow, col, block.startCol);
    if (sameBlock) return sameBlock;
    for (let c = col + 1; c < block.endCol; c++) {
      const value = normalizeSpace(cell(statusRow, c));
      if (value) return value;
    }
    for (let c = col; c >= left; c--) {
      const value = normalizeSpace(cell(statusRow, c));
      if (value) return value;
    }
    for (let c = col + 1; c < right; c++) {
      const value = normalizeSpace(cell(statusRow, c));
      if (value) return value;
    }
    return '';
  }

  function findRowIndex(rows, labelPattern) {
    return rows.findIndex(row => labelPattern.test(cell(row, 0)));
  }

  function findAnyRowIndex(rows, predicate) {
    return rows.findIndex(row => row.some(value => predicate(normalizeSpace(value))));
  }

  function looksLikeStatusValue(value) {
    return /確定|不使用|アップグレード|upgrade/i.test(normalizeSpace(value));
  }

  function parseRank(value) {
    const m = String(value || '').match(/\d+/);
    return m ? Number(m[0]) : null;
  }

  function isRankLabel(value) {
    return /^\d+\s*(?:位|st|nd|rd|th)?$/i.test(String(value || '').trim());
  }

  function findRankRows(rows, currencyRowIndex) {
    const start = Math.max(0, currencyRowIndex + 1);
    const maxCols = Math.max(0, ...rows.map(row => row.length));
    let best = { col: 0, items: [] };
    for (let col = 0; col < Math.min(maxCols, 8); col++) {
      const items = [];
      for (let r = start; r < rows.length; r++) {
        const value = cell(rows[r], col);
        const rank = parseRank(value);
        if (rank && isRankLabel(value)) items.push({ row: rows[r], rank });
      }
      if (items.length > best.items.length) best = { col, items };
    }
    return best.items;
  }

  function isPwCoinLabel(value) {
    return /PW\s*COIN/i.test(String(value || ''));
  }

  function looksLikeTournamentTitle(value) {
    const text = normalizeSpace(value);
    if (!text) return false;
    if (/^\d{1,2}\/\d{1,2}$/.test(text)) return false;
    if (/^(Entry|Fee|Rake|Other Costs|USDT|USD|PW\s*COIN|JPY|Date|Close|Total|Status|In Prize|In Prize %)$/i.test(text)) return false;
    return /[A-Za-z\u3040-\u30ff\u3400-\u9fff]/.test(text);
  }

  function findCurrencyRowIndex(rows, statusRowIndex) {
    for (let i = statusRowIndex + 1; i < Math.min(rows.length, statusRowIndex + 5); i++) {
      if ((rows[i] || []).some(value => isPwCoinLabel(value))) return i;
    }
    return rows.findIndex(row => row.some(value => isPwCoinLabel(value)));
  }

  function buildTournamentBlocks(tournamentRow, currencyRow) {
    const titleCols = [];
    for (let col = 0; col < tournamentRow.length; col++) {
      const title = normalizeSpace(cell(tournamentRow, col));
      if (looksLikeTournamentTitle(title)) titleCols.push({ col, title });
    }
    return titleCols.map((item, index) => {
      const endCol = index + 1 < titleCols.length ? titleCols[index + 1].col : tournamentRow.length;
      return { titleCol: item.col, title: item.title, startCol: item.col, endCol };
    }).filter(block => {
      for (let col = block.startCol; col < block.endCol; col++) {
        if (isPwCoinLabel(cell(currencyRow, col))) return true;
      }
      return false;
    });
  }

  function stripVersionLabels(name) {
    return normalizeSpace(name)
      .replace(/[（(]\s*(?:全体|コインのみ|voucherのみ|バウチャーのみ|APT抜き|apt抜き)\s*[）)]/gi, '')
      .replace(/\s*\d+\s*位\s*$/i, '')
      .replace(/\s*(?:アップグレード|upgrade)\s*$/gi, '')
      .trim();
  }

  function baseKey(name) {
    return normalizeText(stripVersionLabels(name))
      .replace(/\bsponsored\s+by\b.*$/i, ' ')
      .replace(/\b(nlh|plo|fl|hold'?em|omaha|draw|event|sponsored|by)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function compactKey(name) {
    return baseKey(name).replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]/g, '');
  }

  function romanValue(value) {
    const text = String(value || '').toUpperCase();
    const map = {
      'Ⅰ': 1, 'Ⅱ': 2, 'Ⅲ': 3, 'Ⅳ': 4, 'Ⅴ': 5, 'Ⅵ': 6, 'Ⅶ': 7, 'Ⅷ': 8, 'Ⅸ': 9, 'Ⅹ': 10,
      'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10
    };
    return map[text] || null;
  }

  function normalizeRunSuffix(name) {
    const value = stripVersionLabels(name);
    return value.replace(/\s*([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]|I{1,3}|IV|V|VI{0,3}|IX|X)\s*$/i, (_, roman) => {
      const num = romanValue(roman);
      return num ? String(num) : roman;
    });
  }

  function detectVersion(title) {
    const text = normalizeText(title);
    if (/コインのみ|coin only|pw coin only/.test(text)) return 'coin';
    if (/voucherのみ|voucher only|バウチャーのみ/.test(text)) return 'voucher';
    if (/全体|overall/.test(text)) return 'all';
    if (/upgrade|アップグレード/.test(text)) return 'upgrade';
    if (/apt抜き|without apt/.test(text)) return 'special';
    return 'base';
  }

  function detectStatus(status) {
    const text = normalizeText(status);
    if (!text) return 'unknown';
    if (/確定レート|confirmed|final/.test(text)) return 'confirmed';
    if (/不使用|未使用|使わない|not use|unused/.test(text)) return 'unused';
    if (/アップグレード|upgrade/.test(text)) return 'upgrade';
    return 'unknown';
  }

  function payoutMode(text) {
    const value = String(text || '');
    if (/player|プレイヤー|個人|1人分|heads?\s*up|hu\b/i.test(value)) return 'player';
    if (/team|チーム|3on3|2on2/i.test(value)) return 'team';
    return '';
  }

  function dayNumber(name) {
    const m = String(name || '').match(/\bday\s*(\d+)[a-z]?\b|day(\d+)[a-z]?/i);
    return m ? Number(m[1] || m[2]) : null;
  }

  function isDayOne(name) {
    return /\bday\s*1[a-z]?\b|day1[a-z]?/i.test(String(name || '')) || dayNumber(name) === 1;
  }

  function trailingRunNumber(name) {
    const stripped = stripVersionLabels(name);
    const match = stripped.match(/(.+?)(\d+)\s*$/);
    if (!match) return { baseName: stripped, runNumber: null };
    return { baseName: normalizeSpace(match[1]), runNumber: Number(match[2]) };
  }

  function romanRunNumber(name) {
    const stripped = stripVersionLabels(name);
    const match = stripped.match(/(.+?)\s*([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]|I{1,3}|IV|V|VI{0,3}|IX|X)\s*$/i);
    if (!match) return null;
    return { baseName: normalizeSpace(match[1]), runNumber: romanValue(match[2]) };
  }

  function teamFamilyKey(name) {
    return compactKey(String(name || '').replace(/1\s*人分|1人分|player|team/gi, ''));
  }

  function parsePrizeSheet(raw) {
    const rows = splitTsv(raw);
    let tournamentRowIndex = findRowIndex(rows, /^Tournament$/i);
    const totalRowIndex = findRowIndex(rows, /^Total$/i);
    let statusRowIndex = findRowIndex(rows, /^Status$/i);
    if (tournamentRowIndex < 0 && rows.length) tournamentRowIndex = 0;
    if (statusRowIndex < 0) statusRowIndex = findAnyRowIndex(rows, looksLikeStatusValue);
    const currencyRowIndex = statusRowIndex >= 0 ? findCurrencyRowIndex(rows, statusRowIndex) : -1;
    const rankRows = currencyRowIndex >= 0 ? findRankRows(rows, currencyRowIndex) : [];
    const errors = [];

    if (tournamentRowIndex < 0) errors.push('Tournament行、または1行目の大会名が見つかりません。');
    if (totalRowIndex < 0) errors.push('Total行が見つかりません。');
    if (statusRowIndex < 0) errors.push('Status行、または確定/不使用/アップグレード行が見つかりません。');
    if (currencyRowIndex < 0) errors.push('PW COIN行が見つかりません。');
    if (!rankRows.length) errors.push('Prize順位行が見つかりません。');
    if (errors.length) return { ok: false, errors, variants: [], groups: [] };

    const tournamentRow = rows[tournamentRowIndex];
    const totalRow = rows[totalRowIndex];
    const statusRow = rows[statusRowIndex];
    const currencyRow = rows[currencyRowIndex];
    const blocks = buildTournamentBlocks(tournamentRow, currencyRow);
    const variants = [];

    for (const block of blocks) {
      const title = block.title;
      for (let col = block.startCol; col < block.endCol; col++) {
        const currencyLabel = normalizeSpace(cell(currencyRow, col));
        if (!isPwCoinLabel(currencyLabel)) continue;
        const statusRaw = blockStatusCell(statusRow, col, block);
        const total = normalizeMoney(cell(totalRow, col));
        const prizes = [];
        const seenRanks = new Set();
        for (const item of rankRows) {
          const amount = normalizeMoney(cell(item.row, col));
          if (amount == null || amount === 0) continue;
          if (seenRanks.has(item.rank)) continue;
          seenRanks.add(item.rank);
          prizes.push({ rank: item.rank, amount });
        }
        if (total == null && !prizes.length) continue;
        const mode = payoutMode(currencyLabel) || payoutMode(title);
        variants.push({
          id: `v${variants.length}`,
          inputName: title,
          sourceTitle: `${title}${mode ? ` / ${mode}` : ''}`,
          baseName: stripVersionLabels(title),
          key: compactKey(title),
          version: detectVersion(title),
          statusRaw,
          status: detectStatus(statusRaw),
          total: total || prizes.reduce((sum, prize) => sum + prize.amount, 0),
          prizes: prizes.sort((a, b) => a.rank - b.rank),
          payoutMode: mode,
          currencyLabel,
          column: col
        });
      }
    }
    if (!variants.length) {
      return {
        ok: false,
        errors: ['Prize列が見つかりません。大会名行、Status行、PW COIN行、順位行を含めて貼り付けてください。'],
        variants: [],
        groups: []
      };
    }

    const grouped = new Map();
    for (const variant of variants) {
      const key = compactKey(normalizeRunSuffix(variant.baseName));
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(variant);
    }
    const groups = [...grouped.entries()].map(([key, groupVariants], index) => ({
      id: `g${index}`,
      key,
      inputName: groupVariants[0]?.baseName || groupVariants[0]?.inputName || key,
      variants: dedupeVariants(groupVariants)
    }));
    return { ok: true, errors: [], variants, groups };
  }

  function dedupeVariants(variants) {
    const seen = new Set();
    const result = [];
    for (const variant of variants) {
      const prizeSig = (variant.prizes || []).map(p => `${p.rank}:${p.amount}`).join(',');
      const sig = [variant.sourceTitle, variant.payoutMode, variant.total, prizeSig].join('|');
      if (seen.has(sig)) continue;
      seen.add(sig);
      result.push(variant);
    }
    return result;
  }

  function parsePortal(raw) {
    if (!normalizeSpace(raw)) return { ok: true, errors: [], entries: [] };
    const rows = splitTsv(raw);
    const headerIndex = rows.findIndex(row =>
      row.some(c => normalizeSpace(c) === '#') &&
      row.some(c => /^Name$/i.test(normalizeSpace(c)))
    );
    if (headerIndex < 0) return { ok: false, errors: ['# / Name のヘッダーが見つかりません。'], entries: [] };
    const header = rows[headerIndex].map(normalizeSpace);
    const noCol = header.findIndex(c => c === '#');
    const nameCol = header.findIndex(c => /^Name$/i.test(c));
    const entries = [];
    for (let i = headerIndex + 1; i < rows.length; i++) {
      const noRaw = normalizeSpace(cell(rows[i], noCol));
      const name = normalizeSpace(cell(rows[i], nameCol));
      if (!noRaw || !name) continue;
      if (/^\(s\d+\)$/i.test(noRaw)) continue;
      const num = Number(String(noRaw).match(/\d+/)?.[0] || '');
      if (!Number.isInteger(num) || num <= 0) continue;
      entries.push({
        no: String(num),
        noDisplay: String(num).padStart(2, '0'),
        name,
        key: compactKey(name),
        day: dayNumber(name)
      });
    }
    return { ok: true, errors: [], entries };
  }

  function cleanOfficialTournamentName(raw) {
    const fullName = normalizeSpace(raw);
    const afterEventPrefix = fullName.replace(/^【[^】]+】\s*/, '');
    const noMatch = afterEventPrefix.match(/[#＃]\s*0*(\d+)\b/);
    const no = noMatch ? Number(noMatch[1]) : 0;
    const name = afterEventPrefix
      .replace(/^[#＃]\s*0*\d+\s*/, '')
      .trim();
    return {
      fullName,
      no: no ? String(no) : '',
      noDisplay: no ? String(no).padStart(2, '0') : '',
      name,
      key: compactKey(name),
      day: dayNumber(name)
    };
  }

  function extractPainelUrlFromRow(row) {
    const link = row.querySelector('a[href*="/cb/torneio/painel/"]');
    if (link?.href) return link.href;
    const html = row.innerHTML || '';
    const match = html.match(/\/cb\/torneio\/painel\/(\d+)/);
    return match ? painelUrlFromId(match[1]) : '';
  }

  function cleanTournamentNameFromRowText(rowText) {
    let s = normalizeSpace(rowText);
    const bracketed = s.match(/(【[^】]+】\s*(?:[#＃]\s*\d+[A-Za-z]?|\(s\d+\)|s\d+)\s+.+?)(?:\s+\d{1,2}\/\d{1,2}\/\d{4}|\s+Aberto|\s+Fechado|\s+オープン|\s+クローズ|$)/i);
    if (bracketed) return normalizeSpace(bracketed[1]);
    const withNo = s.match(/((?:[#＃]\s*\d+[A-Za-z]?|\(s\d+\)|s\d+)\s+.+?)(?:\s+\d{1,2}\/\d{1,2}\/\d{4}|\s+Aberto|\s+Fechado|\s+オープン|\s+クローズ|$)/i);
    if (withNo) return normalizeSpace(withNo[1]);
    s = s
      .replace(/^アクション\s+/i, '')
      .replace(/^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s+/, '')
      .replace(/\s+\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}$/, '')
      .replace(/\s+Aberto$/i, '')
      .replace(/\s+Fechado$/i, '')
      .replace(/\s+オープン$/i, '')
      .replace(/\s+クローズ$/i, '')
      .trim();
    return normalizeSpace(s);
  }

  function getPrimaryDataTable() {
    try {
      if (!window.jQuery || !window.jQuery.fn || !window.jQuery.fn.dataTable) return null;
      const tables = window.jQuery.fn.dataTable.tables();
      for (const table of Array.from(tables || [])) {
        if (!window.jQuery.fn.DataTable.isDataTable(table)) continue;
        const dt = window.jQuery(table).DataTable();
        if (dt) return dt;
      }
    } catch (_) {}
    return null;
  }

  function getDataTableRows(dt, searchApplied) {
    const rows = [];
    try {
      const selector = searchApplied ? { search: 'applied' } : {};
      dt.rows(selector).nodes().each(tr => {
        if (tr && String(tr.innerHTML || '').includes('/cb/torneio/painel/')) rows.push(tr);
      });
    } catch (_) {}
    return rows;
  }

  function waitDataTableDraw(dt, timeout = 8000) {
    return new Promise(resolve => {
      const node = dt?.table?.().node?.();
      if (!node || !window.jQuery) {
        resolve(false);
        return;
      }
      let done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        try { window.jQuery(node).off('draw.dt', onDraw); } catch (_) {}
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), timeout);
      function onDraw() {
        clearTimeout(timer);
        finish(true);
      }
      try { window.jQuery(node).one('draw.dt', onDraw); } catch (_) { finish(false); }
    });
  }

  async function setDataTableSearchAndLength(dt, prefix) {
    if (!dt) return;
    const draw = waitDataTableDraw(dt);
    try {
      dt.search(prefix || '');
      dt.page.len(100);
      dt.page(0);
      dt.draw();
      await draw;
      await sleep(120);
    } catch (_) {}
  }

  async function goDataTablePage(dt, pageIndex) {
    if (!dt) return;
    const draw = waitDataTableDraw(dt);
    try {
      dt.page(pageIndex).draw('page');
      await draw;
      await sleep(80);
    } catch (_) {}
  }

  function cacheTournamentEntry(entry, source) {
    if (!entry?.fullName || !entry?.tournamentId || !entry?.url) return false;
    const cache = readUrlCache();
    const key = `${entry.fullName}||${entry.tournamentId}`;
    cache[key] = {
      name: entry.fullName,
      tournamentId: entry.tournamentId,
      url: entry.url,
      painelUrl: entry.url,
      actualName: entry.fullName,
      matchedRow: entry.matchedRow || '',
      savedAt: nowText(),
      source: source || 'prize-check-url-manager-scan'
    };
    writeUrlCache(cache);
    return true;
  }

  function extractTournamentEntryFromRow(row, sourceLabel, pageNo) {
    const url = extractPainelUrlFromRow(row);
    const tournamentId = getTournamentIdFromUrl(url);
    if (!tournamentId) return null;
    const matchedRow = normalizeSpace(row.innerText || row.textContent || '');
    const fullName = cleanTournamentNameFromRowText(matchedRow);
    const parsed = cleanOfficialTournamentName(fullName);
    if (!parsed.no || !parsed.name) return null;
    return {
      ...parsed,
      url,
      tournamentId,
      matchedRow,
      source: sourceLabel || 'datatable',
      pageNo: pageNo || ''
    };
  }

  async function extractTournamentEntriesFromCurrentPage(prefix) {
    const dt = getPrimaryDataTable();
    const seen = new Set();
    const entries = [];

    if (dt) {
      await setDataTableSearchAndLength(dt, prefix);
      const info = dt.page?.info?.();
      const pages = info?.pages || 1;
      for (let page = 0; page < pages; page++) {
        await goDataTablePage(dt, page);
        for (const row of getDataTableRows(dt, true)) {
          const entry = extractTournamentEntryFromRow(row, 'datatable', page + 1);
          if (!entry) continue;
          const key = entry.url;
          if (seen.has(key)) continue;
          seen.add(key);
          cacheTournamentEntry(entry, `prize-check-datatable-p${page + 1}`);
          entries.push(entry);
        }
      }
    }

    if (!entries.length) {
      for (const row of document.querySelectorAll('tr')) {
        const entry = extractTournamentEntryFromRow(row, 'dom-fallback', '');
        if (!entry) continue;
        if (prefix && !entry.fullName.includes(prefix) && !compactKey(entry.fullName).includes(compactKey(prefix))) continue;
        const key = entry.url;
        if (seen.has(key)) continue;
        seen.add(key);
        cacheTournamentEntry(entry, 'prize-check-dom-fallback');
        entries.push(entry);
      }
    }

    return entries.sort((a, b) => {
      const byNo = Number(a.no) - Number(b.no);
      if (byNo) return byNo;
      return String(a.fullName || a.name).localeCompare(String(b.fullName || b.name), 'ja');
    });
  }

  function aliasTournamentName(name) {
    return normalizeSpace(name)
      .replace(/^【[^】]+】\s*/, '')
      .replace(/\bPPC\b/gi, 'Players Poker Championship')
      .replace(/^[#＃]?\s*\d{1,3}\s+/, '')
      .replace(/1\s*人分/g, '')
      .replace(/\bplayer\b/gi, '')
      .replace(/\bteam\b/gi, '');
  }

  function portalEntryKey(entry) {
    return [entry?.noDisplay || '', entry?.name || '', entry?.fullName || '', entry?.tournamentId || ''].join('|');
  }

  function leadingTournamentNo(name) {
    const text = normalizeSpace(name).replace(/^【[^】]+】\s*/, '');
    const match = text.match(/^\s*[#＃]?\s*0*(\d{1,3})\b/);
    return match ? String(Number(match[1])) : '';
  }

  function chooseVariant(group) {
    const usable = group.variants.filter(v => v.status !== 'unused');
    const player = usable.filter(v => v.payoutMode === 'player');
    const candidates = player.length ? player : usable.length ? usable : group.variants;
    const confirmed = candidates.filter(v => v.status === 'confirmed');
    const upgrade = candidates.filter(v => v.status === 'upgrade' || v.version === 'upgrade');
    if (candidates.length === 1) return { variant: candidates[0], needsConfirm: false, candidates };
    if (upgrade.length) return { variant: confirmed[0] || null, needsConfirm: true, candidates };
    if (confirmed.length === 1) return { variant: confirmed[0], needsConfirm: false, candidates };
    if (player.length && confirmed.length > 1) {
      const exact = confirmed.filter(v => v.version === 'base' || v.version === 'all');
      if (exact.length === 1) return { variant: exact[0], needsConfirm: false, candidates };
    }
    return { variant: null, needsConfirm: true, candidates };
  }

  function statusLabel(variant) {
    if (variant?.statusRaw) return variant.statusRaw;
    if (variant?.status === 'confirmed') return '確定レート';
    if (variant?.status === 'upgrade' || variant?.version === 'upgrade') return 'アップグレード';
    if (variant?.status === 'unused') return '不使用';
    return '状態不明';
  }

  function payoutLabel(variant) {
    if (variant?.payoutMode === 'player') return 'PW COIN/Player';
    if (variant?.payoutMode === 'team') return 'PW COIN/Team';
    return variant?.currencyLabel || 'PW COIN';
  }

  function formatVariantLabel(variant) {
    if (!variant) return '';
    const total = variant.total ? ` / ¥${variant.total.toLocaleString('ja-JP')}` : '';
    return `${statusLabel(variant)} / ${payoutLabel(variant)}${total} / ${variant.sourceTitle || variant.inputName || ''}`;
  }

  function matchPrizeToPortal(group, portalEntries) {
    const inputName = aliasTournamentName(group.inputName);
    const inputNo = leadingTournamentNo(group.inputName);
    const run = romanRunNumber(inputName) || trailingRunNumber(inputName);
    const gKey = compactKey(aliasTournamentName(run.runNumber ? run.baseName : inputName));
    let candidates = inputNo
      ? portalEntries.filter(entry => String(Number(entry.no || 0)) === inputNo && !isDayOne(entry.name))
      : [];

    if (!inputNo && !candidates.length) candidates = portalEntries.filter(entry => {
      if (isDayOne(entry.name)) return false;
      const eKey = compactKey(aliasTournamentName(entry.name || entry.fullName || ''));
      return eKey.includes(gKey) || gKey.includes(eKey);
    });
    candidates = candidates.sort((a, b) => Number(a.no) - Number(b.no));

    if (/main|millions/i.test(inputName)) {
      const maxDay = Math.max(0, ...candidates.map(entry => dayNumber(entry.name)).filter(day => day > 1));
      const day2Plus = candidates.filter(entry => dayNumber(entry.name) && dayNumber(entry.name) > 1);
      if (maxDay) candidates = candidates.filter(entry => dayNumber(entry.name) === maxDay);
      else if (day2Plus.length) candidates = day2Plus;
    }

    if (run.runNumber) {
      if (candidates.length >= run.runNumber) {
        return { entry: candidates[run.runNumber - 1], needsConfirm: false, candidates };
      }
      return { entry: null, needsConfirm: true, candidates };
    }

    if (candidates.length === 1) return { entry: candidates[0], needsConfirm: false, candidates };
    return { entry: null, needsConfirm: candidates.length !== 1, candidates };
  }

  function readUrlCache() {
    const parsed = safeJsonParse(localStorage.getItem(APP.urlCacheKey), {});
    return parsed && typeof parsed === 'object' ? parsed : {};
  }

  function writeUrlCache(cache) {
    localStorage.setItem(APP.urlCacheKey, JSON.stringify(cache));
  }

  function cacheKeys(seriesName, portalEntry) {
    const series = normalizeSpace(seriesName);
    const full = `${series} #${portalEntry.noDisplay} ${portalEntry.name}`;
    return [
      full,
      `${series} #${portalEntry.noDisplay}`,
      `${series} ${portalEntry.name}`,
      portalEntry.name
    ];
  }

  function getCachedUrl(seriesName, portalEntry) {
    const cache = readUrlCache();
    const wantDayEarly = dayNumber(portalEntry.name);
    if (wantDayEarly && wantDayEarly > 1) {
      const seriesKeyEarly = normalizeText(seriesName);
      const noPatternEarly = new RegExp(`#\\s*0*${portalEntry.no}\\b`);
      for (const [key, item] of Object.entries(cache)) {
        const url = typeof item === 'string' ? item : item?.url || item?.painelUrl;
        if (!url || !/\/cb\/torneio\/painel\/\d+/.test(url)) continue;
        const haystack = normalizeSpace(`${key} ${item?.name || ''} ${item?.actualName || ''}`);
        if (seriesKeyEarly && !normalizeText(haystack).includes(seriesKeyEarly)) continue;
        if (!noPatternEarly.test(haystack)) continue;
        if (isDayOne(haystack)) continue;
        const gotDay = dayNumber(haystack);
        if (gotDay && gotDay !== wantDayEarly) continue;
        return { url, source: 'URL庫', cacheKey: key, item };
      }
      return null;
    }
    for (const key of cacheKeys(seriesName, portalEntry)) {
      const item = cache[key];
      const url = typeof item === 'string' ? item : item?.url || item?.painelUrl;
      if (url && /\/cb\/torneio\/painel\/\d+/.test(url)) {
        return { url, source: 'URL庫', cacheKey: key, item };
      }
    }
    const seriesKey = normalizeText(seriesName);
    const noPattern = new RegExp(`#\\s*0*${portalEntry.no}\\b`);
    const matches = [];
    for (const [key, item] of Object.entries(cache)) {
      const url = typeof item === 'string' ? item : item?.url || item?.painelUrl;
      if (!url || !/\/cb\/torneio\/painel\/\d+/.test(url)) continue;
      const haystack = normalizeSpace(`${key} ${item?.name || ''} ${item?.actualName || ''}`);
      const normalized = normalizeText(haystack);
      if (seriesKey && !normalized.includes(seriesKey)) continue;
      if (!noPattern.test(haystack)) continue;
      matches.push({ url, source: 'URL庫', cacheKey: key, item });
    }
    if (matches.length) {
      if (matches.length > 1) debug('URL cache duplicate number matches', { portalEntry, count: matches.length });
      return matches[0];
    }
    return null;
  }

  function saveCachedUrl(seriesName, portalEntry, url) {
    const cache = readUrlCache();
    const key = cacheKeys(seriesName, portalEntry)[0];
    const id = getTournamentIdFromUrl(url);
    cache[key] = {
      tournamentName: key,
      tournamentId: id,
      url,
      painelUrl: url,
      actualName: '',
      savedAt: new Date().toISOString(),
      source: 'PRIZE_CHECK_MANUAL'
    };
    writeUrlCache(cache);
  }

  function getTournamentIdFromUrl(url = '') {
    const match = String(url).match(/\/cb\/torneio\/painel\/(\d+)/);
    return match ? match[1] : '';
  }

  function painelUrlFromId(id) {
    return `/cb/torneio/painel/${encodeURIComponent(id)}`;
  }

  function nowText() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function makeTask(group, seriesName, portalEntries) {
    const variantChoice = chooseVariant(group);
    const portalChoice = matchPrizeToPortal(group, portalEntries);
    const portal = portalChoice.entry;
    const direct = portal?.url ? { url: portal.url, source: '一覧', cacheKey: '', item: portal } : null;
    const cached = direct || (portal ? getCachedUrl(seriesName, portal) : null);
    const day2PlusPortals = /main/i.test(group.inputName)
      ? portalChoice.candidates.filter(entry => dayNumber(entry.name) && dayNumber(entry.name) > 1)
      : [];
    const cachedDayUrls = day2PlusPortals
      .map(entry => entry.url ? { url: entry.url, source: '一覧', cacheKey: '', item: entry } : getCachedUrl(seriesName, entry))
      .filter(item => item?.url);
    const urls = cachedDayUrls.length > 1 ? cachedDayUrls.map(item => item.url) : (cached?.url ? [cached.url] : []);
    return {
      id: group.id,
      inputName: group.inputName,
      variants: group.variants,
      selectedVariantId: variantChoice.needsConfirm ? '' : (variantChoice.variant?.id || ''),
      variantConfirmRequired: variantChoice.needsConfirm,
      variantCandidates: variantChoice.candidates.map(v => v.id),
      portalNo: portal?.noDisplay || '',
      portalName: portal?.name || '',
      portalFullName: portal?.fullName || '',
      portalCandidates: portalChoice.candidates,
      portalConfirmRequired: portalChoice.needsConfirm,
      url: cached?.url || '',
      urls,
      urlSource: cached?.source || '',
      urlCacheKey: cached?.cacheKey || '',
      urlActualName: cached?.item?.actualName || cached?.item?.fullName || cached?.item?.name || '',
      tournamentId: cached?.item?.tournamentId || getTournamentIdFromUrl(cached?.url || ''),
      manualUrlRequired: !cached,
      result: null
    };
  }

  function buildTasks(seriesName, prizeGroups, portalEntries) {
    const playerFamilies = new Set();
    for (const group of prizeGroups) {
      if ((group.variants || []).some(v => v.payoutMode === 'player') || /1\s*人分|1人分/.test(group.inputName)) {
        playerFamilies.add(teamFamilyKey(group.inputName));
      }
    }
    const effectiveGroups = prizeGroups.filter(group => {
      const family = teamFamilyKey(group.inputName);
      const hasTeam = (group.variants || []).some(v => v.payoutMode === 'team');
      const hasPlayer = (group.variants || []).some(v => v.payoutMode === 'player') || /1\s*人分|1人分/.test(group.inputName);
      return !(hasTeam && !hasPlayer && playerFamilies.has(family));
    });
    const tasks = effectiveGroups.map(group => makeTask(group, seriesName, portalEntries));
    for (const task of tasks) {
      const portalName = task.portalName || task.inputName;
      if (isDayOne(portalName)) {
        task.manualUrlRequired = false;
        task.result = {
          judgement: '対象外',
          pwName: '',
          reference: '',
          remark: 'Day 1のため対象外'
        };
      }
    }
    return tasks;
  }

  function getCurrentPwTournamentName() {
    const titleInput = document.querySelector('input[name="titulo_torneio"], input[name="nome"], input[name="name"]');
    if (titleInput?.value) return normalizeSpace(titleInput.value);
    for (const selector of ['h1', 'h2', '.page-title', '.box-title', '.panel-title', '.breadcrumb']) {
      const el = document.querySelector(selector);
      const text = normalizeSpace(el?.innerText || el?.textContent || '');
      if (text) return text;
    }
    return normalizeSpace(document.title);
  }

  function readVisiblePrizeTable() {
    for (const table of [...document.querySelectorAll('table')]) {
      const rows = [...table.querySelectorAll('tr')].map(tr => [...tr.children].map(td => normalizeSpace(td.innerText || td.textContent || '')));
      if (!rows.length) continue;
      const header = rows[0];
      const rankCol = header.findIndex(h => /位置|順位|pos/i.test(h));
      const amountCol = header.findIndex(h => /金額|amount|valor/i.test(h));
      if (rankCol < 0 || amountCol < 0) continue;
      const prizes = [];
      for (const row of rows.slice(1)) {
        const rank = parseRank(row[rankCol]);
        const amount = normalizeMoney(row[amountCol]);
        if (rank && amount != null && amount > 0) prizes.push({ rank, amount });
      }
      if (prizes.length) return prizes;
    }
    return [];
  }

  function readInputPrizeRows() {
    const posEls = [...document.querySelectorAll(`[name="${CSS.escape('posicao[]')}"]`)];
    const valueEls = [...document.querySelectorAll(`[name="${CSS.escape('prizes_valor[]')}"]`)];
    const len = Math.min(posEls.length, valueEls.length);
    const raw = [];
    for (let i = 0; i < len; i++) {
      const pos = parseRank(posEls[i]?.value || posEls[i]?.textContent || '');
      const amount = normalizeMoney(valueEls[i]?.value || valueEls[i]?.textContent || '');
      if (pos == null || amount == null || amount <= 0) continue;
      raw.push({ pos, amount });
    }
    const zeroBased = raw.some(row => row.pos === 0);
    return raw.map(row => ({ rank: zeroBased ? row.pos + 1 : row.pos, amount: row.amount }));
  }

  function readCurrentPrize() {
    const rows = readVisiblePrizeTable();
    const prizes = rows.length ? rows : readInputPrizeRows();
    return {
      name: getCurrentPwTournamentName(),
      total: prizes.reduce((sum, row) => sum + row.amount, 0),
      rows: prizes.sort((a, b) => a.rank - b.rank)
    };
  }

  function readPrizeFromDocument(doc, url) {
    const title =
      doc.querySelector('input[name="titulo_torneio"], input[name="nome"], input[name="name"]')?.value ||
      doc.querySelector('h1,h2,.page-title,.box-title,.panel-title,.breadcrumb')?.textContent ||
      doc.title || '';
    const visible = [];
    for (const table of [...doc.querySelectorAll('table')]) {
      const rows = [...table.querySelectorAll('tr')].map(tr => [...tr.children].map(td => normalizeSpace(td.textContent || '')));
      if (!rows.length) continue;
      const header = rows[0] || [];
      const rankCol = header.findIndex(h => /位置|順位|pos/i.test(h));
      const amountCol = header.findIndex(h => /金額|amount|valor/i.test(h));
      if (rankCol < 0 || amountCol < 0) continue;
      for (const row of rows.slice(1)) {
        const rank = parseRank(row[rankCol]);
        const amount = normalizeMoney(row[amountCol]);
        if (rank && amount != null && amount > 0) visible.push({ rank, amount });
      }
    }
    const posEls = [...doc.querySelectorAll(`[name="${CSS.escape('posicao[]')}"]`)];
    const valueEls = [...doc.querySelectorAll(`[name="${CSS.escape('prizes_valor[]')}"]`)];
    const input = [];
    for (let i = 0; i < Math.min(posEls.length, valueEls.length); i++) {
      const pos = parseRank(posEls[i]?.value || posEls[i]?.textContent || '');
      const amount = normalizeMoney(valueEls[i]?.value || valueEls[i]?.textContent || '');
      if (pos == null || amount == null || amount <= 0) continue;
      input.push({ pos, amount });
    }
    const zeroBased = input.some(row => row.pos === 0);
    const inputRows = input.map(row => ({ rank: zeroBased ? row.pos + 1 : row.pos, amount: row.amount }));
    const rows = (visible.length ? visible : inputRows).sort((a, b) => a.rank - b.rank);
    return {
      url,
      name: normalizeSpace(title).replace(/\s*-\s*PokerWeb\s*$/i, ''),
      source: visible.length ? 'visible table' : 'input fields',
      total: rows.reduce((sum, row) => sum + row.amount, 0),
      rows
    };
  }

  async function fetchPrizeSnapshot(url) {
    const absoluteUrl = url.startsWith('http') ? url : new URL(url, location.origin).href;
    const html = await fetch(absoluteUrl, { credentials: 'include' }).then(response => {
      if (!response.ok) throw new Error(`GET ${response.status}`);
      return response.text();
    });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return readPrizeFromDocument(doc, absoluteUrl);
  }

  async function fetchTaskActual(task) {
    const urls = (task.urls?.length ? task.urls : [task.url]).filter(Boolean);
    if (!urls.length) return { name: task.portalName || '', total: 0, rows: [], snapshots: [] };
    const snapshots = [];
    for (const url of urls) snapshots.push(await fetchPrizeSnapshot(url));
    const rows = snapshots.flatMap(snapshot => snapshot.rows || []).sort((a, b) => a.rank - b.rank);
    return {
      name: snapshots.map(snapshot => snapshot.name).filter(Boolean).join(' + ') || task.portalName || '',
      total: rows.reduce((sum, row) => sum + row.amount, 0),
      rows,
      snapshots
    };
  }

  function prizeMap(rows) {
    const map = new Map();
    for (const row of rows || []) map.set(Number(row.rank), Number(row.amount));
    return map;
  }

  function comparePrize(expected, actual) {
    const expectedMap = prizeMap(expected.prizes);
    const actualMap = prizeMap(actual.rows);
    const missing = [];
    const extra = [];
    const different = [];
    for (const [rank, amount] of expectedMap.entries()) {
      if (!actualMap.has(rank)) missing.push(rank);
      else if (actualMap.get(rank) !== amount) different.push(rank);
    }
    for (const rank of actualMap.keys()) {
      if (!expectedMap.has(rank)) extra.push(rank);
    }
    const totalOk = Number(actual.total || 0) === Number(expected.total || 0);
    const rowsOk = !missing.length && !extra.length && !different.length;
    return { ok: totalOk && rowsOk, totalOk, rowsOk, missing, extra, different };
  }

  function teamSizeForTask(task, variant) {
    const text = normalizeText(`${task.inputName || ''} ${task.portalName || ''} ${variant?.sourceTitle || ''}`);
    if (/3on3/.test(text)) return 3;
    if (/2on2|tag team|twins/.test(text)) return 2;
    return 1;
  }

  function expandedReference(task, variant) {
    const selected = variant || task.variants.find(v => v.id === task.selectedVariantId) || task.variants[0];
    if (!selected) return null;
    const size = selected.payoutMode === 'player' ? teamSizeForTask(task, selected) : 1;
    if (size <= 1) return { ...selected, comparePrizes: selected.prizes || [], compareTotal: selected.total || 0, expandSize: 1 };
    const expanded = [];
    let rank = 1;
    for (const prize of selected.prizes || []) {
      for (let i = 0; i < size; i++) expanded.push({ rank: rank++, amount: prize.amount });
    }
    return {
      ...selected,
      comparePrizes: expanded,
      compareTotal: expanded.reduce((sum, prize) => sum + prize.amount, 0),
      expandSize: size
    };
  }

  function remarkForReference(ref) {
    if (!ref) return '';
    if (ref.expandSize > 1) return `1人分×${ref.expandSize}展開一致`;
    if (ref.status === 'upgrade' || ref.version === 'upgrade') return 'アップグレード一致';
    if (ref.status === 'confirmed') return '確定レート一致';
    if (ref.version === 'coin') return 'コインのみ一致';
    if (ref.version === 'voucher') return 'voucherのみ一致';
    return '選択Prize一致';
  }

  function judgeTask(task, actual) {
    if (task.result?.judgement === '対象外') return task.result;
    if (!task.url && !(task.urls || []).length) return { judgement: '未検出', pwName: '', reference: '', remark: 'URL未登録' };
    const selected = task.variants.find(v => v.id === task.selectedVariantId) || task.variants[0];
    const ref = expandedReference(task, selected);
    const result = comparePrize({ total: ref.compareTotal, prizes: ref.comparePrizes }, actual);
    if (result.ok) {
      return {
        judgement: 'OK',
        pwName: actual.name || task.portalName,
        reference: selected.sourceTitle,
        referenceStatus: statusLabel(selected),
        remark: remarkForReference(ref),
        compare: result
      };
    }
    return {
      judgement: '不一致',
      pwName: actual.name || task.portalName,
      reference: selected.sourceTitle,
      referenceStatus: statusLabel(selected),
      remark: 'Prize不一致',
      compare: result
    };
  }

  function buildReport(tasks) {
    const lines = [['判定', '入力名', 'PW大会名', '参照Prize', '参照Status', '備考'].join('\t')];
    for (const task of tasks) {
      const result = task.result || {};
      const selected = task.variants.find(v => v.id === task.selectedVariantId) || task.variants[0] || {};
      lines.push([
        result.judgement || '未検出',
        task.inputName || '',
        result.pwName || task.portalName || '',
        result.reference || '',
        result.referenceStatus || statusLabel(selected),
        result.remark || ''
      ].map(v => String(v ?? '').replace(/\t/g, ' ')).join('\t'));
    }
    return lines.join('\n');
  }

  function summarizePrizes(rows, limit = 6) {
    const items = (rows || []).slice(0, limit).map(row => `${row.rank}:${row.amount}`);
    const suffix = (rows || []).length > limit ? ` ...(${rows.length} rows)` : ` (${(rows || []).length} rows)`;
    return items.join(' / ') + suffix;
  }

  function buildCleanPrizePlan(tasks) {
    const blocks = [];
    for (const task of tasks) {
      if (task.result?.judgement === '対象外') continue;
      const selected = task.variants.find(v => v.id === task.selectedVariantId) || task.variants[0];
      const ref = expandedReference(task, selected);
      if (!selected || !ref) continue;
      const title = task.portalFullName || (task.portalName
        ? `${task.portalNo ? `#${task.portalNo} ` : ''}${task.portalName}`
        : task.inputName);
      const tournamentId = task.tournamentId || getTournamentIdFromUrl(task.url || '') || '';
      const notes = [];
      if (ref.expandSize > 1) notes.push(`1人分×${ref.expandSize}展開`);
      if (/main|millions/i.test(task.inputName) && /day\s*\d+|day\d+/i.test(task.portalName || '')) notes.push('最終Dayに全額登録');
      if (task.variantConfirmRequired || task.portalConfirmRequired || task.manualUrlRequired) notes.push('要確認');
      const lines = [
        title,
        tournamentId,
        statusLabel(selected),
        `PRIZE, ${selected.sourceTitle || task.inputName} / ${payoutLabel(selected)}`,
        notes.length ? `NOTE, ${notes.join(' / ')}` : '',
        `TOTAL, ${ref.compareTotal || 0}`,
        ...(ref.comparePrizes || []).map(row => `${row.rank}, ${row.amount}`)
      ].filter(line => line !== '');
      blocks.push(lines.join('\n'));
    }
    return blocks.join('\n\n');
  }

  function buildDebugReport(tasks) {
    const headers = [
      '入力名',
      'Portal#',
      'Portal Name',
      'URL Source',
      'URL Cache Key',
      'URL Actual Name',
      'TournamentId',
      'URL',
      'PW大会名',
      '参照Prize',
      '参照Status',
      '参照Total',
      '参照Rows',
      'PW Total',
      'PW Rows',
      '判定',
      '備考',
      'Diff'
    ];
    const lines = [headers.join('\t')];
    for (const task of tasks) {
      const selected = task.variants.find(v => v.id === task.selectedVariantId) || task.variants[0] || {};
      const ref = expandedReference(task, selected) || {};
      const actual = task.actualSnapshot || {};
      const result = task.result || {};
      const compare = result.compare || {};
      const diff = [
        compare.totalOk === false ? 'total' : '',
        compare.missing?.length ? `missing=${compare.missing.join(',')}` : '',
        compare.extra?.length ? `extra=${compare.extra.join(',')}` : '',
        compare.different?.length ? `different=${compare.different.join(',')}` : ''
      ].filter(Boolean).join(' / ');
      lines.push([
        task.inputName || '',
        task.portalNo || '',
        task.portalName || '',
        task.urlSource || '',
        task.urlCacheKey || '',
        task.urlActualName || '',
        task.tournamentId || getTournamentIdFromUrl(task.url || ''),
        task.url || '',
        result.pwName || actual.name || '',
        selected.sourceTitle || '',
        statusLabel(selected),
        ref.compareTotal ?? selected.total ?? '',
        summarizePrizes(ref.comparePrizes || selected.prizes || []),
        actual.total ?? '',
        summarizePrizes(actual.rows || []),
        result.judgement || '',
        result.remark || '',
        diff
      ].map(v => String(v ?? '').replace(/\t/g, ' ')).join('\t'));
    }
    return lines.join('\n');
  }

  function showCopyDialog(title, text) {
    document.getElementById('pw-prize-copy-dialog')?.remove();
    const div = document.createElement('div');
    div.id = 'pw-prize-copy-dialog';
    div.style.cssText = 'position:fixed;inset:36px;z-index:1000002;background:#111827;color:#e5e7eb;border:1px solid #60a5fa;border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:10px;font-family:Arial,"Yu Gothic","Meiryo",sans-serif;';
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <strong>${escapeHtml(title)}</strong>
        <button id="pwPrizeCopyClose" style="background:#374151;color:white;border:0;border-radius:6px;padding:7px 10px;">閉じる</button>
      </div>
      <textarea id="pwPrizeCopyText" style="flex:1;min-height:280px;background:#020617;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:8px;font-family:Consolas,'Courier New',monospace;font-size:12px;white-space:pre;"></textarea>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="pwPrizeCopyButton" style="background:#2563eb;color:white;border:0;border-radius:6px;padding:8px 12px;font-weight:700;">コピー</button>
      </div>
    `;
    document.body.appendChild(div);
    const textEl = document.getElementById('pwPrizeCopyText');
    textEl.value = text;
    textEl.focus();
    textEl.select();
    document.getElementById('pwPrizeCopyClose').onclick = () => div.remove();
    document.getElementById('pwPrizeCopyButton').onclick = async () => {
      textEl.focus();
      textEl.select();
      try {
        await navigator.clipboard.writeText(text);
        alert('コピーしました。');
      } catch (_) {
        document.execCommand('copy');
      }
    };
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      showCopyDialog('REPORTをコピーしてください', text);
      return false;
    }
  }

  function renderSummary(tasks) {
    const el = document.getElementById('pwPrizeCheckSummary');
    if (!el) return;
    const auto = tasks.filter(t => !t.variantConfirmRequired && !t.portalConfirmRequired && !t.manualUrlRequired).length;
    const confirm = tasks.filter(t => t.variantConfirmRequired || t.portalConfirmRequired).length;
    const missing = tasks.filter(t => t.manualUrlRequired).length;
    el.textContent = `自動確認 ${auto} / 要確認 ${confirm} / URL未登録 ${missing}`;
  }

  function setProgress(message) {
    const el = document.getElementById('pwPrizeCheckProgress');
    if (el) el.textContent = message || '';
  }

  function setChecking(active) {
    const button = document.getElementById('pwPrizeCheckStart');
    if (!button) return;
    button.disabled = active;
    button.textContent = active ? 'CHECK中...' : 'CHECK開始';
    button.style.opacity = active ? '.65' : '1';
  }

  function renderConfirmArea(tasks) {
    const area = document.getElementById('pwPrizeCheckConfirmArea');
    const rows = tasks.filter(t => t.variantConfirmRequired || t.portalConfirmRequired || t.manualUrlRequired);
    if (!rows.length) {
      area.style.display = 'none';
      area.innerHTML = '';
      return;
    }
    area.style.display = 'block';
    area.innerHTML = rows.map(task => `
      <div class="pwpc-confirm-card" data-task-id="${escapeHtml(task.id)}">
        <div class="pwpc-confirm-title">${escapeHtml(task.inputName)}</div>
        ${task.variantConfirmRequired ? `
          <div class="pwpc-confirm-label">最終使用するPrize：</div>
          ${task.variantCandidates.map(id => {
            const variant = task.variants.find(v => v.id === id);
            const label = formatVariantLabel(variant) || id;
            return `<label class="pwpc-radio"><input type="radio" name="variant-${escapeHtml(task.id)}" value="${escapeHtml(id)}" ${task.selectedVariantId === id ? 'checked' : ''}><span>${escapeHtml(label)}</span></label>`;
          }).join('')}
        ` : ''}
        ${task.portalConfirmRequired ? `
          <div class="pwpc-confirm-label">ポータル大会：</div>
          ${task.portalCandidates.map(entry => `<label class="pwpc-radio"><input type="radio" name="portal-${escapeHtml(task.id)}" value="${escapeHtml(portalEntryKey(entry))}"><span>${escapeHtml(entry.fullName || `#${entry.noDisplay} ${entry.name}`)}</span></label>`).join('') || '<div style="color:#fca5a5;">候補なし</div>'}
        ` : ''}
        ${task.manualUrlRequired ? `
          <div class="pwpc-confirm-label">PokerWeb URL：</div>
          <button class="pwpc-url-button" data-task-id="${escapeHtml(task.id)}">URL入力</button>
          <span style="margin-left:8px;color:#fca5a5;">URL未登録</span>
        ` : ''}
      </div>
    `).join('');

    for (const input of area.querySelectorAll('input[type="radio"]')) {
      input.addEventListener('change', () => {
        const scan = loadScan();
        const task = scan?.tasks?.find(t => input.name.endsWith(t.id));
        if (!task) return;
        if (input.name.startsWith('variant-')) {
          task.selectedVariantId = input.value;
          task.variantConfirmRequired = false;
        }
        if (input.name.startsWith('portal-')) {
          const entry = task.portalCandidates.find(e => portalEntryKey(e) === input.value);
          if (entry) {
            task.portalNo = entry.noDisplay;
            task.portalName = entry.name;
            task.portalFullName = entry.fullName || '';
            task.portalConfirmRequired = false;
            const cached = entry.url ? { url: entry.url, source: '一覧', cacheKey: '', item: entry } : getCachedUrl(scan.seriesName, entry);
            if (cached) {
              task.url = cached.url;
              task.urls = [cached.url];
              task.urlSource = cached.source;
              task.urlCacheKey = cached.cacheKey || '';
              task.urlActualName = cached.item?.actualName || cached.item?.fullName || cached.item?.name || '';
              task.tournamentId = cached.item?.tournamentId || getTournamentIdFromUrl(cached.url || '');
              task.manualUrlRequired = false;
            }
          }
        }
        saveScan(scan);
        renderSummary(scan.tasks);
        renderConfirmArea(scan.tasks);
        updateCheckButton();
      });
    }

    for (const button of area.querySelectorAll('.pwpc-url-button')) {
      button.addEventListener('click', () => {
        const scan = loadScan();
        const task = scan?.tasks?.find(t => t.id === button.dataset.taskId);
        if (!task) return;
        const url = prompt(`${task.inputName}\nPokerWeb URLを入力してください:`, task.url || '');
        if (!url) return;
        task.url = url.trim();
        task.urls = [task.url];
        task.urlSource = '手入力';
        task.urlCacheKey = '';
        task.urlActualName = '';
        task.tournamentId = getTournamentIdFromUrl(task.url);
        task.manualUrlRequired = false;
        const entry = { noDisplay: task.portalNo || '', no: String(Number(task.portalNo || 0)), name: task.portalName || task.inputName };
        if (task.portalNo) saveCachedUrl(scan.seriesName, entry, task.url);
        saveScan(scan);
        renderSummary(scan.tasks);
        renderConfirmArea(scan.tasks);
        updateCheckButton();
      });
    }
  }

  function allReady(tasks) {
    return tasks.every(task =>
      task.result?.judgement === '対象外' ||
      (!task.variantConfirmRequired || task.selectedVariantId) &&
      (!task.portalConfirmRequired || task.portalName) &&
      (!task.manualUrlRequired || task.url)
    );
  }

  function updateCheckButton() {
    const scan = loadScan();
    const button = document.getElementById('pwPrizeCheckStart');
    if (!button) return;
    const ready = !!scan?.tasks?.length && allReady(scan.tasks);
    button.disabled = !ready;
    button.style.opacity = ready ? '1' : '.45';
  }

  async function handleScan() {
    clearState();
    const seriesName = normalizeSpace(document.getElementById('pwPrizeCheckSeriesName')?.value || '');
    const prizeRaw = document.getElementById('pwPrizeCheckPrizeRaw')?.value || '';
    const prize = parsePrizeSheet(prizeRaw);
    const errors = [...prize.errors];
    if (!seriesName) errors.push('大会名を入力してください。');
    if (errors.length) {
      alert(errors.join('\n'));
      return;
    }
    setProgress('URLスキャン中...');
    const pageEntries = await extractTournamentEntriesFromCurrentPage(seriesName);
    const tournamentEntries = pageEntries;
    setProgress(`URLスキャン完了: ${tournamentEntries.length}件`);
    if (!tournamentEntries.length) {
      alert('PokerWebのオーペントーナメント、またはクローズトーナメントで実行してください。Tournament行が見つかりません。');
      return;
    }
    const tasks = buildTasks(seriesName, prize.groups, tournamentEntries);
    const scan = { ok: true, seriesName, tasks, entrySource: 'current-list', scannedAt: new Date().toISOString() };
    saveScan(scan);
    renderSummary(tasks);
    renderConfirmArea(tasks);
    updateCheckButton();
    const detail = buildDebugReport(tasks);
    const plan = buildCleanPrizePlan(tasks);
    debugLines.length = 0;
    debugLines.push(detail);
    await copyText(plan);
    alert(`スキャン完了\n\n自動確認：${tasks.filter(t => !t.manualUrlRequired && !t.variantConfirmRequired && !t.portalConfirmRequired).length}件\n要確認：${tasks.filter(t => t.variantConfirmRequired || t.portalConfirmRequired).length}件\n未検出：${tasks.filter(t => t.manualUrlRequired).length}件\n\nPrize Planをクリップボードにコピーしました。`);
  }

  async function runBackgroundCheck(scan) {
    const tasks = scan.tasks || [];
    setChecking(true);
    setProgress(`CHECK準備中... 0 / ${tasks.length}`);
    for (const [index, task] of tasks.entries()) {
      const currentLabel = `${task.inputName || ''}${task.portalName ? ` → ${task.portalName}` : ''}`;
      setProgress(`CHECK中 ${index + 1} / ${tasks.length}：${currentLabel}`);
      if (task.result?.judgement === '対象外') continue;
      if (!task.url && !(task.urls || []).length) {
        task.result = { judgement: '未検出', pwName: '', reference: '', remark: 'URL未登録' };
        continue;
      }
      try {
        const actual = await fetchTaskActual(task);
        task.actualSnapshot = actual;
        task.result = judgeTask(task, actual);
        debug('checked', { inputName: task.inputName, judgement: task.result.judgement, rows: actual.rows.length });
      } catch (error) {
        task.result = {
          judgement: '未検出',
          pwName: task.portalName || '',
          reference: '',
          remark: `GET失敗: ${error?.message || error}`
        };
        debug('GET failed', { inputName: task.inputName, url: task.url, error: String(error?.message || error) });
      }
      renderSummary(tasks);
      await sleep(80);
    }
    const checkedScan = { ...scan, tasks, checkedAt: new Date().toISOString() };
    saveScan(checkedScan);
    debugLines.length = 0;
    debugLines.push(buildDebugReport(tasks));
    await copyText(buildReport(tasks));
    const ok = tasks.filter(t => t.result?.judgement === 'OK').length;
    const confirm = tasks.filter(t => t.result?.judgement === '要確認').length;
    const missing = tasks.filter(t => t.result?.judgement === '未検出').length;
    setChecking(false);
    setProgress(`CHECK完了 OK ${ok} / 要確認 ${confirm} / 未検出 ${missing}`);
    alert(`CHECK完了\n\nOK：${ok}件\n要確認：${confirm}件\n未検出：${missing}件\n\nREPORTをクリップボードにコピーしました。`);
  }

  async function handleStartCheck() {
    const scan = loadScan();
    if (!scan?.tasks?.length) {
      alert('先にスキャンしてください。');
      return;
    }
    if (!allReady(scan.tasks)) {
      alert('要確認項目を完了してください。');
      return;
    }
    try {
      await runBackgroundCheck(scan);
    } finally {
      setChecking(false);
    }
  }

  function createPanel() {
    if (document.getElementById(APP.panelId)) return;
    const panel = document.createElement('div');
    panel.id = APP.panelId;
    panel.innerHTML = `
      <style>
        #${APP.panelId}{position:fixed;right:16px;bottom:16px;z-index:999999;width:470px;max-height:88vh;overflow:auto;background:#111827;color:#e5e7eb;border:1px solid #475569;border-radius:8px;box-shadow:0 14px 34px rgba(0,0,0,.38);font-family:Arial,"Yu Gothic","Meiryo",sans-serif;font-size:13px}
        #${APP.panelId} .pwpc-head{display:flex;align-items:center;justify-content:space-between;padding:10px;border-bottom:1px solid #334155}
        #${APP.panelId} .pwpc-body{padding:10px}
        #${APP.panelId} button{border:0;border-radius:6px;padding:8px 10px;cursor:pointer;font-weight:700}
        #${APP.panelId} input,#${APP.panelId} textarea{width:100%;box-sizing:border-box;background:#020617;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:8px;font-size:12px}
        #${APP.panelId} textarea{resize:vertical;font-family:Consolas,"Courier New",monospace;white-space:pre}
        .pwpc-label{display:block;margin:8px 0 4px;color:#cbd5e1;font-weight:700}
        .pwpc-actions{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin-top:8px}
        .pwpc-confirm-card{border:1px solid #475569;border-radius:6px;padding:8px;margin-top:8px;background:#0f172a}
        .pwpc-confirm-title{font-weight:700;color:#fde68a;margin-bottom:6px}
        .pwpc-confirm-label{color:#cbd5e1;margin:8px 0 4px}
        .pwpc-radio{display:flex;gap:7px;align-items:flex-start;padding:4px 0;line-height:1.35}
        #pwPrizeCheckDetailLog{height:160px;margin-top:8px;font-size:11px;display:none}
      </style>
      <div class="pwpc-head">
        <strong>Prize Check</strong>
        <button id="pwPrizeCheckClose" style="background:#374151;color:#e5e7eb;">×</button>
      </div>
      <div class="pwpc-body">
        <div style="color:#93c5fd;font-size:12px;margin-bottom:6px;">オーペントーナメント / クローズトーナメント上で実行してください。</div>
        <label class="pwpc-label">大会名</label>
        <input id="pwPrizeCheckSeriesName" type="text" placeholder="例: SPADIE OSAKA 1st">
        <label class="pwpc-label">大会Prize Google Sheet全体を貼り付けてください</label>
        <textarea id="pwPrizeCheckPrizeRaw" style="height:170px" spellcheck="false"></textarea>
        <div class="pwpc-actions">
          <button id="pwPrizeCheckScan" style="background:#2563eb;color:white;">スキャン</button>
          <button id="pwPrizeCheckStart" disabled style="background:#16a34a;color:white;opacity:.45;">CHECK開始</button>
          <button id="pwPrizeCheckDetail" style="background:#334155;color:white;">詳細</button>
        </div>
        <div id="pwPrizeCheckSummary" style="margin-top:8px;color:#cbd5e1;"></div>
        <div id="pwPrizeCheckProgress" style="margin-top:6px;color:#93c5fd;font-weight:700;"></div>
        <div id="pwPrizeCheckConfirmArea" style="display:none;margin-top:8px;"></div>
        <textarea id="pwPrizeCheckDetailLog" readonly></textarea>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById('pwPrizeCheckClose').addEventListener('click', () => panel.remove());
    document.getElementById('pwPrizeCheckScan').addEventListener('click', handleScan);
    document.getElementById('pwPrizeCheckStart').addEventListener('click', handleStartCheck);
    document.getElementById('pwPrizeCheckDetail').addEventListener('click', async () => {
      const scan = loadScan();
      const detail = scan?.tasks?.length ? buildDebugReport(scan.tasks) : debugLines.join('\n');
      if (detail) showCopyDialog('詳細 / Debug Report', detail);
      if (detail) await copyText(detail);
      const logEl = document.getElementById('pwPrizeCheckDetailLog');
      logEl.style.display = logEl.style.display === 'none' ? 'block' : 'none';
      logEl.value = detail || '';
    });

    const scan = loadScan();
    if (scan?.tasks?.length) {
      document.getElementById('pwPrizeCheckSeriesName').value = scan.seriesName || '';
      renderSummary(scan.tasks);
      renderConfirmArea(scan.tasks);
      updateCheckButton();
    }
  }

  function bootResume() {
    clearState();
  }

  function boot() {
    clearLegacyState();
    createPanel();
    bootResume();
  }

  boot();
})();
