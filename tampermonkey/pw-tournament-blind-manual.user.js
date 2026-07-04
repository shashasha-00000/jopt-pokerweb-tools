// ==UserScript==
// @name         PW Tournament Blind Manual（可用・待升级）
// @namespace    pw-tournament-blind-manual
// @version      1.0.0
// @description  PokerWeb blind backend direct success version. Current rules are hardcoded; usable but planned for safer template/preview upgrade.
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-tournament-blind-manual.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-tournament-blind-manual.user.js
// @match        https://japanopt.pokerweb.com.br/cb/*
// @match        https://japanopt.pokerweb.com.br/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ============================================================
  // 上部设定区：以后主要改这里
  // ============================================================

  const BREAK_YOUTUBE_URL = 'https://youtu.be/ID8o2U2OlV8';

  const STORE_RULES = [
    {
      store: 'GoodGame Poker Live SHINJUKU',
      ruleKey: '20',
      action: 'apply'
    },
    {
      store: 'GoodGame Poker Live NAGOYA',
      ruleKey: '40',
      action: 'apply'
    },
    {
      store: 'イケブクロギルド',
      ruleKey: '30',
      action: 'skip'
    }
  ];

  const BLIND_RULES = {
    '20': [
      { label: 'L1',  type: 'level', minutes: '20', sb: '100',  bb: '200',  ante: '200' },
      { label: 'L2',  type: 'level', minutes: '20', sb: '200',  bb: '300',  ante: '300' },
      { label: 'L3',  type: 'level', minutes: '20', sb: '200',  bb: '400',  ante: '400' },
      { label: 'L4',  type: 'level', minutes: '20', sb: '300',  bb: '500',  ante: '500' },
      { label: 'L5',  type: 'level', minutes: '20', sb: '300',  bb: '600',  ante: '600' },
      { label: 'L6',  type: 'level', minutes: '20', sb: '400',  bb: '800',  ante: '800' },
      { label: 'B1',  type: 'break', minutes: '10', youtube: BREAK_YOUTUBE_URL },

      { label: 'L7',  type: 'level', minutes: '20', sb: '500',  bb: '1000', ante: '1000' },
      { label: 'L8',  type: 'level', minutes: '20', sb: '600',  bb: '1200', ante: '1200' },
      { label: 'L9',  type: 'level', minutes: '20', sb: '1000', bb: '1500', ante: '1500' },
      { label: 'L10', type: 'level', minutes: '20', sb: '1000', bb: '2000', ante: '2000' },
      { label: 'L11', type: 'level', minutes: '20', sb: '1500', bb: '2500', ante: '2500' },
      { label: 'L12', type: 'level', minutes: '20', sb: '1500', bb: '3000', ante: '3000' },
      { label: 'B2',  type: 'break', minutes: '10', youtube: BREAK_YOUTUBE_URL },

      { label: 'L13', type: 'level', minutes: '20', sb: '2000', bb: '4000', ante: '4000' },
      { label: 'L14', type: 'level', minutes: '20', sb: '2500', bb: '5000', ante: '5000' },
      { label: 'L15', type: 'level', minutes: '20', sb: '3000', bb: '6000', ante: '6000' }
    ],

    '30': [
      { label: 'L1',  type: 'level', minutes: '30', sb: '100',  bb: '200',  ante: '200' },
      { label: 'L2',  type: 'level', minutes: '30', sb: '200',  bb: '300',  ante: '300' },
      { label: 'L3',  type: 'level', minutes: '30', sb: '200',  bb: '400',  ante: '400' },
      { label: 'L4',  type: 'level', minutes: '30', sb: '300',  bb: '500',  ante: '500' },
      { label: 'B1',  type: 'break', minutes: '10', youtube: BREAK_YOUTUBE_URL },

      { label: 'L5',  type: 'level', minutes: '30', sb: '300',  bb: '600',  ante: '600' },
      { label: 'L6',  type: 'level', minutes: '30', sb: '400',  bb: '800',  ante: '800' },
      { label: 'L7',  type: 'level', minutes: '30', sb: '500',  bb: '1000', ante: '1000' },
      { label: 'L8',  type: 'level', minutes: '30', sb: '600',  bb: '1200', ante: '1200' },
      { label: 'B2',  type: 'break', minutes: '10', youtube: BREAK_YOUTUBE_URL },

      { label: 'L9',  type: 'level', minutes: '30', sb: '1000', bb: '1500', ante: '1500' },
      { label: 'L10', type: 'level', minutes: '30', sb: '1000', bb: '2000', ante: '2000' },
      { label: 'L11', type: 'level', minutes: '30', sb: '1500', bb: '2500', ante: '2500' },
      { label: 'L12', type: 'level', minutes: '30', sb: '1500', bb: '3000', ante: '3000' },
      { label: 'B3',  type: 'break', minutes: '10', youtube: BREAK_YOUTUBE_URL },

      { label: 'L13', type: 'level', minutes: '30', sb: '2000', bb: '4000', ante: '4000' },
      { label: 'L14', type: 'level', minutes: '30', sb: '2500', bb: '5000', ante: '5000' },
      { label: 'L15', type: 'level', minutes: '30', sb: '3000', bb: '6000', ante: '6000' }
    ],

    '40': [
      { label: 'L1',  type: 'level', minutes: '40', sb: '100',  bb: '200',  ante: '200' },
      { label: 'L2',  type: 'level', minutes: '40', sb: '200',  bb: '300',  ante: '300' },
      { label: 'L3',  type: 'level', minutes: '40', sb: '200',  bb: '400',  ante: '400' },
      { label: 'B1',  type: 'break', minutes: '10', youtube: BREAK_YOUTUBE_URL },

      { label: 'L4',  type: 'level', minutes: '40', sb: '300',  bb: '500',  ante: '500' },
      { label: 'L5',  type: 'level', minutes: '40', sb: '300',  bb: '600',  ante: '600' },
      { label: 'L6',  type: 'level', minutes: '40', sb: '400',  bb: '800',  ante: '800' },
      { label: 'B2',  type: 'break', minutes: '10', youtube: BREAK_YOUTUBE_URL },

      { label: 'L7',  type: 'level', minutes: '40', sb: '500',  bb: '1000', ante: '1000' },
      { label: 'L8',  type: 'level', minutes: '40', sb: '600',  bb: '1200', ante: '1200' },
      { label: 'L9',  type: 'level', minutes: '40', sb: '1000', bb: '1500', ante: '1500' },
      { label: 'B3',  type: 'break', minutes: '10', youtube: BREAK_YOUTUBE_URL },

      { label: 'L10', type: 'level', minutes: '40', sb: '1000', bb: '2000', ante: '2000' },
      { label: 'L11', type: 'level', minutes: '40', sb: '1500', bb: '2500', ante: '2500' },
      { label: 'L12', type: 'level', minutes: '40', sb: '1500', bb: '3000', ante: '3000' },
      { label: 'B4',  type: 'break', minutes: '10', youtube: BREAK_YOUTUBE_URL },

      { label: 'L13', type: 'level', minutes: '40', sb: '2000', bb: '4000', ante: '4000' },
      { label: 'L14', type: 'level', minutes: '40', sb: '2500', bb: '5000', ante: '5000' },
      { label: 'L15', type: 'level', minutes: '40', sb: '3000', bb: '6000', ante: '6000' }
    ]
  };

  // ============================================================
  // 工具函数
  // ============================================================

  function log(msg) {
    console.log(`[盲注设置成功版] ${msg}`);
    const box = document.querySelector('#pw-blind-success-status');
    if (box) box.textContent = msg;
  }

  function warn(msg) {
    console.warn(`[盲注设置成功版] ${msg}`);
    const box = document.querySelector('#pw-blind-success-status');
    if (box) box.textContent = `⚠ ${msg}`;
  }

  function normalizeText(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function getTournamentIdFromUrl() {
    const m = location.href.match(/\/painel\/(\d+)/);
    return m ? m[1] : '';
  }

  function isPainelPage() {
    return /\/cb\/torneio\/painel\/\d+/.test(location.href);
  }

  function getPageText() {
    return normalizeText(document.body.innerText || document.body.textContent || '');
  }

  function detectStoreRule() {
    const combined = `${normalizeText(document.title || '')} ${getPageText()}`;

    for (const config of STORE_RULES) {
      if (combined.includes(config.store)) {
        return config;
      }
    }

    return null;
  }

  function findBlindForm() {
    const forms = [...document.querySelectorAll('form')];

    const form = forms.find(f => {
      const html = f.innerHTML || '';
      const action = f.action || '';

      return (
        action.includes('/abas/blinds/niveis_editar') ||
        html.includes('niveis_blinds') ||
        html.includes('tempo[') ||
        html.includes('small[') ||
        html.includes('big[') ||
        html.includes('ante[') ||
        html.includes('linkyoutube[')
      );
    });

    if (form) return form;

    const input = document.querySelector(
      'input[name^="tempo["], input[name^="small["], input[name^="big["], input[name^="ante["], input[name^="break["], input[name^="linkyoutube["]'
    );

    return input ? input.closest('form') : null;
  }

  function parseBlindRows(form) {
    const fields = new Set([
      'ids',
      'break',
      'tempo',
      'small',
      'big',
      'ante',
      'linkyoutube',
      'audio'
    ]);

    const groups = new Map();
    const elements = [...form.querySelectorAll('input, select, textarea')];

    let order = 0;

    for (const el of elements) {
      const name = el.name || '';
      const m = name.match(/^([a-zA-Z_]+)\[([^\]]+)\]$/);

      if (!m) continue;

      const field = m[1];
      const id = m[2];

      if (!fields.has(field)) continue;

      if (!groups.has(id)) {
        groups.set(id, {
          id,
          order: order++,
          fields: {},
          rowText: normalizeText(el.closest('tr')?.innerText || '')
        });
      }

      groups.get(id).fields[field] = {
        el,
        value: el.value || '',
        name
      };
    }

    const rows = [...groups.values()]
      .sort((a, b) => a.order - b.order)
      .map(row => {
        const breakValue = row.fields.break?.value || '';
        return {
          ...row,
          isBreak: String(breakValue) === '1'
        };
      });

    if (!rows.length) {
      throw new Error('没有解析到 blind rows。请确认你已经打开 ブラインド 界面。');
    }

    return rows;
  }

  function getCodbloq(form) {
    const el = form.querySelector('[name="codbloq"]');
    return el ? el.value : '';
  }

  function nextNewIdFactory(rows) {
    const existingN = rows
      .map(r => String(r.id || ''))
      .map(id => {
        const m = id.match(/^n(\d+)$/);
        return m ? Number(m[1]) : 0;
      });

    let n = Math.max(0, ...existingN) + 1;

    return function nextNewId() {
      return `n${n++}`;
    };
  }

  function buildBackendPlan(rows, rule) {
    const existingLevels = rows.filter(r => !r.isBreak);
    const existingBreaks = rows.filter(r => r.isBreak);

    const targetLevelCount = rule.filter(x => x.type === 'level').length;
    const targetBreakCount = rule.filter(x => x.type === 'break').length;

    const nextNewId = nextNewIdFactory(rows);

    let levelCursor = 0;
    let breakCursor = 0;

    const plan = rule.map((spec, index) => {
      let source = null;

      if (spec.type === 'level') {
        source = existingLevels[levelCursor++] || null;
      } else {
        source = existingBreaks[breakCursor++] || null;
      }

      const id = source ? source.id : nextNewId();

      return {
        index: index + 1,
        label: spec.label,
        type: spec.type,
        id,
        isNew: !source,
        sourceType: source ? (source.isBreak ? 'break' : 'level') : 'new',
        oldTempo: source?.fields.tempo?.value || '',
        oldSmall: source?.fields.small?.value || '',
        oldBig: source?.fields.big?.value || '',
        oldAnte: source?.fields.ante?.value || '',
        oldYoutube: source?.fields.linkyoutube?.value || '',
        spec
      };
    });

    const usedExistingIds = new Set(
      plan
        .filter(p => !p.isNew)
        .map(p => p.id)
    );

    const omittedRows = rows.filter(r => !usedExistingIds.has(r.id));

    return {
      plan,
      omittedRows,
      existingLevelCount: existingLevels.length,
      existingBreakCount: existingBreaks.length,
      targetLevelCount,
      targetBreakCount,
      newCount: plan.filter(p => p.isNew).length,
      omitCount: omittedRows.length
    };
  }

  function printPreview(rows, summary, config) {
    console.log(`[盲注设置成功版] ===== 当前页面行 =====`);
    console.table(rows.map((r, i) => ({
      row: i + 1,
      id: r.id,
      type: r.isBreak ? 'break' : 'level',
      tempo: r.fields.tempo?.value || '',
      sb: r.fields.small?.value || '',
      bb: r.fields.big?.value || '',
      ante: r.fields.ante?.value || '',
      youtube: r.fields.linkyoutube?.value || '',
      rowText: r.rowText
    })));

    console.log(`[盲注设置成功版] ===== 后台提交计划：${config.store} → ${config.ruleKey}分钟 =====`);
    console.table(summary.plan.map(p => ({
      row: p.index,
      target: p.label,
      type: p.type,
      id: p.id,
      new: p.isNew,
      sourceType: p.sourceType,
      oldTempo: p.oldTempo,
      oldSB: p.oldSmall,
      oldBB: p.oldBig,
      oldAnte: p.oldAnte,
      oldYoutube: p.oldYoutube,
      newTempo: p.spec.minutes,
      newSB: p.spec.sb || '',
      newBB: p.spec.bb || '',
      newAnte: p.spec.ante || '',
      newYoutube: p.spec.youtube || ''
    })));

    if (summary.omittedRows.length) {
      console.warn('[盲注设置成功版] ===== 将被省略提交，理论上等于删除的行 =====');
      console.table(summary.omittedRows.map((r, i) => ({
        i: i + 1,
        id: r.id,
        type: r.isBreak ? 'break' : 'level',
        tempo: r.fields.tempo?.value || '',
        sb: r.fields.small?.value || '',
        bb: r.fields.big?.value || '',
        ante: r.fields.ante?.value || '',
        youtube: r.fields.linkyoutube?.value || '',
        rowText: r.rowText
      })));
    }

    console.log('[盲注设置成功版] summary:', {
      store: config.store,
      action: config.action,
      ruleKey: config.ruleKey,
      existingLevelCount: summary.existingLevelCount,
      existingBreakCount: summary.existingBreakCount,
      targetLevelCount: summary.targetLevelCount,
      targetBreakCount: summary.targetBreakCount,
      newCount: summary.newCount,
      omitCount: summary.omitCount,
      breakYoutube: BREAK_YOUTUBE_URL
    });
  }

  function appendFD(fd, name, value) {
    fd.append(name, String(value ?? ''));
  }

  function buildFinalFormData(form, summary) {
    const fd = new FormData();
    const codbloq = getCodbloq(form);

    appendFD(fd, 'niveis_blinds', 'atualizar');

    for (const p of summary.plan) {
      const id = p.id;
      const spec = p.spec;

      appendFD(fd, `ids[${id}]`, p.isNew ? 'novo' : '1');

      if (spec.type === 'break') {
        appendFD(fd, `break[${id}]`, '1');
        appendFD(fd, `tempo[${id}]`, spec.minutes);
        appendFD(fd, `linkyoutube[${id}]`, spec.youtube || '');
        appendFD(fd, `audio[${id}]`, '');
      } else {
        appendFD(fd, `break[${id}]`, '0');
        appendFD(fd, `tempo[${id}]`, spec.minutes);
        appendFD(fd, `small[${id}]`, spec.sb);
        appendFD(fd, `big[${id}]`, spec.bb);
        appendFD(fd, `ante[${id}]`, spec.ante);
        appendFD(fd, `audio[${id}]`, '');
      }
    }

    if (codbloq) {
      appendFD(fd, 'codbloq', codbloq);
    }

    return fd;
  }

  function debugFormData(title, fd) {
    console.log(`[盲注设置成功版] ${title}`);
    for (const [k, v] of fd.entries()) {
      console.log(k, '=', v);
    }
  }

  async function callOrderNivel(summary) {
    const idTorneio = getTournamentIdFromUrl();

    if (!idTorneio) {
      throw new Error('排序失败：当前 URL 里找不到 tournament id');
    }

    const params = new URLSearchParams();

    for (const p of summary.plan) {
      if (p.isNew) {
        throw new Error(`排序需要正式 levelId，但 ${p.label} 是新增临时ID ${p.id}。请先用测试版补齐行数后刷新，或先确认该比赛已有足够 Level / Break。`);
      }

      params.append(`nivelid${idTorneio}[]`, p.id);
    }

    for (const p of summary.plan) {
      params.append('intervalo[]', p.type === 'break' ? '1' : '0');
    }

    params.set('id_torneio', idTorneio);
    params.set('_', String(Date.now()));

    const url = `/cb/torneio/abas/blinds/ordenar_nivel?${params.toString()}`;

    console.log('[盲注设置成功版] ordenar_nivel URL:', url);

    const res = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    });

    log(`排序 ordenar_nivel 完成 status=${res.status}`);
    await sleep(800);
  }

  async function postFinalBlindData(form, fd) {
    const idTorneio = getTournamentIdFromUrl();

    if (!idTorneio) {
      throw new Error('当前 URL 里找不到 tournament id');
    }

    const actionFromForm = form.action || '';
    const action = actionFromForm.includes('/abas/blinds/niveis_editar')
      ? actionFromForm
      : `/cb/torneio/abas/blinds/niveis_editar/${idTorneio}`;

    const res = await fetch(action, {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
      redirect: 'follow'
    });

    log(`POST 保存完成 status=${res.status}`);
    console.log('[盲注设置成功版] response url:', res.url || '');

    await sleep(800);
  }

  function loadPlan() {
    if (!isPainelPage()) {
      throw new Error(`当前不是比赛详情页：${location.href}`);
    }

    const config = detectStoreRule();

    if (!config) {
      throw new Error('无法识别店名。当前支持 GoodGame Poker Live SHINJUKU / GoodGame Poker Live NAGOYA / イケブクロギルド');
    }

    if (config.action === 'skip') {
      return {
        skipped: true,
        config,
        form: null,
        rows: [],
        summary: null
      };
    }

    const rule = BLIND_RULES[config.ruleKey];

    if (!rule) {
      throw new Error(`找不到盲注规则：${config.ruleKey}`);
    }

    const form = findBlindForm();

    if (!form) {
      throw new Error('找不到 blind form。请先手动打开 ブラインド 界面。');
    }

    const rows = parseBlindRows(form);
    const summary = buildBackendPlan(rows, rule);

    printPreview(rows, summary, config);

    return {
      skipped: false,
      config,
      form,
      rows,
      summary
    };
  }

  async function previewOnly() {
    try {
      const result = loadPlan();

      if (result.skipped) {
        log(`识别到 ${result.config.store} → ${result.config.ruleKey}分钟，设定为跳过`);
        console.log('[盲注设置成功版] skipped:', result.config);
        return;
      }

      log(`预览完成：${result.config.store} → ${result.config.ruleKey}分钟 / 新增 ${result.summary.newCount} 行，省略 ${result.summary.omitCount} 行`);

    } catch (e) {
      console.error('[盲注设置成功版] preview error:', e);
      warn(`预览失败：${e.message || e}`);
    }
  }

  async function applyDirectBackend() {
    try {
      const result = loadPlan();

      if (result.skipped) {
        alert(`识别到 ${result.config.store}。\n这场是 ${result.config.ruleKey} 分钟结构，当前脚本设定为跳过，不提交。`);
        log(`跳过：${result.config.store}`);
        return;
      }

      const { config, form, summary } = result;

      const ok = confirm(
        `确认后台直送盲注结构？\n\n` +
        `店名：${config.store}\n` +
        `规则：${config.ruleKey}分钟\n` +
        `Break YouTube：${BREAK_YOUTUBE_URL}\n` +
        `目标 Level：${summary.targetLevelCount}\n` +
        `目标 Break：${summary.targetBreakCount}\n` +
        `现有 Level：${summary.existingLevelCount}\n` +
        `现有 Break：${summary.existingBreakCount}\n` +
        `新增行：${summary.newCount}\n` +
        `省略/可能删除行：${summary.omitCount}\n\n` +
        `流程：\n` +
        `1. ordenar_nivel 排序\n` +
        `2. POST 最终盲注数据\n` +
        `3. 刷新确认`
      );

      if (!ok) {
        log('已取消');
        return;
      }

      if (summary.newCount > 0) {
        alert(
          `当前需要新增 ${summary.newCount} 行。\n` +
          `这个“成功版”先要求已有足够正式 Level / Break ID，避免 n1/n2 排序失败。\n\n` +
          `如果未来要完全无人值守，再加“先新增刷新再排序”的状态机。`
        );
        return;
      }

      await callOrderNivel(summary);

      const fd = buildFinalFormData(form, summary);

      debugFormData('Final backend direct payload', fd);

      await postFinalBlindData(form, fd);

      await sleep(1200);
      location.reload();

    } catch (e) {
      console.error('[盲注设置成功版] apply error:', e);
      warn(`提交失败：${e.message || e}`);
      alert(`提交失败：${e.message || e}`);
    }
  }

  // ============================================================
  // UI
  // ============================================================

  function addPanel() {
    if (document.querySelector('#pw-blind-success-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'pw-blind-success-panel';

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
      width: 360px;
    `;

    panel.innerHTML = `
      <div style="font-weight:bold;margin-bottom:8px;">盲注设置成功版</div>

      <button id="pw-blind-success-preview"
        style="width:100%;margin-bottom:6px;padding:6px;cursor:pointer;">
        Preview Backend Payload
      </button>

      <button id="pw-blind-success-apply"
        style="width:100%;margin-bottom:6px;padding:6px;cursor:pointer;background:#ffe08a;border:1px solid #c99;">
        APPLY Backend Direct
      </button>

      <div style="margin-top:8px;font-size:11px;color:#ccc;line-height:1.35;">
        SHINJUKU → 20分<br>
        NAGOYA → 40分<br>
        イケブクロギルド → skip<br>
        Break YouTube:<br>
        ${BREAK_YOUTUBE_URL}<br>
        手动打开ブラインド页面后使用
      </div>

      <div id="pw-blind-success-status"
        style="margin-top:8px;font-size:11px;color:#9fe;line-height:1.35;">
        ready
      </div>
    `;

    document.body.appendChild(panel);

    document.querySelector('#pw-blind-success-preview').onclick = () => previewOnly();
    document.querySelector('#pw-blind-success-apply').onclick = () => applyDirectBackend();
  }

  function boot() {
    addPanel();

    window.PWBlindSuccess = {
      previewOnly,
      applyDirectBackend,
      loadPlan,
      STORE_RULES,
      BLIND_RULES,
      BREAK_YOUTUBE_URL
    };

    log('ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
