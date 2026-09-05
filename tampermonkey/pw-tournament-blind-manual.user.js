// ==UserScript==
// @name         PW ブラインド設定 Manual（現行可・改善予定）
// @namespace    pw-tournament-blind-manual
// @version      1.2.1
// @description  PokerWeb blind backend direct tool with external saved settings UI and four internal blind structures.
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-tournament-blind-manual.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-tournament-blind-manual.user.js
// @match        https://japanopt.bt.pokerweb.com.br/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ============================================================
  // 上部设定区：以后主要改这里
  // ============================================================

  const SETTINGS_STORAGE_KEY = 'PW_BLIND_MANUAL_SETTINGS_V1';
  const DEFAULT_SETTINGS = {
    tournamentName: '',
    breakYoutubeUrl: '',
    storeDurationTsv: `店舗名\tDuration
GoodGame Poker Live SHINJUKU\t30min`
  };

  // 每次大会前必须与正式规则表核对；如有微调，应先修改下列盲注或 Break 定义。
  const BASE_BLIND_LEVELS = [
    { sb: '100',  bb: '200',  ante: '200' },
    { sb: '200',  bb: '300',  ante: '300' },
    { sb: '200',  bb: '400',  ante: '400' },
    { sb: '300',  bb: '500',  ante: '500' },
    { sb: '300',  bb: '600',  ante: '600' },
    { sb: '400',  bb: '800',  ante: '800' },
    { sb: '500',  bb: '1000', ante: '1000' },
    { sb: '600',  bb: '1200', ante: '1200' },
    { sb: '1000', bb: '1500', ante: '1500' },
    { sb: '1000', bb: '2000', ante: '2000' },
    { sb: '1500', bb: '2500', ante: '2500' },
    { sb: '1500', bb: '3000', ante: '3000' },
    { sb: '2000', bb: '4000', ante: '4000' },
    { sb: '2500', bb: '5000', ante: '5000' },
    { sb: '3000', bb: '6000', ante: '6000' }
  ];

  const STRUCTURE_SETTINGS = {
    '20': { breakAfterLevels: [6, 12], breakMinutes: '10' },
    '25': { breakAfterLevels: [5, 10], breakMinutes: '10' },
    '30': { breakAfterLevels: [4, 8, 12], breakMinutes: '10' },
    '40': { breakAfterLevels: [3, 6, 9, 12], breakMinutes: '10' }
  };

  function buildBlindRule(duration) {
    const setting = STRUCTURE_SETTINGS[duration];
    if (!setting) throw new Error(`未対応の Duration: ${duration}min`);

    const breakAfter = new Set(setting.breakAfterLevels);
    const rule = [];
    let breakNo = 0;

    BASE_BLIND_LEVELS.forEach((blind, index) => {
      const levelNo = index + 1;
      rule.push({
        label: `L${levelNo}`,
        type: 'level',
        minutes: duration,
        ...blind
      });

      if (breakAfter.has(levelNo)) {
        breakNo += 1;
        rule.push({
          label: `B${breakNo}`,
          type: 'break',
          minutes: setting.breakMinutes
        });
      }
    });

    return rule;
  }

  const BLIND_RULES = Object.fromEntries(
    Object.keys(STRUCTURE_SETTINGS).map(duration => [duration, buildBlindRule(duration)])
  );

  function getRuntimeBlindRule(duration, breakYoutubeUrl) {
    const rule = BLIND_RULES[duration];
    if (!rule) throw new Error(`找不到盲注规则：${duration}`);

    return rule.map(spec => ({
      ...spec,
      youtube: spec.type === 'break' ? breakYoutubeUrl : undefined
    }));
  }

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

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function parseStoreDurationTsv(tsv) {
    const lines = String(tsv || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      throw new Error('店舗 Duration 表が空です。ヘッダーと1店舗以上を設定してください。');
    }

    const headers = lines[0].split('\t').map(normalizeText);
    const storeIndex = headers.indexOf('店舗名');
    const durationIndex = headers.indexOf('Duration');

    if (storeIndex < 0 || durationIndex < 0) {
      throw new Error('店舗 Duration 表のヘッダーは「店舗名<TAB>Duration」にしてください。');
    }

    const seenStores = new Set();

    return lines.slice(1).map((line, index) => {
      const cells = line.split('\t').map(normalizeText);
      const store = cells[storeIndex] || '';
      const durationText = cells[durationIndex] || '';
      const durationMatch = durationText.match(/^(20|25|30|40)\s*(?:min)?$/i);
      const rowNo = index + 2;

      if (!store) {
        throw new Error(`店舗 Duration 表 ${rowNo}行目：店舗名が空です。`);
      }

      if (!durationMatch) {
        throw new Error(`店舗 Duration 表 ${rowNo}行目：Duration は 20min / 25min / 30min / 40min のいずれかにしてください。`);
      }

      if (seenStores.has(store)) {
        throw new Error(`店舗 Duration 表 ${rowNo}行目：店舗名が重複しています（${store}）。`);
      }

      seenStores.add(store);

      return {
        store,
        ruleKey: durationMatch[1]
      };
    });
  }

  function readSavedSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || 'null');
      if (!saved || typeof saved !== 'object') return { ...DEFAULT_SETTINGS };

      return {
        tournamentName: String(saved.tournamentName || ''),
        breakYoutubeUrl: String(saved.breakYoutubeUrl || ''),
        storeDurationTsv: String(saved.storeDurationTsv || DEFAULT_SETTINGS.storeDurationTsv)
      };
    } catch (e) {
      console.warn('[盲注设置成功版] 設定の読み込みに失敗。初期値を使用します。', e);
      return { ...DEFAULT_SETTINGS };
    }
  }

  function getPanelSettings() {
    const tournamentNameEl = document.querySelector('#pw-blind-tournament-name');
    const breakYoutubeUrlEl = document.querySelector('#pw-blind-break-url');
    const storeDurationTsvEl = document.querySelector('#pw-blind-store-duration');

    if (!tournamentNameEl || !breakYoutubeUrlEl || !storeDurationTsvEl) {
      return readSavedSettings();
    }

    return {
      tournamentName: tournamentNameEl.value,
      breakYoutubeUrl: breakYoutubeUrlEl.value,
      storeDurationTsv: storeDurationTsvEl.value
    };
  }

  function validateRuntimeSettings(rawSettings) {
    const tournamentName = normalizeText(rawSettings.tournamentName);
    const breakYoutubeUrl = String(rawSettings.breakYoutubeUrl || '').trim();
    const storeDurationTsv = String(rawSettings.storeDurationTsv || '').trim();

    if (!tournamentName) {
      throw new Error('总大会名が空です。実行前に必ず入力してください。');
    }

    if (breakYoutubeUrl) {
      let parsedUrl;
      try {
        parsedUrl = new URL(breakYoutubeUrl);
      } catch (_) {
        throw new Error('Break Link が正しい URL ではありません。空欄、または http/https URL を入力してください。');
      }

      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Break Link は空欄、または http/https URL にしてください。');
      }
    }

    return {
      tournamentName,
      breakYoutubeUrl,
      storeDurationTsv,
      storeRules: parseStoreDurationTsv(storeDurationTsv)
    };
  }

  function loadRuntimeSettings() {
    return validateRuntimeSettings(getPanelSettings());
  }

  function savePanelSettings() {
    try {
      const settings = loadRuntimeSettings();
      const saved = {
        tournamentName: settings.tournamentName,
        breakYoutubeUrl: settings.breakYoutubeUrl,
        storeDurationTsv: settings.storeDurationTsv
      };

      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(saved));

      document.querySelector('#pw-blind-tournament-name').value = saved.tournamentName;
      document.querySelector('#pw-blind-break-url').value = saved.breakYoutubeUrl;
      document.querySelector('#pw-blind-store-duration').value = saved.storeDurationTsv;

      log(`設定を保存しました：${settings.tournamentName} / ${settings.storeRules.length}店舗`);
    } catch (e) {
      console.error('[盲注设置成功版] save settings error:', e);
      warn(`設定保存失敗：${e.message || e}`);
      alert(`設定保存失敗：${e.message || e}`);
    }
  }

  function getTournamentIdFromUrl() {
    const m = location.href.match(/\/painel\/(\d+)/);
    return m ? m[1] : '';
  }

  function isPainelPage() {
    return /\/torneio\/painel\/\d+/.test(location.href);
  }

  function getPageText() {
    return normalizeText(document.body.innerText || document.body.textContent || '');
  }

  function assertTournamentMatch(tournamentName) {
    const combined = `${normalizeText(document.title || '')} ${getPageText()}`;

    if (!combined.includes(tournamentName)) {
      throw new Error(`总大会名不一致。页面中找不到：${tournamentName}`);
    }
  }

  function detectStoreRule(storeRules) {
    const combined = `${normalizeText(document.title || '')} ${getPageText()}`;

    for (const config of storeRules) {
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

  function printPreview(rows, summary, config, settings) {
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
      ruleKey: config.ruleKey,
      existingLevelCount: summary.existingLevelCount,
      existingBreakCount: summary.existingBreakCount,
      targetLevelCount: summary.targetLevelCount,
      targetBreakCount: summary.targetBreakCount,
      newCount: summary.newCount,
      omitCount: summary.omitCount,
      breakLink: settings.breakYoutubeUrl
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

    const url = `/torneio/abas/blinds/ordenar_nivel?${params.toString()}`;

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
      : `/torneio/abas/blinds/niveis_editar/${idTorneio}`;

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

    const settings = loadRuntimeSettings();
    assertTournamentMatch(settings.tournamentName);

    const config = detectStoreRule(settings.storeRules);

    if (!config) {
      throw new Error(`无法识别店名。当前配置：${settings.storeRules.map(x => x.store).join(' / ')}`);
    }

    const rule = getRuntimeBlindRule(config.ruleKey, settings.breakYoutubeUrl);

    const form = findBlindForm();

    if (!form) {
      throw new Error('找不到 blind form。请先手动打开 ブラインド 界面。');
    }

    const rows = parseBlindRows(form);
    const summary = buildBackendPlan(rows, rule);

    printPreview(rows, summary, config, settings);

    return {
      settings,
      config,
      form,
      rows,
      summary
    };
  }

  async function previewOnly() {
    try {
      const result = loadPlan();

      log(`预览完成：${result.config.store} → ${result.config.ruleKey}分钟 / 新增 ${result.summary.newCount} 行，省略 ${result.summary.omitCount} 行`);

    } catch (e) {
      console.error('[盲注设置成功版] preview error:', e);
      warn(`预览失败：${e.message || e}`);
    }
  }

  async function applyDirectBackend() {
    try {
      const result = loadPlan();

      const { config, form, summary } = result;

      const ok = confirm(
        `确认后台直送盲注结构？\n\n` +
        `总大会名：${result.settings.tournamentName}\n` +
        `店名：${config.store}\n` +
        `规则：${config.ruleKey}分钟\n` +
        `Break Link：${result.settings.breakYoutubeUrl || '（空）'}\n` +
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
    const initialSettings = readSavedSettings();

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
      width: 430px;
      max-width: calc(100vw - 32px);
      max-height: calc(100vh - 32px);
      overflow-y: auto;
      box-sizing: border-box;
    `;

    panel.innerHTML = `
      <div style="font-weight:bold;margin-bottom:10px;">PW ブラインド設定</div>

      <label for="pw-blind-tournament-name"
        style="display:block;margin-bottom:4px;font-weight:bold;">
        总大会名 <span style="color:#ff9f9f;">（必填）</span>
      </label>
      <input id="pw-blind-tournament-name" type="text" autocomplete="off"
        value="${escapeHtml(initialSettings.tournamentName)}"
        placeholder="例：【JOPT 2026 Tokyo #02】"
        style="width:100%;box-sizing:border-box;margin-bottom:9px;padding:7px;">

      <label for="pw-blind-break-url"
        style="display:block;margin-bottom:4px;font-weight:bold;">
        全大会统一 Break Link <span style="color:#bbb;">（可空）</span>
      </label>
      <input id="pw-blind-break-url" type="text" autocomplete="off"
        value="${escapeHtml(initialSettings.breakYoutubeUrl)}"
        placeholder="空欄可 / https://..."
        style="width:100%;box-sizing:border-box;margin-bottom:9px;padding:7px;">

      <label for="pw-blind-store-duration"
        style="display:block;margin-bottom:4px;font-weight:bold;">
        店舗名 / Duration（TSV）
      </label>
      <textarea id="pw-blind-store-duration" rows="5" spellcheck="false"
        style="width:100%;box-sizing:border-box;margin-bottom:6px;padding:7px;resize:vertical;font-family:Consolas,monospace;font-size:12px;">${escapeHtml(initialSettings.storeDurationTsv)}</textarea>
      <div style="margin-bottom:9px;font-size:11px;color:#bbb;line-height:1.35;">
        表头：店舗名&lt;TAB&gt;Duration<br>
        Duration：20min / 25min / 30min / 40min
      </div>

      <button id="pw-blind-save-settings"
        style="width:100%;margin-bottom:9px;padding:7px;cursor:pointer;background:#b9e6c1;border:1px solid #719b78;">
        設定を保存
      </button>

      <button id="pw-blind-success-preview"
        style="width:100%;margin-bottom:6px;padding:6px;cursor:pointer;">
        Preview Backend Payload
      </button>

      <button id="pw-blind-success-apply"
        style="width:100%;margin-bottom:6px;padding:6px;cursor:pointer;background:#ffe08a;border:1px solid #c99;">
        APPLY Backend Direct
      </button>

      <div style="margin-top:8px;font-size:11px;color:#ccc;line-height:1.4;">
        四种 Blind 结构保存在脚本内部。<br>
        每次大会前请对照正式规则表确认。<br>
        手动打开ブラインド页面后再 Preview / Apply。
      </div>

      <div id="pw-blind-success-status"
        style="margin-top:8px;font-size:11px;color:#9fe;line-height:1.35;">
        ready
      </div>
    `;

    document.body.appendChild(panel);

    document.querySelector('#pw-blind-save-settings').onclick = () => savePanelSettings();
    document.querySelector('#pw-blind-success-preview').onclick = () => previewOnly();
    document.querySelector('#pw-blind-success-apply').onclick = () => applyDirectBackend();
  }

  function boot() {
    addPanel();

    window.PWBlindSuccess = {
      previewOnly,
      applyDirectBackend,
      loadPlan,
      loadRuntimeSettings,
      readSavedSettings,
      savePanelSettings,
      parseStoreDurationTsv,
      DEFAULT_SETTINGS,
      BLIND_RULES,
      STRUCTURE_SETTINGS
    };

    log('ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
