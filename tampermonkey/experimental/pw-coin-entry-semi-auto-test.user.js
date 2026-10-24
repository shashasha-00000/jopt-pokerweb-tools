// ==UserScript==
// @name         PW Coin Entry Test
// @namespace    pw-coin-entry-test
// @version      0.1.0
// @description  TSV GAME ID / COIN; sequential real entry payments with native PW refresh.
// @match        https://japanopt.pokerweb.com.br/torneio/painel/*
// @match        https://japanopt.bt.pokerweb.com.br/torneio/painel/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function () {
  'use strict';
  const tournament = location.pathname.match(/\/torneio\/painel\/(\d+)/)?.[1];
  if (!tournament) return;
  const key = 'PW_COIN_ENTRY_TEST_V1_' + tournament;
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
  const amount = s => Number(String(s).replace(/,/g, '').trim());
  const parse = html => new DOMParser().parseFromString(html, 'text/html');
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let state;
  try { state = JSON.parse(sessionStorage.getItem(key)); } catch (_) { /* empty state */ }
  state ||= { rows: [], index: 0, results: [], active: false, pending: null };
  let busy = false;
  const panel = document.createElement('section');
  panel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:99999;width:410px;padding:12px;background:#102c40;color:white;border:2px solid #67c8ef;border-radius:8px;font:13px sans-serif;box-shadow:0 3px 15px #555';
  panel.innerHTML = '<b>PW Coin 报名测试 · 比赛 ' + tournament + '</b><div>真实扣款报名；Entry 1，其他项目 0。</div><textarea style="width:100%;height:90px;color:#111" placeholder="GAME ID&#9;COIN&#10;27465794&#9;25000"></textarea><button data-start>开始报名</button> <button data-stop>停止</button> <button data-copy>复制结果</button><div data-status style="white-space:pre-wrap;max-height:210px;overflow:auto;margin-top:8px"></div>';
  document.body.append(panel);
  const output = panel.querySelector('[data-status]');
  function save() { sessionStorage.setItem(key, JSON.stringify(state)); }
  function render(message = '') {
    output.textContent = [message, ...state.results.map(r => `${r.game}\t${r.status}\t${r.reason}`)].filter(Boolean).join('\n');
    panel.querySelector('[data-start]').disabled = busy || state.active;
  }
  function result(row, status, reason) {
    state.results.push({ game: row.game, status, reason });
    state.index++;
    save(); render();
  }
  async function post(path, data) {
    await sleep(6100);
    const response = await fetch(path, { method: 'POST', credentials: 'same-origin', body: new URLSearchParams(data) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const html = await response.text();
    if (/\/login(?:[/?]|$)/.test(response.url)) throw new Error('登录已失效');
    return html;
  }
  async function search(game) {
    const doc = parse(await post('/jogadores_cb/search', { query: game, identifier: 'string' }));
    const ids = new Set();
    for (const el of doc.querySelectorAll('[rel], [onclick], a, li, tr')) {
      const text = norm(el.textContent);
      if (!text.includes(game) && !text.includes(game.slice(0, 4) + '.' + game.slice(4))) continue;
      const html = el.outerHTML;
      const id = html.match(/jogadores\/painel\/(\d+)/)?.[1] || el.getAttribute('rel')?.match(/^\d+$/)?.[0] || html.match(/rel=["'](\d+)["']/)?.[1];
      if (id) ids.add(id);
    }
    if (ids.size !== 1) throw new Error('玩家未找到或匹配不唯一');
    return [...ids][0];
  }
  async function cashier(id) {
    const html = await post('/torneio/abas/caixa/dados_caixa', { id_jogador: id, id_torneio: tournament, premiacao_origem: '0' });
    const doc = parse(html);
    const form = doc.querySelector('#form_caixa');
    if (!form || form.elements.id_jogador?.value !== id || form.elements.id_torneio?.value !== tournament) throw new Error('Cashier 玩家或比赛不符');
    const table = [...doc.querySelectorAll('table')].find(t => norm(t.textContent).includes('利用可能なコイン'));
    if (!table) throw new Error('无法读取可用 Coin');
    const balanceText = norm(table.querySelector('tbody tr:last-child td:last-child')?.textContent);
    if (!/^[\d,]+(?:\.\d+)?$/.test(balanceText)) throw new Error('无法识别 Coin 数值');
    const balance = amount(balanceText);
    if (!Number.isFinite(balance) || balance < 0) throw new Error('Coin 格式异常');
    const entries = [...form.querySelectorAll('tr')].filter(tr => /^Entry\s*\(\d+\)$/i.test(norm(tr.cells[0]?.textContent)));
    if (entries.length !== 1) throw new Error('Entry 项目不唯一或未找到');
    const input = entries[0].querySelector('input[name^="qtd_item["]');
    const item = input?.name.match(/^qtd_item\[(\d+)\]$/)?.[1];
    const price = item ? Number(html.match(new RegExp('var\\s+valorItem_' + item + '\\s*=\\s*(\\d+(?:\\.\\d+)?)\\s*;'))?.[1]) : NaN;
    const recordTable = [...doc.querySelectorAll('table')].find(t => [...t.querySelectorAll('th')].some(th => norm(th.textContent) === 'EN'));
    if (!recordTable) throw new Error('无法识别付款记录');
    const enIndex = [...recordTable.querySelectorAll('thead th')].findIndex(th => norm(th.textContent) === 'EN');
    const records = [...recordTable.querySelectorAll('tbody tr')].filter(tr => amount(tr.cells[enIndex]?.textContent) > 0);
    return { form, balance, input, item, price, count: records.length };
  }
  async function run() {
    if (busy) return;
    busy = true; render('正在检查…');
    try {
      if (state.pending) {
        const pending = state.pending;
        // Native PW page scripts retain responsibility for automatic seating.
        await sleep(4000);
        const current = await cashier(pending.id);
        if (current.count > pending.count && current.balance === pending.balance - pending.row.coin) {
          state.pending = null;
          result(pending.row, '已支付', '付款记录新增且 Coin 扣除一致；位置以 PW 为准');
        } else {
          state.active = false; save();
          render('提交结果待确认，已暂停。请在 PW 核对；不会自动重试。');
          return;
        }
      }
      while (state.active && state.index < state.rows.length) {
        const row = state.rows[state.index];
        render(`检查 ${state.index + 1}/${state.rows.length}：${row.game}`);
        let c, id;
        try {
          id = await search(row.game);
          c = await cashier(id);
          if (c.count > 0 || !c.input) throw new Error('已存在 Entry 记录或 Entry 不可购买');
          if (!Number.isFinite(c.price) || c.price !== row.coin) throw new Error(`TSV 金额与 Entry 价格不一致（${c.price}）`);
          if (c.balance < row.coin) throw new Error(`余额不足（可用 ${c.balance}）`);
        } catch (error) { result(row, '未支付', error.message); continue; }
        if (!state.active) break;
        const form = c.form;
        const target = new URL(form.getAttribute('action'), location.href);
        if (target.origin !== location.origin || target.pathname !== '/torneio/abas/caixa/confirmar') throw new Error('提交地址异常');
        for (const input of form.querySelectorAll('input[name^="qtd_item["]')) input.value = input === c.input ? '1' : '0';
        for (const input of form.querySelectorAll('input[name^="pgto["]')) input.value = input.name === 'pgto[moedas]' ? row.coin.toLocaleString('en-US') : '';
        for (const input of form.querySelectorAll('input[name="usarvaga[]"]')) input.checked = false;
        if (!form.elements['pgto[moedas]'] || !form.elements.codbloq?.value || !form.elements.valor_pendencia || form.elements.acao?.value !== '1') throw new Error('付款表单字段不完整');
        form.elements.valor_pendencia.value = '0';
        if (form.elements.posjogautomatica) form.elements.posjogautomatica.value = '1';
        state.pending = { row, id, count: c.count, balance: c.balance };
        save(); render('正在提交，等待 PW 刷新…');
        // Do not inject or execute scripts returned in Cashier HTML.
        for (const script of form.querySelectorAll('script')) script.remove();
        form.hidden = true;
        document.body.append(document.adoptNode(form));
        HTMLFormElement.prototype.submit.call(form);
        return;
      }
      state.active = false; save(); render('处理结束');
    } catch (error) { state.active = false; save(); render('已暂停：' + error.message); }
    finally { busy = false; render(output.textContent.split('\n')[0]); }
  }
  panel.querySelector('[data-start]').onclick = () => {
    if (state.pending) { render('有待确认的提交，请先在 PW 核对。当前队列禁止重新提交。'); return; }
    try {
      const lines = panel.querySelector('textarea').value.trim().split(/\r?\n/);
      const rows = [], seen = new Set();
      for (let i = 0; i < lines.length; i++) {
        const cols = lines[i].split('\t');
        if (i === 0 && /game\s*id/i.test(cols[0])) continue;
        const game = cols[0].replace(/[.\s]/g, '');
        const coin = amount(cols[1] || '');
        if (cols.length !== 2 || !/^\d{8}$/.test(game) || !Number.isSafeInteger(coin) || coin <= 0) throw new Error(`第 ${i + 1} 行格式错误`);
        if (seen.has(game)) throw new Error('重复 GAME ID：' + game);
        seen.add(game); rows.push({ game, coin });
      }
      if (!rows.length) throw new Error('请输入 TSV');
      state = { rows, index: 0, results: [], active: true, pending: null }; save(); run();
    } catch (error) { render(error.message); }
  };
  panel.querySelector('[data-stop]').onclick = () => { state.active = false; save(); render('已停止；已发出的提交仍需确认。'); };
  panel.querySelector('[data-copy]').onclick = async () => {
    const rows = state.results.map(r => [r.game, r.status, r.reason].join('\t'));
    if (state.pending) rows.push(state.pending.row.game + '\t待确认\t请在 PW 核对，勿重复提交');
    try { await navigator.clipboard.writeText(['GAME ID\t结果\t原因', ...rows].join('\n')); }
    catch (_) { render('复制失败，请直接选中结果复制'); }
  };
  render(state.pending ? '有提交待核对…' : '粘贴 TSV 后点击开始报名');
  if (state.pending || state.active) run();
})();
