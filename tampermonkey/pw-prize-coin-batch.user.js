// ==UserScript==
// @name         PW Prize Coin Batch
// @namespace    https://japanopt.bt.pokerweb.com.br/
// @version      0.4.1
// @description  TSVを唯一の支払基準として、複数大会の未払いPrizeを照合しPW Coinを一件ずつ付与します。
// @match        https://japanopt.bt.pokerweb.com.br/*
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-prize-coin-batch.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-prize-coin-batch.user.js
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const APP = {
    version: '0.4.0',
    panelId: 'pw-prize-coin-batch-panel',
    inputKey: 'PW_PRIZE_COIN_BATCH_INPUT_V1',
    scopeKey: 'PW_PRIZE_COIN_BATCH_SCOPE_V1',
    urlCacheKey: 'PW_SHARED_TOURNAMENT_URL_CACHE_V1',
    recordInfoUrl: '/torneio/abas/registros/informacoes',
    cashierDataUrl: '/torneio/abas/caixa/dados_caixa',
    sendCoinUrl: '/torneio/abas/caixa/envio_moedas',
    listPages: [
      { label: 'OPEN', path: '/torneio/abertos' },
    ],
    waitMs: 25000,
    pollMs: 250,
    betweenPaymentsMs: 700
  };

  const state = {
    running: false,
    stopRequested: false,
    inputHash: '',
    tasks: [],
    skipped: [],
    parseErrors: [],
    urlEntries: [],
    preflightComplete: false,
    manualCancel: null
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function norm(value) {
    return String(value == null ? '' : value)
      .replace(/\u3000/g, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t\r\n]+/g, ' ')
      .trim();
  }

  function strictTournamentName(value) {
    return norm(value);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function yen(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `¥${Math.round(number).toLocaleString('ja-JP')}` : '';
  }

  function formatGameId(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length === 8 ? `${digits.slice(0, 4)}.${digits.slice(4)}` : String(value || '');
  }

  function digitsGameId(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length === 8 ? digits : '';
  }

  function inputHash(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function tokyoDate() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  }

  function parseYenInteger(value, { blankAsZero = false } = {}) {
    const raw = norm(value);
    if (!raw) return blankAsZero ? 0 : NaN;
    const negative = /^[-−]|^\(.*\)$/.test(raw);
    const cleaned = raw.replace(/[¥￥,，\s()]/g, '').replace(/^\+/, '');
    if (!/^\d+$/.test(cleaned)) return NaN;
    const number = Number(cleaned);
    if (!Number.isSafeInteger(number)) return NaN;
    return negative ? -number : number;
  }

  function findHeaderRow(rows) {
    return rows.findIndex(cols => {
      const headers = cols.map(norm);
      return headers.includes('# Tournament') &&
        headers.includes('Transfer Method') &&
        headers.includes('未履行prize') &&
        headers.filter(header => header === 'GameID').length >= 2;
    });
  }

  function parseInput(raw) {
    const rows = String(raw || '')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map(line => line.split('\t'));
    const headerRowIndex = findHeaderRow(rows);
    if (headerRowIndex < 0) {
      throw new Error('表頭が見つかりません。# Tournament / Transfer Method / 2つのGameID / 未履行prize が必要です。');
    }

    const headers = rows[headerRowIndex].map(norm);
    const tournamentIndex = headers.indexOf('# Tournament');
    const transferIndex = headers.indexOf('Transfer Method');
    const pendingIndex = headers.indexOf('未履行prize');
    const placeIndex = headers.indexOf('Place');
    const noteIndex = headers.indexOf('Note');
    const nameIndex = headers.indexOf('Family Name / Given Name');
    const nickIndex = headers.indexOf('Nick Name');
    const gameIndexes = headers
      .map((header, index) => header === 'GameID' ? index : -1)
      .filter(index => index >= 0);
    const gameIndex = gameIndexes[gameIndexes.length - 1];

    const grouped = new Map();
    const skipped = [];
    const errors = [];

    for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const cols = rows[rowIndex];
      if (!cols.some(value => norm(value))) continue;
      const line = rowIndex + 1;
      const tournamentName = strictTournamentName(cols[tournamentIndex]);
      const transferMethod = norm(cols[transferIndex]).toUpperCase();
      const gameId = digitsGameId(cols[gameIndex]);
      const pendingAmount = parseYenInteger(cols[pendingIndex], { blankAsZero: false });
      const place = norm(cols[placeIndex]);
      const note = norm(cols[noteIndex]);
      const playerName = norm(cols[nameIndex]);
      const nickName = norm(cols[nickIndex]);

      if (transferMethod !== 'POKERWEB COIN') {
        skipped.push({
          line,
          tournamentName,
          gameId,
          place,
          amount: Number.isFinite(pendingAmount) ? pendingAmount : '',
          status: 'SKIP',
          reason: transferMethod ? `Transfer Method=${transferMethod}` : 'Transfer Method blank'
        });
        continue;
      }
      if (!tournamentName) {
        errors.push(`${line}行目: C列 # Tournament が空です。`);
        continue;
      }
      if (!gameId) {
        errors.push(`${line}行目: PW付与必要項目側のGameIDが8桁ではありません。`);
        continue;
      }
      if (!Number.isSafeInteger(pendingAmount) || pendingAmount < 0) {
        errors.push(`${line}行目: 未履行prize が0以上の整数ではありません。`);
        continue;
      }
      if (pendingAmount === 0) {
        skipped.push({
          line,
          tournamentName,
          gameId,
          place,
          amount: 0,
          status: 'SKIP',
          reason: '未履行prize=0'
        });
        continue;
      }

      const key = `${tournamentName}\u0000${gameId}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          tournamentName,
          gameId,
          formattedGameId: formatGameId(gameId),
          expectedAmount: 0,
          playerName,
          nickName,
          components: [],
          sourceLines: [],
          status: 'PARSED',
          error: '',
          urlSource: '',
          tournamentId: '',
          tournamentUrl: '',
          actualTournamentName: '',
          internalPlayerId: '',
          pwGameId: '',
          pwPending: NaN,
          pwConfirmed: NaN,
          pwPaid: NaN,
          result: ''
        });
      }
      const task = grouped.get(key);
      task.expectedAmount += pendingAmount;
      task.sourceLines.push(line);
      task.components.push({ line, place, amount: pendingAmount, note });
      if (!task.playerName && playerName) task.playerName = playerName;
      if (!task.nickName && nickName) task.nickName = nickName;
    }

    return {
      headerRowIndex,
      tasks: [...grouped.values()],
      skipped,
      errors
    };
  }

  function readSharedCache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(APP.urlCacheKey) || '{}');
      if (!parsed || typeof parsed !== 'object') return [];
      return Object.values(parsed)
        .map(entry => normalizeUrlEntry(entry, 'URL MANAGER'))
        .filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  function writeSharedCache(entries, source) {
    let cache = {};
    try {
      const parsed = JSON.parse(localStorage.getItem(APP.urlCacheKey) || '{}');
      if (parsed && typeof parsed === 'object') cache = parsed;
    } catch (_) {}
    for (const entry of entries) {
      const key = `${entry.actualName}||${entry.tournamentId}`;
      cache[key] = {
        name: entry.actualName,
        actualName: entry.actualName,
        tournamentId: entry.tournamentId,
        url: entry.url,
        painelUrl: entry.url,
        matchedRow: entry.matchedRow || '',
        savedAt: tokyoDate(),
        source
      };
    }
    localStorage.setItem(APP.urlCacheKey, JSON.stringify(cache));
  }

  function cNameFromActual(actualName) {
    return strictTournamentName(String(actualName || '').replace(/^【[^】]+】\s*/, ''));
  }

  function normalizeUrlEntry(entry, source) {
    if (!entry || typeof entry !== 'object') return null;
    const tournamentId = String(entry.tournamentId || '').replace(/\D/g, '');
    const urlValue = entry.url || entry.painelUrl || '';
    const urlMatch = String(urlValue).match(/\/torneio\/painel\/(\d+)/);
    const id = tournamentId || (urlMatch && urlMatch[1]) || '';
    const actualName = strictTournamentName(entry.actualName || entry.name || '');
    if (!id || !actualName) return null;
    return {
      tournamentId: id,
      url: `/torneio/painel/${id}`,
      actualName,
      cName: cNameFromActual(actualName),
      matchedRow: norm(entry.matchedRow || ''),
      source: source || entry.source || 'CACHE'
    };
  }

  function inEventScope(entry, scope) {
    const wanted = norm(scope);
    if (!wanted) return true;
    return entry.actualName.includes(wanted) || entry.matchedRow.includes(wanted);
  }

  function uniqueEntries(entries) {
    const byId = new Map();
    for (const entry of entries) {
      if (!entry || !entry.tournamentId) continue;
      if (!byId.has(entry.tournamentId)) byId.set(entry.tournamentId, entry);
    }
    return [...byId.values()];
  }

  function findExactUrlMatches(entries, cName, scope) {
    const wanted = strictTournamentName(cName);
    return uniqueEntries(entries).filter(entry =>
      inEventScope(entry, scope) && strictTournamentName(entry.cName) === wanted
    );
  }

  function findManualUrlMatches(entries, pastedName, scope) {
    const wanted = strictTournamentName(pastedName);
    if (!wanted) return [];
    const scoped = uniqueEntries(entries).filter(entry => inEventScope(entry, scope));
    const actualMatches = scoped.filter(entry => strictTournamentName(entry.actualName) === wanted);
    if (actualMatches.length) return actualMatches;
    const wantedCName = cNameFromActual(wanted);
    return scoped.filter(entry => strictTournamentName(entry.cName) === wantedCName);
  }

  function requestManualUrlMatch(entries, cName, scope) {
    const box = document.querySelector('#pwpcb-manual');
    const context = document.querySelector('#pwpcb-manual-context');
    const input = document.querySelector('#pwpcb-manual-input');
    const error = document.querySelector('#pwpcb-manual-error');
    const confirmButton = document.querySelector('#pwpcb-manual-confirm');
    const cancelButton = document.querySelector('#pwpcb-manual-cancel');
    const panel = document.getElementById(APP.panelId);
    const minButton = document.querySelector('#pwpcb-min');
    if (!box || !context || !input || !error || !confirmButton || !cancelButton) {
      return Promise.resolve({ entry: null, error: 'Manual Tournament selection UI not found' });
    }

    panel?.classList.remove('min');
    if (minButton) minButton.textContent = '−';
    context.textContent = `C列: ${cName} / Event Scope: ${norm(scope) || '(未指定)'}`;
    input.value = cName;
    error.textContent = '';
    box.hidden = false;
    input.focus();
    input.select();

    return new Promise(resolve => {
      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        box.hidden = true;
        confirmButton.onclick = null;
        cancelButton.onclick = null;
        state.manualCancel = null;
        resolve(result);
      };

      confirmButton.onclick = () => {
        const pastedName = strictTournamentName(input.value);
        error.textContent = '';
        if (!pastedName) {
          error.textContent = '大会名が空です。OPEN大会一覧の表示名を貼り付けてください。';
          input.focus();
          return;
        }
        const matches = findManualUrlMatches(entries, pastedName, scope);
        if (matches.length === 1) {
          finish({
            entry: { ...matches[0], source: `MANUAL ${matches[0].source}` },
            error: ''
          });
          return;
        }
        if (matches.length > 1) {
          error.textContent = `複数一致しました（Tournament ID: ${matches.map(item => item.tournamentId).join(', ')}）。【Event名】を含む完全名を貼り付けてください。`;
          return;
        }
        error.textContent = `OPENスキャン結果に見つかりません: ${pastedName}`;
      };
      cancelButton.onclick = () => finish({
        entry: null,
        error: 'Tournament URL manual selection cancelled'
      });
      state.manualCancel = () => finish({
        entry: null,
        error: 'Tournament URL manual selection cancelled by STOP'
      });
    });
  }

  function isVisible(win, element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = win.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  function dataTable(win) {
    try {
      if (!win.jQuery || !win.jQuery.fn || !win.jQuery.fn.dataTable) return null;
      for (const table of Array.from(win.jQuery.fn.dataTable.tables() || [])) {
        if (!win.jQuery.fn.DataTable.isDataTable(table)) continue;
        const dt = win.jQuery(table).DataTable();
        if (dt) return dt;
      }
    } catch (_) {}
    return null;
  }

  function dataTableNode(dt) {
    try { return dt && dt.table && dt.table().node(); } catch (_) { return null; }
  }

  function rowsForRead(win, dt) {
    try {
      const node = dataTableNode(dt);
      const root = node || win.document;
      return [...root.querySelectorAll('tbody tr')]
        .filter(row => String(row.innerHTML || '').includes('/torneio/painel/'));
    } catch (_) {}
    return [];
  }

  function cleanTournamentName(value) {
    return norm(value)
      .replace(/\s*-\s*PokerWeb\s*$/i, '')
      .replace(/\s*監査(?:済み|待ち)\s*$/g, '');
  }

  function extractTournamentTitleFromRow(rowText) {
    let text = norm(rowText);
    const match = text.match(/(【[^】]+】\s*(?:#\d+[A-Za-z]?|\(s\d+\)|s\d+)\s+.+?)(?:\s+\d{1,2}\/\d{1,2}\/\d{4}|\s+Aberto|\s+Fechado|\s+オープン|\s+クローズ|$)/i);
    if (match) return cleanTournamentName(match[1]);
    const fallback = text.match(/(【[^】]+】.+?)(?:\s+\d{1,2}\/\d{1,2}\/\d{4}|\s+Aberto|\s+Fechado|$)/i);
    if (fallback) return cleanTournamentName(fallback[1]);
    text = text
      .replace(/^アクション\s+/i, '')
      .replace(/^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s+/, '')
      .replace(/\s+\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}$/, '')
      .replace(/\s+(?:Aberto|Fechado|オープン|クローズ)$/i, '');
    return cleanTournamentName(text);
  }

  function extractTournamentFromRow(row, source) {
    const html = row.innerHTML || '';
    const match = html.match(/\/torneio\/painel\/(\d+)/);
    if (!match) return null;
    const matchedRow = norm(row.innerText || row.textContent || '');
    const actualName = extractTournamentTitleFromRow(matchedRow);
    if (!actualName) return null;
    return {
      tournamentId: match[1],
      url: `/torneio/painel/${match[1]}`,
      actualName,
      cName: cNameFromActual(actualName),
      matchedRow,
      source
    };
  }

  async function waitFor(check, timeoutMs, label) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const result = check();
      if (result) return result;
      await sleep(APP.pollMs);
    }
    throw new Error(`${label || 'condition'} timeout`);
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
        try { win.jQuery(node).off('draw.dt', onDraw); } catch (_) {}
        resolve(ok);
      };
      const onDraw = () => finish(true);
      const timer = win.setTimeout(() => finish(false), APP.waitMs);
      try { win.jQuery(node).one('draw.dt', onDraw); } catch (_) { finish(false); }
    });
  }

  function isDataTableProcessing(win, dt) {
    try {
      const container = dt.table().container();
      const processing = container
        ? container.querySelector('.dataTables_processing')
        : win.document.querySelector('.dataTables_processing');
      return processing ? isVisible(win, processing) : false;
    } catch (_) {
      const processing = win.document.querySelector('.dataTables_processing');
      return processing ? isVisible(win, processing) : false;
    }
  }

  async function waitForProcessingGone(win, dt, timeoutMs = APP.waitMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (!isDataTableProcessing(win, dt)) return true;
      await sleep(100);
    }
    return false;
  }

  async function searchDataTableAndWait(win, dt, keyword) {
    if (!await waitForProcessingGone(win, dt)) {
      throw new Error('DataTable initial processing timeout');
    }
    dt.page.len(100);
    dt.search(norm(keyword));
    dt.page(0);
    const draw = waitDraw(win, dt);
    dt.draw();
    if (!await draw) throw new Error('DataTable search draw timeout');
    if (!await waitForProcessingGone(win, dt)) {
      throw new Error('DataTable search processing timeout');
    }
    await sleep(150);
    const info = dt.page.info();
    if (Number(info.page) !== 0) {
      throw new Error(`DataTable search page mismatch: expected=1 actual=${Number(info.page) + 1}`);
    }
    return info;
  }

  async function goTablePage(win, dt, page) {
    const current = Number(dt.page.info().page || 0);
    if (current === page) {
      if (!await waitForProcessingGone(win, dt)) {
        throw new Error(`DataTable page ${page + 1} processing timeout`);
      }
      return;
    }
    const draw = waitDraw(win, dt);
    dt.page(page).draw('page');
    if (!await draw) throw new Error(`DataTable page ${page + 1} draw timeout`);
    if (!await waitForProcessingGone(win, dt)) {
      throw new Error(`DataTable page ${page + 1} processing timeout`);
    }
    await sleep(150);
    const actual = Number(dt.page.info().page || 0);
    if (actual !== page) throw new Error(`DataTable page mismatch: expected=${page + 1} actual=${actual + 1}`);
  }

  async function scanListPage(page, scope) {
    const searchTerm = norm(scope);
    setStatus(`${page.label} tournament search: ${searchTerm || '(all)'}`);
    const iframe = document.createElement('iframe');
    iframe.src = page.path;
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;left:-20000px;top:0;width:1280px;height:900px;visibility:hidden;pointer-events:none;';
    document.body.appendChild(iframe);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${page.label} iframe load timeout`)), APP.waitMs);
        iframe.addEventListener('load', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
      const win = iframe.contentWindow;
      const dt = await waitFor(() => dataTable(win), APP.waitMs, `${page.label} DataTable`);
      const info = await searchDataTableAndWait(win, dt, searchTerm);
      const pages = Math.max(1, Number(info.pages || 1));
      const found = [];
      for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
        if (state.stopRequested) throw new Error('STOP requested');
        await goTablePage(win, dt, pageIndex);
        setStatus(`${page.label} tournament scan ${pageIndex + 1}/${pages}: ${searchTerm || '(all)'}`);
        for (const row of rowsForRead(win, dt)) {
          const entry = extractTournamentFromRow(row, `${page.label}-p${pageIndex + 1}`);
          if (entry) found.push(entry);
        }
      }
      return uniqueEntries(found);
    } finally {
      iframe.remove();
    }
  }

  async function scanAllTournamentLists(scope) {
    const entries = [];
    for (const page of APP.listPages) {
      entries.push(...await scanListPage(page, scope));
    }
    const unique = uniqueEntries(entries);
    writeSharedCache(unique, 'prize-coin-built-in-scan');
    return unique;
  }

  async function requestText(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`${options.method || 'GET'} ${url}: HTTP ${response.status}`);
      error.status = response.status;
      error.statusText = response.statusText;
      error.textPreview = text.slice(0, 1200);
      throw error;
    }
    return { response, text };
  }

  function parseHtml(html) {
    return new DOMParser().parseFromString(String(html || ''), 'text/html');
  }

  async function fetchRegistroInformacoesDoc(tournamentId) {
    const { text } = await requestText(APP.recordInfoUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: new URLSearchParams({ id_torneio: String(tournamentId) })
    });
    const doc = parseHtml(text);
    doc.__pwRecordRawHtml = text;
    return doc;
  }

  async function fetchTournamentPanelDoc(task) {
    const { text } = await requestText(new URL(task.tournamentUrl, location.origin).href);
    return parseHtml(text);
  }

  function pageTitleCandidates(doc) {
    const values = [];
    const add = value => {
      const text = norm(value).replace(/\s*-\s*PokerWeb\s*$/i, '');
      if (text && !values.includes(text)) values.push(text);
    };
    add(doc.querySelector('input[name="titulo_torneio"]')?.value);
    for (const element of doc.querySelectorAll('h1,h2,.page-title,.box-title,.panel-title,.breadcrumb')) {
      add(element.textContent);
    }
    add(doc.title);
    return values;
  }

  function verifyPanelTournament(doc, expectedCName, scope) {
    const cName = strictTournamentName(expectedCName);
    const candidates = pageTitleCandidates(doc);
    const matches = candidates.filter(value => {
      const scopeOk = !norm(scope) || value.includes(norm(scope));
      return scopeOk && (strictTournamentName(value) === cName || strictTournamentName(value).endsWith(cName));
    });
    if (!matches.length) {
      throw new Error(`Tournament page title mismatch: expected=${cName} / actual=${candidates.slice(0, 4).join(' | ')}`);
    }
    return matches[0];
  }

  function resolvedTournamentName(task) {
    return cNameFromActual(task?.actualTournamentName || '') || strictTournamentName(task?.tournamentName || '');
  }

  function parseLooseNumber(value) {
    const text = norm(value).replace(/[¥￥,，\s]/g, '');
    const match = text.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : NaN;
  }

  function recordColumnIndex(table, labels) {
    const wanted = labels.map(norm);
    for (const cell of table.querySelectorAll('thead th, thead td')) {
      const text = norm(cell.textContent);
      if (wanted.some(label => text === label || text.includes(label))) {
        return Number(cell.cellIndex);
      }
    }
    return -1;
  }

  function recordAmount(row, columnIndex, label) {
    if (columnIndex < 0) throw new Error(`${label} column not found in tournament records`);
    const cell = row.children[columnIndex];
    if (!cell) throw new Error(`${label} cell not found in tournament record row`);
    const amount = parseLooseNumber(cell.textContent);
    if (!Number.isFinite(amount)) throw new Error(`${label} is not numeric: ${norm(cell.textContent)}`);
    return amount;
  }

  function tournamentRecordTables(doc) {
    return [...doc.querySelectorAll('table')].filter(table =>
      [...table.querySelectorAll('thead th, thead td')]
        .some(cell => norm(cell.textContent).includes('未払いのプライズ'))
    );
  }

  function tournamentRecordRows(doc, win) {
    const rows = [];
    const seen = new Set();
    const add = row => {
      if (!row || seen.has(row)) return;
      seen.add(row);
      rows.push(row);
    };
    for (const table of tournamentRecordTables(doc)) {
      [...table.querySelectorAll('tbody tr')].forEach(add);
      try {
        if (win?.jQuery?.fn?.DataTable?.isDataTable(table)) {
          win.jQuery(table).DataTable().rows().nodes().each(add);
        }
      } catch (_) {}
    }
    return rows;
  }

  function readTournamentRecordSnapshot(doc, task, win = null) {
    const expectedFormatted = formatGameId(task.gameId);
    const candidates = tournamentRecordRows(doc, win).filter(row => {
      const hasExactGameIdCell = [...row.children].some(cell => norm(cell.textContent) === expectedFormatted);
      const gear = row.querySelector('[onclick*="abrirCadastro("]');
      return hasExactGameIdCell && Boolean(gear);
    });
    if (candidates.length !== 1) {
      throw new Error(candidates.length
        ? `Tournament record GameID is not unique: ${expectedFormatted} (${candidates.length} rows)`
        : `Tournament record GameID not found: ${expectedFormatted}`);
    }

    const row = candidates[0];
    const table = row.closest('table');
    if (!table) throw new Error(`Tournament record table not found: ${expectedFormatted}`);
    const gear = row.querySelector('[onclick*="abrirCadastro("]');
    const onclick = gear?.getAttribute('onclick') || '';
    const call = onclick.match(/abrirCadastro\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (!call) throw new Error(`abrirCadastro parameters not found: ${expectedFormatted}`);
    const internalPlayerId = call[1];
    const tournamentId = call[2];
    const prizeOrigin = call[3];
    if (String(tournamentId) !== String(task.tournamentId)) {
      throw new Error(`Tournament ID mismatch in record: expected=${task.tournamentId} / row=${tournamentId}`);
    }
    if (prizeOrigin !== '1') {
      throw new Error(`Prize origin mismatch in record: expected=1 / row=${prizeOrigin}`);
    }

    const confirmedIndex = recordColumnIndex(table, ['確定したアワード']);
    const paidIndex = recordColumnIndex(table, ['支払い済みのプライズ']);
    const pendingIndex = recordColumnIndex(table, ['未払いのプライズ']);
    return {
      gameId: task.gameId,
      formattedGameId: expectedFormatted,
      internalPlayerId,
      tournamentId,
      prizeOrigin,
      confirmed: recordAmount(row, confirmedIndex, '確定したアワード'),
      paid: recordAmount(row, paidIndex, '支払い済みのプライズ'),
      pending: recordAmount(row, pendingIndex, '未払いのプライズ')
    };
  }

  async function fetchTournamentRecordSnapshot(task) {
    const recordDoc = await fetchRegistroInformacoesDoc(task.tournamentId);
    return readTournamentRecordSnapshot(recordDoc, task);
  }

  function applySnapshot(task, snapshot) {
    task.pwGameId = snapshot.formattedGameId;
    task.internalPlayerId = snapshot.internalPlayerId;
    task.pwPending = snapshot.pending;
    task.pwConfirmed = snapshot.confirmed;
    task.pwPaid = snapshot.paid;
  }

  async function resolveTournamentUrls(tasks, scope) {
    const cachedEntries = readSharedCache();
    setStatus('OPEN Tournament scan... URL Manager cache will be cross-checked.');
    const openEntries = await scanAllTournamentLists(scope);
    const cachedById = new Map(cachedEntries.map(entry => [String(entry.tournamentId), entry]));
    const entries = openEntries.map(entry => {
      const cached = cachedById.get(String(entry.tournamentId));
      if (!cached || cached.actualName !== entry.actualName) return entry;
      return { ...entry, source: 'URL MANAGER + OPEN CHECK' };
    });
    state.urlEntries = entries;
    const manualResolutionByName = new Map();

    for (const task of tasks) {
      let matches = findExactUrlMatches(entries, task.tournamentName, scope);
      if (matches.length === 0) {
        if (!manualResolutionByName.has(task.tournamentName)) {
          setStatus(`Manual Tournament selection: ${task.tournamentName}`);
          for (const pending of tasks.filter(item => item.tournamentName === task.tournamentName)) {
            pending.status = 'MANUAL REQUIRED';
            pending.error = '';
          }
          render();
          manualResolutionByName.set(
            task.tournamentName,
            await requestManualUrlMatch(entries, task.tournamentName, scope)
          );
        }
        const manual = manualResolutionByName.get(task.tournamentName);
        if (!manual.entry) {
          task.status = 'ERROR';
          task.error = manual.error;
          continue;
        }
        matches = [manual.entry];
      }
      if (matches.length > 1) {
        task.status = 'ERROR';
        task.error = `Tournament URL multiple matches: ${matches.map(item => item.tournamentId).join(',')}`;
        continue;
      }
      const entry = matches[0];
      task.tournamentId = entry.tournamentId;
      task.tournamentUrl = entry.url;
      task.actualTournamentName = entry.actualName;
      task.urlSource = entry.source;
      task.status = 'URL OK';
    }
  }

  function preflightTaskFromDoc(task, recordDoc, recordCount) {
    const snapshot = readTournamentRecordSnapshot(recordDoc, task);
    applySnapshot(task, snapshot);
    task.pwRecordCount = recordCount;
    if (!Number.isSafeInteger(snapshot.pending)) {
      throw new Error(`PW pending is not an integer: ${snapshot.pending}`);
    }
    if (snapshot.pending !== task.expectedAmount) {
      throw new Error(`Amount mismatch: TSV=${task.expectedAmount} / PW pending=${snapshot.pending}`);
    }
    task.status = 'READY';
    task.error = '';
  }

  async function preflightTournament(tasks, scope) {
    const first = tasks[0];
    const [recordDoc, panelDoc] = await Promise.all([
      fetchRegistroInformacoesDoc(first.tournamentId),
      fetchTournamentPanelDoc(first)
    ]);
    verifyPanelTournament(panelDoc, resolvedTournamentName(first), scope);
    const recordCount = tournamentRecordRows(recordDoc, null).filter(row =>
      row.querySelector('[onclick*="abrirCadastro("]')
    ).length;
    if (!recordCount) throw new Error('Tournament records API returned no prize-player rows');

    for (const task of tasks) {
      try {
        preflightTaskFromDoc(task, recordDoc, recordCount);
      } catch (error) {
        task.pwRecordCount = recordCount;
        task.status = 'ERROR';
        task.error = error.message || String(error);
      }
    }
  }

  async function runPreflight() {
    if (state.running) return;
    const raw = document.querySelector('#pwpcb-input')?.value || '';
    const scope = norm(document.querySelector('#pwpcb-scope')?.value || '');
    localStorage.setItem(APP.inputKey, raw);
    localStorage.setItem(APP.scopeKey, scope);
    state.running = true;
    state.stopRequested = false;
    state.preflightComplete = false;
    updateButtons();
    try {
      const parsed = parseInput(raw);
      state.tasks = parsed.tasks;
      state.skipped = parsed.skipped;
      state.parseErrors = parsed.errors;
      state.inputHash = inputHash(`${scope}\n${raw}`);
      render();
      if (parsed.errors.length) {
        setStatus(`TSV ERROR: ${parsed.errors.length}. Fix input before CHECK.`, true);
        return;
      }
      if (!parsed.tasks.length) {
        setStatus('No payable POKERWEB COIN task found.', true);
        return;
      }

      await resolveTournamentUrls(state.tasks, scope);
      render();
      const groups = [...new Set(state.tasks
        .filter(task => task.status !== 'ERROR')
        .map(task => String(task.tournamentId)))];
      for (let index = 0; index < groups.length; index += 1) {
        if (state.stopRequested) break;
        const tournamentId = groups[index];
        const tasks = state.tasks.filter(task => String(task.tournamentId) === tournamentId && task.status !== 'ERROR');
        if (!tasks.length) continue;
        setStatus(`CHECK ${index + 1}/${groups.length}: ${tasks[0].tournamentName} / TSV ${tasks.length}人`);
        try {
          await preflightTournament(tasks, scope);
        } catch (error) {
          for (const task of tasks) {
            task.status = 'ERROR';
            task.error = error.message || String(error);
          }
        }
        render();
      }
      state.preflightComplete = !state.stopRequested;
      const ready = state.tasks.filter(task => task.status === 'READY');
      const errors = state.tasks.filter(task => task.status === 'ERROR');
      setStatus(`${state.stopRequested ? 'STOPPED' : 'CHECK DONE'}: READY=${ready.length} ERROR=${errors.length} SKIP=${state.skipped.length}`, errors.length > 0);
    } catch (error) {
      setStatus(`CHECK failed: ${error.message || error}`, true);
    } finally {
      state.running = false;
      updateButtons();
      render();
    }
  }

  function replaceHtmlAndRunScripts(container, html) {
    container.innerHTML = html;
    for (const oldScript of [...container.querySelectorAll('script')]) {
      const script = document.createElement('script');
      for (const attr of [...oldScript.attributes]) script.setAttribute(attr.name, attr.value);
      script.textContent = oldScript.textContent || '';
      oldScript.parentNode.replaceChild(script, oldScript);
    }
  }

  async function fetchCashierHtml(task) {
    const { text } = await requestText(APP.cashierDataUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: new URLSearchParams({
        id_jogador: String(task.internalPlayerId),
        id_torneio: String(task.tournamentId),
        premiacao_origem: '1'
      })
    });
    return text;
  }

  function paymentFormFromDoc(doc, internalPlayerId = '', tournamentId = '', options = {}) {
    const forms = doc.forms ? [...doc.forms] : [...doc.querySelectorAll('form')];
    return forms.find(form => {
      const action = new URL(form.action || '', location.origin);
      const playerId = norm(form.querySelector('[name="id_jogador"]')?.value);
      const formTournamentId = norm(form.querySelector('[name="id_torneio"]')?.value);
      const playerOk = !internalPlayerId ||
        playerId === String(internalPlayerId) ||
        (options.allowBlankPlayerId && !playerId);
      const tournamentOk = !tournamentId ||
        formTournamentId === String(tournamentId) ||
        (options.allowBlankTournamentId && !formTournamentId);
      return action.origin === location.origin &&
        action.pathname === APP.sendCoinUrl &&
        playerOk &&
        tournamentOk;
    }) || null;
  }

  function validateCashierHtmlForTask(html, task) {
    const doc = parseHtml(html);
    const playerIds = [...doc.querySelectorAll('[name="id_jogador"]')].map(el => norm(el.value)).filter(Boolean);
    const tournamentIds = [...doc.querySelectorAll('[name="id_torneio"]')].map(el => norm(el.value)).filter(Boolean);
    if (playerIds.length && !playerIds.includes(String(task.internalPlayerId))) {
      throw new Error(`dados_caixa player mismatch: expected=${task.internalPlayerId} / actual=${playerIds.join(',')}`);
    }
    if (tournamentIds.length && !tournamentIds.includes(String(task.tournamentId))) {
      throw new Error(`dados_caixa tournament mismatch: expected=${task.tournamentId} / actual=${tournamentIds.join(',')}`);
    }
    return doc;
  }

  async function openCashierContextViaData(task, scope) {
    const cashierHtml = await fetchCashierHtml(task);
    validateCashierHtmlForTask(cashierHtml, task);
    const iframe = document.createElement('iframe');
    iframe.src = new URL(task.tournamentUrl, location.origin).href;
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;left:-20000px;top:0;width:1280px;height:900px;opacity:0;pointer-events:none;';
    document.body.appendChild(iframe);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Cashier token page load timeout: ${task.tournamentName}`)), APP.waitMs);
        iframe.addEventListener('load', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
      const win = iframe.contentWindow;
      const doc = iframe.contentDocument;
      if (!win || !doc) throw new Error(`Cashier token iframe inaccessible: ${task.tournamentName}`);
      verifyPanelTournament(doc, resolvedTournamentName(task), scope);
      const form = paymentFormFromDoc(doc, '', task.tournamentId, {
        allowBlankPlayerId: true,
        allowBlankTournamentId: true
      });
      if (!form) throw new Error(`Cashier payment form(token page): ${task.formattedGameId}`);
      if (String(form.method || '').toLowerCase() !== 'post') {
        throw new Error(`Cashier payment form method is not POST: ${form.method}`);
      }
      const valueInput = form.querySelector('[name="valor"]');
      const codbloqInput = form.querySelector('[name="codbloq"]');
      if (!valueInput) throw new Error('Cashier payment form valor not found');
      if (!norm(codbloqInput?.value)) throw new Error('Cashier payment form codbloq not found');
      return { cleanup: () => iframe.remove(), iframe, win, doc, form, valueInput, codbloqInput, source: 'iframe-token+dados_caixa' };
    } catch (error) {
      iframe.remove();
      throw error;
    }
  }

  async function openCashierContextViaIframe(task, scope) {
    const iframe = document.createElement('iframe');
    iframe.src = new URL(task.tournamentUrl, location.origin).href;
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;left:-20000px;top:0;width:1280px;height:900px;opacity:0;pointer-events:none;';
    document.body.appendChild(iframe);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Cashier page load timeout: ${task.tournamentName}`)), APP.waitMs);
        iframe.addEventListener('load', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
      const win = iframe.contentWindow;
      const doc = iframe.contentDocument;
      if (!win || !doc) throw new Error(`Cashier iframe inaccessible: ${task.tournamentName}`);
      verifyPanelTournament(doc, resolvedTournamentName(task), scope);
      const abrirCadastro = await waitFor(
        () => typeof win.abrirCadastro === 'function' ? win.abrirCadastro : null,
        APP.waitMs,
        `abrirCadastro: ${task.tournamentName}`
      );
      abrirCadastro.call(win, Number(task.internalPlayerId), Number(task.tournamentId), 1);
      const form = await waitFor(
        () => paymentFormFromDoc(doc, '', task.tournamentId, {
          allowBlankPlayerId: true,
          allowBlankTournamentId: true
        }),
        APP.waitMs,
        `Cashier payment form: ${task.formattedGameId}`
      );
      if (String(form.method || '').toLowerCase() !== 'post') {
        throw new Error(`Cashier payment form method is not POST: ${form.method}`);
      }
    const valueInput = form.querySelector('[name="valor"]');
      const codbloqInput = form.querySelector('[name="codbloq"]');
      if (!valueInput) throw new Error('Cashier payment form valor not found');
      if (!norm(codbloqInput?.value)) throw new Error('Cashier payment form codbloq not found');
      return { cleanup: () => iframe.remove(), iframe, win, doc, form, valueInput, codbloqInput, source: 'iframe' };
    } catch (error) {
      iframe.remove();
      throw error;
    }
  }

  async function openCashierContext(task, scope) {
    try {
      return await openCashierContextViaData(task, scope);
    } catch (dataError) {
      try {
        return await openCashierContextViaIframe(task, scope);
      } catch (iframeError) {
        throw new Error(`Cashier open failed: dados_caixa=${dataError.message || dataError} / iframe=${iframeError.message || iframeError}`);
      }
    }
  }

  async function sendCoinFromCashierForm(task, context) {
    const body = new FormData();
    for (const [name, value] of new context.win.FormData(context.form).entries()) {
      body.append(name, value);
    }
    body.set('id_jogador', String(task.internalPlayerId));
    body.set('id_torneio', String(task.tournamentId));
    body.set('valor', String(task.expectedAmount));
    body.set('codbloq', norm(context.codbloqInput.value));
    task.postRequest = [
      `source=${context.source || ''}`,
      `action=${context.form.action || ''}`,
      `id_jogador=${String(task.internalPlayerId)}`,
      `id_torneio=${String(task.tournamentId)}`,
      `valor=${String(task.expectedAmount)}`,
      `codbloq=${norm(context.codbloqInput.value)}`
    ].join(' / ');
    task.postStatus = '';
    task.postResponsePreview = '';
    try {
      const result = await requestText(context.form.action, {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        body
      });
      task.postStatus = result.response.status;
      task.postResponsePreview = String(result.text || '').slice(0, 1200);
      return result;
    } catch (error) {
      task.postStatus = error.status || '';
      task.postResponsePreview = String(error.textPreview || '').slice(0, 1200);
      throw error;
    }
  }

  function postDebugText(task) {
    const parts = [];
    if (task.postStatus) parts.push(`POST HTTP ${task.postStatus}`);
    if (task.postRequest) parts.push(task.postRequest);
    if (task.postResponsePreview) parts.push(`response=${task.postResponsePreview}`);
    return parts.join(' / ');
  }

  async function waitForPaymentVerification(task, before, timeoutMs = 12000) {
    const started = Date.now();
    let last = null;
    while (Date.now() - started < timeoutMs) {
      last = await fetchTournamentRecordSnapshot(task);
      const pendingOk = last.pending === 0;
      const paidOk = !Number.isFinite(before.paid) ||
        !Number.isFinite(last.paid) ||
        Math.abs(last.paid - before.paid) === task.expectedAmount;
      if (pendingOk && paidOk) return last;
      await sleep(700);
    }
    return last;
  }

  async function executeTask(task, scope) {
    task.status = 'RECHECK';
    task.error = '';
    render();

    const before = await fetchTournamentRecordSnapshot(task);
    applySnapshot(task, before);
    if (before.pending !== task.expectedAmount) {
      throw new Error(`Final recheck mismatch: TSV=${task.expectedAmount} / PW pending=${before.pending}`);
    }

    task.status = 'OPEN CASHIER';
    render();
    const cashier = await openCashierContext(task, scope);
    let postResult;
    try {
      task.status = 'SENDING';
      render();
      postResult = await sendCoinFromCashierForm(task, cashier);
      task.postStatus = postResult.response.status;
    } catch (error) {
      const ambiguous = new Error(`POST outcome ambiguous: ${error.message || error}`);
      ambiguous.ambiguousPost = true;
      throw ambiguous;
    } finally {
      cashier.cleanup();
    }

    await sleep(APP.betweenPaymentsMs);
    let after;
    try {
      after = await waitForPaymentVerification(task, before);
    } catch (error) {
      const ambiguous = new Error(`POST outcome ambiguous: verification failed: ${error.message || error}`);
      ambiguous.ambiguousPost = true;
      throw ambiguous;
    }
    if (!after) {
      const error = new Error('POST outcome ambiguous: verification snapshot unavailable');
      error.ambiguousPost = true;
      throw error;
    }
    applySnapshot(task, after);
    const pendingOk = after.pending === 0;
    const paidOk = !Number.isFinite(before.paid) ||
      !Number.isFinite(after.paid) ||
      Math.abs(after.paid - before.paid) === task.expectedAmount;
    if (!pendingOk || !paidOk) {
      const paidDiff = Number.isFinite(before.paid) && Number.isFinite(after.paid) ? after.paid - before.paid : 'unavailable';
      const debug = postDebugText(task);
      const error = new Error(`POST outcome ambiguous: pending=${after.pending} / paid increase=${paidDiff}${debug ? ` / ${debug}` : ''}`);
      error.ambiguousPost = true;
      throw error;
    }
    task.status = 'DONE';
    task.result = `Paid ${task.expectedAmount}`;
    task.completedDate = tokyoDate();
  }

  async function runReady() {
    if (state.running) return;
    const raw = document.querySelector('#pwpcb-input')?.value || '';
    const scope = norm(document.querySelector('#pwpcb-scope')?.value || '');
    if (!state.preflightComplete) return alert('先に CHECK ALL を完了してください。');
    if (inputHash(`${scope}\n${raw}`) !== state.inputHash) return alert('TSVまたはEvent ScopeがCHECK後に変更されています。もう一度CHECKしてください。');
    const ready = state.tasks.filter(task => task.status === 'READY');
    if (!ready.length) return alert('READY task がありません。');
    const total = ready.reduce((sum, task) => sum + task.expectedAmount, 0);
    const ok = confirm(
      `PW Coinを実際に送信します。\n\n対象: ${ready.length}人\n合計: ${yen(total)}\n\nOKを押すと送信を開始します。\n内容に問題がないか、もう一度確認してください。`
    );
    if (!ok) return alert('キャンセルしました。');

    state.running = true;
    state.stopRequested = false;
    updateButtons();
    let ambiguous = false;
    try {
      for (let index = 0; index < ready.length; index += 1) {
        if (state.stopRequested) break;
        const task = ready[index];
        setStatus(`PAY ${index + 1}/${ready.length}: ${task.tournamentName} / ${task.formattedGameId} / ${yen(task.expectedAmount)}`);
        try {
          await executeTask(task, scope);
        } catch (error) {
          task.status = error.ambiguousPost ? 'UNKNOWN - STOP' : 'ERROR';
          task.error = error.message || String(error);
          if (error.ambiguousPost || task.status === 'UNKNOWN - STOP') {
            ambiguous = true;
            state.stopRequested = true;
          }
        }
        render();
        if (!state.stopRequested && index < ready.length - 1) await sleep(APP.betweenPaymentsMs);
      }
      const done = state.tasks.filter(task => task.status === 'DONE').length;
      const errors = state.tasks.filter(task => task.status === 'ERROR').length;
      setStatus(`${ambiguous ? 'STOP: ambiguous POST outcome' : state.stopRequested ? 'STOPPED' : 'RUN DONE'} / DONE=${done} ERROR=${errors}`, ambiguous || errors > 0);
    } finally {
      state.running = false;
      updateButtons();
      render();
    }
  }

  function stopRun() {
    state.stopRequested = true;
    if (state.manualCancel) state.manualCancel();
    setStatus('STOP requested. The current in-flight request cannot be cancelled; no next task will start.', true);
    updateButtons();
  }

  function componentsText(task) {
    return task.components
      .map(component => `${component.place || '?'}=${component.amount}${component.note ? `(${component.note})` : ''}`)
      .join(' + ');
  }

  function resultRows() {
    const headers = [
      '種別', '元行', '# Tournament', 'GameID', 'TSV構成', 'TSV合計',
      'Tournament ID', 'URL source', 'PW記録行数', 'PW未払い', 'PW支払済み',
      'ステータス', 'エラー', 'POST HTTP', 'POST送信', 'POST応答', '付与日'
    ];
    const rows = [headers];
    for (const task of state.tasks) {
      rows.push([
        'TASK', task.sourceLines.join(','), task.tournamentName, task.formattedGameId,
        componentsText(task), task.expectedAmount, task.tournamentId, task.urlSource,
        Number.isFinite(task.pwRecordCount) ? task.pwRecordCount : '',
        Number.isFinite(task.pwPending) ? task.pwPending : '',
        Number.isFinite(task.pwPaid) ? task.pwPaid : '',
        task.status, task.error || task.result || '',
        task.postStatus || '', task.postRequest || '', task.postResponsePreview || '',
        task.completedDate || ''
      ]);
    }
    for (const item of state.skipped) {
      rows.push([
        'SKIP', item.line, item.tournamentName, formatGameId(item.gameId),
        item.place || '', item.amount, '', '', '', '', '', item.status, item.reason, '', '', '', ''
      ]);
    }
    for (const error of state.parseErrors) {
      rows.push(['PARSE ERROR', '', '', '', '', '', '', '', '', '', '', 'ERROR', error, '', '', '', '']);
    }
    return rows;
  }

  function toTsv(rows) {
    return rows.map(row => row.map(value => String(value == null ? '' : value).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
  }

  async function copyResults() {
    const text = toTsv(resultRows());
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Result TSV copied.');
    } catch (_) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      setStatus('Result TSV copied.');
    }
  }

  function statusClass(status) {
    if (status === 'READY' || status === 'DONE') return 'ok';
    if (status === 'SKIP') return 'skip';
    if (status === 'ERROR' || String(status).includes('UNKNOWN')) return 'error';
    return '';
  }

  function render() {
    const target = document.querySelector('#pwpcb-results');
    if (!target) return;
    const taskRows = state.tasks.map(task => `
      <tr>
        <td>${escapeHtml(task.tournamentName)}</td>
        <td>${escapeHtml(task.formattedGameId)}</td>
        <td title="${escapeHtml(componentsText(task))}">${escapeHtml(componentsText(task))}</td>
        <td class="num">${escapeHtml(yen(task.expectedAmount))}</td>
        <td class="num">${Number.isFinite(task.pwRecordCount) ? escapeHtml(task.pwRecordCount) : ''}</td>
        <td class="num">${Number.isFinite(task.pwPending) ? escapeHtml(yen(task.pwPending)) : ''}</td>
        <td>${escapeHtml(task.urlSource)}</td>
        <td class="${statusClass(task.status)}">${escapeHtml(task.status)}</td>
        <td title="${escapeHtml(task.error)}">${escapeHtml(task.error)}</td>
      </tr>`).join('');
    const skipRows = state.skipped.map(item => `
      <tr>
        <td>${escapeHtml(item.tournamentName)}</td>
        <td>${escapeHtml(formatGameId(item.gameId))}</td>
        <td>${escapeHtml(item.place || '')}</td>
        <td class="num">${Number.isFinite(item.amount) ? escapeHtml(yen(item.amount)) : ''}</td>
        <td></td><td></td><td></td>
        <td class="skip">SKIP</td>
        <td>${escapeHtml(item.reason)}</td>
      </tr>`).join('');
    const errorRows = state.parseErrors.map(error => `
      <tr><td colspan="7"></td><td class="error">PARSE ERROR</td><td>${escapeHtml(error)}</td></tr>`).join('');
    target.innerHTML = taskRows + skipRows + errorRows || '<tr><td colspan="9" class="empty">TSVを貼り付けて CHECK ALL を押してください。</td></tr>';

    const ready = state.tasks.filter(task => task.status === 'READY');
    const done = state.tasks.filter(task => task.status === 'DONE');
    const errors = state.tasks.filter(task => task.status === 'ERROR' || String(task.status).includes('UNKNOWN'));
    const summary = document.querySelector('#pwpcb-summary');
    if (summary) {
      summary.textContent = `TASK ${state.tasks.length} / READY ${ready.length} (${yen(ready.reduce((sum, task) => sum + task.expectedAmount, 0))}) / DONE ${done.length} / ERROR ${errors.length} / SKIP ${state.skipped.length}`;
    }
  }

  function setStatus(message, isError = false) {
    const element = document.querySelector('#pwpcb-status');
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('error-text', Boolean(isError));
  }

  function updateButtons() {
    const check = document.querySelector('#pwpcb-check');
    const run = document.querySelector('#pwpcb-run');
    const stop = document.querySelector('#pwpcb-stop');
    if (check) check.disabled = state.running;
    if (run) run.disabled = state.running;
    if (stop) stop.disabled = !state.running || state.stopRequested;
  }

  function addPanel() {
    if (document.getElementById(APP.panelId)) return;
    const style = document.createElement('style');
    style.textContent = `
      #${APP.panelId}{position:fixed;right:16px;top:64px;width:960px;max-height:88vh;z-index:2147483647;background:#0f172a;color:#e5e7eb;border:1px solid #475569;border-radius:8px;box-shadow:0 16px 45px rgba(0,0,0,.45);font:13px/1.4 Arial,"Yu Gothic",Meiryo,sans-serif;overflow:auto}
      #${APP.panelId}.min{width:300px;max-height:none;overflow:hidden}
      #${APP.panelId}.min .body{display:none}
      #${APP.panelId} .head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #334155;font-weight:700}
      #${APP.panelId} .body{padding:10px 12px}
      #${APP.panelId} label{display:block;margin:7px 0 3px;color:#cbd5e1;font-weight:700}
      #${APP.panelId} input,#${APP.panelId} textarea{width:100%;box-sizing:border-box;background:#020617;color:#e5e7eb;border:1px solid #475569;border-radius:5px;padding:7px}
      #${APP.panelId} textarea{height:145px;resize:vertical;font:12px/1.35 Consolas,"Courier New",monospace;white-space:pre}
      #${APP.panelId} .actions{display:grid;grid-template-columns:1.2fr 1.2fr .8fr .9fr;gap:7px;margin:8px 0}
      #${APP.panelId} button{border:0;border-radius:5px;padding:8px 10px;font-weight:700;cursor:pointer;background:#334155;color:#fff}
      #${APP.panelId} button:disabled{opacity:.45;cursor:not-allowed}
      #${APP.panelId} #pwpcb-check{background:#0369a1}
      #${APP.panelId} #pwpcb-run{background:#b91c1c}
      #${APP.panelId} #pwpcb-stop{background:#d97706}
      #${APP.panelId} #pwpcb-manual[hidden]{display:none}
      #${APP.panelId} #pwpcb-manual{margin:8px 0;padding:10px;border:2px solid #f59e0b;border-radius:6px;background:#1f2937}
      #${APP.panelId} #pwpcb-manual .manual-title{color:#fbbf24;font-weight:700}
      #${APP.panelId} #pwpcb-manual-context{margin:5px 0;color:#e2e8f0}
      #${APP.panelId} #pwpcb-manual-error{min-height:18px;margin-top:5px;color:#fda4af;font-weight:700}
      #${APP.panelId} .manual-actions{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:7px;margin-top:7px}
      #${APP.panelId} #pwpcb-manual-open{background:#0369a1}
      #${APP.panelId} #pwpcb-manual-confirm{background:#15803d}
      #${APP.panelId} #pwpcb-manual-cancel{background:#64748b}
      #${APP.panelId} .table-wrap{max-height:350px;overflow:auto;border:1px solid #334155;border-radius:5px}
      #${APP.panelId} table{width:100%;border-collapse:collapse;background:#111827;font-size:11px}
      #${APP.panelId} th{position:sticky;top:0;background:#1e293b;color:#e2e8f0;text-align:left;z-index:1}
      #${APP.panelId} th,#${APP.panelId} td{padding:5px;border-bottom:1px solid #334155;vertical-align:top;max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #${APP.panelId} td.num{text-align:right;font-variant-numeric:tabular-nums}
      #${APP.panelId} .ok{color:#4ade80;font-weight:700}
      #${APP.panelId} .skip{color:#facc15;font-weight:700}
      #${APP.panelId} .error{color:#fb7185;font-weight:700}
      #${APP.panelId} .error-text{color:#fda4af}
      #${APP.panelId} .empty{text-align:center;color:#94a3b8;padding:20px}
      #${APP.panelId} #pwpcb-status{margin-top:6px;color:#bfdbfe}
      #${APP.panelId} #pwpcb-summary{margin:6px 0;font-weight:700;color:#fde68a}
      #${APP.panelId} .note{color:#94a3b8;font-size:11px;margin-top:5px}
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = APP.panelId;
    panel.innerHTML = `
      <div class="head">
        <span>PW Prize Coin Batch v${APP.version}</span>
        <button id="pwpcb-min" type="button">−</button>
      </div>
      <div class="body">
        <label for="pwpcb-scope">PokerWeb Event Scope（任意。TSVのTitle/Seasonは使用しません）</label>
        <input id="pwpcb-scope" placeholder="例: 【SPADIE Season 42】">
        <label for="pwpcb-input">実行元TSV（C列 # Tournament を厳密照合）</label>
        <textarea id="pwpcb-input" spellcheck="false"></textarea>
        <div class="actions">
          <button id="pwpcb-check" type="button">CHECK ALL（読取のみ）</button>
          <button id="pwpcb-run" type="button">RUN READY（実支払）</button>
          <button id="pwpcb-stop" type="button" disabled>STOP</button>
          <button id="pwpcb-copy" type="button">結果TSV COPY</button>
        </div>
        <div id="pwpcb-manual" hidden>
          <div class="manual-title">手動でTournamentを指定してください（CHECK一時停止中）</div>
          <div id="pwpcb-manual-context"></div>
          <label for="pwpcb-manual-input">PokerWebの大会名をコピーして貼り付け</label>
          <input id="pwpcb-manual-input" autocomplete="off" spellcheck="false">
          <div id="pwpcb-manual-error"></div>
          <div class="manual-actions">
            <button id="pwpcb-manual-open" type="button">OPEN大会一覧を別タブで開く</button>
            <button id="pwpcb-manual-confirm" type="button">この大会で確認</button>
            <button id="pwpcb-manual-cancel" type="button">キャンセル</button>
          </div>
          <div class="note">元のタブを移動・更新せず、別タブで大会名をコピーしてください。確認後、GameID・金額・ページ情報を再チェックします。</div>
        </div>
        <div id="pwpcb-summary">TASK 0 / READY 0 / DONE 0 / ERROR 0 / SKIP 0</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th># Tournament</th><th>GameID</th><th>TSV構成</th><th>TSV合計</th><th>PW記録</th><th>PW未払い</th><th>URL</th><th>Status</th><th>Error</th></tr></thead>
            <tbody id="pwpcb-results"></tbody>
          </table>
        </div>
        <div id="pwpcb-status">任意のPokerWeb管理画面で使用できます。CHECK ALL は送金しません。</div>
        <div class="note">CHECKは大会ごとに記録APIの全HTML行を一度だけ読み、URL・GameID・内部ID・未払いPrizeを照合します。RUNはREADYのみを対象に、各プレイヤーごとに新しい大会画面で歯車/Cashierを開き、実フォームと最新codbloqから一件ずつ送金して記録を再確認します。送金POST結果が不明な場合は全体STOPし、自動再試行しません。</div>
      </div>`;
    document.body.appendChild(panel);

    document.querySelector('#pwpcb-input').value = localStorage.getItem(APP.inputKey) || '';
    document.querySelector('#pwpcb-scope').value = localStorage.getItem(APP.scopeKey) || '';
    document.querySelector('#pwpcb-check').addEventListener('click', runPreflight);
    document.querySelector('#pwpcb-run').addEventListener('click', runReady);
    document.querySelector('#pwpcb-stop').addEventListener('click', stopRun);
    document.querySelector('#pwpcb-copy').addEventListener('click', copyResults);
    document.querySelector('#pwpcb-manual-open').addEventListener('click', () => {
      window.open('/torneio/abertos', '_blank', 'noopener');
    });
    document.querySelector('#pwpcb-manual-input').addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      document.querySelector('#pwpcb-manual-confirm')?.click();
    });
    document.querySelector('#pwpcb-min').addEventListener('click', event => {
      panel.classList.toggle('min');
      event.currentTarget.textContent = panel.classList.contains('min') ? '+' : '−';
    });
    render();
    updateButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addPanel, { once: true });
  } else {
    addPanel();
  }
})();
