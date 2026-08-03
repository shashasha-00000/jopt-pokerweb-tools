// ==UserScript==
// @name         PW Prize Plan 書込・確認
// @namespace    https://japanopt.pokerweb.com.br/
// @version      2.0.1
// @description  大会Prize表からPLANを作成し、PokerWebへの書込または読取確認を行います。
// @match        https://japanopt.pokerweb.com.br/*
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-prize-batch-manual.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-prize-batch-manual.user.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const APP = {
    name: 'PW-PRIZE-PLAN',
    panelId: 'pw-prize-plan-panel',
    stateKey: 'PW_PRIZE_PLAN_STATE_V2',
    urlCacheKey: 'PW_SHARED_TOURNAMENT_URL_CACHE_V1',
    endpointPrizeList: '/cb/torneio/abas/premiacao/faixas_premiacoes',
    endpointPotTotal: id => `/cb/torneio/abas/premiacao/pot_total/${encodeURIComponent(id)}`,
    listPages: [
      { label: 'OPEN', path: '/cb/torneio/abertos' }
    ],
    pageLength: 100,
    waitMs: 25000,
    pollMs: 300
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const detailLines = [];
  let running = false;

  function norm(value) {
    return String(value ?? '')
      .replace(/\u3000/g, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t\r\n]+/g, ' ')
      .trim();
  }

  function compact(value) {
    return norm(value)
      .replace(/[\/／\-‐‑‒–—―]/g, '')
      .replace(/\s+/g, '')
      .replace(/監査(?:済み|待ち)/g, '')
      .toLowerCase();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function nowText() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function debug(type, data) {
    const line = `[${nowText()}] ${type} ${typeof data === 'string' ? data : JSON.stringify(data)}`;
    detailLines.push(line);
    const el = document.querySelector('#pwPrizeDetail');
    if (el) el.value = detailLines.join('\n');
    console.log(`[${APP.name}]`, type, data);
  }

  function setStatus(text) {
    const el = document.querySelector('#pwPrizeStatus');
    if (el) el.textContent = text || '';
    debug('STATUS', text || '');
  }

  function safeJsonParse(text, fallback = null) {
    try { return JSON.parse(text); } catch (_) { return fallback; }
  }

  function loadState() {
    return safeJsonParse(sessionStorage.getItem(APP.stateKey), {});
  }

  function saveState(state) {
    sessionStorage.setItem(APP.stateKey, JSON.stringify(state || {}));
  }

  function moneyNumber(value) {
    const raw = String(value ?? '').trim();
    if (!raw || /\$|usdt|usd/i.test(raw) || /#DIV|#VALUE|#N\/A|ERROR/i.test(raw)) return null;
    if (/^-?\$/.test(raw)) return null;
    const cleaned = raw.replace(/[￥¥,]/g, '').replace(/\s+/g, '').replace(/[^\d.-]/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  function yen(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? `¥${n.toLocaleString('ja-JP')}` : '';
  }

  function splitTsv(raw) {
    return String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(line => line.split('\t'));
  }

  function cell(row, col) {
    return row && col >= 0 && col < row.length ? row[col] : '';
  }

  function parseRank(value) {
    const m = String(value || '').trim().match(/^(\d+)\s*(?:位|st|nd|rd|th)?$/i);
    return m ? Number(m[1]) : null;
  }

  function isPwCoin(value) {
    return /PW\s*COIN/i.test(String(value || ''));
  }

  function statusKind(value) {
    const text = norm(value);
    if (/不使用/.test(text)) return 'unused';
    if (/確定/.test(text)) return 'confirmed';
    if (/アップグレード|upgrade/i.test(text)) return 'upgrade';
    return 'unknown';
  }

  function statusLabel(kind, raw) {
    if (raw) return raw;
    if (kind === 'confirmed') return '確定レート';
    if (kind === 'upgrade') return 'アップグレード';
    if (kind === 'unused') return '不使用';
    return '状態不明';
  }

  function detectVersion(title) {
    const text = norm(title).toLowerCase();
    if (/コインのみ|coin only|pw coin only/.test(text)) return 'coin';
    if (/voucherのみ|voucher only|バウチャーのみ/.test(text)) return 'voucher';
    if (/apt抜き|apt抜き|APT抜き/i.test(title)) return 'apt';
    if (/アップグレード|upgrade/i.test(text)) return 'upgrade';
    if (/全体/.test(title)) return 'all';
    return 'base';
  }

  function stripVersion(title) {
    return norm(title)
      .replace(/[（(]\s*(?:全体|コインのみ|voucherのみ|バウチャーのみ|APT抜き|apt抜き)\s*[）)]/gi, '')
      .replace(/\s*(?:アップグレード|upgrade)\s*$/i, '')
      .trim();
  }

  function baseKey(title) {
    const alias = aliasKey(title);
    if (alias) return alias;
    return compact(stripVersion(title)
      .replace(/^[#＃]\s*\d{1,3}\s+/, '')
      .replace(/1\s*人分/g, '')
      .replace(/\b(player|team|nlh|plo|fl|hold'?em|sponsored|by)\b/gi, ' ')
      .replace(/\bPPC\b/gi, 'Poker Players Championship'));
  }

  function aliasKey(title) {
    const text = norm(stripVersion(title));
    if (/^PPC\b/i.test(text)) return compact('Poker Players Championship');
    if (/^10\s*-\s*Game\s*CS\b/i.test(text)) return compact('10-Game MIX Championship');
    return '';
  }

  function tournamentNoFromName(name) {
    const text = norm(name).replace(/^【[^】]+】\s*/, '');
    const m = text.match(/^[#＃]\s*0*(\d{1,3})(?:\b|\s)/);
    return m ? String(Number(m[1])) : '';
  }

  function prizeGroupKey(title) {
    const no = tournamentNoFromName(title);
    const key = baseKey(title);
    return no ? `no:${no}:${key}` : `name:${key}`;
  }

  function strictNameMatch(inputKey, pwKey, inputName = '') {
    if (!inputKey || !pwKey) return false;
    if (inputKey === pwKey) return true;
    if (inputKey === 'pokerplayerschampionship' || /\bPPC\b/i.test(norm(inputName))) {
      return pwKey.includes('pokerplayerschampionship');
    }
    if (inputKey === '10gamemixchampionship' || /^10\s*-\s*Game\s*CS\b/i.test(norm(inputName))) {
      return pwKey.includes('10gamemixchampionship');
    }
    if (inputKey.length < 5 || pwKey.length < 5) return false;
    return pwKey.includes(inputKey);
  }

  function dayNumber(name) {
    const m = String(name || '').match(/\bDay\s*(\d+)/i);
    return m ? Number(m[1]) : null;
  }

  function isDayOne(name) {
    return /\bDay\s*1[A-Z]?\b/i.test(String(name || ''));
  }

  function teamSizeFromText(text) {
    const s = norm(text).toLowerCase();
    if (/3on3/.test(s)) return 3;
    if (/2on2|tag team|twins/.test(s)) return 2;
    return 1;
  }

  function isMultiPlayerGroup(group) {
    const text = `${group?.inputName || ''} ${(group?.variants || []).map(v => `${v.sourceTitle} ${v.currency}`).join(' ')}`;
    return /3on3|2on2|tag team|twins|1\s*人分|player/i.test(text);
  }

  function findRow(rows, pattern) {
    return rows.findIndex(row => row.some(v => pattern.test(norm(v))));
  }

  function findRankRows(rows, currencyRowIndex) {
    const start = Math.max(0, currencyRowIndex + 1);
    const maxCols = Math.max(0, ...rows.map(row => row.length));
    let best = { col: 0, items: [] };
    for (let col = 0; col < Math.min(maxCols, 12); col++) {
      const items = [];
      for (let r = start; r < rows.length; r++) {
        const rank = parseRank(cell(rows[r], col));
        if (rank) items.push({ row: rows[r], rowIndex: r, rank, rankCol: col });
      }
      if (items.length > best.items.length) best = { col, items };
    }
    const firstRank = best.items.findIndex(item => item.rank === 1);
    const source = firstRank >= 0 ? best.items.slice(firstRank) : best.items;
    const clean = [];
    const seen = new Set();
    let prev = 0;
    for (const item of source) {
      const labelText = norm(item.row.join(' '));
      if (/\bTotal\b|合計|In Prize|Status|Entry|Fee|Rake|PW\s*COIN|USDT/i.test(labelText)) continue;
      if (clean.length && item.rank === 1 && prev > 1) break;
      if (clean.length && item.rank < prev) break;
      if (seen.has(item.rank)) continue;
      clean.push(item);
      seen.add(item.rank);
      prev = item.rank;
    }
    clean.rankCol = best.col;
    clean.rawCount = best.items.length;
    clean.skippedBeforeFirstRank = firstRank > 0 ? firstRank : 0;
    return clean;
  }

  function looksLikeTitle(value) {
    const text = norm(value);
    if (!text) return false;
    if (/^(Entry|Fee|Rake|Other Costs|USDT|USD|PW\s*COIN|JPY|Date|Close|Total|Status|In Prize|In Prize %)$/i.test(text)) return false;
    if (/^\d{1,2}\/\d{1,2}/.test(text)) return false;
    return /[A-Za-z\u3040-\u30ff\u3400-\u9fff#＃]/.test(text);
  }

  function blockStatus(statusRow, col, start, end) {
    const same = norm(cell(statusRow, col));
    if (same) return same;
    for (let c = col; c >= start; c--) {
      const v = norm(cell(statusRow, c));
      if (v) return v;
    }
    for (let c = col + 1; c < end; c++) {
      const v = norm(cell(statusRow, c));
      if (v) return v;
    }
    return '';
  }

  function parsePrizeSheet(raw) {
    const rows = splitTsv(raw);
    let titleRowIndex = findRow(rows, /^Tournament$/i);
    if (titleRowIndex < 0) titleRowIndex = 0;
    const totalRowIndex = findRow(rows, /^Total$/i);
    let statusRowIndex = findRow(rows, /^Status$/i);
    if (statusRowIndex < 0) statusRowIndex = findRow(rows, /確定|不使用|アップグレード|upgrade/i);
    const currencyRowIndex = statusRowIndex >= 0
      ? rows.findIndex((row, i) => i > statusRowIndex && i < statusRowIndex + 6 && row.some(isPwCoin))
      : -1;
    const rankRows = currencyRowIndex >= 0 ? findRankRows(rows, currencyRowIndex) : [];
    const errors = [];
    if (titleRowIndex < 0) errors.push('大会名行が見つかりません。');
    if (totalRowIndex < 0) errors.push('Total行が見つかりません。');
    if (statusRowIndex < 0) errors.push('確定/不使用/アップグレード行が見つかりません。');
    if (currencyRowIndex < 0) errors.push('PW COIN行が見つかりません。');
    if (!rankRows.length) errors.push('順位行が見つかりません。');
    if (errors.length) return { errors, groups: [] };

    const titleRow = rows[titleRowIndex];
    const totalRow = rows[totalRowIndex];
    const statusRow = rows[statusRowIndex];
    const currencyRow = rows[currencyRowIndex];
    const titleCols = [];
    for (let col = 0; col < titleRow.length; col++) {
      const title = norm(cell(titleRow, col));
      if (looksLikeTitle(title)) titleCols.push({ col, title });
    }

    const variants = [];
    titleCols.forEach((item, index) => {
      const end = index + 1 < titleCols.length ? titleCols[index + 1].col : titleRow.length;
      for (let col = item.col; col < end; col++) {
        const currency = norm(cell(currencyRow, col));
        if (!isPwCoin(currency)) continue;
        const prizes = [];
        for (const rr of rankRows) {
          const amount = moneyNumber(cell(rr.row, col));
          if (amount == null || amount <= 0) continue;
          prizes.push({ rank: rr.rank, amount, sourceRow: rr.rowIndex + 1 });
        }
        const rawTotal = moneyNumber(cell(totalRow, col));
        const sumPrizes = prizes.reduce((sum, row) => sum + row.amount, 0);
        const statusRaw = blockStatus(statusRow, col, item.col, end);
        const kind = statusKind(statusRaw);
        const mode = /player/i.test(currency) ? 'player' : /team/i.test(currency) ? 'team' : (/1\s*人分|player/i.test(item.title) ? 'player' : /team|3on3|tag/i.test(item.title) ? 'team' : 'normal');
        const total = sumPrizes;
        variants.push({
          id: `v${variants.length}`,
          inputName: item.title,
          sourceTitle: item.title,
          baseName: stripVersion(item.title),
          key: prizeGroupKey(item.title),
          version: detectVersion(item.title),
          status: kind,
          statusRaw,
          mode,
          currency,
          total,
          prizes,
          valid: kind !== 'unused' && total > 0 && prizes.some(p => p.amount > 0) && prizes.every(p => p.amount >= 0),
          column: col,
          debug: {
            column: col + 1,
            rankColumn: (rankRows.rankCol ?? 0) + 1,
            rawRankRows: rankRows.rawCount || rankRows.length,
            skippedBeforeFirstRank: rankRows.skippedBeforeFirstRank || 0,
            rawTotal,
            sumPrizes,
            firstRank: prizes[0]?.rank || '',
            lastRank: prizes[prizes.length - 1]?.rank || '',
            firstSourceRow: prizes[0]?.sourceRow || '',
            lastSourceRow: prizes[prizes.length - 1]?.sourceRow || ''
          },
          summary: {
            total,
            first: prizes[0]?.amount || 0,
            last: prizes[prizes.length - 1]?.amount || 0,
            rows: prizes.length
          }
        });
      }
    });

    if (!variants.length) return { errors: ['Prize列が見つかりません。'], groups: [] };
    const grouped = new Map();
    for (const variant of variants) {
      if (!grouped.has(variant.key)) grouped.set(variant.key, []);
      grouped.get(variant.key).push(variant);
    }
    const groups = [...grouped.values()].map((vars, index) => ({
      id: `g${index}`,
      inputName: vars[0].baseName || vars[0].inputName,
      key: vars[0].key,
      variants: vars
    }));
    return { errors: [], groups, variants };
  }

  function isVisible(win, el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = win.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  function waitForWindowLoad(win, timeoutMs = APP.waitMs) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        try {
          if (!win || win.closed) return reject(new Error('WINDOW_CLOSED'));
          if (win.document && win.document.readyState === 'complete') return resolve(true);
        } catch (e) {
          return reject(e);
        }
        if (Date.now() - start >= timeoutMs) return reject(new Error('window load timeout'));
        setTimeout(tick, APP.pollMs);
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
    try { return dt?.table?.().node?.() || null; } catch (_) { return null; }
  }

  function rowsForRead(win, searchApplied) {
    const rows = [];
    const seen = new Set();
    const add = row => {
      if (!row || !String(row.innerHTML || '').includes('/cb/torneio/painel/')) return;
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
    const input = [...win.document.querySelectorAll('.dataTables_filter input[type="search"], input[type="search"]')].find(el => isVisible(win, el));
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

  function cleanTournamentName(name) {
    return norm(name).replace(/\s*-\s*PokerWeb\s*$/i, '').replace(/\s*監査(?:済み|待ち)\s*$/g, '');
  }

  function extractTournamentTitleFromRow(rowText) {
    let s = norm(rowText);
    const m = s.match(/(【[^】]+】\s*(?:#\d+[A-Za-z]?|\(s\d+\)|s\d+)\s+.+?)(?:\s+\d{1,2}\/\d{1,2}\/\d{4}|\s+Aberto|\s+Fechado|\s+オープン|\s+クローズ|$)/i);
    if (m) return cleanTournamentName(m[1]);
    const m2 = s.match(/(【[^】]+】.+?)(?:\s+\d{1,2}\/\d{1,2}\/\d{4}|\s+Aberto|\s+Fechado|$)/i);
    if (m2) return cleanTournamentName(m2[1]);
    s = s
      .replace(/^アクション\s+/i, '')
      .replace(/^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s+/, '')
      .replace(/\s+\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}$/, '')
      .replace(/\s+Aberto$/i, '')
      .replace(/\s+Fechado$/i, '')
      .replace(/\s+オープン$/i, '')
      .replace(/\s+クローズ$/i, '')
      .trim();
    return cleanTournamentName(s);
  }

  function extractTournament(row) {
    const html = row.innerHTML || '';
    const match = html.match(/\/cb\/torneio\/painel\/(\d+)/);
    if (!match) return null;
    const rowText = norm(row.innerText || row.textContent || '');
    const actualName = extractTournamentTitleFromRow(rowText);
    const afterPrefix = actualName.replace(/^【[^】]+】\s*/, '');
    const no = tournamentNoFromName(afterPrefix);
    return {
      tournamentId: match[1],
      url: `/cb/torneio/painel/${match[1]}`,
      actualName,
      name: afterPrefix.replace(/^[#＃]\s*0*\d+\s*/, '').trim(),
      no,
      noDisplay: no ? String(Number(no)).padStart(2, '0') : '',
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

  function cacheUrl(entry, source) {
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
      savedAt: nowText(),
      source
    };
    writeCache(cache);
  }

  async function openListWindow(page) {
    const win = window.open(page.path, `pw_prize_url_${page.label}_${Date.now()}`, 'width=1280,height=900');
    if (!win) throw new Error(`${page.label}: popup blocked`);
    await waitForWindowLoad(win);
    await waitForInWindow(win, w => dataTable(w) || rowsForRead(w, false).length);
    await sleep(700);
    return win;
  }

  async function scanEventUrls(prefix) {
    const found = [];
    const seen = new Set();
    const wins = [];
    try {
      for (const page of APP.listPages) {
        setStatus(`${page.label} URLスキャン中...`);
        const win = await openListWindow(page);
        wins.push(win);
        const dt = await searchTable(win, prefix);
        const info = dt?.page?.info?.();
        const pages = info?.pages || 1;
        for (let p = 0; p < pages; p++) {
          await goTablePage(win, dt, p);
          const rows = rowsForRead(win, true);
          for (const row of rows) {
            const entry = extractTournament(row);
            if (!entry) continue;
            const hay = `${entry.actualName} ${entry.matchedRow || ''}`;
            if (!hay.includes(prefix) && !compact(hay).includes(compact(prefix))) continue;
            if (seen.has(entry.url)) continue;
            seen.add(entry.url);
            entry.sourceLabel = page.label;
            entry.pageNo = p + 1;
            found.push(entry);
            cacheUrl(entry, `prize-plan-${page.label}-p${p + 1}`);
          }
        }
      }
    } finally {
      for (const win of wins) {
        try { if (win && !win.closed) win.close(); } catch (_) {}
      }
    }
    found.sort((a, b) => Number(a.no || 0) - Number(b.no || 0) || String(a.actualName).localeCompare(String(b.actualName), 'ja'));
    return found;
  }

  function chooseVariant(group) {
    if (isMultiPlayerGroup(group)) {
      const playerVariants = group.variants.filter(v => v.valid && v.mode === 'player');
      const confirmedPlayer = playerVariants.filter(v => v.status === 'confirmed');
      if (confirmedPlayer.length === 1) return { variant: confirmedPlayer[0], judgement: '候補確定', note: '1人分優先', needsConfirm: false };
      if (playerVariants.length === 1) return { variant: playerVariants[0], judgement: '候補確定', note: '1人分優先 / 状態継承', needsConfirm: false };
      if (playerVariants.length > 1) return { variant: null, judgement: '要確認', note: '1人分候補複数', needsConfirm: true };
    }
    const validConfirmed = group.variants.filter(v => v.valid && v.status === 'confirmed');
    if (validConfirmed.length === 1) return { variant: validConfirmed[0], judgement: '候補確定', note: '確定レート優先', needsConfirm: false };
    if (validConfirmed.length > 1) return { variant: null, judgement: '要確認', note: '複数の確定レート候補', needsConfirm: true };
    const valid = group.variants.filter(v => v.valid && v.status !== 'unused');
    if (valid.length === 1) return { variant: valid[0], judgement: '要確認', note: '確定レートなし', needsConfirm: true };
    return { variant: null, judgement: '要確認', note: '有効Prize候補なし/複数候補', needsConfirm: true };
  }

  function matchTournament(group, entries) {
    const no = tournamentNoFromName(group.inputName);
    let candidates = [];
    if (no) {
      candidates = entries.filter(e => String(Number(e.no || 0)) === String(Number(no)) && !isDayOne(e.actualName));
    } else {
      const key = baseKey(group.inputName);
      candidates = entries.filter(e => !isDayOne(e.actualName) && strictNameMatch(key, baseKey(e.name), group.inputName));
    }
    if (/main|millions/i.test(group.inputName)) {
      const maxDay = Math.max(0, ...candidates.map(c => c.day || 0).filter(d => d > 1));
      if (maxDay) candidates = candidates.filter(c => c.day === maxDay);
    }
    if (candidates.length === 1) return { entry: candidates[0], needsConfirm: false, candidates };
    return { entry: null, needsConfirm: true, candidates };
  }

  function tournamentIdFromInput(value) {
    const text = norm(value);
    const m = text.match(/(?:\/painel\/|^)(\d{4,6})(?:\D|$)/);
    return m ? m[1] : '';
  }

  function expandPrizes(item, variant) {
    const size = variant.mode === 'player' ? teamSizeFromText(`${item.inputName} ${item.tournamentName} ${variant.sourceTitle}`) : 1;
    if (size <= 1) {
      const rows = variant.prizes.map(p => ({ ...p }));
      return {
        rows,
        total: rows.reduce((sum, p) => sum + p.amount, 0),
        note: variant.total && variant.total !== rows.reduce((sum, p) => sum + p.amount, 0)
          ? `Total行参考 ${yen(variant.total)}`
          : ''
      };
    }
    const rows = [];
    let rank = 1;
    for (const prize of variant.prizes) {
      for (let i = 0; i < size; i++) rows.push({ rank: rank++, amount: prize.amount });
    }
    return {
      rows,
      total: rows.reduce((sum, p) => sum + p.amount, 0),
      note: `1人分×${size}展開 / Total行参考 ${yen(variant.total)}`
    };
  }

  function matchDebugRows(prizeGroups, urlEntries) {
    const rows = [[
      '入力名',
      '入力番号',
      '入力Key',
      'PW大会名',
      'PW番号',
      'PW Key',
      '判定理由',
      '結果'
    ]];
    for (const group of prizeGroups || []) {
      const inputNo = tournamentNoFromName(group.inputName);
      const inputKey = baseKey(group.inputName);
      const matches = matchTournament(group, urlEntries || []);
      const candidates = matches.candidates?.length ? matches.candidates : (urlEntries || []).slice(0, 80);
      for (const entry of candidates) {
        const noOk = inputNo ? String(Number(entry.no || 0)) === String(Number(inputNo)) : '';
        const pwKey = baseKey(entry.name);
        const keyOk = !inputNo ? strictNameMatch(inputKey, pwKey, group.inputName) : '';
        const selected = matches.entry && String(matches.entry.tournamentId) === String(entry.tournamentId);
        const reason = inputNo
          ? `番号${noOk ? '一致' : '不一致'}`
          : `名前${keyOk ? '一致' : '不一致'}`;
        if (!selected && !noOk && inputNo) continue;
        if (!selected && !keyOk && !inputNo && candidates.length > 20) continue;
        rows.push([
          group.inputName,
          inputNo,
          inputKey,
          entry.actualName,
          entry.no || '',
          pwKey,
          reason,
          selected ? '採用' : '候補'
        ]);
      }
      if (!matches.candidates?.length) {
        rows.push([group.inputName, inputNo, inputKey, '', '', '', inputNo ? '同番号なし' : '候補なし', '未検出']);
      }
    }
    return rows.map(row => row.map(v => String(v ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ')).join('\t')).join('\n');
  }

  function prizeDebugRows(prizeGroups) {
    const rows = [[
      '入力名',
      'Prize元',
      'Status',
      '列',
      'Rank列',
      'Raw Total',
      '明細合計',
      '行数',
      'Rank範囲',
      '読取行',
      '除外候補行数',
      '先頭5件'
    ]];
    for (const group of prizeGroups || []) {
      for (const v of group.variants || []) {
        const first5 = (v.prizes || []).slice(0, 5).map(p => `${p.rank}:${yen(p.amount)}@${p.sourceRow || ''}`).join(' / ');
        rows.push([
          group.inputName,
          v.sourceTitle,
          statusLabel(v.status, v.statusRaw),
          v.debug?.column || '',
          v.debug?.rankColumn || '',
          v.debug?.rawTotal != null ? yen(v.debug.rawTotal) : '',
          yen(v.debug?.sumPrizes || 0),
          v.prizes?.length || 0,
          v.debug?.firstRank ? `${v.debug.firstRank}-${v.debug.lastRank}` : '',
          v.debug?.firstSourceRow ? `${v.debug.firstSourceRow}-${v.debug.lastSourceRow}` : '',
          v.debug?.skippedBeforeFirstRank || 0,
          first5
        ]);
      }
    }
    return rows.map(row => row.map(v => String(v ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ')).join('\t')).join('\n');
  }

  function parsePlanMatrix(raw) {
    const rows = splitTsv(raw).filter(row => row.some(v => norm(v)));
    if (!rows.length) return null;
    const fieldMap = new Map();
    rows.forEach((row, index) => {
      const key = norm(cell(row, 0));
      if (key) fieldMap.set(key, { row, index });
    });
    const field = (...names) => names.map(name => fieldMap.get(name)).find(Boolean);
    const tournamentNameField = field('PW大会名', '大会名', '比赛名字');
    const tournamentIdField = field('大会ID', 'PokerWeb ID', '比赛ID');
    const prizeSourceField = field('参照Prize', 'PRIZE元');
    const statusField = field('ステータス', 'Status');
    const judgementField = field('判定');
    const noteField = field('備考', 'Note');
    if (!tournamentNameField || !tournamentIdField) return null;
    const rankRows = rows
      .map(row => ({ row, rank: parseRank(cell(row, 0)) }))
      .filter(item => item.rank);
    if (!rankRows.length) return null;
    const maxCols = Math.max(0, ...rows.map(row => row.length));
    const items = [];
    for (let col = 1; col < maxCols; col++) {
      const tournamentName = norm(cell(tournamentNameField.row, col));
      const tournamentId = tournamentIdFromInput(cell(tournamentIdField.row, col));
      const rowsForItem = [];
      for (const rr of rankRows) {
        const amount = moneyNumber(cell(rr.row, col));
        if (amount == null || amount <= 0) continue;
        rowsForItem.push({ rank: rr.rank, amount });
      }
      if (!tournamentName && !tournamentId && !rowsForItem.length) continue;
      const total = rowsForItem.reduce((sum, row) => sum + row.amount, 0);
      const judgement = tournamentId && rowsForItem.length ? '人工確認' : '要確認';
      const notes = [
        norm(cell(noteField?.row, col)),
        norm(cell(judgementField?.row, col)) ? `元判定 ${norm(cell(judgementField?.row, col))}` : '',
        'PLAN横表読込'
      ].filter(Boolean);
      items.push({
        id: `pm${items.length}`,
        stage: 'PLAN',
        inputName: tournamentName || `PLAN列${col + 1}`,
        tournamentName,
        tournamentId,
        url: tournamentId ? `/cb/torneio/painel/${tournamentId}` : '',
        urlCandidates: [],
        urlConfirmRequired: !tournamentId,
        prizeSource: norm(cell(prizeSourceField?.row, col)) || 'PLAN横表',
        status: norm(cell(statusField?.row, col)) || '人工入力',
        variantId: `plan-${col}`,
        variantCandidates: [],
        variantConfirmRequired: !rowsForItem.length,
        variants: [],
        planJudgement: judgement,
        planNote: notes.join(' / '),
        total,
        rows: rowsForItem,
        manual: true,
        writeStatus: '',
        writeNote: '',
        checkStatus: '',
        checkNote: ''
      });
    }
    if (!items.length) return null;
    return { prefix: 'PLAN横表', items, urlEntries: [], createdAt: nowText(), source: 'PLAN_MATRIX' };
  }

  function buildPlan(prefix, prizeGroups, urlEntries) {
    const items = [];
    for (const group of prizeGroups) {
      const vChoice = chooseVariant(group);
      const tChoice = matchTournament(group, urlEntries);
      const variant = vChoice.variant;
      let rows = [];
      let total = 0;
      const notes = [vChoice.note].filter(Boolean);
      if (variant) {
        const expanded = expandPrizes({ inputName: group.inputName, tournamentName: tChoice.entry?.actualName || '' }, variant);
        rows = expanded.rows;
        total = expanded.total;
        if (expanded.note) notes.push(expanded.note);
      }
      if (tChoice.needsConfirm) notes.push(tChoice.candidates.length ? 'PokerWeb候補複数' : 'URL未検出');
      const item = {
        id: group.id,
        stage: 'PLAN',
        inputName: group.inputName,
        tournamentName: tChoice.entry?.actualName || '',
        tournamentId: tChoice.entry?.tournamentId || '',
        url: tChoice.entry?.url || '',
        urlCandidates: tChoice.candidates,
        urlConfirmRequired: tChoice.needsConfirm,
        prizeSource: variant?.sourceTitle || '',
        status: variant ? statusLabel(variant.status, variant.statusRaw) : '',
        variantId: variant?.id || '',
        variantCandidates: group.variants.map(v => v.id),
        variantConfirmRequired: vChoice.needsConfirm || !variant,
        variants: group.variants,
        planJudgement: (!vChoice.needsConfirm && !tChoice.needsConfirm) ? '候補確定' : '要確認',
        planNote: notes.join(' / '),
        total,
        rows,
        manual: false,
        writeStatus: '',
        writeNote: '',
        checkStatus: '',
        checkNote: ''
      };
      items.push(item);
    }
    return { prefix, items, urlEntries, createdAt: nowText() };
  }

  function planReady(plan) {
    return !!plan?.items?.length && plan.items.every(item =>
      item.planJudgement !== '要確認' &&
      item.tournamentId &&
      item.url &&
      item.variantId &&
      item.rows?.length
    );
  }

  function itemWritable(item) {
    return !!(
      item &&
      item.planJudgement !== '要確認' &&
      item.tournamentId &&
      item.url &&
      item.variantId &&
      item.rows?.length
    );
  }

  function matrixLog(plan, stage = 'PLAN') {
    const items = plan?.items || [];
    const maxRank = Math.max(0, ...items.map(item => Math.max(0, ...(item.rows || []).map(r => r.rank))));
    const fields = ['PW大会名', '大会ID', '参照Prize', 'ステータス', '判定', 'Total', '備考'];
    for (let r = 1; r <= maxRank; r++) fields.push(String(r));
    const valueFor = (item, field) => {
      if (field === 'PW大会名') return item.tournamentName;
      if (field === '大会ID') return item.tournamentId;
      if (field === '参照Prize') return item.prizeSource || item.inputName;
      if (field === 'ステータス') return item.status;
      if (field === '判定') return stage === 'WRITE' ? (item.writeStatus || item.planJudgement) : stage === 'CHECK' ? (item.checkStatus || item.planJudgement) : item.planJudgement;
      if (field === 'Total') return item.total ? yen(item.total) : '';
      if (field === '備考') return stage === 'WRITE' ? (item.writeNote || item.planNote || '') : stage === 'CHECK' ? (item.checkNote || item.planNote || '') : (item.planNote || '');
      const rank = Number(field);
      const row = item.rows?.find(r => r.rank === rank);
      return row ? yen(row.amount) : '';
    };
    return fields.map(field => [field, ...items.map(item => valueFor(item, field))].map(v => String(v ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ')).join('\t')).join('\n');
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return false;
    }
  }

  function readPrizeFromDoc(doc) {
    const title =
      doc.querySelector('input[name="titulo_torneio"], input[name="nome"], input[name="name"]')?.value ||
      doc.querySelector('h1,h2,.page-title,.box-title,.panel-title,.breadcrumb')?.textContent ||
      doc.title || '';
    const byName = name => [...doc.querySelectorAll(`[name="${CSS.escape(name)}"]`)];
    const posEls = byName('posicao[]');
    const valueEls = byName('prizes_valor[]');
    const rows = [];
    const max = Math.max(posEls.length, valueEls.length);
    for (let i = 0; i < max; i++) {
      const rank = parseRank(posEls[i]?.value || '');
      const amount = moneyNumber(valueEls[i]?.value || '');
      if (rank && amount != null && amount > 0) rows.push({ rank, amount });
    }
    return { title: norm(title), rows: rows.sort((a, b) => a.rank - b.rank), total: rows.reduce((sum, r) => sum + r.amount, 0) };
  }

  async function fetchDoc(url) {
    const absolute = url.startsWith('http') ? url : new URL(url, location.origin).href;
    const res = await fetch(absolute, { credentials: 'include', cache: 'no-store' });
    const html = await res.text();
    if (!res.ok) throw new Error(`GET ${res.status}`);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.__rawHtml = html;
    doc.__status = res.status;
    return doc;
  }

  function compareRows(expected, actual) {
    const exp = new Map((expected || []).map(r => [Number(r.rank), Number(r.amount)]));
    const got = new Map((actual || []).map(r => [Number(r.rank), Number(r.amount)]));
    const diff = [];
    for (const [rank, amount] of exp.entries()) {
      if (!got.has(rank)) diff.push(`${rank}位 missing`);
      else if (got.get(rank) !== amount) diff.push(`${rank}位 ${yen(got.get(rank))} != ${yen(amount)}`);
    }
    for (const rank of got.keys()) {
      if (!exp.has(rank)) diff.push(`${rank}位 extra`);
    }
    return diff;
  }

  async function checkPlan() {
    const state = loadState();
    const plan = state.plan;
    if (!plan?.items?.length) return alert('先にPlanを作成してください。');
    setStatus('CHECK中...');
    for (const [index, item] of plan.items.entries()) {
      setStatus(`CHECK ${index + 1}/${plan.items.length}: ${item.tournamentName || item.inputName}`);
      if (!item.url) {
        item.checkStatus = '未検出';
        item.checkNote = [item.checkNote, 'URL未登録'].filter(Boolean).join(' / ');
        continue;
      }
      try {
        const doc = await fetchDoc(item.url);
        const actual = readPrizeFromDoc(doc);
        const diff = compareRows(item.rows, actual.rows);
        const totalOk = Number(item.total || 0) === Number(actual.total || 0);
        item.checkStatus = !diff.length && totalOk ? 'OK' : '不一致';
        if (diff.length || !totalOk) item.checkNote = [!totalOk ? `Total不一致 ${yen(actual.total)} != ${yen(item.total)}` : '', diff.slice(0, 3).join(' / ')].filter(Boolean).join(' / ');
        else item.checkNote = 'Plan一致';
      } catch (e) {
        item.checkStatus = '未検出';
        item.checkNote = `GET失敗 ${e.message || e}`;
      }
    }
    saveState({ ...state, plan });
    renderPlan(plan);
    const text = matrixLog(plan, 'CHECK');
    await copyText(text);
    setStatus('CHECK完了。必要に応じてCHECK COPYを押してください。');
    alert('CHECK完了\n\n結果を確認する場合は「CHECK COPY」を押してください。');
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

  function buildPrizePayload(item, doc) {
    const currentRows = readCurrentRows(doc);
    const byPos = new Map();
    for (const row of currentRows) {
      const pos = Number(row['posicao[]']);
      if (pos > 0) byPos.set(pos, row);
    }
    const desired = new Map(item.rows.map(r => [Number(r.rank), { valor: String(r.amount), desc: '' }]));
    const desiredPositions = [...desired.keys()].sort((a, b) => a - b);
    const deleteIds = [...new Set(
      [...byPos.entries()]
        .filter(([pos, row]) => !desired.has(pos) && row?.['id[]'])
        .map(([, row]) => row['id[]'])
    )];
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
    if (deleteIds.length) payload['id_excluir[]'] = deleteIds;
    for (const pos of desiredPositions) {
      const old = byPos.get(pos);
      const want = desired.get(pos);
      const hasOldId = !!old?.['id[]'];
      payload['id[]'].push(hasOldId ? old['id[]'] : '');
      payload['status[]'].push(hasOldId ? (old['status[]'] || '0') : 'novo');
      payload['tipo[]'].push(old?.['tipo[]'] || '0');
      payload['id_grupo[]'].push(old?.['id_grupo[]'] || '0');
      payload['posicao[]'].push(String(pos));
      payload['prizes_desc[]'].push(want.desc);
      payload['prizes_valor[]'].push(want.valor);
      payload['valor_vaga[]'].push(old?.['valor_vaga[]'] || (hasOldId ? '0' : ''));
    }
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

  function responseLabel(response) {
    if (!response) return 'HTTP ?';
    return response.status === 0 ? 'HTTP 0 redirect/unknown' : `HTTP ${response.status}`;
  }

  async function postPrizeList(item, doc) {
    const codbloq = getDocValue(doc, 'codbloq');
    if (!codbloq) {
      throw new Error(`codbloq not found. GET status=${doc.__status || ''} title=${titleOfDoc(doc)} hasPrizes=${!!doc.querySelector('#prizes_tela,[name="prizes_valor[]"]')} hasSendForm=${/sendFormPrizes/i.test(doc.__rawHtml || '')}`);
    }
    const params = new URLSearchParams();
    params.append('dados', JSON.stringify(buildPrizePayload(item, doc)));
    params.append('codbloq', codbloq);
    return fetch(APP.endpointPrizeList, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: params,
      credentials: 'include',
      redirect: 'manual'
    });
  }

  async function postPotTotal(item, doc) {
    const codbloq = getDocValue(doc, 'codbloq');
    if (!codbloq) throw new Error(`pot codbloq not found. GET status=${doc.__status || ''} title=${titleOfDoc(doc)}`);
    const params = objectToUrlParams({
      layout: 'pot_config',
      potautomatico: '0',
      potmanual: formatPwNumber(item.total || 0),
      potgarantido: '0',
      codbloq
    });
    return fetch(APP.endpointPotTotal(item.tournamentId), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: params,
      credentials: 'include',
      redirect: 'manual'
    });
  }

  async function writePlan() {
    const state = loadState();
    const plan = state.plan;
    if (!plan?.items?.length) return alert('先にPlanを作成してください。');
    const writableItems = plan.items.filter(itemWritable);
    const skippedItems = plan.items.filter(item => !itemWritable(item));
    for (const item of skippedItems) {
      item.writeStatus = '書込スキップ';
      item.writeNote = [
        item.planNote || '',
        !item.tournamentId || !item.url ? 'URL未確定' : '',
        item.planJudgement === '要確認' ? '要確認未解決' : '',
        !item.rows?.length ? 'Prize未確定' : ''
      ].filter(Boolean).join(' / ');
    }
    if (!writableItems.length) {
      saveState({ ...state, plan });
      renderPlan(plan);
      await copyText(matrixLog(plan, 'WRITE'));
      return alert('書込できる項目がありません。書込コピーでスキップ内容を確認してください。');
    }
    if (!confirm(`このPrize Planを書き込みます。\n書込対象: ${writableItems.length}件\nスキップ: ${skippedItems.length}件\n\n実行しますか？`)) return;
    for (const [index, item] of writableItems.entries()) {
      setStatus(`WRITE ${index + 1}/${writableItems.length}: ${item.tournamentName}`);
      try {
        const doc1 = await fetchDoc(item.url);
        const res1 = await postPrizeList(item, doc1);
        await sleep(500);
        const doc2 = await fetchDoc(item.url);
        const res2 = await postPotTotal(item, doc2);
        await sleep(700);
        const verifyDoc = await fetchDoc(item.url);
        const actual = readPrizeFromDoc(verifyDoc);
        const diff = compareRows(item.rows, actual.rows);
        const totalOk = Number(item.total || 0) === Number(actual.total || 0);
        const verifyOk = !diff.length && totalOk;
        item.writeStatus = verifyOk ? '書込OK' : '書込失敗';
        item.writeNote = [
          `Prize ${responseLabel(res1)}`,
          `Total ${responseLabel(res2)}`,
          verifyOk ? 'Verify OK' : '',
          !totalOk ? `Verify Total ${yen(actual.total)} != ${yen(item.total)}` : '',
          diff.slice(0, 3).join(' / ')
        ].filter(Boolean).join(' / ');
      } catch (e) {
        item.writeStatus = '書込失敗';
        item.writeNote = e.message || String(e);
      }
      saveState({ ...state, plan });
      renderPlan(plan);
    }
    const text = matrixLog(plan, 'WRITE');
    await copyText(text);
    setStatus('書込完了。必要に応じて書込コピーを押してください。');
    alert('書込完了\n\n結果を確認する場合は「書込コピー」を押してください。');
  }

  function renderPlan(plan) {
    const box = document.querySelector('#pwPrizeConfirm');
    if (!box) return;
    const items = plan?.items || [];
    const auto = items.filter(i => i.planJudgement === '候補確定').length;
    const manual = items.filter(i => i.planJudgement === '人工確認').length;
    const confirm = items.filter(i => i.planJudgement === '要確認').length;
    const urlCount = items.filter(i => i.tournamentId && i.url).length || plan?.urlEntries?.length || 0;
    box.innerHTML = `
      <div class="pwpp-summary">候補確定 ${auto} / 人工確認 ${manual} / 要確認 ${confirm} / URL ${urlCount}件</div>
      ${items.filter(i => i.planJudgement === '要確認').map(renderItemCard).join('')}
      <details style="margin-top:8px;">
        <summary>候補確定・人工確認済みを表示</summary>
        ${items.filter(i => i.planJudgement !== '要確認').map(renderItemCard).join('')}
      </details>
    `;
    for (const select of box.querySelectorAll('select[data-action]')) {
      select.addEventListener('change', () => updateItemFromSelect(select));
    }
    for (const button of box.querySelectorAll('button[data-action="manual-url"]')) {
      button.addEventListener('click', () => updateItemFromManualUrl(button));
    }
    for (const button of box.querySelectorAll('button[data-action="confirm-item"]')) {
      button.addEventListener('click', () => confirmPlanItem(button));
    }
  }

  function variantOptionLabel(v) {
    const invalid = v.valid ? '' : ' / 無効';
    return `${v.sourceTitle} / ${statusLabel(v.status, v.statusRaw)} / Total ${yen(v.total)} / 1位 ${yen(v.summary.first)} / 最終 ${yen(v.summary.last)} / ${v.summary.rows}行${invalid}`;
  }

  function selectableVariants(item) {
    const variants = item.variants || [];
    if (!variants.length && item.variantId) {
      return [{
        id: item.variantId,
        sourceTitle: item.prizeSource || 'PLAN横表',
        status: 'confirmed',
        statusRaw: item.status || '人工入力',
        total: item.total || 0,
        valid: true,
        summary: {
          first: item.rows?.[0]?.amount || 0,
          last: item.rows?.[item.rows.length - 1]?.amount || 0,
          rows: item.rows?.length || 0
        }
      }];
    }
    const valid = variants.filter(v => v.valid && v.status !== 'unused');
    if (valid.length) return valid;
    return variants.filter(v => v.id === item.variantId);
  }

  function renderItemCard(item) {
    const variants = selectableVariants(item);
    const urlCandidates = (item.urlCandidates || []).length
      ? item.urlCandidates
      : item.tournamentId
        ? [{ tournamentId: item.tournamentId, actualName: item.tournamentName || `人工入力 ${item.tournamentId}` }]
        : [];
    const showManualUrl = !item.tournamentId;
    return `
      <div class="pwpp-card">
        <div class="pwpp-title">${escapeHtml(item.inputName)} ${item.manual ? '<span class="warn">人工修正</span>' : ''}</div>
        <label>PokerWeb大会</label>
        <select data-action="url" data-id="${escapeHtml(item.id)}">
          <option value="">候補なし</option>
          ${urlCandidates.map(c => `<option value="${escapeHtml(c.tournamentId)}" ${String(c.tournamentId) === String(item.tournamentId) ? 'selected' : ''}>${escapeHtml(c.actualName)} / ${c.tournamentId}</option>`).join('')}
        </select>
        ${showManualUrl ? `<div style="display:flex;gap:6px;margin-top:6px;">
          <input data-manual-url="${escapeHtml(item.id)}" placeholder="PokerWeb ID または URL" value="">
          <button data-action="manual-url" data-id="${escapeHtml(item.id)}" style="background:#e5e7eb;color:#111827;white-space:nowrap;">URL入力</button>
        </div>` : ''}
        <label>使用Prize</label>
        <select data-action="variant" data-id="${escapeHtml(item.id)}">
          <option value="">選択してください</option>
          ${variants.map(v => `<option value="${escapeHtml(v.id)}" ${v.id === item.variantId ? 'selected' : ''}>${escapeHtml(variantOptionLabel(v))}</option>`).join('')}
        </select>
        ${item.planJudgement === '要確認' ? `<button data-action="confirm-item" data-id="${escapeHtml(item.id)}" style="margin-top:8px;background:#e5e7eb;color:#111827;">この内容で人工確認</button>` : ''}
        <div class="pwpp-note">判定: ${escapeHtml(item.planJudgement)} / Total: ${escapeHtml(yen(item.total))} / ${escapeHtml(item.planNote || '')}</div>
      </div>
    `;
  }

  function updateItemFromSelect(select) {
    const state = loadState();
    const plan = state.plan;
    const item = plan?.items?.find(i => i.id === select.dataset.id);
    if (!item) return;
    if (select.dataset.action === 'url') {
      const entry = (item.urlCandidates || []).find(c => String(c.tournamentId) === String(select.value));
      if (entry || select.value) {
        item.tournamentName = entry?.actualName || item.tournamentName || `人工入力 ${select.value}`;
        item.tournamentId = entry?.tournamentId || select.value;
        item.url = entry?.url || `/cb/torneio/painel/${select.value}`;
        item.urlConfirmRequired = false;
      }
    }
    if (select.dataset.action === 'variant') {
      const variant = item.variants.find(v => v.id === select.value);
      if (variant) {
        const expanded = expandPrizes(item, variant);
        item.variantId = variant.id;
        item.prizeSource = variant.sourceTitle;
        item.status = statusLabel(variant.status, variant.statusRaw);
        item.rows = expanded.rows;
        item.total = expanded.total;
        item.variantConfirmRequired = false;
        item.planNote = [item.planNote, expanded.note, '人工修正'].filter(Boolean).join(' / ');
      }
    }
    item.manual = true;
    if (item.tournamentId && item.variantId && item.rows?.length) item.planJudgement = '人工確認';
    saveState(state);
    renderPlan(plan);
  }

  function confirmPlanItem(button) {
    const state = loadState();
    const plan = state.plan;
    const item = plan?.items?.find(i => i.id === button.dataset.id);
    if (!item) return;
    if (!item.tournamentId || !item.url) return alert('PokerWeb大会を選択してください。');
    if (!item.variantId || !item.rows?.length) return alert('使用Prizeを選択してください。');
    item.urlConfirmRequired = false;
    item.variantConfirmRequired = false;
    item.manual = true;
    item.planJudgement = '人工確認';
    item.planNote = [item.planNote, 'この内容で人工確認'].filter(Boolean).join(' / ');
    saveState(state);
    renderPlan(plan);
  }

  function updateItemFromManualUrl(button) {
    const state = loadState();
    const plan = state.plan;
    const item = plan?.items?.find(i => i.id === button.dataset.id);
    if (!item) return;
    const input = document.querySelector(`input[data-manual-url="${CSS.escape(item.id)}"]`);
    const id = tournamentIdFromInput(input?.value || '');
    if (!id) return alert('PokerWeb ID または URLを入力してください。');
    const entry = (plan.urlEntries || []).find(e =>
      String(e.tournamentId) === String(id) ||
      String(e.url || '').includes(`/painel/${id}`)
    );
    item.tournamentId = id;
    item.url = `/cb/torneio/painel/${id}`;
    item.tournamentName = entry?.actualName || `人工入力 ${id}`;
    item.urlCandidates = entry ? [entry] : item.urlCandidates;
    item.urlConfirmRequired = false;
    item.manual = true;
    item.planNote = [item.planNote, entry ? 'URL人工選択' : 'URL人工入力'].filter(Boolean).join(' / ');
    if (item.tournamentId && item.variantId && item.rows?.length) item.planJudgement = '人工確認';
    saveState(state);
    renderPlan(plan);
  }

  async function buildPlanFromInput() {
    if (running) return;
    running = true;
    try {
      const prefix = norm(document.querySelector('#pwPrizePrefix')?.value || '');
      const raw = document.querySelector('#pwPrizeRaw')?.value || '';
      const planMatrix = parsePlanMatrix(raw);
      if (planMatrix) {
        saveState({ plan: planMatrix, debugPrizeGroups: [] });
        renderPlan(planMatrix);
        const text = matrixLog(planMatrix, 'PLAN');
        await copyText(text);
        setStatus('PLAN横表を読み込みました。必要に応じてPLAN COPYを押してください。');
        alert('PLAN横表を読み込みました\n\nGoogle Sheetで確認する場合は「PLAN COPY」を押してください。');
        return;
      }
      if (!prefix) return alert('大会名を入力してください。例: 【JOPT 2026 Tokyo #02】');
      const parsed = parsePrizeSheet(raw);
      if (parsed.errors.length) return alert(parsed.errors.join('\n'));
      setStatus('OPEN URLスキャン中...');
      const urls = await scanEventUrls(prefix);
      if (!urls.length) return alert('URLが見つかりません。大会名を確認してください。');
      const plan = buildPlan(prefix, parsed.groups, urls);
      saveState({ plan, debugPrizeGroups: parsed.groups });
      renderPlan(plan);
      const text = matrixLog(plan, 'PLAN');
      await copyText(text);
      setStatus('PLAN作成完了。必要に応じてPLAN COPYを押してください。');
      alert('PLAN作成完了\n\nGoogle Sheetで確認する場合は「PLAN COPY」を押してください。');
    } finally {
      running = false;
    }
  }

  function addPanel() {
    if (document.getElementById(APP.panelId)) return;
    const style = document.createElement('style');
    style.textContent = `
      #${APP.panelId}{position:fixed;right:18px;top:70px;width:620px;max-height:86vh;z-index:999999;background:#0f172a;color:#e5e7eb;border:1px solid #475569;border-radius:8px;font-family:Arial,"Yu Gothic","Meiryo",sans-serif;box-shadow:0 16px 40px rgba(0,0,0,.35);overflow:auto}
      #${APP.panelId} .head{display:flex;justify-content:space-between;align-items:center;padding:10px;border-bottom:1px solid #334155}
      #${APP.panelId}.minimized{width:300px;max-height:none;overflow:hidden}
      #${APP.panelId}.minimized .body{display:none}
      #${APP.panelId} .body{padding:10px}
      #${APP.panelId} label{display:block;margin:8px 0 4px;color:#cbd5e1;font-weight:700}
      #${APP.panelId} input,#${APP.panelId} textarea,#${APP.panelId} select{width:100%;box-sizing:border-box;background:#020617;color:#e5e7eb;border:1px solid #475569;border-radius:6px;padding:8px}
      #${APP.panelId} textarea{font-family:Consolas,"Courier New",monospace;white-space:pre;resize:vertical}
      #${APP.panelId} button{border:0;border-radius:6px;padding:8px 10px;font-weight:700;cursor:pointer}
      #${APP.panelId} .actions{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-top:8px}
      #${APP.panelId} .pwpp-card{border:1px solid #475569;border-radius:6px;padding:8px;margin-top:8px;background:#111827}
      #${APP.panelId} .pwpp-title{font-weight:700;color:#fde68a;margin-bottom:6px}
      #${APP.panelId} .pwpp-note{font-size:12px;color:#cbd5e1;margin-top:6px}
      #${APP.panelId} .pwpp-summary{font-weight:700;margin-top:8px}
      #${APP.panelId} .warn{color:#fca5a5;margin-left:8px}
      #pwPrizeDetail{display:none;height:150px;margin-top:8px}
    `;
    document.head.appendChild(style);
    const panel = document.createElement('div');
    panel.id = APP.panelId;
    panel.innerHTML = `
      <div class="head">
        <strong>PW Prize Plan 書込・確認</strong>
        <button id="pwPrizeMin" style="background:#374151;color:white;">Min</button>
      </div>
      <div class="body">
        <label>大会名 prefix</label>
        <input id="pwPrizePrefix" placeholder="例: 【JOPT 2026 Tokyo #02】">
        <label>大会Prize Google Sheet全体</label>
        <textarea id="pwPrizeRaw" style="height:180px" spellcheck="false"></textarea>
        <div class="actions">
          <button id="pwPrizeBuild" style="background:#2563eb;color:white;">PLAN作成</button>
          <button id="pwPrizeWrite" style="background:#b45309;color:white;">書込開始</button>
          <button id="pwPrizeCheck" style="background:#16a34a;color:white;">CHECK</button>
          <button id="pwPrizeCopyPlan" style="background:#334155;color:white;">PLAN COPY</button>
          <button id="pwPrizeCopyCheck" style="background:#334155;color:white;">CHECK COPY</button>
          <button id="pwPrizeCopyWrite" style="background:#334155;color:white;">書込コピー</button>
          <button id="pwPrizeCopyDebug" style="background:#475569;color:white;">MATCH DEBUG</button>
          <button id="pwPrizeCopyPrizeDebug" style="background:#475569;color:white;">PRIZE DEBUG</button>
        </div>
        <div id="pwPrizeStatus" style="margin-top:8px;color:#93c5fd;font-weight:700;"></div>
        <div id="pwPrizeConfirm"></div>
        <button id="pwPrizeToggleDetail" style="margin-top:8px;background:#475569;color:white;">詳細</button>
        <textarea id="pwPrizeDetail" readonly></textarea>
      </div>
    `;
    document.body.appendChild(panel);
    document.querySelector('#pwPrizeMin').onclick = () => {
      const minimized = panel.classList.toggle('minimized');
      document.querySelector('#pwPrizeMin').textContent = minimized ? '復元' : 'Min';
    };
    document.querySelector('#pwPrizeBuild').onclick = buildPlanFromInput;
    document.querySelector('#pwPrizeWrite').onclick = writePlan;
    document.querySelector('#pwPrizeCheck').onclick = checkPlan;
    document.querySelector('#pwPrizeCopyPlan').onclick = async () => {
      const plan = loadState().plan;
      if (!plan) return alert('Planがありません。');
      await copyText(matrixLog(plan, 'PLAN'));
      alert('PLAN LOGをコピーしました。');
    };
    document.querySelector('#pwPrizeCopyCheck').onclick = async () => {
      const plan = loadState().plan;
      if (!plan) return alert('Planがありません。');
      await copyText(matrixLog(plan, 'CHECK'));
      alert('CHECK LOGをコピーしました。');
    };
    document.querySelector('#pwPrizeCopyWrite').onclick = async () => {
      const plan = loadState().plan;
      if (!plan) return alert('Planがありません。');
      await copyText(matrixLog(plan, 'WRITE'));
      alert('WRITE LOGをコピーしました。');
    };
    document.querySelector('#pwPrizeCopyDebug').onclick = async () => {
      const state = loadState();
      const plan = state.plan;
      const parsed = state.debugPrizeGroups || [];
      if (!plan) return alert('Planがありません。');
      await copyText(matchDebugRows(parsed, plan.urlEntries || []));
      alert('MATCH DEBUGをコピーしました。');
    };
    document.querySelector('#pwPrizeCopyPrizeDebug').onclick = async () => {
      const parsed = loadState().debugPrizeGroups || [];
      if (!parsed.length) return alert('Prize Debugがありません。先にPLAN作成してください。');
      await copyText(prizeDebugRows(parsed));
      alert('PRIZE DEBUGをコピーしました。');
    };
    document.querySelector('#pwPrizeToggleDetail').onclick = () => {
      const el = document.querySelector('#pwPrizeDetail');
      el.style.display = el.style.display === 'block' ? 'none' : 'block';
      el.value = detailLines.join('\n');
    };
    const state = loadState();
    if (state.plan) renderPlan(state.plan);
  }

  addPanel();
})();
