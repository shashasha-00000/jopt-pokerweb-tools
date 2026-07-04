// ==UserScript==
// @name         PW Prize Delete API Capture Test
// @namespace    https://japanopt.pokerweb.com.br/
// @version      0.1.0
// @description  TEST ONLY: capture prize delete/save payloads across reloads.
// @match        https://japanopt.pokerweb.com.br/cb/torneio/painel/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const KEY = 'PW_PRIZE_DELETE_API_CAPTURE_LOG_V1';
  const BLOCK_KEY = 'PW_PRIZE_DELETE_API_CAPTURE_BLOCK_V1';
  const PANEL_ID = 'pw-prize-delete-api-capture';

  function readLog() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '[]');
    } catch (_) {
      return [];
    }
  }

  function writeLog(rows) {
    localStorage.setItem(KEY, JSON.stringify(rows));
  }

  function isBlockOn() {
    return localStorage.getItem(BLOCK_KEY) !== '0';
  }

  function setBlockOn(value) {
    localStorage.setItem(BLOCK_KEY, value ? '1' : '0');
  }

  function norm(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function dumpBody(body) {
    try {
      if (body instanceof FormData) return [...body.entries()];
      if (body instanceof URLSearchParams) return [...body.entries()];
      if (typeof body === 'string') return body;
      return String(body ?? '');
    } catch (error) {
      return `DUMP_ERROR: ${error.message || error}`;
    }
  }

  function formSnapshot(form) {
    if (!form) return null;
    let body = [];
    try {
      body = [...new FormData(form).entries()];
    } catch (error) {
      body = [['FORMDATA_ERROR', error.message || String(error)]];
    }
    return {
      action: form.action || '',
      method: form.method || '',
      id: form.id || '',
      className: form.className || '',
      body
    };
  }

  function isPrizeSaveForm(form) {
    if (!form) return false;
    const snap = formSnapshot(form);
    const body = snap?.body || [];
    return body.some(([key, value]) => key === 'salvar' && value === 'prizes')
      || /prizes|premiacao|faixas_premiacoes/i.test(`${snap?.action || ''} ${snap?.id || ''}`);
  }

  function isPrizeSaveRequest(url, body) {
    const text = `${url || ''} ${typeof body === 'string' ? body : JSON.stringify(dumpBody(body))}`;
    return /faixas_premiacoes|salvar.?prizes|%22salvar%22|id_excluir/i.test(text);
  }

  function pageInfo() {
    return {
      href: location.href,
      title: document.title,
      tournamentId: location.pathname.match(/\/cb\/torneio\/painel\/(\d+)/)?.[1] || ''
    };
  }

  function push(type, data = {}) {
    const rows = readLog();
    rows.push({
      time: new Date().toISOString(),
      type,
      ...pageInfo(),
      ...data
    });
    writeLog(rows);
    console.log('[PW Prize Delete API Capture]', type, data);
  }

  async function copyLog() {
    const text = JSON.stringify(readLog(), null, 2);
    console.log(text);
    try {
      await navigator.clipboard.writeText(text);
      alert('DELETE API LOG copied.');
    } catch (_) {
      prompt('Copy this DELETE API LOG:', text);
    }
  }

  function clearLog() {
    localStorage.removeItem(KEY);
    push('log-cleared');
    alert('DELETE API LOG cleared.');
  }

  function installHooks() {
    if (window.__PW_PRIZE_DELETE_CAPTURE_INSTALLED__) return;
    window.__PW_PRIZE_DELETE_CAPTURE_INSTALLED__ = true;

    const oldFetch = window.fetch;
    window.fetch = async function (input, init = {}) {
      const url = typeof input === 'string' ? input : input?.url;
      push('fetch-request', {
        method: init?.method || 'GET',
        requestUrl: url || '',
        body: dumpBody(init?.body)
      });
      if (isBlockOn() && isPrizeSaveRequest(url, init?.body)) {
        push('fetch-blocked', {
          method: init?.method || 'GET',
          requestUrl: url || '',
          body: dumpBody(init?.body)
        });
        return new Response('PW Prize Delete Capture blocked this request.', { status: 299, statusText: 'Blocked by capture test' });
      }
      const res = await oldFetch.apply(this, arguments);
      push('fetch-response', { status: res.status, requestUrl: url || '' });
      return res;
    };

    const oldOpen = XMLHttpRequest.prototype.open;
    const oldSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__pwMethod = method;
      this.__pwUrl = url;
      return oldOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      push('xhr-request', {
        method: this.__pwMethod || '',
        requestUrl: this.__pwUrl || '',
        body: dumpBody(body)
      });
      if (isBlockOn() && isPrizeSaveRequest(this.__pwUrl, body)) {
        push('xhr-blocked', {
          method: this.__pwMethod || '',
          requestUrl: this.__pwUrl || '',
          body: dumpBody(body)
        });
        return undefined;
      }
      return oldSend.apply(this, arguments);
    };

    const oldSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
      push('form-submit-prototype', formSnapshot(this));
      if (isBlockOn() && isPrizeSaveForm(this)) {
        push('form-submit-blocked', formSnapshot(this));
        return undefined;
      }
      return oldSubmit.apply(this, arguments);
    };

    const oldRequestSubmit = HTMLFormElement.prototype.requestSubmit;
    if (oldRequestSubmit) {
      HTMLFormElement.prototype.requestSubmit = function () {
        push('form-requestSubmit-prototype', formSnapshot(this));
        if (isBlockOn() && isPrizeSaveForm(this)) {
          push('form-requestSubmit-blocked', formSnapshot(this));
          return undefined;
        }
        return oldRequestSubmit.apply(this, arguments);
      };
    }

    document.addEventListener('submit', event => {
      push('form-submit-event', formSnapshot(event.target));
      if (isBlockOn() && isPrizeSaveForm(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        push('form-submit-event-blocked', formSnapshot(event.target));
      }
    }, true);

    document.addEventListener('click', event => {
      const target = event.target?.closest?.('button,input,a,span,i');
      if (!target) return;
      const text = norm(target.textContent || target.value || target.title || target.getAttribute('aria-label') || '');
      const html = String(target.outerHTML || '').slice(0, 1200);
      const klass = target.className || '';
      const haystack = `${text} ${html} ${klass}`;
      const maybeRelevant = /保存|save|salvar|gravar|削除|delete|remove|trash|fa-times|fa-trash|btn-danger|text-danger|excluir|remover/i.test(haystack);
      if (!maybeRelevant) return;
      const form = target.closest('form') || document.querySelector('#prizes_tela') || document.querySelector('form');
      push('relevant-click', {
        buttonText: text,
        className: String(klass),
        html,
        form: formSnapshot(form)
      });
      if (/保存|save|salvar|gravar/i.test(haystack)) {
        setTimeout(() => push('after-save-click-0ms', { form: formSnapshot(form) }), 0);
        setTimeout(() => push('after-save-click-100ms', { form: formSnapshot(form) }), 100);
        setTimeout(() => push('after-save-click-500ms', { form: formSnapshot(form) }), 500);
      }
    }, true);

    push('logger-installed');
  }

  function mountPanel() {
    if (document.getElementById(PANEL_ID)) return;
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
      'position:fixed',
      'right:18px',
      'bottom:18px',
      'z-index:999999',
      'display:flex',
      'gap:8px',
      'align-items:center',
      'background:#111827',
      'color:#e5e7eb',
      'border:1px solid #475569',
      'border-radius:8px',
      'padding:10px',
      'box-shadow:0 10px 28px rgba(0,0,0,.35)',
      'font-family:Arial,"Yu Gothic","Meiryo",sans-serif'
    ].join(';');
    panel.innerHTML = `
      <strong>Prize Delete Capture</strong>
      <button id="pwPrizeDeleteBlock" type="button"></button>
      <button id="pwPrizeDeleteCopy" type="button">Copy</button>
      <button id="pwPrizeDeleteClear" type="button">Clear</button>
    `;
    document.body.appendChild(panel);
    for (const button of panel.querySelectorAll('button')) {
      button.style.cssText = 'border:0;border-radius:6px;padding:8px 10px;font-weight:700;cursor:pointer;';
    }
    const blockButton = panel.querySelector('#pwPrizeDeleteBlock');
    function refreshBlockButton() {
      blockButton.textContent = isBlockOn() ? 'BLOCK ON' : 'BLOCK OFF';
      blockButton.style.background = isBlockOn() ? '#f97316' : '#475569';
      blockButton.style.color = '#fff';
    }
    blockButton.onclick = () => {
      setBlockOn(!isBlockOn());
      push('block-mode-changed', { blockOn: isBlockOn() });
      refreshBlockButton();
    };
    refreshBlockButton();
    panel.querySelector('#pwPrizeDeleteCopy').onclick = copyLog;
    panel.querySelector('#pwPrizeDeleteClear').onclick = clearLog;
  }

  installHooks();
  mountPanel();
})();
