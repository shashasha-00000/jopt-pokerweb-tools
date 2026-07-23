// ==UserScript==
// @name         PW 共通パネル移動・最小化
// @namespace    https://japanopt.pokerweb.com.br/
// @version      0.1.1
// @description  PokerWeb用Tampermonkeyツールの固定パネルをドラッグ移動・最小化し、URL Cache Managerとの重なりを避けます。
// @match        https://japanopt.pokerweb.com.br/*
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-panel-drag-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-panel-drag-helper.user.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const STATE_PREFIX = 'PW_PANEL_DRAG_HELPER_V1:';
  const URL_MANAGER_ID = 'pw-url-cache-panel';
  const PANEL_GAP = 12;
  const VIEWPORT_PADDING = 6;
  let reflowScheduled = false;

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

  function isVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }

  function overlaps(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
  }

  function rectAt(left, top, width, height) {
    return { left, top, right: left + width, bottom: top + height, width, height };
  }

  function candidatePositions(panelRect, managerRect) {
    const maxLeft = window.innerWidth - panelRect.width - VIEWPORT_PADDING;
    const maxTop = window.innerHeight - panelRect.height - VIEWPORT_PADDING;
    const currentTop = clamp(panelRect.top, VIEWPORT_PADDING, maxTop);
    const currentLeft = clamp(panelRect.left, VIEWPORT_PADDING, maxLeft);
    return [
      {
        left: managerRect.left - panelRect.width - PANEL_GAP,
        top: currentTop
      },
      {
        left: currentLeft,
        top: managerRect.top - panelRect.height - PANEL_GAP
      },
      {
        left: managerRect.right + PANEL_GAP,
        top: currentTop
      },
      {
        left: currentLeft,
        top: managerRect.bottom + PANEL_GAP
      }
    ].filter(position => {
      const candidate = rectAt(position.left, position.top, panelRect.width, panelRect.height);
      return candidate.left >= VIEWPORT_PADDING &&
        candidate.top >= VIEWPORT_PADDING &&
        candidate.right <= window.innerWidth - VIEWPORT_PADDING &&
        candidate.bottom <= window.innerHeight - VIEWPORT_PADDING &&
        !overlaps(candidate, managerRect);
    });
  }

  function avoidUrlManager(panel) {
    if (panel.dataset.pwPanelDragging === '1') return false;
    const manager = document.getElementById(URL_MANAGER_ID);
    if (!isVisible(panel) || !isVisible(manager)) return false;

    const panelRect = panel.getBoundingClientRect();
    const managerRect = manager.getBoundingClientRect();
    if (!overlaps(panelRect, managerRect)) return false;

    const candidates = candidatePositions(panelRect, managerRect)
      .sort((a, b) => {
        const distanceA = Math.abs(a.left - panelRect.left) + Math.abs(a.top - panelRect.top);
        const distanceB = Math.abs(b.left - panelRect.left) + Math.abs(b.top - panelRect.top);
        return distanceA - distanceB;
      });

    if (!candidates.length && manager.dataset.collapsed !== '1') {
      const minimize = manager.querySelector('#pw-url-cache-minimize');
      if (minimize instanceof HTMLElement) {
        minimize.click();
        scheduleReflow();
        return true;
      }
    }

    const target = candidates[0] || {
      left: VIEWPORT_PADDING,
      top: VIEWPORT_PADDING
    };
    panel.style.left = `${Math.round(target.left)}px`;
    panel.style.top = `${Math.round(target.top)}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    saveState(panel.id, { left: Math.round(target.left), top: Math.round(target.top) });
    return true;
  }

  function reflowManagedPanels() {
    document.querySelectorAll('[data-pw-panel-drag-helper="1"]').forEach(panel => {
      avoidUrlManager(panel);
    });
  }

  function scheduleReflow() {
    if (reflowScheduled) return;
    reflowScheduled = true;
    requestAnimationFrame(() => {
      reflowScheduled = false;
      reflowManagedPanels();
    });
  }

  function watchUrlManager() {
    const manager = document.getElementById(URL_MANAGER_ID);
    if (!(manager instanceof HTMLElement) || manager.dataset.pwPanelAvoidWatch === '1') return;
    manager.dataset.pwPanelAvoidWatch = '1';
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(scheduleReflow).observe(manager);
    }
    manager.addEventListener('click', event => {
      if (event.target.closest('#pw-url-cache-minimize')) setTimeout(scheduleReflow, 0);
    });
    scheduleReflow();
  }

  function isToolPanel(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.dataset.pwPanelDragHelper === '1') return false;
    if (el.id === URL_MANAGER_ID) return false;
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
        scheduleReflow();
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
      panel.dataset.pwPanelDragging = '1';
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
      panel.dataset.pwPanelDragging = '0';
      avoidUrlManager(panel);
      const rect = panel.getBoundingClientRect();
      saveState(id, { left: Math.round(rect.left), top: Math.round(rect.top) });
      try { bar.releasePointerCapture(event.pointerId); } catch (_) {}
    });
    bar.addEventListener('pointercancel', event => {
      dragging = null;
      panel.dataset.pwPanelDragging = '0';
      scheduleReflow();
      try { bar.releasePointerCapture(event.pointerId); } catch (_) {}
    });

    scheduleReflow();
  }

  function scan() {
    watchUrlManager();
    document.querySelectorAll('[id^="pw"],[id^="PW"]').forEach(el => {
      if (isToolPanel(el)) attach(el);
    });
    scheduleReflow();
  }

  scan();
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', scheduleReflow);
})();
