// ==UserScript==
// @name         PW ナショナルチケット批量付与 安全確認版 v1.0
// @namespace    pw-national-ticket-batch-safe
// @version      1.0.2
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-national-ticket-batch.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-national-ticket-batch.user.js
// @description  GameID・チケット名TSVを厳密検証し、DRY RUN・1件テスト後にナショナルチケットを一件ずつ付与する安全確認版
// @author       xhpc007 + Codex
// @match        https://japanopt.pokerweb.com.br/cb/*
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
    emitUrl: '/cb/vagas/emitir_ticket',
    playerSearchUrl: '/cb/jogadores/search',
    groupPathPattern: /\/painel_grupo_tickets\/(\d+)/,
    minDelayMs: 800,
    maxDelayMs: 1500,
    verifyAttempts: 3,
    verifyDelayMs: 650
  };

  const PREVIEW_HEADERS = [
    '行号', 'GameID', 'チケット名', 'grupo', 'groupURL',
    'id_jogador', '准备使用的 ticket_id', '状态', '错误理由'
  ];

  const LOG_HEADERS = [
    '行号', 'GameID', 'チケット名', 'grupo', 'ticket_id',
    'id_jogador', '結果', '時刻', 'response'
  ];

  let state = freshState();

  function freshState() {
    const ledger = loadLedger();
    return {
      running: false,
      dryRunOk: false,
      testOk: false,
      tasks: [],
      logs: loadStoredLogs(),
      emittedTicketIds: new Set(ledger.emittedTicketIds),
      completedTaskKeys: new Set(ledger.completedTaskKeys)
    };
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function norm(value) {
    return String(value ?? '')
      .replace(/\uFEFF/g, '')
      .replace(/\u3000/g, ' ')
      .replace(/\u00a0/g, ' ')
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

  function parseInput(raw) {
    const lines = String(raw || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map(line => line.replace(/\uFEFF/g, ''))
      .filter(line => norm(line));

    if (!lines.length) throw new Error('TSV が空です。');

    const headers = lines[0].split('\t').map(norm);
    const gameIndex = headers.indexOf('GameID');
    const ticketIndex = headers.indexOf('チケット名');

    if (gameIndex < 0 || ticketIndex < 0) {
      throw new Error('表頭は GameID[TAB]チケット名 の2列が必要です。');
    }

    const tasks = [];
    const errors = [];

    lines.slice(1).forEach((line, index) => {
      const cols = line.split('\t');
      const lineNo = index + 2;
      const gameId = normalizeGameId(cols[gameIndex]);
      const ticketName = norm(cols[ticketIndex]);

      if (!gameId || !ticketName) {
        errors.push(`${lineNo}行目: GameID または チケット名 が不正です。`);
        return;
      }

      tasks.push({
        lineNo,
        gameId,
        ticketName,
        grupo: '',
        groupURL: '',
        idJogador: '',
        ticketId: '',
        codbloq: '',
        status: '未验证',
        error: ''
      });
    });

    if (errors.length) throw new Error(errors.join('\n'));
    if (!tasks.length) throw new Error('付与タスクがありません。');
    return tasks;
  }

  function getGroupLinksFromListPage() {
    const links = [...document.querySelectorAll('a[href]')];
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

  function resolveRequestedGroups(tasks) {
    const groups = getGroupLinksFromListPage();
    if (!groups.length) {
      throw new Error('このページから painel_grupo_tickets/{grupo} リンクを取得できません。ナショナルチケット一覧ページで実行してください。');
    }

    const resolved = new Map();
    const requestedNames = [...new Set(tasks.map(task => task.ticketName))];

    requestedNames.forEach(ticketName => {
      const matches = groups.filter(group => group.candidates.some(candidate => candidate === ticketName));
      const uniqueByGrupo = [...new Map(matches.map(group => [group.grupo, group])).values()];

      if (uniqueByGrupo.length === 0) {
        throw new Error(`チケット名が完全一致しません: ${ticketName}`);
      }
      if (uniqueByGrupo.length > 1) {
        throw new Error(`チケット名が複数 group に完全一致しました: ${ticketName} / grupos=${uniqueByGrupo.map(x => x.grupo).join(',')}`);
      }
      resolved.set(ticketName, uniqueByGrupo[0]);
    });

    return resolved;
  }

  function parseGroupPage(html, expectedGrupo) {
    const doc = parseHtml(html);
    const codbloq = extractCodbloq(doc, html);
    const ticketIds = [];

    for (const el of doc.querySelectorAll('[data-ticket_id]')) {
      const ticketId = norm(el.getAttribute('data-ticket_id'));
      const grupo = norm(el.getAttribute('data-grupo'));
      const href = norm(el.getAttribute('href'));
      const text = norm(el.textContent);
      const looksUnissued = href.includes('modal_emitir_ticket') || text === '発行';

      if (ticketId && looksUnissued && (!grupo || grupo === String(expectedGrupo))) {
        ticketIds.push(ticketId);
      }
    }

    return {
      codbloq,
      ticketIds: [...new Set(ticketIds)],
      diagnostics: {
        title: norm(doc.title),
        forms: doc.querySelectorAll('form').length,
        codbloqNamedElements: doc.querySelectorAll('[name="codbloq"]').length,
        emitirButtons: doc.querySelectorAll('[data-ticket_id]').length,
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

  async function fetchGroupPage(group, requireCodbloq = true) {
    const { text } = await requestText(group.groupURL, { method: 'GET', cache: 'no-store' });
    const parsed = parseGroupPage(text, group.grupo);
    if (!parsed.codbloq) {
      parsed.codbloq = extractCodbloq(document, document.documentElement?.outerHTML || '');
      if (parsed.codbloq) parsed.diagnostics.codbloqSource = 'current-list-page';
    } else {
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

  async function dryRun() {
    if (state.running) return;
    state = freshState();
    state.running = true;
    updateButtons();

    try {
      const input = document.querySelector('#pwnt-input')?.value || '';
      localStorage.setItem(APP.inputKey, input);
      const tasks = parseInput(input);
      state.tasks = tasks;
      const groupMap = resolveRequestedGroups(tasks);
      const inventoryMap = new Map();

      const neededNames = [...new Set(tasks.map(task => task.ticketName))];
      for (let i = 0; i < neededNames.length; i++) {
        const name = neededNames[i];
        setStatus(`DRY RUN: group 読取 ${i + 1}/${neededNames.length}`);
        const group = groupMap.get(name);
        inventoryMap.set(name, await fetchGroupPage(group));
      }

      const neededCounts = new Map();
      tasks.forEach(task => neededCounts.set(task.ticketName, (neededCounts.get(task.ticketName) || 0) + 1));
      neededCounts.forEach((count, name) => {
        const stock = inventoryMap.get(name)?.ticketIds.length || 0;
        if (stock < count) throw new Error(`未発行 ticket_id 数量不足: ${name} / 必要=${count} / 在庫=${stock}`);
      });

      const playerMap = new Map();
      const gameIds = [...new Set(tasks.map(task => task.gameId))];
      for (let i = 0; i < gameIds.length; i++) {
        const gameId = gameIds[i];
        setStatus(`DRY RUN: GameID 検索 ${i + 1}/${gameIds.length} / ${gameId}`);
        playerMap.set(gameId, await searchInternalId(gameId));
      }

      const inventoryCursor = new Map();
      const assignedIds = new Set();
      tasks.forEach(task => {
        const group = groupMap.get(task.ticketName);
        const inventory = inventoryMap.get(task.ticketName);
        const cursor = inventoryCursor.get(task.ticketName) || 0;
        const ticketId = inventory.ticketIds[cursor];

        if (!ticketId || assignedIds.has(ticketId)) {
          throw new Error(`ticket_id 分配失敗または重複: ${task.ticketName}`);
        }

        assignedIds.add(ticketId);
        inventoryCursor.set(task.ticketName, cursor + 1);
        task.grupo = group.grupo;
        task.groupURL = group.groupURL;
        task.idJogador = playerMap.get(task.gameId);
        task.ticketId = ticketId;
        task.codbloq = inventory.codbloq;
        task.status = 'OK';

        if (state.completedTaskKeys.has(taskKey(task))) {
          throw new Error(`同一セッションで実行済みのタスクです: ${taskKey(task)}`);
        }
      });

      state.dryRunOk = true;
      savePreview();
      renderPreview();
      setStatus(`DRY RUN 成功: ${tasks.length} 件。POST は実行していません。`);
    } catch (error) {
      state.dryRunOk = false;
      state.tasks.forEach(task => {
        if (task.status !== 'OK') {
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
    for (let attempt = 1; attempt <= APP.verifyAttempts; attempt++) {
      await sleep(APP.verifyDelayMs);
      const current = await fetchGroupPage({ grupo: task.grupo, groupURL: task.groupURL }, false);
      if (!current.ticketIds.includes(task.ticketId)) return true;
    }
    return false;
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

    const fresh = await fetchGroupPage({ grupo: task.grupo, groupURL: task.groupURL });
    if (!fresh.ticketIds.includes(task.ticketId)) {
      throw new Error(`付与直前確認で ticket_id が未発行在庫にありません: ${task.ticketId}`);
    }

    // POSTを開始した時点で防重台帳へ記録する。結果不明でも同じタスクを再試行しない。
    state.emittedTicketIds.add(task.ticketId);
    state.completedTaskKeys.add(key);
    saveLedger();

    const { text } = await postForm(APP.emitUrl, {
      id_jogador: task.idJogador,
      codbloq: fresh.codbloq,
      ticket_id: task.ticketId,
      grupo: task.grupo
    });

    const responseResult = classifyPostResponse(text);
    const confirmed = await verifyTicketEmitted(task);
    if (!confirmed) {
      throw new Error(
        `POST後も ticket_id が未発行在庫に残っています: ${task.ticketId} / ` +
        `response=${responseResult.status}: ${responseResult.summary}`
      );
    }

    task.status = resultLabel;
    task.error = '';

    appendLog(
      task,
      resultLabel,
      `${responseResult.status} / POST後に未発行在庫から消失確認 / ${responseResult.summary}`
    );
    savePreview();
    renderPreview();
  }

  function appendLog(task, result, response) {
    state.logs.push({
      行号: task.lineNo,
      GameID: task.gameId,
      チケット名: task.ticketName,
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

  async function runTestOne() {
    if (state.running || !state.dryRunOk) return;
    if (state.testOk) {
      alert('1件テストはすでに成功しています。');
      return;
    }

    const task = state.tasks.find(item => item.status === 'OK');
    if (!task) return;

    if (!confirm(
      `1件だけ実際に付与します。\n\n` +
      `行号: ${task.lineNo}\nGameID: ${task.gameId}\n` +
      `チケット名: ${task.ticketName}\nticket_id: ${task.ticketId}\n\n実行しますか？`
    )) return;

    state.running = true;
    updateButtons();
    try {
      setStatus(`1件テスト付与中: 行号 ${task.lineNo}`);
      await emitOne(task, 'TEST_OK');
      state.testOk = true;
      setStatus('1件テスト成功。正式付与を実行できます。');
      alert('1件テストが成功しました。ログと PokerWeb の状態を確認してください。');
    } catch (error) {
      task.status = 'ERROR';
      task.error = error.message || String(error);
      appendLog(task, 'TEST_ERROR_STOP', task.error);
      setStatus(`1件テスト失敗・停止: ${task.error}`, true);
      alert(`1件テスト失敗。処理を停止しました。\n\n${task.error}`);
    } finally {
      state.running = false;
      savePreview();
      renderPreview();
      updateButtons();
    }
  }

  async function runAll() {
    if (state.running || !state.dryRunOk || !state.testOk) return;
    const remaining = state.tasks.filter(task => task.status === 'OK');

    if (!remaining.length) {
      alert('残りの付与タスクはありません。');
      return;
    }

    if (!confirm(
      `正式付与を開始します。\n\n` +
      `1件テスト成功済み: 1件\n残り: ${remaining.length}件\n\n` +
      `一件でも失敗したら即時停止します。実行しますか？`
    )) return;

    state.running = true;
    updateButtons();
    try {
      for (let i = 0; i < remaining.length; i++) {
        const task = remaining[i];
        setStatus(`正式付与 ${i + 1}/${remaining.length}: 行号 ${task.lineNo}`);
        await emitOne(task, 'OK');
        if (i < remaining.length - 1) {
          const delay = Math.floor(APP.minDelayMs + Math.random() * (APP.maxDelayMs - APP.minDelayMs + 1));
          await sleep(delay);
        }
      }
      setStatus(`正式付与完了: 残り ${remaining.length} 件`);
      alert('正式付与が完了しました。ログを確認してください。');
    } catch (error) {
      const task = remaining.find(item => item.status === 'OK');
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
      行号: task.lineNo,
      GameID: task.gameId,
      チケット名: task.ticketName,
      grupo: task.grupo,
      groupURL: task.groupURL,
      id_jogador: task.idJogador,
      '准备使用的 ticket_id': task.ticketId,
      状态: task.status,
      错误理由: task.error
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
    const test = document.querySelector('#pwnt-test-one');
    const all = document.querySelector('#pwnt-run-all');
    if (dry) dry.disabled = state.running;
    if (test) test.disabled = state.running || !state.dryRunOk || state.testOk;
    if (all) all.disabled = state.running || !state.dryRunOk || !state.testOk;
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
    if (!state.dryRunOk && !state.testOk) return;
    state = freshState();
    renderPreview();
    renderLog();
    updateButtons();
    setStatus('输入 TSV 已变更。之前的 DRY RUN / 1件测试状态已失效，请重新验证。', true);
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
        <strong>PW ナショナルチケット批量付与 安全確認版 v1.0</strong>
        <div><button id="pwnt-min">Min</button> <button id="pwnt-close">x</button></div>
      </div>
      <div id="pwnt-body" style="overflow:auto;margin-top:8px;">
        <div style="font-size:11px;color:#f6d365;line-height:1.45;margin-bottom:8px;">
          ナショナルチケット一覧ページで使用。正式付与は DRY RUN 成功 + 1件テスト成功後だけ解锁されます。
        </div>
        <div style="font-weight:bold;">输入 TSV: GameID[TAB]チケット名</div>
        <textarea id="pwnt-input" style="width:100%;box-sizing:border-box;height:115px;background:#111;color:#fff;border:1px solid #555;padding:8px;font-family:Consolas,monospace;"></textarea>
        <div style="display:flex;gap:6px;margin-top:8px;">
          <button id="pwnt-read" style="flex:1;padding:8px;background:#eee;">读取TSV</button>
          <button id="pwnt-dry-run" style="flex:1;padding:8px;background:#ffe08a;">验证・预览 / DRY RUN</button>
          <button id="pwnt-test-one" style="flex:1;padding:8px;background:#74b9ff;">只测试1件</button>
          <button id="pwnt-run-all" style="flex:1;padding:8px;background:#ff7675;color:#fff;font-weight:bold;">正式付与</button>
          <button id="pwnt-output-log" style="flex:1;padding:8px;background:#bff0c2;">ログ出力</button>
        </div>
        <div style="font-weight:bold;margin-top:8px;">预览表</div>
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
    document.querySelector('#pwnt-dry-run').onclick = dryRun;
    document.querySelector('#pwnt-test-one').onclick = runTestOne;
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
      getGroupLinksFromListPage,
      parseGroupPage,
      searchInternalId,
      dryRun,
      runTestOne,
      runAll
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
