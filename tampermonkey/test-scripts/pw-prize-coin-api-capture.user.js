// ==UserScript==
// @name         PW Prize Coin API Capture Test
// @namespace    https://japanopt.bt.pokerweb.com.br/
// @version      0.1.1
// @description  TEST ONLY: capture cashier prize coin payloads and responses.
// @match        https://japanopt.bt.pokerweb.com.br/torneio/painel/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const KEY = 'PW_PRIZE_COIN_API_CAPTURE_LOG_V1';
  const BLOCK_KEY = 'PW_PRIZE_COIN_API_CAPTURE_BLOCK_V1';
  const PANEL_ID = 'pw-prize-coin-api-capture';
  const TARGET_RE = /\/torneio\/abas\/caixa\/(envio_moedas|dados_caixa|informacoes)\b/i;

  function norm(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

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
    return localStorage.getItem(BLOCK_KEY) === '1';
  }

  function setBlockOn(value) {
    localStorage.setItem(BLOCK_KEY, value ? '1' : '0');
  }

  function pageInfo() {
    return {
      href: location.href,
      title: document.title,
      tournamentId: location.pathname.match(/\/torneio\/painel\/(\d+)/)?.[1] || ''
    };
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
      className: String(form.className || ''),
      body
    };
  }

  function isTargetUrl(url) {
    return TARGET_RE.test(String(url || ''));
  }

  function isTargetForm(form) {
    return isTargetUrl(form?.action || '') || !!form?.querySelector?.('[name="id_jogador"],[name="valor"],[name="codbloq"]');
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
    console.log('[PW Prize Coin API Capture]', type, data);
  }

  async function copyLog() {
    const text = JSON.stringify(readLog(), null, 2);
    console.log(text);
    try {
      await navigator.clipboard.writeText(text);
      alert('PRIZE COIN API LOG copied.');
    } catch (_) {
      prompt('Copy this PRIZE COIN API LOG:', text);
    }
  }

  function clearLog() {
    localStorage.removeItem(KEY);
    push('log-cleared');
    alert('PRIZE COIN API LOG cleared.');
  }

  async function responsePreview(response) {
    try {
      const text = await response.clone().text();
      return text.slice(0, 4000);
    } catch (error) {
      return `RESPONSE_READ_ERROR: ${error.message || error}`;
    }
  }

  function installHooks() {
    if (window.__PW_PRIZE_COIN_API_CAPTURE_INSTALLED__) return;
    window.__PW_PRIZE_COIN_API_CAPTURE_INSTALLED__ = true;

    const oldFetch = window.fetch;
    window.fetch = async function (input, init = {}) {
      const url = typeof input === 'string' ? input : input?.url;
      if (isTargetUrl(url)) {
        const method = init?.method || 'GET';
        const body = dumpBody(init?.body);
        push('fetch-request', { method, requestUrl: url || '', body });
        if (isBlockOn() && /envio_moedas/i.test(String(url || ''))) {
          push('fetch-blocked', { method, requestUrl: url || '', body });
          return new Response('PW Prize Coin API Capture blocked envio_moedas.', {
            status: 299,
            statusText: 'Blocked by capture test'
          });
        }
        const res = await oldFetch.apply(this, arguments);
        push('fetch-response', {
          method,
          requestUrl: url || '',
          status: res.status,
          statusText: res.statusText,
          textPreview: await responsePreview(res)
        });
        return res;
      }
      return oldFetch.apply(this, arguments);
    };

    const oldOpen = XMLHttpRequest.prototype.open;
    const oldSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__pwPrizeCoinMethod = method;
      this.__pwPrizeCoinUrl = url;
      return oldOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      const url = this.__pwPrizeCoinUrl || '';
      const method = this.__pwPrizeCoinMethod || '';
      if (isTargetUrl(url)) {
        const dumpedBody = dumpBody(body);
        push('xhr-request', { method, requestUrl: url, body: dumpedBody });
        if (isBlockOn() && /envio_moedas/i.test(String(url))) {
          push('xhr-blocked', { method, requestUrl: url, body: dumpedBody });
          return undefined;
        }
        this.addEventListener('loadend', () => {
          push('xhr-response', {
            method,
            requestUrl: url,
            status: this.status,
            statusText: this.statusText,
            textPreview: String(this.responseText || '').slice(0, 4000)
          });
        });
      }
      return oldSend.apply(this, arguments);
    };

    const oldSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
      if (isTargetForm(this)) {
        push('form-submit-prototype', formSnapshot(this));
        if (isBlockOn() && /envio_moedas/i.test(String(this.action || ''))) {
          push('form-submit-blocked', formSnapshot(this));
          return undefined;
        }
      }
      return oldSubmit.apply(this, arguments);
    };

    const oldRequestSubmit = HTMLFormElement.prototype.requestSubmit;
    if (oldRequestSubmit) {
      HTMLFormElement.prototype.requestSubmit = function () {
        if (isTargetForm(this)) {
          push('form-requestSubmit-prototype', formSnapshot(this));
          if (isBlockOn() && /envio_moedas/i.test(String(this.action || ''))) {
            push('form-requestSubmit-blocked', formSnapshot(this));
            return undefined;
          }
        }
        return oldRequestSubmit.apply(this, arguments);
      };
    }

    document.addEventListener('submit', event => {
      if (!isTargetForm(event.target)) return;
      push('form-submit-event', formSnapshot(event.target));
      if (isBlockOn() && /envio_moedas/i.test(String(event.target.action || ''))) {
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
      const haystack = `${text} ${html} ${target.className || ''}`;
      if (!/保存|save|salvar|送金|coin|moeda|入力|btn/i.test(haystack)) return;
      const form = target.closest('form') || document.querySelector('form[action*="envio_moedas"]') || document.querySelector('#form_caixa');
      push('relevant-click', {
        buttonText: text,
        className: String(target.className || ''),
        html,
        form: formSnapshot(form)
      });
      setTimeout(() => push('after-click-100ms', { form: formSnapshot(form) }), 100);
      setTimeout(() => push('after-click-500ms', { form: formSnapshot(form) }), 500);
    }, true);

    push('logger-installed', { blockOn: isBlockOn() });
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
      <strong>Prize Coin Capture</strong>
      <button id="pwPrizeCoinBlock" type="button"></button>
      <button id="pwPrizeCoinCopy" type="button">Copy</button>
      <button id="pwPrizeCoinClear" type="button">Clear</button>
    `;
    document.body.appendChild(panel);
    for (const button of panel.querySelectorAll('button')) {
      button.style.cssText = 'border:0;border-radius:6px;padding:8px 10px;font-weight:700;cursor:pointer;';
    }
    const blockButton = panel.querySelector('#pwPrizeCoinBlock');
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
    panel.querySelector('#pwPrizeCoinCopy').onclick = copyLog;
    panel.querySelector('#pwPrizeCoinClear').onclick = clearLog;
  }

  installHooks();
  mountPanel();
})();
