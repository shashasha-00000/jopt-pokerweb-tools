// ==UserScript==
// @name         PW Tournament CLOSE + AUDIT Background Batch
// @namespace    xhpc007-pw-close-audit-batch-private
// @version      1.0.1
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-tournament-close-audit-batch.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-tournament-close-audit-batch.user.js
// @description  PW比赛批量 CLOSE / 監査。读取TSV、用Shared Cache / URL pool补全URL、分开执行CLOSE与監査。
// @author       xhpc007 + ChatGPT
// @match        https://japanopt.pokerweb.com.br/cb/*
// @match        https://japanopt.pokerweb.com.br/*
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  /********************************************************************
   * PW Tournament CLOSE + AUDIT Background Batch V1.0
   *
   * 用法：
   *
   * 1. Input 贴 Name / TournamentId / URL TSV
   * 2. 本地读取TSV；缺URL时调用URL Manager补全并复用Shared Cache
   * 3. Run CLOSE与Run 監査是两个独立Job，只执行用户选择的接口
   *
   * CLOSE：GET校验目标 → CLOSE POST → 同TournamentId返回验证
   * 監査：GET校验参数 → 監査 POST → CLOSED列表跳转验证
   *
   ********************************************************************/

  const APP = {
    name: 'PW-CLOSE-AUDIT-BATCH',
    version: '1.0.1',

    // 沿用你之前 URL Manager 的共享 Cache Key
    sharedCacheKey: 'PW_SHARED_TOURNAMENT_URL_CACHE_V1',

    inputKey: 'PW_CLOSE_AUDIT_INPUT_V02',
    currentBatchKey: 'PW_CLOSE_AUDIT_CURRENT_BATCH_V03',
    prefixKey: 'PW_CLOSE_AUDIT_PREFIX_V02',
    reportKey: 'PW_CLOSE_AUDIT_REPORT_V02',
    jobKey: 'PW_CLOSE_AUDIT_JOB_V02',
    backgroundJobKey: 'PW_CLOSE_AUDIT_BACKGROUND_JOB_V04',

    panelId: 'pw-close-audit-batch-panel',
    bodyId: 'pw-close-audit-batch-body',

    searchTimeoutMs: 12000,
    searchPollMs: 350,
    betweenSearchMs: 350,

    afterPageLoadDelayMs: 1200,
    beforeSubmitDelayMs: 350,
    betweenTournamentDelayMs: 900,

    logPrefix: '[PW-CLOSE-AUDIT-BATCH]'
  };

  let runningSearch = false;
  let stopSearchRequested = false;
  let runningBackgroundTest = false;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  // ============================================================
  // Basic utils
  // ============================================================

  function norm(s) {
    return String(s || '')
      .replace(/\u3000/g, ' ')
      .replace(/\uFEFF/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function compact(s) {
    return norm(s).replace(/\s+/g, '');
  }

  function isVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  function nowText() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  }

  function escTsv(v) {
    return String(v ?? '')
      .replace(/\t/g, ' ')
      .replace(/\r?\n/g, ' ')
      .trim();
  }

  function log(...args) {
    console.log(APP.logPrefix, ...args);
    const box = document.querySelector('#pwca-status');
    if (box) box.textContent = args.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ');
  }

  function warn(...args) {
    console.warn(APP.logPrefix, ...args);
    const box = document.querySelector('#pwca-status');
    if (box) box.textContent = args.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ');
  }

  function err(...args) {
    console.error(APP.logPrefix, ...args);
    const box = document.querySelector('#pwca-status');
    if (box) box.textContent = args.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ');
  }

  function appendReport(type, msg) {
    const line = `[${nowText()}] ${type}  ${msg}`;
    console.log(APP.logPrefix, line);

    const box = document.querySelector('#pwca-report');
    if (box) {
      box.value += (box.value ? '\n' : '') + line;
      box.scrollTop = box.scrollHeight;
      localStorage.setItem(APP.reportKey, box.value);
    }
  }

  function clearReport() {
    const box = document.querySelector('#pwca-report');
    if (box) box.value = '';
    localStorage.removeItem(APP.reportKey);
    log('Report cleared');
  }

  function copyText(text) {
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text);
        return true;
      }
    } catch (_) {}

    try {
      navigator.clipboard.writeText(text);
      return true;
    } catch (_) {}

    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    return true;
  }

  function getAbsUrl(url) {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('/')) return location.origin + url;
    return location.origin + '/' + url.replace(/^\/+/, '');
  }

  function getRelativePanelUrl(id) {
    return `/cb/torneio/painel/${id}`;
  }

  function extractIdFromUrlLike(s) {
    const m = String(s || '').match(/\/cb\/torneio\/painel\/(\d+)/);
    return m ? m[1] : '';
  }

  function getTournamentIdFromUrl() {
    return extractIdFromUrlLike(location.href);
  }

  function getEventPrefixFromTournamentName(name) {
    const m = norm(name).match(/【[^】]+】/);
    return m ? m[0] : '';
  }

  function getTournamentNoKeyFromName(name) {
    const s = norm(name);

    const sat = s.match(/\(?\s*s\s*0*(\d{1,3})\s*\)?/i);
    if (sat) return `s${String(Number(sat[1])).padStart(2, '0')}`;

    const m = s.match(/#\s*0*(\d{1,3})([A-Za-z])?/);
    if (m) {
      const num = String(Number(m[1])).padStart(2, '0');
      const suffix = m[2] ? m[2].toUpperCase() : '';
      return `#${num}${suffix}`;
    }

    return '';
  }

  function tournamentSortKey(name) {
    const s = norm(name);
    const no = getTournamentNoKeyFromName(s);

    if (no.startsWith('#')) {
      const m = no.match(/^#(\d+)([A-Z]?)$/);
      if (m) return `1_${m[1]}_${m[2] || ''}_${s}`;
    }

    if (no.startsWith('s')) {
      const m = no.match(/^s(\d+)$/);
      if (m) return `2_${m[1]}_${s}`;
    }

    const drink = /drink|ドリンク/i.test(s);
    const goods = /物販|goods|merch/i.test(s);

    if (drink) return `8_${s}`;
    if (goods) return `9_${s}`;

    return `5_${s}`;
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

  // ============================================================
  // Shared URL Cache
  // ============================================================

  function loadCache() {
    try {
      const raw = localStorage.getItem(APP.sharedCacheKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveCache(cache) {
    localStorage.setItem(APP.sharedCacheKey, JSON.stringify(cache));
  }

  function setCacheItem(name, data) {
    const cleanName = norm(name).replace(/\s*監査(?:済み|待ち)\s*$/g, '');
    if (!cleanName) return;

    const id = String(data.tournamentId || extractIdFromUrlLike(data.url) || '');
    const url = data.url ? String(data.url) : (id ? getRelativePanelUrl(id) : '');

    if (!id || !url) return;

    const cache = loadCache();
    const key = `${cleanName}||${id}`;

    cache[key] = {
      name: cleanName,
      tournamentId: id,
      url: url.startsWith('http') ? new URL(url).pathname : url,
      actualName: norm(data.actualName || data.name || cleanName).replace(/\s*監査(?:済み|待ち)\s*$/g, ''),
      matchedRow: String(data.matchedRow || ''),
      savedAt: nowText(),
      source: String(data.source || 'unknown')
    };

    saveCache(cache);
  }

  function getCacheCount() {
    return Object.keys(loadCache()).length;
  }

  function cacheToRows(prefixFilter = '') {
    const cache = loadCache();
    const prefix = norm(prefixFilter);

    return Object.values(cache)
      .filter(x => {
        if (!prefix) return true;
        return norm(x.name).includes(prefix) || norm(x.actualName).includes(prefix);
      })
      .sort((a, b) => tournamentSortKey(a.name || a.actualName).localeCompare(tournamentSortKey(b.name || b.actualName), 'ja'))
      .map(x => ({
        Name: x.name || '',
        TournamentId: x.tournamentId || '',
        URL: x.url || '',
        Actual_Name: x.actualName || '',
        Source: x.source || '',
        SavedAt: x.savedAt || '',
        Matched_Row: x.matchedRow || ''
      }));
  }

  function cacheToTsv(prefixFilter = '') {
    const headers = ['Name', 'TournamentId', 'URL', 'Actual_Name', 'Source', 'SavedAt', 'Matched_Row'];
    const rows = cacheToRows(prefixFilter);

    return rowsToTsv(rows, headers);
  }

  function rowsToTsv(rows, headers = ['Name', 'TournamentId', 'URL', 'Actual_Name', 'Source', 'SavedAt', 'Matched_Row']) {
    const safeRows = Array.isArray(rows) ? rows : [];

    return [
      headers.join('\t'),
      ...safeRows.map(r => headers.map(h => escTsv(r[h])).join('\t'))
    ].join('\n');
  }

  function saveCurrentBatch(rows) {
    localStorage.setItem(APP.currentBatchKey, JSON.stringify({
      rows: Array.isArray(rows) ? rows : [],
      savedAt: nowText()
    }));
  }

  function loadCurrentBatch() {
    try {
      const parsed = JSON.parse(localStorage.getItem(APP.currentBatchKey) || 'null');
      return parsed && Array.isArray(parsed.rows) ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function showRows(rows, sourceLabel) {
    const output = document.querySelector('#pwca-output');
    if (output) output.value = rowsToTsv(rows);
    log(`${sourceLabel}: ${rows.length} 件`);
    appendReport('VIEW_ROWS', `${sourceLabel} / ${rows.length} 件`);
  }

  function showCurrentBatch() {
    const batch = loadCurrentBatch();
    const rows = batch?.rows || [];
    showRows(rows, `Current batch (Prefix ignored${batch?.savedAt ? ` / ${batch.savedAt}` : ''})`);
  }

  function showCache() {
    const prefix = norm(document.querySelector('#pwca-prefix')?.value || '');
    const rows = cacheToRows(prefix);
    const output = document.querySelector('#pwca-output');
    if (output) output.value = rowsToTsv(rows);

    const count = rows.length;
    log(`Cache shown: ${count} 件 / prefix=${prefix || 'ALL'}`);
    appendReport('VIEW_CACHE', `${count} 件 / prefix=${prefix || 'ALL'} / shared cache only`);
  }

  function clearCurrentEventCache() {
    const prefix = norm(document.querySelector('#pwca-prefix')?.value || '');

    if (!prefix) {
      alert('Prefix が空です。例：【SPADIE season 41st】');
      return;
    }

    const cache = loadCache();
    const keys = Object.keys(cache);
    const targets = keys.filter(k => {
      const x = cache[k];
      return norm(k).includes(prefix) || norm(x.actualName).includes(prefix);
    });

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
    showCache();

    appendReport('CLEAR_EVENT', `${prefix} / ${targets.length} 件削除`);
    log(`Current Event Cache cleared: ${targets.length} 件`);
  }

  function clearAllCache() {
    const ok = confirm(
      '共有URL Cacheを全部削除します。\n\n' +
      `対象 localStorage key:\n${APP.sharedCacheKey}\n\n` +
      '本当に削除しますか？'
    );

    if (!ok) return;

    localStorage.removeItem(APP.sharedCacheKey);
    showCache();

    appendReport('CLEAR_ALL', '全URL Cacheを削除');
    log('All URL Cache cleared');
  }

  // ============================================================
  // Input parser / import
  // ============================================================

  function parseInput(raw) {
    const lines = String(raw || '')
      .split(/\r?\n/)
      .map(x => x.replace(/\uFEFF/g, ''))
      .filter(x => norm(x));

    if (!lines.length) return { mode: 'empty', rows: [] };

    const first = lines[0].split('\t').map(norm);
    const hasHeader =
      first.includes('Name') ||
      first.includes('大会名') ||
      first.includes('TournamentId') ||
      first.includes('URL');

    if (hasHeader) {
      const header = first;

      const idx = (...names) => {
        for (const name of names) {
          const i = header.findIndex(h => norm(h).toLowerCase() === norm(name).toLowerCase());
          if (i >= 0) return i;
        }
        return -1;
      };

      const iName = idx('Name', '大会名', 'Input_Name');
      const iId = idx('TournamentId', 'tournamentId', 'ID');
      const iUrl = idx('URL', 'Url');
      const iActual = idx('Actual_Name', 'ActualName', 'PW_Name');
      const iMatched = idx('Matched_Row', 'MatchedRow');

      const rows = lines.slice(1).map(line => {
        const cols = line.split('\t');

        return {
          name: iName >= 0 ? norm(cols[iName]) : '',
          tournamentId: iId >= 0 ? norm(cols[iId]) : '',
          url: iUrl >= 0 ? norm(cols[iUrl]) : '',
          actualName: iActual >= 0 ? norm(cols[iActual]) : '',
          matchedRow: iMatched >= 0 ? norm(cols[iMatched]) : '',
          rawLine: line
        };
      }).filter(r => r.name || r.url || r.tournamentId);

      const hasUrl = rows.some(r => r.url || r.tournamentId);

      return {
        mode: hasUrl ? 'import_tsv' : 'name_list',
        rows
      };
    }

    const rows = lines.map(line => ({
      name: norm(line),
      tournamentId: '',
      url: '',
      actualName: '',
      matchedRow: '',
      rawLine: line
    })).filter(r => r.name);

    return {
      mode: 'name_list',
      rows
    };
  }

  function normalizeUrlAndId(row) {
    let id = norm(row.tournamentId || '');
    let url = norm(row.url || '');

    const joined = `${url} ${id} ${row.rawLine || ''}`;
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
    const raw = document.querySelector('#pwca-input')?.value || '';
    const parsed = parseInput(raw);

    if (!parsed.rows.length) {
      alert('入力が空です');
      return;
    }

    let okCount = 0;
    let ngCount = 0;
    const importedRows = [];

    for (const r of parsed.rows) {
      const name = norm(r.name || r.actualName || '');
      const { id, url } = normalizeUrlAndId(r);

      if (!name || !url) {
        ngCount++;
        appendReport('IMPORT_NG', `name/url不足: ${r.rawLine || JSON.stringify(r)}`);
        continue;
      }

      setCacheItem(name, {
        tournamentId: id,
        url,
        actualName: r.actualName || name,
        matchedRow: r.matchedRow || '',
        source: 'import'
      });

      importedRows.push({
        Name: name,
        TournamentId: id,
        URL: url,
        Actual_Name: r.actualName || name,
        Source: 'import_current_batch',
        SavedAt: nowText(),
        Matched_Row: r.matchedRow || ''
      });

      okCount++;
      appendReport('IMPORT_OK', `${name} → ${url}`);
    }

    localStorage.setItem(APP.inputKey, raw);
    saveCurrentBatch(importedRows);
    showRows(importedRows, 'Current imported batch (Prefix ignored)');

    alert(`Import 完了\nOK: ${okCount}\nNG: ${ngCount}`);
    log(`Import done: OK ${okCount} / NG ${ngCount} / current batch saved / Prefix ignored`);
  }

  // ============================================================
  // PW list search / URL capture
  // ============================================================

  function findDataTablesSearchInput() {
    const candidates = [
      ...document.querySelectorAll('.dataTables_filter input[type="search"]'),
      ...document.querySelectorAll('input[type="search"]')
    ];

    return candidates.find(isVisible) || candidates[0] || null;
  }

  function setNativeInputValue(input, value) {
    const proto = Object.getPrototypeOf(input);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');

    if (desc && desc.set) desc.set.call(input, value);
    else input.value = value;
  }

  function dispatchSearchInput(input, value) {
    input.focus();
    setNativeInputValue(input, value);

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    input.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13
    }));

    input.dispatchEvent(new KeyboardEvent('keyup', {
      bubbles: true,
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13
    }));

    try {
      if (window.jQuery) {
        window.jQuery(input)
          .val(value)
          .trigger('input')
          .trigger('keyup')
          .trigger('change');
      }
    } catch (_) {}
  }

  function clearSearchInput() {
    const input = findDataTablesSearchInput();
    if (input) dispatchSearchInput(input, '');
  }

  function rowHasPanelLink(row) {
    return String(row.innerHTML || '').includes('/cb/torneio/painel/');
  }

  function extractTournamentTitleFromRow(rowText) {
    const s = norm(rowText);

    const m = s.match(/(【[^】]+】\s*(?:#\d+[A-Za-z]?|\(s\d+\)|s\d+)\s+.+?)(?:\s+\d{1,2}\/\d{1,2}\/\d{4}|\s+Aberto|\s+Fechado|\s+オープン|\s+クローズ|$)/i);
    if (m) return norm(m[1]);

    const m2 = s.match(/(【[^】]+】.+)/);
    if (m2) return norm(m2[1]);

    return s;
  }

  function extractTournamentFromRow(row, inputName = '') {
    const rowText = norm(row.innerText || '');
    const rowHtml = row.innerHTML || '';

    const actualName = extractTournamentTitleFromRow(rowText);

    if (inputName) {
      if (!isSameTournamentLooseSafe(inputName, actualName)) return null;
    }

    const links = [...row.querySelectorAll('a[href]')];

    const painelLink =
      links.find(a => String(a.getAttribute('href') || '').includes('/cb/torneio/painel/')) ||
      links.find(a => String(a.href || '').includes('/cb/torneio/painel/'));

    const href = painelLink ? (painelLink.getAttribute('href') || painelLink.href) : rowHtml;
    const id = extractIdFromUrlLike(href);

    if (!id) return null;

    return {
      tournamentId: id,
      url: getRelativePanelUrl(id),
      actualName,
      matchedRow: rowText
    };
  }

  function findTournamentFromVisibleRows(inputName) {
    const rows = [...document.querySelectorAll('tr')]
      .filter(isVisible)
      .filter(rowHasPanelLink);

    const matches = [];

    for (const row of rows) {
      const found = extractTournamentFromRow(row, inputName);
      if (found) matches.push(found);
    }

    const seen = new Set();
    const unique = matches.filter(x => {
      if (seen.has(x.url)) return false;
      seen.add(x.url);
      return true;
    });

    if (unique.length === 1) return unique[0];

    if (unique.length > 1) {
      return {
        error: 'AMBIGUOUS',
        candidates: unique
      };
    }

    return null;
  }

  function uniqueArray(values) {
    return [...new Set((values || []).filter(Boolean))];
  }

  function getPrefixesForUrlPool(rows) {
    return uniqueArray((rows || [])
      .map(row => getEventPrefixFromTournamentName(row.name || row.actualName || ''))
      .filter(Boolean));
  }

  function findDataTablesSearchInputInWindow(win) {
    const doc = win.document;
    const candidates = [
      ...doc.querySelectorAll('.dataTables_filter input[type="search"]'),
      ...doc.querySelectorAll('input[type="search"]')
    ];

    return candidates.find(el => isVisible(el)) || candidates[0] || null;
  }

  function getDataTableInWindow(win) {
    try {
      const jq = win.jQuery;
      if (!jq?.fn?.dataTable) return null;

      const tables = [...win.document.querySelectorAll('table')]
        .filter(table => jq.fn.dataTable.isDataTable(table));

      if (!tables.length) return null;

      return jq(tables[0]).DataTable();
    } catch (_) {
      return null;
    }
  }

  async function waitForWindowLoad(win, timeoutMs = 25000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      if (win.closed) throw new Error('WINDOW_CLOSED');
      try {
        if (win.document && win.document.readyState === 'complete') return;
      } catch (_) {}
      await sleep(250);
    }

    throw new Error('WINDOW_LOAD_TIMEOUT');
  }

  async function waitForDataTableReadyInWindow(win, timeoutMs = 20000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      if (win.closed) throw new Error('WINDOW_CLOSED');
      const dt = getDataTableInWindow(win);
      if (dt || findDataTablesSearchInputInWindow(win)) return dt;
      await sleep(250);
    }

    return null;
  }

  async function openTournamentListWindow(path, label) {
    const win = window.open(path, `pwca_url_pool_${label}_${Date.now()}`, 'width=1280,height=900');
    if (!win) throw new Error(`${label}: popup blocked`);

    await waitForWindowLoad(win, 25000);
    await waitForDataTableReadyInWindow(win, 20000);
    await sleep(600);
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
        recordsDisplay: typeof info.recordsDisplay === 'number' ? info.recordsDisplay : null
      };
    } catch (_) {
      return { page: 0, pages: 1, length: 100, recordsDisplay: null };
    }
  }

  async function dataTableSearchAndWait(win, dt, value) {
    const input = findDataTablesSearchInputInWindow(win);

    if (dt) {
      try { dt.page.len(100); } catch (_) {}
      try { dt.search(value).draw(); } catch (_) {}
    }

    if (input) {
      input.focus();
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
    }

    await sleep(900);
  }

  async function goDataTablePageAndWait(win, dt, pageIndex) {
    if (!dt) return;

    try {
      dt.page(pageIndex).draw('page');
    } catch (_) {
      return;
    }

    const start = Date.now();
    while (Date.now() - start < 8000) {
      if (win.closed) throw new Error('WINDOW_CLOSED');
      const info = getDataTablePageInfo(dt);
      if (info.page === pageIndex) return;
      await sleep(200);
    }
  }

  function collectUrlPoolFromCurrentPage(win, prefix, source) {
    const rows = [...win.document.querySelectorAll('tr')]
      .filter(isVisible)
      .filter(rowHasPanelLink);
    const compactPrefix = compact(prefix);
    const out = [];

    for (const row of rows) {
      const item = extractTournamentFromRow(row, '');
      if (!item) continue;

      const hay = `${item.actualName || ''} ${item.matchedRow || ''}`;
      if (prefix && !norm(hay).includes(prefix) && !compact(hay).includes(compactPrefix)) continue;

      out.push({
        ...item,
        source
      });
    }

    return out;
  }

  async function collectUrlPoolInWindow(win, label, prefix) {
    const dt = await waitForDataTableReadyInWindow(win, 20000);
    await dataTableSearchAndWait(win, dt, prefix);

    const info = getDataTablePageInfo(dt);
    const pages = info.pages || 1;
    const found = [];
    const seen = new Set();

    appendReport('URL_POOL_PAGE_INFO', `${label}: ${prefix} / pages=${pages} / records=${info.recordsDisplay ?? '?'}`);

    for (let page = 0; page < pages; page++) {
      if (stopSearchRequested) break;
      if (page > 0) await goDataTablePageAndWait(win, dt, page);

      const rows = collectUrlPoolFromCurrentPage(win, prefix, label);
      appendReport('URL_POOL_PAGE', `${label}: ${prefix} ${page + 1}/${pages} / ${rows.length} 件`);

      for (const row of rows) {
        const key = row.tournamentId || row.url;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        found.push(row);
      }
    }

    return found;
  }

  function findCacheMatchByName(name) {
    const target = compact(name);
    const matches = Object.values(loadCache()).filter(item => {
      const itemName = item.name || '';
      const actualName = item.actualName || '';
      return compact(itemName) === target || compact(actualName) === target;
    });

    const seen = new Map();
    for (const item of matches) {
      const id = String(item.tournamentId || extractIdFromUrlLike(item.url) || '');
      if (!id) continue;
      if (!seen.has(id)) seen.set(id, item);
    }

    const unique = [...seen.values()];
    if (unique.length === 1) {
      const item = unique[0];
      const id = String(item.tournamentId || extractIdFromUrlLike(item.url) || '');
      return {
        status: 'OK',
        tournamentId: id,
        url: item.url || getRelativePanelUrl(id),
        actualName: item.actualName || item.name || name,
        matchedRow: item.matchedRow || '',
        source: 'shared-cache'
      };
    }

    if (unique.length > 1) return { status: 'AMBIGUOUS', candidates: unique };
    return { status: 'NOT_FOUND' };
  }

  function matchUrlPoolByName(pool, name) {
    const target = compact(name);
    const matches = (pool || []).filter(item =>
      compact(item.actualName || '') === target ||
      compact(item.name || '') === target
    );

    const seen = new Map();
    for (const item of matches) {
      const id = String(item.tournamentId || extractIdFromUrlLike(item.url) || '');
      if (!id) continue;
      if (!seen.has(id)) seen.set(id, item);
    }

    const unique = [...seen.values()];
    if (unique.length === 1) {
      const item = unique[0];
      const id = String(item.tournamentId || extractIdFromUrlLike(item.url) || '');
      return {
        status: 'OK',
        tournamentId: id,
        url: item.url || getRelativePanelUrl(id),
        actualName: item.actualName || name,
        matchedRow: item.matchedRow || '',
        source: `url-pool-${item.source || 'unknown'}`
      };
    }

    if (unique.length > 1) return { status: 'AMBIGUOUS', candidates: unique };
    return { status: 'NOT_FOUND' };
  }

  async function waitForSearchResult(inputName, timeoutMs) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const found = findTournamentFromVisibleRows(inputName);
      if (found) return found;

      await sleep(APP.searchPollMs);
    }

    return null;
  }

  async function buildCacheBySearch() {
    if (runningSearch) {
      alert('検索処理中です');
      return;
    }

    const input = findDataTablesSearchInput();

    if (!input) {
      alert('現在ページに大会一覧検索欄がありません。\nOPEN / CLOSED など大会一覧ページで実行してください。');
      return;
    }

    const raw = document.querySelector('#pwca-input')?.value || '';
    const parsed = parseInput(raw);

    if (!parsed.rows.length) {
      alert('Name リストを貼ってください');
      return;
    }

    const names = parsed.rows
      .map(r => norm(r.name || ''))
      .filter(Boolean);

    if (!names.length) {
      alert('Name がありません。Name列または一行一大会名で貼ってください。');
      return;
    }

    const ok = confirm(
      `Name から URL Cache を作成します。\n\n` +
      `対象: ${names.length} 件\n\n` +
      `現在の大会一覧ページで検索します。`
    );

    if (!ok) return;

    runningSearch = true;
    stopSearchRequested = false;
    localStorage.setItem(APP.inputKey, raw);

    let okCount = 0;
    let ngCount = 0;
    let ambiguousCount = 0;

    try {
      for (let i = 0; i < names.length; i++) {
        if (stopSearchRequested) {
          appendReport('STOP', '検索停止要求により中断');
          break;
        }

        const name = names[i];

        log(`検索中 ${i + 1}/${names.length}: ${name}`);
        appendReport('SEARCH', `${i + 1}/${names.length} ${name}`);

        dispatchSearchInput(input, name);

        const found = await waitForSearchResult(name, APP.searchTimeoutMs);

        clearSearchInput();
        await sleep(APP.betweenSearchMs);

        if (!found) {
          ngCount++;
          appendReport('NOT_FOUND', name);
          continue;
        }

        if (found.error === 'AMBIGUOUS') {
          ambiguousCount++;
          appendReport('AMBIGUOUS', `${name} / ${found.candidates.length} candidates`);
          console.table(found.candidates);
          continue;
        }

        setCacheItem(name, {
          tournamentId: found.tournamentId,
          url: found.url,
          actualName: found.actualName || name,
          matchedRow: found.matchedRow || '',
          source: 'search'
        });

        okCount++;
        appendReport('SEARCH_OK', `${name} → ${found.url}`);
      }

      showCache();

      alert(
        `URL Cache 作成完了\n\n` +
        `OK: ${okCount}\n` +
        `NOT_FOUND: ${ngCount}\n` +
        `AMBIGUOUS: ${ambiguousCount}`
      );

      log(`Build done: OK ${okCount} / NG ${ngCount} / AMBIGUOUS ${ambiguousCount}`);

    } finally {
      runningSearch = false;
    }
  }

  function collectVisibleUrlsToCache() {
    const prefix = norm(document.querySelector('#pwca-prefix')?.value || '');

    const rows = [...document.querySelectorAll('tr')]
      .filter(isVisible)
      .filter(rowHasPanelLink);

    const found = [];

    for (const row of rows) {
      const item = extractTournamentFromRow(row, '');
      if (!item) continue;

      if (prefix && !norm(item.actualName).includes(prefix) && !norm(item.matchedRow).includes(prefix)) {
        continue;
      }

      found.push(item);
    }

    const seen = new Set();
    const unique = found.filter(x => {
      if (seen.has(x.url)) return false;
      seen.add(x.url);
      return true;
    });

    if (!unique.length) {
      alert(
        '現在表示中の一覧からURLを取得できませんでした。\n\n' +
        '・大会一覧ページですか？\n' +
        '・検索結果が表示されていますか？\n' +
        '・Prefix が合っていますか？'
      );
      appendReport('COLLECT_NG', `visible rows 0 / prefix=${prefix || 'なし'}`);
      return;
    }

    for (const x of unique) {
      setCacheItem(x.actualName || x.url, {
        tournamentId: x.tournamentId,
        url: x.url,
        actualName: x.actualName || x.url,
        matchedRow: x.matchedRow || '',
        source: 'visible_collect'
      });
      appendReport('COLLECT_OK', `${x.actualName} → ${x.url}`);
    }

    showCache();
    alert(`現在表示中の一覧から ${unique.length} 件 URL をCacheしました。`);
  }

  // ============================================================
  // Job queue
  // ============================================================

  function loadJob() {
    try {
      const raw = localStorage.getItem(APP.jobKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function saveJob(job) {
    localStorage.setItem(APP.jobKey, JSON.stringify({
      ...job,
      updatedAt: Date.now()
    }));
  }

  function clearJob() {
    localStorage.removeItem(APP.jobKey);
    log('Job cleared');
  }

  function buildQueueFromInput(raw) {
    const parsed = parseInput(raw);
    const detected = parsed.rows.some(r => norm(r.url) || norm(r.tournamentId));
    if (!detected) return { detected: false, queue: [], rows: [], warnings: [] };

    const errors = [];
    const warnings = [];
    const queue = [];
    const rows = [];
    const seenIds = new Map();

    parsed.rows.forEach((r, index) => {
      const rowNo = index + 2;
      const name = norm(r.name || r.actualName || '');
      const rawId = norm(r.tournamentId || '');
      const rawUrl = norm(r.url || '');
      const urlId = extractIdFromUrlLike(rawUrl);

      if (!name) {
        errors.push(`Row ${rowNo}: Name / 大会名 が空です`);
        return;
      }
      if (rawId && !/^\d+$/.test(rawId)) {
        errors.push(`Row ${rowNo}: TournamentId が数値ではありません: ${rawId}`);
        return;
      }
      if (rawUrl && !urlId) {
        errors.push(`Row ${rowNo}: URLからTournamentIdを読めません: ${rawUrl}`);
        return;
      }
      if (rawId && urlId && rawId !== urlId) {
        errors.push(`Row ${rowNo}: TournamentIdとURLのIDが一致しません: ${rawId} / ${urlId}`);
        return;
      }

      const id = rawId || urlId;
      if (!id) {
        errors.push(`Row ${rowNo}: URLまたはTournamentIdがありません: ${name}`);
        return;
      }

      const previous = seenIds.get(id);
      if (previous) {
        if (compact(previous.name) !== compact(name)) {
          errors.push(`Row ${rowNo}: TournamentId ${id} が別名で重複しています: ${previous.name} / ${name}`);
        } else {
          warnings.push(`Row ${rowNo}: 同一TournamentIdの重複をSKIP: ${id} ${name}`);
        }
        return;
      }

      const url = getRelativePanelUrl(id);
      const item = {
        name,
        actualName: norm(r.actualName || name),
        tournamentId: id,
        url,
        source: 'current_input_url'
      };
      seenIds.set(id, item);
      queue.push(item);
      rows.push({
        Name: name,
        TournamentId: id,
        URL: url,
        Actual_Name: item.actualName,
        Source: item.source,
        SavedAt: nowText(),
        Matched_Row: ''
      });
    });

    if (errors.length) {
      throw new Error(`URL TSV 検証NG: ${errors.length}件\n` + errors.slice(0, 20).join('\n'));
    }
    if (!queue.length) throw new Error('URL TSV に実行対象がありません');

    return { detected: true, queue, rows, warnings };
  }

  function getQueueFromCurrentBatch() {
    const batch = loadCurrentBatch();
    if (!batch?.rows?.length) return [];

    const seen = new Set();
    return batch.rows.map(r => ({
      name: r.Name || r.Actual_Name || r.URL,
      actualName: r.Actual_Name || r.Name || r.URL,
      tournamentId: String(r.TournamentId || extractIdFromUrlLike(r.URL) || ''),
      url: r.URL || (r.TournamentId ? getRelativePanelUrl(r.TournamentId) : ''),
      source: 'current_import_batch'
    })).filter(x => {
      if (!x.tournamentId || !x.url || seen.has(x.tournamentId)) return false;
      seen.add(x.tournamentId);
      return true;
    });
  }

  function getQueueFromCache(prefix) {
    const rows = cacheToRows(prefix);
    const nameToIds = new Map();

    for (const row of rows) {
      const name = norm(row.Name || row.Actual_Name || '');
      const id = String(row.TournamentId || extractIdFromUrlLike(row.URL) || '');
      if (!name || !id) continue;
      if (!nameToIds.has(name)) nameToIds.set(name, new Set());
      nameToIds.get(name).add(id);
    }

    const conflicts = Array.from(nameToIds.entries()).filter(([, ids]) => ids.size > 1);
    if (conflicts.length) {
      throw new Error(
        `发现同名比赛存在多个URL，需要先在URL Manager人工确认：${conflicts.length}件\n` +
        conflicts.slice(0, 10).map(([name, ids]) => `${name}: ${Array.from(ids).join(',')}`).join('\n')
      );
    }

    const queue = rows
      .map(r => ({
        name: r.Name || r.Actual_Name || r.URL,
        actualName: r.Actual_Name || r.Name || r.URL,
        tournamentId: String(r.TournamentId || extractIdFromUrlLike(r.URL) || ''),
        url: r.URL || (r.TournamentId ? getRelativePanelUrl(r.TournamentId) : ''),
        source: r.Source || ''
      }))
      .filter(x => x.tournamentId && x.url);

    const seen = new Set();
    return queue.filter(x => {
      const key = x.tournamentId;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => tournamentSortKey(a.name || a.actualName).localeCompare(tournamentSortKey(b.name || b.actualName), 'ja'));
  }

  function showJob() {
    const job = loadJob();
    const backgroundJob = loadBackgroundJob();
    const output = document.querySelector('#pwca-job-output');

    if (!output) return;

    if (backgroundJob) {
      output.value = JSON.stringify({
        type: 'BACKGROUND',
        operation: backgroundJob.operation || 'LEGACY_UNKNOWN',
        status: backgroundJob.status,
        progress: `${backgroundJob.index}/${backgroundJob.queue.length}`,
        next: backgroundJob.queue[backgroundJob.index]?.name || '',
        done: backgroundJob.done?.length || 0,
        skipped: backgroundJob.skipped?.length || 0,
        errors: backgroundJob.errors?.length || 0,
        stopRequested: !!backgroundJob.stopRequested,
        updatedAt: backgroundJob.updatedAt
      }, null, 2);
      return;
    }

    if (!job) {
      output.value = 'No active job';
      return;
    }

    output.value = JSON.stringify(job, null, 2);
  }

  function startJob(mode) {
    const prefix = norm(document.querySelector('#pwca-prefix')?.value || '');
    const raw = document.querySelector('#pwca-input')?.value || '';
    let queue = [];
    let queueSource = '';
    let prefixApplied = false;
    try {
      const direct = buildQueueFromInput(raw);
      if (direct.detected) {
        queue = direct.queue;
        queueSource = 'CURRENT INPUT URL TSV';
        saveCurrentBatch(direct.rows);
        showRows(direct.rows, 'Current Input URL TSV (Prefix ignored)');
        direct.warnings.forEach(w => appendReport('INPUT_WARN', w));
        localStorage.setItem(APP.inputKey, raw);
      } else {
        queue = getQueueFromCurrentBatch();
        if (queue.length) {
          queueSource = 'CURRENT IMPORTED BATCH';
        } else {
          queue = getQueueFromCache(prefix);
          queueSource = 'SHARED CACHE';
          prefixApplied = true;
        }
      }
    } catch (e) {
      alert(e.message || String(e));
      appendReport('JOB_BUILD_NG', e.message || String(e));
      return;
    }

    if (!queue.length) {
      alert(
        'Queue が空です。\n\n' +
        'Input に Name / TournamentId / URL TSV を貼ってください。\n' +
        'URL TSV は Import 不要で、そのまま Run できます。'
      );
      return;
    }

    const modeLabel = mode === 'open_close_audit'
      ? 'OPEN模式：CLOSE → 監査'
      : 'CLOSED模式：監査だけ';

    const preview = queue.slice(0, 12)
      .map((item, i) => `${i + 1}. ${item.name}\n   ${getAbsUrl(item.url)}`)
      .join('\n');
    const remaining = queue.length > 12 ? `\n...ほか ${queue.length - 12} 件` : '';

    const ok = confirm(
      `${modeLabel} を開始します。\n\n` +
      `Queue source: ${queueSource}\n` +
      `Prefix: ${prefixApplied ? (prefix || '(なし / ALL)') : '使用しません'}\n` +
      `対象: ${queue.length} 件\n\n` +
      `${preview}${remaining}\n\n` +
      `本当に実行しますか？`
    );

    if (!ok) return;

    const job = {
      active: true,
      mode,
      prefix,
      queueSource,
      queue,
      index: 0,
      step: 'go',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      done: [],
      errors: [],
      stopRequested: false
    };

    saveJob(job);
    appendReport('JOB_START', `${modeLabel} / ${queue.length} 件 / source=${queueSource} / prefix=${prefixApplied ? (prefix || 'ALL') : 'IGNORED'}`);
    showJob();

    goCurrentJobPage(job);
  }

  function requestStopJob() {
    const job = loadJob();
    if (!job) {
      alert('Active job はありません');
      return;
    }

    job.stopRequested = true;
    saveJob(job);

    appendReport('JOB_STOP_REQUEST', '現在のページ処理後に停止');
    alert('停止要求を入れました。現在のページ処理後に止まります。');
    showJob();
  }

  function hardClearJob() {
    const ok = confirm('現在の Batch Job 状態を完全に削除します。\n本当に削除しますか？');
    if (!ok) return;

    clearJob();
    showJob();
    appendReport('JOB_CLEAR', 'Job状態を削除');
  }

  function getCurrentJobItem(job) {
    if (!job || !Array.isArray(job.queue)) return null;
    return job.queue[job.index] || null;
  }

  function goCurrentJobPage(job) {
    const item = getCurrentJobItem(job);

    if (!item) {
      appendReport('JOB_DONE', `全件完了 / done=${job.done?.length || 0} / errors=${job.errors?.length || 0}`);
      alert(
        `Batch 完了\n\n` +
        `Done: ${job.done?.length || 0}\n` +
        `Errors: ${job.errors?.length || 0}`
      );
      clearJob();
      showJob();
      return;
    }

    const targetUrl = getAbsUrl(item.url);

    appendReport('GO', `${job.index + 1}/${job.queue.length} ${item.name} → ${targetUrl}`);
    log(`GO ${job.index + 1}/${job.queue.length}`, targetUrl);

    job.step = 'on_page';
    saveJob(job);

    if (location.href !== targetUrl) {
      location.href = targetUrl;
    } else {
      processJobOnTournamentPage().catch(e => {
        err('processJobOnTournamentPage failed', e);
      });
    }
  }

  function markCurrentDoneAndNext(job, note = '') {
    const item = getCurrentJobItem(job);

    if (item) {
      job.done = Array.isArray(job.done) ? job.done : [];
      job.done.push({
        ...item,
        finishedAt: nowText(),
        note
      });
    }

    job.index = Number(job.index || 0) + 1;
    job.step = 'go';

    saveJob(job);

    if (job.stopRequested) {
      appendReport('JOB_STOPPED', `停止しました index=${job.index}/${job.queue.length}`);
      alert(`停止しました。\n進捗: ${job.index}/${job.queue.length}`);
      showJob();
      return;
    }

    setTimeout(() => {
      const latest = loadJob();
      if (!latest || !latest.active) return;
      goCurrentJobPage(latest);
    }, APP.betweenTournamentDelayMs);
  }

  function markCurrentErrorAndNext(job, errorMsg) {
    const item = getCurrentJobItem(job);

    job.errors = Array.isArray(job.errors) ? job.errors : [];
    job.errors.push({
      ...(item || {}),
      error: String(errorMsg || ''),
      failedAt: nowText()
    });

    appendReport('ERROR', `${item?.name || item?.url || 'unknown'} / ${errorMsg}`);

    job.index = Number(job.index || 0) + 1;
    job.step = 'go';

    saveJob(job);

    if (job.stopRequested) {
      appendReport('JOB_STOPPED_AFTER_ERROR', `停止しました index=${job.index}/${job.queue.length}`);
      alert(`エラー後に停止しました。\n進捗: ${job.index}/${job.queue.length}`);
      showJob();
      return;
    }

    setTimeout(() => {
      const latest = loadJob();
      if (!latest || !latest.active) return;
      goCurrentJobPage(latest);
    }, APP.betweenTournamentDelayMs);
  }

  // ============================================================
  // Tournament page forms / submit
  // ============================================================

  async function fetchTournamentDocInBackground(id) {
    const url = getRelativePanelUrl(id);
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'follow'
    });
    const html = await res.text();
    if (!res.ok) throw new Error(`BACKGROUND_GET_FAILED id=${id} status=${res.status}`);
    appendReport('BACKGROUND_GET_HTTP_OK', `id=${id} status=${res.status} responseUrl=${res.url}`);
    if (/\/usuarios\/login/i.test(res.url)) {
      throw new Error(`BACKGROUND_LOGIN_REQUIRED id=${id} responseUrl=${res.url}`);
    }

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const finalId = extractIdFromUrlLike(res.url);
    if (finalId && String(finalId) !== String(id)) {
      throw new Error(`BACKGROUND_GET_ID_MISMATCH expected=${id} actual=${finalId}`);
    }
    doc.__pwcaResponseUrl = res.url;
    doc.__pwcaRawHtml = html;
    return doc;
  }

  function getTournamentNameFromDoc(doc) {
    const input = doc.querySelector(
      'input[name="nome"], input[name="ddTrn[nome]"], input[name="nome_caixa_input"], input[id*="nome"]'
    );
    if (input?.value) return cleanOperationalTournamentName(input.value);

    for (const selector of ['.page-title', 'h1', 'h2', '.box-title', '.content-header h1']) {
      const text = cleanOperationalTournamentName(doc.querySelector(selector)?.textContent || '');
      if (text && text !== 'Configuração' && text !== 'Configuracao') return text;
    }
    return '';
  }

  function validateBackgroundTournamentName(doc, item, stage, required = true) {
    const expected = cleanOperationalTournamentName(item.actualName || item.name || '');
    const actual = getTournamentNameFromDoc(doc);
    if (!actual) {
      if (required) throw new Error(`${stage}_NAME_NOT_DETECTED id=${item.tournamentId}`);
      appendReport(`${stage}_NAME_WARN`, `id=${item.tournamentId} name not detected`);
      return '';
    }
    if (!isSameTournamentLooseSafe(expected, actual)) {
      throw new Error(`${stage}_NAME_MISMATCH expected=${expected} / actual=${actual}`);
    }
    appendReport(`${stage}_NAME_OK`, `id=${item.tournamentId} actual=${actual}`);
    return actual;
  }

  function getBackgroundForm(doc, type) {
    const actionPart = type === 'close' ? '/fechamento_torneio' : '/auditoria_torneio';
    return doc.querySelector(`form[action*="${actionPart}"]`)
      || [...doc.querySelectorAll('form')].find(f => String(f.getAttribute('action') || '').includes(actionPart))
      || null;
  }

  function extractCodbloqFromRawHtml(html) {
    const source = String(html || '');
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
    return '';
  }

  function getBackgroundCodbloq(doc, form) {
    return norm(
      form?.querySelector('[name="codbloq"]')?.value
      || doc.querySelector('[name="codbloq"]')?.value
      || extractCodbloqFromRawHtml(form?.outerHTML || '')
      || extractCodbloqFromRawHtml(doc.__pwcaRawHtml || '')
      || ''
    );
  }

  async function postBackgroundTournamentForm(doc, form, item, type) {
    if (!form) throw new Error(`${type.toUpperCase()}_FORM_NOT_FOUND id=${item.tournamentId}`);
    const formId = norm(form.querySelector('[name="id_torneio"]')?.value || '');
    if (formId && formId !== String(item.tournamentId)) {
      throw new Error(`${type.toUpperCase()}_FORM_ID_MISMATCH expected=${item.tournamentId} actual=${formId}`);
    }
    const codbloq = getBackgroundCodbloq(doc, form);
    if (!codbloq) throw new Error(`${type.toUpperCase()}_CODBLOQ_NOT_FOUND id=${item.tournamentId}`);

    const fd = new FormData(form);
    fd.set('id_torneio', item.tournamentId);
    fd.set('codbloq', codbloq);

    const actionAttr = form.getAttribute('action') || '';
    if (!actionAttr) throw new Error(`${type.toUpperCase()}_ACTION_NOT_FOUND id=${item.tournamentId}`);
    const action = new URL(actionAttr, location.origin).href;

    appendReport(`BACKGROUND_${type.toUpperCase()}_POST`, `id=${item.tournamentId} action=${action}`);
    const res = await fetch(action, {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
      redirect: 'follow'
    });
    const responseText = await res.text();
    if (!res.ok) {
      throw new Error(`${type.toUpperCase()}_POST_FAILED id=${item.tournamentId} status=${res.status} body=${norm(responseText).slice(0, 180)}`);
    }
    if (/\/usuarios\/login/i.test(res.url)) {
      throw new Error(`${type.toUpperCase()}_POST_LOGIN_REDIRECT id=${item.tournamentId}`);
    }

    appendReport(
      `BACKGROUND_${type.toUpperCase()}_HTTP_OK`,
      `id=${item.tournamentId} status=${res.status} redirected=${res.redirected} responseUrl=${res.url}`
    );
    return { status: res.status, redirected: res.redirected, responseUrl: res.url };
  }

  async function processOneBackgroundClose(item) {
    setStatusForBackground(`GET before CLOSE: ${item.name}`);
    let doc = await fetchTournamentDocInBackground(item.tournamentId);
    const closeForm = getBackgroundForm(doc, 'close');
    if (!closeForm) {
      throw new Error(`BACKGROUND_CLOSE_FORM_NOT_FOUND id=${item.tournamentId}`);
    }

    // The selected action decides which endpoint to call. PW keeps unrelated
    // forms in its HTML, so AUDIT form presence must never suppress CLOSE.
    validateBackgroundTournamentName(doc, item, 'BEFORE_CLOSE');
    const postResult = await postBackgroundTournamentForm(doc, closeForm, item, 'close');
    const responseId = extractIdFromUrlLike(postResult.responseUrl || '');
    if (String(responseId) !== String(item.tournamentId)) {
      throw new Error(`AFTER_CLOSE_REDIRECT_UNEXPECTED id=${item.tournamentId} responseUrl=${postResult.responseUrl || ''}`);
    }
    appendReport('BACKGROUND_CLOSE_REDIRECT_VERIFIED', `id=${item.tournamentId} responseUrl=${postResult.responseUrl}`);

    appendReport('BACKGROUND_CLOSE_ONE_DONE', `${item.name} / id=${item.tournamentId}`);
    return { status: 'CLOSED', id: item.tournamentId, name: item.name, finishedAt: nowText() };
  }

  async function processOneBackgroundAudit(item) {
    setStatusForBackground(`GET before AUDIT: ${item.name}`);
    let doc = await fetchTournamentDocInBackground(item.tournamentId);
    const auditForm = getBackgroundForm(doc, 'audit');

    if (!auditForm) {
      appendReport('BACKGROUND_AUDIT_SKIP_NO_FORM', `id=${item.tournamentId} 監査 formなし`);
      return { status: 'SKIP_NO_AUDIT_FORM', id: item.tournamentId, name: item.name, finishedAt: nowText() };
    }

    validateBackgroundTournamentName(doc, item, 'BEFORE_AUDIT', false);

    const postResult = await postBackgroundTournamentForm(doc, auditForm, item, 'audit');
    if (!/\/cb\/torneio\/fechados(?:[/?#]|$)/i.test(postResult.responseUrl || '')) {
      throw new Error(`AFTER_AUDIT_REDIRECT_UNEXPECTED id=${item.tournamentId} responseUrl=${postResult.responseUrl || ''}`);
    }

    // PW keeps the AUDIT form in panel HTML even after a successful audit.
    // The same redirect used by the working page-navigation flow is the
    // reliable completion signal; re-fetching the panel cannot prove state.
    appendReport('BACKGROUND_AUDIT_REDIRECT_VERIFIED', `id=${item.tournamentId} responseUrl=${postResult.responseUrl}`);
    appendReport('BACKGROUND_AUDIT_ONE_DONE', `${item.name} / id=${item.tournamentId}`);
    return { status: 'AUDITED', id: item.tournamentId, name: item.name, finishedAt: nowText() };
  }

  function loadBackgroundJob() {
    try {
      const parsed = JSON.parse(localStorage.getItem(APP.backgroundJobKey) || 'null');
      return parsed && Array.isArray(parsed.queue) ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function saveBackgroundJob(job) {
    localStorage.setItem(APP.backgroundJobKey, JSON.stringify({ ...job, updatedAt: Date.now() }));
    showJob();
  }

  function clearBackgroundJob() {
    if (runningBackgroundTest) return alert('実行中は Clear できません。先に Stop してください。');
    if (!confirm('Background Job の進捗を削除しますか？')) return;
    localStorage.removeItem(APP.backgroundJobKey);
    showJob();
    appendReport('BACKGROUND_JOB_CLEAR', 'Background progress cleared');
  }

  function readInputTsv() {
    const raw = document.querySelector('#pwca-input')?.value || '';
    const parsed = parseInput(raw);
    if (!parsed.rows.length) return alert('入力が空です。');

    const hasUrlOrId = parsed.rows.some(row => norm(row.url) || norm(row.tournamentId));
    if (hasUrlOrId) {
      try {
        const direct = buildQueueFromInput(raw);
        direct.warnings.forEach(message => appendReport('TSV_WARN', message));
        for (const row of direct.rows) {
          setCacheItem(row.Name, {
            tournamentId: row.TournamentId,
            url: row.URL,
            actualName: row.Actual_Name || row.Name,
            source: 'close-audit-tsv-v1'
          });
        }
        localStorage.setItem(APP.inputKey, raw);
        saveCurrentBatch(direct.rows);
        showRows(direct.rows, 'TSV READ (LOCAL / URL READY)');
        alert(`TSV 読み込み完了\n\nURL実行可能: ${direct.queue.length} 件\nWARN: ${direct.warnings.length}`);
      } catch (e) {
        appendReport('TSV_READ_NG', e.message || String(e));
        alert(e.message || String(e));
      }
      return;
    }

    const seen = new Set();
    const duplicateNames = [];
    const rows = parsed.rows.map(row => {
      const name = norm(row.name || row.actualName || '');
      const key = compact(name);
      if (seen.has(key)) duplicateNames.push(name);
      seen.add(key);
      return {
        Name: name,
        TournamentId: '',
        URL: '',
        Actual_Name: name,
        Source: 'name_only_needs_url_scan',
        SavedAt: nowText(),
        Matched_Row: ''
      };
    });

    localStorage.setItem(APP.inputKey, raw);
    saveCurrentBatch(rows);
    showRows(rows, 'TSV READ (LOCAL / URL MISSING)');
    appendReport('TSV_READ_NAME_ONLY', `${rows.length} 件 / duplicate=${duplicateNames.length}`);
    alert(
      `TSV 読み込み完了\n\n大会名: ${rows.length} 件\nURL未取得: ${rows.length} 件\n` +
      `重複名: ${duplicateNames.length} 件\n\n「URLを補完」を実行してください。`
    );
  }

  function getUrlManagerApi() {
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow.PWUrlCacheManagerV06) {
        return unsafeWindow.PWUrlCacheManagerV06;
      }
    } catch (_) {}
    return window.PWUrlCacheManagerV06 || null;
  }

  function requestUrlManagerResolve(names) {
    const requestKey = 'PW_URL_MANAGER_RESOLVE_REQUEST_V1';
    const responseKey = 'PW_URL_MANAGER_RESOLVE_RESPONSE_V1';
    const requestId = `pwca-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return new Promise((resolve, reject) => {
      let timer = null;
      const cleanup = () => {
        document.removeEventListener('PW_URL_MANAGER_RESOLVE_RESPONSE', onResponse);
        if (timer) clearTimeout(timer);
      };
      const onResponse = () => {
        try {
          const response = JSON.parse(localStorage.getItem(responseKey) || 'null');
          if (!response || response.requestId !== requestId) return;
          cleanup();
          if (!response.ok) reject(new Error(response.error || 'URL Manager resolve failed'));
          else resolve(response.result);
        } catch (e) {
          cleanup();
          reject(e);
        }
      };

      document.addEventListener('PW_URL_MANAGER_RESOLVE_RESPONSE', onResponse);
      timer = setTimeout(() => {
        cleanup();
        reject(new Error('URL Manager response timeout'));
      }, 30 * 60 * 1000);

      localStorage.setItem(requestKey, JSON.stringify({ requestId, names, requestedAt: Date.now() }));
      document.dispatchEvent(new Event('PW_URL_MANAGER_RESOLVE_REQUEST'));
    });
  }

  async function resolveInputUrlsWithManager() {
    if (runningBackgroundTest) return alert('Background処理中です。');

    const raw = document.querySelector('#pwca-input')?.value || '';
    const parsed = parseInput(raw);
    if (!parsed.rows.length) return alert('大会名またはTSVを貼ってください。');

    const malformed = [];
    const missingNames = [];
    const normalizedRows = parsed.rows.map((row, index) => {
      const name = norm(row.name || row.actualName || '');
      const rawUrl = norm(row.url || '');
      const rawId = norm(row.tournamentId || '');
      const { id, url } = normalizeUrlAndId(row);
      if (!name) malformed.push(`Row ${index + 2}: Name / 大会名 が空です`);
      if (rawUrl && !extractIdFromUrlLike(rawUrl)) malformed.push(`Row ${index + 2}: URLが不正です: ${rawUrl}`);
      if (rawId && !/^\d+$/.test(rawId)) malformed.push(`Row ${index + 2}: TournamentIdが不正です: ${rawId}`);
      if (!id && name) missingNames.push(name);
      return { name, id, url };
    });

    if (malformed.length) {
      const message = `TSV 検証NG: ${malformed.length}件\n` + malformed.slice(0, 20).join('\n');
      appendReport('URL_RESOLVE_INPUT_NG', message);
      return alert(message);
    }

    runningBackgroundTest = true;
    stopSearchRequested = false;
    appendReport('URL_RESOLVE_START', `rows=${normalizedRows.length} missing=${missingNames.length} / shared-cache + url-pool`);
    setStatusForBackground(`URL補完中: ${missingNames.length} 件`);

    let closedWin = null;
    let openWin = null;
    try {
      const resultMap = new Map();
      const unresolvedForPool = [];

      for (const name of missingNames) {
        const cacheFound = findCacheMatchByName(name);
        if (cacheFound.status === 'OK') {
          resultMap.set(name, cacheFound);
          appendReport('URL_CACHE_OK', `${name} → ${cacheFound.url}`);
        } else {
          if (cacheFound.status === 'AMBIGUOUS') {
            appendReport('URL_CACHE_AMBIGUOUS', `${name} / ${cacheFound.candidates.length} candidates`);
          }
          unresolvedForPool.push(name);
        }
      }

      if (unresolvedForPool.length) {
        const prefixRows = unresolvedForPool.map(name => ({ name }));
        const prefixes = getPrefixesForUrlPool(prefixRows);

        if (!prefixes.length) {
          appendReport('URL_POOL_SKIP', 'Event Prefix がないため URL pool 検索不可');
        } else {
          const ok = confirm(
            `URL未解決を URL pool 方式で補完します。\n\n` +
            `対象: ${unresolvedForPool.length} 件\n` +
            `Event Prefix: ${prefixes.join(' / ')}\n` +
            `検索: OPEN / CLOSED をPrefix単位で一括収集\n\n` +
            `続行しますか？`
          );

          if (!ok) {
            appendReport('URL_POOL_CANCEL', `${unresolvedForPool.length} 件`);
          } else {
            setStatusForBackground('OPEN / CLOSED 大会一覧を開いています...');
            closedWin = await openTournamentListWindow('/cb/torneio/fechados', 'closed');
            openWin = await openTournamentListWindow('/cb/torneio/abertos', 'open');

            const pool = [];
            const poolSeen = new Set();

            for (const prefix of prefixes) {
              if (stopSearchRequested) break;
              appendReport('URL_POOL_SCAN', prefix);

              for (const item of [
                { win: closedWin, label: 'closed' },
                { win: openWin, label: 'open' }
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
                  appendReport('URL_POOL_WINDOW_ERROR', `${item.label}: ${prefix} / ${e.message || e}`);
                }
              }
            }

            appendReport('URL_POOL_COLLECTED', `${pool.length} 件`);

            for (const name of unresolvedForPool) {
              if (resultMap.has(name)) continue;
              const found = matchUrlPoolByName(pool, name);
              resultMap.set(name, found);
              if (found.status === 'OK') {
                appendReport('URL_POOL_OK', `${name} → ${found.url}`);
              } else if (found.status === 'AMBIGUOUS') {
                appendReport('URL_POOL_AMBIGUOUS', `${name} / ${found.candidates.length} candidates`);
              } else {
                appendReport('URL_POOL_NOT_FOUND', name);
              }
            }
          }
        }
      }

      const outputRows = normalizedRows.map(row => {
        if (row.id) {
          const result = {
            Name: row.name,
            TournamentId: row.id,
            URL: getRelativePanelUrl(row.id),
            Actual_Name: row.name,
            Source: 'input',
            SavedAt: nowText(),
            Matched_Row: ''
          };
          setCacheItem(row.name, {
            tournamentId: row.id,
            url: result.URL,
            actualName: row.name,
            source: 'close-audit-tsv-v1'
          });
          return result;
        }

        const found = resultMap.get(row.name);
        if (found?.status === 'OK') {
          const result = {
            Name: row.name,
            TournamentId: found.tournamentId,
            URL: found.url || getRelativePanelUrl(found.tournamentId),
            Actual_Name: found.actualName || row.name,
            Source: found.source || 'url-pool',
            SavedAt: nowText(),
            Matched_Row: found.matchedRow || ''
          };
          setCacheItem(row.name, {
            tournamentId: result.TournamentId,
            url: result.URL,
            actualName: result.Actual_Name,
            matchedRow: result.Matched_Row,
            source: result.Source
          });
          return {
            ...result
          };
        }

        appendReport('URL_RESOLVE_UNRESOLVED', `${row.name} / ${found?.status || 'NOT_FOUND'}`);
        return {
          Name: row.name,
          TournamentId: '',
          URL: '',
          Actual_Name: row.name,
          Source: found?.status || 'NOT_FOUND',
          SavedAt: nowText(),
          Matched_Row: ''
        };
      });

      const ready = outputRows.filter(row => row.TournamentId && row.URL).length;
      const unresolvedCount = outputRows.length - ready;
      const standardizedTsv = rowsToTsv(outputRows, ['Name', 'TournamentId', 'URL']);
      const input = document.querySelector('#pwca-input');
      if (input) input.value = standardizedTsv;
      localStorage.setItem(APP.inputKey, standardizedTsv);
      saveCurrentBatch(outputRows);
      showRows(outputRows, 'URL POOL RESOLVED BATCH');
      appendReport('URL_RESOLVE_DONE', `ready=${ready} unresolved=${unresolvedCount}`);
      setStatusForBackground(`URL補完完了: READY ${ready} / 未解決 ${unresolvedCount}`);
      alert(`URL補完完了\n\nREADY: ${ready}\n未解決: ${unresolvedCount}\n\n未解決がある場合は実行できません。`);
    } catch (e) {
      console.error(APP.logPrefix, e);
      appendReport('URL_RESOLVE_ERROR', e.message || String(e));
      alert(`URL補完 ERROR\n\n${e.message || e}`);
    } finally {
      try { if (closedWin && !closedWin.closed) closedWin.close(); } catch (_) {}
      try { if (openWin && !openWin.closed) openWin.close(); } catch (_) {}
      runningBackgroundTest = false;
    }
  }

  async function checkBackgroundInput() {
    if (runningBackgroundTest) return alert('Background処理中です');
    const raw = document.querySelector('#pwca-input')?.value || '';
    let direct;
    try {
      direct = buildQueueFromInput(raw);
    } catch (e) {
      appendReport('BACKGROUND_CHECK_INPUT_NG', e.message || String(e));
      return alert(e.message || String(e));
    }
    if (!direct.detected || !direct.queue.length) return alert('Name / URL TSV を貼ってください。');

    runningBackgroundTest = true;
    saveCurrentBatch(direct.rows);
    showRows(direct.rows, 'CHECK input (Prefixなし)');
    appendReport('BACKGROUND_CHECK_START', `${direct.queue.length} 件 / READ ONLY`);
    let readyClose = 0;
    let readyAudit = 0;
    let noAction = 0;
    let unknown = 0;
    let errors = 0;

    try {
      for (let i = 0; i < direct.queue.length; i++) {
        const item = direct.queue[i];
        setStatusForBackground(`CHECK ${i + 1}/${direct.queue.length}: ${item.name}`);
        try {
          const doc = await fetchTournamentDocInBackground(item.tournamentId);
          const closeForm = getBackgroundForm(doc, 'close');
          const auditForm = getBackgroundForm(doc, 'audit');
          // Closed pages can contain both forms, so AUDIT must take priority.
          if (auditForm) {
            const actual = validateBackgroundTournamentName(doc, item, 'CHECK_AUDIT', false);
            if (!getBackgroundCodbloq(doc, auditForm)) {
              throw new Error(`CHECK_AUDIT_CODBLOQ_NOT_FOUND id=${item.tournamentId}`);
            }
            readyAudit++;
            appendReport('CHECK_AUDIT_FORM_PRESENT', `${i + 1}/${direct.queue.length} id=${item.tournamentId} actual=${actual}`);
          } else if (closeForm) {
            const actual = validateBackgroundTournamentName(doc, item, 'CHECK', false);
            if (!actual) {
              noAction++;
              appendReport('CHECK_NO_ACTION', `${i + 1}/${direct.queue.length} id=${item.tournamentId} CLOSE formあり / nameなし`);
            } else {
              if (!getBackgroundCodbloq(doc, closeForm)) {
                throw new Error(`CHECK_CLOSE_CODBLOQ_NOT_FOUND id=${item.tournamentId}`);
              }
              readyClose++;
              appendReport('CHECK_READY_CLOSE', `${i + 1}/${direct.queue.length} id=${item.tournamentId} actual=${actual}`);
            }
          } else {
            const actual = validateBackgroundTournamentName(doc, item, 'CHECK_UNKNOWN', false);
            unknown++;
            appendReport('CHECK_UNKNOWN_STATE', `${i + 1}/${direct.queue.length} id=${item.tournamentId} actual=${actual}`);
          }
        } catch (e) {
          errors++;
          appendReport('CHECK_ERROR', `${i + 1}/${direct.queue.length} ${item.name} / ${e.message || e}`);
        }
        await sleep(250);
      }
      appendReport('BACKGROUND_CHECK_DONE', `CLOSE=${readyClose} AUDIT_ONLY=${readyAudit} NO_ACTION=${noAction} UNKNOWN=${unknown} ERROR=${errors}`);
      setStatusForBackground(`CHECK DONE: CLOSE=${readyClose} AUDIT=${readyAudit} NO_ACTION=${noAction} UNKNOWN=${unknown} ERROR=${errors}`);
      alert(`CHECK 完了（READ ONLY）\n\nCLOSE可能: ${readyClose}\n監査formあり: ${readyAudit}\n処理対象なし: ${noAction}\n状態不明: ${unknown}\nERROR: ${errors}\n\n注意: PWは監査後もformを残すため、formだけでは監査済み/未済みを判別できません。`);
    } finally {
      runningBackgroundTest = false;
    }
  }

  async function continueBackgroundJob() {
    if (runningBackgroundTest) return alert('Background処理中です');
    let job = loadBackgroundJob();
    if (!job?.queue?.length) return alert('Background Job がありません。Input TSV から新規Runしてください。');
    if (!['close', 'audit'].includes(job.operation)) {
      return alert('旧バージョンのJobは再開できません。Clear Progress後、Run CLOSEまたはRun 監査から開始してください。');
    }

    runningBackgroundTest = true;
    job.active = true;
    job.stopRequested = false;
    job.status = 'running';
    saveBackgroundJob(job);
    appendReport('BACKGROUND_JOB_RUN', `operation=${job.operation.toUpperCase()} index=${job.index}/${job.queue.length}`);

    try {
      while (job.index < job.queue.length) {
        job = loadBackgroundJob() || job;
        if (job.stopRequested) {
          job.active = false;
          job.status = 'stopped';
          saveBackgroundJob(job);
          appendReport('BACKGROUND_JOB_STOPPED', `index=${job.index}/${job.queue.length}`);
          setStatusForBackground(`Background stopped: ${job.index}/${job.queue.length}`);
          alert(`Background Job 停止\n進捗: ${job.index}/${job.queue.length}`);
          return;
        }

        const item = job.queue[job.index];
        appendReport(`BACKGROUND_${job.operation.toUpperCase()}_ONE_START`, `${job.index + 1}/${job.queue.length} ${item.name} / id=${item.tournamentId}`);
        try {
          const result = job.operation === 'close'
            ? await processOneBackgroundClose(item)
            : await processOneBackgroundAudit(item);
          if (String(result.status).startsWith('SKIP_')) {
            job.skipped = Array.isArray(job.skipped) ? job.skipped : [];
            job.skipped.push(result);
          } else {
            job.done = Array.isArray(job.done) ? job.done : [];
            job.done.push(result);
          }
        } catch (e) {
          console.error(APP.logPrefix, e);
          job.errors = Array.isArray(job.errors) ? job.errors : [];
          job.errors.push({
            ...item,
            error: e.message || String(e),
            failedAt: nowText()
          });
          appendReport(`BACKGROUND_${job.operation.toUpperCase()}_ONE_ERROR`, `${job.index + 1}/${job.queue.length} ${item.name} / ${e.message || e}`);
        }

        job.index++;
        const latest = loadBackgroundJob();
        if (latest?.stopRequested) job.stopRequested = true;
        saveBackgroundJob(job);
        await sleep(APP.betweenTournamentDelayMs);
      }

      job.active = false;
      job.status = 'complete';
      saveBackgroundJob(job);
      appendReport('BACKGROUND_JOB_DONE', `operation=${job.operation.toUpperCase()} done=${job.done?.length || 0} skipped=${job.skipped?.length || 0} errors=${job.errors?.length || 0}`);
      setStatusForBackground(`${job.operation.toUpperCase()} DONE: ${job.done?.length || 0} / SKIP ${job.skipped?.length || 0} / ERROR ${job.errors?.length || 0}`);
      alert(`${job.operation.toUpperCase()} Batch 完了\n\nDONE: ${job.done?.length || 0}\nSKIP: ${job.skipped?.length || 0}\nERROR: ${job.errors?.length || 0}`);
    } finally {
      runningBackgroundTest = false;
    }
  }

  async function startBackgroundBatch(operation) {
    if (runningBackgroundTest) return alert('Background処理中です');
    if (!['close', 'audit'].includes(operation)) return alert(`Unknown operation: ${operation}`);
    const raw = document.querySelector('#pwca-input')?.value || '';
    let direct;
    try {
      direct = buildQueueFromInput(raw);
    } catch (e) {
      appendReport('BACKGROUND_BATCH_INPUT_NG', e.message || String(e));
      return alert(e.message || String(e));
    }
    if (!direct.detected || !direct.queue.length) return alert('Name / URL TSV を貼ってください。');

    const previousJob = loadBackgroundJob();
    const sameQueue = previousJob?.queue?.length === direct.queue.length
      && previousJob.queue.every((item, i) => String(item.tournamentId) === String(direct.queue[i]?.tournamentId));
    if (operation === 'audit' && previousJob?.operation === 'audit' && previousJob.status === 'complete' && sameQueue) {
      return alert(
        '同じ監査Jobはすでに実行済みです。\n\n' +
        'PWは監査後もformを残すため、自動再実行は停止しました。\n' +
        '意図的に再実行する場合だけ Clear Progress 後に開始してください。'
      );
    }

    const preview = direct.queue.slice(0, 10)
      .map((item, i) => `${i + 1}. ${item.name}\n   ${getAbsUrl(item.url)}`)
      .join('\n');
    const remaining = direct.queue.length > 10 ? `\n...ほか ${direct.queue.length - 10} 件` : '';
    const operationLabel = operation === 'close' ? 'CLOSE' : '監査';
    const flowLabel = operation === 'close'
      ? '各大会: GET → CLOSE POST → 再GET検証'
      : '各大会: GET → 監査 POST → 再GET検証';
    if (!confirm(
      `BACKGROUND ${operationLabel} を実行します。\n\n` +
      `対象: ${direct.queue.length} 件\n` +
      `逐次実行: 1件ずつ\n` +
      `${flowLabel}\n` +
      `このRunでは${operationLabel}以外の更新は行いません。\n\n` +
      `${preview}${remaining}\n\n本当に実行しますか？`
    )) return;

    const job = {
      active: false,
      status: 'ready',
      operation,
      queue: direct.queue,
      index: 0,
      done: [],
      skipped: [],
      errors: [],
      stopRequested: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    localStorage.setItem(APP.inputKey, raw);
    saveCurrentBatch(direct.rows);
    saveBackgroundJob(job);
    appendReport('BACKGROUND_JOB_START', `operation=${operation.toUpperCase()} ${direct.queue.length} 件`);
    await continueBackgroundJob();
  }

  function requestStopBackgroundJob() {
    const job = loadBackgroundJob();
    if (!job?.queue?.length || job.status === 'complete') return alert('実行中の Background Job はありません。');
    job.stopRequested = true;
    job.status = 'stop_requested';
    saveBackgroundJob(job);
    appendReport('BACKGROUND_STOP_REQUEST', `現在の1件完了後に停止 / index=${job.index}/${job.queue.length}`);
    setStatusForBackground('Stop requested: 現在の1件完了後に停止します');
  }

  async function resumeBackgroundJob() {
    const job = loadBackgroundJob();
    if (!job?.queue?.length) return alert('再開できる Background Job がありません。');
    if (job.index >= job.queue.length) return alert('この Background Job は完了済みです。');
    if (!['close', 'audit'].includes(job.operation)) {
      return alert('旧バージョンのJobは再開できません。Clear Progress後、新しく実行してください。');
    }
    if (!confirm(`${job.operation.toUpperCase()} Job を再開します。\n\n進捗: ${job.index}/${job.queue.length}\n次: ${job.queue[job.index].name}`)) return;
    await continueBackgroundJob();
  }

  function setStatusForBackground(message) {
    const box = document.querySelector('#pwca-status');
    if (box) box.textContent = message;
    console.log(APP.logPrefix, message);
  }

  function cleanOperationalTournamentName(value) {
    return norm(value).replace(/\s*監査(?:済み|待ち)\s*$/g, '');
  }

  function getCurrentTournamentName() {
    const input = document.querySelector('input[name="nome"], input[name="ddTrn[nome]"], input[id*="nome"]');
    if (input?.value) return cleanOperationalTournamentName(input.value);

    for (const selector of ['.page-title', 'h1', 'h2', '.box-title', '.content-header h1']) {
      const text = cleanOperationalTournamentName(document.querySelector(selector)?.textContent || '');
      if (text && text !== 'Configuração' && text !== 'Configuracao') return text;
    }
    return '';
  }

  function validateCurrentJobName(item) {
    const expected = cleanOperationalTournamentName(item?.actualName || item?.name || '');
    const actual = getCurrentTournamentName();
    if (!expected || /^https?:|^\/cb\//i.test(expected)) {
      appendReport('NAME_CHECK_SKIP', `id=${item?.tournamentId || ''} expected name empty`);
      return;
    }
    if (!actual) {
      appendReport('NAME_CHECK_WARN', `id=${item?.tournamentId || ''} page name not detected`);
      return;
    }
    if (!isSameTournamentLooseSafe(expected, actual)) {
      throw new Error(`PAGE_NAME_MISMATCH expected=${expected} / actual=${actual}`);
    }
    appendReport('NAME_CHECK_OK', `id=${item.tournamentId} actual=${actual}`);
  }

  function getCloseForm() {
    return document.querySelector('#modal_fechar_torneio form[action*="/fechamento_torneio"]')
      || [...document.querySelectorAll('form')].find(f => (f.action || '').includes('/fechamento_torneio'));
  }

  function getAuditForm() {
    return document.querySelector('#modal_auditar_confirmar form[action*="/auditoria_torneio"]')
      || [...document.querySelectorAll('form')].find(f => (f.action || '').includes('/auditoria_torneio'));
  }

  function getCodbloq() {
    const closeForm = getCloseForm();
    const auditForm = getAuditForm();

    return closeForm?.querySelector('input[name="codbloq"]')?.value
      || auditForm?.querySelector('input[name="codbloq"]')?.value
      || document.querySelector('input[name="codbloq"]')?.value
      || '';
  }

  function ensureHiddenInput(form, name, value) {
    if (!form || !name) return;

    let input = form.querySelector(`input[name="${CSS.escape(name)}"]`);

    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      form.appendChild(input);
    }

    input.value = value;
  }

  function submitFormNormally(form) {
    if (!form) throw new Error('form が見つかりません');

    HTMLFormElement.prototype.submit.call(form);
  }

  function debugForms() {
    const tournamentId = getTournamentIdFromUrl();
    const closeForm = getCloseForm();
    const auditForm = getAuditForm();
    const codbloq = getCodbloq();

    const info = {
      tournamentIdFromUrl: tournamentId,
      codbloq,
      closeFound: !!closeForm,
      closeAction: closeForm?.action || '',
      closeId: closeForm?.querySelector('input[name="id_torneio"]')?.value || '',
      auditFound: !!auditForm,
      auditAction: auditForm?.action || '',
      auditId: auditForm?.querySelector('input[name="id_torneio"]')?.value || ''
    };

    console.table([info]);

    alert(
      [
        '検出結果',
        '',
        `Tournament ID: ${info.tournamentIdFromUrl}`,
        `codbloq: ${info.codbloq || '(なし)'}`,
        '',
        `CLOSE form: ${info.closeFound ? 'OK' : 'NG'}`,
        `CLOSE action: ${info.closeAction || '(なし)'}`,
        '',
        `監査 form: ${info.auditFound ? 'OK' : 'NG'}`,
        `監査 action: ${info.auditAction || '(なし)'}`,
      ].join('\n')
    );

    appendReport('DEBUG_FORMS', JSON.stringify(info));
    return info;
  }

  async function submitClose(job, item) {
    const closeForm = getCloseForm();
    const id = getTournamentIdFromUrl();
    const codbloq = getCodbloq();

    if (!closeForm) throw new Error('CLOSE form が見つかりません');

    ensureHiddenInput(closeForm, 'id_torneio', id);
    if (codbloq) ensureHiddenInput(closeForm, 'codbloq', codbloq);

    job.step = 'after_close_reload';
    saveJob(job);

    appendReport('SUBMIT_CLOSE', `${job.index + 1}/${job.queue.length} ${item.name} / id=${id}`);
    log('submit CLOSE', { id, codbloq, action: closeForm.action });

    await sleep(APP.beforeSubmitDelayMs);

    submitFormNormally(closeForm);
  }

  async function submitAudit(job, item, stepAfterSubmit) {
    const auditForm = getAuditForm();
    const id = getTournamentIdFromUrl();
    const codbloq = getCodbloq();

    if (!auditForm) throw new Error('監査 form が見つかりません');

    ensureHiddenInput(auditForm, 'id_torneio', id);
    if (codbloq) ensureHiddenInput(auditForm, 'codbloq', codbloq);

    job.step = stepAfterSubmit;
    saveJob(job);

    appendReport('SUBMIT_AUDIT', `${job.index + 1}/${job.queue.length} ${item.name} / id=${id}`);
    log('submit AUDIT', { id, codbloq, action: auditForm.action });

    await sleep(APP.beforeSubmitDelayMs);

    submitFormNormally(auditForm);
  }

  async function runSingleCloseAudit() {
    const id = getTournamentIdFromUrl();

    if (!id) {
      alert('比赛页面ではありません');
      return;
    }

    const ok = confirm(`単発実行：CLOSE → 監査\n\nid_torneio: ${id}\n\n本当に実行しますか？`);
    if (!ok) return;

    const job = {
      active: true,
      mode: 'single_open_close_audit',
      prefix: '',
      queue: [{
        name: `single ${id}`,
        actualName: `single ${id}`,
        tournamentId: id,
        url: getRelativePanelUrl(id),
        source: 'single'
      }],
      index: 0,
      step: 'on_page',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      done: [],
      errors: [],
      stopRequested: false
    };

    saveJob(job);
    await processJobOnTournamentPage();
  }

  async function runSingleAuditOnly() {
    const id = getTournamentIdFromUrl();

    if (!id) {
      alert('比赛页面ではありません');
      return;
    }

    const ok = confirm(`単発実行：監査だけ\n\nid_torneio: ${id}\n\n本当に実行しますか？`);
    if (!ok) return;

    const job = {
      active: true,
      mode: 'single_closed_audit_only',
      prefix: '',
      queue: [{
        name: `single ${id}`,
        actualName: `single ${id}`,
        tournamentId: id,
        url: getRelativePanelUrl(id),
        source: 'single'
      }],
      index: 0,
      step: 'on_page',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      done: [],
      errors: [],
      stopRequested: false
    };

    saveJob(job);
    await processJobOnTournamentPage();
  }

  async function processJobOnTournamentPage() {
    await sleep(APP.afterPageLoadDelayMs);

    const job = loadJob();
    if (!job || !job.active) return;

    const item = getCurrentJobItem(job);
    if (!item) {
      goCurrentJobPage(job);
      return;
    }

    const currentId = getTournamentIdFromUrl();

    if (!currentId) {
      appendReport('WAIT_NOT_PANEL', location.href);
      return;
    }

    if (String(currentId) !== String(item.tournamentId)) {
      appendReport('ID_MISMATCH_GO', `current=${currentId} target=${item.tournamentId}`);
      goCurrentJobPage(job);
      return;
    }

    try {
      validateCurrentJobName(item);

      if (job.step === 'after_close_reload') {
        await submitAudit(job, item, 'after_audit_reload');
        return;
      }

      if (job.step === 'after_audit_reload') {
        appendReport('DONE_ONE', `${job.index + 1}/${job.queue.length} ${item.name}`);
        markCurrentDoneAndNext(job, 'audit_done');
        return;
      }

      if (job.step === 'on_page' || job.step === 'go') {
        if (job.mode === 'open_close_audit' || job.mode === 'single_open_close_audit') {
          await submitClose(job, item);
          return;
        }

        if (job.mode === 'closed_audit_only' || job.mode === 'single_closed_audit_only') {
          await submitAudit(job, item, 'after_audit_reload');
          return;
        }

        throw new Error(`Unknown mode: ${job.mode}`);
      }

      throw new Error(`Unknown step: ${job.step}`);

    } catch (e) {
      err('process error', e);
      markCurrentErrorAndNext(job, e.message || String(e));
    }
  }

  // ============================================================
  // UI
  // ============================================================

  function addPanel() {
    if (document.querySelector('#' + APP.panelId)) return;

    const savedInput = localStorage.getItem(APP.inputKey) || 'Name\tURL';
    const savedReport = localStorage.getItem(APP.reportKey) || '';

    const panel = document.createElement('div');
    panel.id = APP.panelId;

    panel.style.cssText = `
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 999999;
      width: 650px;
      max-height: 94vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
      background: rgba(28, 28, 28, .96);
      color: #fff;
      border-radius: 10px;
      box-shadow: 0 4px 18px rgba(0,0,0,.38);
      font-family: Arial, "Hiragino Kaku Gothic ProN", Meiryo, sans-serif;
      font-size: 13px;
    `;

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="font-weight:700;">PW CLOSE/AUDIT Batch v1.0.1</div>
        <div style="display:flex;gap:4px;">
          <button id="pwca-minimize" style="font-size:11px;padding:2px 6px;cursor:pointer;">Min</button>
          <button id="pwca-close-panel" style="font-size:11px;padding:2px 6px;cursor:pointer;">×</button>
        </div>
      </div>

      <div id="${APP.bodyId}" style="display:block;overflow:auto;padding-right:2px;">
        <div style="font-size:11px;color:#ccc;line-height:1.5;margin-bottom:8px;">
          TSV読込 → 必要ならShared Cache / URL pool補完 → Run CLOSE / Run 監査<br>
          実行対象は現在のTSVだけです。名前だけの場合はEvent Prefix単位でOPEN/CLOSEDを一括収集します。
        </div>

        <div style="font-size:12px;font-weight:bold;">Input: Name / URL TSV</div>
        <textarea id="pwca-input"
          style="width:100%;box-sizing:border-box;height:125px;background:#111;color:#fff;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

        <div style="display:flex;gap:6px;margin-top:8px;">
          <button id="pwca-read-tsv"
            style="flex:1;padding:9px;cursor:pointer;background:#74b9ff;border:1px solid #48a;font-weight:700;">
            TSVを読み取る（本地）
          </button>
          <button id="pwca-resolve-urls"
            style="flex:1;padding:9px;cursor:pointer;background:#bff0c2;border:1px solid #8a8;font-weight:700;">
            URLを補完（Pool）
          </button>
        </div>

        <div style="display:flex;gap:6px;margin-top:8px;">
          <button id="pwca-background-close"
            style="flex:1;padding:10px;cursor:pointer;background:#ff7675;border:1px solid #d55;color:#fff;font-weight:700;">
            Run CLOSE
          </button>
          <button id="pwca-background-audit"
            style="flex:1;padding:10px;cursor:pointer;background:#636e72;border:1px solid #444;color:#fff;font-weight:700;">
            Run 監査
          </button>
        </div>

        <div style="display:flex;gap:6px;margin-top:8px;">
          <button id="pwca-background-stop"
            style="flex:1;padding:8px;cursor:pointer;background:#f3cccc;border:1px solid #c88;">
            Stop（当前场后）
          </button>
          <button id="pwca-background-resume"
            style="flex:1;padding:8px;cursor:pointer;background:#ffe08a;border:1px solid #c99;">Resume</button>
          <button id="pwca-background-clear"
            style="flex:1;padding:8px;cursor:pointer;background:#2d3436;border:1px solid #111;color:#fff;">Clear Progress</button>
        </div>

        <div style="font-size:12px;font-weight:bold;margin-top:8px;">Validated Input</div>
        <textarea id="pwca-output" readonly
          style="width:100%;box-sizing:border-box;height:85px;background:#111;color:#fff;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

        <div style="font-size:12px;font-weight:bold;margin-top:8px;">Background Progress</div>
        <textarea id="pwca-job-output" readonly
          style="width:100%;box-sizing:border-box;height:100px;background:#111;color:#ffd;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

        <div style="font-size:12px;font-weight:bold;margin-top:8px;">Report</div>
        <textarea id="pwca-report" readonly
          style="width:100%;box-sizing:border-box;height:135px;background:#111;color:#9fe;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

        <div style="display:flex;gap:6px;margin-top:8px;">
          <button id="pwca-copy-report" style="flex:1;padding:6px;cursor:pointer;background:#eee;border:1px solid #aaa;">Copy Report</button>
          <button id="pwca-clear-report" style="flex:1;padding:6px;cursor:pointer;background:#eee;border:1px solid #aaa;">Clear Report</button>
        </div>

        <div id="pwca-status" style="font-size:11px;color:#9fe;line-height:1.35;white-space:pre-wrap;margin-top:8px;">ready</div>
      </div>
    `;

    document.body.appendChild(panel);

    const inputEl = document.querySelector('#pwca-input');
    const reportEl = document.querySelector('#pwca-report');

    inputEl.value = savedInput;
    reportEl.value = savedReport;

    inputEl.addEventListener('change', () => {
      localStorage.setItem(APP.inputKey, inputEl.value || '');
    });

    document.querySelector('#pwca-minimize').onclick = () => {
      const body = document.querySelector('#' + APP.bodyId);
      const btn = document.querySelector('#pwca-minimize');
      if (!body || !btn) return;

      const hidden = body.style.display === 'none';
      body.style.display = hidden ? 'block' : 'none';
      btn.textContent = hidden ? 'Min' : 'Open';
    };

    document.querySelector('#pwca-close-panel').onclick = () => {
      panel.style.display = 'none';
    };

    document.querySelector('#pwca-read-tsv').onclick = () => readInputTsv();
    document.querySelector('#pwca-resolve-urls').onclick = () => resolveInputUrlsWithManager();
    document.querySelector('#pwca-background-close').onclick = () => startBackgroundBatch('close');
    document.querySelector('#pwca-background-audit').onclick = () => startBackgroundBatch('audit');
    document.querySelector('#pwca-background-stop').onclick = () => requestStopBackgroundJob();
    document.querySelector('#pwca-background-resume').onclick = () => resumeBackgroundJob();
    document.querySelector('#pwca-background-clear').onclick = () => clearBackgroundJob();

    document.querySelector('#pwca-copy-report').onclick = () => {
      copyText(document.querySelector('#pwca-report')?.value || '');
      alert('Report copied');
    };

    document.querySelector('#pwca-clear-report').onclick = () => clearReport();

    if (loadCurrentBatch()?.rows?.length) showCurrentBatch();
    showJob();
  }

  // ============================================================
  // Boot
  // ============================================================

  function exposeApi() {
    window.PWCloseAuditBatch = {
      APP,

      loadCache,
      saveCache,
      setCacheItem,
      cacheToTsv,
      showCache,
      showCurrentBatch,
      loadCurrentBatch,
      clearCurrentEventCache,
      clearAllCache,

      buildCacheBySearch,
      collectVisibleUrlsToCache,
      importCacheFromTsv,

      loadJob,
      saveJob,
      clearJob,
      showJob,
      buildQueueFromInput,
      startJob,
      requestStopJob,

      readInputTsv,
      resolveInputUrlsWithManager,
      startBackgroundBatch,
      requestStopBackgroundJob,
      resumeBackgroundJob,
      loadBackgroundJob,
      clearBackgroundJob,
      processOneBackgroundClose,
      processOneBackgroundAudit,

      debugForms,
      runSingleCloseAudit,
      runSingleAuditOnly
    };
  }

  async function boot() {
    addPanel();
    exposeApi();

    log(`${APP.name} ${APP.version} ready / Cache count: ${getCacheCount()}`);

    const legacyJob = loadJob();
    if (legacyJob?.active) {
      legacyJob.active = false;
      saveJob(legacyJob);
      appendReport('LEGACY_PAGE_JOB_PAUSED', 'v0.4 switched to Background mode; old page-navigation job will not auto-resume');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
