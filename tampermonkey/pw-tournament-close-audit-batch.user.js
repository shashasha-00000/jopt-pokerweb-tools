// ==UserScript==
// @name         PW Tournament CLOSE + AUDIT Batch 私用版 V0.2
// @namespace    xhpc007-pw-close-audit-batch-private
// @version      0.2.0
// @description  PW比赛批量 CLOSE / 監査 私用版。带URL抓取、URL Cache、队列执行、页面刷新接力。
// @author       xhpc007 + ChatGPT
// @match        https://japanopt.pokerweb.com.br/cb/*
// @match        https://japanopt.pokerweb.com.br/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  /********************************************************************
   * PW Tournament CLOSE + AUDIT Batch 私用版 V0.2
   *
   * 用法：
   *
   * A. OPEN TOURNAMENT 页面：
   *   1. 打开 OPEN TOURNAMENT 列表
   *   2. Prefix 填：【SPADIE season 41st】
   *   3. 可以用「Build Cache by Search」按名单搜索抓URL
   *      或者先在PW列表里搜好，再点「Collect Visible URLs」
   *   4. 点「Run OPEN: CLOSE→監査」
   *
   * B. CLOSED / CLOSE TOURNAMENT 页面：
   *   1. 打开 CLOSED / CLOSE 列表
   *   2. Prefix 填：【SPADIE season 41st】
   *   3. 抓URL
   *   4. 点「Run CLOSED: 監査だけ」
   *
   * 状态机：
   *   OPEN模式:
   *     进入比赛页 → submit CLOSE → 页面刷新 → submit 監査 → 页面刷新 → 下一个
   *
   *   CLOSED模式:
   *     进入比赛页 → submit 監査 → 页面刷新 → 下一个
   *
   ********************************************************************/

  const APP = {
    name: 'PW-CLOSE-AUDIT-BATCH',
    version: '0.2.0',

    // 沿用你之前 URL Manager 的共享 Cache Key
    sharedCacheKey: 'PW_SHARED_TOURNAMENT_URL_CACHE_V1',

    inputKey: 'PW_CLOSE_AUDIT_INPUT_V02',
    prefixKey: 'PW_CLOSE_AUDIT_PREFIX_V02',
    reportKey: 'PW_CLOSE_AUDIT_REPORT_V02',
    jobKey: 'PW_CLOSE_AUDIT_JOB_V02',

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
    const key = norm(name);
    if (!key) return;

    const id = String(data.tournamentId || extractIdFromUrlLike(data.url) || '');
    const url = data.url ? String(data.url) : (id ? getRelativePanelUrl(id) : '');

    if (!id || !url) return;

    const cache = loadCache();

    cache[key] = {
      name: key,
      tournamentId: id,
      url: url.startsWith('http') ? new URL(url).pathname : url,
      actualName: String(data.actualName || data.name || key),
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

    return [
      headers.join('\t'),
      ...rows.map(r => headers.map(h => escTsv(r[h])).join('\t'))
    ].join('\n');
  }

  function showCache() {
    const prefix = norm(document.querySelector('#pwca-prefix')?.value || '');
    const tsv = cacheToTsv(prefix);
    const output = document.querySelector('#pwca-output');
    if (output) output.value = tsv;

    const count = cacheToRows(prefix).length;
    log(`Cache shown: ${count} 件 / prefix=${prefix || 'ALL'}`);
    appendReport('VIEW_CACHE', `${count} 件 / prefix=${prefix || 'ALL'}`);
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

      okCount++;
      appendReport('IMPORT_OK', `${name} → ${url}`);
    }

    localStorage.setItem(APP.inputKey, raw);
    showCache();

    alert(`Import 完了\nOK: ${okCount}\nNG: ${ngCount}`);
    log(`Import done: OK ${okCount} / NG ${ngCount}`);
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

  function getQueueFromCache(prefix) {
    const rows = cacheToRows(prefix)
      .map(r => ({
        name: r.Name || r.Actual_Name || r.URL,
        actualName: r.Actual_Name || r.Name || r.URL,
        tournamentId: String(r.TournamentId || extractIdFromUrlLike(r.URL) || ''),
        url: r.URL || (r.TournamentId ? getRelativePanelUrl(r.TournamentId) : ''),
        source: r.Source || ''
      }))
      .filter(x => x.tournamentId && x.url);

    const seen = new Set();
    return rows.filter(x => {
      const key = x.tournamentId;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => tournamentSortKey(a.name || a.actualName).localeCompare(tournamentSortKey(b.name || b.actualName), 'ja'));
  }

  function showJob() {
    const job = loadJob();
    const output = document.querySelector('#pwca-job-output');

    if (!output) return;

    if (!job) {
      output.value = 'No active job';
      return;
    }

    output.value = JSON.stringify(job, null, 2);
  }

  function startJob(mode) {
    const prefix = norm(document.querySelector('#pwca-prefix')?.value || '');
    const queue = getQueueFromCache(prefix);

    if (!queue.length) {
      alert(
        'Queue が空です。\n\n' +
        '先に URL をCacheしてください。\n' +
        '・Build Cache by Search\n' +
        '・Collect Visible URLs\n' +
        '・Import TSV'
      );
      return;
    }

    const modeLabel = mode === 'open_close_audit'
      ? 'OPEN模式：CLOSE → 監査'
      : 'CLOSED模式：監査だけ';

    const ok = confirm(
      `${modeLabel} を開始します。\n\n` +
      `Prefix: ${prefix || '(なし)'}\n` +
      `対象: ${queue.length} 件\n\n` +
      `本当に実行しますか？`
    );

    if (!ok) return;

    const job = {
      active: true,
      mode,
      prefix,
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
    appendReport('JOB_START', `${modeLabel} / ${queue.length} 件 / prefix=${prefix || 'なし'}`);
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

    const savedInput = localStorage.getItem(APP.inputKey) || [
      'Name\tTournamentId\tURL',
      '【SPADIE season 41st】#02 NLH Emotional Heart\t\t'
    ].join('\n');

    const savedPrefix = localStorage.getItem(APP.prefixKey) || '【SPADIE season 41st】';
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
        <div style="font-weight:700;">
          PW CLOSE/AUDIT Batch 私用 v0.2
        </div>
        <div style="display:flex;gap:4px;">
          <button id="pwca-minimize" style="font-size:11px;padding:2px 6px;cursor:pointer;">Min</button>
          <button id="pwca-close-panel" style="font-size:11px;padding:2px 6px;cursor:pointer;">×</button>
        </div>
      </div>

      <div id="${APP.bodyId}" style="display:block;overflow:auto;padding-right:2px;">

        <div style="font-size:11px;color:#ccc;line-height:1.4;margin-bottom:8px;">
          Cache key: <code>${APP.sharedCacheKey}</code><br>
          OPENリスト: CLOSE→監査 / CLOSEDリスト: 監査だけ
        </div>

        <div style="font-size:12px;font-weight:bold;">Event Prefix</div>
        <input id="pwca-prefix"
          style="width:100%;box-sizing:border-box;background:#111;color:#fff;border:1px solid #555;padding:7px;font-family:Consolas,monospace;font-size:12px;" />

        <div style="font-size:12px;font-weight:bold;margin-top:8px;">Input: Nameリスト or Name/TournamentId/URL TSV</div>
        <textarea id="pwca-input"
          style="width:100%;box-sizing:border-box;height:105px;background:#111;color:#fff;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

        <div style="display:flex;gap:6px;margin-top:8px;">
          <button id="pwca-build-cache"
            style="flex:1;padding:7px;cursor:pointer;background:#ffe08a;border:1px solid #c99;">
            Build Cache by Search
          </button>

          <button id="pwca-collect-visible"
            style="flex:1;padding:7px;cursor:pointer;background:#bff0c2;border:1px solid #8a8;">
            Collect Visible URLs
          </button>

          <button id="pwca-import"
            style="flex:1;padding:7px;cursor:pointer;background:#bff0c2;border:1px solid #8a8;">
            Import TSV
          </button>
        </div>

        <div style="display:flex;gap:6px;margin-top:8px;">
          <button id="pwca-run-open"
            style="flex:1;padding:8px;cursor:pointer;background:#ff7675;border:1px solid #d55;color:#fff;font-weight:700;">
            Run OPEN: CLOSE→監査
          </button>

          <button id="pwca-run-closed"
            style="flex:1;padding:8px;cursor:pointer;background:#636e72;border:1px solid #444;color:#fff;font-weight:700;">
            Run CLOSED: 監査だけ
          </button>
        </div>

        <div style="display:flex;gap:6px;margin-top:8px;">
          <button id="pwca-single-close-audit"
            style="flex:1;padding:7px;cursor:pointer;background:#fdcb6e;border:1px solid #c99;">
            Single CLOSE→監査
          </button>

          <button id="pwca-single-audit"
            style="flex:1;padding:7px;cursor:pointer;background:#74b9ff;border:1px solid #48a;">
            Single 監査だけ
          </button>

          <button id="pwca-debug-forms"
            style="flex:1;padding:7px;cursor:pointer;background:#0984e3;border:1px solid #067;color:#fff;">
            Debug Forms
          </button>
        </div>

        <div style="display:flex;gap:6px;margin-top:8px;">
          <button id="pwca-view-cache"
            style="flex:1;padding:7px;cursor:pointer;background:#d9ecff;border:1px solid #88a;">
            View Cache
          </button>

          <button id="pwca-copy-cache"
            style="flex:1;padding:7px;cursor:pointer;background:#d9ecff;border:1px solid #88a;">
            Copy Cache TSV
          </button>

          <button id="pwca-clear-event"
            style="flex:1;padding:7px;cursor:pointer;background:#f6d365;border:1px solid #caa;">
            Clear Event Cache
          </button>
        </div>

        <div style="display:flex;gap:6px;margin-top:8px;">
          <button id="pwca-stop-search"
            style="flex:1;padding:7px;cursor:pointer;background:#f3cccc;border:1px solid #c88;">
            Stop Search
          </button>

          <button id="pwca-stop-job"
            style="flex:1;padding:7px;cursor:pointer;background:#f3cccc;border:1px solid #c88;">
            Stop Job
          </button>

          <button id="pwca-clear-job"
            style="flex:1;padding:7px;cursor:pointer;background:#2d3436;border:1px solid #111;color:#fff;">
            Clear Job
          </button>
        </div>

        <div style="font-size:12px;font-weight:bold;margin-top:8px;">Cache TSV / Output</div>
        <textarea id="pwca-output"
          readonly
          style="width:100%;box-sizing:border-box;height:95px;background:#111;color:#fff;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

        <div style="font-size:12px;font-weight:bold;margin-top:8px;">Active Job</div>
        <textarea id="pwca-job-output"
          readonly
          style="width:100%;box-sizing:border-box;height:80px;background:#111;color:#ffd;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

        <div style="font-size:12px;font-weight:bold;margin-top:8px;">Report</div>
        <textarea id="pwca-report"
          readonly
          style="width:100%;box-sizing:border-box;height:100px;background:#111;color:#9fe;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

        <div style="display:flex;gap:6px;margin-top:8px;">
          <button id="pwca-copy-report"
            style="flex:1;padding:6px;cursor:pointer;background:#eee;border:1px solid #aaa;">
            Copy Report
          </button>

          <button id="pwca-clear-report"
            style="flex:1;padding:6px;cursor:pointer;background:#eee;border:1px solid #aaa;">
            Clear Report
          </button>

          <button id="pwca-clear-all-cache"
            style="flex:1;padding:6px;cursor:pointer;background:#f3cccc;border:1px solid #c88;">
            Clear All Cache
          </button>
        </div>

        <div id="pwca-status"
          style="font-size:11px;color:#9fe;line-height:1.35;white-space:pre-wrap;margin-top:8px;">
          ready
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    const prefixEl = document.querySelector('#pwca-prefix');
    const inputEl = document.querySelector('#pwca-input');
    const reportEl = document.querySelector('#pwca-report');

    prefixEl.value = savedPrefix;
    inputEl.value = savedInput;
    reportEl.value = savedReport;

    prefixEl.addEventListener('change', () => {
      localStorage.setItem(APP.prefixKey, prefixEl.value || '');
      showCache();
    });

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

    document.querySelector('#pwca-build-cache').onclick = () => buildCacheBySearch();
    document.querySelector('#pwca-collect-visible').onclick = () => collectVisibleUrlsToCache();
    document.querySelector('#pwca-import').onclick = () => importCacheFromTsv();

    document.querySelector('#pwca-run-open').onclick = () => startJob('open_close_audit');
    document.querySelector('#pwca-run-closed').onclick = () => startJob('closed_audit_only');

    document.querySelector('#pwca-single-close-audit').onclick = () => runSingleCloseAudit();
    document.querySelector('#pwca-single-audit').onclick = () => runSingleAuditOnly();
    document.querySelector('#pwca-debug-forms').onclick = () => debugForms();

    document.querySelector('#pwca-view-cache').onclick = () => showCache();

    document.querySelector('#pwca-copy-cache').onclick = () => {
      const prefix = norm(document.querySelector('#pwca-prefix')?.value || '');
      const tsv = cacheToTsv(prefix);
      copyText(tsv);
      alert(`Cache TSV copied: ${cacheToRows(prefix).length} 件`);
    };

    document.querySelector('#pwca-clear-event').onclick = () => {
      localStorage.setItem(APP.prefixKey, document.querySelector('#pwca-prefix')?.value || '');
      clearCurrentEventCache();
    };

    document.querySelector('#pwca-stop-search').onclick = () => {
      stopSearchRequested = true;
      appendReport('STOP_SEARCH_REQUEST', '現在の1件が終わったら停止');
      log('検索停止要求を出しました');
    };

    document.querySelector('#pwca-stop-job').onclick = () => requestStopJob();
    document.querySelector('#pwca-clear-job').onclick = () => hardClearJob();

    document.querySelector('#pwca-copy-report').onclick = () => {
      copyText(document.querySelector('#pwca-report')?.value || '');
      alert('Report copied');
    };

    document.querySelector('#pwca-clear-report').onclick = () => clearReport();
    document.querySelector('#pwca-clear-all-cache').onclick = () => clearAllCache();

    showCache();
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
      clearCurrentEventCache,
      clearAllCache,

      buildCacheBySearch,
      collectVisibleUrlsToCache,
      importCacheFromTsv,

      loadJob,
      saveJob,
      clearJob,
      showJob,
      startJob,
      requestStopJob,

      debugForms,
      runSingleCloseAudit,
      runSingleAuditOnly
    };
  }

  async function boot() {
    addPanel();
    exposeApi();

    log(`${APP.name} ${APP.version} ready / Cache count: ${getCacheCount()}`);

    const job = loadJob();

    if (job && job.active) {
      showJob();

      const currentId = getTournamentIdFromUrl();
      const item = getCurrentJobItem(job);

      // 1. 现在在比赛详情页：正常根据 step 继续处理
      if (currentId) {
        processJobOnTournamentPage().catch(e => {
          err('auto process failed', e);
          appendReport('AUTO_PROCESS_ERROR', e.message || String(e));
        });
        return;
      }

      // 2. 现在不在比赛详情页，通常是 CLOSE / 監査 后被 PW 踢回列表页
      appendReport(
        'RESUME_FROM_NON_PANEL',
        `step=${job.step} / index=${Number(job.index || 0) + 1}/${job.queue?.length || 0} / url=${location.href}`
      );

      // 2-A. 監査提交后飞回列表：视为当前比赛完成，直接进入下一场
      if (job.step === 'after_audit_reload') {
        appendReport(
          'DONE_ONE_FROM_LIST',
          `${Number(job.index || 0) + 1}/${job.queue.length} ${item?.name || item?.url || ''}`
        );
        markCurrentDoneAndNext(job, 'audit_done_from_list');
        return;
      }

      // 2-B. CLOSE 提交后飞回列表：回到当前比赛详情页，继续監査
      if (job.step === 'after_close_reload') {
        appendReport(
          'RETURN_FOR_AUDIT',
          `${Number(job.index || 0) + 1}/${job.queue.length} ${item?.name || item?.url || ''}`
        );
        goCurrentJobPage(job);
        return;
      }

      // 2-C. 普通 go / on_page 状态：进入当前目标比赛页
      if (job.step === 'go' || job.step === 'on_page') {
        goCurrentJobPage(job);
        return;
      }

      // 2-D. 未知状态：为安全起见，回当前比赛页继续判断
      appendReport('UNKNOWN_STEP_RETURN', `step=${job.step}`);
      goCurrentJobPage(job);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();