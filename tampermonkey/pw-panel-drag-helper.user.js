// ==UserScript==
// @name         PW 共通パネル移動・最小化
// @namespace    https://japanopt.pokerweb.com.br/
// @version      0.1.0
// @description  PokerWeb用Tampermonkeyツールの固定パネルをドラッグ移動・最小化できるようにします。
// @match        https://japanopt.pokerweb.com.br/*
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-panel-drag-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-panel-drag-helper.user.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const STATE_PREFIX = 'PW_PANEL_DRAG_HELPER_V1:';

  function loadState(id) {
    try {
      return JSON.parse(localStorage.getItem(STATE_PREFIX + id) || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function saveState(id, patch) {
    const next = { ...loadState(id), ...patch };
    localStorage.setItem(STATE_PREFIX + id, JSON.stringify(next));
  }

  function isToolPanel(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.dataset.pwPanelDragHelper === '1') return false;
    if (!/^pw/i.test(el.id || '')) return false;
    const style = getComputedStyle(el);
    return style.position === 'fixed';
  }

  function hasOwnMinButton(panel) {
    return [...panel.querySelectorAll('button')]
      .some(button => /Min|復元|最小化/i.test((button.textContent || '').trim()));
  }

  function setMinimized(panel, bar, minimized) {
    for (const child of [...panel.children]) {
      if (child === bar) continue;
      if (minimized) {
        child.dataset.pwPrevDisplay = child.style.display || '';
        child.style.display = 'none';
      } else {
        child.style.display = child.dataset.pwPrevDisplay || '';
        delete child.dataset.pwPrevDisplay;
      }
    }
    panel.dataset.pwPanelMinimized = minimized ? '1' : '0';
    const button = bar.querySelector('button[data-pw-helper-min]');
    if (button) button.textContent = minimized ? '復元' : 'Min';
  }

  function attach(panel) {
    panel.dataset.pwPanelDragHelper = '1';
    const id = panel.id;
    const state = loadState(id);

    if (Number.isFinite(state.left) && Number.isFinite(state.top)) {
      panel.style.left = `${state.left}px`;
      panel.style.top = `${state.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }

    const bar = document.createElement('div');
    bar.setAttribute('data-pw-helper-bar', '1');
    bar.style.cssText = [
      'display:flex',
      'align-items:center',
      'justify-content:flex-end',
      'gap:6px',
      'height:20px',
      'margin:-4px -4px 6px',
      'cursor:move',
      'user-select:none',
      'font:12px Arial,"Yu Gothic","Meiryo",sans-serif',
      'color:#cbd5e1'
    ].join(';');
    bar.innerHTML = `<span title="ドラッグで移動">移動</span>`;
    if (!hasOwnMinButton(panel)) {
      const min = document.createElement('button');
      min.type = 'button';
      min.textContent = 'Min';
      min.setAttribute('data-pw-helper-min', '1');
      min.style.cssText = 'padding:2px 8px;border:0;border-radius:4px;background:#374151;color:white;font-weight:700;cursor:pointer;';
      min.addEventListener('click', event => {
        event.stopPropagation();
        const next = panel.dataset.pwPanelMinimized !== '1';
        setMinimized(panel, bar, next);
        saveState(id, { minimized: next });
      });
      bar.appendChild(min);
    }
    panel.insertBefore(bar, panel.firstChild);

    if (state.minimized && !hasOwnMinButton(panel)) setMinimized(panel, bar, true);

    let dragging = null;
    bar.addEventListener('pointerdown', event => {
      if (event.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      dragging = {
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top
      };
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      bar.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    bar.addEventListener('pointermove', event => {
      if (!dragging) return;
      const nextLeft = Math.max(0, dragging.left + event.clientX - dragging.startX);
      const nextTop = Math.max(0, dragging.top + event.clientY - dragging.startY);
      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
    });
    bar.addEventListener('pointerup', event => {
      if (!dragging) return;
      dragging = null;
      const rect = panel.getBoundingClientRect();
      saveState(id, { left: Math.round(rect.left), top: Math.round(rect.top) });
      try { bar.releasePointerCapture(event.pointerId); } catch (_) {}
    });
  }

  function scan() {
    document.querySelectorAll('[id^="pw"],[id^="PW"]').forEach(el => {
      if (isToolPanel(el)) attach(el);
    });
  }

  scan();
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
})();
