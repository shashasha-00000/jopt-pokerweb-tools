// ==UserScript==
// @name         PW Batch Entry Helper
// @namespace    pw-batch-entry-helper
// @version      0.1.0
// @description  Paste a TSV queue and fill PokerWeb Cashier entries one by one. Never submits the final form.
// @match        https://japanopt.pokerweb.com.br/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const LOG_PREFIX = "[PW-BATCH-ENTRY]";
  const STORAGE = {
    raw: "PW_BATCH_ENTRY_RAW_V1",
    queue: "PW_BATCH_ENTRY_QUEUE_V1",
    index: "PW_BATCH_ENTRY_INDEX_V1",
    active: "PW_BATCH_ENTRY_ACTIVE_V1",
    log: "PW_BATCH_ENTRY_LOG_V1"
  };

  const PAYMENT_INPUTS = {
    cash: "pgto[1]",
    credit_card: "pgto[3]",
    coin: "pgto[moedas]",
    usdt: "pgto[38]",
    contract: "pgto[40]"
  };

  const REQUIRED_HEADERS = [
    "enabled", "tournament_id", "tournament_name", "game_id", "entry_mode",
    "cash", "credit_card", "coin", "usdt", "contract", "voucher_ticket",
    "main_ticket_count", "memo"
  ];

  let running = false;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function log() {
    console.log(LOG_PREFIX, ...arguments);
  }

  function norm(value) {
    return String(value == null ? "" : value)
      .replace(/\u3000/g, " ")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t\r\n]+/g, " ")
      .trim();
  }

  function parseAmount(value) {
    const number = Number(String(value == null ? "" : value).replace(/,/g, "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(number) ? number : 0;
  }

  function yen(value) {
    return Math.round(Number(value || 0)).toLocaleString("ja-JP");
  }

  function cleanGameId(value) {
    const digits = String(value == null ? "" : value).replace(/\D/g, "");
    return digits.length === 8 ? digits : "";
  }

  function formatGameId(value) {
    const digits = cleanGameId(value);
    return digits ? `${digits.slice(0, 4)}.${digits.slice(4)}` : String(value || "");
  }

  function currentTournamentId() {
    const match = location.pathname.match(/\/cb\/torneio\/painel\/(\d+)/);
    return match ? match[1] : "";
  }

  function isTrue(value) {
    return ["TRUE", "YES", "Y", "1", "ON", "対象"].includes(norm(value).toUpperCase());
  }

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "");
      return value == null ? fallback : value;
    } catch (err) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function queue() {
    return readJson(STORAGE.queue, []);
  }

  function index() {
    const value = Number(localStorage.getItem(STORAGE.index) || "0");
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  }

  function setIndex(value) {
    localStorage.setItem(STORAGE.index, String(Math.max(0, value)));
  }

  function results() {
    return readJson(STORAGE.log, []);
  }

  function addResult(status, order, message) {
    const rows = results();
    rows.push({
      at: new Date().toLocaleString("ja-JP"),
      status,
      tournament_id: order && order.tournamentId || "",
      game_id: order && order.gameId || "",
      tournament_name: order && order.tournamentName || "",
      entry_mode: order && order.entryMode || "",
      message: message || ""
    });
    writeJson(STORAGE.log, rows);
    renderLog();
  }

  function ensurePanel() {
    let panel = document.getElementById("pw-batch-entry-panel");
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = "pw-batch-entry-panel";
    panel.style.cssText = [
      "position:fixed", "right:16px", "bottom:16px", "z-index:2147483647",
      "width:420px", "max-width:calc(100vw - 32px)", "max-height:78vh", "overflow:auto",
      "box-sizing:border-box", "padding:12px", "border:3px solid #1976d2", "border-radius:8px",
      "background:rgba(20,22,26,.96)", "color:#fff", "font:13px/1.45 Arial,'Yu Gothic',Meiryo,sans-serif",
      "box-shadow:0 8px 24px rgba(0,0,0,.35)"
    ].join(";");

    panel.innerHTML = [
      '<div style="font-weight:bold;font-size:15px;margin-bottom:8px">PW Batch Entry Helper</div>',
      '<div id="pw-batch-entry-status" style="white-space:pre-wrap">Loading...</div>',
      '<div id="pw-batch-current-card" style="margin-top:10px;padding:12px;border-radius:8px;background:#0f1720;border:1px solid #334155"></div>',
      '<textarea id="pw-batch-entry-tsv" style="width:100%;height:150px;box-sizing:border-box;margin-top:10px;padding:8px;border-radius:6px;border:1px solid #555;background:#111;color:#fff;font:12px/1.4 Consolas,monospace"></textarea>',
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px">',
      '<button id="pw-batch-load" type="button">Load TSV</button>',
      '<button id="pw-batch-start" type="button">Start current</button>',
      '<button id="pw-batch-next" type="button">Next</button>',
      '<button id="pw-batch-clear" type="button">Clear</button>',
      '<button id="pw-batch-copy-done" type="button">Copy DONE IDs</button>',
      '</div>',
      '<textarea id="pw-batch-entry-log" readonly style="width:100%;height:130px;box-sizing:border-box;margin-top:10px;padding:8px;border-radius:6px;border:1px solid #555;background:#111;color:#ddd;font:12px/1.4 Consolas,monospace"></textarea>'
    ].join("");

    document.body.appendChild(panel);
    for (const button of panel.querySelectorAll("button")) {
      button.style.cssText = "padding:8px;border:1px solid rgba(255,255,255,.25);border-radius:6px;background:#263238;color:#fff;cursor:pointer";
    }

    const sample = [
      REQUIRED_HEADERS.join("\t"),
      ["TRUE", "4905", "NLH Tag Battle -2on2-", "33221075", "EN", "0", "20000", "0", "0", "0", "0", "0", "LivePocket"].join("\t")
    ].join("\n");
    const tsv = document.getElementById("pw-batch-entry-tsv");
    tsv.placeholder = sample;
    tsv.value = localStorage.getItem(STORAGE.raw) || "";

    document.getElementById("pw-batch-load").addEventListener("click", loadTsv);
    document.getElementById("pw-batch-start").addEventListener("click", startCurrent);
    document.getElementById("pw-batch-next").addEventListener("click", nextOrder);
    document.getElementById("pw-batch-clear").addEventListener("click", clearAll);
    document.getElementById("pw-batch-copy-done").addEventListener("click", copyDoneIds);
    renderLog();
    renderCurrentCard();
    return panel;
  }

  function setStatus(message, type) {
    ensurePanel();
    const panel = document.getElementById("pw-batch-entry-panel");
    const status = document.getElementById("pw-batch-entry-status");
    const colors = { info: "#1976d2", success: "#2e7d32", warning: "#ed6c02", error: "#d32f2f" };
    panel.style.borderColor = colors[type || "info"] || colors.info;
    status.textContent = message;
    renderCurrentCard();
    log(message);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[ch]));
  }

  function paymentSummary(order) {
    if (!order) return "-";
    const labels = {
      cash: "CASH",
      credit_card: "CREDIT CARD",
      coin: "COIN",
      usdt: "USDT",
      contract: "CONTRACT"
    };
    const parts = Object.keys(labels)
      .filter(key => Number(order.payments && order.payments[key] || 0) > 0)
      .map(key => `${labels[key]} ${yen(order.payments[key])}`);
    return parts.length ? parts.join(" + ") : "NO PAYMENT";
  }

  function renderCurrentCard() {
    const card = document.getElementById("pw-batch-current-card");
    if (!card) return;
    const rows = queue();
    const i = index();
    const order = rows[i];
    const start = document.getElementById("pw-batch-start");
    if (start) start.textContent = rows.length && i < rows.length ? `START ${i + 1}/${rows.length}` : "Start current";

    if (!rows.length) {
      card.innerHTML = '<div style="color:#94a3b8;font-weight:bold">No batch loaded</div>';
      return;
    }
    if (i >= rows.length) {
      card.innerHTML = [
        '<div style="font-size:22px;font-weight:900;color:#4ade80">BATCH FINISHED</div>',
        `<div style="margin-top:6px;color:#cbd5e1">Total: ${rows.length}</div>`
      ].join("");
      return;
    }

    card.innerHTML = [
      `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center">`,
      `<div style="font-weight:900;color:#93c5fd">CURRENT ${i + 1} / ${rows.length}</div>`,
      `<div style="font-weight:800;color:#fbbf24">${escapeHtml(order.entryMode)}</div>`,
      `</div>`,
      `<div style="margin-top:8px;font-size:30px;line-height:1;font-weight:900;color:#fff;letter-spacing:0">${escapeHtml(formatGameId(order.gameId))}</div>`,
      `<div style="margin-top:8px;padding:8px;border-radius:6px;background:#172554;color:#bfdbfe;font-size:16px;font-weight:900">${escapeHtml(paymentSummary(order))}</div>`,
      `<div style="margin-top:8px;color:#cbd5e1">${escapeHtml(order.tournamentName)} / ${escapeHtml(order.tournamentId)}</div>`,
      order.memo ? `<div style="margin-top:6px;color:#94a3b8;font-size:12px">${escapeHtml(order.memo)}</div>` : ""
    ].join("");
  }

  function renderLog() {
    const box = document.getElementById("pw-batch-entry-log");
    if (!box) return;
    box.value = results().map(row => [
      row.status, row.tournament_id, row.game_id, row.tournament_name, row.entry_mode, row.message
    ].join("\t")).join("\n");
    box.scrollTop = box.scrollHeight;
  }

  function batchStatus(prefix) {
    const rows = queue();
    const i = index();
    const order = rows[i];
    return [
      prefix || "Ready.",
      "",
      `Progress: ${Math.min(i + 1, rows.length)}/${rows.length}`,
      order ? `Tournament: ${order.tournamentName} (${order.tournamentId})` : "Tournament: -",
      order ? `Game ID: ${formatGameId(order.gameId)}` : "Game ID: -",
      order ? `Entry: ${order.entryMode}` : "Entry: -",
      "",
      "Ticket/Voucher rows are skipped automatically.",
      "The script never clicks the final PW submit button."
    ].join("\n");
  }

  function parseTsv(text) {
    const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => norm(line));
    if (lines.length < 2) throw new Error("TSV needs header and at least one row.");
    const headers = lines[0].split("\t").map(norm);
    const missing = REQUIRED_HEADERS.filter(header => !headers.includes(header));
    if (missing.length) throw new Error(`Missing TSV headers: ${missing.join(", ")}`);

    const rows = [];
    for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
      const cells = lines[lineIndex].split("\t");
      const raw = {};
      headers.forEach((header, cellIndex) => {
        raw[header] = cells[cellIndex] == null ? "" : cells[cellIndex];
      });
      if (!isTrue(raw.enabled)) continue;

      const gameId = cleanGameId(raw.game_id);
      const tournamentId = norm(raw.tournament_id);
      const entryMode = norm(raw.entry_mode || "EN").toUpperCase();
      if (!gameId) throw new Error(`Line ${lineIndex + 1}: game_id must be 8 digits.`);
      if (!tournamentId) throw new Error(`Line ${lineIndex + 1}: tournament_id is required.`);
      if (!["EN", "RE"].includes(entryMode)) throw new Error(`Line ${lineIndex + 1}: entry_mode must be EN or RE for this no-ticket batch script.`);

      rows.push({
        source: "batch",
        lineNumber: lineIndex + 1,
        tournamentId,
        tournamentName: norm(raw.tournament_name) || `Tournament ${tournamentId}`,
        tournamentUrl: `https://japanopt.pokerweb.com.br/cb/torneio/painel/${tournamentId}`,
        gameId,
        entryMode,
        quantities: { EN: entryMode === "EN" ? 1 : 0, RE: entryMode === "RE" ? 1 : 0, TE: 0 },
        payments: {
          cash: parseAmount(raw.cash),
          credit_card: parseAmount(raw.credit_card),
          coin: parseAmount(raw.coin),
          usdt: parseAmount(raw.usdt),
          contract: parseAmount(raw.contract)
        },
        voucherTicket: parseAmount(raw.voucher_ticket),
        mainTicketCount: Math.max(0, Math.round(parseAmount(raw.main_ticket_count))),
        memo: norm(raw.memo)
      });
    }
    if (!rows.length) throw new Error("No enabled rows found.");
    return rows;
  }

  function loadTsv() {
    try {
      const raw = document.getElementById("pw-batch-entry-tsv").value;
      const rows = parseTsv(raw);
      writeJson(STORAGE.queue, rows);
      localStorage.setItem(STORAGE.raw, raw);
      localStorage.setItem(STORAGE.log, "[]");
      setIndex(0);
      sessionStorage.removeItem(STORAGE.active);
      setStatus(batchStatus(`Loaded ${rows.length} rows.`), "success");
      renderLog();
    } catch (err) {
      setStatus(`Load error:\n${err.message || String(err)}`, "error");
    }
  }

  function startCurrent() {
    try {
      const rows = queue();
      const i = index();
      if (!rows.length) throw new Error("Paste TSV and click Load TSV first.");
      if (i >= rows.length) throw new Error("Batch is finished.");
      const order = rows[i];
      if (order.mainTicketCount > 0 || order.voucherTicket > 0) {
        addResult("SKIP", order, `Ticket/Voucher required. main_ticket_count=${order.mainTicketCount}, voucher_ticket=${yen(order.voucherTicket)}`);
        setIndex(i + 1);
        setStatus(batchStatus("Skipped ticket/voucher row."), "warning");
        return;
      }
      saveAndOpen(order);
    } catch (err) {
      setStatus(`Start error:\n${err.message || String(err)}`, "error");
    }
  }

  function nextOrder() {
    const rows = queue();
    const next = Math.min(index() + 1, rows.length);
    setIndex(next);
    sessionStorage.removeItem(STORAGE.active);
    setStatus(next >= rows.length ? "Batch finished." : batchStatus("Moved to next row."), next >= rows.length ? "success" : "info");
  }

  function skipFailed(order, error) {
    addResult("ERROR", order, error && error.message ? error.message : String(error));
    setIndex(Math.min(index() + 1, queue().length));
    sessionStorage.removeItem(STORAGE.active);
    setStatus(batchStatus("Current row failed and was skipped."), "error");
  }

  function clearAll() {
    Object.values(STORAGE).forEach(key => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
    document.getElementById("pw-batch-entry-tsv").value = "";
    renderLog();
    renderCurrentCard();
    setStatus("Cleared.", "info");
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    return Promise.resolve();
  }

  function copyDoneIds() {
    const ids = results()
      .filter(row => row.status === "DONE")
      .map(row => row.game_id)
      .filter(Boolean);
    const text = ids.join("\n");
    copyText(text).then(
      () => setStatus(`Copied ${ids.length} DONE Game IDs.`, "success"),
      err => setStatus(`Copy failed:\n${err && err.message ? err.message : String(err)}`, "error")
    );
  }

  function saveAndOpen(order) {
    sessionStorage.setItem(STORAGE.active, JSON.stringify(order));
    if (currentTournamentId() === order.tournamentId) {
      executeOrder(order);
      return;
    }
    setStatus(`Opening tournament ${order.tournamentId} for ${formatGameId(order.gameId)}...`, "info");
    location.href = order.tournamentUrl;
  }

  async function postForm(url, values) {
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: new URLSearchParams(values)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}: ${norm(text.replace(/<[^>]+>/g, " ")).slice(0, 220)}`);
    return text;
  }

  function parseHtml(html) {
    return new DOMParser().parseFromString(html, "text/html");
  }

  async function findInternalPlayerId(gameId) {
    const html = await postForm("/cb/jogadores/search", { query: gameId, identifier: "string" });
    const doc = parseHtml(html);
    const formatted = formatGameId(gameId);
    const found = [];
    for (const element of Array.from(doc.querySelectorAll("[rel], [onclick], a, li, tr, div"))) {
      const text = norm(element.textContent || "");
      if (!text.includes(formatted) && !text.includes(gameId)) continue;
      const outer = element.outerHTML || "";
      const rel = outer.match(/rel=["'][^"']*?(\d+)[^"']*?["']/);
      const panel = outer.match(/jogadores\/painel\/(\d+)/);
      const leading = text.match(/^\s*(\d+)\s*-/);
      const internalId = rel && rel[1] || panel && panel[1] || leading && leading[1] || "";
      if (internalId && !found.includes(internalId)) found.push(internalId);
    }
    if (found.length === 1) return found[0];
    if (found.length > 1) throw new Error(`Multiple players found for ${formatted}: ${found.join(", ")}`);
    throw new Error(`Player not found: ${formatted}`);
  }

  function replaceHtmlAndRunScripts(container, html) {
    container.innerHTML = html;
    for (const oldScript of Array.from(container.querySelectorAll("script"))) {
      const newScript = document.createElement("script");
      for (const attr of Array.from(oldScript.attributes)) newScript.setAttribute(attr.name, attr.value);
      newScript.textContent = oldScript.textContent || "";
      oldScript.parentNode.replaceChild(newScript, oldScript);
    }
  }

  async function loadCashier(internalPlayerId, tournamentId) {
    const html = await postForm("/cb/torneio/abas/caixa/dados_caixa", {
      id_jogador: internalPlayerId,
      id_torneio: tournamentId,
      premiacao_origem: "0"
    });
    const container = document.querySelector("#clientes-detalhes");
    if (!container) throw new Error("Missing #clientes-detalhes.");
    replaceHtmlAndRunScripts(container, html);
    await waitFor(() => document.querySelector("#form_caixa"), 10000, "#form_caixa");
    await waitFor(() => document.querySelector('#form_caixa input[name^="qtd_item["]'), 10000, "cashier items");
  }

  async function waitFor(check, timeoutMs, label) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = check();
      if (value) return value;
      await sleep(120);
    }
    throw new Error(`Timed out waiting for ${label}.`);
  }

  function setInputValue(input, value) {
    input.focus();
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (window.jQuery) window.jQuery(input).val(String(value)).trigger("input").trigger("change");
    input.blur();
  }

  function clickCashierTab() {
    const tab = Array.from(document.querySelectorAll("a, button, [role='tab'], [data-toggle], [href]"))
      .find(el => {
        const text = norm(el.textContent).toLowerCase();
        const attr = `${el.getAttribute("href") || ""} ${el.getAttribute("data-target") || ""} ${el.getAttribute("onclick") || ""}`.toLowerCase();
        return text.includes("cashier") ||
          text.includes("caixa") ||
          text.includes("\u30ad\u30e3\u30c3\u30b7\u30e3\u30fc") ||
          attr.includes("cashier") ||
          attr.includes("caixa");
      });
    if (tab && typeof tab.click === "function") tab.click();
  }

  function expandCashierPanels() {
    for (const toggle of Array.from(document.querySelectorAll("#clientes-detalhes .collapse-link, #form_caixa .collapse-link, #clientes-detalhes .fa-chevron-down"))) {
      if (typeof toggle.click === "function") toggle.click();
    }
  }

  function classifyItem(text) {
    const value = norm(text).toLowerCase();
    if (/(^|\s)re[\s-]*entry\b/.test(value)) return "RE";
    if (value.includes("ticket") || value.includes("\u30c1\u30b1\u30c3\u30c8") || /\bte\b/i.test(text)) return "TE";
    if (/\bentry\s*\(\d+\)/i.test(text) || value.includes("entry")) return "EN";
    return "";
  }

  function findItems() {
    const found = { EN: [], RE: [], TE: [] };
    for (const input of Array.from(document.querySelectorAll('#form_caixa input[name^="qtd_item["]'))) {
      const row = input.closest("tr") || input.parentElement;
      const rowText = norm(row ? row.textContent : input.name);
      const type = classifyItem(rowText);
      if (type) found[type].push({ input, rowText });
    }
    return found;
  }

  function fillItems(order) {
    const found = findItems();
    const result = {};
    for (const type of ["EN", "RE", "TE"]) {
      const qty = Number(order.quantities[type] || 0);
      if (found[type].length > 1) throw new Error(`${type} matched multiple item rows.`);
      if (!found[type].length) {
        if (qty > 0) throw new Error(`${type} item row not found.`);
        continue;
      }
      setInputValue(found[type][0].input, qty);
      result[type] = found[type][0];
    }
    return result;
  }

  function clearTickets() {
    for (const checkbox of Array.from(document.querySelectorAll('#form_caixa input[name="usarvaga[]"]'))) {
      if (checkbox.checked) checkbox.click();
    }
  }

  function clearPayments() {
    for (const input of Array.from(document.querySelectorAll('#form_caixa input[name^="pgto["]'))) {
      setInputValue(input, "");
    }
  }

  function readBalance() {
    const input = document.querySelector("#valor_pendencia_input");
    if (!input) return NaN;
    const value = parseAmount(input.value);
    return Number.isFinite(value) ? value : NaN;
  }

  function readAvailableCoin() {
    for (const table of Array.from(document.querySelectorAll("table"))) {
      const rows = Array.from(table.querySelectorAll("tr"));
      for (let r = 0; r < rows.length; r += 1) {
        const cells = Array.from(rows[r].children);
        const col = cells.findIndex(cell => norm(cell.textContent).includes("\u5229\u7528\u53ef\u80fd\u306a\u30b3\u30a4\u30f3"));
        if (col < 0) continue;
        for (let next = r + 1; next < rows.length; next += 1) {
          const cell = Array.from(rows[next].children)[col];
          const amount = cell ? parseAmount(cell.textContent) : NaN;
          if (Number.isFinite(amount)) return amount;
        }
      }
    }
    return NaN;
  }

  async function fillPayments(order) {
    const warnings = [];
    clearPayments();
    await sleep(250);

    if (order.payments.coin > 0) {
      const coin = readAvailableCoin();
      if (Number.isFinite(coin) && coin < order.payments.coin) {
        throw new Error(`Coin not enough. available=${yen(coin)}, required=${yen(order.payments.coin)}`);
      }
    }

    const filled = [];
    for (const key of Object.keys(PAYMENT_INPUTS)) {
      const amount = Number(order.payments[key] || 0);
      if (!amount) continue;
      const input = document.querySelector(`#form_caixa input[name="${PAYMENT_INPUTS[key]}"]`);
      if (!input) {
        warnings.push(`${key} input not found; skipped ${yen(amount)}`);
        continue;
      }
      setInputValue(input, String(Math.round(amount)));
      filled.push(`${key}=${yen(amount)}`);
    }
    await sleep(400);
    return { filled, warnings };
  }

  async function waitForBalanceAfterPayment(timeoutMs) {
    const started = Date.now();
    let last = readBalance();
    while (Date.now() - started < timeoutMs) {
      const current = readBalance();
      if (Number.isFinite(current)) {
        last = current;
        if (Math.abs(current) <= 0.01) return current;
      }
      await sleep(200);
    }
    return last;
  }

  function highlightSubmit() {
    const button = document.querySelector("#btsubmit");
    if (!button) {
      return "Missing #btsubmit. Please inspect manually.";
    }
    button.style.outline = "5px solid #ff9800";
    button.style.outlineOffset = "4px";
    button.scrollIntoView({ behavior: "smooth", block: "center" });
    return "";
  }

  function showReview(order, paymentResult, balance, submitWarning) {
    alert([
      "PW入力完了 / Manual review required",
      "",
      `Tournament: ${order.tournamentName} (${order.tournamentId})`,
      `Game ID: ${formatGameId(order.gameId)}`,
      `Entry: ${order.entryMode}`,
      `Payments: ${paymentResult.filled.join(", ") || "none"}`,
      `Balance: ${Number.isFinite(balance) ? balance : "unknown"}`,
      ...(paymentResult.warnings.length ? ["", "Warnings:", ...paymentResult.warnings] : []),
      ...(Number.isFinite(balance) && Math.abs(balance) > 0.01 ? ["", "Balance is not zero. Check PW manually."] : []),
      ...(submitWarning ? ["", submitWarning] : []),
      "",
      "The script did NOT click the final submit button."
    ].join("\n"));
  }

  async function executeOrder(order) {
    if (running) return;
    running = true;
    try {
      if (currentTournamentId() !== order.tournamentId) throw new Error(`Wrong tournament page. current=${currentTournamentId() || "-"}, target=${order.tournamentId}`);

      setStatus(`Processing ${formatGameId(order.gameId)}...\nOpening Cashier tab.`, "info");
      clickCashierTab();
      const internalId = await findInternalPlayerId(order.gameId);

      setStatus(`Player found: ${internalId}\nLoading Cashier...`, "info");
      await loadCashier(internalId, order.tournamentId);
      expandCashierPanels();

      setStatus("Filling item and payments...", "info");
      const items = fillItems(order);
      clearTickets();
      const paymentResult = await fillPayments(order);
      const balance = await waitForBalanceAfterPayment(5000);
      const submitWarning = highlightSubmit();

      sessionStorage.removeItem(STORAGE.active);
      addResult("DONE", order, `${Object.values(items).map(item => item.rowText).join(" / ")} | ${paymentResult.filled.join(", ")} | balance=${Number.isFinite(balance) ? balance : "unknown"}`);
      setStatus(batchStatus("Ready for manual PW submit."), "success");
      showReview(order, paymentResult, balance, submitWarning);
    } catch (err) {
      skipFailed(order, err);
    } finally {
      running = false;
    }
  }

  function resumeActive() {
    const raw = sessionStorage.getItem(STORAGE.active);
    if (!raw) return false;
    const order = JSON.parse(raw);
    if (currentTournamentId() === order.tournamentId) {
      executeOrder(order);
      return true;
    }
    setStatus(`Active order waits for tournament ${order.tournamentId}.`, "info");
    return false;
  }

  function bootstrap() {
    ensurePanel();
    if (!resumeActive()) {
      setStatus(queue().length ? batchStatus("Batch restored.") : "Paste TSV, click Load TSV, then Start current.", "info");
    }
  }

  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
    } else {
      bootstrap();
    }
  } catch (err) {
    console.error(LOG_PREFIX, err);
    alert(`${LOG_PREFIX} fatal error: ${err && err.message ? err.message : String(err)}`);
  }
})();
