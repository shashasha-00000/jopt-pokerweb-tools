// ==UserScript==
// @name         PW Main Event Ticket Checker v1.1
// @namespace    pw-main-event-ticket-checker
// @version      1.1.0
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-main-event-ticket-checker.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-main-event-ticket-checker.user.js
// @description  单个GameID按票名自动解析Main Event ticket group，并区分当前持有与已使用记录。
// @author       xhpc007 + Codex
// @match        https://japanopt.pokerweb.com.br/cb/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const APP = {
    panelId: 'pw-main-event-ticket-checker',
    gameIdKey: 'PW_MAIN_EVENT_TICKET_CHECKER_GAME_ID',
    groupsKey: 'PW_MAIN_EVENT_TICKET_CHECKER_GROUPS',
    collapsedKey: 'PW_MAIN_EVENT_TICKET_CHECKER_COLLAPSED',
    delayMs: 250,
    ticketListUrl: '/cb/vagas/tickets_nacionais',
    groupPathPattern: /\/painel_grupo_tickets\/(\d+)/,
    groupUrl: grupo => `/cb/vagas/painel_grupo_tickets/${grupo}`
  };

  const DEFAULT_GROUPS = [
    'JOPT 2025 Tokyo #03 / Main Event / -2026.09.30',
    'JOPT 2026 Tokyo #01 / Main Event / -2026.11.31',
    'JOPT 2026 Grand Final / Main Event / -2027.03.31',
    'JOPT 2026 Tokyo #02 / Main Event / -2027.06.30',
    '【オンライン】JOPT 2026 Tokyo #02 / Main Event / -2026.07.20',
    '【JOPT 2025 Sapporo #02】Main Event / -2026.08.31',
    '【JOPT 2026 Sapporo #01】Main Event Ticket / -2027.01.31',
    'JOPT 2026 Sapporo #02 / Main Event / -2027.08.31',
    'JOPT 2026 Fukuoka #01 / Main Event / -2027.06.30',
    'JOPT 2025 Osaka #02 / -2026.9.30',
    'JOPT 2026 Osaka #01 / Main Event / -2027.02.28',
    'JOPT 2026 Osaka #02 / Main Event / -2027.09.30'
  ].join('\n');

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let running = false;
  let stopRequested = false;
  let lastOutput = '';

  function norm(value) {
    return String(value ?? '')
      .replace(/\uFEFF/g, '')
      .replace(/\u3000/g, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t\r\n]+/g, ' ')
      .trim();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeGameId(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits.length === 8 ? digits : '';
  }

  function playerHasGameId(playerText, gameId) {
    const formatted = `${gameId.slice(0, 4)}.${gameId.slice(4)}`;
    return norm(playerText).includes(gameId) || norm(playerText).includes(formatted);
  }

  function parseGroups(raw) {
    const groups = [];
    const seen = new Set();

    String(raw || '').split(/\r?\n/).forEach((line, index) => {
      if (!norm(line)) return;
      const cols = line.split('\t');
      const first = norm(cols[0]);
      const hasExplicitGrupo = /^\d+$/.test(first) && cols.length > 1;
      const grupo = hasExplicitGrupo ? first : '';
      const name = norm(hasExplicitGrupo ? cols.slice(1).join('\t') : line);
      if (!name) throw new Error(`票组第 ${index + 1} 行票名为空`);
      const key = grupo ? `id:${grupo}` : `name:${name}`;
      if (seen.has(key)) return;
      seen.add(key);
      groups.push({ grupo, name });
    });

    if (!groups.length) throw new Error('票组清单为空');
    return groups;
  }

  function extractAvailableGroups(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const groups = [];

    for (const link of doc.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href') || '';
      const match = href.match(APP.groupPathPattern);
      if (!match) continue;

      const row = link.closest('tr') || link.parentElement;
      const candidates = new Set();
      [link, ...(row ? row.querySelectorAll('td, th, a') : [])].forEach(element => {
        const text = norm(element.textContent);
        if (text) candidates.add(text);
      });
      groups.push({ grupo: match[1], candidates: [...candidates] });
    }

    return [...new Map(groups.map(group => [group.grupo, group])).values()];
  }

  async function resolveGroups(groups) {
    const unresolved = groups.filter(group => !group.grupo);
    if (!unresolved.length) return groups;

    setStatus(`正在按票名解析 ${unresolved.length} 个 grupo ID...`);
    const response = await fetch(APP.ticketListUrl, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`票组首页读取失败：HTTP ${response.status}`);
    const available = extractAvailableGroups(await response.text());
    if (!available.length) throw new Error('票组首页没有找到 group 链接');

    return groups.map(group => {
      if (group.grupo) return group;
      const matches = available.filter(candidate => candidate.candidates.includes(group.name));
      if (matches.length === 0) throw new Error(`票名找不到：${group.name}`);
      if (matches.length > 1) {
        throw new Error(`票名匹配到多个 grupo：${group.name} / ${matches.map(x => x.grupo).join(',')}`);
      }
      return { ...group, grupo: matches[0].grupo };
    });
  }

  function findHeaderIndex(headers, candidates, fallback) {
    const normalized = headers.map(norm);
    for (const candidate of candidates) {
      const exact = normalized.findIndex(header => header === candidate);
      if (exact >= 0) return exact;
    }
    for (const candidate of candidates) {
      const partial = normalized.findIndex(header => header.includes(candidate));
      if (partial >= 0) return partial;
    }
    return fallback;
  }

  function isUsedRecord(status, usedAt) {
    if (/使用済|used|utilizado/i.test(norm(status))) return true;
    const used = norm(usedAt);
    return Boolean(used && !/^(いいえ|no|未使用|なし|-)$/i.test(used));
  }

  function parseGroupHtml(html, group, gameId) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const table = doc.querySelector('#table-registros-tickets');
    if (!table) throw new Error('找不到 #table-registros-tickets');

    const headers = [...table.querySelectorAll('thead th')].map(th => norm(th.textContent));
    const indexes = {
      store: findHeaderIndex(headers, ['店舗', 'Loja', 'Store'], 2),
      status: findHeaderIndex(headers, ['ステータス', 'Status'], 3),
      player: findHeaderIndex(headers, ['プレイヤー', 'Jogador', 'Player'], 4),
      granted: findHeaderIndex(headers, ['付与', 'Concedido', 'Granted'], 5),
      tournament: findHeaderIndex(headers, ['トーナメント', 'Torneio', 'Tournament'], 6),
      used: findHeaderIndex(headers, ['使用済', 'Utilizado', 'Used'], 7)
    };

    const matches = [];
    for (const tr of table.querySelectorAll('tbody tr')) {
      const cells = [...tr.querySelectorAll('td')].map(td => norm(td.textContent));
      if (!cells.length || !playerHasGameId(cells[indexes.player], gameId)) continue;

      const status = cells[indexes.status] || '';
      const usedAt = cells[indexes.used] || '';
      matches.push({
        grupo: group.grupo,
        ticketName: group.name,
        store: cells[indexes.store] || '',
        status,
        player: cells[indexes.player] || '',
        grantedAt: cells[indexes.granted] || '',
        tournament: cells[indexes.tournament] || '',
        usedAt,
        category: isUsedRecord(status, usedAt) ? '已使用' : '当前持有',
        rowSignature: cells.join('|')
      });
    }
    return matches;
  }

  function dedupeMatches(matches) {
    const unique = new Map();
    matches.forEach(item => {
      const key = `${item.grupo}|${item.rowSignature}`;
      if (!unique.has(key)) unique.set(key, item);
    });
    return [...unique.values()].map(({ rowSignature, ...item }) => item);
  }

  function toTsv(gameId, matches, errors) {
    const headers = [
      'GameID', '判定', 'grupo', '票名', '状态', '玩家',
      '付与', '使用赛事', '使用済', '店舗', '错误'
    ];
    const rows = matches.map(item => [
      gameId, item.category, item.grupo, item.ticketName, item.status,
      item.player, item.grantedAt, item.tournament, item.usedAt, item.store, ''
    ]);
    errors.forEach(item => rows.push([
      gameId, '读取错误', item.grupo, item.ticketName, '', '', '', '', '', '', item.error
    ]));
    if (!rows.length) rows.push([gameId, '未发现', '', '', '', '', '', '', '', '', '']);
    return [headers, ...rows]
      .map(row => row.map(value => norm(value).replace(/\t/g, ' ')).join('\t'))
      .join('\n');
  }

  function setStatus(message, isError = false) {
    const element = document.querySelector('#pwmet-status');
    if (!element) return;
    element.textContent = message;
    element.style.color = isError ? '#ffaaaa' : '#aee8ff';
  }

  function renderResults(gameId, matches, errors) {
    const current = matches.filter(item => item.category === '当前持有');
    const used = matches.filter(item => item.category === '已使用');
    const box = document.querySelector('#pwmet-results');
    if (!box) return;

    const resultRows = matches.map(item => `
      <tr>
        <td>${escapeHtml(item.category)}</td>
        <td>${escapeHtml(item.ticketName)}</td>
        <td>${escapeHtml(item.status)}</td>
        <td>${escapeHtml(item.grantedAt)}</td>
        <td>${escapeHtml(item.usedAt)}</td>
      </tr>
    `).join('');

    box.innerHTML = `
      <div style="font-weight:bold;color:${current.length ? '#8cff9a' : '#ffd27a'};">
        GameID ${escapeHtml(gameId)}：当前持有 ${current.length} / 已使用 ${used.length}
      </div>
      ${resultRows ? `
        <div style="overflow:auto;max-height:220px;margin-top:6px;">
          <table style="border-collapse:collapse;width:100%;font-size:10px;">
            <thead><tr><th>判定</th><th>票名</th><th>状态</th><th>付与</th><th>使用済</th></tr></thead>
            <tbody>${resultRows}</tbody>
          </table>
        </div>
      ` : '<div style="margin-top:6px;">指定票组中没有发现该玩家。</div>'}
      ${errors.length ? `<div style="color:#ffaaaa;margin-top:6px;">读取错误 ${errors.length} 个，复制结果查看详情。</div>` : ''}
    `;
  }

  function updateButtons() {
    const query = document.querySelector('#pwmet-query');
    const stop = document.querySelector('#pwmet-stop');
    if (query) query.disabled = running;
    if (stop) stop.disabled = !running;
  }

  async function runQuery() {
    if (running) return;
    const input = document.querySelector('#pwmet-game-id');
    const groupsInput = document.querySelector('#pwmet-groups');

    try {
      const gameId = normalizeGameId(input?.value);
      if (!gameId) throw new Error('GameID 必须是8位数字');
      const groups = await resolveGroups(parseGroups(groupsInput?.value));

      localStorage.setItem(APP.gameIdKey, gameId);
      localStorage.setItem(APP.groupsKey, groupsInput.value);
      running = true;
      stopRequested = false;
      updateButtons();

      const matches = [];
      const errors = [];
      for (let i = 0; i < groups.length; i++) {
        if (stopRequested) break;
        const group = groups[i];
        setStatus(`读取 ${i + 1}/${groups.length}：${group.name}`);
        try {
          const response = await fetch(APP.groupUrl(group.grupo), {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store'
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          matches.push(...parseGroupHtml(await response.text(), group, gameId));
        } catch (error) {
          errors.push({
            grupo: group.grupo,
            ticketName: group.name,
            error: error.message || String(error)
          });
        }
        if (i < groups.length - 1) await sleep(APP.delayMs);
      }

      const uniqueMatches = dedupeMatches(matches);
      lastOutput = toTsv(gameId, uniqueMatches, errors);
      renderResults(gameId, uniqueMatches, errors);
      const currentCount = uniqueMatches.filter(item => item.category === '当前持有').length;
      const usedCount = uniqueMatches.filter(item => item.category === '已使用').length;
      setStatus(
        stopRequested
          ? `已停止：当前持有 ${currentCount} / 已使用 ${usedCount}`
          : `完成：当前持有 ${currentCount} / 已使用 ${usedCount} / 错误 ${errors.length}`,
        errors.length > 0
      );
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      running = false;
      updateButtons();
    }
  }

  function copyResults() {
    if (!lastOutput) {
      setStatus('还没有查询结果', true);
      return;
    }
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(lastOutput);
      } else {
        navigator.clipboard.writeText(lastOutput);
      }
      setStatus('结果已复制');
    } catch (error) {
      setStatus(`复制失败：${error.message || error}`, true);
    }
  }

  function setCollapsed(collapsed) {
    const body = document.querySelector('#pwmet-body');
    const button = document.querySelector('#pwmet-min');
    if (body) body.style.display = collapsed ? 'none' : 'block';
    if (button) button.textContent = collapsed ? '展开' : '最小化';
    localStorage.setItem(APP.collapsedKey, collapsed ? '1' : '0');
  }

  function installPanel() {
    if (document.getElementById(APP.panelId)) return;
    const panel = document.createElement('div');
    panel.id = APP.panelId;
    panel.style.cssText = [
      'position:fixed', 'right:12px', 'top:70px', 'z-index:999999',
      'width:440px', 'max-width:calc(100vw - 24px)', 'background:#18212b',
      'color:#fff', 'border:1px solid #587086', 'border-radius:7px',
      'box-shadow:0 5px 20px rgba(0,0,0,.4)', 'font:12px/1.4 Arial,sans-serif',
      'padding:9px'
    ].join(';');

    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;">
        <strong style="flex:1;">PW 主赛持票查询 v1.1</strong>
        <button id="pwmet-min" type="button">最小化</button>
        <button id="pwmet-close" type="button">×</button>
      </div>
      <div id="pwmet-body" style="margin-top:8px;">
        <div style="display:flex;gap:6px;align-items:center;">
          <input id="pwmet-game-id" inputmode="numeric" maxlength="8" placeholder="8位 GameID"
            style="flex:1;padding:6px;box-sizing:border-box;">
          <button id="pwmet-query" type="button">查询</button>
          <button id="pwmet-stop" type="button" disabled>停止</button>
          <button id="pwmet-copy" type="button">复制结果</button>
        </div>
        <details style="margin-top:7px;">
          <summary style="cursor:pointer;">票组设置（每行只写票名即可）</summary>
          <textarea id="pwmet-groups" spellcheck="false"
            style="width:100%;height:150px;margin-top:5px;box-sizing:border-box;font:10px/1.3 Consolas,monospace;"></textarea>
          <button id="pwmet-reset-groups" type="button" style="margin-top:4px;">恢复默认12组</button>
        </details>
        <div id="pwmet-status" style="margin-top:7px;color:#aee8ff;">只读查询，不会修改PW数据。</div>
        <div id="pwmet-results" style="margin-top:7px;"></div>
      </div>
    `;
    document.body.appendChild(panel);

    document.querySelector('#pwmet-game-id').value = localStorage.getItem(APP.gameIdKey) || '';
    document.querySelector('#pwmet-groups').value = localStorage.getItem(APP.groupsKey) || DEFAULT_GROUPS;
    document.querySelector('#pwmet-query').onclick = runQuery;
    document.querySelector('#pwmet-stop').onclick = () => {
      stopRequested = true;
      setStatus('正在停止，将在当前票组读取完成后结束。');
    };
    document.querySelector('#pwmet-copy').onclick = copyResults;
    document.querySelector('#pwmet-reset-groups').onclick = () => {
      document.querySelector('#pwmet-groups').value = DEFAULT_GROUPS;
      localStorage.setItem(APP.groupsKey, DEFAULT_GROUPS);
      setStatus('已恢复默认12组');
    };
    document.querySelector('#pwmet-min').onclick = () => {
      const collapsed = document.querySelector('#pwmet-body').style.display !== 'none';
      setCollapsed(collapsed);
    };
    document.querySelector('#pwmet-close').onclick = () => panel.remove();
    setCollapsed(localStorage.getItem(APP.collapsedKey) === '1');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installPanel, { once: true });
  } else {
    installPanel();
  }
})();
