// ==UserScript==
// @name         PW GameID DRY RUN Concurrency POC
// @namespace    pw-gameid-dry-run-concurrency-poc
// @version      0.1.1
// @description  発券せず、GameIDプレイヤー検索だけを制限並列で検証する独立テスト
// @match        https://japanopt.pokerweb.com.br/cb/*
// @match        https://formanager.pokerweb.com.br/cb/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const SEARCH_URL = '/cb/jogadores/search';
  let running = false;

  function norm(value) {
    return String(value ?? '')
      .replace(/﻿/g, '')
      .replace(/　/g, ' ')
      .replace(/ /g, ' ')
      .replace(/[ \t\r\n]+/g, ' ')
      .trim();
  }

  function normalizeHeader(value) {
    return norm(value).toLowerCase().replace(/[\s_　]+/g, '');
  }

  function normalizeGameId(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits.length === 8 ? digits : '';
  }

  function rawToSearchGameId(value) {
    const digits = normalizeGameId(value);
    return digits ? `${digits.slice(0, 4)}.${digits.slice(4)}` : '';
  }

  function parseRows(raw) {
    const lines = String(raw || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .filter(line => line.trim());
    if (lines.length < 2) throw new Error('ヘッダーを含むTSVを入力してください。');

    const headers = lines[0].split('\t');
    const normalized = headers.map(normalizeHeader);
    const gameIndex = normalized.findIndex(header => ['gameid', 'ゲームid'].includes(header));
    if (gameIndex < 0) throw new Error('GameID または Game ID 列が必要です。');

    return lines.slice(1).map((line, index) => {
      const cols = line.split('\t');
      const rawGameId = norm(cols[gameIndex]);
      return {
        lineNo: index + 2,
        rawGameId,
        gameId: normalizeGameId(rawGameId),
        original: line
      };
    });
  }

  async function postForm(url, values) {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: new URLSearchParams(values)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${norm(text).slice(0, 160)}`);
    return text;
  }

  async function searchPlayer(gameId) {
    const formattedGameId = rawToSearchGameId(gameId);
    const html = await postForm(SEARCH_URL, { query: gameId, identifier: 'string' });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const candidates = [];

    for (const el of doc.querySelectorAll('[rel], [onclick], a, li, tr, div')) {
      const rowHtml = el.outerHTML || '';
      const rowText = norm(el.innerText || el.textContent || '');
      if (!rowText.includes(formattedGameId)) continue;

      const relMatch = rowHtml.match(/rel=["'][^"']*?(\d+)[^"']*?["']/);
      const painelMatch = rowHtml.match(/jogadores\/painel\/(\d+)/);
      const leadingMatch = rowText.match(/^\s*(\d+)\s*-/);
      const internalId = relMatch?.[1] || painelMatch?.[1] || leadingMatch?.[1] || '';
      if (internalId) candidates.push({ internalId, rowText });
    }

    const unique = [...new Map(candidates.map(item => [item.internalId, item])).values()];
    if (unique.length === 1) return unique[0];
    if (unique.length === 0) throw new Error('検索結果 0 件');
    throw new Error(`検索結果が不唯一: ${unique.map(item => item.internalId).join(',')}`);
  }

  async function mapWithConcurrency(items, concurrency, worker, onProgress) {
    const results = new Array(items.length);
    let cursor = 0;
    let completed = 0;

    async function runWorker() {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        try {
          results[index] = { ok: true, value: await worker(items[index]) };
        } catch (error) {
          results[index] = { ok: false, error: error.message || String(error) };
        }
        completed++;
        onProgress(completed, items.length);
      }
    }

    const workerCount = Math.min(concurrency, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return results;
  }

  function toTsv(rows) {
    const headers = ['行', '入力GameID', '正規化GameID', '結果', 'id_jogador', '検索表示', 'エラー'];
    const clean = value => String(value ?? '').replace(/[\t\r\n]+/g, ' ');
    return [
      headers.join('\t'),
      ...rows.map(row => headers.map(header => clean(row[header])).join('\t'))
    ].join('\n');
  }

  function setStatus(text, isError = false) {
    const status = document.querySelector('#pwgid-status');
    if (!status) return;
    status.textContent = text;
    status.style.color = isError ? '#ff9f9f' : '#9fe';
  }

  async function runDryRun() {
    if (running) return;
    running = true;
    const button = document.querySelector('#pwgid-run');
    button.disabled = true;

    try {
      const rows = parseRows(document.querySelector('#pwgid-input').value);
      const concurrency = Math.max(1, Math.floor(Number(document.querySelector('#pwgid-concurrency').value) || 8));
      document.querySelector('#pwgid-concurrency').value = String(concurrency);

      const validGameIds = [...new Set(rows.filter(row => row.gameId).map(row => row.gameId))];
      const startedAt = performance.now();
      setStatus(`GameID並列検索 0/${validGameIds.length} / 並列=${concurrency}`);

      const searched = await mapWithConcurrency(
        validGameIds,
        concurrency,
        searchPlayer,
        (completed, total) => setStatus(`GameID並列検索 ${completed}/${total} / 並列=${concurrency}`)
      );
      const resultMap = new Map(validGameIds.map((gameId, index) => [gameId, searched[index]]));

      const outputRows = rows.map(row => {
        if (!row.gameId) {
          return {
            行: row.lineNo,
            入力GameID: row.rawGameId,
            正規化GameID: '',
            結果: 'INVALID',
            id_jogador: '',
            検索表示: '',
            エラー: '8桁のGameIDではありません'
          };
        }
        const result = resultMap.get(row.gameId);
        return {
          行: row.lineNo,
          入力GameID: row.rawGameId,
          正規化GameID: row.gameId,
          結果: result.ok ? 'FOUND' : 'NOT_FOUND',
          id_jogador: result.ok ? result.value.internalId : '',
          検索表示: result.ok ? result.value.rowText : '',
          エラー: result.ok ? '' : result.error
        };
      });

      const elapsedMs = Math.round(performance.now() - startedAt);
      const foundUnique = searched.filter(result => result.ok).length;
      const failedUnique = searched.length - foundUnique;
      document.querySelector('#pwgid-output').value = toTsv(outputRows);
      setStatus(
        `完了 ${elapsedMs}ms / 入力行=${rows.length} / ユニークGameID=${validGameIds.length} / ` +
        `FOUND=${foundUnique} / NOT_FOUND=${failedUnique} / 並列=${concurrency}`,
        failedUnique > 0
      );
    } catch (error) {
      setStatus(`DRY RUN失敗: ${error.message || error}`, true);
    } finally {
      running = false;
      button.disabled = false;
    }
  }

  function copyOutput() {
    const text = document.querySelector('#pwgid-output').value;
    try {
      GM_setClipboard(text, 'text');
    } catch (_) {
      navigator.clipboard?.writeText(text);
    }
    setStatus('結果TSVをコピーしました。');
  }

  function addPanel() {
    if (document.querySelector('#pwgid-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'pwgid-panel';
    panel.style.cssText = `
      position:fixed;left:16px;bottom:16px;z-index:999999;width:720px;max-height:92vh;
      overflow:auto;padding:12px;background:rgba(25,25,25,.97);color:#fff;border-radius:10px;
      box-shadow:0 4px 18px rgba(0,0,0,.4);font-family:Arial,"Yu Gothic",Meiryo,sans-serif;font-size:13px;
    `;
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong>GameID DRY RUN 並列テスト v0.1.1</strong>
        <button id="pwgid-close">x</button>
      </div>
      <div style="margin-top:8px;color:#f6d365;font-size:11px;">発券処理はありません。プレイヤー検索だけを実行します。重複行はすべて出力し、同じGameIDの検索だけを一回にまとめます。</div>
      <div style="margin-top:8px;">入力TSV（GameID / Game ID列が必要）</div>
      <textarea id="pwgid-input" style="width:100%;box-sizing:border-box;height:150px;background:#111;color:#fff;border:1px solid #555;padding:8px;font-family:Consolas,monospace;">GameID\tチケット名\n</textarea>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px;">
        <label>並列数 <input id="pwgid-concurrency" type="number" min="1" value="8" style="width:70px;"></label>
        <button id="pwgid-run" style="padding:8px 18px;background:#ffe08a;">GameID DRY RUN</button>
        <button id="pwgid-copy" style="padding:8px 18px;background:#bff0c2;">結果コピー</button>
      </div>
      <textarea id="pwgid-output" readonly style="width:100%;box-sizing:border-box;height:230px;margin-top:8px;background:#111;color:#9fe;border:1px solid #555;padding:8px;font-family:Consolas,monospace;font-size:11px;"></textarea>
      <div id="pwgid-status" style="margin-top:8px;color:#9fe;white-space:pre-wrap;">ready</div>
    `;
    document.body.appendChild(panel);
    document.querySelector('#pwgid-run').onclick = runDryRun;
    document.querySelector('#pwgid-copy').onclick = copyOutput;
    document.querySelector('#pwgid-close').onclick = () => panel.remove();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addPanel);
  else addPanel();
})();
