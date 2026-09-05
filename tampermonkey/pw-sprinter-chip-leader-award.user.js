// ==UserScript==
// @name         PW Sprinter・Chip Leader 追加
// @namespace    https://japanopt.bt.pokerweb.com.br/
// @version      0.2.2
// @description  Sprinter / Chip Leader の特殊賞を既存Prize末尾に追加・確認します。
// @match        https://japanopt.bt.pokerweb.com.br/*
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-sprinter-chip-leader-award.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-sprinter-chip-leader-award.user.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const APP = {
    panelId: 'pwAwardPlanPanel',
    stateKey: 'PW_AWARD_PLAN_APPEND_STATE_V1',
    urlCacheKey: 'PW_SHARED_TOURNAMENT_URL_CACHE_V1',
    openListPath: '/torneio/abertos',
    endpointPrizeList: '/torneio/abas/premiacao/faixas_premiacoes',
    endpointPotTotal: id => `/torneio/abas/premiacao/pot_total/${id}`,
    pageLength: 100,
    waitMs: 25000,
    pollMs: 300
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const norm = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const compact = value => norm(value).toLowerCase().replace(/[【】\[\]（）()#＃・･☆★\s_\-\/:：]/g, '');
  const cell = (row, index) => row?.[index] ?? '';

  function yen(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? `¥${n.toLocaleString('ja-JP')}` : String(value || '');
  }

  function moneyNumber(value) {
    const text = String(value ?? '').replace(/[^\d.-]/g, '');
    if (!text || text === '-' || text === '.') return null;
    const n = Number(text);
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  function parseRank(value) {
    const text = norm(value);
    const m = text.match(/^(\d+)(?:st|nd|rd|th|位)?$/i);
    return m ? Number(m[1]) : null;
  }

  function splitTsv(raw) {
    return String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(line => line.split('\t'));
  }

  function safeJsonParse(value, fallback) {
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }

  function loadState() {
    return safeJsonParse(localStorage.getItem(APP.stateKey), {});
  }

  function saveState(next) {
    const state = { ...loadState(), ...next };
    localStorage.setItem(APP.stateKey, JSON.stringify(state));
    return state;
  }

  function setStatus(text) {
    const el = document.querySelector('#pwAwardStatus');
    if (el) el.textContent = text || '';
  }

  function setDetail(text) {
    const el = document.querySelector('#pwAwardDetail');
    if (el) el.value = text || '';
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      prompt('コピーしてください:', text);
      return false;
    }
  }

  function waitForWindowLoad(win) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        if (!win || win.closed) return reject(new Error('window closed'));
        try {
          if (win.document && win.document.readyState === 'complete') return resolve();
        } catch (_) {}
        if (Date.now() - started > APP.waitMs) return resolve();
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  async function waitForInWindow(win, fn, timeoutMs = 18000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
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
      const $ = win.jQuery || win.$;
      const node = win.document.querySelector('table.dataTable, table');
      if (!$ || !node || !$.fn?.DataTable) return null;
      return $(node).DataTable();
    } catch (_) {
      return null;
    }
  }

  function dataTableNode(dt) {
    try { return dt?.table?.().node?.() || null; } catch (_) { return null; }
  }

  function rowsForRead(win, searchApplied) {
    const rows = [];
    const seen = new Set();
    const add = row => {
      if (!row || !String(row.innerHTML || '').includes('/torneio/painel/')) return;
      const key = row.outerHTML || row.innerText || Math.random();
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(row);
    };
    const dt = dataTable(win);
    try {
      if (dt) {
        const selector = searchApplied ? { search: 'applied' } : {};
        dt.rows(selector).nodes().each(add);
        const node = dataTableNode(dt);
        if (node) [...node.querySelectorAll('tbody tr')].forEach(add);
      }
      [...win.document.querySelectorAll('tr')].forEach(add);
    } catch (_) {}
    return rows;
  }

  function waitDraw(win, dt) {
    return new Promise(resolve => {
      const node = dataTableNode(dt);
      if (!node || !win.jQuery) return resolve(false);
      let done = false;
      let timer = null;
      const finish = ok => {
        if (done) return;
        done = true;
        if (timer !== null) win.clearTimeout(timer);
        try { win.jQuery(node).off('draw.dt', onDraw); } catch (_) {}
        resolve(ok);
      };
      function onDraw() {
        finish(true);
      }
      timer = win.setTimeout(() => finish(false), APP.waitMs);
      try { win.jQuery(node).one('draw.dt', onDraw); } catch (_) { finish(false); }
    });
  }

  async function searchTable(win, prefix) {
    const dt = dataTable(win);
    if (dt) {
      const draw = waitDraw(win, dt);
      try {
        dt.search(prefix);
        dt.page.len(APP.pageLength);
        dt.page(0);
        dt.draw();
        await draw;
        await sleep(200);
      } catch (_) {}
      return dt;
    }
    const input = [...win.document.querySelectorAll('.dataTables_filter input[type="search"], input[type="search"]')].find(el => el.offsetParent !== null);
    if (input) {
      input.value = prefix;
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
      input.dispatchEvent(new win.Event('change', { bubbles: true }));
      await sleep(900);
    }
    return dataTable(win);
  }

  async function goTablePage(win, dt, page) {
    if (!dt) throw new Error('DataTable not found');
    const draw = waitDraw(win, dt);
    try {
      dt.page(page).draw('page');
    } catch (e) {
      throw new Error(`DataTable page ${page + 1} draw failed: ${e.message || e}`);
    }
    const drawn = await draw;
    if (!drawn) throw new Error(`DataTable page ${page + 1} draw timeout`);
    await sleep(120);

    const actualPage = Number(dt.page.info()?.page ?? -1);
    if (actualPage !== page) {
      throw new Error(`DataTable page mismatch expected=${page + 1} actual=${actualPage + 1}`);
    }
  }

  function tournamentNoFromName(name) {
    const m = norm(name).match(/[#\uff03]\s*0*(\d{1,3})/);
    return m ? Number(m[1]) : null;
  }

  function dayNumber(name) {
    const text = norm(name);
    const m = text.match(/\bDay\s*(\d+)/i);
    return m ? Number(m[1]) : 0;
  }

  function isDayOne(name) {
    return /\bDay\s*1[A-Z]?\b/i.test(norm(name));
  }

  function cleanTournamentName(name) {
    return norm(name).replace(/\s*-\s*PokerWeb\s*$/i, '');
  }

  function extractTournamentTitleFromRow(rowText) {
    let s = norm(rowText);
    const m = s.match(/(\u3010[^\u3011]+\u3011\s*(?:#\d+[A-Za-z]?|\(s\d+\)|s\d+)\s+.+?)(?:\s+\d{1,2}\/\d{1,2}\/\d{4}|\s+Aberto|\s+Fechado|$)/i);
    if (m) return cleanTournamentName(m[1]);
    const m2 = s.match(/(\u3010[^\u3011]+\u3011.+?)(?:\s+\d{1,2}\/\d{1,2}\/\d{4}|\s+Aberto|\s+Fechado|$)/i);
    if (m2) return cleanTournamentName(m2[1]);
    s = s
      .replace(/^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s+/, '')
      .replace(/\s+\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}$/, '')
      .replace(/\s+Aberto$/i, '')
      .replace(/\s+Fechado$/i, '')
      .trim();
    return cleanTournamentName(s);
  }

  function extractTournament(row) {
    const html = row.innerHTML || '';
    const match = html.match(/\/torneio\/painel\/(\d+)/);
    if (!match) return null;
    const rowText = norm(row.innerText || row.textContent || '');
    const actualName = extractTournamentTitleFromRow(rowText);
    const withoutPrefix = actualName.replace(/^\u3010[^\u3011]+\u3011\s*/, '');
    const no = tournamentNoFromName(withoutPrefix);
    const shortName = withoutPrefix.replace(/^[#\uff03]\s*0*\d+\s*/, '').trim();
    return {
      tournamentId: match[1],
      url: `/torneio/painel/${match[1]}`,
      actualName,
      name: shortName,
      no,
      day: dayNumber(actualName),
      matchedRow: rowText
    };
  }

  function readCache() {
    const parsed = safeJsonParse(localStorage.getItem(APP.urlCacheKey), {});
    return parsed && typeof parsed === 'object' ? parsed : {};
  }

  function writeCache(cache) {
    localStorage.setItem(APP.urlCacheKey, JSON.stringify(cache));
  }

  function cacheUrl(entry) {
    if (!entry?.actualName || !entry?.tournamentId || !entry?.url) return;
    const cache = readCache();
    const key = `${entry.actualName}||${entry.tournamentId}`;
    cache[key] = {
      name: entry.actualName,
      tournamentId: entry.tournamentId,
      url: entry.url,
      painelUrl: entry.url,
      actualName: entry.actualName,
      matchedRow: entry.matchedRow || '',
      savedAt: new Date().toISOString(),
      source: 'sprinter-chip-leader-award'
    };
    writeCache(cache);
  }

  async function openListWindow() {
    const win = window.open(APP.openListPath, `pw_award_url_${Date.now()}`, 'width=1280,height=900');
    if (!win) throw new Error('Open tournament window could not be opened.');
    await waitForWindowLoad(win);
    await waitForInWindow(win, w => dataTable(w) || rowsForRead(w, false).length);
    await sleep(700);
    return win;
  }

  async function scanOpenUrls(prefix) {
    const found = [];
    const seen = new Set();
    const win = await openListWindow();
    try {
      const dt = await searchTable(win, prefix);
      const info = dt?.page?.info?.();
      const pages = info?.pages || 1;
      for (let p = 0; p < pages; p++) {
        await goTablePage(win, dt, p);
        for (const row of rowsForRead(win, true)) {
          const entry = extractTournament(row);
          if (!entry) continue;
          const hay = `${entry.actualName} ${entry.matchedRow || ''}`;
          if (!hay.includes(prefix) && !compact(hay).includes(compact(prefix))) continue;
          if (seen.has(entry.url)) continue;
          seen.add(entry.url);
          found.push(entry);
          cacheUrl(entry);
        }
      }
    } finally {
      try { if (!win.closed) win.close(); } catch (_) {}
    }
    found.sort((a, b) => Number(a.no || 0) - Number(b.no || 0) || String(a.actualName).localeCompare(String(b.actualName), 'ja'));
    return found;
  }

  function headerIndex(row, name) {
    const target = compact(name);
    return row.findIndex(v => compact(v) === target);
  }

  function rankLabel(value) {
    const n = parseRank(value);
    return n ? `${n}位` : norm(value);
  }

  function dayShort(value) {
    const text = norm(value);
    const m = text.match(/^Day\s*1([A-Z])(?:\s*Turbo)?$/i);
    if (m) return `1${m[1].toUpperCase()}${/Turbo/i.test(text) ? ' Turbo' : ''}`;
    const m2 = text.match(/^Day\s*(\d+)/i);
    if (m2) return `Day${m2[1]}`;
    if (/All\s*Day\s*1/i.test(text)) return '';
    return text;
  }

  function makeAwardDesc(condition, day, rank) {
    const cond = norm(condition);
    const d = dayShort(day);
    const r = rankLabel(rank);
    if (/chip\s*leader/i.test(cond)) return `チップリーダー${r}`;
    if (/sprinter/i.test(cond)) return `${d ? `${d} ` : ''}Sprinter ${r}`;
    return [d, cond, r].filter(Boolean).join(' ');
  }

  function isTargetCondition(value) {
    return /chip\s*leader|sprinter/i.test(norm(value));
  }

  function parseAwardTable(raw) {
    const rows = splitTsv(raw);
    const headerRowIndex = rows.findIndex(row =>
      row.some(v => /^Tournament$/i.test(norm(v))) &&
      row.some(v => /^Conditions$/i.test(norm(v))) &&
      row.some(v => /^Rank$/i.test(norm(v))) &&
      row.some(v => /^Prize$/i.test(norm(v)))
    );
    if (headerRowIndex < 0) return { errors: ['Award表のヘッダーが見つかりません。'], groups: [] };

    const header = rows[headerRowIndex];
    const tournamentCol = headerIndex(header, 'Tournament');
    const conditionCol = headerIndex(header, 'Conditions');
    const rankCol = headerIndex(header, 'Rank');
    const prizeCol = headerIndex(header, 'Prize');
    const dayCol = conditionCol + 1;
    const errors = [];
    if (tournamentCol < 0 || conditionCol < 0 || rankCol < 0 || prizeCol < 0) errors.push('Tournament / Conditions / Rank / Prize列を確認してください。');
    if (errors.length) return { errors, groups: [] };

    let currentTournament = '';
    let currentCondition = '';
    let currentDay = '';
    const items = [];
    for (let r = headerRowIndex + 1; r < rows.length; r++) {
      const row = rows[r];
      const tournament = norm(cell(row, tournamentCol));
      const condition = norm(cell(row, conditionCol));
      const day = norm(cell(row, dayCol));
      const rank = norm(cell(row, rankCol));
      const prize = moneyNumber(cell(row, prizeCol));

      if (tournament) currentTournament = tournament;
      if (condition) currentCondition = condition;
      if (day) currentDay = day;
      if (/^Total\s*Prize$/i.test(currentCondition)) {
        currentCondition = '';
        currentDay = '';
        continue;
      }
      if (!currentTournament || !currentCondition || !isTargetCondition(currentCondition)) continue;
      if (!rank || !prize || prize <= 0) continue;

      items.push({
        tournament: currentTournament,
        condition: currentCondition,
        day: currentDay,
        rank,
        amount: prize,
        desc: makeAwardDesc(currentCondition, currentDay, rank),
        sourceRow: r + 1
      });
    }

    const byTournament = new Map();
    for (const item of items) {
      if (!byTournament.has(item.tournament)) byTournament.set(item.tournament, []);
      byTournament.get(item.tournament).push(item);
    }
    const groups = [...byTournament.entries()].map(([inputName, awards], index) => ({
      id: `award-${index + 1}`,
      inputName,
      awards,
      appendTotal: awards.reduce((sum, item) => sum + item.amount, 0)
    }));
    if (!groups.length) return { errors: ['Sprinter / Chip Leader のAward行が見つかりません。'], groups: [] };
    return { errors: [], groups };
  }

  function baseKey(value) {
    return compact(value)
      .replace(/^nlh/, '')
      .replace(/sponsoredby.+$/i, '')
      .replace(/day\d+[a-z]?/ig, '')
      .replace(/turbo/ig, '');
  }

  function strictAliasKey(value) {
    const key = baseKey(value);
    if (/pokerplayerschampionship|^ppc$/.test(key)) return 'pokerplayerschampionship';
    if (/mainevent/.test(key)) return 'mainevent';
    if (/millions/.test(key)) return 'millions';
    return key;
  }

  function matchTournament(group, entries) {
    const target = strictAliasKey(group.inputName);
    let candidates = entries.filter(entry => {
      if (isDayOne(entry.actualName)) return false;
      const keys = [entry.name, entry.actualName, entry.matchedRow]
        .map(strictAliasKey)
        .filter(Boolean);
      return keys.some(key =>
        key.includes(target) ||
        target.includes(key) ||
        (target === 'pokerplayerschampionship' && /ppc|pokerplayers/.test(key))
      );
    });
    if (/mainevent|millions/.test(target)) {
      const maxDay = Math.max(0, ...candidates.map(c => c.day || 0).filter(d => d > 1));
      if (maxDay) candidates = candidates.filter(c => c.day === maxDay);
    }
    if (candidates.length === 1) return { entry: candidates[0], needsConfirm: false, candidates };
    return { entry: null, needsConfirm: true, candidates };
  }

  function buildPlan(groups, entries) {
    const items = groups.map(group => {
      const matched = matchTournament(group, entries);
      const entry = matched.entry;
      return {
        id: group.id,
        inputName: group.inputName,
        awards: group.awards,
        appendTotal: group.appendTotal,
        candidates: matched.candidates,
        tournamentName: entry?.actualName || '',
        tournamentId: entry?.tournamentId || '',
        url: entry?.url || '',
        planJudgement: entry ? '候補確定' : '要確認',
        note: entry ? '自動一致' : 'PokerWeb大会を選択してください。'
      };
    });
    return { createdAt: new Date().toISOString(), entries, items };
  }

  function matrixLog(plan, stage = 'PLAN') {
    const maxRows = Math.max(0, ...plan.items.map(item => item.awards.length));
    const rows = [
      ['PW大会名', ...plan.items.map(item => item.tournamentName || item.inputName)],
      ['大会ID', ...plan.items.map(item => item.tournamentId || '')],
      ['元表記', ...plan.items.map(item => item.inputName)],
      ['判定', ...plan.items.map(item => item.writeStatus || item.checkStatus || item.planJudgement || '')],
      ['追加件数', ...plan.items.map(item => item.awards.length)],
      ['追加Total', ...plan.items.map(item => yen(item.appendTotal))],
      ['既存行数', ...plan.items.map(item => item.existingCount ?? '')],
      ['追加開始位置', ...plan.items.map(item => item.appendStart ?? '')],
      ['備考', ...plan.items.map(item => item.writeNote || item.checkNote || item.note || '')]
    ];
    for (let i = 0; i < maxRows; i++) {
      rows.push([String(i + 1), ...plan.items.map(item => {
        const award = item.awards[i];
        return award ? `${award.desc} / ${yen(award.amount)}` : '';
      })]);
    }
    return rows.map(row => row.join('\t')).join('\n');
  }

  function tournamentIdFromInput(value) {
    const text = norm(value);
    const m = text.match(/(?:\/painel\/|^)(\d{4,6})(?:\D|$)/);
    return m ? m[1] : '';
  }

  function byNameFromDoc(doc, name) {
    return [...doc.querySelectorAll(`[name="${CSS.escape(name)}"]`)];
  }

  function readCurrentRows(doc) {
    const names = ['id[]', 'status[]', 'tipo[]', 'id_grupo[]', 'posicao[]', 'prizes_desc[]', 'prizes_valor[]', 'valor_vaga[]'];
    const max = Math.max(0, ...names.map(name => byNameFromDoc(doc, name).length));
    const rows = [];
    for (let i = 0; i < max; i++) {
      const row = { index: i };
      for (const name of names) row[name] = byNameFromDoc(doc, name)[i]?.value ?? '';
      rows.push(row);
    }
    return rows;
  }

  function titleOfDoc(doc) {
    return norm(
      doc.querySelector('input[name="titulo_torneio"], input[name="nome"], input[name="name"]')?.value ||
      doc.querySelector('h1,h2,.page-title,.box-title,.panel-title,.breadcrumb')?.textContent ||
      doc.title
    ).replace(/\s*-\s*PokerWeb\s*$/i, '');
  }

  function getDocValue(doc, name) {
    const direct = doc.querySelector(`[name="${CSS.escape(name)}"]`)?.value || '';
    if (direct || name !== 'codbloq') return direct;
    const html = doc.__rawHtml || '';
    const patterns = [
      /name\s*=\s*["']codbloq["'][^>]*value\s*=\s*["']([^"']+)["']/i,
      /value\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']codbloq["']/i,
      /["']codbloq["']\s*:\s*["']([^"']+)["']/i,
      /\bcodbloq\s*=\s*["']([^"']+)["']/i
    ];
    for (const pattern of patterns) {
      const m = html.match(pattern);
      if (m) return m[1];
    }
    return '';
  }

  async function fetchDoc(url) {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.__rawHtml = html;
    doc.__status = res.status;
    return doc;
  }

  function currentPrizeTotal(doc) {
    const values = byNameFromDoc(doc, 'prizes_valor[]').map(el => moneyNumber(el.value)).filter(n => n && n > 0);
    return values.reduce((sum, n) => sum + n, 0);
  }

  function readPrizeRows(doc) {
    return readCurrentRows(doc)
      .map(row => ({
        rank: Number(row['posicao[]']),
        desc: norm(row['prizes_desc[]']),
        amount: moneyNumber(row['prizes_valor[]']) || 0
      }))
      .filter(row => row.rank > 0 && row.amount > 0);
  }

  function buildAppendPayload(item, doc) {
    const currentRows = readCurrentRows(doc);
    const existingPrizeRows = currentRows.filter(row => Number(row['posicao[]']) > 0);
    const maxPos = Math.max(0, ...existingPrizeRows.map(row => Number(row['posicao[]']) || 0));
    item.existingCount = existingPrizeRows.length;
    item.appendStart = maxPos + 1;

    const payload = {
      salvar: ['prizes'],
      id_torneio: [String(item.tournamentId)],
      'id[]': [''],
      'status[]': ['novo'],
      'tipo[]': [''],
      'id_grupo[]': [''],
      'posicao[]': ['0'],
      'prizes_desc[]': [''],
      'prizes_valor[]': [''],
      'valor_vaga[]': [''],
      'prizes_visivel[]': ['0'],
      codbloq: [getDocValue(doc, 'codbloq')]
    };

    for (const old of existingPrizeRows.sort((a, b) => Number(a['posicao[]']) - Number(b['posicao[]']))) {
      payload['id[]'].push(old['id[]'] || '');
      payload['status[]'].push(old['status[]'] || '0');
      payload['tipo[]'].push(old['tipo[]'] || '0');
      payload['id_grupo[]'].push(old['id_grupo[]'] || '0');
      payload['posicao[]'].push(String(Number(old['posicao[]'])));
      payload['prizes_desc[]'].push(old['prizes_desc[]'] || '');
      payload['prizes_valor[]'].push(String(moneyNumber(old['prizes_valor[]']) || ''));
      payload['valor_vaga[]'].push(old['valor_vaga[]'] || '0');
    }

    item.awards.forEach((award, index) => {
      payload['id[]'].push('');
      payload['status[]'].push('novo');
      payload['tipo[]'].push('0');
      payload['id_grupo[]'].push('0');
      payload['posicao[]'].push(String(maxPos + index + 1));
      payload['prizes_desc[]'].push(award.desc);
      payload['prizes_valor[]'].push(String(award.amount));
      payload['valor_vaga[]'].push('');
    });
    return payload;
  }

  function objectToUrlParams(object) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(object)) {
      if (Array.isArray(value)) {
        for (const item of value) params.append(key, item);
      } else {
        params.append(key, value);
      }
    }
    return params;
  }

  function formatPwNumber(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n.toLocaleString('en-US') : String(value || 0);
  }

  async function postPrizeList(item, doc) {
    const codbloq = getDocValue(doc, 'codbloq');
    if (!codbloq) throw new Error(`codbloq not found. GET status=${doc.__status || ''} title=${titleOfDoc(doc)}`);
    const params = new URLSearchParams();
    params.append('dados', JSON.stringify(buildAppendPayload(item, doc)));
    params.append('codbloq', codbloq);
    return fetch(APP.endpointPrizeList, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: params,
      redirect: 'manual'
    });
  }

  async function postPotTotal(item, doc, total) {
    const codbloq = getDocValue(doc, 'codbloq');
    const params = objectToUrlParams({
      layout: 'pot_config',
      potautomatico: '0',
      potmanual: formatPwNumber(total),
      potgarantido: '0',
      codbloq
    });
    return fetch(APP.endpointPotTotal(item.tournamentId), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: params,
      redirect: 'manual'
    });
  }

  function awardExists(actualRows, award) {
    return actualRows.some(row => row.desc === award.desc && Number(row.amount) === Number(award.amount));
  }

  async function checkPlan() {
    const plan = loadState().plan;
    if (!plan?.items?.length) return alert('先にPLAN作成してください。');
    for (const item of plan.items) {
      if (!item.url) {
        item.checkStatus = '未検出';
        item.checkNote = 'URL未登録';
        continue;
      }
      setStatus(`CHECK中: ${item.tournamentName || item.inputName}`);
      try {
        const doc = await fetchDoc(item.url);
        const actualRows = readPrizeRows(doc);
        const missing = item.awards.filter(award => !awardExists(actualRows, award));
        item.checkStatus = missing.length ? '不一致' : 'OK';
        item.checkNote = missing.length ? `未検出 ${missing.slice(0, 3).map(a => `${a.desc} ${yen(a.amount)}`).join(' / ')}` : '追加済み一致';
        item.existingCount = actualRows.length;
      } catch (error) {
        item.checkStatus = '未検出';
        item.checkNote = `GET失敗 ${error.message || error}`;
      }
    }
    saveState({ plan });
    renderPlan(plan);
    await copyText(matrixLog(plan, 'CHECK'));
    setStatus('CHECK完了。必要に応じてCHECK COPYを押してください。');
    alert('CHECK完了');
  }

  async function writePlan() {
    const plan = loadState().plan;
    if (!plan?.items?.length) return alert('先にPLAN作成してください。');
    const unresolved = plan.items.filter(item => !item.tournamentId || !item.url);
    if (unresolved.length) return alert('未確認項目があります。先に修正してください。');
    if (!confirm(`Sprinter / Chip Leader を既存Prize末尾に追加します。\n対象: ${plan.items.length}件\n\n実行しますか？`)) return;

    for (const item of plan.items) {
      setStatus(`書込中: ${item.tournamentName || item.inputName}`);
      try {
        const doc = await fetchDoc(item.url);
        const oldTotal = currentPrizeTotal(doc);
        const newTotal = oldTotal + item.appendTotal;
        const prizeRes = await postPrizeList(item, doc);
        const potRes = await postPotTotal(item, doc, newTotal);
        await sleep(500);
        const verifyDoc = await fetchDoc(item.url);
        const actualRows = readPrizeRows(verifyDoc);
        const missing = item.awards.filter(award => !awardExists(actualRows, award));
        item.writeStatus = missing.length ? '書込失敗' : '書込OK';
        item.writeNote = [
          `Prize HTTP ${prizeRes.status}`,
          `Pot HTTP ${potRes.status}`,
          `旧Total ${yen(oldTotal)} → 新Total ${yen(newTotal)}`,
          missing.length ? `未検出 ${missing.slice(0, 3).map(a => a.desc).join(' / ')}` : '追加確認OK'
        ].filter(Boolean).join(' / ');
        item.existingCount = actualRows.length - item.awards.length;
      } catch (error) {
        item.writeStatus = '書込失敗';
        item.writeNote = error.message || String(error);
      }
      saveState({ plan });
      renderPlan(plan);
    }
    const text = matrixLog(plan, 'WRITE');
    await copyText(text);
    setStatus('書込完了。必要に応じて書込コピーを押してください。');
    alert('書込完了');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function candidateLabel(entry) {
    return `${entry.actualName} / ${entry.tournamentId}`;
  }

  function shouldShowItem(item, showAll) {
    if (showAll) return true;
    if (!item.tournamentId || item.planJudgement === '要確認') return true;
    if (item.writeStatus || item.checkStatus) return true;
    return false;
  }

  function renderPlan(plan) {
    const box = document.querySelector('#pwAwardConfirm');
    if (!box) return;
    const auto = plan.items.filter(i => i.planJudgement === '候補確定').length;
    const confirm = plan.items.filter(i => i.planJudgement === '要確認').length;
    const showAll = loadState().showConfirmed === true;
    const visibleItems = plan.items.filter(item => shouldShowItem(item, showAll));
    box.innerHTML = `
      <div class="pwap-summary">URLスキャン完了: ${plan.entries?.length || 0}件 / 候補確定 ${auto}件 / 要確認 ${confirm}件</div>
      ${confirm ? '' : '<div class="pwap-ok">すべて自動確認済みです。PLAN COPYで確認してください。</div>'}
      ${visibleItems.map(itemCardHtml).join('')}
      <button data-action="toggle-confirmed" style="margin-top:8px;background:#475569;color:white;">${showAll ? '確認済みを隠す' : '確認済みも表示'}</button>
    `;
    for (const select of box.querySelectorAll('select[data-tournament-select]')) {
      select.addEventListener('change', () => updateItemTournament(select));
    }
    for (const button of box.querySelectorAll('button[data-action="manual-url"]')) {
      button.addEventListener('click', () => updateItemFromManualUrl(button));
    }
    const toggle = box.querySelector('button[data-action="toggle-confirmed"]');
    if (toggle) {
      toggle.addEventListener('click', () => {
        saveState({ showConfirmed: !showAll });
        renderPlan(loadState().plan || plan);
      });
    }
  }

  function itemCardHtml(item) {
    const options = ['<option value="">候補なし</option>']
      .concat((item.candidates || []).map(entry => `<option value="${escapeHtml(entry.tournamentId)}" ${String(entry.tournamentId) === String(item.tournamentId) ? 'selected' : ''}>${escapeHtml(candidateLabel(entry))}</option>`))
      .join('');
    const rows = item.awards.map(award => `<div class="pwap-row"><span>${escapeHtml(award.desc)}</span><b>${escapeHtml(yen(award.amount))}</b></div>`).join('');
    return `
      <div class="pwap-card">
        <div class="pwap-title">${escapeHtml(item.inputName)}</div>
        <label>PokerWeb大会</label>
        <select data-tournament-select="${escapeHtml(item.id)}">${options}</select>
        <div style="display:flex;gap:6px;margin-top:6px;">
          <input data-manual-url="${escapeHtml(item.id)}" placeholder="PokerWeb ID または URL" value="">
          <button data-action="manual-url" data-id="${escapeHtml(item.id)}" style="background:#e5e7eb;color:#111827;white-space:nowrap;">URL入力</button>
        </div>
        <div class="pwap-note">判定: ${escapeHtml(item.writeStatus || item.checkStatus || item.planJudgement || '')} / ${escapeHtml(item.writeNote || item.checkNote || item.note || '')}</div>
        <div class="pwap-awards">${rows}</div>
      </div>
    `;
  }

  function updateItemTournament(select) {
    const plan = loadState().plan;
    const item = plan?.items?.find(i => i.id === select.getAttribute('data-tournament-select'));
    if (!item) return;
    const entry = (item.candidates || []).find(e => String(e.tournamentId) === String(select.value));
    if (!entry) {
      item.tournamentName = '';
      item.tournamentId = '';
      item.url = '';
      item.planJudgement = '要確認';
      item.note = 'PokerWeb大会を選択してください。';
    } else {
      item.tournamentName = entry.actualName;
      item.tournamentId = entry.tournamentId;
      item.url = entry.url;
      item.planJudgement = '人工確認';
      item.note = '人工選択';
    }
    saveState({ plan });
    renderPlan(plan);
  }

  async function updateItemFromManualUrl(button) {
    const plan = loadState().plan;
    const item = plan?.items?.find(i => i.id === button.getAttribute('data-id'));
    if (!item) return;
    const input = document.querySelector(`input[data-manual-url="${CSS.escape(item.id)}"]`);
    const id = tournamentIdFromInput(input?.value || '');
    if (!id) return alert('PokerWeb ID または URLを入力してください。');
    item.tournamentId = id;
    item.url = `/torneio/painel/${id}`;
    item.tournamentName = item.tournamentName || `PokerWeb #${id}`;
    try {
      const doc = await fetchDoc(item.url);
      const title = titleOfDoc(doc);
      if (title) item.tournamentName = title;
    } catch (_) {}
    item.planJudgement = '人工確認';
    item.note = 'URL手入力';
    saveState({ plan });
    renderPlan(plan);
  }

  async function buildPlanFromInput() {
    try {
      const prefix = norm(document.querySelector('#pwAwardPrefix')?.value || '');
      const raw = document.querySelector('#pwAwardRaw')?.value || '';
      if (!prefix) return alert('大会名を入力してください。');
      const parsed = parseAwardTable(raw);
      if (parsed.errors.length) return alert(parsed.errors.join('\n'));
      setStatus('オープントーナメントをスキャン中...');
      const entries = await scanOpenUrls(prefix);
      const plan = buildPlan(parsed.groups, entries);
      saveState({ plan, parsedGroups: parsed.groups });
      renderPlan(plan);
      const text = matrixLog(plan, 'PLAN');
      await copyText(text);
      setDetail(text);
      setStatus('PLAN作成完了。必要に応じてPLAN COPYを押してください。');
      alert(`PLAN作成完了\n\n候補確定: ${plan.items.filter(i => i.planJudgement === '候補確定').length}件\n要確認: ${plan.items.filter(i => i.planJudgement === '要確認').length}件`);
    } catch (error) {
      console.error(error);
      setStatus(`ERROR: ${error.message || error}`);
      alert(error.message || String(error));
    }
  }

  function installPanel() {
    if (document.getElementById(APP.panelId)) return;
    const panel = document.createElement('div');
    panel.id = APP.panelId;
    panel.innerHTML = `
      <style>
        #${APP.panelId}{position:fixed;right:18px;top:70px;width:620px;max-height:88vh;overflow:auto;z-index:999998;background:#111827;color:#e5e7eb;border:1px solid #475569;border-radius:10px;padding:14px;font-family:Arial,"Yu Gothic","Meiryo",sans-serif;box-shadow:0 12px 30px rgba(0,0,0,.45)}
        #${APP.panelId} textarea,#${APP.panelId} input,#${APP.panelId} select{width:100%;box-sizing:border-box;background:#020617;color:#e5e7eb;border:1px solid #475569;border-radius:8px;padding:10px;font-size:14px}
        #${APP.panelId} button{border:0;border-radius:8px;padding:11px 12px;font-weight:700;cursor:pointer;font-size:14px}
        #${APP.panelId} label{display:block;margin-top:10px;margin-bottom:5px;font-weight:700}
        .pwap-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
        .pwap-summary{margin:12px 0;font-weight:700;color:#bfdbfe}
        .pwap-ok{margin:8px 0;padding:10px;border:1px solid #14532d;border-radius:8px;background:#052e16;color:#bbf7d0;font-weight:700}
        .pwap-card{border:1px solid #475569;border-radius:8px;padding:12px;margin:10px 0;background:#0f172a}
        .pwap-title{font-size:18px;font-weight:800;color:#fde68a;margin-bottom:10px}
        .pwap-note{margin:8px 0;color:#cbd5e1}
        .pwap-awards{display:grid;gap:4px;margin-top:8px}
        .pwap-row{display:flex;justify-content:space-between;gap:12px;border-top:1px solid #1f2937;padding-top:4px}
        #pwAwardDetail{display:none;height:140px;margin-top:8px}
      </style>
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
        <strong>PW Sprinter・Chip Leader 追加</strong>
        <button id="pwAwardMin" style="background:#374151;color:white;">Min</button>
      </div>
      <div id="pwAwardBody">
        <label>大会名</label>
        <input id="pwAwardPrefix" placeholder="例: 【JOPT 2026 Tokyo #02】">
        <label>Award表を貼り付けてください</label>
        <textarea id="pwAwardRaw" style="height:170px" spellcheck="false"></textarea>
        <div class="pwap-grid">
          <button id="pwAwardBuild" style="background:#2563eb;color:white;">PLAN作成</button>
          <button id="pwAwardWrite" style="background:#b45309;color:white;">追加開始</button>
          <button id="pwAwardCheck" style="background:#16a34a;color:white;">CHECK</button>
          <button id="pwAwardCopyPlan" style="background:#334155;color:white;">PLAN COPY</button>
          <button id="pwAwardCopyCheck" style="background:#334155;color:white;">CHECK COPY</button>
          <button id="pwAwardCopyWrite" style="background:#334155;color:white;">書込コピー</button>
        </div>
        <div id="pwAwardStatus" style="margin-top:8px;color:#93c5fd;font-weight:700;"></div>
        <div id="pwAwardConfirm"></div>
        <button id="pwAwardToggleDetail" style="margin-top:8px;background:#475569;color:white;">詳細</button>
        <textarea id="pwAwardDetail" readonly></textarea>
      </div>
    `;
    document.body.appendChild(panel);

    let minimized = false;
    document.querySelector('#pwAwardMin').onclick = () => {
      minimized = !minimized;
      document.querySelector('#pwAwardBody').style.display = minimized ? 'none' : '';
      document.querySelector('#pwAwardMin').textContent = minimized ? '復元' : 'Min';
    };
    document.querySelector('#pwAwardBuild').onclick = buildPlanFromInput;
    document.querySelector('#pwAwardWrite').onclick = writePlan;
    document.querySelector('#pwAwardCheck').onclick = checkPlan;
    document.querySelector('#pwAwardCopyPlan').onclick = async () => {
      const plan = loadState().plan;
      if (!plan) return alert('PLANがありません。');
      await copyText(matrixLog(plan, 'PLAN'));
    };
    document.querySelector('#pwAwardCopyCheck').onclick = async () => {
      const plan = loadState().plan;
      if (!plan) return alert('CHECK結果がありません。');
      await copyText(matrixLog(plan, 'CHECK'));
    };
    document.querySelector('#pwAwardCopyWrite').onclick = async () => {
      const plan = loadState().plan;
      if (!plan) return alert('書込結果がありません。');
      await copyText(matrixLog(plan, 'WRITE'));
    };
    document.querySelector('#pwAwardToggleDetail').onclick = () => {
      const el = document.querySelector('#pwAwardDetail');
      el.style.display = el.style.display === 'none' || !el.style.display ? 'block' : 'none';
      if (el.style.display === 'block') el.value = matrixLog(loadState().plan || { items: [] }, 'PLAN');
    };

    const state = loadState();
    if (state.plan) renderPlan(state.plan);
  }

  installPanel();
})();
