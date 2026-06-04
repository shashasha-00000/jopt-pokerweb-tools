// ==UserScript==
// @name         PW 既存大会 Item 更新 人工確認版
// @namespace    pw-existing-tournament-item-updater-ui
// @version      0.6.0
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-existing-tournament-item-updater.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-existing-tournament-item-updater.user.js
// @description  既存大会URLをPreview/Resolveで人工確認してから、USDT販売許可ON、任意数の販売項目を更新する。作成・時間変更・Ticket Linkなし。
// @author       xhpc007 + ChatGPT
// @match        https://japanopt.pokerweb.com.br/cb/*
// @match        https://japanopt.pokerweb.com.br/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ============================================================
  // Shared URL Cache
  // ============================================================

  const SHARED_URL_CACHE_KEY = 'PW_SHARED_TOURNAMENT_URL_CACHE_V1';

  const DEFAULTS = {
    direito_img: '1',
    pts_ranking: '0',
    gameid_bloqueio: '1',
    rake: '0',
    taxa_extras: '',

    entryNome: 'Entry',
    entrySiglas: 'En',

    reNome: 'Re Entry',
    reSiglas: 'Re',

    ticketNome: 'Ticket',
    ticketSiglas: 'Ti',

    enLimit: '1',
    reLimit: '3',
    ticketLimit: '4',

    enReposicionar: '0',
    reReposicionar: '1',
    ticketReposicionar: '0'
  };

  const CONFIG = {
    searchTimeoutMs: 12000,
    searchPollMs: 350,

    afterSearchMs: 350,
    afterOpenConfigMs: 900,
    afterModalOpenMs: 1000,
    afterPostMs: 700,
    afterReloadMs: 1200,

    flowKey: 'PW_EXISTING_ITEM_UPDATE_UI_STATE_V06',
    inputKey: 'PW_EXISTING_ITEM_UPDATE_UI_INPUT_V06',
    candidateKey: 'PW_EXISTING_ITEM_UPDATE_UI_CANDIDATES_V06',
    lastReportKey: 'PW_EXISTING_ITEM_UPDATE_UI_LAST_REPORT_V06'
  };

  let manualStop = false;

  // ============================================================
  // 1. State / Storage
  // ============================================================

  function getState() {
    try {
      return JSON.parse(sessionStorage.getItem(CONFIG.flowKey) || '{}');
    } catch (_) {
      return {};
    }
  }

  function setState(state) {
    sessionStorage.setItem(CONFIG.flowKey, JSON.stringify(state));
    renderReport(state.report || []);
  }

  function clearState() {
    sessionStorage.removeItem(CONFIG.flowKey);
  }

  function getCurrentTournament(state) {
    const list = state.tournaments || [];
    const index = Number(state.tournamentIndex || 0);
    const t = list[index];

    if (!t) {
      throw new Error(`找不到 tournamentIndex=${index} 的设定数据`);
    }

    return t;
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

  function makeReportLine(type, msg) {
    return `[${nowText()}] ${type}  ${msg}`;
  }

  function appendReportToState(state, type, msg) {
    if (!state.report) state.report = [];
    state.report.push(makeReportLine(type, msg));

    const text = state.report.join('\n');
    localStorage.setItem(CONFIG.lastReportKey, text);

    setState(state);
  }

  function appendReport(type, msg) {
    const state = getState();
    appendReportToState(state, type, msg);
  }

  function renderReport(report) {
    const box = document.querySelector('#pw-item-update-report');
    if (!box) return;

    const text = Array.isArray(report)
      ? report.join('\n')
      : String(report || '');

    box.value = text;
    box.scrollTop = box.scrollHeight;
  }

  function renderLastReport() {
    const state = getState();

    if (state.report && state.report.length) {
      renderReport(state.report);
      return;
    }

    const last = localStorage.getItem(CONFIG.lastReportKey) || '';
    const box = document.querySelector('#pw-item-update-report');
    if (box) box.value = last;
  }

  // ============================================================
  // 2. Utils
  // ============================================================

  function log(msg) {
    console.log(`[PW-ITEM-UPDATE] ${msg}`);
    const box = document.querySelector('#pw-item-update-status');
    if (box) box.textContent = msg;
  }

  function warn(msg) {
    console.warn(`[PW-ITEM-UPDATE] ${msg}`);
    const box = document.querySelector('#pw-item-update-status');
    if (box) box.textContent = `⚠ ${msg}`;
  }

  function debugFormData(title, fd) {
    console.log(`[PW-ITEM-UPDATE] ${title}`);
    for (const [k, v] of fd.entries()) {
      console.log(k, '=', v);
    }
  }

  function normalizeText(s) {
    return String(s || '')
      .replace(/\u3000/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function compactText(s) {
    return normalizeText(s).replace(/\s+/g, '');
  }

  function isVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  function isPainelPage() {
    return /\/cb\/torneio\/painel\/\d+/.test(location.href);
  }

  function getTournamentIdFromUrl(url = location.href) {
    const m = String(url).match(/\/painel\/(\d+)/) || String(url).match(/\/cb\/torneio\/painel\/(\d+)/);
    return m ? m[1] : '';
  }

  function getTournamentUrl(id) {
    return `/cb/torneio/painel/${id}`;
  }

  function normalizeUrl(urlOrId) {
    const s = normalizeText(urlOrId);
    if (!s) return '';

    const m = s.match(/\/cb\/torneio\/painel\/(\d+)/);
    if (m) return `/cb/torneio/painel/${m[1]}`;

    if (/^\d+$/.test(s)) return `/cb/torneio/painel/${s}`;

    return s;
  }

  function normalizeMoneyForPW(v) {
    let s = normalizeText(v);

    if (!s) return '';
    if (s === '-') return '';

    s = s.replace(/[¥￥]/g, '').replace(/\s+/g, '');

    if (/^-?\d{1,3}(,\d{3})+$/.test(s)) return s;

    const raw = s.replace(/,/g, '');
    if (!/^-?\d+$/.test(raw)) return s;

    const sign = raw.startsWith('-') ? '-' : '';
    const body = sign ? raw.slice(1) : raw;

    return sign + body.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function normalizePlainNumber(v, fallback = '') {
    const s = normalizeText(v);
    if (!s) return fallback;
    return s.replace(/[^\d-]/g, '') || fallback;
  }

  function feeText(valor, taxa) {
    const v = normalizeText(valor);
    const t = normalizeText(taxa);
    if (!v && !t) return '';
    if (t && t !== '0') return `${v}+${t}`;
    return v;
  }

  function itemFeeText(item) {
    return feeText(item?.valor, item?.taxa);
  }

  function makeItem({ nome, siglas, valor, taxa, fichas, limite, reposicionar }) {
    const cleanNome = normalizeText(nome);
    const cleanValor = normalizeMoneyForPW(valor);

    if (!cleanNome || !cleanValor) return null;

    return {
      nome: cleanNome,
      siglas: normalizeText(siglas),
      valor: cleanValor,
      taxa: normalizeMoneyForPW(taxa || '0'),
      fichas: normalizeMoneyForPW(fichas || '0'),
      limite: normalizePlainNumber(limite, '0'),
      reposicionar: normalizePlainNumber(reposicionar, '0')
    };
  }

  function getItemLabel(item) {
    const siglas = normalizeText(item?.siglas || '');
    return siglas ? `${item.nome}/${siglas}` : item.nome;
  }

  function itemListText(items) {
    return (items || [])
      .map(item => `${getItemLabel(item)}=${itemFeeText(item)} / Chips=${item.fichas || '0'}`)
      .join(' ; ');
  }

  function findDynamicItemNumbers(header) {
    const numbers = new Set();

    header.forEach(h => {
      const m = normalizeText(h).match(/^Item\s*(\d+)(?:_|$)/i);
      if (m) numbers.add(Number(m[1]));
    });

    return [...numbers].sort((a, b) => a - b);
  }

  function buildItemListFromColumns(idx, get, options = {}) {
    const items = [];

    if (options.includeLegacy) {
      const entryItem = makeItem({
        nome: DEFAULTS.entryNome,
        siglas: DEFAULTS.entrySiglas,
        valor: get(idx('EN', 'Entry', 'EN_Valor')),
        taxa: get(idx('EN_Tax', 'EN Tax', 'EN_Taxa')),
        fichas: get(idx('EN_Chips', 'EN Chips')),
        limite: get(idx('EN_Limit', 'EN Limit')) || DEFAULTS.enLimit,
        reposicionar: get(idx('EN_Reposicionar', 'EN_Repo')) || DEFAULTS.enReposicionar
      });

      const reItem = makeItem({
        nome: DEFAULTS.reNome,
        siglas: DEFAULTS.reSiglas,
        valor: get(idx('RE', 'ReEntry', 'Re Entry', 'RE_Valor')),
        taxa: get(idx('RE_Tax', 'RE Tax', 'RE_Taxa')),
        fichas: get(idx('RE_Chips', 'RE Chips')),
        limite: get(idx('RE_Limit', 'RE Limit')) || DEFAULTS.reLimit,
        reposicionar: get(idx('RE_Reposicionar', 'RE_Repo')) || DEFAULTS.reReposicionar
      });

      const ticketItem = makeItem({
        nome: DEFAULTS.ticketNome,
        siglas: DEFAULTS.ticketSiglas,
        valor: get(idx('Ticket', 'TE', 'TIX', 'Ticket_Valor')),
        taxa: get(idx('Ticket_Tax', 'TE_Tax', 'TIX_Tax', 'Ticket Tax')),
        fichas: get(idx('Ticket_Chips', 'TE_Chips', 'TIX_Chips', 'Ticket Chips')),
        limite: get(idx('Ticket_Limit', 'TE_Limit', 'TIX_Limit', 'Ticket Limit')) || DEFAULTS.ticketLimit,
        reposicionar: get(idx('Ticket_Reposicionar', 'TE_Repo', 'TIX_Repo', 'Ticket_Repo')) || DEFAULTS.ticketReposicionar
      });

      [entryItem, reItem, ticketItem].filter(Boolean).forEach(item => items.push(item));
    }

    findDynamicItemNumbers(options.header || []).forEach(n => {
      const item = makeItem({
        nome: get(idx(`Item${n}_Name`, `Item${n}_Nome`, `Item${n}_商品名`, `Item${n}_名前`)),
        siglas: get(idx(`Item${n}_Siglas`, `Item${n}_Code`, `Item${n}_略称`)),
        valor: get(idx(`Item${n}_Value`, `Item${n}_Valor`, `Item${n}_Price`, `Item${n}`)),
        taxa: get(idx(`Item${n}_Tax`, `Item${n}_Taxa`, `Item${n}_Fee`)),
        fichas: get(idx(`Item${n}_Chips`, `Item${n}_Fichas`)),
        limite: get(idx(`Item${n}_Limit`, `Item${n}_Limite`)),
        reposicionar: get(idx(`Item${n}_Reposicionar`, `Item${n}_Repo`))
      });

      if (item) items.push(item);
    });

    return items;
  }

  function getNoFromName(name) {
    const s = normalizeText(name);

    const sat = s.match(/\(?\s*s\s*0*(\d+)\s*\)?/i);
    if (sat) return `s${String(Number(sat[1])).padStart(2, '0')}`;

    const m = s.match(/#\s*0*(\d+)/);
    if (m) return String(Number(m[1])).padStart(2, '0');

    return '';
  }

  function getEventPrefixFromName(name) {
    const m = normalizeText(name).match(/【[^】]+】/);
    return m ? m[0] : '';
  }

  function sameTournamentByPrefixAndNo(expectedName, actualName) {
    const ep = getEventPrefixFromName(expectedName);
    const ap = getEventPrefixFromName(actualName);
    const en = getNoFromName(expectedName);
    const an = getNoFromName(actualName);

    if (!ep || !ap || ep !== ap) return false;
    if (!en || !an || en !== an) return false;

    return true;
  }

  // ============================================================
  // 3. Shared URL Cache helpers
  // ============================================================

  function loadSharedUrlCache() {
    try {
      const raw = localStorage.getItem(SHARED_URL_CACHE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveSharedUrlCache(cache) {
    localStorage.setItem(SHARED_URL_CACHE_KEY, JSON.stringify(cache));
  }

  function getUrlId(url) {
    return getTournamentIdFromUrl(normalizeUrl(url));
  }

  function getCacheCleanName(name) {
    return normalizeText(name);
  }

  function getSharedCacheKey(name, id) {
    const cleanName = getCacheCleanName(name);
    const cleanId = normalizeText(id);
    return `${cleanName}||${cleanId}`;
  }

  function isSameTournamentExactSafe(inputName, actualName) {
    const input = normalizeText(inputName);
    const actual = normalizeText(actualName);
    if (!input || !actual) return false;
    return compactText(input) === compactText(actual);
  }

  function validateUrlCacheItem(inputName, item, key = '') {
    const expectedName = normalizeText(inputName);

    if (!item || typeof item !== 'object') {
      return { ok: false, code: 'URL_CACHE_BAD_ROW', reason: `${key}: cache row is not object` };
    }

    const name = normalizeText(item.name);
    const tournamentId = normalizeText(item.tournamentId || item.id || '');
    const url = normalizeUrl(item.url || item.painelUrl || '');
    const urlId = getUrlId(url);
    const actualName = normalizeText(item.actualName || '');

    if (!name) {
      return { ok: false, code: 'URL_CACHE_BAD_ROW', reason: `${key}: name empty` };
    }

    if (!tournamentId && !urlId) {
      return { ok: false, code: 'URL_CACHE_BAD_ROW', reason: `${key}: id/urlId empty` };
    }

    if (tournamentId && urlId && tournamentId !== urlId) {
      return { ok: false, code: 'CACHE_ID_MISMATCH', reason: `${key}: id=${tournamentId} urlId=${urlId}` };
    }

    if (expectedName && !isSameTournamentExactSafe(expectedName, name)) {
      return { ok: false, code: 'URL_CACHE_BAD_ROW', reason: `${key}: name mismatch cache=${name}` };
    }

    if (actualName && expectedName && !isSameTournamentExactSafe(expectedName, actualName)) {
      return { ok: false, code: 'CACHE_NAME_ACTUAL_MISMATCH', reason: `${key}: actualName=${actualName}` };
    }

    return {
      ok: true,
      item: {
        name,
        tournamentId: tournamentId || urlId,
        url: url || getTournamentUrl(tournamentId || urlId),
        actualName: actualName || name,
        matchedRow: String(item.matchedRow || item.rowText || ''),
        savedAt: String(item.savedAt || ''),
        source: String(item.source || 'shared-cache')
      }
    };
  }

  function findSharedCacheByName(name) {
    const cache = loadSharedUrlCache();
    const cleanName = getCacheCleanName(name);
    const valid = [];
    const bad = [];

    Object.entries(cache).forEach(([key, item]) => {
      const keyName = normalizeText(String(key).split('||')[0]);
      const itemName = normalizeText(item?.name || '');

      if (!isSameTournamentExactSafe(cleanName, keyName) && !isSameTournamentExactSafe(cleanName, itemName)) {
        return;
      }

      const result = validateUrlCacheItem(cleanName, item, key);
      if (result.ok) {
        valid.push({ key, ...result.item });
      } else {
        bad.push(result);
      }
    });

    if (valid.length > 1) {
      return { ok: false, status: 'URL_AMBIGUOUS', reason: `${cleanName}: cache has ${valid.length} valid rows`, matches: valid };
    }

    if (valid.length === 1) {
      return { ok: true, status: 'OK_CACHE', item: valid[0] };
    }

    if (bad.length) {
      return { ok: false, status: bad[0].code || 'URL_CACHE_BAD_ROW', reason: bad.map(x => x.reason).join(' / ') };
    }

    return { ok: false, status: 'URL未解決', reason: 'Shared Cache miss' };
  }

  function setSharedCacheItem(name, data) {
    const cleanName = getCacheCleanName(name);
    if (!cleanName) return null;

    const url = normalizeUrl(data.url || data.painelUrl || data.tournamentId || '');
    const id = normalizeText(data.tournamentId || getUrlId(url));
    if (!id) return null;

    const item = {
      name: cleanName,
      tournamentId: id,
      url: url || getTournamentUrl(id),
      actualName: normalizeText(data.actualName || cleanName),
      matchedRow: String(data.matchedRow || data.rowText || ''),
      savedAt: nowText(),
      source: String(data.source || 'script')
    };

    const validation = validateUrlCacheItem(cleanName, item, getSharedCacheKey(cleanName, id));
    if (!validation.ok) {
      throw new Error(`${validation.code}: ${validation.reason}`);
    }

    const cache = loadSharedUrlCache();
    cache[getSharedCacheKey(cleanName, id)] = item;
    saveSharedUrlCache(cache);
    return item;
  }

  function getCachedTournamentUrl(name) {
    const found = findSharedCacheByName(name);
    return found.ok ? found.item : null;
  }

  function setCachedTournamentUrl(name, data) {
    return setSharedCacheItem(name, data);
  }

  function sharedCacheCount() {
    return Object.keys(loadSharedUrlCache()).length;
  }

  // ============================================================
  // 4. TSV Parser
  // ============================================================

  function parseTournamentInput(raw) {
    const lines = String(raw || '')
      .split(/\r?\n/)
      .map(x => x.replace(/\uFEFF/g, ''))
      .filter(x => normalizeText(x));

    if (!lines.length) return [];

    const firstCols = lines[0].split('\t').map(normalizeText);
    const hasHeader =
      firstCols.includes('Name') ||
      firstCols.includes('大会名') ||
      firstCols.includes('EN') ||
      firstCols.includes('URL') ||
      firstCols.includes('TournamentId') ||
      firstCols.some(h => /^Item\s*\d+/i.test(h));

    const defaultHeader = [
      'Name',
      'EN',
      'EN_Tax',
      'EN_Chips',
      'RE',
      'RE_Tax',
      'RE_Chips',
      'Ticket',
      'Ticket_Tax',
      'Ticket_Chips',
      'EN_Limit',
      'RE_Limit',
      'Ticket_Limit',
      'EN_Reposicionar',
      'RE_Reposicionar',
      'Ticket_Reposicionar'
    ];

    const header = hasHeader ? firstCols : defaultHeader;
    const dataLines = hasHeader ? lines.slice(1) : lines;

    const idx = (...names) => {
      for (const n of names) {
        const i = header.findIndex(h => normalizeText(h).toLowerCase() === normalizeText(n).toLowerCase());
        if (i >= 0) return i;
      }
      return -1;
    };

    const iName = idx('Name', '大会名', 'Tournament', 'Input_Name');

    const iTournamentId = idx('TournamentId', 'tournamentId', 'ID');
    const iUrl = idx('URL', 'Url');

    if (iName < 0) {
      throw new Error('TSV里找不到 Name 列');
    }

    return dataLines.map((line, lineIndex) => {
      const c = line.split('\t');
      const get = i => (i >= 0 ? normalizeText(c[i]) : '');

      const name = get(iName);
      if (!name) return null;

      const tournamentId = get(iTournamentId);
      const urlRaw = get(iUrl);
      const url = normalizeUrl(urlRaw || tournamentId);
      const items = buildItemListFromColumns(idx, get, { header, includeLegacy: true });
      const entry = items.find(item => normalizeText(item.siglas) === DEFAULTS.entrySiglas) || {};
      const reEntry = items.find(item => normalizeText(item.siglas) === DEFAULTS.reSiglas) || {};
      const ticketEntry = items.find(item => ['Ti', 'TE', 'TIX'].includes(normalizeText(item.siglas))) || null;

      return {
        name,
        tournamentId,
        url,
        items,
        entry,
        reEntry,
        ticketEntry,

        _line: lineIndex + 1
      };
    }).filter(Boolean);
  }

  function validateTournamentList(list) {
    const errors = [];

    list.forEach((t, i) => {
      if (!t.name) errors.push(`${i + 1}: name empty`);
      if (!Array.isArray(t.items) || !t.items.length) {
        errors.push(`${i + 1}: ${t.name} item empty`);
        return;
      }

      t.items.forEach((item, itemIndex) => {
        if (!item.nome) errors.push(`${i + 1}: ${t.name} Item${itemIndex + 1}_Name empty`);
        if (!item.valor) errors.push(`${i + 1}: ${t.name} ${item.nome || `Item${itemIndex + 1}`} value empty`);
      });
    });

    return errors;
  }

  function makePreviewReport(list, errors = []) {
    const lines = [];

    lines.push(makeReportLine('PREVIEW', `解析 ${list.length} 件 / SharedCache ${sharedCacheCount()} 件`));

    if (errors.length) {
      lines.push(makeReportLine('PREVIEW_NG', `エラー ${errors.length} 件`));
      errors.slice(0, 30).forEach(e => lines.push(`  - ${e}`));
      if (errors.length > 30) lines.push(`  ...还有 ${errors.length - 30} 件`);
      return lines;
    }

    lines.push(candidateRowsToTsv(makeCandidateRows(list)));

    return lines;
  }

  // ============================================================
  // 5. Search existing tournament
  // ============================================================

  function findDataTablesSearchInput() {
    return null;
  }

  function setNativeInputValue(input, value) {
    if (!input) return;
    input.value = value;
  }

  function dispatchSearchInput() {
    throw new Error('旧式DataTables検索は廃止済みです。URL Resolveを使ってください。');
  }

  function clearSearchInput() {}

  function rowHasPainelLink(row) {
    return String(row.innerHTML || '').includes('/cb/torneio/painel/');
  }

  function extractTournamentTitleFromRow(rowText) {
    const s = normalizeText(rowText);

    const m = s.match(/(【[^】]+】\s*(?:#\d+|\(s\d+\)|s\d+)\s+.+?)(?:\s+\d{1,2}\/\d{1,2}\/\d{4}|\s+Aberto|\s+Fechado|\s+オープン|\s+クローズ|$)/i);
    if (m) return normalizeText(m[1]);

    const m2 = s.match(/(【[^】]+】.+)/);
    if (m2) return normalizeText(m2[1]);

    return s;
  }

  function extractTournamentFromRow(row, inputName) {
    const wanted = compactText(inputName);
    const rowText = normalizeText(row.innerText || '');
    const rowHtml = row.innerHTML || '';
    const rowAll = compactText(rowText + ' ' + rowHtml);

    if (!rowAll.includes(wanted)) {
      return null;
    }

    const links = [...row.querySelectorAll('a[href]')];

    const painelLink =
      links.find(a => String(a.getAttribute('href') || '').includes('/cb/torneio/painel/')) ||
      links.find(a => String(a.href || '').includes('/cb/torneio/painel/'));

    const href = painelLink ? (painelLink.getAttribute('href') || painelLink.href) : rowHtml;
    const m = String(href).match(/\/cb\/torneio\/painel\/(\d+)/);

    if (!m) return null;

    return {
      tournamentId: m[1],
      painelUrl: getTournamentUrl(m[1]),
      actualName: extractTournamentTitleFromRow(rowText),
      rowText
    };
  }

  function findTournamentFromVisibleRows(inputName) {
    return findTournamentFromCurrentDataTablePage(window, inputName);
  }

  async function waitForTournamentSearchResult(inputName) {
    const result = await searchTournamentInListWindow(window, inputName, 'CURRENT', 1);
    return result.status === 'OK_SEARCH_CURRENT' ? result.match : null;
  }

  function makeCandidateRows(list) {
    return list.map(t => makeCandidateRow(t));
  }

  function makeCandidateRow(t) {
    const row = {
      ...t,
      use: '',
      urlStatus: 'URL未解決',
      statusReason: '',
      actualName: '',
      matchedRow: ''
    };

    const inputId = normalizeText(t.tournamentId || '');
    const inputUrl = normalizeUrl(t.url || inputId);
    const urlId = getUrlId(inputUrl);

    if (inputUrl) {
      if (!inputId && !urlId) {
        row.urlStatus = 'URL_INPUT_INVALID';
        row.statusReason = `input URL is not painel URL: ${inputUrl}`;
        return row;
      }

      if (inputId && urlId && inputId !== urlId) {
        row.urlStatus = 'CACHE_ID_MISMATCH';
        row.statusReason = `input id=${inputId} urlId=${urlId}`;
        return row;
      }

      row.tournamentId = inputId || urlId;
      row.url = inputUrl;
      row.use = '1';
      row.urlStatus = 'OK_INPUT_URL';
      row.statusReason = 'TSV input';
      row.actualName = row.name;
      return row;
    }

    const cached = findSharedCacheByName(t.name);
    if (cached.ok) {
      row.tournamentId = cached.item.tournamentId;
      row.url = cached.item.url;
      row.use = '1';
      row.urlStatus = 'OK_CACHE';
      row.statusReason = cached.item.source || 'Shared Cache';
      row.actualName = cached.item.actualName || '';
      row.matchedRow = cached.item.matchedRow || '';
      return row;
    }

    row.urlStatus = cached.status || 'URL未解決';
    row.statusReason = cached.reason || '';
    return row;
  }

  function isSafeUrlStatus(status) {
    return [
      'OK_INPUT_URL',
      'OK_CACHE',
      'OK_SEARCH_CLOSED',
      'OK_SEARCH_OPEN',
      'OK_MANUAL'
    ].includes(normalizeText(status));
  }

  function candidateRowsToTsv(rows) {
    const maxItems = Math.max(1, ...rows.map(r => (r.items || []).length));
    const itemFields = [];

    for (let i = 1; i <= maxItems; i++) {
      itemFields.push(
        `Item${i}_Name`,
        `Item${i}_Siglas`,
        `Item${i}_Value`,
        `Item${i}_Tax`,
        `Item${i}_Chips`,
        `Item${i}_Limit`,
        `Item${i}_Reposicionar`
      );
    }

    const header = [
      'USE',
      '大会名',
      'TournamentId',
      'URL',
      '判定',
      '理由',
      ...itemFields
    ];

    const lines = [header.join('\t')];

    rows.forEach(r => {
      const itemValues = [];

      for (let i = 0; i < maxItems; i++) {
        const item = (r.items || [])[i] || {};
        itemValues.push(
          item.nome || '',
          item.siglas || '',
          item.valor || '',
          item.taxa || '',
          item.fichas || '',
          item.limite || '',
          item.reposicionar || ''
        );
      }

      lines.push([
        r.use || '',
        r.name || '',
        r.tournamentId || '',
        r.url || '',
        r.urlStatus || '',
        r.statusReason || '',
        ...itemValues
      ].map(v => String(v ?? '').replace(/\t/g, ' ')).join('\t'));
    });

    return lines.join('\n');
  }

  function getDataTableInWindow(win = window) {
    const $ = win.jQuery || win.$;
    if (!$ || !$.fn || !$.fn.DataTable) return null;

    const tables = [...win.document.querySelectorAll('table')];
    for (const table of tables) {
      try {
        if ($.fn.DataTable.isDataTable(table)) {
          const dt = $(table).DataTable();
          if (dt) return dt;
        }
      } catch (_) {}
    }

    return null;
  }

  function getDataTableTbodyRows(win = window, dt = null) {
    const tableNode = dt?.table?.().node?.();
    const root = tableNode || win.document;
    return [...root.querySelectorAll('tbody tr')].filter(row => isVisible(row));
  }

  function isDataTableProcessing(win = window) {
    return [...win.document.querySelectorAll('.dataTables_processing')]
      .some(el => isVisible(el) && !/none/i.test(el.style.display || ''));
  }

  async function waitForProcessingGone(win = window, timeoutMs = CONFIG.searchTimeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!isDataTableProcessing(win)) return true;
      await sleep(CONFIG.searchPollMs);
    }
    return false;
  }

  async function waitForDataTableReadyInWindow(win = window, timeoutMs = CONFIG.searchTimeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const dt = getDataTableInWindow(win);
      if (dt) {
        await waitForProcessingGone(win, timeoutMs);
        return dt;
      }
      await sleep(CONFIG.searchPollMs);
    }
    throw new Error('DataTables API が見つかりません');
  }

  function waitForNextDraw(win, dt, timeoutMs = CONFIG.searchTimeoutMs) {
    return new Promise((resolve, reject) => {
      const $ = win.jQuery || win.$;
      const timer = win.setTimeout(() => {
        try { $(dt.table().node()).off('draw.dt', onDraw); } catch (_) {}
        reject(new Error('DataTables draw timeout'));
      }, timeoutMs);

      function onDraw() {
        win.clearTimeout(timer);
        resolve(true);
      }

      try {
        $(dt.table().node()).one('draw.dt', onDraw);
      } catch (e) {
        win.clearTimeout(timer);
        reject(e);
      }
    });
  }

  async function dataTableSearchAndWait(win, dt, name) {
    await waitForProcessingGone(win);

    let drawPromise = waitForNextDraw(win, dt);

    try { dt.page.len(100); } catch (_) {}
    try { dt.search(name); } catch (_) {}
    try { dt.page(0); } catch (_) {}
    try { dt.draw(); } catch (_) { dt.draw(false); }

    await drawPromise;
    await waitForProcessingGone(win);
    await sleep(CONFIG.afterSearchMs);
  }

  function findTournamentFromCurrentDataTablePage(win = window, inputName) {
    const dt = getDataTableInWindow(win);
    const rows = getDataTableTbodyRows(win, dt).filter(rowHasPainelLink);
    const matches = [];

    for (const row of rows) {
      const found = extractTournamentFromRow(row, inputName);
      if (!found) continue;
      if (!isSameTournamentExactSafe(inputName, found.actualName)) continue;
      matches.push(found);
    }

    const seen = new Set();
    const unique = matches.filter(x => {
      if (seen.has(x.painelUrl)) return false;
      seen.add(x.painelUrl);
      return true;
    });

    if (unique.length === 1) {
      return { status: 'FOUND', match: unique[0] };
    }

    if (unique.length > 1) {
      return { status: 'AMBIGUOUS', matches: unique };
    }

    return { status: 'NOT_FOUND', matches: [] };
  }

  function openTournamentListWindow(path) {
    const url = new URL(path, location.origin).href;
    return window.open(url, `pw-url-resolve-${path.replace(/[^\w]+/g, '-')}`, 'width=1200,height=850');
  }

  async function searchTournamentInListWindow(win, name, sourceLabel, retry = 3) {
    const dt = await waitForDataTableReadyInWindow(win);

    for (let i = 1; i <= retry; i++) {
      log(`${sourceLabel} search ${i}/${retry}: ${name}`);
      await dataTableSearchAndWait(win, dt, name);

      const result = findTournamentFromCurrentDataTablePage(win, name);
      if (result.status === 'FOUND') {
        return { status: `OK_SEARCH_${sourceLabel}`, match: result.match };
      }
      if (result.status === 'AMBIGUOUS') {
        return { status: 'AMBIGUOUS', matches: result.matches };
      }
    }

    return { status: 'URL_NOT_FOUND', matches: [] };
  }

  function shouldResolveCandidate(c) {
    return [
      'URL未解決',
      'URL_NOT_FOUND',
      'URL_CACHE_BAD_ROW',
      'URL_AMBIGUOUS',
      'AMBIGUOUS',
      'URL_INPUT_INVALID',
      'CACHE_ID_MISMATCH',
      'CACHE_NAME_ACTUAL_MISMATCH'
    ].includes(normalizeText(c.urlStatus));
  }

  async function resolveUrlForCandidates(rows) {
    const targets = rows.filter(shouldResolveCandidate);
    if (!targets.length) return rows;

    const closedWin = openTournamentListWindow('/cb/torneio/fechados');
    if (!closedWin) throw new Error('closed tournament window open failed');

    await sleep(800);

    let openWin = null;

    for (const row of targets) {
      row.use = '';
      row.urlStatus = 'URL_NOT_FOUND';
      row.statusReason = 'closed/open search not completed';

      let found = await searchTournamentInListWindow(closedWin, row.name, 'CLOSED', 3);

      if (found.status === 'AMBIGUOUS') {
        row.urlStatus = 'AMBIGUOUS';
        row.statusReason = `CLOSED multiple matches: ${found.matches.length}`;
        continue;
      }

      if (found.status !== 'OK_SEARCH_CLOSED') {
        if (!openWin) {
          openWin = openTournamentListWindow('/cb/torneio/abertos');
          await sleep(800);
        }
        if (!openWin) throw new Error('open tournament window open failed');
        found = await searchTournamentInListWindow(openWin, row.name, 'OPEN', 3);
      }

      if (found.status === 'AMBIGUOUS') {
        row.urlStatus = 'AMBIGUOUS';
        row.statusReason = `OPEN multiple matches: ${found.matches.length}`;
        continue;
      }

      if (found.status !== 'OK_SEARCH_CLOSED' && found.status !== 'OK_SEARCH_OPEN') {
        row.urlStatus = 'URL_NOT_FOUND';
        row.statusReason = 'closed/open not found';
        continue;
      }

      const match = found.match;
      row.tournamentId = match.tournamentId;
      row.url = match.painelUrl;
      row.actualName = match.actualName || '';
      row.matchedRow = match.rowText || '';
      row.use = '1';
      row.urlStatus = found.status;
      row.statusReason = match.actualName || 'DataTables search';

      setSharedCacheItem(row.name, {
        tournamentId: row.tournamentId,
        url: row.url,
        actualName: row.actualName || row.name,
        matchedRow: row.matchedRow || '',
        source: found.status.toLowerCase()
      });
    }

    return rows;
  }

  async function resolveTournamentUrl(t) {
    if (!isSafeUrlStatus(t.urlStatus)) {
      throw new Error(`URL_NOT_SAFE: ${t.name} / ${t.urlStatus}`);
    }

    const url = normalizeUrl(t.url || t.tournamentId || '');
    const id = normalizeText(t.tournamentId || getUrlId(url));
    if (!url || !id) {
      throw new Error(`URL_NOT_SAFE: ${t.name} / url or id empty`);
    }

    return {
      tournamentId: id,
      painelUrl: url,
      source: t.urlStatus,
      actualName: t.actualName
    };
  }

  async function findExistingTournament(t, state) {
    const resolved = await resolveTournamentUrl(t, state);

    state.tournamentId = resolved.tournamentId || '';
    state.painelUrl = resolved.painelUrl;
    state.urlSource = resolved.source || '';
    state.step = 'VIRTUAL_CURRENCY';
    setState(state);

    location.href = resolved.painelUrl;
  }

  // ============================================================
  // 6. Page title verification
  // ============================================================

  function getPageTournamentTitle() {
    const input = document.querySelector('input[name="titulo_torneio"]');
    if (input && input.value) return normalizeText(input.value);

    const candidates = [
      document.querySelector('h1'),
      document.querySelector('h2'),
      document.querySelector('.page-title'),
      document.querySelector('.box-title'),
      document.querySelector('.panel-title'),
      document.querySelector('.breadcrumb'),
      document.querySelector('.content-header')
    ];

    for (const el of candidates) {
      const text = normalizeText(el?.innerText || el?.textContent || '');
      if (text.includes('【') && text.includes('】')) return text;
    }

    const title = normalizeText(document.title || '');
    const m = title.match(/(.+?)\s*-\s*PokerWeb/i);
    if (m) return normalizeText(m[1]);

    const body = normalizeText(document.body?.innerText || '');
    const m2 = body.match(/(【[^】]+】\s*(?:#\d+|\(s\d+\)|s\d+)\s+[^ \n\r\t]+)/i);
    if (m2) return normalizeText(m2[1]);

    return title;
  }

  function verifyCurrentPageMatches(t, state) {
    const actualTitle = getPageTournamentTitle();
    const expected = t.name;

    if (!actualTitle) {
      appendReportToState(state, 'TITLE_WARN', `${expected} / ページタイトル取得不可。続行`);
      return;
    }

    if (compactText(actualTitle) === compactText(expected)) {
      appendReportToState(state, 'TITLE_OK', actualTitle);
      return;
    }

    if (sameTournamentByPrefixAndNo(expected, actualTitle)) {
      appendReportToState(state, 'TITLE_WARN', `名前差分ありだが同大会同番号: ${actualTitle}`);
      return;
    }

    throw new Error(`CACHE_TITLE_MISMATCH: expected=${expected} / actual=${actualTitle}`);
  }

  // ============================================================
  // 7. Configuracao / modal / POST
  // ============================================================

  async function openConfiguracao() {
    const tab =
      document.querySelector('a[href="#configuracao"]') ||
      document.querySelector('a[href="#Configuracao"]') ||
      [...document.querySelectorAll('a, button, li')]
        .find(el => {
          const text = normalizeText(el.innerText || el.textContent || '');
          const href = el.getAttribute?.('href') || '';
          const target = el.getAttribute?.('data-target') || '';
          return /configuracao|configuração/i.test(`${text} ${href} ${target}`);
        });

    if (!tab) {
      throw new Error('找不到 Configuracao 页签');
    }

    try {
      if (window.$ && tab.tagName === 'A') {
        window.$(tab).tab?.('show');
      }
    } catch (_) {}

    try {
      tab.click();
    } catch (_) {}

    await sleep(CONFIG.afterOpenConfigMs);
  }

  function closeModals() {
    try {
      if (window.$) {
        window.$('#modal_item_editar').modal('hide');
        window.$('#modal_item_inserir').modal('hide');
      }
    } catch (_) {}

    try {
      document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
      document.body.classList.remove('modal-open');
    } catch (_) {}
  }

  function applyDataToFormData(fd, data) {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined || value === null) continue;
      fd.set(key, value);
    }
  }

  async function postForm(form, data, label) {
    if (!form) throw new Error(`${label}: form 不存在`);

    const fd = new FormData(form);
    applyDataToFormData(fd, data);

    debugFormData(`${label} payload`, fd);

    const res = await fetch(form.action, {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
      redirect: 'follow'
    });

    log(`${label} POST 完成 status=${res.status}`);
    await sleep(CONFIG.afterPostMs);

    return res;
  }

  // ============================================================
  // 8. USDT / 仮想通貨販売許可
  // ============================================================

  async function enableVirtualCurrencySales(state) {
    const idTorneio = state.tournamentId || getTournamentIdFromUrl();

    if (!idTorneio) {
      throw new Error('USDT販売許可: 找不到 id_torneio');
    }

    log(`开启 USDT販売許可: id_torneio=${idTorneio}`);

    const body = new URLSearchParams();
    body.set('campo', 'vendas_moeda_virtual');
    body.set('id_torneio', idTorneio);
    body.set('status', '1');

    const res = await fetch('/cb/torneio/abas/configuracao/alterar_campos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body.toString(),
      credentials: 'same-origin'
    });

    log(`USDT販売許可 POST 完成 status=${res.status}`);
    await sleep(CONFIG.afterPostMs);

    return res;
  }

  // ============================================================
  // 9. Item payload
  // ============================================================

  function buildItemData(item, existingBtn) {
    const existingNome = existingBtn?.getAttribute?.('data-nome') || '';
    const existingSiglas = existingBtn?.getAttribute?.('data-siglas') || '';

    return {
      nome: item.nome || existingNome,
      siglas: item.siglas || existingSiglas || item.nome,
      fichas: item.fichas || '0',
      limite: item.limite || '1',
      reposicionar: item.reposicionar || '0',
      direito_img: DEFAULTS.direito_img,
      pts_ranking: DEFAULTS.pts_ranking,
      gameid_bloqueio: DEFAULTS.gameid_bloqueio,
      valor: item.valor,
      taxa: item.taxa || '0',
      rake: DEFAULTS.rake,
      taxa_extras: DEFAULTS.taxa_extras
    };
  }

  // ============================================================
  // 10. Item modal
  // ============================================================

  function findItemEditButtonByNameOrSiglas(names, siglasList) {
    const buttons = [...document.querySelectorAll('a[href="#modal_item_editar"], button[href="#modal_item_editar"], [data-nome], [data-siglas]')];

    const normalizedNames = names.map(normalizeText);
    const normalizedSiglas = siglasList.map(normalizeText);

    return buttons.find(btn => {
      const nome = normalizeText(btn.getAttribute('data-nome') || '');
      const siglas = normalizeText(btn.getAttribute('data-siglas') || '');

      return normalizedNames.includes(nome) || normalizedSiglas.includes(siglas);
    });
  }

  async function openEditModalByItemNames(names, siglasList, label) {
    await openConfiguracao();

    const btn = findItemEditButtonByNameOrSiglas(names, siglasList);

    if (!btn) {
      throw new Error(`找不到 item: ${label}`);
    }

    btn.click();
    await sleep(CONFIG.afterModalOpenMs);

    const form = document.querySelector('#modal_item_editar form');

    if (!form) {
      throw new Error(`找不到 ${label} 编辑 form`);
    }

    return { form, btn };
  }

  async function openInsertModalForItem() {
    await openConfiguracao();

    const addBtn =
      document.querySelector('a[href="#modal_item_inserir"]') ||
      [...document.querySelectorAll('a, button')]
        .find(el => isVisible(el) && /novo|新しく|追加|inserir/i.test(el.innerText || el.textContent || ''));

    if (!addBtn) {
      throw new Error('找不到「新しく追加 / inserir」按钮');
    }

    addBtn.click();
    await sleep(CONFIG.afterModalOpenMs);

    const form = document.querySelector('#modal_item_inserir form');

    if (!form) {
      throw new Error('找不到 item 新增 form');
    }

    return form;
  }

  async function saveItemDirectSmart(t, item) {
    if (!item || !item.nome || !item.valor) {
      return {
        action: 'SKIP_ITEM',
        status: 'SKIP',
        message: 'item empty'
      };
    }

    log(`开始保存项目：${t.name} / ${getItemLabel(item)}`);
    await openConfiguracao();

    const btn = findItemEditButtonByNameOrSiglas(
      [item.nome],
      [item.siglas].filter(Boolean)
    );

    if (btn) {
      log(`找到既存项目，准备编辑保存：${getItemLabel(item)}`);

      btn.click();
      await sleep(CONFIG.afterModalOpenMs);

      const form = document.querySelector('#modal_item_editar form');

      if (!form) {
        throw new Error(`找到 ${getItemLabel(item)} 铅笔，但找不到编辑 form`);
      }

      const res = await postForm(form, buildItemData(item, btn), `${getItemLabel(item)} 编辑`);
      closeModals();

      return {
        action: 'EDIT_ITEM',
        status: res.status,
        message: `既存项目编辑: ${getItemLabel(item)}`
      };
    }

    log(`当前没有项目，准备新建：${getItemLabel(item)}`);

    const form = await openInsertModalForItem();

    const res = await postForm(form, buildItemData(item, null), `${getItemLabel(item)} 新增`);
    closeModals();

    return {
      action: 'INSERT_ITEM',
      status: res.status,
      message: `新增项目: ${getItemLabel(item)}`
    };
  }

  // ============================================================
  // 11. Flow
  // ============================================================

  async function moveToNextTournamentOrDone(state) {
    const nextIndex = Number(state.tournamentIndex || 0) + 1;
    const list = state.tournaments || [];

    if (nextIndex >= list.length) {
      state.step = 'DONE';
      state.running = false;

      appendReportToState(state, 'DONE', `所有比赛处理完成：${list.length} 件`);
      log('所有比赛处理完成');
      return;
    }

    state.tournamentIndex = nextIndex;
    state.step = 'FIND_EXISTING';
    state.tournamentId = '';
    state.painelUrl = '';
    state.urlSource = '';
    state.titleVerified = false;
    state.itemIndex = 0;
    setState(state);

    const nextTournament = list[nextIndex];

    log(`准备处理下一场：${nextTournament.name}`);
    appendReportToState(state, 'NEXT', `${nextIndex + 1}/${list.length} ${nextTournament.name}`);

    await sleep(800);

    runCurrentStep();
  }

  async function runCurrentStep() {
    const state = getState();

    if (!state.running) {
      log('ready');
      renderLastReport();
      return;
    }

    if (manualStop) {
      log('已请求停止');
      return;
    }

    let t = null;

    try {
      t = getCurrentTournament(state);
      const currentId = getTournamentIdFromUrl();

      if (currentId && !state.tournamentId) {
        state.tournamentId = currentId;
        state.painelUrl = getTournamentUrl(currentId);
        setState(state);
        log(`记录 tournamentId=${currentId}`);
      }

      log(`当前比赛 ${Number(state.tournamentIndex || 0) + 1}/${state.tournaments.length}: ${t.name} / step=${state.step}`);

      if (state.step === 'FIND_EXISTING') {
        await findExistingTournament(t, state);
        return;
      }

      if (!isPainelPage()) {
        if (state.painelUrl) {
          log(`当前不是详情页，跳转到 ${state.painelUrl}`);
          location.href = state.painelUrl;
          return;
        }

        throw new Error(`当前不是比赛详情页，无法继续 ${state.step}。当前URL=${location.href}`);
      }

      if (!state.titleVerified) {
        verifyCurrentPageMatches(t, state);
        state.titleVerified = true;
        setState(state);
      }

      if (state.step === 'VIRTUAL_CURRENCY') {
        const res = await enableVirtualCurrencySales(state);
        appendReportToState(state, 'USDT_OK', `${t.name} / status=${res.status}`);

        state.step = 'ITEMS';
        state.itemIndex = 0;
        setState(state);

        log('USDT販売許可完成，刷新后继续 items');
        await sleep(800);
        location.reload();
        return;
      }

      if (state.step === 'ITEMS') {
        const items = t.items || [];
        const itemIndex = Number(state.itemIndex || 0);

        if (itemIndex >= items.length) {
          await moveToNextTournamentOrDone(state);
          return;
        }

        const item = items[itemIndex];
        const result = await saveItemDirectSmart(t, item);

        appendReportToState(
          state,
          'ITEM_OK',
          `${t.name} / ${itemIndex + 1}/${items.length} / ${result.message} / ${itemFeeText(item)} / Chips=${item.fichas || '0'} / status=${result.status}`
        );

        state.itemIndex = itemIndex + 1;
        setState(state);

        log(`项目完成，刷新后继续下一个：${itemIndex + 1}/${items.length}`);
        await sleep(800);
        location.reload();
        return;
      }

      if (state.step === 'DONE') {
        state.running = false;
        setState(state);
        log('全部完成');
        return;
      }

      throw new Error(`未知步骤: ${state.step}`);

    } catch (e) {
      console.error('[PW-ITEM-UPDATE] flow error:', e);

      const state2 = getState();
      appendReportToState(
        state2,
        'ERROR',
        `${t?.name || '(unknown)'} / step=${state2.step || state.step || ''} / ${e.message || e}`
      );

      warn(`失败：${e.message || e}`);
      // 不清状态，方便检查。需要停用就点 Stop。
    }
  }

  function getCandidateTextareaValue() {
    return document.querySelector('#pw-item-update-candidates')?.value || '';
  }

  function setCandidateTextareaValue(text) {
    const box = document.querySelector('#pw-item-update-candidates');
    if (box) box.value = text || '';
    localStorage.setItem(CONFIG.candidateKey, text || '');
  }

  function parseCandidateRows(raw) {
    const lines = String(raw || '')
      .split(/\r?\n/)
      .map(x => x.replace(/\uFEFF/g, ''))
      .filter(x => normalizeText(x));

    if (!lines.length) return [];

    const header = lines[0].split('\t').map(normalizeText);
    const idx = (...names) => {
      for (const n of names) {
        const i = header.findIndex(h => normalizeText(h).toLowerCase() === normalizeText(n).toLowerCase());
        if (i >= 0) return i;
      }
      return -1;
    };

    const iUse = idx('USE');
    const iName = idx('大会名', 'Name');
    const iTournamentId = idx('TournamentId', 'ID');
    const iUrl = idx('URL');
    const iStatus = idx('判定', 'Status');
    const iReason = idx('理由', 'Reason');

    if (iName < 0) throw new Error('候補表里找不到 大会名 列');

    return lines.slice(1).map((line, lineIndex) => {
      const c = line.split('\t');
      const get = i => (i >= 0 ? normalizeText(c[i]) : '');
      const name = get(iName);
      if (!name) return null;

      const tournamentId = get(iTournamentId);
      const url = normalizeUrl(get(iUrl) || tournamentId);
      const items = buildItemListFromColumns(idx, get, { header, includeLegacy: true });
      const entry = items.find(item => normalizeText(item.siglas) === DEFAULTS.entrySiglas) || {};
      const reEntry = items.find(item => normalizeText(item.siglas) === DEFAULTS.reSiglas) || {};
      const ticketEntry = items.find(item => ['Ti', 'TE', 'TIX'].includes(normalizeText(item.siglas))) || null;

      return {
        name,
        tournamentId,
        url,
        use: get(iUse),
        urlStatus: get(iStatus) || 'URL未解決',
        statusReason: get(iReason),
        items,
        entry,
        reEntry,
        ticketEntry,

        _line: lineIndex + 1
      };
    }).filter(Boolean);
  }

  function validateCandidateUrlRows(rows) {
    const errors = [];

    rows.forEach((r, i) => {
      const prefix = `${i + 1}: ${r.name}`;
      const status = normalizeText(r.urlStatus);
      const url = normalizeUrl(r.url || r.tournamentId || '');
      const id = normalizeText(r.tournamentId || getUrlId(url));
      const urlId = getUrlId(url);

      if (!isSafeUrlStatus(status)) {
        errors.push(`${prefix} URLが安全確定していない: ${status || '(empty)'}`);
        return;
      }

      if (!url || !id) {
        errors.push(`${prefix} URL/TournamentId empty`);
        return;
      }

      if (r.tournamentId && urlId && r.tournamentId !== urlId) {
        errors.push(`${prefix} CACHE_ID_MISMATCH: id=${r.tournamentId} urlId=${urlId}`);
      }
    });

    return errors;
  }

  function startFlow() {
    let candidates;

    try {
      candidates = parseCandidateRows(getCandidateTextareaValue());
    } catch (e) {
      alert(`候補表解析失败：${e.message || e}`);
      return;
    }

    if (!candidates.length) {
      alert('候補表为空。请先执行 Preview / Parse Test。');
      return;
    }

    const dataErrors = validateTournamentList(candidates);
    const urlErrors = validateCandidateUrlRows(candidates);
    const errors = [...dataErrors, ...urlErrors];

    if (errors.length) {
      alert(
        `URLが安全確定していない候補があります。\n\n` +
        errors.slice(0, 20).join('\n') +
        (errors.length > 20 ? `\n...还有 ${errors.length - 20} 个` : '')
      );
      return;
    }

    const tournaments = candidates
      .filter(t => normalizeText(t.use) === '1')
      .filter(t => isSafeUrlStatus(t.urlStatus));

    if (!tournaments.length) {
      alert('USE=1 かつ URL安全確定済みの候補がありません。');
      return;
    }

    const summary = tournaments.map((t, i) => {
      return `${i + 1}. ${t.name}\n   URL=${t.urlStatus} ${t.url}\n   Items=${itemListText(t.items)}`;
    }).join('\n\n');

    const ok = confirm(
      `确认开始更新既存比赛项目？\n\n` +
      `这版不会创建比赛、不会改时间、不会设置盲注、不会 link ticket。\n` +
      `会开启「USDT販売許可 / 仮想通貨販売許可」。\n\n` +
      `Shared URL Cache: ${sharedCacheCount()} 件\n` +
      `USE=1: ${tournaments.length} 件\n\n` +
      `${summary}`
    );

    if (!ok) return;

    manualStop = false;

    const report = [];
    report.push(makeReportLine('START', `开始更新：${tournaments.length} 件 / Cache=${sharedCacheCount()}`));

    tournaments.forEach((t, i) => {
      report.push(`${i + 1}. ${t.name} / ${t.urlStatus}=${t.url} / Items=${itemListText(t.items)}`);
    });

    const state = {
      running: true,
      tournamentIndex: 0,
      step: 'FIND_EXISTING',
      tournamentId: '',
      painelUrl: '',
      urlSource: '',
      titleVerified: false,
      itemIndex: 0,
      tournaments,
      report
    };

    setState(state);
    localStorage.setItem(CONFIG.lastReportKey, report.join('\n'));

    runCurrentStep();
  }

  function stopFlow() {
    manualStop = true;

    const state = getState();
    if (state && state.report) {
      appendReportToState(state, 'STOP', '手動停止 / 状態クリア');
    }

    clearState();
    log('已停止并清除状态');
  }

  function previewParsedInput() {
    const raw = document.querySelector('#pw-item-update-input')?.value || '';

    try {
      const list = parseTournamentInput(raw);
      const errors = validateTournamentList(list);

      console.log('[PW-ITEM-UPDATE] parsed tournaments');
      console.table(list);

      const candidates = makeCandidateRows(list);
      setCandidateTextareaValue(candidateRowsToTsv(candidates));

      const report = makePreviewReport(list, errors);
      renderReport(report);

      if (errors.length) {
        alert(`解析 ${list.length} 件，但有问题：\n\n${errors.slice(0, 20).join('\n')}`);
      } else {
        alert(`解析成功：${list.length} 件。Report框已显示预览。`);
      }
    } catch (e) {
      renderReport([makeReportLine('PREVIEW_ERROR', e.message || String(e))]);
      alert(`解析失败：${e.message || e}`);
    }
  }

  async function resolveCandidateUrlsFromUi() {
    const rawInput = document.querySelector('#pw-item-update-input')?.value || '';
    let candidates;

    try {
      candidates = parseCandidateRows(getCandidateTextareaValue());

      if (!candidates.length) {
        const list = parseTournamentInput(rawInput);
        const errors = validateTournamentList(list);
        if (errors.length) {
          renderReport(makePreviewReport(list, errors));
          alert(`设定数据有问题，请先修正：\n\n${errors.slice(0, 20).join('\n')}`);
          return;
        }
        candidates = makeCandidateRows(list);
      }

      log(`URL Resolve start: ${candidates.filter(shouldResolveCandidate).length} 件`);
      renderReport([makeReportLine('URL_RESOLVE', `検索対象 ${candidates.filter(shouldResolveCandidate).length} 件`)]);

      await resolveUrlForCandidates(candidates);

      const text = candidateRowsToTsv(candidates);
      setCandidateTextareaValue(text);
      renderReport([makeReportLine('URL_RESOLVE_DONE', `候補 ${candidates.length} 件`), text]);
      alert('URL Resolve 完成。候補表を確認してください。');
    } catch (e) {
      console.error('[PW-ITEM-UPDATE] resolve error:', e);
      renderReport([makeReportLine('URL_RESOLVE_ERROR', e.message || String(e))]);
      alert(`URL Resolve 失败：${e.message || e}`);
    }
  }

  function copyReport() {
    const box = document.querySelector('#pw-item-update-report');
    const text = box?.value || '';

    if (!text) {
      alert('Report为空');
      return;
    }

    try {
      navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }

    alert('Report copied');
  }

  function clearReportOnly() {
    const state = getState();
    state.report = [];
    setState(state);
    localStorage.removeItem(CONFIG.lastReportKey);
    renderReport([]);
    log('Report cleared');
  }

  // ============================================================
  // 12. UI
  // ============================================================

  function addPanel() {
    if (document.querySelector('#pw-item-update-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'pw-item-update-panel';

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
      width: 590px;
      max-height: 94vh;
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;

    const saved = localStorage.getItem(CONFIG.inputKey) || [
      'Name\tTournamentId\tURL\tItem1_Name\tItem1_Siglas\tItem1_Value\tItem1_Tax\tItem1_Chips\tItem1_Limit\tItem1_Reposicionar\tItem2_Name\tItem2_Siglas\tItem2_Value\tItem2_Tax\tItem2_Chips\tItem2_Limit\tItem2_Reposicionar\tItem3_Name\tItem3_Siglas\tItem3_Value\tItem3_Tax\tItem3_Chips\tItem3_Limit\tItem3_Reposicionar',
      '【SPADIE season 41st】#02 NLH Emotional Heart\t4484\t/cb/torneio/painel/4484\tEntry\tEn\t5,000\t1,000\t30,000\t1\t0\tRe Entry\tRe\t5,000\t0\t30,000\t3\t1',
      '【物販 SAMPLE】#01 Goods Booth\t9999\t/cb/torneio/painel/9999\tT-Shirt\tTS\t3,000\t0\t0\t0\t0\tHoodie\tHD\t8,000\t0\t0\t0\t0\tSticker\tST\t500\t0\t0\t0\t0'
    ].join('\n');

panel.innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
    <div style="font-weight:bold;">
      PW 既存大会 Item 更新 人工確認版 v0.6
    </div>
    <div style="display:flex;gap:4px;">
      <button id="pw-item-update-minimize" style="font-size:11px;padding:2px 6px;cursor:pointer;">Min</button>
      <button id="pw-item-update-close" style="font-size:11px;padding:2px 6px;cursor:pointer;">×</button>
    </div>
  </div>

  <div id="pw-item-update-body">

      <div style="font-size:11px;color:#ccc;line-height:1.35;">
        URL取得順：Preview → URL Resolve → 人工確認 → START<br>
        Shared Cache key: <code>${SHARED_URL_CACHE_KEY}</code><br>
        作成・時間変更・盲注設定・Ticket Linkなし / Item列は Item1, Item2... 無制限
      </div>

      <textarea id="pw-item-update-input"
        style="width:100%;height:170px;background:#111;color:#fff;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

      <button id="pw-item-update-preview"
        style="width:100%;padding:7px;cursor:pointer;background:#d9ecff;border:1px solid #88a;">
        Preview / Parse Test
      </button>

      <div style="font-size:12px;font-weight:bold;color:#fff;">URL Candidates / 候補確認</div>
      <textarea id="pw-item-update-candidates"
        style="width:100%;height:155px;background:#111;color:#fff;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

      <button id="pw-item-update-resolve"
        style="width:100%;padding:7px;cursor:pointer;background:#d7f5d8;border:1px solid #8a8;">
        URL Resolve / URL未解決検索
      </button>

      <button id="pw-item-update-start"
        style="width:100%;padding:7px;cursor:pointer;background:#ffe08a;border:1px solid #c99;">
        START 更新既存大会 Item
      </button>

      <button id="pw-item-update-stop"
        style="width:100%;padding:7px;cursor:pointer;background:#f3cccc;border:1px solid #c88;">
        Stop / Clear State
      </button>

      <div style="display:flex;gap:6px;">
        <button id="pw-item-update-copy-report"
          style="flex:1;padding:6px;cursor:pointer;background:#eee;border:1px solid #aaa;">
          Copy Report
        </button>

        <button id="pw-item-update-clear-report"
          style="flex:1;padding:6px;cursor:pointer;background:#eee;border:1px solid #aaa;">
          Clear Report
        </button>
      </div>

      <div style="font-size:11px;color:#f6d365;line-height:1.35;">
        ※ Item列は Item1_Name / Item1_Value ... Item2_Name ... の形式<br>
        ※ 同名/同Siglasの既存項目があれば編集、なければ新增<br>
        ※ 旧 EN/RE/Ticket 表頭もまだ読み込み可能<br>
        ※ URL未解決 / AMBIGUOUS / bad cache が残る場合 START禁止<br>
        ※ 手動URLは TournamentId/URL を入れて判定=OK_MANUAL
      </div>

      <div style="font-size:12px;font-weight:bold;color:#fff;">Report / 実行結果</div>
      <textarea id="pw-item-update-report"
        readonly
        style="width:100%;height:170px;background:#111;color:#9fe;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

      <div id="pw-item-update-status"
        style="font-size:11px;color:#9fe;line-height:1.35;white-space:pre-wrap;">
        ready
      </div>
    </div>
    `;
    document.body.appendChild(panel);

    const textarea = document.querySelector('#pw-item-update-input');
    textarea.value = saved;

    const candidateTextarea = document.querySelector('#pw-item-update-candidates');
    if (candidateTextarea) {
      candidateTextarea.value = localStorage.getItem(CONFIG.candidateKey) || '';
      candidateTextarea.addEventListener('change', () => {
        localStorage.setItem(CONFIG.candidateKey, candidateTextarea.value || '');
      });
    }

    document.querySelector('#pw-item-update-preview').onclick = () => previewParsedInput();
    document.querySelector('#pw-item-update-resolve').onclick = () => resolveCandidateUrlsFromUi();
    document.querySelector('#pw-item-update-start').onclick = () => startFlow();
    document.querySelector('#pw-item-update-stop').onclick = () => stopFlow();
    document.querySelector('#pw-item-update-copy-report').onclick = () => copyReport();
    document.querySelector('#pw-item-update-clear-report').onclick = () => clearReportOnly();
    document.querySelector('#pw-item-update-minimize').onclick = () => {
  const body = document.querySelector('#pw-item-update-body');
  const btn = document.querySelector('#pw-item-update-minimize');

  if (!body || !btn) return;

  const hidden = body.style.display === 'none';
  body.style.display = hidden ? 'block' : 'none';
  btn.textContent = hidden ? 'Min' : 'Open';

  localStorage.setItem('PW_ITEM_UPDATE_PANEL_MINIMIZED_V04', hidden ? '0' : '1');
};

document.querySelector('#pw-item-update-close').onclick = () => {
  const panel = document.querySelector('#pw-item-update-panel');
  if (panel) panel.style.display = 'none';
};

    renderLastReport();
  }

  function boot() {
    addPanel();

    window.PWExistingItemUpdateUI = {
      startFlow,
      stopFlow,
      runCurrentStep,
      parseTournamentInput,
      parseCandidateRows,
      previewParsedInput,
      resolveCandidateUrlsFromUi,
      resolveTournamentUrl,
      findExistingTournament,
      enableVirtualCurrencySales,
      saveItemDirectSmart,
      buildItemData,
      getState,
      clearState,
      appendReport,
      copyReport,
      loadSharedUrlCache,
      validateUrlCacheItem,
      findSharedCacheByName,
      setSharedCacheItem,
      getCachedTournamentUrl,
      setCachedTournamentUrl,
      getDataTableInWindow,
      dataTableSearchAndWait,
      findTournamentFromCurrentDataTablePage,
      searchTournamentInListWindow,
      resolveUrlForCandidates,
      isSafeUrlStatus
    };

    setTimeout(() => {
      const state = getState();

      if (state.running && state.step) {
        runCurrentStep();
      } else {
        log(`ready / SharedCache=${sharedCacheCount()} 件`);
        renderLastReport();
      }
    }, CONFIG.afterReloadMs);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
