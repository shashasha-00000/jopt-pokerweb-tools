// ==UserScript==
// @name         PW ナショナルチケット Batch
// @namespace    pw-national-ticket-batch-safe
// @version      1.3.4
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-national-ticket-batch.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-national-ticket-batch.user.js
// @description  任意のPokerWeb管理画面からGameID・チケット名TSVを厳密検証し、ナショナルチケットを安全に一件ずつ付与する正式版
// @author       xhpc007 + Codex
// @match        https://japanopt.pokerweb.com.br/cb/*
// @match        https://formanager.pokerweb.com.br/cb/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const APP = {
    inputKey: 'PW_NATIONAL_TICKET_BATCH_V10_INPUT',
    previewKey: 'PW_NATIONAL_TICKET_BATCH_V10_PREVIEW',
    logKey: 'PW_NATIONAL_TICKET_BATCH_V10_LOG',
    ledgerKey: 'PW_NATIONAL_TICKET_BATCH_V10_LEDGER',
    ticketListUrlKey: 'PW_NATIONAL_TICKET_BATCH_TICKET_LIST_URL',
    emitUrl: '/cb/vagas/emitir_ticket',
    ticketHistoryUrl: '/cb/vagas/historico_ticket',
    playerSearchUrl: '/cb/jogadores/search',
    defaultStoreName: 'JOPT - Japan Open Poker Tour',
    groupPathPattern: /\/painel_grupo_tickets\/(\d+)/,
    ticketListTextPattern: /ナショナル\s*チケット|national\s*ticket/i,
    minDelayMs: 30,
    maxDelayMs: 500,
    verifyAttempts: 2,
    verifyDelayMs: 200
  };

  const PREVIEW_HEADERS = [
    '行', 'GameID', 'チケット名', '店舗', 'grupo', 'groupURL',
    'id_jogador', '使用予定 ticket_id', 'ステータス', 'エラー理由'
  ];

  const LOG_HEADERS = [
    '行', 'GameID', 'チケット名', '店舗', 'grupo', 'ticket_id',
    'id_jogador', '結果', '時刻', 'response'
  ];

  let state = freshState();
  let verifiedTicketListCodbloq = '';

  function freshState() {
    const ledger = loadLedger();
    return {
      running: false,
      dryRunOk: false,
      tasks: [],
      logs: loadStoredLogs(),
      emittedTicketIds: new Set(ledger.emittedTicketIds),
      completedTaskKeys: new Set(ledger.completedTaskKeys)
    };
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function norm(value) {
    return String(value ?? '')
      .replace(/﻿/g, '')
      .replace(/　/g, ' ')
      .replace(/ /g, ' ')
      .replace(/[ \t\r\n]+/g, ' ')
      .trim();
  }

  function normalizeGameId(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits.length === 8 ? digits : '';
  }

  function rawToSearchGameId(value) {
    const digits = normalizeGameId(value);
    return digits ? `${digits.slice(0, 4)}.${digits.slice(4)}` : '';
  }

  function nowText() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function escTsv(value) {
    return String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
  }

  function toTsv(rows, headers) {
    return [
      headers.join('\t'),
      ...rows.map(row => headers.map(header => escTsv(row[header])).join('\t'))
    ].join('\n');
  }

  function loadStoredLogs() {
    const raw = localStorage.getItem(APP.logKey) || '';
    const lines = raw.split(/\r?\n/).filter(line => norm(line));
    if (lines.length < 2) return [];
    const headers = lines[0].split('\t').map(norm);
    return lines.slice(1).map(line => {
      const cols = line.split('\t');
      const row = {};
      headers.forEach((header, index) => { row[header] = cols[index] || ''; });
      return row;
    });
  }

  function loadLedger() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(APP.ledgerKey) || '{}');
      return {
        emittedTicketIds: Array.isArray(parsed.emittedTicketIds) ? parsed.emittedTicketIds : [],
        completedTaskKeys: Array.isArray(parsed.completedTaskKeys) ? parsed.completedTaskKeys : []
      };
    } catch (_) {
      return { emittedTicketIds: [], completedTaskKeys: [] };
    }
  }

  function saveLedger() {
    sessionStorage.setItem(APP.ledgerKey, JSON.stringify({
      emittedTicketIds: [...state.emittedTicketIds],
      completedTaskKeys: [...state.completedTaskKeys]
    }));
  }

  function parseHtml(html) {
    return new DOMParser().parseFromString(String(html || ''), 'text/html');
  }

  function absoluteUrl(url) {
    return new URL(url, location.origin).href;
  }

  function taskKey(task) {
    return `${task.lineNo}|${task.gameId}|${task.ticketName}`;
  }

  function setStatus(text, isError = false) {
    const el = document.querySelector('#pwnt-status');
    if (el) {
      el.textContent = text;
      el.style.color = isError ? '#ff9f9f' : '#9fe';
    }
    console[isError ? 'error' : 'log']('[PW-NATIONAL-TICKET]', text);
  }

  function copyText(text) {
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text);
        return;
      }
    } catch (_) {}

    navigator.clipboard?.writeText(text).catch(() => {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    });
  }

  async function requestText(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${url} HTTP ${response.status}: ${norm(text).slice(0, 180)}`);
    }
    return { response, text };
  }

  async function postForm(url, values) {
    return requestText(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: new URLSearchParams(values)
    });
  }

  function normalizeHeader(value) {
    return norm(value).toLowerCase().replace(/[\s_　]+/g, '');
  }

  function findHeaderIndex(headers, aliases) {
    const normalized = headers.map(normalizeHeader);
    const normalizedAliases = aliases.map(normalizeHeader);
    return normalized.findIndex(header => normalizedAliases.includes(header));
  }

  function parseQuantity(value, hasQuantityColumn) {
    const text = norm(value);
    if (!hasQuantityColumn && !text) return 1;
    if (!/^\d+$/.test(text)) return 0;
    const quantity = Number(text);
    return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0;
  }

  function createTask(lineNo, gameId, ticketName) {
    return {
      lineNo,
      gameId,
      ticketName,
      store: '',
      grupo: '',
      groupURL: '',
      idJogador: '',
      ticketId: '',
      codbloq: '',
      status: '未検証',
      error: '',
      postResultStatus: '',
      postResultSummary: '',
      auditResult: ''
    };
  }

  function parseInput(raw) {
    const lines = String(raw || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map(line => line.replace(/﻿/g, ''))
      .filter(line => norm(line));

    if (!lines.length) throw new Error('TSV が空です。');

    const headers = lines[0].split('\t').map(norm);
    const gameIndex = findHeaderIndex(headers, ['GameID', 'Game ID', 'ゲームID']);
    const ticketIndex = findHeaderIndex(headers, ['チケット名', '付与内容', 'Voucher', 'Voucher名', 'バウチャー名']);
    const quantityIndex = findHeaderIndex(headers, ['枚数', '数量', 'Qty', 'Quantity', 'Count']);
    const hasQuantityColumn = quantityIndex >= 0;

    if (gameIndex < 0 || ticketIndex < 0) {
      throw new Error('表頭は GameID/Game ID と チケット名/付与内容 の列が必要です。');
    }

    const tasks = [];
    const errors = [];

    lines.slice(1).forEach((line, index) => {
      const cols = line.split('\t');
      const lineNo = index + 2;
      const gameId = normalizeGameId(cols[gameIndex]);
      const ticketName = norm(cols[ticketIndex]);
      const quantity = parseQuantity(cols[quantityIndex], hasQuantityColumn);

      if (!gameId || !ticketName) {
        errors.push(`${lineNo}行目: GameID または チケット名 が不正です。`);
        return;
      }
      if (!quantity) {
        errors.push(`${lineNo}行目: 枚数が不正です。1以上の整数を指定してください。`);
        return;
      }

      for (let i = 0; i < quantity; i++) {
        tasks.push(createTask(quantity === 1 ? lineNo : `${lineNo}-${i + 1}`, gameId, ticketName));
      }
    });

    if (errors.length) throw new Error(errors.join('\n'));
    if (!tasks.length) throw new Error('付与タスクがありません。');
    return tasks;
  }

  function getGroupLinksFromDocument(doc) {
    const links = [...doc.querySelectorAll('a[href]')];
    const groups = [];

    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const match = href.match(APP.groupPathPattern);
      if (!match) continue;

      const row = link.closest('tr') || link.parentElement;
      const candidates = new Set();
      [link, ...(row ? row.querySelectorAll('td, th, a') : [])].forEach(el => {
        const text = norm(el.textContent);
        if (text) candidates.add(text);
      });

      groups.push({
        grupo: match[1],
        groupURL: absoluteUrl(href),
        candidates: [...candidates]
      });
    }

    const unique = new Map();
    groups.forEach(group => unique.set(`${group.grupo}|${group.groupURL}`, group));
    return [...unique.values()];
  }

  function findTicketListUrlFromCurrentPage() {
    const candidates = [...document.querySelectorAll('a[href]')]
      .map(link => ({
        href: link.getAttribute('href') || '',
        text: norm(link.textContent),
        title: norm(link.getAttribute('title'))
      }))
      .filter(item => item.href && APP.ticketListTextPattern.test(`${item.text} ${item.title}`))
      .filter(item => !APP.groupPathPattern.test(item.href))
      .map(item => absoluteUrl(item.href));

    const unique = [...new Set(candidates)];
    if (unique.length === 1) return unique[0];
    if (unique.length > 1) {
      throw new Error(`ナショナルチケット一覧リンクが複数あります: ${unique.join(' / ')}`);
    }
    return '';
  }

  async function loadTicketListDocument() {
    const currentGroups = getGroupLinksFromDocument(document);
    if (currentGroups.length) {
      localStorage.setItem(APP.ticketListUrlKey, location.href);
      verifiedTicketListCodbloq = extractCodbloq(document, document.documentElement?.outerHTML || '');
      return { doc: document, url: location.href, groups: currentGroups, source: 'current-page' };
    }

    const cachedUrl = localStorage.getItem(APP.ticketListUrlKey) || '';
    let listUrl = cachedUrl || findTicketListUrlFromCurrentPage();
    if (!listUrl) {
      throw new Error('現在のページメニューからナショナルチケット一覧リンクを一意に取得できません。');
    }

    let { text } = await requestText(listUrl, { method: 'GET', cache: 'no-store' });
    let doc = parseHtml(text);
    let groups = getGroupLinksFromDocument(doc);

    if (!groups.length && cachedUrl) {
      localStorage.removeItem(APP.ticketListUrlKey);
      listUrl = findTicketListUrlFromCurrentPage();
      if (listUrl) {
        ({ text } = await requestText(listUrl, { method: 'GET', cache: 'no-store' }));
        doc = parseHtml(text);
        groups = getGroupLinksFromDocument(doc);
      }
    }

    if (!groups.length) {
      throw new Error(`取得したページに ticket group リンクがありません: ${listUrl}`);
    }

    localStorage.setItem(APP.ticketListUrlKey, listUrl);
    verifiedTicketListCodbloq = extractCodbloq(doc, text);
    return { doc, url: listUrl, groups, source: cachedUrl ? 'cached-background-list-page' : 'background-list-page' };
  }

  async function resolveRequestedGroups(tasks) {
    const listPage = await loadTicketListDocument();
    const groups = listPage.groups;

    const resolved = new Map();
    const requestedNames = [...new Set(tasks.map(task => task.ticketName))];

    for (const ticketName of requestedNames) {
      const matches = groups.filter(group => group.candidates.some(candidate => candidate === ticketName));
      const uniqueByGrupo = [...new Map(matches.map(group => [group.grupo, group])).values()];

      if (uniqueByGrupo.length === 0) {
        throw new Error(`チケット名が完全一致しません: ${ticketName}`);
      }
      if (uniqueByGrupo.length > 1) {
        const selectedGroup = await askToSelectDuplicateGroup(ticketName, uniqueByGrupo);
        if (!selectedGroup) {
          throw new Error(`重複するチケット名の group 選択がキャンセルされました: ${ticketName}`);
        }
        resolved.set(ticketName, selectedGroup);
        continue;
      }
      resolved.set(ticketName, uniqueByGrupo[0]);
    }

    return { resolved, listPage };
  }

  function askToSelectDuplicateGroup(ticketName, groups) {
    return new Promise(resolve => {
      document.querySelector('#pwnt-group-select-modal')?.remove();

      const overlay = document.createElement('div');
      overlay.id = 'pwnt-group-select-modal';
      overlay.style.cssText = `
        position:fixed;inset:0;z-index:1000001;background:rgba(0,0,0,.72);
        display:flex;align-items:center;justify-content:center;padding:24px;
      `;

      const dialog = document.createElement('div');
      dialog.style.cssText = `
        width:min(820px,94vw);max-height:88vh;overflow:auto;background:#202020;color:#fff;
        border:2px solid #ffcc66;border-radius:12px;padding:18px;
        box-shadow:0 8px 32px rgba(0,0,0,.65);font-family:Arial,"Yu Gothic",Meiryo,sans-serif;
      `;

      const title = document.createElement('div');
      title.textContent = '同名チケットの GROUP を選択';
      title.style.cssText = 'font-size:18px;font-weight:bold;color:#ffcc66;margin-bottom:8px;';

      const message = document.createElement('div');
      message.textContent = `「${ticketName}」が複数の GROUP に完全一致しました。今回使用する GROUP を1つ選択してください。`;
      message.style.cssText = 'margin-bottom:12px;line-height:1.5;overflow-wrap:anywhere;';

      const choices = document.createElement('div');
      choices.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

      groups.forEach((group, index) => {
        const row = document.createElement('label');
        row.style.cssText = `
          display:flex;align-items:center;gap:10px;padding:10px;background:#111;
          border:1px solid #666;border-radius:6px;cursor:pointer;
        `;

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'pwnt-selected-group';
        radio.value = String(index);

        const grupo = document.createElement('strong');
        grupo.textContent = `grupo=${group.grupo}`;
        grupo.style.cssText = 'min-width:110px;color:#fff;';

        const link = document.createElement('a');
        link.href = group.groupURL;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = group.groupURL;
        link.style.cssText = 'color:#8ecbff;overflow-wrap:anywhere;';
        link.onclick = event => event.stopPropagation();

        row.append(radio, grupo, link);
        choices.appendChild(row);
      });

      const validation = document.createElement('div');
      validation.style.cssText = 'min-height:18px;margin-top:8px;color:#ff9f9f;font-size:12px;';

      const buttons = document.createElement('div');
      buttons.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;margin-top:8px;';

      const stopButton = document.createElement('button');
      stopButton.textContent = '停止';
      stopButton.style.cssText = 'padding:10px 18px;background:#ddd;color:#222;';

      const continueButton = document.createElement('button');
      continueButton.textContent = '選択して DRY RUN を続行';
      continueButton.style.cssText = 'padding:10px 18px;background:#ffcc66;color:#111;font-weight:bold;';

      const finish = selectedGroup => {
        overlay.remove();
        resolve(selectedGroup);
      };

      stopButton.onclick = () => finish(null);
      continueButton.onclick = () => {
        const selected = choices.querySelector('input[name="pwnt-selected-group"]:checked');
        if (!selected) {
          validation.textContent = '使用する GROUP を選択してください。';
          return;
        }
        finish(groups[Number(selected.value)] || null);
      };

      buttons.append(stopButton, continueButton);
      dialog.append(title, message, choices, validation, buttons);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
    });
  }

  function extractStoreName(ticketElement) {
    const row = ticketElement.closest('tr');
    if (!row) return '';
    const cells = [...row.querySelectorAll('td, th')];
    const statusIndex = cells.findIndex(cell => norm(cell.textContent) === '未発行');
    if (statusIndex > 0) return norm(cells[statusIndex - 1].textContent);

    const table = row.closest('table');
    const headers = [...(table?.querySelectorAll('thead th') || [])].map(th => norm(th.textContent));
    const storeIndex = headers.findIndex(header => header === '店舗');
    return storeIndex >= 0 && cells[storeIndex] ? norm(cells[storeIndex].textContent) : '';
  }

  function parseGroupPage(html, expectedGrupo, selectedStoreName = '') {
    const doc = parseHtml(html);
    const codbloq = extractCodbloq(doc, html);
    const ticketIds = [];
    const eligibleTicketIds = [];
    const ticketStores = new Map();

    for (const el of doc.querySelectorAll('[data-ticket_id]')) {
      const ticketId = norm(el.getAttribute('data-ticket_id'));
      const grupo = norm(el.getAttribute('data-grupo'));
      const href = norm(el.getAttribute('href'));
      const text = norm(el.textContent);
      const looksUnissued = href.includes('modal_emitir_ticket') || text === '発行';

      if (ticketId && looksUnissued && (!grupo || grupo === String(expectedGrupo))) {
        ticketIds.push(ticketId);
        const store = extractStoreName(el) || 'UNKNOWN';
        const previousStore = ticketStores.get(ticketId);
        if (!previousStore || previousStore === 'UNKNOWN') ticketStores.set(ticketId, store);
        if (selectedStoreName && store === selectedStoreName) eligibleTicketIds.push(ticketId);
      }
    }

    const uniqueTicketIds = [...new Set(ticketIds)];
    const uniqueEligibleTicketIds = [...new Set(eligibleTicketIds)];
    const storeCounts = new Map();
    uniqueTicketIds.forEach(ticketId => {
      const store = ticketStores.get(ticketId) || 'UNKNOWN';
      storeCounts.set(store, (storeCounts.get(store) || 0) + 1);
    });

    return {
      codbloq,
      // ticketIds はPOST後確認用の全未発行在庫。店舗フィルタをかけない。
      ticketIds: uniqueTicketIds,
      // 正式付与へ分配できるのはUIで選択した単一店舗の未発行在庫だけ。
      eligibleTicketIds: uniqueEligibleTicketIds,
      ticketStores,
      diagnostics: {
        title: norm(doc.title),
        forms: doc.querySelectorAll('form').length,
        codbloqNamedElements: doc.querySelectorAll('[name="codbloq"]').length,
        emitirButtons: doc.querySelectorAll('[data-ticket_id]').length,
        unissuedTicketIds: uniqueTicketIds.length,
        selectedStoreName,
        eligibleSelectedStoreTicketIds: uniqueEligibleTicketIds.length,
        storeCounts: Object.fromEntries(storeCounts),
        htmlLength: String(html || '').length
      }
    };
  }

  function extractCodbloq(doc, html) {
    const named = doc.querySelector('[name="codbloq"]');
    if (named) {
      const value = norm(named.value || named.getAttribute('value'));
      if (value) return value;
    }

    for (const el of doc.querySelectorAll('[data-codbloq], [data-cod_bloq], [codbloq]')) {
      const value = norm(
        el.getAttribute('data-codbloq') ||
        el.getAttribute('data-cod_bloq') ||
        el.getAttribute('codbloq')
      );
      if (value) return value;
    }

    const source = String(html || '');
    const patterns = [
      /name\s*=\s*["']codbloq["'][^>]*value\s*=\s*["']([^"']+)["']/i,
      /value\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']codbloq["']/i,
      /["']codbloq["']\s*:\s*["']([^"']+)["']/i,
      /["']codbloq["']\s*:\s*(\d+)/i,
      /\bcodbloq\s*=\s*["']([^"']+)["']/i,
      /\bcodbloq\s*=\s*(\d+)/i,
      /[?&]codbloq=([^&"'<>\\s]+)/i
    ];

    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match?.[1]) return decodeURIComponent(match[1]);
    }

    return '';
  }

  async function fetchGroupPage(group, requireCodbloq = true, selectedStoreName = '') {
    const { text } = await requestText(group.groupURL, { method: 'GET', cache: 'no-store' });
    const parsed = parseGroupPage(text, group.grupo, selectedStoreName);
    if (!parsed.codbloq && verifiedTicketListCodbloq) {
      parsed.codbloq = verifiedTicketListCodbloq;
      parsed.diagnostics.codbloqSource = 'verified-ticket-list-page';
    } else if (parsed.codbloq) {
      parsed.diagnostics.codbloqSource = 'group-page';
    }
    if (requireCodbloq && !parsed.codbloq) {
      throw new Error(
        `codbloq を取得できません: grupo=${group.grupo} / ` +
        `診断=${JSON.stringify(parsed.diagnostics)}`
      );
    }
    return parsed;
  }

  async function searchInternalId(gameId) {
    const searchGameId = rawToSearchGameId(gameId);
    const { text: html } = await postForm(APP.playerSearchUrl, {
      query: gameId,
      identifier: 'string'
    });
    const doc = parseHtml(html);
    const candidates = [];

    for (const el of doc.querySelectorAll('[rel], [onclick], a, li, tr, div')) {
      const rowHtml = el.outerHTML || '';
      const rowText = norm(el.innerText || el.textContent || '');
      if (!rowText.includes(searchGameId)) continue;

      const relMatch = rowHtml.match(/rel=["'][^"']*?(\d+)[^"']*?["']/);
      const painelMatch = rowHtml.match(/jogadores\/painel\/(\d+)/);
      const leadingMatch = rowText.match(/^\s*(\d+)\s*-/);
      const internalId = relMatch?.[1] || painelMatch?.[1] || leadingMatch?.[1] || '';
      if (internalId) candidates.push({ internalId, rowText });
    }

    const unique = [...new Map(candidates.map(item => [item.internalId, item])).values()];
    if (unique.length === 1) return unique[0].internalId;
    if (unique.length === 0) throw new Error(`GameID ${gameId}: 検索結果 0 件`);
    throw new Error(`GameID ${gameId}: 検索結果が不唯一 (${unique.map(x => x.internalId).join(',')})`);
  }

  function askToSkipGameIdErrors(gameIdErrors, tasks) {
    const errorLines = [...gameIdErrors.entries()].map(([gameId, error]) => {
      const lineNumbers = tasks
        .filter(task => task.gameId === gameId)
        .map(task => task.lineNo)
        .join(',');
      return `行 ${lineNumbers} / GameID ${gameId} / ${error}`;
    });

    return new Promise(resolve => {
      document.querySelector('#pwnt-gameid-error-modal')?.remove();
      const overlay = document.createElement('div');
      overlay.id = 'pwnt-gameid-error-modal';
      overlay.style.cssText = `
        position:fixed;inset:0;z-index:1000001;background:rgba(0,0,0,.72);
        display:flex;align-items:center;justify-content:center;padding:24px;
      `;

      const dialog = document.createElement('div');
      dialog.style.cssText = `
        width:min(900px,94vw);max-height:88vh;overflow:auto;background:#202020;color:#fff;
        border:2px solid #ffcc66;border-radius:12px;padding:18px;
        box-shadow:0 8px 32px rgba(0,0,0,.65);font-family:Arial,"Yu Gothic",Meiryo,sans-serif;
      `;

      const title = document.createElement('div');
      title.textContent = `GameID検索エラー: ${gameIdErrors.size}人`;
      title.style.cssText = 'font-size:18px;font-weight:bold;color:#ffcc66;margin-bottom:8px;';

      const message = document.createElement('div');
      message.textContent = '以下の人をスキップして、見つかった人だけでDRY RUNを続行しますか？';
      message.style.cssText = 'margin-bottom:10px;';

      const details = document.createElement('textarea');
      details.readOnly = true;
      details.value = errorLines.join('\n');
      details.style.cssText = `
        width:100%;box-sizing:border-box;height:min(420px,52vh);background:#111;color:#fff;
        border:1px solid #666;padding:10px;font-family:Consolas,"Yu Gothic",monospace;font-size:12px;
      `;

      const buttons = document.createElement('div');
      buttons.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;margin-top:14px;';
      const stopButton = document.createElement('button');
      stopButton.textContent = '停止して入力を修正';
      stopButton.style.cssText = 'padding:10px 18px;background:#ddd;color:#222;';
      const skipButton = document.createElement('button');
      skipButton.textContent = 'スキップして続行';
      skipButton.style.cssText = 'padding:10px 18px;background:#ff9f43;color:#111;font-weight:bold;';

      const finish = decision => {
        overlay.remove();
        resolve(decision);
      };
      stopButton.onclick = () => finish(false);
      skipButton.onclick = () => finish(true);

      buttons.append(stopButton, skipButton);
      dialog.append(title, message, details, buttons);
      overlay.append(dialog);
      document.body.append(overlay);
    });
  }

  async function dryRun() {
    if (state.running) return;
    state = freshState();
    state.running = true;
    updateButtons();

    try {
      const input = document.querySelector('#pwnt-input')?.value || '';
      const selectedStoreName = norm(document.querySelector('#pwnt-store-name')?.value);
      if (!selectedStoreName) throw new Error('発行店舗名を入力してください。');
      localStorage.setItem(APP.inputKey, input);
      const tasks = parseInput(input);
      state.tasks = tasks;
      setStatus('DRY RUN: ナショナルチケット一覧を確認中');
      const { resolved: groupMap, listPage } = await resolveRequestedGroups(tasks);
      setStatus(`DRY RUN: 一覧取得成功 (${listPage.source})`);
      const inventoryMap = new Map();

      const neededNames = [...new Set(tasks.map(task => task.ticketName))];
      for (let i = 0; i < neededNames.length; i++) {
        const name = neededNames[i];
        setStatus(`DRY RUN: group 読取 ${i + 1}/${neededNames.length}`);
        const group = groupMap.get(name);
        inventoryMap.set(name, await fetchGroupPage(group, true, selectedStoreName));
      }

      const inventorySummary = neededNames.map(name => {
        const diagnostics = inventoryMap.get(name).diagnostics;
        return `${name}: 選択店舗=${selectedStoreName}, ` +
          `使用可能=${diagnostics.eligibleSelectedStoreTicketIds}, ` +
          `店舗別=${JSON.stringify(diagnostics.storeCounts)}`;
      }).join('\n');

      const playerMap = new Map();
      const gameIdResolution = new Map();
      const gameIdErrors = new Map();
      const gameIds = [...new Set(tasks.map(task => task.gameId))];
      for (let i = 0; i < gameIds.length; i++) {
        const originalGameId = gameIds[i];
        setStatus(`DRY RUN: GameID 検索 ${i + 1}/${gameIds.length} / ${originalGameId}`);
        try {
          const internalId = await searchInternalId(originalGameId);
          playerMap.set(originalGameId, internalId);
          gameIdResolution.set(originalGameId, originalGameId);
        } catch (error) {
          gameIdErrors.set(originalGameId, error.message || String(error));
        }
      }

      if (gameIdErrors.size) {
        const shouldSkip = await askToSkipGameIdErrors(gameIdErrors, tasks);
        if (!shouldSkip) {
          tasks.forEach(task => {
            const error = gameIdErrors.get(task.gameId);
            task.status = error ? 'ERROR' : 'PLAYER_OK';
            task.error = error || '他のGameIDエラーによりDRY RUN全体を停止';
          });
          throw new Error(`GameID検索エラー ${gameIdErrors.size}人。入力TSVを修正してください。`);
        }
        gameIdErrors.forEach((error, gameId) => gameIdResolution.set(gameId, null));
      }

      const neededCounts = new Map();
      tasks.forEach(task => {
        if (gameIdResolution.get(task.gameId) === null) return;
        neededCounts.set(task.ticketName, (neededCounts.get(task.ticketName) || 0) + 1);
      });
      neededCounts.forEach((count, name) => {
        const inventory = inventoryMap.get(name);
        const stock = inventory?.eligibleTicketIds.length || 0;
        if (stock < count) {
          throw new Error(
            `選択店舗の未発行 ticket_id 数量不足: ${name} / 店舗=${selectedStoreName} / ` +
            `必要=${count} / 在庫=${stock} / 店舗別=${JSON.stringify(inventory?.diagnostics.storeCounts || {})}`
          );
        }
      });

      const inventoryCursor = new Map();
      const assignedIds = new Set();
      tasks.forEach(task => {
        const resolvedGameId = gameIdResolution.get(task.gameId);
        if (resolvedGameId === null) {
          task.status = 'SKIPPED';
          task.error = `${gameIdErrors.get(task.gameId)} / ユーザー確認によりスキップ`;
          return;
        }
        const group = groupMap.get(task.ticketName);
        const inventory = inventoryMap.get(task.ticketName);
        const cursor = inventoryCursor.get(task.ticketName) || 0;
        const ticketId = inventory.eligibleTicketIds[cursor];

        if (!ticketId || assignedIds.has(ticketId)) {
          throw new Error(`ticket_id 分配失敗または重複: ${task.ticketName}`);
        }

        assignedIds.add(ticketId);
        inventoryCursor.set(task.ticketName, cursor + 1);
        task.gameId = resolvedGameId;
        task.grupo = group.grupo;
        task.groupURL = group.groupURL;
        task.idJogador = playerMap.get(resolvedGameId);
        task.ticketId = ticketId;
        task.store = inventory.ticketStores.get(ticketId) || '';
        task.codbloq = inventory.codbloq;
        task.status = 'OK';

        if (state.completedTaskKeys.has(taskKey(task))) {
          throw new Error(`同一セッションで実行済みのタスクです: ${taskKey(task)}`);
        }
      });

      state.dryRunOk = true;
      savePreview();
      renderPreview();
      const skippedCount = tasks.filter(task => task.status === 'SKIPPED').length;
      setStatus(
        `DRY RUN 成功: 付与対象=${tasks.length - skippedCount}件 / ` +
        `SKIPPED=${skippedCount}件。POST は実行していません。\n` +
        `バックグラウンド取得在庫:\n${inventorySummary}`
      );
    } catch (error) {
      state.dryRunOk = false;
      state.tasks.forEach(task => {
        if (task.status === '未検証') {
          task.status = 'ERROR';
          task.error = error.message || String(error);
        }
      });
      savePreview();
      renderPreview();
      setStatus(`DRY RUN 停止: ${error.message || error}`, true);
      alert(`DRY RUN ERROR\n\n${error.message || error}`);
    } finally {
      state.running = false;
      updateButtons();
    }
  }

  async function verifyTicketEmitted(task) {
    let successfulReads = 0;
    let lastError = '';

    for (let attempt = 1; attempt <= APP.verifyAttempts; attempt++) {
      await sleep(APP.verifyDelayMs);
      try {
        const current = await fetchGroupPage({ grupo: task.grupo, groupURL: task.groupURL }, false);
        successfulReads++;
        if (!current.ticketIds.includes(task.ticketId)) {
          return { status: 'EMITTED', attempts: attempt, error: '' };
        }
      } catch (error) {
        lastError = error.message || String(error);
      }
    }

    if (successfulReads > 0) {
      return { status: 'STILL_UNISSUED', attempts: APP.verifyAttempts, error: '' };
    }
    return { status: 'UNKNOWN', attempts: APP.verifyAttempts, error: lastError || 'groupページを確認できません' };
  }

  async function verifyTicketRecipient(task) {
    const { text } = await postForm(APP.ticketHistoryUrl, {
      ticket_id: task.ticketId
    });
    const doc = parseHtml(text);
    const historyText = norm(doc.body?.textContent || text);
    const formattedGameId = rawToSearchGameId(task.gameId);

    if (!historyText.includes(formattedGameId) && !historyText.includes(task.gameId)) {
      throw new Error(
        `ticket_id は発行済みですが、履歴で対象GameIDを確認できません: ` +
        `ticket_id=${task.ticketId} / expected=${formattedGameId}`
      );
    }

    if (!/発行済み|排出票|排出量|emitido/i.test(historyText)) {
      throw new Error(
        `ticket_id 履歴に発行済み信号がありません: ticket_id=${task.ticketId}`
      );
    }

    return historyText.slice(0, 500);
  }

  function responseSummary(text) {
    return norm(text).slice(0, 500);
  }

  function classifyPostResponse(text) {
    const summary = responseSummary(text);
    if (!summary) return { status: 'UNKNOWN', summary: '(empty response)' };

    try {
      const json = JSON.parse(text);
      const status = norm(json.status || json.result || '').toLowerCase();
      if (json.success === true || json.ok === true || ['ok', 'success', 'sucesso'].includes(status)) {
        return { status: 'SUCCESS_SIGNAL', summary };
      }
      if (json.success === false || json.ok === false || status) {
        return { status: 'ERROR_SIGNAL', summary };
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        // Continue with strict text recognition.
      } else {
        return { status: 'ERROR_SIGNAL', summary: `${error.message || error} / ${summary}` };
      }
    }

    const lower = summary.toLowerCase();
    if (/(erro|error|falha|failed|invalid|não foi|nao foi|失敗|エラー)/i.test(lower)) {
      return { status: 'ERROR_SIGNAL', summary };
    }
    if (/(sucesso|success|emitido|発行しました|発行完了)/i.test(lower)) {
      return { status: 'SUCCESS_SIGNAL', summary };
    }

    return { status: 'UNKNOWN_HTML_OR_TEXT', summary };
  }

  async function emitOne(task, resultLabel) {
    const key = taskKey(task);
    if (state.completedTaskKeys.has(key)) {
      throw new Error(`タスク重複実行を検出: ${key}`);
    }
    if (state.emittedTicketIds.has(task.ticketId)) {
      throw new Error(`ticket_id 重複実行を検出: ${task.ticketId}`);
    }

    const fresh = await fetchGroupPage(
      { grupo: task.grupo, groupURL: task.groupURL },
      true,
      task.store
    );
    if (!fresh.eligibleTicketIds.includes(task.ticketId)) {
      const currentStore = fresh.ticketStores.get(task.ticketId) || '未発行在庫なし';
      throw new Error(
        `付与直前確認で ticket_id が選択店舗の未発行在庫にありません: ` +
        `${task.ticketId} / 選択店舗=${task.store} / 現在店舗=${currentStore}`
      );
    }

    // POSTを開始した時点で二重実行防止台帳へ記録する。結果不明でも同じタスクを再試行しない。
    state.emittedTicketIds.add(task.ticketId);
    state.completedTaskKeys.add(key);
    saveLedger();

    let responseResult;
    try {
      const { text } = await postForm(APP.emitUrl, {
        id_jogador: task.idJogador,
        codbloq: fresh.codbloq,
        ticket_id: task.ticketId,
        grupo: task.grupo
      });
      responseResult = classifyPostResponse(text);
    } catch (error) {
      responseResult = {
        status: 'POST_EXCEPTION',
        summary: error.message || String(error)
      };
    }

    task.postResultStatus = responseResult.status;
    task.postResultSummary = responseResult.summary;
    task.auditResult = '';
    task.status = responseResult.status === 'POST_EXCEPTION'
      ? 'POST例外・監査待ち'
      : `${resultLabel}_POST完了`;
    task.error = '';

    appendLog(task, task.status, `${responseResult.status} / ${responseResult.summary}`);
    savePreview();
    renderPreview();
  }

  async function auditOne(task) {
    const verification = await verifyTicketEmitted(task);
    if (verification.status === 'STILL_UNISSUED') {
      task.status = '監査NG';
      task.auditResult = 'STILL_UNISSUED';
      task.error =
        `POST後も ticket_id が未発行在庫に残っています: ${task.ticketId} / ` +
        `response=${task.postResultStatus}: ${task.postResultSummary}`;
      appendLog(task, 'AUDIT_STILL_UNISSUED', `attempts=${verification.attempts} / ${task.error}`);
      return { ok: false, result: 'STILL_UNISSUED' };
    }
    if (verification.status === 'UNKNOWN') {
      task.status = '監査NG';
      task.auditResult = 'UNKNOWN';
      task.error =
        `POST後の ticket_id 状態を確認できません: ${task.ticketId} / ` +
        `確認エラー=${verification.error} / response=${task.postResultStatus}: ${task.postResultSummary}`;
      appendLog(task, 'AUDIT_UNKNOWN', `attempts=${verification.attempts} / ${task.error}`);
      return { ok: false, result: 'UNKNOWN' };
    }

    const recipientHistory = await verifyTicketRecipient(task);
    task.status = task.postResultStatus === 'POST_EXCEPTION'
      ? '監査OK(POST例外後確認)'
      : '監査OK';
    task.auditResult = 'OK';
    task.error = '';

    appendLog(
      task,
      task.status,
      `${task.postResultStatus} / ticket_id消失+受取GameID履歴確認 attempts=${verification.attempts} / ` +
      `${task.postResultSummary} / history=${recipientHistory}`
    );
    return { ok: true, result: 'OK' };
  }

  async function auditPostedTasks(tasks) {
    let ok = 0;
    let errors = 0;

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      setStatus(`最終監査 ${i + 1}/${tasks.length}: 行 ${task.lineNo}`);
      try {
        const result = await auditOne(task);
        if (result.ok) ok++;
        else errors++;
      } catch (error) {
        task.status = '監査NG';
        task.auditResult = 'ERROR';
        task.error = error.message || String(error);
        appendLog(task, 'AUDIT_ERROR', task.error);
        errors++;
      }
      savePreview();
      renderPreview();
    }

    return { ok, errors };
  }

  function appendLog(task, result, response) {
    state.logs.push({
      行: task.lineNo,
      GameID: task.gameId,
      チケット名: task.ticketName,
      店舗: task.store,
      grupo: task.grupo,
      ticket_id: task.ticketId,
      id_jogador: task.idJogador,
      結果: result,
      時刻: nowText(),
      response
    });
    saveLog();
    renderLog();
  }

  async function runAll() {
    if (state.running || !state.dryRunOk) return;
    const remaining = state.tasks.filter(task => task.status === 'OK');
    const skipped = state.tasks.filter(task => task.status === 'SKIPPED');

    if (!remaining.length) {
      alert('残りの付与タスクはありません。');
      return;
    }

    if (!confirm(
      `正式付与を開始します。\n\n` +
      `発行店舗: ${remaining[0].store}\n` +
      `付与予定: ${remaining.length}件\n` +
      `スキップ: ${skipped.length}件${skipped.length ? ` / GameID=${[...new Set(skipped.map(task => task.gameId))].join(',')}` : ''}\n` +
      `間隔: ${APP.minDelayMs}-${APP.maxDelayMs}ms\n\n` +
      `発行前の ticket_id 確認は逐件行います。発行後の監査は最後にまとめて実行します。実行しますか？`
    )) return;

    state.running = true;
    updateButtons();
    try {
      for (let i = 0; i < remaining.length; i++) {
        const task = remaining[i];
        setStatus(`正式付与 ${i + 1}/${remaining.length}: 行 ${task.lineNo}`);
        await emitOne(task, 'OK');
        if (i < remaining.length - 1) {
          const delay = Math.floor(APP.minDelayMs + Math.random() * (APP.maxDelayMs - APP.minDelayMs + 1));
          await sleep(delay);
        }
      }
      setStatus(`正式付与POST完了: ${remaining.length} 件。最終監査を開始します。`);
      const auditSummary = await auditPostedTasks(remaining);
      setStatus(`正式付与+最終監査完了: 監査OK=${auditSummary.ok} / 監査NG=${auditSummary.errors}`);
      alert(
        `正式付与と最終監査が完了しました。\n\n` +
        `POST対象: ${remaining.length}件\n` +
        `監査OK: ${auditSummary.ok}件\n` +
        `監査NG: ${auditSummary.errors}件`
      );
    } catch (error) {
      const task = remaining.find(item =>
        item.status === 'OK' ||
        item.status === 'OK_POST完了' ||
        item.status === 'POST例外・監査待ち'
      );
      if (task) {
        task.status = 'ERROR';
        task.error = error.message || String(error);
        appendLog(task, 'ERROR_STOP', task.error);
      }
      setStatus(`正式付与失敗・即時停止: ${error.message || error}`, true);
      alert(`正式付与を即時停止しました。\n\n${error.message || error}`);
    } finally {
      state.running = false;
      savePreview();
      renderPreview();
      updateButtons();
    }
  }

  function previewRows() {
    return state.tasks.map(task => ({
      行: task.lineNo,
      GameID: task.gameId,
      チケット名: task.ticketName,
      店舗: task.store,
      grupo: task.grupo,
      groupURL: task.groupURL,
      id_jogador: task.idJogador,
      '使用予定 ticket_id': task.ticketId,
      ステータス: task.status,
      エラー理由: task.error
    }));
  }

  function savePreview() {
    localStorage.setItem(APP.previewKey, toTsv(previewRows(), PREVIEW_HEADERS));
  }

  function saveLog() {
    localStorage.setItem(APP.logKey, toTsv(state.logs, LOG_HEADERS));
  }

  function renderPreview() {
    const el = document.querySelector('#pwnt-preview');
    if (el) el.value = toTsv(previewRows(), PREVIEW_HEADERS);
  }

  function renderLog() {
    const el = document.querySelector('#pwnt-log');
    if (el) el.value = toTsv(state.logs, LOG_HEADERS);
  }

  function updateButtons() {
    const dry = document.querySelector('#pwnt-dry-run');
    const all = document.querySelector('#pwnt-run-all');
    if (dry) dry.disabled = state.running;
    if (all) all.disabled = state.running || !state.dryRunOk;
  }

  function readTsv() {
    try {
      const input = document.querySelector('#pwnt-input')?.value || '';
      const tasks = parseInput(input);
      localStorage.setItem(APP.inputKey, input);
      state = freshState();
      state.tasks = tasks;
      renderPreview();
      renderLog();
      updateButtons();
      setStatus(`TSV 読取成功: ${tasks.length} 件。次に DRY RUN を実行してください。`);
    } catch (error) {
      setStatus(`TSV 読取失敗: ${error.message || error}`, true);
      alert(error.message || error);
    }
  }

  function invalidatePreparedState() {
    if (!state.dryRunOk) return;
    state = freshState();
    renderPreview();
    renderLog();
    updateButtons();
    setStatus('入力TSVが変更されました。以前のDRY RUN結果は無効です。再度DRY RUNを実行してください。', true);
  }

  function outputLog() {
    const tsv = toTsv(state.logs, LOG_HEADERS);
    copyText(tsv);
    const el = document.querySelector('#pwnt-log');
    if (el) el.value = tsv;
    setStatus(`ログTSVをコピーしました: ${state.logs.length} 件`);
  }

  function addPanel() {
    if (document.querySelector('#pwnt-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'pwnt-panel';
    panel.style.cssText = `
      position:fixed;right:16px;bottom:16px;z-index:999999;width:900px;max-height:94vh;
      overflow:hidden;display:flex;flex-direction:column;padding:12px;background:rgba(25,25,25,.97);
      color:#fff;border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.4);
      font-family:Arial,"Yu Gothic",Meiryo,sans-serif;font-size:13px;
    `;

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <strong>PW ナショナルチケット一括付与 正式版 v1.3.4</strong>
        <div><button id="pwnt-min">Min</button> <button id="pwnt-close">x</button></div>
      </div>
      <div id="pwnt-body" style="overflow:auto;margin-top:8px;">
        <div style="font-size:11px;color:#f6d365;line-height:1.45;margin-bottom:8px;">
          任意のPokerWeb管理画面で使用できます。チケット一覧はバックグラウンドで取得します。正式付与はDRY RUN成功後に有効になります。
        </div>
        <div style="font-weight:bold;">発行店舗名（この店舗だけを使用）</div>
        <input id="pwnt-store-name" type="text" value="${APP.defaultStoreName}" style="width:100%;box-sizing:border-box;margin:4px 0 8px;background:#111;color:#fff;border:1px solid #555;padding:7px;">
        <div style="font-weight:bold;">入力TSV: GameID+チケット名 / Game ID+付与内容+枚数</div>
        <textarea id="pwnt-input" style="width:100%;box-sizing:border-box;height:115px;background:#111;color:#fff;border:1px solid #555;padding:8px;font-family:Consolas,monospace;"></textarea>
        <div style="display:flex;gap:6px;margin-top:8px;">
          <button id="pwnt-read" style="flex:1;padding:8px;background:#eee;">TSV読取</button>
          <button id="pwnt-dry-run" style="flex:1;padding:8px;background:#ffe08a;">検証・プレビュー / DRY RUN</button>
          <button id="pwnt-run-all" style="flex:1;padding:8px;background:#ff7675;color:#fff;font-weight:bold;">正式付与</button>
          <button id="pwnt-output-log" style="flex:1;padding:8px;background:#bff0c2;">ログ出力</button>
        </div>
        <div style="font-weight:bold;margin-top:8px;">プレビュー表</div>
        <textarea id="pwnt-preview" readonly style="width:100%;box-sizing:border-box;height:190px;background:#111;color:#fff;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:11px;"></textarea>
        <div style="font-weight:bold;margin-top:8px;">付与ログ TSV</div>
        <textarea id="pwnt-log" readonly style="width:100%;box-sizing:border-box;height:130px;background:#111;color:#9fe;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:11px;"></textarea>
        <div id="pwnt-status" style="font-size:11px;color:#9fe;white-space:pre-wrap;margin-top:8px;">ready</div>
      </div>
    `;

    document.body.appendChild(panel);
    document.querySelector('#pwnt-input').value = localStorage.getItem(APP.inputKey) || 'GameID\tチケット名\n';
    document.querySelector('#pwnt-preview').value = localStorage.getItem(APP.previewKey) || PREVIEW_HEADERS.join('\t');
    document.querySelector('#pwnt-log').value = localStorage.getItem(APP.logKey) || LOG_HEADERS.join('\t');

    document.querySelector('#pwnt-read').onclick = readTsv;
    document.querySelector('#pwnt-input').addEventListener('input', invalidatePreparedState);
    document.querySelector('#pwnt-store-name').addEventListener('input', invalidatePreparedState);
    document.querySelector('#pwnt-dry-run').onclick = dryRun;
    document.querySelector('#pwnt-run-all').onclick = runAll;
    document.querySelector('#pwnt-output-log').onclick = outputLog;
    document.querySelector('#pwnt-min').onclick = () => {
      const body = document.querySelector('#pwnt-body');
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
    };
    document.querySelector('#pwnt-close').onclick = () => panel.remove();
    updateButtons();
  }

  function boot() {
    addPanel();
    window.PWNationalTicketBatch = {
      parseInput,
      getGroupLinksFromDocument,
      findTicketListUrlFromCurrentPage,
      loadTicketListDocument,
      parseGroupPage,
      searchInternalId,
      dryRun,
      runAll
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
