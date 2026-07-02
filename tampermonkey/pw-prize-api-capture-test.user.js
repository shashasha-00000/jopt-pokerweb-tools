// ==UserScript==
// @name         PW Prize API Capture Test
// @namespace    https://japanopt.pokerweb.com.br/
// @version      0.1.0
// @description  TEST ONLY: persistently capture Prize save requests across reloads.
// @match        https://japanopt.pokerweb.com.br/cb/torneio/painel/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const KEY = 'PW_PRIZE_API_CAPTURE_TEST_LOG_V1';
  const PANEL_ID = 'pw-prize-api-capture-test';

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
      body = [[`FORMDATA_ERROR`, error.message || String(error)]];
    }
    return {
      action: form.action || '',
      method: form.method || '',
      id: form.id || '',
      className: form.className || '',
      body
    };
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
    console.log('[PW Prize API Capture]', type, data);
  }

  async function copyLog() {
    const text = JSON.stringify(readLog(), null, 2);
    console.log(text);
    try {
      await navigator.clipboard.writeText(text);
      alert('API Capture LOGをコピーしました。');
    } catch (_) {
      prompt('コピーしてください', text);
    }
  }

  function clearLog() {
    localStorage.removeItem(KEY);
    push('log-cleared');
    alert('API Capture LOGをクリアしました。');
  }

  function installNetworkHooks() {
    if (window.__PW_PRIZE_API_CAPTURE_INSTALLED__) return;
    window.__PW_PRIZE_API_CAPTURE_INSTALLED__ = true;

    const oldFetch = window.fetch;
    window.fetch = async function (input, init = {}) {
      const url = typeof input === 'string' ? input : input?.url;
      push('fetch-request', {
        method: init?.method || 'GET',
        requestUrl: url || '',
        body: dumpBody(init?.body)
      });
      const res = await oldFetch.apply(this, arguments);
      push('fetch-response', {
        status: res.status,
        requestUrl: url || ''
      });
      return res;
    };

    const oldOpen = XMLHttpRequest.prototype.open;
    const oldSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__pwPrizeCaptureMethod = method;
      this.__pwPrizeCaptureUrl = url;
      return oldOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      push('xhr-request', {
        method: this.__pwPrizeCaptureMethod || '',
        requestUrl: this.__pwPrizeCaptureUrl || '',
        body: dumpBody(body)
      });
      return oldSend.apply(this, arguments);
    };

    const oldSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
      push('form-submit-prototype', formSnapshot(this));
      return oldSubmit.apply(this, arguments);
    };

    const oldRequestSubmit = HTMLFormElement.prototype.requestSubmit;
    if (oldRequestSubmit) {
      HTMLFormElement.prototype.requestSubmit = function () {
        push('form-requestSubmit-prototype', formSnapshot(this));
        return oldRequestSubmit.apply(this, arguments);
      };
    }

    document.addEventListener('submit', event => {
      push('form-submit-event', formSnapshot(event.target));
    }, true);

    document.addEventListener('click', event => {
      const target = event.target?.closest?.('button,input,a');
      if (!target) return;
      const text = norm(target.textContent || target.value || target.title || target.getAttribute('aria-label') || '');
      const html = String(target.outerHTML || '').slice(0, 500);
      const maybeSave = /保存|save|salvar|gravar/i.test(`${text} ${html}`);
      if (!maybeSave) return;
      const form = target.closest('form');
      push('save-click', {
        buttonText: text,
        buttonHtml: html,
        form: formSnapshot(form)
      });
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
      <strong>Prize API Capture</strong>
      <button id="pwPrizeApiCaptureCopy">Copy</button>
      <button id="pwPrizeApiCaptureClear">Clear</button>
    `;
    document.body.appendChild(panel);

    for (const button of panel.querySelectorAll('button')) {
      button.style.cssText = 'border:0;border-radius:6px;padding:8px 10px;font-weight:700;cursor:pointer;';
    }
    panel.querySelector('#pwPrizeApiCaptureCopy').onclick = copyLog;
    panel.querySelector('#pwPrizeApiCaptureClear').onclick = clearLog;
  }

  installNetworkHooks();
  mountPanel();
})();
