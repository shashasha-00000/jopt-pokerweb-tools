// ==UserScript==
// @name         PW 共通パネル移動・最小化
// @namespace    https://japanopt.pokerweb.com.br/
// @version      0.2.0
// @description  PokerWeb用Tampermonkeyツールの通常パネルをドラッグ移動し、選択中のパネルを最前面に表示します。
// @match        https://japanopt.pokerweb.com.br/*
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-panel-drag-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-panel-drag-helper.user.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const STATE_PREFIX = 'PW_PANEL_DRAG_HELPER_V1:';
  const VIEWPORT_PADDING = 6;
  const Z_INDEX_BASE = 999900;
  const Z_INDEX_MAX = 1000000;
  const STACK_ONLY_PANEL_IDS = new Set(['pw-url-cache-panel']);
  const MANAGED_PANEL_IDS = new Set([
    'pwctq-panel',
    'pw-fee-patch-panel',
    'pw-main-event-ticket-checker',
    'pwnt-panel',
    'pw-prize-plan-panel',
    'pw-prize-gameid-test-panel',
    'pw-full-auto-v7-panel',
    'pw-manual-panel',
    'pwAwardPlanPanel',
    'pw-ticket-link-panel',
    'pw-blind-success-panel',
    'pw-close-audit-batch-panel',
    'pw-bg-poc-panel',
    'pw-dc-v20-panel'
  ]);
  const attachedPanels = new WeakSet();
  const stackedPanels = new WeakSet();
  let frontSequence = 0;
  let viewportClampScheduled = false;

  function loadState(id) {
    try {
      return JSON.parse(localStorage.getItem(STATE_PREFIX + id) || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function savePosition(panel) {
    const rect = panel.getBoundingClientRect();
    const previous = loadState(panel.id);
    localStorage.setItem(STATE_PREFIX + panel.id, JSON.stringify({
      ...previous,
      left: Math.round(rect.left),
      top: Math.round(rect.top)
    }));
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
  }

  function clampedPosition(panel, left, top) {
    const rect = panel.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - VIEWPORT_PADDING;
    const maxTop = window.innerHeight - rect.height - VIEWPORT_PADDING;
    return {
      left: clamp(left, VIEWPORT_PADDING, maxLeft),
      top: clamp(top, VIEWPORT_PADDING, maxTop)
    };
  }

  function placePanel(panel, left, top) {
    const next = clampedPosition(panel, left, top);
    panel.style.left = `${Math.round(next.left)}px`;
    panel.style.top = `${Math.round(next.top)}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function clampPanelToViewport(panel, persist) {
    if (!panel.isConnected || getComputedStyle(panel).display === 'none') return;
    const rect = panel.getBoundingClientRect();
    const next = clampedPosition(panel, rect.left, rect.top);
    if (Math.round(next.left) === Math.round(rect.left) && Math.round(next.top) === Math.round(rect.top)) return;
    placePanel(panel, next.left, next.top);
    if (persist) savePosition(panel);
  }

  function scheduleViewportClamp() {
    if (viewportClampScheduled) return;
    viewportClampScheduled = true;
    requestAnimationFrame(() => {
      viewportClampScheduled = false;
      document.querySelectorAll('[data-pw-panel-drag-helper="1"]').forEach(panel => {
        clampPanelToViewport(panel, true);
      });
    });
  }

  function normalizeZIndexes() {
    const panels = [...document.querySelectorAll('[data-pw-panel-stack-helper="1"]')]
      .filter(panel => panel instanceof HTMLElement && panel.isConnected)
      .sort((a, b) => Number(a.dataset.pwPanelFrontOrder || 0) - Number(b.dataset.pwPanelFrontOrder || 0));
    panels.forEach((panel, index) => {
      const order = index + 1;
      panel.dataset.pwPanelFrontOrder = String(order);
      panel.style.zIndex = String(Math.min(Z_INDEX_BASE + order, Z_INDEX_MAX));
    });
    frontSequence = panels.length;
  }

  function bringToFront(panel) {
    frontSequence += 1;
    if (Z_INDEX_BASE + frontSequence > Z_INDEX_MAX) {
      normalizeZIndexes();
      frontSequence += 1;
    }
    panel.dataset.pwPanelFrontOrder = String(frontSequence);
    panel.style.zIndex = String(Math.min(Z_INDEX_BASE + frontSequence, Z_INDEX_MAX));
  }

  function attachStacking(panel) {
    if (stackedPanels.has(panel)) return;
    stackedPanels.add(panel);
    panel.dataset.pwPanelStackHelper = '1';
    panel.addEventListener('pointerdown', () => bringToFront(panel), true);
    bringToFront(panel);
  }

  function isManagedPanel(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (!MANAGED_PANEL_IDS.has(el.id)) return false;
    return getComputedStyle(el).position === 'fixed';
  }

  function attach(panel) {
    if (attachedPanels.has(panel)) return;
    attachedPanels.add(panel);
    panel.dataset.pwPanelDragHelper = '1';

    const state = loadState(panel.id);
    if (Number.isFinite(state.left) && Number.isFinite(state.top)) {
      placePanel(panel, state.left, state.top);
    }

    const bar = document.createElement('div');
    bar.setAttribute('data-pw-helper-bar', '1');
    bar.title = 'ドラッグで移動';
    bar.textContent = '移動';
    bar.style.cssText = [
      'display:flex',
      'align-items:center',
      'justify-content:flex-end',
      'height:20px',
      'margin:-4px -4px 6px',
      'cursor:move',
      'touch-action:none',
      'user-select:none',
      'font:12px Arial,"Yu Gothic","Meiryo",sans-serif',
      'color:#cbd5e1'
    ].join(';');
    panel.insertBefore(bar, panel.firstChild);

    attachStacking(panel);

    let dragging = null;
    bar.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      const rect = panel.getBoundingClientRect();
      dragging = {
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top
      };
      placePanel(panel, rect.left, rect.top);
      bar.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    bar.addEventListener('pointermove', event => {
      if (!dragging) return;
      placePanel(
        panel,
        dragging.left + event.clientX - dragging.startX,
        dragging.top + event.clientY - dragging.startY
      );
    });
    bar.addEventListener('pointerup', event => {
      if (!dragging) return;
      dragging = null;
      savePosition(panel);
      try { bar.releasePointerCapture(event.pointerId); } catch (_) {}
    });
    bar.addEventListener('pointercancel', event => {
      dragging = null;
      clampPanelToViewport(panel, true);
      try { bar.releasePointerCapture(event.pointerId); } catch (_) {}
    });

    requestAnimationFrame(() => clampPanelToViewport(panel, true));
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => clampPanelToViewport(panel, true)).observe(panel);
    }
  }

  function scan(root) {
    if (isManagedPanel(root)) attach(root);
    if (root instanceof HTMLElement && STACK_ONLY_PANEL_IDS.has(root.id)) attachStacking(root);
    if (!(root instanceof Document || root instanceof DocumentFragment || root instanceof HTMLElement)) return;
    for (const id of MANAGED_PANEL_IDS) {
      const panel = root.querySelector(`#${CSS.escape(id)}`);
      if (isManagedPanel(panel)) attach(panel);
    }
    for (const id of STACK_ONLY_PANEL_IDS) {
      const panel = root.querySelector(`#${CSS.escape(id)}`);
      if (panel instanceof HTMLElement) attachStacking(panel);
    }
  }

  scan(document);
  new MutationObserver(records => {
    records.forEach(record => {
      record.addedNodes.forEach(node => scan(node));
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', scheduleViewportClamp);
})();
