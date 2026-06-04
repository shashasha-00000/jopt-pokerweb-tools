// ==UserScript==
// @name         PW Tournament Create Pipeline v1.1.1 設定欄版 wait改善
// @namespace    pw-tournament-create-pipeline
// @version      1.1.1
// @description  TSV設定欄から大会を一括作成し、仮想通貨販売・EN/RE/TE・Ticket Linkを状態機で実行する。旧成功版POST流を維持。
// @author       xhpc007 + ChatGPT
// @match        https://japanopt.pokerweb.com.br/cb/*
// @match        https://japanopt.pokerweb.com.br/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /********************************************************************
   * 0. CONFIG
   ********************************************************************/

  const FLOW_KEY = 'PW_TOURNAMENT_CREATE_PIPELINE_V11_STATE';
  const INPUT_KEY = 'PW_TOURNAMENT_CREATE_PIPELINE_V11_INPUT';
  const REPORT_KEY = 'PW_TOURNAMENT_CREATE_PIPELINE_V11_REPORT';
  const MINIMIZED_KEY = 'PW_TOURNAMENT_CREATE_PIPELINE_V11_MINIMIZED';

  const DEFAULTS = {
    modo: '0',
    qtd_dias: '1',
    vaga_geral: '0',
    vaga_ind: '0',
    datasGeradas: '0',

    id_estrutura: '18',
    id_blind: '1',
    blindName: 'A',

    enableVirtualCurrency: true,

    entryChips: '50,000',
    reEntryChips: '50,000',
    teChips: '0',

    direito_img: '1',
    pts_ranking: '0',
    gameid_bloqueio: '1',
    rake: '0',
    taxa_extras: '',

    entryReposicionar: '0',
    reEntryReposicionar: '1',
    ticketEntryReposicionar: '0'
  };

  const REQUIRED_HEADERS = [
    '大会名',
    '日付',
    '開始時間',
    'EN金額',
    'EN手数料',
    'EN回数',
    'RE金額',
    'RE手数料',
    'RE回数',
    'TE金額',
    'TE手数料',
    'TE回数',
    'チケット名称'
  ];

  let manualStop = false;
  let lastParsed = null;

  /********************************************************************
   * 1. BASIC UTILS
   ********************************************************************/

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

  function normalizeText(s) {
    return String(s ?? '')
      .replace(/\u3000/g, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeAmount(s) {
    const t = normalizeText(s);
    if (!t) return '';
    return t.replace(/[￥¥,\s]/g, '');
  }

  function normalizeDateToDdMmYyyy(s) {
    const raw = normalizeText(s);
    if (!raw) return '';

    let m = raw.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
    if (m) {
      return `${String(Number(m[3])).padStart(2, '0')}/${String(Number(m[2])).padStart(2, '0')}/${m[1]}`;
    }

    m = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
    if (m) {
      return `${String(Number(m[1])).padStart(2, '0')}/${String(Number(m[2])).padStart(2, '0')}/${m[3]}`;
    }

    return raw;
  }

  function normalizeTime(s) {
    const raw = normalizeText(s);
    if (!raw) return '';

    const m = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return raw;

    return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
  }

  function normalizeLimit(raw) {
    const s = normalizeText(raw);

    if (!s) return '';

    const lower = s.toLowerCase();

    if (
      s === '無制限' ||
      s === '无限制' ||
      s === '無限' ||
      s === '无限' ||
      lower === 'unlimited' ||
      lower === 'infinite' ||
      lower === 'inf'
    ) {
      return '0';
    }

    const n = s.replace(/[^\d]/g, '');
    if (n === '') return s;

    return String(Number(n));
  }

  function hasAnyValue(...values) {
    return values.some(v => normalizeText(v) !== '');
  }

  function escapeTsv(v) {
    return String(v ?? '')
      .replace(/\r?\n/g, ' ')
      .replace(/\t/g, ' ')
      .trim();
  }

  function makeReportLine(type, msg) {
    return `[${nowText()}] ${type}  ${msg}`;
  }

  function log(msg) {
    console.log(`[PW-CREATE-V11] ${msg}`);
    const box = document.querySelector('#pw-create-v11-status');
    if (box) box.textContent = msg;
  }

  function warn(msg) {
    console.warn(`[PW-CREATE-V11] ${msg}`);
    const box = document.querySelector('#pw-create-v11-status');
    if (box) box.textContent = `⚠ ${msg}`;
  }

  function debugFormData(title, fd) {
    console.log(`[PW-CREATE-V11] ${title}`);
    for (const [k, v] of fd.entries()) {
      console.log(k, '=', v);
    }
  }

  function isVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  async function waitUntil(predicate, options = {}) {
    const timeout = Number(options.timeout ?? 8000);
    const interval = Number(options.interval ?? 100);
    const message = options.message || '条件の成立を待機しましたが、timeoutしました';
    const started = Date.now();

    while (Date.now() - started < timeout) {
      let result = false;

      try {
        result = await predicate();
      } catch (_) {
        result = false;
      }

      if (result) return result;
      await sleep(interval);
    }

    throw new Error(`${message} / timeout=${timeout}ms`);
  }

  async function waitForSelector(selector, options = {}) {
    const timeout = Number(options.timeout ?? 8000);
    const visible = !!options.visible;

    return await waitUntil(() => {
      const el = document.querySelector(selector);
      if (!el) return null;
      if (visible && !isVisible(el)) return null;
      return el;
    }, {
      timeout,
      interval: Number(options.interval ?? 100),
      message: `selectorが見つかりません: ${selector}`
    });
  }

  async function waitForModalClosed(timeout = 5000) {
    await waitUntil(() => {
      const hasOpenModal = !!document.querySelector('.modal.show, .modal.in, .modal-backdrop');
      const bodyOpen = document.body.classList.contains('modal-open');
      return !hasOpenModal && !bodyOpen;
    }, {
      timeout,
      interval: 100,
      message: 'modalが閉じるのを待機しましたが、timeoutしました'
    });
  }

  function getTournamentIdFromUrl(url = location.href) {
    const m = String(url).match(/\/painel\/(\d+)/) || String(url).match(/\/cb\/torneio\/painel\/(\d+)/);
    return m ? m[1] : '';
  }

  function getTournamentPanelUrl(id) {
    return `/cb/torneio/painel/${id}`;
  }

  function isPainelPage() {
    return /\/cb\/torneio\/painel\/\d+/.test(location.href);
  }

  function copyText(text) {
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

  /********************************************************************
   * 2. STATE / REPORT
   ********************************************************************/

  function getState() {
    try {
      return JSON.parse(sessionStorage.getItem(FLOW_KEY) || '{}');
    } catch (_) {
      return {};
    }
  }

  function setState(state) {
    sessionStorage.setItem(FLOW_KEY, JSON.stringify(state));
    renderReport(state.report || []);
  }

  function clearState() {
    sessionStorage.removeItem(FLOW_KEY);
  }

  function appendReportToState(state, type, msg) {
    if (!state.report) state.report = [];
    state.report.push(makeReportLine(type, msg));
    localStorage.setItem(REPORT_KEY, state.report.join('\n'));
    setState(state);
  }

  function renderReport(report) {
    const text = Array.isArray(report) ? report.join('\n') : String(report || '');
    const box = document.querySelector('#pw-create-v11-report');
    if (box) {
      box.value = text;
      box.scrollTop = box.scrollHeight;
    }
  }

  function renderLastReport() {
    const state = getState();
    if (state.report && state.report.length) {
      renderReport(state.report);
    } else {
      renderReport(localStorage.getItem(REPORT_KEY) || '');
    }
  }

  function getCurrentTournament(state) {
    const index = Number(state.tournamentIndex || 0);
    const list = state.tournaments || [];
    const t = list[index];

    if (!t) {
      throw new Error(`找不到 tournamentIndex=${index} 的比赛数据`);
    }

    return t;
  }

  /********************************************************************
   * 3. TSV PARSER
   ********************************************************************/

  function splitLines(raw) {
    return String(raw || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map(x => x.replace(/\uFEFF/g, ''))
      .filter(x => normalizeText(x));
  }

  function splitTickets(raw) {
    const text = String(raw || '').trim();
    if (!text) return [];

    return text
      .split(/\n|、|，|;|；|\|/)
      .map(normalizeText)
      .filter(Boolean);
  }

  function parseTournamentSettings(raw) {
    const errors = [];
    const warnings = [];
    const lines = splitLines(raw);

    if (!lines.length) {
      errors.push('設定欄が空です');
      return { ok: false, errors, warnings, tournaments: [] };
    }

    const header = lines[0].split('\t').map(normalizeText);
    const headerIndex = {};

    header.forEach((h, i) => {
      if (h) headerIndex[h] = i;
    });

    const missing = REQUIRED_HEADERS.filter(h => !(h in headerIndex));
    if (missing.length) {
      errors.push(`必要なヘッダーが不足しています：${missing.join(', ')}`);
      return { ok: false, errors, warnings, tournaments: [] };
    }

    const tournaments = [];

    for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const cols = line.split('\t');

      const cell = h => normalizeText(cols[headerIndex[h]] ?? '');

      const name = cell('大会名');
      const date = normalizeDateToDdMmYyyy(cell('日付'));
      const time = normalizeTime(cell('開始時間'));

      const enAmountRaw = cell('EN金額');
      const enFeeRaw = cell('EN手数料');
      const enLimitRaw = cell('EN回数');

      const reAmountRaw = cell('RE金額');
      const reFeeRaw = cell('RE手数料');
      const reLimitRaw = cell('RE回数');

      const teAmountRaw = cell('TE金額');
      const teFeeRaw = cell('TE手数料');
      const teLimitRaw = cell('TE回数');

      const enAmount = normalizeAmount(enAmountRaw);
      const enFee = normalizeAmount(enFeeRaw);
      const enLimit = normalizeLimit(enLimitRaw);

      const reAmount = normalizeAmount(reAmountRaw);
      const reFee = normalizeAmount(reFeeRaw);
      const reLimit = normalizeLimit(reLimitRaw);

      const teAmount = normalizeAmount(teAmountRaw);
      const teFee = normalizeAmount(teFeeRaw);
      const teLimit = normalizeLimit(teLimitRaw);

      const tickets = splitTickets(cols[headerIndex['チケット名称']] ?? '');
      const rowNo = lineIndex + 1;

      if (!name) errors.push(`第${rowNo}行：大会名が空です`);
      if (!date) errors.push(`第${rowNo}行：日付が空です`);
      if (!time) errors.push(`第${rowNo}行：開始時間が空です`);

      const setupEntry = hasAnyValue(enAmountRaw, enFeeRaw, enLimitRaw);
      const setupReEntry = hasAnyValue(reAmountRaw, reFeeRaw, reLimitRaw);
      const setupTicketEntry = hasAnyValue(teAmountRaw, teFeeRaw, teLimitRaw);

      if (setupEntry) {
        if (!enLimit) errors.push(`第${rowNo}行：ENを設定する場合、EN回数が必要です`);
        if (enAmount === '') errors.push(`第${rowNo}行：ENを設定する場合、EN金額が必要です。0円の場合は 0 と入力してください`);
        if (enFee === '') errors.push(`第${rowNo}行：ENを設定する場合、EN手数料が必要です。0円の場合は 0 と入力してください`);
      }

      if (setupReEntry) {
        if (!reLimit) errors.push(`第${rowNo}行：REを設定する場合、RE回数が必要です`);
        if (reAmount === '') errors.push(`第${rowNo}行：REを設定する場合、RE金額が必要です。0円の場合は 0 と入力してください`);
        if (reFee === '') errors.push(`第${rowNo}行：REを設定する場合、RE手数料が必要です。0円の場合は 0 と入力してください`);
      }

      if (setupTicketEntry) {
        if (!teLimit) errors.push(`第${rowNo}行：TEを設定する場合、TE回数が必要です`);
        if (teAmount === '') errors.push(`第${rowNo}行：TEを設定する場合、TE金額が必要です。0円の場合は 0 と入力してください`);
        if (teFee === '') errors.push(`第${rowNo}行：TEを設定する場合、TE手数料が必要です。0円の場合は 0 と入力してください`);
      }

      tournaments.push({
        rowNo,
        name,
        date,
        time,

        id_estrutura: DEFAULTS.id_estrutura,
        id_blind: DEFAULTS.id_blind,
        blindName: DEFAULTS.blindName,

        enableVirtualCurrency: DEFAULTS.enableVirtualCurrency,

        entry: setupEntry
          ? {
              valor: enAmount,
              taxa: enFee,
              limite: enLimit,
              reposicionar: DEFAULTS.entryReposicionar
            }
          : null,

        reEntry: setupReEntry
          ? {
              valor: reAmount,
              taxa: reFee,
              limite: reLimit,
              reposicionar: DEFAULTS.reEntryReposicionar
            }
          : null,

        ticketEntry: setupTicketEntry
          ? {
              enabled: true,
              valor: teAmount,
              taxa: teFee,
              limite: teLimit,
              reposicionar: DEFAULTS.ticketEntryReposicionar
            }
          : null,

        tickets,

        setupEntry,
        setupReEntry,
        setupTicketEntry,
        linkTickets: tickets.length > 0
      });
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      tournaments
    };
  }

  function displayLimit(limit) {
    return String(limit) === '0' ? '無制限' : String(limit);
  }

  function makePreviewText(parsed) {
    const lines = [];

    lines.push(makeReportLine('PREVIEW', 'Tournament Create Pipeline v1.1 設定確認'));
    lines.push('');

    if (parsed.errors.length) {
      lines.push('【ERROR / START不可】');
      parsed.errors.forEach(e => lines.push(`- ${e}`));
      lines.push('');
    }

    if (parsed.warnings.length) {
      lines.push('【WARN】');
      parsed.warnings.forEach(w => lines.push(`- ${w}`));
      lines.push('');
    }

    lines.push('【固定ルール】');
    lines.push(`base / id_estrutura: ${DEFAULTS.id_estrutura}`);
    lines.push(`ブラインド: ${DEFAULTS.blindName} / id_blind=${DEFAULTS.id_blind}`);
    lines.push('仮想通貨販売: はい');
    lines.push('direito_img: 1');
    lines.push('pts_ranking: 0');
    lines.push('gameid_bloqueio: 1');
    lines.push('rake: 0');
    lines.push('taxa_extras: 空');
    lines.push('EN fichas: 50,000 / reposicionar: 0');
    lines.push('RE fichas: 50,000 / reposicionar: 1');
    lines.push('TE fichas: 0 / reposicionar: 0');
    lines.push('回数: 0 / 無制限 = 無制限');
    lines.push('チケット名称: 複数の場合は「、」で区切る');
    lines.push('');

    lines.push('【作成予定】');
    lines.push(`大会数: ${parsed.tournaments.length}`);
    lines.push('');

    parsed.tournaments.forEach((t, i) => {
      lines.push(`${i + 1}. ${t.name}`);
      lines.push(`   日時: ${t.date} ${t.time}`);
      lines.push(`   base: ${t.id_estrutura}`);
      lines.push(`   ブラインド: ${t.blindName} / ${t.id_blind}`);
      lines.push(`   仮想通貨販売: ${t.enableVirtualCurrency ? 'はい' : 'いいえ'}`);

      if (t.entry) {
        lines.push(`   EN: 金額=${t.entry.valor} / 手数料=${t.entry.taxa} / 回数=${displayLimit(t.entry.limite)}`);
      } else {
        lines.push('   EN: なし');
      }

      if (t.reEntry) {
        lines.push(`   RE: 金額=${t.reEntry.valor} / 手数料=${t.reEntry.taxa} / 回数=${displayLimit(t.reEntry.limite)}`);
      } else {
        lines.push('   RE: なし');
      }

      if (t.ticketEntry) {
        lines.push(`   TE: 金額=${t.ticketEntry.valor} / 手数料=${t.ticketEntry.taxa} / 回数=${displayLimit(t.ticketEntry.limite)}`);
      } else {
        lines.push('   TE: なし');
      }

      lines.push(`   Ticket Link: ${t.tickets.length ? `${t.tickets.length}件` : 'なし'}`);
      t.tickets.forEach(ticket => lines.push(`      → ${ticket}`));
      lines.push('');
    });

    if (!parsed.errors.length) {
      lines.push('【Preview結果】OK。内容確認後、STARTできます。');
    }

    return lines.join('\n');
  }

  function previewSettings() {
    const raw = document.querySelector('#pw-create-v11-input')?.value || '';
    localStorage.setItem(INPUT_KEY, raw);

    const parsed = parseTournamentSettings(raw);
    lastParsed = parsed;

    const text = makePreviewText(parsed);
    renderReport(text);
    localStorage.setItem(REPORT_KEY, text);

    const startBtn = document.querySelector('#pw-create-v11-start');
    if (startBtn) {
      startBtn.disabled = !parsed.ok;
      startBtn.style.opacity = parsed.ok ? '1' : '.45';
      startBtn.style.cursor = parsed.ok ? 'pointer' : 'not-allowed';
    }

    if (parsed.ok) {
      alert(`Preview OK\n大会数: ${parsed.tournaments.length}\nSTARTできます。`);
    } else {
      alert(`Preview NG\nERROR: ${parsed.errors.length}件\nReportを確認してください。`);
    }

    return parsed;
  }

  /********************************************************************
   * 4. FORM / PAGE OPERATIONS
   ********************************************************************/

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

    if (!tab) throw new Error('Configuracao 页签が見つかりません');

    try {
      if (window.$ && tab.tagName === 'A') {
        window.$(tab).tab?.('show');
      }
    } catch (_) {}

    try {
      tab.click();
    } catch (_) {}

    await waitUntil(() => {
      const pane = document.querySelector('#configuracao, #Configuracao');

      if (pane) {
        return isVisible(pane) || /\bactive\b/.test(String(pane.className || ''));
      }

      return (
        document.querySelector('a[href="#modal_item_editar"], a[href="#modal_item_inserir"]') ||
        [...document.querySelectorAll('a, button')]
          .find(el => isVisible(el) && normalizeText(el.innerText || el.textContent || '').includes('グループをリンクする'))
      );
    }, {
      timeout: 8000,
      message: 'Configuracao 页签の表示待機がtimeoutしました'
    });
  }

  function closeModals() {
    try {
      if (window.$) {
        window.$('#modal_item_editar').modal('hide');
        window.$('#modal_item_inserir').modal('hide');
        window.$('#modal_grupo_vagas').modal('hide');
        window.$('.modal').modal('hide');
      }
    } catch (_) {}

    try {
      document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
      document.body.classList.remove('modal-open');
    } catch (_) {}
  }

  function applyDataToFormData(fd, data) {
    for (const [key, value] of Object.entries(data)) {
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

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${label} POST 失败 status=${res.status} ${res.statusText || ''}\n${body.slice(0, 500)}`);
    }

    return res;
  }

  /********************************************************************
   * 5. CREATE TOURNAMENT
   ********************************************************************/

  async function createTournament(t, state) {
    log(`开始创建比赛：${t.name}`);

    const fd = new FormData();

    fd.set('ddTrnNovo[modo]', DEFAULTS.modo);
    fd.set('ddTrnNovo[qtd_dias]', DEFAULTS.qtd_dias);
    fd.set('ddTrnNovo[nome]', t.name);
    fd.set('ddTrnNovo[id_estrutura]', DEFAULTS.id_estrutura);
    fd.set('ddTrnNovo[id_blind]', DEFAULTS.id_blind);
    fd.set('ddTrnNovo[data]', t.date);
    fd.set('ddTrnNovo[hora]', t.time);
    fd.set('ddTrnNovo[vaga_geral]', DEFAULTS.vaga_geral);
    fd.set('ddTrnNovo[vaga_ind]', DEFAULTS.vaga_ind);
    fd.set('ddTrnNovo[datasGeradas]', DEFAULTS.datasGeradas);

    debugFormData(`create tournament payload: ${t.name}`, fd);

    const res = await fetch('/cb/torneio/cadastrar', {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
      redirect: 'follow'
    });

    const raw = await res.text();

    console.log('[PW-CREATE-V11] create response status =', res.status);
    console.log('[PW-CREATE-V11] create response raw =', raw);

    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      throw new Error(`创建返回不是 JSON：${raw.slice(0, 500)}`);
    }

    if (!json || json.resultado !== 'ok' || !json.ddTrns || !json.ddTrns.id_torneio) {
      throw new Error(`创建返回 JSON 没有 id_torneio：${raw.slice(0, 500)}`);
    }

    const tournamentId = String(json.ddTrns.id_torneio);
    const painelUrl = getTournamentPanelUrl(tournamentId);

    appendReportToState(state, 'CREATE_OK', `${t.name} / tournamentId=${tournamentId} / blind=${DEFAULTS.blindName}(${DEFAULTS.id_blind})`);

    state.tournamentId = tournamentId;
    state.painelUrl = painelUrl;
    state.step = 'VIRTUAL_CURRENCY';
    state.ticketIndex = 0;
    setState(state);

    await sleep(200);
    location.href = painelUrl;
  }

  /********************************************************************
   * 6. VIRTUAL CURRENCY
   ********************************************************************/

  async function enableVirtualCurrencySales(state) {
    const idTorneio = state.tournamentId || getTournamentIdFromUrl();

    if (!idTorneio) {
      throw new Error('仮想通貨販売許可: id_torneio が見つかりません');
    }

    log(`开启仮想通貨販売許可: id_torneio=${idTorneio}`);

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

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`仮想通貨販売許可 POST 失败 status=${res.status} ${res.statusText || ''}\n${text.slice(0, 500)}`);
    }

    appendReportToState(state, 'VIRTUAL_CURRENCY_OK', `id_torneio=${idTorneio} / status=${res.status}`);
  }

  /********************************************************************
   * 7. EN / RE / TE
   ********************************************************************/

  function buildEntryData(t) {
    const en = t.entry;

    return {
      nome: 'Entry',
      siglas: 'En',
      fichas: DEFAULTS.entryChips,
      limite: en.limite,
      reposicionar: en.reposicionar,
      direito_img: DEFAULTS.direito_img,
      pts_ranking: DEFAULTS.pts_ranking,
      gameid_bloqueio: DEFAULTS.gameid_bloqueio,
      valor: en.valor,
      taxa: en.taxa,
      rake: DEFAULTS.rake,
      taxa_extras: DEFAULTS.taxa_extras
    };
  }

  function buildReEntryData(t) {
    const re = t.reEntry;

    return {
      nome: 'Re Entry',
      siglas: 'Re',
      fichas: DEFAULTS.reEntryChips,
      limite: re.limite,
      reposicionar: re.reposicionar,
      direito_img: DEFAULTS.direito_img,
      pts_ranking: DEFAULTS.pts_ranking,
      gameid_bloqueio: DEFAULTS.gameid_bloqueio,
      valor: re.valor,
      taxa: re.taxa,
      rake: DEFAULTS.rake,
      taxa_extras: DEFAULTS.taxa_extras
    };
  }

  function buildTicketEntryData(t) {
    const te = t.ticketEntry;

    return {
      nome: 'Ticket Entry',
      siglas: 'TE',
      fichas: DEFAULTS.teChips,
      limite: te.limite,
      reposicionar: te.reposicionar,
      direito_img: DEFAULTS.direito_img,
      pts_ranking: DEFAULTS.pts_ranking,
      gameid_bloqueio: DEFAULTS.gameid_bloqueio,
      valor: te.valor,
      taxa: te.taxa,
      rake: DEFAULTS.rake,
      taxa_extras: DEFAULTS.taxa_extras
    };
  }

  async function openEditModalByItemName(itemName) {
    await openConfiguracao();

    const btn =
      document.querySelector(`a[href="#modal_item_editar"][data-nome="${itemName}"]`) ||
      [...document.querySelectorAll('a[href="#modal_item_editar"], a, button')]
        .find(el => {
          const dataNome = normalizeText(el.getAttribute?.('data-nome') || '');
          const text = normalizeText(el.innerText || el.textContent || '');
          return isVisible(el) && (dataNome === itemName || text.includes(itemName));
        });

    if (!btn) throw new Error(`找不到 item: ${itemName}`);

    btn.click();
    const form = await waitForSelector('#modal_item_editar form', { visible: true, timeout: 8000 });

    return form;
  }

  async function openEditModalForTEIfExists() {
    await openConfiguracao();

    const btn =
      document.querySelector('a[href="#modal_item_editar"][data-nome="Ticket Entry"], a[href="#modal_item_editar"][data-siglas="TE"]') ||
      [...document.querySelectorAll('a[href="#modal_item_editar"], a, button')]
        .find(el => {
          const dataNome = normalizeText(el.getAttribute?.('data-nome') || '');
          const siglas = normalizeText(el.getAttribute?.('data-siglas') || '');
          const text = normalizeText(el.innerText || el.textContent || '');
          return isVisible(el) && (dataNome === 'Ticket Entry' || siglas === 'TE' || text.includes('Ticket Entry'));
        });

    if (!btn) return null;

    btn.click();
    const form = await waitForSelector('#modal_item_editar form', { visible: true, timeout: 8000 });

    return form;
  }

  async function openInsertModalForTE() {
    await openConfiguracao();

    const addBtn =
      document.querySelector('a[href="#modal_item_inserir"]') ||
      [...document.querySelectorAll('a, button')]
        .find(el => isVisible(el) && normalizeText(el.innerText || el.textContent || '').includes('新しく追加'));

    if (!addBtn) throw new Error('找不到「新しく追加」按钮');

    addBtn.click();
    const form = await waitForSelector('#modal_item_inserir form', { visible: true, timeout: 8000 });

    return form;
  }

  async function saveEntryDirect(t, state) {
    if (!t.entry || !t.setupEntry) {
      appendReportToState(state, 'ENTRY_SKIP', `${t.name} / ENなし`);
      return;
    }

    log(`开始保存 Entry：${t.name}`);
    const form = await openEditModalByItemName('Entry');
    await postForm(form, buildEntryData(t), 'Entry');
    closeModals();
    await waitForModalClosed();
    appendReportToState(state, 'ENTRY_OK', `${t.name} / ${t.entry.valor} / limit=${displayLimit(t.entry.limite)}`);
  }

  async function saveReEntryDirect(t, state) {
    if (!t.reEntry || !t.setupReEntry) {
      appendReportToState(state, 'RE_SKIP', `${t.name} / REなし`);
      return;
    }

    log(`开始保存 Re Entry：${t.name}`);
    const form = await openEditModalByItemName('Re Entry');
    await postForm(form, buildReEntryData(t), 'Re Entry');
    closeModals();
    await waitForModalClosed();
    appendReportToState(state, 'RE_OK', `${t.name} / ${t.reEntry.valor} / limit=${displayLimit(t.reEntry.limite)}`);
  }

  async function saveTEDirectSmart(t, state) {
    if (!t.ticketEntry || !t.setupTicketEntry) {
      appendReportToState(state, 'TE_SKIP', `${t.name} / TEなし`);
      return;
    }

    log(`开始保存 Ticket Entry：${t.name}`);

    let form = await openEditModalForTEIfExists();
    let label = 'Ticket Entry 编辑';

    if (!form) {
      log('当前没有 TE，准备新建 Ticket Entry');
      form = await openInsertModalForTE();
      label = 'Ticket Entry 新增';
    } else {
      log('找到既存 TE，准备编辑保存');
    }

    await postForm(form, buildTicketEntryData(t), label);
    closeModals();
    await waitForModalClosed();
    appendReportToState(state, 'TE_OK', `${t.name} / ${t.ticketEntry.valor} / limit=${displayLimit(t.ticketEntry.limite)}`);
  }

  /********************************************************************
   * 8. TICKET LINK
   ********************************************************************/

  async function openGrupoLinkModal() {
    await openConfiguracao();

    const btn =
      [...document.querySelectorAll('a, button')]
        .find(el => isVisible(el) && normalizeText(el.innerText || el.textContent || '').includes('グループをリンクする'));

    if (!btn) throw new Error('找不到「グループをリンクする」按钮');

    btn.click();

    const form = await waitUntil(() => {
      const actionForm = document.querySelector('form[action*="vincular_grupos_vagas"]');

      if (actionForm && isVisible(actionForm)) return actionForm;

      return [...document.querySelectorAll('form')]
        .find(f => {
          const html = f.innerHTML || '';
          return html.includes('grupo_vagas') && html.includes('id_torneio') && isVisible(f);
        });
    }, {
      timeout: 8000,
      message: 'Ticket Link modal formの表示待機がtimeoutしました'
    });

    if (!form) throw new Error('找不到 link ticket 的 form');

    const select = form.querySelector('select[name="grupo_vagas"]');
    if (!select) throw new Error("找不到 select[name='grupo_vagas']");

    return { form, select };
  }

  function normalizeTicketCoreName(s) {
    return normalizeText(s)
      .replace(/^ナショナルチケット\s*-\s*/i, '')
      .trim();
  }

  function normalizeTicketCompareText(s) {
    return normalizeText(s).replace(/\s+/g, '').toLowerCase();
  }

  function pickUniqueMatch(matches, levelName, ticketName) {
    if (matches.length === 1) return matches[0];

    if (matches.length > 1) {
      console.table(matches);

      const list = matches
        .map(x => `- value=${x.value} / text=${x.text}`)
        .join('\n');

      throw new Error(
        `Ticket匹配が複数あります。自動選択を停止しました。\n` +
        `入力: ${ticketName}\n` +
        `判定段階: ${levelName}\n` +
        `候補:\n${list}`
      );
    }

    return null;
  }

  function findTicketOption(select, ticketName) {
    const target = normalizeText(ticketName);
    const targetCore = normalizeTicketCoreName(target);
    const normalizedTarget = normalizeTicketCompareText(target);
    const normalizedTargetCore = normalizeTicketCompareText(targetCore);

    const options = [...select.querySelectorAll('option')]
      .map((o, i) => {
        const text = normalizeText(o.innerText || o.textContent || '');
        const core = normalizeTicketCoreName(text);

        return {
          i,
          value: o.value,
          text,
          core,
          normalizedText: normalizeTicketCompareText(text),
          normalizedCore: normalizeTicketCompareText(core)
        };
      })
      .filter(x => x.value && x.text);

    const levels = [
      {
        name: '完整文本完全一致',
        matches: options.filter(x => x.text === target)
      },
      {
        name: '核心名完全一致',
        matches: options.filter(x => x.core === targetCore)
      },
      {
        name: '標準化完整文本完全一致',
        matches: options.filter(x => x.normalizedText === normalizedTarget)
      },
      {
        name: '標準化核心名完全一致',
        matches: options.filter(x => x.normalizedCore === normalizedTargetCore)
      },
      {
        name: '包含匹配',
        matches: options.filter(x => (
          (target && x.text.includes(target)) ||
          (targetCore && x.core.includes(targetCore)) ||
          (normalizedTarget && x.normalizedText.includes(normalizedTarget)) ||
          (normalizedTargetCore && x.normalizedCore.includes(normalizedTargetCore))
        ))
      }
    ];

    for (const level of levels) {
      const picked = pickUniqueMatch(level.matches, level.name, ticketName);
      if (picked) return picked;
    }

    console.table(options);

    const list = options
      .slice(0, 30)
      .map(x => `- value=${x.value} / text=${x.text}`)
      .join('\n');

    throw new Error(
      `Ticketが見つかりません。\n` +
      `入力: ${ticketName}\n` +
      `候補一覧:\n${list}`
    );
  }

  function getFormValue(form, name) {
    const el = form.querySelector(`[name="${name}"]`);
    return el ? el.value : '';
  }

  async function linkOneTicket(ticketName, state, t) {
    log(`开始 link ticket: ${ticketName}`);

    const { form, select } = await openGrupoLinkModal();
    const opt = findTicketOption(select, ticketName);

    const idTorneio =
      getFormValue(form, 'id_torneio') ||
      state.tournamentId ||
      getTournamentIdFromUrl();

    const codbloq = getFormValue(form, 'codbloq');

    if (!idTorneio) throw new Error('找不到 id_torneio');
    if (!codbloq) throw new Error('找不到 codbloq');

    const fd = new FormData();
    fd.set('grupo_vagas', opt.value);
    fd.set('codbloq', codbloq);
    fd.set('id_torneio', idTorneio);

    debugFormData(`link ticket payload: ${ticketName}`, fd);

    const res = await fetch(form.action || '/cb/torneio/abas/configuracao/vincular_grupos_vagas', {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
      redirect: 'follow'
    });

    log(`ticket link 完成: ${ticketName} → ${opt.value} / status=${res.status}`);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`ticket link POST 失败 status=${res.status} ${res.statusText || ''}\n${text.slice(0, 500)}`);
    }

    closeModals();
    await waitForModalClosed();
    appendReportToState(state, 'LINK_OK', `${t.name} / ${ticketName} / value=${opt.value} / status=${res.status}`);
  }

  /********************************************************************
   * 9. FLOW
   ********************************************************************/

  async function moveToNextTournamentOrDone(state) {
    const nextIndex = Number(state.tournamentIndex || 0) + 1;

    if (nextIndex >= (state.tournaments || []).length) {
      state.step = 'DONE';
      state.running = false;
      setState(state);
      appendReportToState(state, 'DONE', `全大会処理完了: ${state.tournaments.length}件`);
      log('所有比赛处理完成');
      return;
    }

    state.tournamentIndex = nextIndex;
    state.step = 'CREATE';
    state.tournamentId = '';
    state.painelUrl = '';
    state.ticketIndex = 0;
    setState(state);

    const nextTournament = state.tournaments[nextIndex];

    log(`准备处理下一场：${nextTournament.name}`);
    appendReportToState(state, 'NEXT', `${nextIndex + 1}/${state.tournaments.length} ${nextTournament.name}`);

    await sleep(200);

    await createTournament(nextTournament, state);
  }

  async function runCurrentStep() {
    const state = getState();

    if (!state.running) {
      log('ready');
      renderLastReport();
      return;
    }

    if (manualStop) {
      log('停止请求中');
      return;
    }

    let t = null;

    try {
      t = getCurrentTournament(state);
      const currentId = getTournamentIdFromUrl();

      if (currentId && !state.tournamentId) {
        state.tournamentId = currentId;
        state.painelUrl = getTournamentPanelUrl(currentId);
        setState(state);
        log(`记录 tournamentId=${currentId}`);
      }

      log(`当前比赛 ${Number(state.tournamentIndex || 0) + 1}/${state.tournaments.length}: ${t.name} / step=${state.step}`);

      if (state.step === 'CREATE') {
        await createTournament(t, state);
        return;
      }

      if (!isPainelPage()) {
        if (state.painelUrl) {
          location.href = state.painelUrl;
          return;
        }
        throw new Error(`当前不是比赛详情页，无法继续 ${state.step}。当前URL=${location.href}`);
      }

      if (state.step === 'VIRTUAL_CURRENCY') {
        if (t.enableVirtualCurrency) {
          await enableVirtualCurrencySales(state);
        } else {
          appendReportToState(state, 'VIRTUAL_CURRENCY_SKIP', `${t.name}`);
        }

        state.step = 'ENTRY';
        setState(state);

        log('仮想通貨販売処理完成，刷新后继续 Entry');
        await sleep(200);
        location.reload();
        return;
      }

      if (state.step === 'ENTRY') {
        await saveEntryDirect(t, state);

        state.step = 'RE';
        setState(state);

        log('Entry 完成，刷新后继续 RE');
        await sleep(200);
        location.reload();
        return;
      }

      if (state.step === 'RE') {
        await saveReEntryDirect(t, state);

        state.step = 'TE';
        setState(state);

        log('RE 完成，刷新后继续 TE');
        await sleep(200);
        location.reload();
        return;
      }

      if (state.step === 'TE') {
        await saveTEDirectSmart(t, state);

        state.step = 'LINK';
        state.ticketIndex = 0;
        setState(state);

        log('TE 処理完成，刷新后继续 Ticket Link');
        await sleep(200);
        location.reload();
        return;
      }

      if (state.step === 'LINK') {
        if (!t.linkTickets || !t.tickets || !t.tickets.length) {
          appendReportToState(state, 'LINK_SKIP', `${t.name} / Ticketなし`);
          await moveToNextTournamentOrDone(state);
          return;
        }

        const idx = Number(state.ticketIndex || 0);

        if (idx >= t.tickets.length) {
          log(`所有 Ticket Link 完成：${t.name}`);
          await moveToNextTournamentOrDone(state);
          return;
        }

        const ticketName = t.tickets[idx];

        await linkOneTicket(ticketName, state, t);

        state.ticketIndex = idx + 1;
        setState(state);

        log(`Ticket ${idx + 1}/${t.tickets.length} 完成，刷新后继续`);
        await sleep(200);
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
      console.error('[PW-CREATE-V11] flow error:', e);

      const state2 = getState();
      appendReportToState(
        state2,
        'ERROR',
        `${t?.name || '(unknown)'} / step=${state2.step || state.step || ''} / ${e.message || e}`
      );

      warn(`失败：${e.message || e}`);
    }
  }

  function startFlow() {
    const raw = document.querySelector('#pw-create-v11-input')?.value || '';
    localStorage.setItem(INPUT_KEY, raw);

    const parsed = parseTournamentSettings(raw);
    lastParsed = parsed;

    const preview = makePreviewText(parsed);
    renderReport(preview);
    localStorage.setItem(REPORT_KEY, preview);

    if (!parsed.ok) {
      alert(`Preview NG\nERROR: ${parsed.errors.length}件\nReportを確認してください。`);
      return;
    }

    const summary = parsed.tournaments.map((t, i) => {
      return `${i + 1}. ${t.name}\n   ${t.date} ${t.time} / EN=${t.entry ? `${t.entry.valor}/${displayLimit(t.entry.limite)}` : 'なし'} / RE=${t.reEntry ? `${t.reEntry.valor}/${displayLimit(t.reEntry.limite)}` : 'なし'} / TE=${t.ticketEntry ? `${t.ticketEntry.valor}/${displayLimit(t.ticketEntry.limite)}` : 'なし'} / Tickets=${t.tickets.length}`;
    }).join('\n\n');

    const ok = confirm(
      `大会作成を開始しますか？\n\n` +
      `大会数: ${parsed.tournaments.length}\n\n` +
      `${summary}\n\n` +
      `実行順：CREATE → VIRTUAL_CURRENCY → ENTRY → RE → TE → LINK`
    );

    if (!ok) return;

    manualStop = false;

    const startReport = [];
    startReport.push(makeReportLine('START', `大会作成開始 / ${parsed.tournaments.length}件`));

    parsed.tournaments.forEach((t, i) => {
      startReport.push(
        `${i + 1}. ${t.name} / ${t.date} ${t.time} / EN=${t.entry ? `${t.entry.valor}/${displayLimit(t.entry.limite)}` : 'なし'} / RE=${t.reEntry ? `${t.reEntry.valor}/${displayLimit(t.reEntry.limite)}` : 'なし'} / TE=${t.ticketEntry ? `${t.ticketEntry.valor}/${displayLimit(t.ticketEntry.limite)}` : 'なし'} / Tickets=${t.tickets.length}`
      );
    });

    const state = {
      running: true,
      version: '1.1.1',
      tournamentIndex: 0,
      step: 'CREATE',
      tournamentId: '',
      painelUrl: '',
      ticketIndex: 0,
      tournaments: parsed.tournaments,
      report: startReport
    };

    setState(state);
    localStorage.setItem(REPORT_KEY, startReport.join('\n'));

    createTournament(parsed.tournaments[0], state);
  }

  function stopFlow() {
    manualStop = true;
    clearState();
    log('已停止并清除状态');
    const state = { report: [makeReportLine('STOP', '手動停止 / 状態クリア')] };
    renderReport(state.report);
    localStorage.setItem(REPORT_KEY, state.report.join('\n'));
  }

  function copyReport() {
    const text = document.querySelector('#pw-create-v11-report')?.value || '';
    if (!text) {
      alert('Reportが空です');
      return;
    }
    copyText(text);
    alert('Report copied');
  }

  function clearReportOnly() {
    renderReport('');
    localStorage.removeItem(REPORT_KEY);
  }

  function clearInput() {
    const ok = confirm('設定欄をクリアしますか？');
    if (!ok) return;

    const box = document.querySelector('#pw-create-v11-input');
    if (box) box.value = '';
    localStorage.removeItem(INPUT_KEY);
  }

  /********************************************************************
   * 10. UI
   ********************************************************************/

  function addPanel() {
    if (document.querySelector('#pw-create-v11-panel')) return;

    const savedInput = localStorage.getItem(INPUT_KEY) || REQUIRED_HEADERS.join('\t');
    const minimized = localStorage.getItem(MINIMIZED_KEY) === '1';

    const panel = document.createElement('div');
    panel.id = 'pw-create-v11-panel';

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
      width: 800px;
      max-height: 94vh;
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="font-weight:bold;">PW Tournament Create Pipeline v1.1 設定欄版</div>
        <div style="display:flex;gap:4px;">
          <button id="pw-create-v11-minimize" style="font-size:11px;padding:2px 6px;cursor:pointer;">${minimized ? 'Open' : 'Min'}</button>
          <button id="pw-create-v11-close" style="font-size:11px;padding:2px 6px;cursor:pointer;">×</button>
        </div>
      </div>

      <div id="pw-create-v11-body" style="display:${minimized ? 'none' : 'block'};">
        <div style="font-size:11px;color:#ccc;line-height:1.4;margin-bottom:8px;">
          入力形式：TSV / 1行1大会。<br>
          必須ヘッダー：大会名・日付・開始時間・EN金額・EN手数料・EN回数・RE金額・RE手数料・RE回数・TE金額・TE手数料・TE回数・チケット名称<br>
          固定：base=18 / ブラインド=A / 仮想通貨販売=はい / 0または無制限=無制限 / 空白=その項目を設定しない / 複数チケットは「、」区切り。
        </div>

        <textarea id="pw-create-v11-input"
          style="width:100%;height:170px;background:#111;color:#fff;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

        <div style="display:flex;gap:6px;margin-top:6px;">
          <button id="pw-create-v11-preview"
            style="flex:1;padding:7px;cursor:pointer;background:#d9ecff;border:1px solid #88a;">
            Preview
          </button>

          <button id="pw-create-v11-start"
            style="flex:1;padding:7px;cursor:pointer;background:#ffe08a;border:1px solid #c99;">
            START
          </button>

          <button id="pw-create-v11-stop"
            style="flex:1;padding:7px;cursor:pointer;background:#f3cccc;border:1px solid #c88;">
            Stop / Clear State
          </button>
        </div>

        <div style="display:flex;gap:6px;margin-top:6px;">
          <button id="pw-create-v11-copy-report"
            style="flex:1;padding:6px;cursor:pointer;background:#eee;border:1px solid #aaa;">
            Copy Report
          </button>

          <button id="pw-create-v11-clear-report"
            style="flex:1;padding:6px;cursor:pointer;background:#eee;border:1px solid #aaa;">
            Clear Report
          </button>

          <button id="pw-create-v11-clear-input"
            style="flex:1;padding:6px;cursor:pointer;background:#eee;border:1px solid #aaa;">
            Clear Input
          </button>
        </div>

        <div style="font-size:12px;font-weight:bold;margin-top:8px;">Report / Preview</div>
        <textarea id="pw-create-v11-report"
          readonly
          style="width:100%;height:180px;background:#111;color:#9fe;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:12px;"></textarea>

        <div id="pw-create-v11-status"
          style="margin-top:8px;font-size:11px;color:#9fe;line-height:1.35;white-space:pre-wrap;">
          ready
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    document.querySelector('#pw-create-v11-input').value = savedInput;

    document.querySelector('#pw-create-v11-preview').onclick = () => previewSettings();
    document.querySelector('#pw-create-v11-start').onclick = () => startFlow();
    document.querySelector('#pw-create-v11-stop').onclick = () => stopFlow();

    document.querySelector('#pw-create-v11-copy-report').onclick = () => copyReport();
    document.querySelector('#pw-create-v11-clear-report').onclick = () => clearReportOnly();
    document.querySelector('#pw-create-v11-clear-input').onclick = () => clearInput();

    document.querySelector('#pw-create-v11-minimize').onclick = () => {
      const body = document.querySelector('#pw-create-v11-body');
      const btn = document.querySelector('#pw-create-v11-minimize');

      if (!body || !btn) return;

      const hidden = body.style.display === 'none';
      body.style.display = hidden ? 'block' : 'none';
      btn.textContent = hidden ? 'Min' : 'Open';
      localStorage.setItem(MINIMIZED_KEY, hidden ? '0' : '1');
    };

    document.querySelector('#pw-create-v11-close').onclick = () => {
      const p = document.querySelector('#pw-create-v11-panel');
      if (p) p.style.display = 'none';
    };

    renderLastReport();
  }

  function boot() {
    addPanel();

    window.PWTournamentCreatePipelineV11 = {
      previewSettings,
      startFlow,
      stopFlow,
      runCurrentStep,
      getState,
      clearState,
      parseTournamentSettings,
      createTournament,
      enableVirtualCurrencySales,
      saveEntryDirect,
      saveReEntryDirect,
      saveTEDirectSmart,
      linkOneTicket
    };

    setTimeout(() => {
      const state = getState();

      if (state.running && state.step) {
        runCurrentStep();
      } else {
        log('ready');
      }
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
