// ==UserScript==
// @name         PW Prize Write Test 4905
// @namespace    https://japanopt.pokerweb.com.br/
// @version      0.1.0
// @description  TEST ONLY: write fixed test10086 prize plan to 4905 from any PokerWeb page.
// @match        https://japanopt.pokerweb.com.br/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const TEST = {
    name: 'test10086',
    id: '4905',
    url: '/cb/torneio/painel/4905',
    total: 500000,
    rows: [
      { rank: 1, amount: 250000 },
      { rank: 2, amount: 100000 },
      { rank: 3, amount: 50000 },
      { rank: 4, amount: 30000 },
      { rank: 5, amount: 30000 },
      { rank: 6, amount: 20000 },
      { rank: 7, amount: 20000 }
    ]
  };

  const PRIZE_ENDPOINT = '/cb/torneio/abas/premiacao/faixas_premiacoes';
  const POT_ENDPOINT = `/cb/torneio/abas/premiacao/pot_total/${TEST.id}`;

  function norm(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function money(value) {
    const cleaned = String(value ?? '').replace(/[^\d.-]/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  function rank(value) {
    const m = String(value ?? '').match(/\d+/);
    return m ? Number(m[0]) : null;
  }

  function byName(root, name) {
    return [...root.querySelectorAll(`[name="${CSS.escape(name)}"]`)];
  }

  async function fetchDoc(url) {
    const absolute = url.startsWith('http') ? url : new URL(url, location.origin).href;
    const res = await fetch(absolute, { credentials: 'include', cache: 'no-store' });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.__rawHtml = html;
    doc.__status = res.status;
    return doc;
  }

  function titleOf(doc) {
    return norm(
      doc.querySelector('input[name="titulo_torneio"], input[name="nome"], input[name="name"]')?.value ||
      doc.querySelector('h1,h2,.page-title,.box-title,.panel-title,.breadcrumb')?.textContent ||
      doc.title
    ).replace(/\s*-\s*PokerWeb\s*$/i, '');
  }

  function getCodbloq(doc) {
    const direct = doc.querySelector('[name="codbloq"]')?.value;
    if (direct) return direct;
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

  function readCurrentRows(doc) {
    const names = ['id[]', 'status[]', 'tipo[]', 'id_grupo[]', 'posicao[]', 'prizes_desc[]', 'prizes_valor[]', 'valor_vaga[]'];
    const max = Math.max(0, ...names.map(name => byName(doc, name).length));
    const rows = [];
    for (let i = 0; i < max; i++) {
      const row = {};
      for (const name of names) row[name] = byName(doc, name)[i]?.value ?? '';
      rows.push(row);
    }
    return rows;
  }

  function buildPrizePayload(doc) {
    const codbloq = getCodbloq(doc);
    if (!codbloq) {
      throw new Error(`codbloq not found. GET status=${doc.__status} title=${titleOf(doc)} hasPrizes=${!!doc.querySelector('#prizes_tela,[name="prizes_valor[]"]')} hasSendForm=${/sendFormPrizes/i.test(doc.__rawHtml || '')}`);
    }

    const current = readCurrentRows(doc);
    const byPos = new Map();
    for (const row of current) {
      const pos = Number(row['posicao[]']);
      if (pos > 0) byPos.set(pos, row);
    }
    const desired = new Map(TEST.rows.map(row => [row.rank, row.amount]));
    const allPositions = [...new Set([...byPos.keys(), ...desired.keys()])].sort((a, b) => a - b);

    const data = {
      salvar: ['prizes'],
      id_torneio: [TEST.id],
      'id[]': [''],
      'status[]': ['novo'],
      'tipo[]': [''],
      'id_grupo[]': [''],
      'posicao[]': ['0'],
      'prizes_desc[]': [''],
      'prizes_valor[]': [''],
      'valor_vaga[]': [''],
      'prizes_visivel[]': ['0'],
      codbloq: [codbloq]
    };

    for (const pos of allPositions) {
      const old = byPos.get(pos);
      const hasOld = !!old?.['id[]'];
      const want = desired.get(pos);
      data['id[]'].push(hasOld ? old['id[]'] : '');
      data['status[]'].push(hasOld ? (old['status[]'] || '0') : 'novo');
      data['tipo[]'].push(old?.['tipo[]'] || '0');
      data['id_grupo[]'].push(old?.['id_grupo[]'] || '0');
      data['posicao[]'].push(String(pos));
      data['prizes_desc[]'].push(old?.['prizes_desc[]'] || '');
      data['prizes_valor[]'].push(want != null ? String(want) : String(money(old?.['prizes_valor[]']) || ''));
      data['valor_vaga[]'].push(old?.['valor_vaga[]'] || (hasOld ? '0' : ''));
    }

    const params = new URLSearchParams();
    params.append('dados', JSON.stringify(data));
    params.append('codbloq', codbloq);
    return { params, data, codbloq };
  }

  function buildPotPayload(doc) {
    const codbloq = getCodbloq(doc);
    if (!codbloq) throw new Error('pot codbloq not found');
    const params = new URLSearchParams();
    params.append('layout', 'pot_config');
    params.append('potautomatico', '0');
    params.append('potmanual', TEST.total.toLocaleString('en-US'));
    params.append('potgarantido', '0');
    params.append('codbloq', codbloq);
    return { params, codbloq };
  }

  async function post(url, params) {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: params
    });
    const text = await res.text();
    return { status: res.status, text: text.slice(0, 500) };
  }

  function readPrize(doc) {
    const pos = byName(doc, 'posicao[]');
    const vals = byName(doc, 'prizes_valor[]');
    const rows = [];
    for (let i = 0; i < Math.min(pos.length, vals.length); i++) {
      const r = rank(pos[i]?.value);
      const amount = money(vals[i]?.value);
      if (r && amount && amount > 0) rows.push({ rank: r, amount });
    }
    rows.sort((a, b) => a.rank - b.rank);
    return { title: titleOf(doc), rows, total: rows.reduce((sum, row) => sum + row.amount, 0) };
  }

  function verify(snapshot) {
    if (snapshot.total !== TEST.total) return `TOTAL NG ${snapshot.total} != ${TEST.total}`;
    if (snapshot.rows.length !== TEST.rows.length) return `COUNT NG ${snapshot.rows.length} != ${TEST.rows.length}`;
    for (const expected of TEST.rows) {
      const actual = snapshot.rows.find(row => row.rank === expected.rank);
      if (!actual) return `${expected.rank} missing`;
      if (actual.amount !== expected.amount) return `${expected.rank} NG ${actual.amount} != ${expected.amount}`;
    }
    return 'OK';
  }

  async function run() {
    if (!confirm(`TEST WRITE ${TEST.name} / ${TEST.id}\nTotal ${TEST.total.toLocaleString('ja-JP')}\n実行しますか？`)) return;
    const button = document.getElementById('pw-prize-write-test-4905');
    button.disabled = true;
    button.textContent = 'TEST中...';
    try {
      const doc1 = await fetchDoc(TEST.url);
      console.log('GET doc', {
        status: doc1.__status,
        title: titleOf(doc1),
        codbloq: getCodbloq(doc1),
        hasPrizes: !!doc1.querySelector('#prizes_tela,[name="prizes_valor[]"]'),
        hasSendForm: /sendFormPrizes/i.test(doc1.__rawHtml || '')
      });
      const prize = buildPrizePayload(doc1);
      console.log('POST prize payload', prize.data);
      const prizeRes = await post(PRIZE_ENDPOINT, prize.params);
      console.log('POST prize result', prizeRes);

      await new Promise(resolve => setTimeout(resolve, 600));
      const doc2 = await fetchDoc(TEST.url);
      const pot = buildPotPayload(doc2);
      console.log('POST pot payload', [...pot.params.entries()]);
      const potRes = await post(POT_ENDPOINT, pot.params);
      console.log('POST pot result', potRes);

      await new Promise(resolve => setTimeout(resolve, 800));
      const doc3 = await fetchDoc(TEST.url);
      const snapshot = readPrize(doc3);
      const result = verify(snapshot);
      console.log('VERIFY', snapshot);
      alert(`TEST完了\nVerify: ${result}\nTotal: ${snapshot.total.toLocaleString('ja-JP')}\nRows: ${snapshot.rows.map(r => `${r.rank}:${r.amount}`).join(' / ')}`);
    } catch (error) {
      console.error(error);
      alert(`TEST ERROR\n${error.message || error}`);
    } finally {
      button.disabled = false;
      button.textContent = 'TEST WRITE 4905';
    }
  }

  function mount() {
    if (document.getElementById('pw-prize-write-test-4905')) return;
    const button = document.createElement('button');
    button.id = 'pw-prize-write-test-4905';
    button.textContent = 'TEST WRITE 4905';
    button.style.cssText = 'position:fixed;right:20px;bottom:72px;z-index:999999;background:#dc2626;color:white;border:0;border-radius:8px;padding:12px 16px;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,.25);cursor:pointer;';
    button.onclick = run;
    document.body.appendChild(button);
  }

  mount();
})();
