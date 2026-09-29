// ==UserScript==
// @name         PW 既存大会 Item 更新 人工確認版
// @namespace    pw-existing-tournament-item-updater-ui
// @version      0.7.4
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-existing-tournament-item-updater.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-existing-tournament-item-updater.user.js
// @description  OPEN/CLOSED URL poolを后台一括取得して人工確認後、販売項目の全体更新、后台局部更新と大会名修正を行う。
// @author       xhpc007 + ChatGPT
// @match        https://japanopt.bt.pokerweb.com.br/*
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
      .replace(/\s*監査(?:済み|待ち)\s*$/g, '')
      .trim();
  }

  function compactText(s) {
    return normalizeText(s).replace(/\s+/g, '');
  }

  function normalizeRenameText(s) {
    return String(s || '').replace(/\r/g, '').trim();
  }

  function isExactRenameTarget(currentName, targetName) {
    return normalizeRenameText(currentName) === normalizeRenameText(targetName);
  }

  function isVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  function isPainelPage() {
    return /\/torneio\/painel\/\d+/.test(location.href);
  }

  function getTournamentIdFromUrl(url = location.href) {
    const m = String(url).match(/\/(?:cb\/)?torneio\/painel\/(\d+)/);
    return m ? m[1] : '';
  }

  function getTournamentUrl(id) {
    return `/torneio/painel/${id}`;
  }

  function normalizeUrl(urlOrId) {
    const s = normalizeText(urlOrId);
    if (!s) return '';

    const m = s.match(/\/(?:cb\/)?torneio\/painel\/(\d+)/);
    if (m) return `/torneio/painel/${m[1]}`;

    if (/^\d+$/.test(s)) return `/torneio/painel/${s}`;

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

  const PARTIAL_ITEM_FIELDS = [
    {
      group: 'EN', itemNames: ['Entry'], siglas: ['En'], property: 'nome', label: 'EN名称', text: true,
      aliases: ['EN名称', 'EN_Name', 'EN Name', 'Entry名称', 'Entry_Name', 'Entry Name']
    },
    {
      group: 'EN', itemNames: ['Entry'], siglas: ['En'], property: 'siglas', label: 'EN略称', text: true,
      aliases: ['EN略称', 'EN_Siglas', 'EN Code', 'Entry略称', 'Entry_Siglas', 'Entry Code']
    },
    {
      group: 'EN', itemNames: ['Entry'], siglas: ['En'], property: 'valor', label: 'EN金額',
      aliases: ['EN', 'EN金額', 'EN金额', 'EN_Value', 'EN Value', 'EN_Amount', 'EN Amount', 'Entry', 'Entry金額', 'Entry金额', 'Entry_Value', 'Entry Value', 'Entry_Amount', 'Entry Amount']
    },
    {
      group: 'EN', itemNames: ['Entry'], siglas: ['En'], property: 'taxa', label: 'EN手数料',
      aliases: ['EN_Tax', 'EN Tax', 'EN_Taxa', 'EN手数料', 'EN手续费', 'Entry_Tax', 'Entry Tax', 'Entry手数料', 'Entry手续费']
    },
    {
      group: 'EN', itemNames: ['Entry'], siglas: ['En'], property: 'fichas', label: 'ENチップ数',
      aliases: ['EN_Chips', 'EN Chips', 'ENチップ数', 'EN筹码', 'Entry_Chips', 'Entry Chips', 'Entryチップ数', 'Entry筹码']
    },
    {
      group: 'EN', itemNames: ['Entry'], siglas: ['En'], property: 'limite', label: 'EN回数',
      aliases: ['EN回数', 'EN_Limit', 'EN Limit', 'EN上限', 'Entry回数', 'Entry_Limit', 'Entry Limit', 'Entry上限']
    },
    {
      group: 'EN', itemNames: ['Entry'], siglas: ['En'], property: 'reposicionar', label: 'EN再配置',
      aliases: ['EN_Reposicionar', 'EN_Repo', 'EN Reposicionar', 'EN再配置', 'Entry_Reposicionar', 'Entry_Repo', 'Entry Reposicionar', 'Entry再配置']
    },
    {
      group: 'RE', itemNames: ['Re Entry', 'ReEntry'], siglas: ['Re'], property: 'nome', label: 'RE名称', text: true,
      aliases: ['RE名称', 'RE_Name', 'RE Name', 'Re Entry名称', 'ReEntry名称', 'Re Entry_Name', 'ReEntry_Name']
    },
    {
      group: 'RE', itemNames: ['Re Entry', 'ReEntry'], siglas: ['Re'], property: 'siglas', label: 'RE略称', text: true,
      aliases: ['RE略称', 'RE_Siglas', 'RE Code', 'Re Entry略称', 'ReEntry略称', 'Re Entry_Siglas', 'ReEntry_Siglas']
    },
    {
      group: 'RE', itemNames: ['Re Entry', 'ReEntry'], siglas: ['Re'], property: 'valor', label: 'RE金額',
      aliases: ['RE', 'RE金額', 'RE金额', 'RE_Value', 'RE Value', 'RE_Amount', 'RE Amount', 'Re Entry', 'ReEntry', 'Re Entry金額', 'ReEntry金額', 'Re Entry_Value', 'ReEntry_Value']
    },
    {
      group: 'RE', itemNames: ['Re Entry', 'ReEntry'], siglas: ['Re'], property: 'taxa', label: 'RE手数料',
      aliases: ['RE_Tax', 'RE Tax', 'RE_Taxa', 'RE手数料', 'RE手续费', 'Re Entry_Tax', 'ReEntry_Tax', 'Re Entry手数料', 'ReEntry手数料']
    },
    {
      group: 'RE', itemNames: ['Re Entry', 'ReEntry'], siglas: ['Re'], property: 'fichas', label: 'REチップ数',
      aliases: ['RE_Chips', 'RE Chips', 'REチップ数', 'RE筹码', 'Re Entry_Chips', 'ReEntry_Chips', 'Re Entryチップ数', 'ReEntryチップ数']
    },
    {
      group: 'RE', itemNames: ['Re Entry', 'ReEntry'], siglas: ['Re'], property: 'limite', label: 'RE回数',
      aliases: ['RE回数', 'RE_Limit', 'RE Limit', 'RE上限', 'Re Entry回数', 'ReEntry回数', 'Re Entry_Limit', 'ReEntry_Limit', 'Re Entry上限', 'ReEntry上限']
    },
    {
      group: 'RE', itemNames: ['Re Entry', 'ReEntry'], siglas: ['Re'], property: 'reposicionar', label: 'RE再配置',
      aliases: ['RE_Reposicionar', 'RE_Repo', 'RE Reposicionar', 'RE再配置', 'Re Entry_Reposicionar', 'ReEntry_Repo', 'Re Entry再配置', 'ReEntry再配置']
    },
    {
      group: 'TE', itemNames: ['Ticket Entry', 'Ticket'], siglas: ['TE', 'Ti', 'TIX'], property: 'nome', label: 'TE名称', text: true,
      aliases: ['TE名称', 'TE_Name', 'TE Name', 'Ticket名称', 'Ticket Entry名称', 'Ticket_Name', 'Ticket Entry_Name']
    },
    {
      group: 'TE', itemNames: ['Ticket Entry', 'Ticket'], siglas: ['TE', 'Ti', 'TIX'], property: 'siglas', label: 'TE略称', text: true,
      aliases: ['TE略称', 'TE_Siglas', 'TE Code', 'Ticket略称', 'Ticket Entry略称', 'Ticket_Siglas', 'Ticket Entry_Siglas']
    },
    {
      group: 'TE', itemNames: ['Ticket Entry', 'Ticket'], siglas: ['TE', 'Ti', 'TIX'], property: 'valor', label: 'TE金額',
      aliases: ['TE', 'TIX', 'Ticket', 'TE金額', 'TE金额', 'TE_Value', 'TE Value', 'Ticket金額', 'Ticket金额', 'Ticket_Value', 'Ticket Value', 'Ticket Entry金額', 'Ticket Entry_Value']
    },
    {
      group: 'TE', itemNames: ['Ticket Entry', 'Ticket'], siglas: ['TE', 'Ti', 'TIX'], property: 'taxa', label: 'TE手数料',
      aliases: ['TE_Tax', 'TIX_Tax', 'Ticket_Tax', 'TE Tax', 'Ticket Tax', 'TE手数料', 'TE手续费', 'Ticket手数料', 'Ticket手续费']
    },
    {
      group: 'TE', itemNames: ['Ticket Entry', 'Ticket'], siglas: ['TE', 'Ti', 'TIX'], property: 'fichas', label: 'TEチップ数',
      aliases: ['TE_Chips', 'TIX_Chips', 'Ticket_Chips', 'TE Chips', 'Ticket Chips', 'TEチップ数', 'TE筹码', 'Ticketチップ数', 'Ticket筹码']
    },
    {
      group: 'TE', itemNames: ['Ticket Entry', 'Ticket'], siglas: ['TE', 'Ti', 'TIX'], property: 'limite', label: 'TE回数',
      aliases: ['TE回数', 'TE_Limit', 'TIX_Limit', 'Ticket回数', 'Ticket_Limit', 'TE Limit', 'Ticket Limit', 'TE上限', 'Ticket上限']
    },
    {
      group: 'TE', itemNames: ['Ticket Entry', 'Ticket'], siglas: ['TE', 'Ti', 'TIX'], property: 'reposicionar', label: 'TE再配置',
      aliases: ['TE_Reposicionar', 'TIX_Repo', 'Ticket_Reposicionar', 'Ticket_Repo', 'TE再配置', 'Ticket再配置']
    }
  ];

  function normalizePartialPatchValue(def, rawValue) {
    if (def.text) {
      const value = normalizeText(rawValue);
      if (!value) throw new Error(`${def.label} cannot be empty`);
      return value;
    }
    const value = ['limite', 'reposicionar'].includes(def.property)
      ? normalizePlainNumber(rawValue)
      : normalizeMoneyForPW(rawValue);
    const plain = String(value || '').replace(/,/g, '');
    if (!plain || !/^-?\d+$/.test(plain)) {
      throw new Error(`${def.label} must be numeric: ${rawValue}`);
    }
    return value;
  }

  function buildPartialItemPatchesFromColumns(idx, get) {
    return sortPartialItemPatches(PARTIAL_ITEM_FIELDS.flatMap(def => {
      const columnIndex = idx(...def.aliases);
      const rawValue = get(columnIndex);
      if (columnIndex < 0 || rawValue === '') return [];
      return [{ ...def, value: normalizePartialPatchValue(def, rawValue) }];
    }));
  }

  function sortPartialItemPatches(patches) {
    const groupOrder = { EN: 0, RE: 1, TE: 2 };
    const propertyOrder = { valor: 0, taxa: 1, fichas: 2, limite: 3, reposicionar: 4, nome: 5, siglas: 6 };
    return [...(patches || [])].sort((a, b) =>
      (groupOrder[a.group] ?? 99) - (groupOrder[b.group] ?? 99) ||
      (propertyOrder[a.property] ?? 99) - (propertyOrder[b.property] ?? 99)
    );
  }

  function partialPatchesToText(patches) {
    return (patches || []).map(patch => `${patch.label}=${patch.value}`).join(' | ');
  }

  function parsePartialPatchesText(text) {
    const byLabel = new Map(PARTIAL_ITEM_FIELDS.map(def => [def.label, def]));
    return sortPartialItemPatches(String(text || '')
      .split('|')
      .map(part => normalizeText(part))
      .filter(Boolean)
      .map(part => {
        const match = part.match(/^(.+?)=(.*)$/);
        if (!match) throw new Error(`局部修改格式错误: ${part}`);
        const def = byLabel.get(normalizeText(match[1]));
        if (!def) throw new Error(`未知局部修改字段: ${match[1]}`);
        return { ...def, value: normalizePartialPatchValue(def, match[2]) };
      }));
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

  function isTournamentRowNameMatch(inputName, actualName, rowText = '') {
    const input = compactText(inputName);
    const actual = compactText(actualName);
    const row = compactText(rowText);

    if (!input) return false;
    if (actual === input) return true;
    if (actual && actual.includes(input)) return true;
    if (row && row.includes(input)) return true;

    return false;
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

    if (actualName && expectedName && !isTournamentRowNameMatch(expectedName, actualName, actualName)) {
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
        source: String(item.source || 'shared-cache'),
        sameNameStatus: String(item.sameNameStatus || item.Same_Name_Status || '')
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
      const validDuplicate = valid.every(item => item.sameNameStatus === 'VALID_DUPLICATE');
      return {
        ok: false,
        status: validDuplicate ? 'URL_VALID_DUPLICATE' : 'URL_AMBIGUOUS',
        reason: `${cleanName}: ${validDuplicate ? '合法同名' : '同名未分类'} / candidates=${valid.map(item => item.tournamentId).join(',')}`,
        matches: valid
      };
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
      firstCols.includes('新大会名') ||
      firstCols.includes('New_Name') ||
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
    const iItemUpdateMode = idx('Item_Update_Mode', 'Item Update Mode', 'Update_Mode', '更新模式');
    const iNewName = idx('新大会名', 'New_Name', 'New Name', 'New Tournament Name');

    if (iName < 0) {
      throw new Error('TSV里找不到 Name 列');
    }

    return dataLines.map((line, lineIndex) => {
      const c = line.split('\t');
      const get = i => (i >= 0 ? normalizeText(c[i]) : '');
      const getRename = i => (i >= 0 ? normalizeRenameText(c[i]) : '');

      const name = get(iName);
      if (!name) return null;

      const tournamentId = get(iTournamentId);
      const urlRaw = get(iUrl);
      const url = normalizeUrl(urlRaw || tournamentId);
      const items = buildItemListFromColumns(idx, get, { header, includeLegacy: false });
      const itemPatches = buildPartialItemPatchesFromColumns(idx, get);
      const entry = items.find(item => normalizeText(item.siglas) === DEFAULTS.entrySiglas) || {};
      const reEntry = items.find(item => normalizeText(item.siglas) === DEFAULTS.reSiglas) || {};
      const ticketEntry = items.find(item => ['Ti', 'TE', 'TIX'].includes(normalizeText(item.siglas))) || null;

      return {
        name,
        newName: getRename(iNewName),
        tournamentId,
        url,
        itemUpdateMode: get(iItemUpdateMode),
        items,
        itemPatches,
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
      if ((!Array.isArray(t.items) || !t.items.length) && (!Array.isArray(t.itemPatches) || !t.itemPatches.length) && !normalizeText(t.newName)) {
        errors.push(`${i + 1}: ${t.name} item, 局部修改 and 新大会名 all empty`);
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
    return String(row.innerHTML || '').includes('/torneio/painel/');
  }

  function extractTournamentTitleFromRow(rowText) {
    const s = normalizeText(rowText);

    const mShort = s.match(/(【[^】]+】\s*.+?)(?:\s+\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2})?|\s+Aberto|\s+Fechado|\s+オープン|\s+クローズ|$)/i);
    if (mShort) return normalizeText(mShort[1]);

    const m = s.match(/(【[^】]+】\s*(?:#\d+|\(s\d+\)|s\d+)\s+.+?)(?:\s+\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2})?|\s+Aberto|\s+Fechado|\s+オープン|\s+クローズ|$)/i);
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

    if (wanted && !rowAll.includes(wanted)) {
      return null;
    }

    const links = [...row.querySelectorAll('a[href]')];

    const painelLink =
      links.find(a => String(a.getAttribute('href') || '').includes('/torneio/painel/')) ||
      links.find(a => String(a.href || '').includes('/torneio/painel/'));

    const href = painelLink ? (painelLink.getAttribute('href') || painelLink.href) : rowHtml;
    const m = String(href).match(/\/(?:cb\/)?torneio\/painel\/(\d+)/);

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
      '本次处理',
      '大会名',
      '新大会名',
      'TournamentId',
      'URL',
      '判定',
      '理由',
      'Item_Update_Mode',
      '局部修改',
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
        normalizeText(r.use) === '1' ? '使用' : '不使用',
        r.name || '',
        r.newName || '',
        r.tournamentId || '',
        r.url || '',
        r.urlStatus || '',
        r.statusReason || '',
        r.itemUpdateMode || '',
        partialPatchesToText(r.itemPatches),
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
      if (!isTournamentRowNameMatch(inputName, found.actualName, found.rowText)) continue;
      matches.push(found);
    }

    const seen = new Set();
    const unique = matches.filter(x => {
      if (seen.has(x.painelUrl)) return false;
      seen.add(x.painelUrl);
      return true;
    });

    const exact = unique.filter(x => isSameTournamentExactSafe(inputName, x.actualName));

    if (exact.length === 1) {
      return { status: 'FOUND', match: exact[0] };
    }

    if (exact.length > 1) {
      return { status: 'AMBIGUOUS', matches: exact };
    }

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
      'URL_VALID_DUPLICATE',
      'AMBIGUOUS',
      'URL_INPUT_INVALID',
      'CACHE_ID_MISMATCH',
      'CACHE_NAME_ACTUAL_MISMATCH'
    ].includes(normalizeText(c.urlStatus));
  }

  function createTournamentListFrame(path) {
    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.src = new URL(path, location.origin).href;
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:850px;opacity:0;pointer-events:none;z-index:-1;';
      const timer = setTimeout(() => {
        frame.remove();
        reject(new Error(`URL pool frame timeout: ${path}`));
      }, CONFIG.searchTimeoutMs);
      frame.onload = () => {
        clearTimeout(timer);
        resolve(frame);
      };
      frame.onerror = () => {
        clearTimeout(timer);
        frame.remove();
        reject(new Error(`URL pool frame load failed: ${path}`));
      };
      document.body.appendChild(frame);
    });
  }

  async function drawDataTablePage(win, dt, pageIndex) {
    await waitForProcessingGone(win);
    const drawPromise = waitForNextDraw(win, dt);
    try { dt.page(pageIndex); } catch (_) {}
    try { dt.draw(false); } catch (_) { dt.draw(); }
    await drawPromise;
    await waitForProcessingGone(win);
  }

  async function scanTournamentPool(path, sourceLabel) {
    const frame = await createTournamentListFrame(path);
    const win = frame.contentWindow;
    const found = [];
    try {
      const dt = await waitForDataTableReadyInWindow(win);
      await waitForProcessingGone(win);

      let drawPromise = waitForNextDraw(win, dt);
      try { dt.search(''); } catch (_) {}
      try { dt.page.len(100); } catch (_) {}
      try { dt.page(0); } catch (_) {}
      try { dt.draw(); } catch (_) { dt.draw(false); }
      await drawPromise;
      await waitForProcessingGone(win);

      const pageInfo = dt.page.info();
      const pages = Math.max(1, Number(pageInfo?.pages || 1));
      for (let page = 0; page < pages; page++) {
        if (page > 0) await drawDataTablePage(win, dt, page);
        const tableNode = dt?.table?.().node?.();
        const rows = [...(tableNode || win.document).querySelectorAll('tbody tr')].filter(rowHasPainelLink);
        rows.forEach(row => {
          const entry = extractTournamentFromRow(row, '');
          if (entry) found.push({ ...entry, sourceLabel });
        });
      }
    } finally {
      frame.remove();
    }

    const unique = new Map();
    found.forEach(entry => unique.set(entry.painelUrl, entry));
    return [...unique.values()];
  }

  function matchTournamentFromPool(inputName, pool) {
    const matches = (pool || []).filter(entry =>
      isTournamentRowNameMatch(inputName, entry.actualName, entry.rowText)
    );
    const exact = matches.filter(entry => isSameTournamentExactSafe(inputName, entry.actualName));
    if (exact.length === 1) return { status: 'FOUND', match: exact[0] };
    if (exact.length > 1) return { status: 'AMBIGUOUS', matches: exact };
    if (matches.length === 1) return { status: 'FOUND', match: matches[0] };
    if (matches.length > 1) return { status: 'AMBIGUOUS', matches };
    return { status: 'NOT_FOUND', matches: [] };
  }

  async function resolveUrlForCandidates(rows) {
    const targets = rows.filter(shouldResolveCandidate);
    if (!targets.length) return rows;

    targets.forEach(row => {
      row.use = '';
      row.urlStatus = 'URL_NOT_FOUND';
      row.statusReason = 'background pool scan pending';
    });

    log(`OPEN URL pool scan start: ${targets.length} candidates`);
    const openPool = await scanTournamentPool('/torneio/abertos', 'OPEN');
    const closedTargets = [];

    targets.forEach(row => {
      const found = matchTournamentFromPool(row.name, openPool);
      if (found.status === 'AMBIGUOUS') {
        row.urlStatus = 'AMBIGUOUS';
        row.statusReason = `OPEN pool multiple matches: ${found.matches.length}`;
      } else if (found.status === 'FOUND') {
        applyResolvedPoolMatch(row, found.match, 'OK_SEARCH_OPEN');
      } else {
        closedTargets.push(row);
      }
    });

    if (closedTargets.length) {
      log(`CLOSED URL pool scan start: ${closedTargets.length} OPEN misses`);
      const closedPool = await scanTournamentPool('/torneio/fechados', 'CLOSED');
      closedTargets.forEach(row => {
        const found = matchTournamentFromPool(row.name, closedPool);
        if (found.status === 'AMBIGUOUS') {
          row.urlStatus = 'AMBIGUOUS';
          row.statusReason = `CLOSED pool multiple matches: ${found.matches.length}`;
        } else if (found.status === 'FOUND') {
          applyResolvedPoolMatch(row, found.match, 'OK_SEARCH_CLOSED');
        } else {
          row.urlStatus = 'URL_NOT_FOUND';
          row.statusReason = 'OPEN/CLOSED pool not found';
        }
      });
    }

    return rows;
  }

  function applyResolvedPoolMatch(row, match, status) {
    row.tournamentId = match.tournamentId;
    row.url = match.painelUrl;
    row.actualName = match.actualName || '';
    row.matchedRow = match.rowText || '';
    row.use = '1';
    row.urlStatus = status;
    row.statusReason = `${match.actualName || row.name} / background pool`;

    setSharedCacheItem(row.name, {
      tournamentId: row.tournamentId,
      url: row.url,
      actualName: row.actualName || row.name,
      matchedRow: row.matchedRow || '',
      source: status.toLowerCase()
    });
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

  async function fetchTournamentDocument(painelUrl) {
    const absolute = new URL(painelUrl, location.origin).href;
    const res = await fetch(absolute, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) throw new Error(`BACKGROUND_PANEL_FETCH_FAILED status=${res.status}`);
    if (/\/login|\/entrar/i.test(res.url || '')) throw new Error(`BACKGROUND_PANEL_LOGIN_REDIRECT: ${res.url}`);
    const html = await res.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function getTournamentTitleFromDocument(doc) {
    const direct = normalizeText(
      doc.querySelector('form[action*="/torneio/alterar_nome"] [name="nome_caixa_input"]')?.value ||
      doc.querySelector('input[name="titulo_torneio"]')?.value ||
      ''
    );
    if (direct) return direct;

    for (const selector of ['h1', 'h2', '.page-title', '.box-title', '.panel-title', '.breadcrumb', '.content-header']) {
      const text = normalizeText(doc.querySelector(selector)?.textContent || '');
      if (text.includes('【') && text.includes('】')) return text;
    }
    return normalizeText(doc.title || '');
  }

  function verifyTournamentDocumentMatches(doc, expectedName, alternativeNames = []) {
    const actualName = getTournamentTitleFromDocument(doc);
    if (!actualName) throw new Error(`BACKGROUND_TITLE_UNREADABLE: expected=${expectedName}`);
    const acceptedNames = [expectedName, ...(alternativeNames || [])].filter(normalizeText);
    if (acceptedNames.some(name => compactText(actualName) === compactText(name))) return actualName;
    if (sameTournamentByPrefixAndNo(expectedName, actualName)) return actualName;
    throw new Error(`BACKGROUND_TITLE_MISMATCH: expected=${expectedName} / actual=${actualName}`);
  }

  async function findExistingTournament(t, state) {
    const resolved = await resolveTournamentUrl(t, state);

    state.tournamentId = resolved.tournamentId || '';
    state.painelUrl = resolved.painelUrl;
    state.urlSource = resolved.source || '';
    state.step = (t.items || []).length
      ? 'VIRTUAL_CURRENCY'
      : ((t.itemPatches || []).length ? 'ITEM_PATCHES' : 'RENAME');
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

  function getTournamentRenameForm() {
    return document.querySelector('form[action*="/torneio/alterar_nome"]');
  }

  function getCurrentTournamentRenameValue() {
    const form = getTournamentRenameForm();
    const value = normalizeText(form?.querySelector('[name="nome_caixa_input"]')?.value || '');
    return value || getPageTournamentTitle();
  }

  async function postTournamentRename(t, state) {
    const targetName = normalizeRenameText(t.newName);
    if (!targetName) return { status: 'SKIP', reason: '新大会名 empty' };

    const currentName = getCurrentTournamentRenameValue();
    if (isExactRenameTarget(currentName, targetName)) {
      return { status: 'SKIP', reason: 'already target', currentName, targetName };
    }

    const form = getTournamentRenameForm();
    if (!form) throw new Error('TOURNAMENT_RENAME_FORM_NOT_FOUND');

    const fd = new FormData(form);
    fd.set('nome_caixa_input', targetName);
    fd.set('id_torneio', state.tournamentId || getTournamentIdFromUrl());
    fd.set('painel', fd.get('painel') || '1');

    state.pendingRenameVerification = { currentName, targetName };
    state.step = 'RENAME_VERIFY';
    setState(state);

    const res = await fetch(form.action || '/torneio/alterar_nome', {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
      redirect: 'follow'
    });

    if (!res.ok) {
      throw new Error(`TOURNAMENT_RENAME_FAILED status=${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    return { status: 'POSTED', currentName, targetName };
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

    const res = await fetch('/torneio/abas/configuracao/alterar_campos', {
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
      siglas: item.siglas || existingSiglas || '',
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

  function getItemUpdateMode(t) {
    const explicit = normalizeText(t.itemUpdateMode || '').toLowerCase();
    if (['position', 'pos', '順番', '顺序'].includes(explicit)) return 'position';
    if (['name', 'nome', '名前', '名称'].includes(explicit)) return 'name';
    return 'position';
  }

  function formFieldsToObject(form) {
    if (!form) return {};
    const out = {};
    const fd = new FormData(form);
    for (const [k, v] of fd.entries()) out[k] = String(v);
    return out;
  }

  function formActionPath(form, fallback) {
    const raw = normalizeText(form?.getAttribute?.('action') || form?.action || fallback || '');
    if (!raw) return fallback;
    try {
      return new URL(raw, location.origin).pathname;
    } catch (_) {
      return raw;
    }
  }

  function getElementDataAttrs(el) {
    const out = {};
    if (!el) return out;
    [...el.attributes].forEach(attr => {
      if (/^data-/i.test(attr.name)) out[attr.name] = attr.value;
    });
    return out;
  }

  function getItemIdFromElement(el) {
    return getItemIdInfoFromElement(el).id_item;
  }

  function getItemIdInfoFromElement(el) {
    if (!el) return { id_item: '', source: '' };

    const candidates = [
      ['data-id_item', el.getAttribute('data-id_item')],
      ['data-id-item', el.getAttribute('data-id-item')],
      ['data-iditem', el.getAttribute('data-iditem')],
      ['data-id', el.getAttribute('data-id')],
      ['data-item-id', el.getAttribute('data-item-id')],
      ['dataset.id_item', el.dataset?.id_item],
      ['dataset.idItem', el.dataset?.idItem],
      ['dataset.iditem', el.dataset?.iditem],
      ['dataset.id', el.dataset?.id],
      ['dataset.itemId', el.dataset?.itemId]
    ];

    for (const [source, raw] of candidates) {
      const v = normalizeText(raw);
      if (/^\d+$/.test(v)) return { id_item: v, source };
    }

    const html = String(el.outerHTML || '');
    const patterns = [
      ['html:id_item', /id_item["'\s:=]+(\d+)/i],
      ['html:data-id-item', /data-id-item=["']?(\d+)/i],
      ['html:data-id_item', /data-id_item=["']?(\d+)/i],
      ['html:item_editar', /item_editar[^"'<>]*?(\d+)/i]
    ];

    for (const [source, pattern] of patterns) {
      const m = html.match(pattern);
      if (m) return { id_item: m[1], source };
    }

    return { id_item: '', source: '' };
  }

  function getExistingItemElements(root = document) {
    return [...root.querySelectorAll([
      'a[href="#modal_item_editar"]',
      'button[href="#modal_item_editar"]',
      '[data-target="#modal_item_editar"]',
      '[data-id_item][data-nome]',
      '[data-id-item][data-nome]',
      '[data-id][data-nome][data-siglas]'
    ].join(','))]
      .filter(el => normalizeText(el.getAttribute('data-nome') || el.getAttribute('data-siglas') || el.innerText || el.textContent || ''));
  }

  function parseItemLabelFromElement(el) {
    const rawText = normalizeText(el?.innerText || el?.textContent || '');
    const dataNome = normalizeText(el?.getAttribute?.('data-nome') || '');
    const dataSiglas = normalizeText(el?.getAttribute?.('data-siglas') || '');

    let nome = dataNome;
    let siglas = dataSiglas;

    if (!nome || !siglas) {
      const text = rawText
        .replace(/\b(edit|editar|update|save|salvar|編集|更新|保存)\b/ig, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const codeThenName = text.match(/^([A-Za-z0-9_-]{1,16})\s+(.+)$/);
      if (codeThenName) {
        if (!siglas) siglas = normalizeText(codeThenName[1]);
        if (!nome) nome = normalizeText(codeThenName[2]);
      } else if (!nome && text) {
        nome = text;
      }
    }

    return { nome, siglas, rawText };
  }

  function collectExistingItemsForApi(root = document) {
    return getExistingItemElements(root).map((el, index) => {
      const idInfo = getItemIdInfoFromElement(el);
      const label = parseItemLabelFromElement(el);

      return {
        index: index + 1,
        element: el,
        id_item: idInfo.id_item,
        id_item_source: idInfo.source,
        nome: label.nome,
        siglas: label.siglas,
        rawText: label.rawText,
        data: getElementDataAttrs(el)
      };
    });
  }

  function collectItemApiInfo(root = document) {
    const editForm = root.querySelector('#modal_item_editar form');
    const insertForm = root.querySelector('#modal_item_inserir form');
    const existingItems = collectExistingItemsForApi(root);

    return {
      editEndpoint: '/torneio/abas/configuracao/item_editar',
      insertEndpoint: '/torneio/abas/configuracao/item_criar',
      editFormAction: formActionPath(editForm, '/torneio/abas/configuracao/item_editar'),
      insertFormAction: formActionPath(insertForm, '/torneio/abas/configuracao/item_criar'),
      editFormFields: formFieldsToObject(editForm),
      insertFormFields: formFieldsToObject(insertForm),
      existingItems
    };
  }

  function findExistingItemForPartialPatch(existingItems, patch) {
    const siglas = (patch.siglas || []).map(value => normalizeText(value).toLowerCase());
    const names = (patch.itemNames || []).map(value => compactText(value).toLowerCase());
    return existingItems.find(item => siglas.includes(normalizeText(item.siglas).toLowerCase())) ||
      existingItems.find(item => names.includes(compactText(item.nome).toLowerCase())) ||
      null;
  }

  function getExistingPartialFieldValue(existing, field) {
    if (field === 'nome') return normalizeText(existing?.nome);
    if (field === 'siglas') return normalizeText(existing?.siglas);
    return getExistingItemDataValue(existing, [field]);
  }

  function partialFieldValuesEqual(field, left, right) {
    if (['nome', 'siglas'].includes(field)) return normalizeText(left) === normalizeText(right);
    return normalizeItemNumberForCompare(left) === normalizeItemNumberForCompare(right);
  }

  async function postPartialItemPatch(t, state, patch, patchIndex) {
    await openConfiguracao();
    const info = collectItemApiInfo();
    const existing = findExistingItemForPartialPatch(info.existingItems, patch);
    if (!existing) {
      throw new Error(`ITEM_PATCH_NOT_FOUND: ${patch.group} / ${patch.label}`);
    }
    if (!existing.id_item) {
      throw new Error(`ITEM_PATCH_ID_MISSING: ${patch.group} / ${existing.nome || existing.siglas}`);
    }

    const currentValue = getExistingPartialFieldValue(existing, patch.property);
    if (currentValue && partialFieldValuesEqual(patch.property, currentValue, patch.value)) {
      return { status: 'SKIP', existing, currentValue };
    }

    existing.element?.click();
    await sleep(CONFIG.afterModalOpenMs);
    const form = document.querySelector('#modal_item_editar form');
    if (!form) throw new Error(`ITEM_PATCH_FORM_NOT_FOUND: ${patch.group}`);

    const fd = new FormData(form);
    const requiredExistingFields = ['nome', 'siglas', 'valor', 'taxa', 'fichas', 'limite', 'reposicionar'];
    const missingFields = requiredExistingFields.filter(field => !fd.has(field));
    if (missingFields.length) {
      throw new Error(`ITEM_PATCH_PRESERVE_FIELDS_MISSING: ${patch.group} / ${missingFields.join(',')}`);
    }
    const preservedFields = Object.fromEntries(
      requiredExistingFields
        .filter(field => field !== patch.property)
        .map(field => [field, String(fd.get(field) ?? '')])
    );

    fd.set('id_torneio', state.tournamentId || getTournamentIdFromUrl());
    fd.set('id_item', existing.id_item);
    fd.set(patch.property, patch.value);

    state.pendingItemPatchVerification = {
      index: patchIndex,
      existingId: existing.id_item,
      patch: {
        group: patch.group,
        itemNames: patch.itemNames,
        siglas: patch.siglas,
        property: patch.property,
        label: patch.label,
        value: patch.value
      },
      preservedFields
    };
    state.step = 'ITEM_PATCH_VERIFY';
    setState(state);

    await postItemApi(formActionPath(form, info.editEndpoint), fd, `${patch.label} 局部更新`);
    return { status: 'POSTED', existing, currentValue };
  }

  function verifyPartialItemPatch(existingItems, pending) {
    const patch = pending.patch;
    const existing = existingItems.find(item => String(item.id_item || '') === String(pending.existingId || '')) ||
      findExistingItemForPartialPatch(existingItems, patch);
    if (!existing) throw new Error(`ITEM_PATCH_VERIFY_NOT_FOUND: ${patch.group}`);

    const actual = getExistingPartialFieldValue(existing, patch.property);
    if (!actual) throw new Error(`ITEM_PATCH_VERIFY_FIELD_MISSING: ${patch.label}`);
    if (!partialFieldValuesEqual(patch.property, actual, patch.value)) {
      throw new Error(`ITEM_PATCH_VERIFY_MISMATCH: ${patch.label} expected=${patch.value} actual=${actual}`);
    }

    const preservationErrors = [];
    Object.entries(pending.preservedFields || {}).forEach(([field, expected]) => {
      const actualPreserved = getExistingPartialFieldValue(existing, field);
      if (!partialFieldValuesEqual(field, actualPreserved, expected)) {
        preservationErrors.push(`${field} expected=${expected || '(empty)'} actual=${actualPreserved || '(empty)'}`);
      }
    });
    if (preservationErrors.length) {
      throw new Error(`ITEM_PATCH_PRESERVE_MISMATCH: ${patch.label} / ${preservationErrors.join(' / ')}`);
    }
    return { existing, actual };
  }

  function readExistingItemField(existing, field) {
    const wanted = normalizeText(field).toLowerCase().replace(/[_-]/g, '');
    for (const [key, value] of Object.entries(existing?.data || {})) {
      const normalizedKey = normalizeText(key)
        .toLowerCase()
        .replace(/^data-/, '')
        .replace(/[_-]/g, '');
      if (normalizedKey === wanted) return { found: true, value: String(value ?? '') };
    }
    if (field === 'nome') return { found: !!existing?.nome, value: String(existing?.nome || '') };
    if (field === 'siglas') return { found: existing?.siglas !== undefined, value: String(existing?.siglas || '') };
    return { found: false, value: '' };
  }

  async function postBackgroundForm(form, fd, fallbackAction, label) {
    const action = new URL(form?.getAttribute('action') || fallbackAction, location.origin).href;
    const res = await fetch(action, {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
      redirect: 'follow'
    });
    if (!res.ok) throw new Error(`${label} failed status=${res.status}: ${(await res.text()).slice(0, 300)}`);
    if (/\/login|\/entrar/i.test(res.url || '')) throw new Error(`${label} LOGIN_REDIRECT: ${res.url}`);
    return res;
  }

  async function applyBackgroundPatchGroup(t, state, doc, patches) {
    const info = collectItemApiInfo(doc);
    const existing = findExistingItemForPartialPatch(info.existingItems, patches[0]);
    if (!existing) throw new Error(`ITEM_PATCH_NOT_FOUND: ${patches[0].group}`);
    if (!existing.id_item) throw new Error(`ITEM_PATCH_ID_MISSING: ${patches[0].group}`);
    const form = doc.querySelector('#modal_item_editar form') || doc.querySelector('form[action*="item_editar"]');
    if (!form) throw new Error(`ITEM_PATCH_FORM_NOT_FOUND: ${patches[0].group}`);

    const allFields = [
      'nome', 'siglas', 'valor', 'taxa', 'fichas', 'limite', 'reposicionar',
      'direito_img', 'pts_ranking', 'gameid_bloqueio', 'rake', 'taxa_extras'
    ];
    const snapshot = {};
    const missing = [];
    allFields.forEach(field => {
      const read = readExistingItemField(existing, field);
      if (!read.found) missing.push(field);
      else snapshot[field] = read.value;
    });
    if (missing.length) {
      throw new Error(`ITEM_PATCH_BACKGROUND_PRESERVE_FIELDS_MISSING: ${patches[0].group} / ${missing.join(',')}`);
    }

    const changed = patches.filter(patch => !partialFieldValuesEqual(patch.property, snapshot[patch.property], patch.value));
    if (!changed.length) {
      appendReportToState(state, 'ITEM_PATCH_SKIP', `${t.name} / ${patches.map(p => `${p.label}=${p.value}`).join(' / ')} already target`);
      return doc;
    }

    const fd = new FormData(form);
    allFields.forEach(field => fd.set(field, snapshot[field]));
    fd.set('id_torneio', state.tournamentId);
    fd.set('id_item', existing.id_item);
    changed.forEach(patch => fd.set(patch.property, patch.value));

    state.pendingBackgroundWrite = {
      type: 'ITEM_PATCH',
      tournamentId: state.tournamentId,
      itemId: existing.id_item,
      patches: changed.map(p => ({ label: p.label, property: p.property, value: p.value }))
    };
    setState(state);
    await postBackgroundForm(form, fd, info.editEndpoint, `${patches[0].group} background patch`);

    const refreshed = await fetchTournamentDocument(state.painelUrl);
    verifyTournamentDocumentMatches(refreshed, t.name, [t.newName]);
    const refreshedItems = collectItemApiInfo(refreshed).existingItems;
    const saved = refreshedItems.find(item => String(item.id_item || '') === String(existing.id_item)) ||
      findExistingItemForPartialPatch(refreshedItems, patches[0]);
    if (!saved) throw new Error(`ITEM_PATCH_BACKGROUND_VERIFY_NOT_FOUND: ${patches[0].group}`);

    const targetProperties = new Set(changed.map(patch => patch.property));
    const errors = [];
    changed.forEach(patch => {
      const actual = readExistingItemField(saved, patch.property);
      if (!actual.found || !partialFieldValuesEqual(patch.property, actual.value, patch.value)) {
        errors.push(`${patch.label} expected=${patch.value} actual=${actual.value || '(missing)'}`);
      }
    });
    allFields.filter(field => !targetProperties.has(field)).forEach(field => {
      const actual = readExistingItemField(saved, field);
      if (!actual.found || !partialFieldValuesEqual(field, actual.value, snapshot[field])) {
        errors.push(`${field} changed: before=${snapshot[field] || '(empty)'} after=${actual.value || '(missing)'}`);
      }
    });
    if (errors.length) throw new Error(`ITEM_PATCH_BACKGROUND_VERIFY_MISMATCH: ${errors.join(' / ')}`);

    delete state.pendingBackgroundWrite;
    appendReportToState(
      state,
      'ITEM_PATCH_OK',
      `${t.name} / background / ${changed.map(p => `${p.label}: ${snapshot[p.property]} -> ${p.value}`).join(' / ')} / id_item=${existing.id_item}`
    );
    return refreshed;
  }

  async function applyBackgroundRename(t, state, doc) {
    const targetName = normalizeRenameText(t.newName);
    if (!targetName) return doc;
    const currentName = getTournamentTitleFromDocument(doc);
    if (isExactRenameTarget(currentName, targetName)) {
      appendReportToState(state, 'RENAME_SKIP', `${t.name} / already target`);
      return doc;
    }

    const form = doc.querySelector('form[action*="/torneio/alterar_nome"]');
    if (!form) throw new Error('BACKGROUND_RENAME_FORM_NOT_FOUND');
    const fd = new FormData(form);
    fd.set('nome_caixa_input', targetName);
    fd.set('id_torneio', state.tournamentId);
    fd.set('painel', fd.get('painel') || '1');

    state.pendingBackgroundWrite = { type: 'RENAME', tournamentId: state.tournamentId, currentName, targetName };
    setState(state);
    await postBackgroundForm(form, fd, '/torneio/alterar_nome', 'background rename');

    const refreshed = await fetchTournamentDocument(state.painelUrl);
    const actualName = getTournamentTitleFromDocument(refreshed);
    if (!isExactRenameTarget(actualName, targetName)) {
      throw new Error(`BACKGROUND_RENAME_VERIFY_MISMATCH: expected=${targetName} / actual=${actualName}`);
    }
    delete state.pendingBackgroundWrite;
    appendReportToState(state, 'RENAME_OK', `${currentName} -> ${actualName} / background verified`);
    appendReportToState(state, 'CACHE_REVIEW_REQUIRED', `大会名変更後のため Shared URL Cache を人工確認: ${currentName} -> ${actualName}`);
    return refreshed;
  }

  async function processBackgroundPartialTournament(t, state) {
    const resolved = await resolveTournamentUrl(t);
    state.tournamentId = resolved.tournamentId;
    state.painelUrl = resolved.painelUrl;
    state.urlSource = resolved.source || '';
    state.step = 'BACKGROUND_PATCH';
    setState(state);

    let doc = await fetchTournamentDocument(state.painelUrl);
    const actualName = verifyTournamentDocumentMatches(doc, t.name, [t.newName]);
    appendReportToState(state, 'BACKGROUND_OPEN_OK', `${t.name} / ${actualName} / id=${state.tournamentId}`);

    const grouped = new Map();
    (t.itemPatches || []).forEach(patch => {
      if (!grouped.has(patch.group)) grouped.set(patch.group, []);
      grouped.get(patch.group).push(patch);
    });
    for (const patches of grouped.values()) {
      doc = await applyBackgroundPatchGroup(t, state, doc, patches);
    }
    doc = await applyBackgroundRename(t, state, doc);
    appendReportToState(state, 'BACKGROUND_DONE', `${t.name} / page navigationなし`);
  }

  function makeApiFormData(templateFields, item, extra = {}) {
    const fd = new FormData();

    Object.entries(templateFields || {}).forEach(([k, v]) => fd.set(k, v));
    applyDataToFormData(fd, buildItemData(item, null));
    applyDataToFormData(fd, extra);

    return fd;
  }

  function findExistingItemForApi(existingItems, item, mode, itemIndex) {
    const wantedName = normalizeText(item.nome);
    const wantedSiglas = normalizeText(item.siglas);
    const wantedNameCompact = compactText(wantedName);

    const exact = existingItems.find(x =>
      (!wantedName || normalizeText(x.nome) === wantedName) &&
      (!wantedSiglas || normalizeText(x.siglas) === wantedSiglas)
    );
    if (exact) return exact;

    if (mode === 'position') return existingItems[itemIndex] || null;

    return existingItems.find(x =>
      (wantedName && normalizeText(x.nome) === wantedName) ||
      (wantedNameCompact && compactText(x.nome).includes(wantedNameCompact)) ||
      (wantedNameCompact && compactText(x.rawText).includes(wantedNameCompact)) ||
      (wantedSiglas && normalizeText(x.siglas) === wantedSiglas)
    ) || null;
  }

  function getExistingItemDataValue(existing, aliases) {
    const wanted = aliases.map(x => normalizeText(x).toLowerCase().replace(/[_-]/g, ''));

    for (const [key, value] of Object.entries(existing?.data || {})) {
      const normalizedKey = normalizeText(key)
        .toLowerCase()
        .replace(/^data-/, '')
        .replace(/[_-]/g, '');

      if (wanted.includes(normalizedKey)) return normalizeText(value);
    }

    return '';
  }

  function normalizeItemNumberForCompare(value) {
    let s = normalizeText(value).replace(/[¥￥\s]/g, '');
    if (!s) return '';

    if (/^-?\d+[.,]0{1,2}$/.test(s)) s = s.replace(/[.,]0{1,2}$/, '');
    return s.replace(/[.,]/g, '').replace(/[^\d-]/g, '');
  }

  function findSavedItemForVerification(existingItems, pending, mode) {
    if (pending.existingId) {
      const byId = existingItems.find(x => String(x.id_item || '') === String(pending.existingId));
      if (byId) return byId;
    }

    const item = pending.item || {};
    const wantedName = normalizeText(item.nome);
    const wantedSiglas = normalizeText(item.siglas);
    const exactMatches = existingItems.filter(x =>
      (!wantedName || normalizeText(x.nome) === wantedName) &&
      (!wantedSiglas || normalizeText(x.siglas) === wantedSiglas)
    );

    if (exactMatches.length === 1) return exactMatches[0];
    if (mode === 'position') return existingItems[Number(pending.index)] || null;
    return null;
  }

  function verifySavedItem(existingItems, pending, mode) {
    const item = pending.item || {};
    const saved = findSavedItemForVerification(existingItems, pending, mode);

    if (!saved) {
      throw new Error(`ITEM_VERIFY_NOT_FOUND: ${Number(pending.index) + 1} ${getItemLabel(item)}`);
    }

    const errors = [];
    if (normalizeText(saved.nome) !== normalizeText(item.nome)) {
      errors.push(`Name expected=${item.nome} actual=${saved.nome || '(empty)'}`);
    }
    if (item.siglas && normalizeText(saved.siglas) !== normalizeText(item.siglas)) {
      errors.push(`Siglas expected=${item.siglas} actual=${saved.siglas || '(empty)'}`);
    }

    const fields = [
      { label: 'Value', expected: item.valor, aliases: ['valor', 'value'], required: true },
      { label: 'Tax', expected: item.taxa || '0', aliases: ['taxa', 'tax', 'fee'] },
      { label: 'Chips', expected: item.fichas || '0', aliases: ['fichas', 'chips'] },
      { label: 'Limit', expected: item.limite || '1', aliases: ['limite', 'limit'] },
      { label: 'Reposicionar', expected: item.reposicionar || '0', aliases: ['reposicionar', 'repo'] }
    ];

    fields.forEach(field => {
      const actual = getExistingItemDataValue(saved, field.aliases);
      if (!actual) {
        if (field.required) errors.push(`${field.label} verification field missing`);
        return;
      }

      if (normalizeItemNumberForCompare(actual) !== normalizeItemNumberForCompare(field.expected)) {
        errors.push(`${field.label} expected=${field.expected} actual=${actual}`);
      }
    });

    if (errors.length) {
      throw new Error(`ITEM_VERIFY_MISMATCH: ${Number(pending.index) + 1} ${getItemLabel(item)} / ${errors.join(' / ')}`);
    }

    return saved;
  }

  async function postItemApi(endpoint, fd, label) {
    debugFormData(label, fd);

    const res = await fetch(endpoint, {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
      redirect: 'follow'
    });

    log(`${label} POST 完成 status=${res.status}`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${label}: HTTP ${res.status} ${body.slice(0, 300)}`);
    }

    if (/\/login|\/entrar/i.test(res.url || '')) {
      throw new Error(`${label}: LOGIN_REDIRECT ${res.url}`);
    }

    await sleep(CONFIG.afterPostMs);
    return res;
  }

  async function saveItemsByApiBatch(t, state) {
    await openConfiguracao();

    const info = collectItemApiInfo();
    const missingIds = info.existingItems.filter(x => !x.id_item);

    if (missingIds.length) {
      appendReportToState(
        state,
        'ITEM_API_DIAG_FAIL',
        `existing item id_item 取得不可: ${missingIds.map(x => `${x.index}:${x.nome || x.siglas || '(unknown)'}`).join(', ')}`
      );
      throw new Error('ITEM_API_DIAG_FAIL: existing item id_item 取得不可');
    }

    const idTorneio = state.tournamentId || getTournamentIdFromUrl();
    if (!idTorneio) throw new Error('ITEM_API_DIAG_FAIL: id_torneio 取得不可');

    const items = t.items || [];
    const itemIndex = Number(state.itemIndex || 0);
    const item = items[itemIndex];
    if (!item) throw new Error(`ITEM_INDEX_OUT_OF_RANGE: ${itemIndex}/${items.length}`);

    const mode = getItemUpdateMode(t);
    const existing = findExistingItemForApi(info.existingItems, item, mode, itemIndex);
    appendReportToState(
      state,
      'ITEM_ORDER_CHECK',
      `${itemIndex + 1}: oldName=${existing?.nome || '(new)'} / oldSiglas=${existing?.siglas || ''} → update as ${item.nome} / ${item.siglas || ''}`
    );

    const extra = { id_torneio: idTorneio };
    let endpoint = info.insertEndpoint;
    let action = 'INSERT_ITEM';
    let fields = info.insertFormFields;

    if (existing) {
      endpoint = info.editEndpoint;
      action = 'EDIT_ITEM';
      fields = info.editFormFields;
      extra.id_item = existing.id_item;
    }

    const fd = makeApiFormData(fields, item, extra);
    const res = await postItemApi(endpoint, fd, `${action} ${itemIndex + 1}/${items.length} ${getItemLabel(item)}`);
    const result = {
      action,
      status: res.status,
      item,
      existing,
      index: itemIndex
    };

    return { mode, results: [result], existingItems: info.existingItems };
  }

  async function diagnoseItemApiFromUi() {
    try {
      await openConfiguracao();
      const info = collectItemApiInfo();
      const lines = [
        makeReportLine('ITEM_API_DIAG', `edit=${info.editEndpoint} / insert=${info.insertEndpoint}`),
        `editFormAction=${info.editFormAction}`,
        `insertFormAction=${info.insertFormAction}`,
        `editFormFields=${Object.keys(info.editFormFields).join(', ') || '(none)'}`,
        `insertFormFields=${Object.keys(info.insertFormFields).join(', ') || '(none)'}`,
        'existingItems:',
        ...info.existingItems.map(x =>
          `${x.index}. id_item=${x.id_item || '(missing)'} / source=${x.id_item_source || '(missing)'} / nome=${x.nome || '(empty)'} / siglas=${x.siglas || '(empty)'} / text=${x.rawText || '(empty)'} / data=${JSON.stringify(x.data)}`
        )
      ];

      if (info.existingItems.some(x => !x.id_item)) {
        lines.push(makeReportLine('ITEM_API_DIAG_FAIL', 'existing item の id_item が取得できない行があります'));
      }

      renderReport(lines);
      localStorage.setItem(CONFIG.lastReportKey, lines.join('\n'));
      alert('Item API 診断完成。Report を確認してください。');
    } catch (e) {
      const lines = [makeReportLine('ITEM_API_DIAG_FAIL', e.message || String(e))];
      renderReport(lines);
      localStorage.setItem(CONFIG.lastReportKey, lines.join('\n'));
      alert(`Item API 診断失败：${e.message || e}`);
    }
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
    state.itemPatchIndex = 0;
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

      if (state.step === 'FIND_EXISTING' || state.step === 'BACKGROUND_PATCH') {
        if (!(t.items || []).length && ((t.itemPatches || []).length || normalizeText(t.newName))) {
          await processBackgroundPartialTournament(t, state);
          await moveToNextTournamentOrDone(state);
          return;
        }
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

        if (!items.length) {
          appendReportToState(state, 'SKIP_ITEMS', `${t.name} / item empty`);
          state.step = 'ITEM_PATCHES';
          setState(state);
          runCurrentStep();
          return;
        }

        const itemIndex = Number(state.itemIndex || 0);
        if (itemIndex >= items.length) {
          state.step = 'ITEMS_RELOAD';
          setState(state);
          location.reload();
          return;
        }

        const batch = await saveItemsByApiBatch(t, state);
        const result = batch.results[0];
        state.pendingItemVerification = {
          index: result.index,
          action: result.action,
          status: result.status,
          existingId: result.existing?.id_item || '',
          item: result.item
        };
        state.step = 'ITEM_VERIFY';
        setState(state);

        appendReportToState(
          state,
          'ITEM_POSTED',
          `${t.name} / mode=${batch.mode} / ${result.index + 1}/${items.length} / ${result.action} / ${getItemLabel(result.item)} / status=${result.status} / reload verification pending`
        );

        log(`项目 ${result.index + 1}/${items.length} POST完成，刷新后验证`);
        await sleep(800);
        location.reload();
        return;
      }

      if (state.step === 'ITEM_VERIFY') {
        const items = t.items || [];
        const pending = state.pendingItemVerification;
        if (!pending || !pending.item) {
          throw new Error('ITEM_VERIFY_STATE_MISSING');
        }

        await openConfiguracao();
        const info = collectItemApiInfo();
        const mode = getItemUpdateMode(t);
        const saved = verifySavedItem(info.existingItems, pending, mode);

        appendReportToState(
          state,
          'ITEM_OK',
          `${t.name} / mode=${mode} / ${Number(pending.index) + 1}/${items.length} / ${pending.action} / ${getItemLabel(pending.item)} / ${itemFeeText(pending.item)} / Chips=${pending.item.fichas || '0'} / id_item=${saved.id_item} / verified after reload`
        );

        state.itemIndex = Number(pending.index) + 1;
        delete state.pendingItemVerification;
        state.step = state.itemIndex < items.length ? 'ITEMS' : 'ITEMS_RELOAD';
        setState(state);

        log(`项目 ${state.itemIndex}/${items.length} 验证成功，刷新后继续`);
        await sleep(800);
        location.reload();
        return;
      }

      if (state.step === 'ITEMS_RELOAD') {
        state.step = 'ITEM_PATCHES';
        setState(state);
        runCurrentStep();
        return;
      }

      if (state.step === 'ITEM_PATCHES') {
        const patches = t.itemPatches || [];
        const patchIndex = Number(state.itemPatchIndex || 0);
        if (patchIndex >= patches.length) {
          state.step = 'RENAME';
          setState(state);
          runCurrentStep();
          return;
        }

        const patch = patches[patchIndex];
        const result = await postPartialItemPatch(t, state, patch, patchIndex);
        if (result.status === 'SKIP') {
          appendReportToState(state, 'ITEM_PATCH_SKIP', `${t.name} / ${patch.label} already ${patch.value}`);
          state.itemPatchIndex = patchIndex + 1;
          state.step = 'ITEM_PATCHES';
          setState(state);
          runCurrentStep();
          return;
        }

        appendReportToState(
          state,
          'ITEM_PATCH_POSTED',
          `${t.name} / ${patchIndex + 1}/${patches.length} / ${patch.label}: ${result.currentValue || '(unreadable)'} -> ${patch.value} / reload verification pending`
        );
        await sleep(800);
        location.reload();
        return;
      }

      if (state.step === 'ITEM_PATCH_VERIFY') {
        const pending = state.pendingItemPatchVerification;
        if (!pending?.patch) throw new Error('ITEM_PATCH_VERIFY_STATE_MISSING');

        await openConfiguracao();
        const info = collectItemApiInfo();
        const verified = verifyPartialItemPatch(info.existingItems, pending);
        appendReportToState(
          state,
          'ITEM_PATCH_OK',
          `${t.name} / ${pending.patch.label}=${verified.actual} / id_item=${verified.existing.id_item} / verified after reload`
        );

        state.itemPatchIndex = Number(pending.index) + 1;
        delete state.pendingItemPatchVerification;
        state.step = 'ITEM_PATCHES';
        setState(state);
        runCurrentStep();
        return;
      }

      if (state.step === 'RENAME') {
        if (!normalizeText(t.newName)) {
          appendReportToState(state, 'SKIP_RENAME', `${t.name} / 新大会名 empty`);
          await moveToNextTournamentOrDone(state);
          return;
        }

        const result = await postTournamentRename(t, state);
        if (result.status === 'SKIP') {
          appendReportToState(state, 'RENAME_SKIP', `${t.name} / ${result.reason}`);
          await moveToNextTournamentOrDone(state);
          return;
        }

        appendReportToState(state, 'RENAME_POSTED', `${result.currentName} -> ${result.targetName} / reload verification pending`);
        log(`大会名変更POST完成：${result.currentName} -> ${result.targetName}`);
        await sleep(800);
        location.reload();
        return;
      }

      if (state.step === 'RENAME_VERIFY') {
        const pending = state.pendingRenameVerification;
        if (!pending?.targetName) throw new Error('RENAME_VERIFY_STATE_MISSING');

        const actualName = getCurrentTournamentRenameValue();
        if (!isExactRenameTarget(actualName, pending.targetName)) {
          throw new Error(`RENAME_VERIFY_MISMATCH: expected=${pending.targetName} / actual=${actualName}`);
        }

        appendReportToState(state, 'RENAME_OK', `${pending.currentName} -> ${actualName} / verified after reload`);
        appendReportToState(state, 'CACHE_REVIEW_REQUIRED', `大会名変更後のため Shared URL Cache を人工確認: ${pending.currentName} -> ${actualName}`);
        delete state.pendingRenameVerification;
        await moveToNextTournamentOrDone(state);
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

    const iUse = idx('本次处理', 'USE');
    const iName = idx('大会名', 'Name');
    const iNewName = idx('新大会名', 'New_Name', 'New Name', 'New Tournament Name');
    const iTournamentId = idx('TournamentId', 'ID');
    const iUrl = idx('URL');
    const iStatus = idx('判定', 'Status');
    const iReason = idx('理由', 'Reason');
    const iItemUpdateMode = idx('Item_Update_Mode', 'Item Update Mode', 'Update_Mode', '更新模式');
    const iPartialPatch = idx('局部修改', 'Partial_Patch', 'Partial Patch');

    if (iName < 0) throw new Error('候補表里找不到 大会名 列');

    return lines.slice(1).map((line, lineIndex) => {
      const c = line.split('\t');
      const get = i => (i >= 0 ? normalizeText(c[i]) : '');
      const getRename = i => (i >= 0 ? normalizeRenameText(c[i]) : '');
      const name = get(iName);
      if (!name) return null;

      const tournamentId = get(iTournamentId);
      const url = normalizeUrl(get(iUrl) || tournamentId);
      const items = buildItemListFromColumns(idx, get, { header, includeLegacy: false });
      const itemPatches = parsePartialPatchesText(get(iPartialPatch));
      const entry = items.find(item => normalizeText(item.siglas) === DEFAULTS.entrySiglas) || {};
      const reEntry = items.find(item => normalizeText(item.siglas) === DEFAULTS.reSiglas) || {};
      const ticketEntry = items.find(item => ['Ti', 'TE', 'TIX'].includes(normalizeText(item.siglas))) || null;

      return {
        name,
        newName: getRename(iNewName),
        tournamentId,
        url,
        use: ['使用', '1', 'TRUE', 'Y', '〇', '○'].includes(get(iUse).toUpperCase()) ? '1' : '',
        urlStatus: get(iStatus) || 'URL未解決',
        statusReason: get(iReason),
        itemUpdateMode: get(iItemUpdateMode),
        items,
        itemPatches,
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
        errors.push(`${prefix} URL尚未安全确认: ${status || '(empty)'}。请先在URL Manager人工核查。`);
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

    const tournaments = candidates
      .filter(t => normalizeText(t.use) === '1')
      .filter(t => isSafeUrlStatus(t.urlStatus) || normalizeText(t.url || t.tournamentId));

    if (!tournaments.length) {
      alert('本次处理设为“使用”且URL已确认的比赛为空。');
      return;
    }

    const dataErrors = validateTournamentList(tournaments);
    const urlErrors = validateCandidateUrlRows(tournaments);
    const errors = [...dataErrors, ...urlErrors];

    if (errors.length) {
      alert(
        `URLが安全確定していない候補があります。\n\n` +
        errors.slice(0, 20).join('\n') +
        (errors.length > 20 ? `\n...还有 ${errors.length - 20} 个` : '')
      );
      return;
    }

    const summary = tournaments.map((t, i) => {
      return `${i + 1}. ${t.name}\n   URL=${t.urlStatus} ${t.url}\n   Rename=${t.newName || '(なし)'}\n   Partial=${partialPatchesToText(t.itemPatches) || '(なし)'}\n   Mode=${getItemUpdateMode(t)}\n   Items=${itemListText(t.items) || '(なし)'}`;
    }).join('\n\n');

    const ok = confirm(
      `确认开始更新既存比赛项目？\n\n` +
      `这版不会创建比赛、不会改时间、不会设置盲注、不会 link ticket。\n` +
      `完整Item会进入既存详情流程；只有局部修改/改名的行会在后台处理，不跳转页面。\n` +
      `局部修改只更新指定字段；改名最后执行。\n\n` +
      `Shared URL Cache: ${sharedCacheCount()} 件\n` +
      `本次处理: ${tournaments.length} 件\n\n` +
      `${summary}`
    );

    if (!ok) return;

    manualStop = false;

    const report = [];
    report.push(makeReportLine('START', `开始更新：${tournaments.length} 件 / Cache=${sharedCacheCount()}`));

    tournaments.forEach((t, i) => {
      report.push(`${i + 1}. ${t.name} -> ${t.newName || '(renameなし)'} / ${t.urlStatus}=${t.url} / Partial=${partialPatchesToText(t.itemPatches) || '(なし)'} / Mode=${getItemUpdateMode(t)} / Items=${itemListText(t.items) || '(なし)'}`);
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
      itemPatchIndex: 0,
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
      '大会名\t新大会名\tTournamentId\tURL\tEN金額\tItem_Update_Mode\tItem1_Name\tItem1_Siglas\tItem1_Value\tItem1_Tax\tItem1_Chips\tItem1_Limit\tItem1_Reposicionar',
      '【JOPT 2026 Tokyo #03】#09 NLH Deepstack Sponsored by POKER Q’z\t【JOPT 2026 Tokyo #03】#09 NLH Deepstack Sponsored by POKER Q’z\t\t\t30000\t\t\t\t\t\t\t\t',
      '【物販 SAMPLE】#01 Goods Booth\t\t9999\t/torneio/painel/9999\t\tposition\tT-Shirt\tTS\t3,000\t0\t0\t0\t0'
    ].join('\n');

panel.innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
    <div style="font-weight:bold;">
      PW 既存大会 Item 更新 人工確認版 v0.7.4
    </div>
    <div style="display:flex;gap:4px;">
      <button id="pw-item-update-minimize" style="font-size:11px;padding:2px 6px;cursor:pointer;">Min</button>
      <button id="pw-item-update-close" style="font-size:11px;padding:2px 6px;cursor:pointer;">×</button>
    </div>
  </div>

  <div id="pw-item-update-body">

      <div style="font-size:11px;color:#ccc;line-height:1.35;">
        URL取得順：Preview → 后台OPEN pool一括取得 → OPEN未発見のみCLOSED pool → 人工確認 → START<br>
        Shared Cache key: <code>${SHARED_URL_CACHE_KEY}</code><br>
        作成・時間変更・盲注設定・Ticket Linkなし / 局部更新・改名は后台実行
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
        URL Resolve / 后台Pool一括照合
      </button>

      <button id="pw-item-update-diag-api"
        style="width:100%;padding:7px;cursor:pointer;background:#efe0ff;border:1px solid #a8a;">
        Diagnose Item API
      </button>

      <button id="pw-item-update-start"
        style="width:100%;padding:7px;cursor:pointer;background:#ffe08a;border:1px solid #c99;">
        START 更新既存大会 Item / 大会名
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
        ※ 局部更新：EN金額 / Entry金額 / EN_Value など。空欄の既存項目は変更しません<br>
        ※ 局部更新・新大会名だけの行はページ遷移なし。后台POST後に后台再読込で検証<br>
        ※ RE / Re Entry、TE / Ticket も同じ形式で金額・手数料・チップ数・上限・再配置に対応<br>
        ※ 新大会名だけの行も実行可能。改名はItem検証後の最後に実行<br>
        ※ Item_Update_Mode: 空白/position=既存項目順に上書き、name=名前/Siglas一致<br>
        ※ 同名/同Siglasの既存項目があれば編集、なければ新增<br>
        ※ 旧 EN/RE/Ticket 表頭もまだ読み込み可能<br>
        ※ URL未解決 / 合法同名 / AMBIGUOUS / bad cache が残る場合 START禁止。Candidatesへ本次使用するTournamentId/URLを明示してください。<br>
        ※ URL冲突请先在 URL Manager 的人工核查中确认
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
    document.querySelector('#pw-item-update-diag-api').onclick = () => diagnoseItemApiFromUi();
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
      saveItemsByApiBatch,
      verifySavedItem,
      findSavedItemForVerification,
      findExistingItemForApi,
      diagnoseItemApiFromUi,
      collectItemApiInfo,
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
