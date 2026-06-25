// ==UserScript==
// @name         JOPT PW Reception Test
// @namespace    jopt-pw-reception
// @version      0.2.8
// @description  Test reception QR flow for PokerWeb tournament cashier. Never submits final form.
// @match        https://japanopt.pokerweb.com.br/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const LOG_PREFIX = "[JOPT-RCP]";

  const CONFIG = {
    qrPrefix: "JOPT-RCP:",
    storageKey: "JOPT_RCP_TEST_ORDER_V1",
    hookPollMs: 300,
    hookMaxAttempts: 400,
    settleMs: 250,
    calculateTimeoutMs: 5000,
    order: {
      qrValue: "JOPT-RCP:TEST10086-001",
      receptionId: "TEST10086-001",
      displayName: "test10086",
      amountDue: 9000,
      tournamentId: "4905",
      tournamentUrl: "https://japanopt.pokerweb.com.br/cb/torneio/painel/4905",
      gameId: "33221075",
      quantities: {
        EN: 1,
        RE: 0,
        TE: 1
      },
      allowedTicketNames: [
        "JOPT 2026 Grand Final / Main Event / -2027.03.31"
      ],
      requiredTicketCount: 1,
      cashPaymentName: "pgto[1]"
    }
  };

  let running = false;
  let originalGameidSearchAction = null;

  function log() {
    console.log(LOG_PREFIX, ...arguments);
  }

  function errorLog() {
    console.error(LOG_PREFIX, ...arguments);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function normalizeText(value) {
    return String(value == null ? "" : value)
      .replace(/\u3000/g, " ")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t\r\n]+/g, " ")
      .trim();
  }

  function normalizeTicketName(value) {
    return normalizeText(value)
      .replace(/^ナショナルチケット\s*-\s*/, "")
      .replace(/\s*ソース:\s*JOPT\s*-\s*Japan Open Poker Tour\s*/g, "")
      .trim();
  }

  function parseAmount(value) {
    const cleaned = String(value == null ? "" : value)
      .replace(/,/g, "")
      .replace(/[^\d.-]/g, "");
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : NaN;
  }

  function formatAmount(value) {
    return String(Math.round(Number(value) * 100) / 100);
  }

  function formatYen(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value || "0");
    return Math.round(number).toLocaleString("ja-JP");
  }

  function formatGameId(gameId) {
    const digits = String(gameId || "").replace(/\D/g, "");
    if (digits.length !== 8) return String(gameId || "");
    return `${digits.slice(0, 4)}.${digits.slice(4)}`;
  }

  function getCurrentTournamentId() {
    const match = location.pathname.match(/\/cb\/torneio\/painel\/(\d+)/);
    return match ? match[1] : "";
  }

  function ensurePanel() {
    let panel = document.getElementById("jopt-rcp-panel");
    if (panel) return panel;

    if (!document.body) {
      throw new Error("document.body is not ready");
    }

    panel = document.createElement("div");
    panel.id = "jopt-rcp-panel";
    panel.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "z-index:2147483647",
      "width:380px",
      "max-width:calc(100vw - 32px)",
      "max-height:72vh",
      "overflow:auto",
      "box-sizing:border-box",
      "padding:12px 14px",
      "border:3px solid #1976d2",
      "border-radius:8px",
      "background:rgba(20,22,26,.96)",
      "color:#fff",
      "font:13px/1.5 Arial,'Yu Gothic',Meiryo,sans-serif",
      "white-space:pre-wrap",
      "box-shadow:0 8px 24px rgba(0,0,0,.35)"
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "JOPT PW Reception";
    title.style.cssText = "font-weight:bold;margin-bottom:8px;color:#fff";

    const status = document.createElement("div");
    status.id = "jopt-rcp-status";
    status.textContent = "Starting...";

    const runButton = document.createElement("button");
    runButton.id = "jopt-rcp-run-test";
    runButton.type = "button";
    runButton.textContent = "Run test order";
    runButton.style.cssText = [
      "display:block",
      "width:100%",
      "margin-top:10px",
      "padding:8px",
      "border:1px solid #1976d2",
      "border-radius:6px",
      "background:#0d47a1",
      "color:#fff",
      "cursor:pointer"
    ].join(";");
    runButton.addEventListener("click", () => {
      handleQrValue(CONFIG.order.qrValue);
    });

    const resetButton = document.createElement("button");
    resetButton.id = "jopt-rcp-reset";
    resetButton.type = "button";
    resetButton.textContent = "Clear saved test order";
    resetButton.style.cssText = [
      "display:none",
      "width:100%",
      "margin-top:10px",
      "padding:8px",
      "border:1px solid #777",
      "border-radius:6px",
      "background:#2f3338",
      "color:#fff",
      "cursor:pointer"
    ].join(";");
    resetButton.addEventListener("click", () => {
      sessionStorage.removeItem(CONFIG.storageKey);
      setStatus("Saved test order cleared.", "info", false);
    });

    panel.appendChild(title);
    panel.appendChild(status);
    panel.appendChild(runButton);
    panel.appendChild(resetButton);
    document.body.appendChild(panel);
    return panel;
  }

  function setStatus(message, type, showReset) {
    const panel = ensurePanel();
    const status = document.getElementById("jopt-rcp-status");
    const resetButton = document.getElementById("jopt-rcp-reset");
    const colors = {
      info: "#1976d2",
      success: "#2e7d32",
      warning: "#ed6c02",
      error: "#d32f2f"
    };

    status.textContent = message;
    panel.style.borderColor = colors[type || "info"] || colors.info;
    resetButton.style.display = showReset ? "block" : "none";
    log(message);
  }

  function fail(error) {
    const message = error && error.message ? error.message : String(error);
    errorLog(error);
    setStatus([
      "Stopped with error.",
      "",
      message,
      "",
      "No submit action was performed.",
      "Please inspect the page manually."
    ].join("\n"), "error", true);
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
    if (!response.ok) {
      throw new Error(`${url} HTTP ${response.status}: ${normalizeText(text).slice(0, 240)}`);
    }
    return text;
  }

  function parseHtml(html) {
    return new DOMParser().parseFromString(html, "text/html");
  }

  async function findInternalPlayerId(gameId) {
    const formattedGameId = formatGameId(gameId);
    const html = await postForm("/cb/jogadores/search", {
      query: gameId,
      identifier: "string"
    });
    const doc = parseHtml(html);
    const candidates = [];

    for (const element of Array.from(doc.querySelectorAll("[rel], [onclick], a, li, tr, div"))) {
      const rowText = normalizeText(element.textContent || "");
      if (!rowText.includes(formattedGameId) && !rowText.includes(String(gameId))) continue;

      const rowHtml = element.outerHTML || "";
      const relMatch = rowHtml.match(/rel=["'][^"']*?(\d+)[^"']*?["']/);
      const panelMatch = rowHtml.match(/jogadores\/painel\/(\d+)/);
      const leadingMatch = rowText.match(/^\s*(\d+)\s*-/);
      const internalId = (relMatch && relMatch[1]) ||
        (panelMatch && panelMatch[1]) ||
        (leadingMatch && leadingMatch[1]) ||
        "";

      if (internalId) {
        candidates.push({ internalId, rowText });
      }
    }

    const unique = [];
    const seen = new Set();
    for (const candidate of candidates) {
      if (seen.has(candidate.internalId)) continue;
      seen.add(candidate.internalId);
      unique.push(candidate);
    }

    if (unique.length === 1) return unique[0].internalId;
    if (unique.length > 1) {
      throw new Error(`Player search matched multiple internal IDs for ${formattedGameId}: ${unique.map(x => x.internalId).join(", ")}`);
    }

    throw new Error(`Player not found for Game ID ${formattedGameId}. Search result: ${normalizeText(html.replace(/<[^>]+>/g, " ")).slice(0, 240)}`);
  }

  function replaceHtmlAndRunScripts(container, html) {
    container.innerHTML = html;
    for (const oldScript of Array.from(container.querySelectorAll("script"))) {
      const newScript = document.createElement("script");
      for (const attr of Array.from(oldScript.attributes)) {
        newScript.setAttribute(attr.name, attr.value);
      }
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
    await waitForSelector("#form_caixa", 10000);
    await waitForCondition(() => document.querySelector('#form_caixa input[name^="qtd_item["]'), 10000, "cashier item inputs");
    await waitForCondition(() => document.querySelector("#valor_pendencia_input"), 10000, "cashier balance input");
  }

  async function waitForSelector(selector, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const element = document.querySelector(selector);
      if (element) return element;
      await sleep(150);
    }
    throw new Error(`Timed out waiting for ${selector}.`);
  }

  async function waitForCondition(checkFn, timeoutMs, label) {
    const started = Date.now();
    let lastValue;
    while (Date.now() - started < timeoutMs) {
      lastValue = checkFn();
      if (lastValue) return lastValue;
      await sleep(100);
    }
    throw new Error(`Timed out waiting for ${label || "condition"}.`);
  }

  async function waitForStableBalance(timeoutMs) {
    await waitForCondition(() => document.querySelector("#valor_pendencia_input"), timeoutMs, "#valor_pendencia_input");
    let lastValue = null;
    let stableCount = 0;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const input = document.querySelector("#valor_pendencia_input");
      const value = input ? input.value : "";
      if (value === lastValue && value !== "") {
        stableCount += 1;
      } else {
        stableCount = 0;
        lastValue = value;
      }
      if (stableCount >= 3 && Date.now() - started >= CONFIG.settleMs) return;
      await sleep(120);
    }
  }

  function isElementVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0";
  }

  function findCashierTabCandidate() {
    const candidates = Array.from(document.querySelectorAll("a, button, [role='tab'], [data-toggle], [data-target], [href]"));
    return candidates.find(element => {
      const text = normalizeText(element.textContent || "").toLowerCase();
      const href = String(element.getAttribute("href") || "").toLowerCase();
      const dataTarget = String(element.getAttribute("data-target") || "").toLowerCase();
      const dataAba = String(element.getAttribute("data-aba") || element.getAttribute("data-tab") || "").toLowerCase();
      const onclick = String(element.getAttribute("onclick") || "").toLowerCase();
      const combined = `${text} ${href} ${dataTarget} ${dataAba} ${onclick}`;
      return combined.includes("cashier") ||
        combined.includes("caixa") ||
        combined.includes("キャッシャー");
    });
  }

  function isCashierTabActive(tab) {
    if (!tab) return false;
    const activeRoot = tab.closest(".active, li, .nav-item");
    const classText = `${tab.className || ""} ${activeRoot ? activeRoot.className || "" : ""}`.toLowerCase();
    const ariaSelected = String(tab.getAttribute("aria-selected") || "").toLowerCase();
    return ariaSelected === "true" || classText.includes("active");
  }

  function clickCashierTabIfFound() {
    const tab = findCashierTabCandidate();
    if (tab && !isCashierTabActive(tab)) {
      tab.click();
      return true;
    }
    return Boolean(tab);
  }

  function clickCollapsedCashierPanelsIfFound() {
    const roots = [
      document.querySelector("#clientes-detalhes"),
      document.querySelector("#form_caixa")
    ].filter(Boolean);

    const seen = new Set();
    let clicked = 0;

    for (const root of roots) {
      const toggles = Array.from(root.querySelectorAll(
        ".collapse-link, a.collapsed, button.collapsed, [data-toggle='collapse'], [data-toggle=\"collapse\"], .fa-chevron-down, .fa-caret-down"
      ));

      for (const element of toggles) {
        const toggle = element.closest("a, button, [role='button']") || element;
        if (seen.has(toggle)) continue;
        seen.add(toggle);

        const classText = `${element.className || ""} ${toggle.className || ""} ${toggle.innerHTML || ""}`.toLowerCase();
        const looksCollapsed = classText.includes("collapsed") ||
          classText.includes("chevron-down") ||
          classText.includes("caret-down");

        if (!looksCollapsed) continue;

        toggle.click();
        clicked += 1;
      }
    }

    return clicked;
  }

  function setInputValue(input, value) {
    if (!input) throw new Error("Missing input.");
    const stringValue = String(value);
    input.focus();
    input.value = stringValue;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "0" }));
    if (window.jQuery) {
      window.jQuery(input).val(stringValue).trigger("input").trigger("change").trigger("keyup");
    }
    input.blur();
  }

  function itemTypeForRow(rowText) {
    const text = normalizeText(rowText).toLowerCase();
    const hasTicket = /(^|[^a-z])(?:ticket entry|ticket|te|チケット)([^a-z]|$)/i.test(text);
    const hasReEntry = /(^|[^a-z])re[\s-]*entry(?:\s*\(\d+\))?([^a-z]|$)/i.test(text);
    const hasEntry = /(^|[^a-z])entry(?:\s*\(\d+\))?([^a-z]|$)/i.test(text);

    if (hasTicket) return "TE";
    if (hasReEntry) return "RE";
    if (hasEntry) return "EN";
    return "";
  }

  function findTournamentItems() {
    const inputs = Array.from(document.querySelectorAll('#form_caixa input[name^="qtd_item["]'));
    if (!inputs.length) throw new Error('No item quantity inputs found: input[name^="qtd_item["].');

    const found = { EN: [], RE: [], TE: [] };
    for (const input of inputs) {
      const row = input.closest("tr");
      const rowText = normalizeText(row ? row.textContent : "");
      const type = itemTypeForRow(rowText);
      if (type) found[type].push({ input, row, rowText, inputName: input.name });
    }

    const result = {};
    for (const type of ["EN", "RE", "TE"]) {
      if (found[type].length !== 1) {
        const details = found[type].map(x => `${x.inputName}: ${x.rowText}`).join("\n");
        throw new Error(`Item ${type} must match exactly once, matched ${found[type].length}.\n${details}`);
      }
      result[type] = found[type][0];
    }
    return result;
  }

  function fillTournamentItems(order) {
    const items = findTournamentItems();
    setInputValue(items.EN.input, order.quantities.EN);
    setInputValue(items.RE.input, order.quantities.RE);
    setInputValue(items.TE.input, order.quantities.TE);
    return items;
  }

  function getTicketCoreName(checkbox) {
    const row = checkbox.closest("tr");
    if (!row) return "";
    const cells = Array.from(row.querySelectorAll("td"));
    if (cells.length < 2) return "";

    const clone = cells[1].cloneNode(true);
    for (const selector of ["input", "button", "select", "textarea", ".vaga_editar_valor"]) {
      for (const node of Array.from(clone.querySelectorAll(selector))) node.remove();
    }
    return normalizeTicketName(clone.textContent);
  }

  function getTickets() {
    return Array.from(document.querySelectorAll('#form_caixa input[name="usarvaga[]"]'))
      .map(checkbox => {
        const row = checkbox.closest("tr");
        return {
          checkbox,
          row,
          instanceId: checkbox.value || checkbox.id || "",
          coreName: getTicketCoreName(checkbox),
          amountInput: row ? row.querySelector('input[name^="valorvaga["], .vaga_editar_valor[data-id_ticket]') : null
        };
      });
  }

  function setCheckbox(checkbox, shouldCheck) {
    if (checkbox.checked === shouldCheck) return;
    checkbox.click();
    if (checkbox.checked !== shouldCheck) {
      checkbox.checked = shouldCheck;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      if (window.jQuery) {
        window.jQuery(checkbox).prop("checked", shouldCheck).trigger("change");
      }
    }
  }

  function selectAllowedTickets(order) {
    const tickets = getTickets();
    if (!tickets.length) throw new Error('No tickets found: input[name="usarvaga[]"].');

    for (const ticket of tickets) {
      setCheckbox(ticket.checkbox, false);
    }

    const allowed = new Set(order.allowedTicketNames.map(normalizeTicketName));
    const matched = tickets.filter(ticket => allowed.has(ticket.coreName));
    if (matched.length !== order.requiredTicketCount) {
      throw new Error([
        `Allowed ticket must match exactly ${order.requiredTicketCount}, matched ${matched.length}.`,
        "",
        "Tickets detected:",
        ...tickets.map(ticket => `- ${ticket.coreName || "(empty)"} [${ticket.instanceId}]`)
      ].join("\n"));
    }

    for (const ticket of matched) {
      setCheckbox(ticket.checkbox, true);
    }

    const checked = tickets.filter(ticket => ticket.checkbox.checked);
    if (checked.length !== order.requiredTicketCount) {
      throw new Error(`Final checked ticket count is ${checked.length}, expected ${order.requiredTicketCount}.`);
    }
    for (const ticket of checked) {
      if (!allowed.has(ticket.coreName)) {
        throw new Error(`Unexpected ticket checked: ${ticket.coreName}`);
      }
    }
    return matched;
  }

  function clearPayments() {
    for (const input of Array.from(document.querySelectorAll('#form_caixa input[name^="pgto["]'))) {
      setInputValue(input, "");
    }
  }

  function readBalance() {
    const input = document.querySelector("#valor_pendencia_input");
    if (!input) throw new Error("Missing #valor_pendencia_input.");
    const value = parseAmount(input.value);
    if (!Number.isFinite(value)) throw new Error(`Cannot parse balance: ${input.value}`);
    return value;
  }

  function getCashInput(order) {
    const input = document.querySelector(`#form_caixa input[name="${order.cashPaymentName}"]`);
    if (!input) throw new Error(`Missing cash payment input ${order.cashPaymentName}.`);
    return input;
  }

  function highlightSubmitButton() {
    const button = document.querySelector("#btsubmit");
    if (!button) throw new Error("Missing final submit button #btsubmit.");
    button.style.outline = "5px solid #ff9800";
    button.style.outlineOffset = "4px";
    button.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function showReceptionConfirmation(order, cashAmount, selectedTickets) {
    const tournamentName = order.displayName || order.tournamentName || `Tournament ${order.tournamentId}`;
    const amountDue = Number.isFinite(Number(order.amountDue)) ? Number(order.amountDue) : Number(cashAmount);
    const teQuantity = Number(order.quantities && order.quantities.TE || 0);
    const requiredTicketCount = Number(order.requiredTicketCount || 0);
    const voucherTicketAmount = Number(order.payments && order.payments.voucher_ticket || 0);
    const ticketLines = [];

    if (teQuantity > 0 && requiredTicketCount > 0) {
      ticketLines.push(`Ticket Entry のため、メインイベントチケットを${requiredTicketCount}枚使用します。`);
    }
    if (voucherTicketAmount > 0) {
      ticketLines.push(`Ticket / Voucher 支払い：${formatYen(voucherTicketAmount)}円`);
    }
    if (ticketLines.length) {
      const selectedCount = Array.isArray(selectedTickets) ? selectedTickets.length : 0;
      ticketLines.push(`PokerWeb上のチケット選択を確認してください。選択済み：${selectedCount}枚`);
    }

    alert([
      "受付内容確認",
      "",
      `大会名：${tournamentName}`,
      `Game ID：${formatGameId(order.gameId)}`,
      `請求金額：${formatYen(amountDue)}円`,
      "",
      ...ticketLines,
      ...(ticketLines.length ? [""] : []),
      "支払いを受領後、PokerWeb の最終確認ボタンを手動で押してください。"
    ].join("\n"));
  }

  function validateQuantities(order, items) {
    for (const type of ["EN", "RE", "TE"]) {
      if (Number(items[type].input.value) !== Number(order.quantities[type])) {
        throw new Error(`${type} quantity mismatch: expected ${order.quantities[type]}, actual ${items[type].input.value}.`);
      }
    }
  }

  async function executeOrder(order) {
    if (running) return;
    running = true;

    try {
      if (getCurrentTournamentId() !== order.tournamentId) {
        throw new Error(`Wrong tournament page. Current=${getCurrentTournamentId() || "(none)"}, target=${order.tournamentId}.`);
      }

      setStatus(`Processing test order ${order.receptionId}\nOpening Cashier tab if needed...`, "info", true);
      clickCashierTabIfFound();

      setStatus(`Searching player ${formatGameId(order.gameId)}...`, "info", true);
      const internalPlayerId = await findInternalPlayerId(order.gameId);

      setStatus(`Player found: internal ID ${internalPlayerId}\nLoading cashier...`, "info", true);
      await loadCashier(internalPlayerId, order.tournamentId);
      clickCollapsedCashierPanelsIfFound();

      setStatus("Cashier loaded.\nFilling EN / RE / TE...", "info", true);
      const items = fillTournamentItems(order);
      await waitForStableBalance(CONFIG.calculateTimeoutMs);

      setStatus("Items filled.\nSelecting allowed Main Event ticket only...", "info", true);
      const selectedTickets = selectAllowedTickets(order);
      await waitForStableBalance(CONFIG.calculateTimeoutMs);

      setStatus("Ticket selected.\nClearing payments and calculating cash balance...", "info", true);
      clearPayments();
      await waitForStableBalance(CONFIG.calculateTimeoutMs);

      const outstanding = Math.abs(readBalance());
      const cashInput = getCashInput(order);
      setInputValue(cashInput, formatAmount(outstanding));
      await waitForStableBalance(CONFIG.calculateTimeoutMs);

      validateQuantities(order, items);
      const finalBalance = readBalance();
      if (Math.abs(finalBalance) > 0.01) {
        throw new Error(`Balance is not zero after cash payment: ${finalBalance}.`);
      }

      highlightSubmitButton();
      sessionStorage.removeItem(CONFIG.storageKey);
      setStatus([
        "Ready for manual review.",
        "",
        `Reception: ${order.receptionId}`,
        `Tournament: ${order.tournamentId}`,
        `Game ID: ${formatGameId(order.gameId)}`,
        "",
        `${items.EN.rowText} => ${order.quantities.EN}`,
        `${items.RE.rowText} => ${order.quantities.RE}`,
        `${items.TE.rowText} => ${order.quantities.TE}`,
        "",
        "Ticket selected:",
        ...selectedTickets.map(ticket => `- ${ticket.coreName} [${ticket.instanceId}]`),
        "",
        `Cash ${order.cashPaymentName}: ${formatAmount(outstanding)}`,
        "Final balance: 0",
        "",
        "The script did NOT click #btsubmit."
      ].join("\n"), "success", false);
      showReceptionConfirmation(order, outstanding, selectedTickets);
    } catch (err) {
      fail(err);
    } finally {
      running = false;
    }
  }

  function findVisibleScannerDialog() {
    const dialogs = Array.from(document.querySelectorAll(".modal, [role='dialog'], .bootbox, .swal2-container"));
    return dialogs.find(dialog => {
      if (!isElementVisible(dialog)) return false;
      const text = normalizeText(dialog.textContent || "").toLowerCase();
      const html = String(dialog.innerHTML || "").toLowerCase();
      return text.includes("qr") ||
        text.includes("scan") ||
        text.includes("scanner") ||
        text.includes("game id") ||
        html.includes("camera") ||
        html.includes("video");
    });
  }

  function closeScannerDialogIfOpen() {
    const qrModal = document.querySelector("#modal_gameid_qrcode");
    if (qrModal) {
      if (window.jQuery) {
        window.jQuery(qrModal).modal("hide");
        return true;
      }

      const exactClose = qrModal.querySelector('button.close, .modal-header button[onclick*="modal"]');
      if (exactClose) {
        exactClose.click();
        return true;
      }
    }

    const dialog = findVisibleScannerDialog();
    if (!dialog) return false;

    const closeCandidates = Array.from(dialog.querySelectorAll("button, a, [role='button']"));
    const closeButton = closeCandidates.find(element => {
      if (!isElementVisible(element)) return false;
      const text = normalizeText(element.textContent || "");
      const aria = normalizeText(element.getAttribute("aria-label") || "").toLowerCase();
      const title = normalizeText(element.getAttribute("title") || "").toLowerCase();
      const classText = String(element.className || "").toLowerCase();
      const dataDismiss = String(element.getAttribute("data-dismiss") || "").toLowerCase();
      const combined = `${text} ${aria} ${title} ${classText} ${dataDismiss}`.toLowerCase();
      return text === "×" ||
        text === "x" ||
        combined.includes("close") ||
        combined.includes("fechar") ||
        combined.includes("閉じる") ||
        combined.includes("閉める") ||
        combined.includes("关闭") ||
        dataDismiss === "modal";
    });

    if (!closeButton) return false;
    closeButton.click();
    return true;
  }

  function saveOrderAndGo(order) {
    sessionStorage.setItem(CONFIG.storageKey, JSON.stringify(order));
    if (getCurrentTournamentId() === order.tournamentId) {
      executeOrder(order);
    } else {
      setStatus(`Test QR accepted: ${order.qrValue}\nOpening tournament ${order.tournamentId}...`, "info", true);
      location.href = order.tournamentUrl;
    }
  }

  function handleQrValue(rawValue) {
    const qrValue = normalizeText(rawValue);
    if (!qrValue.startsWith(CONFIG.qrPrefix)) return false;

    if (qrValue !== CONFIG.order.qrValue) {
      setStatus(`JOPT-RCP QR is not registered in this test script:\n${qrValue}`, "warning", false);
      return true;
    }

    closeScannerDialogIfOpen();
    saveOrderAndGo(CONFIG.order);
    return true;
  }

  function findQrValueInUnknownValue(value, depth) {
    if (depth > 2 || value == null) return "";
    if (typeof value === "string" || typeof value === "number") {
      const text = normalizeText(value);
      return text.startsWith(CONFIG.qrPrefix) ? text : "";
    }
    if (value && typeof value.value === "string") {
      const text = normalizeText(value.value);
      if (text.startsWith(CONFIG.qrPrefix)) return text;
    }
    if (value && value.target && typeof value.target.value === "string") {
      const text = normalizeText(value.target.value);
      if (text.startsWith(CONFIG.qrPrefix)) return text;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findQrValueInUnknownValue(item, depth + 1);
        if (found) return found;
      }
    } else if (typeof value === "object") {
      for (const key of ["qr", "qrcode", "code", "value", "data", "text", "query", "gameid"]) {
        const found = findQrValueInUnknownValue(value[key], depth + 1);
        if (found) return found;
      }
    }
    return "";
  }

  function findQrValueInInputs() {
    const fields = Array.from(document.querySelectorAll("input, textarea"));
    for (const field of fields) {
      if (typeof field.value !== "string") continue;
      const text = normalizeText(field.value);
      if (text.startsWith(CONFIG.qrPrefix)) return text;
    }
    return "";
  }

  function readQrValueFromPage(args) {
    for (const arg of args) {
      const found = findQrValueInUnknownValue(arg, 0);
      if (found) return found;
    }

    const active = document.activeElement;
    const activeFound = findQrValueInUnknownValue(active, 0);
    if (activeFound) return activeFound;

    return findQrValueInInputs();
  }

  function installInputQrListeners() {
    if (document.__joptRcpInputListenersInstalled) return;
    document.__joptRcpInputListenersInstalled = true;

    const maybeHandleInputQr = event => {
      const targetValue = event && event.target && typeof event.target.value === "string"
        ? normalizeText(event.target.value)
        : "";
      const qrValue = targetValue.startsWith(CONFIG.qrPrefix) ? targetValue : findQrValueInInputs();
      if (!qrValue) return;

      if (handleQrValue(qrValue)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    };

    document.addEventListener("change", maybeHandleInputQr, true);
    document.addEventListener("paste", () => setTimeout(() => {
      const qrValue = findQrValueInInputs();
      if (qrValue) handleQrValue(qrValue);
    }, 0), true);
    document.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      maybeHandleInputQr(event);
    }, true);

    let lastQr = "";
    document.addEventListener("input", event => {
      const value = event && event.target && typeof event.target.value === "string"
        ? normalizeText(event.target.value)
        : "";
      if (!value.startsWith(CONFIG.qrPrefix) || value === lastQr) return;
      lastQr = value;
      setTimeout(() => handleQrValue(value), 0);
    }, true);
  }

  function scanPageForQrDuringStartup() {
    let checks = 0;
    const timer = setInterval(() => {
      checks += 1;
      const qrValue = findQrValueInInputs();
      if (qrValue) {
        clearInterval(timer);
        handleQrValue(qrValue);
      } else if (checks >= 120) {
        clearInterval(timer);
      }
    }, 500);
  }

  function jumpIfOrderAlreadyScanned() {
    const qrValue = findQrValueInInputs();
    if (qrValue) {
      return handleQrValue(qrValue);
    }
    return false;
  }

  function installQrInterceptor() {
    if (typeof window.gameidSearchAction !== "function") return false;
    if (window.gameidSearchAction.__joptRcpWrapped) return true;

    originalGameidSearchAction = window.gameidSearchAction;

    function wrappedGameidSearchAction() {
      const args = Array.from(arguments);
      const qrValue = readQrValueFromPage(args);
      if (qrValue.startsWith(CONFIG.qrPrefix)) {
        if (handleQrValue(qrValue)) return undefined;
      }
      return originalGameidSearchAction.apply(this, args);
    }

    wrappedGameidSearchAction.__joptRcpWrapped = true;
    wrappedGameidSearchAction.__joptRcpOriginal = originalGameidSearchAction;
    window.gameidSearchAction = wrappedGameidSearchAction;
    return true;
  }

  function resumeSavedOrder() {
    const saved = sessionStorage.getItem(CONFIG.storageKey);
    if (!saved) return false;

    const order = JSON.parse(saved);
    if (getCurrentTournamentId() === order.tournamentId) {
      executeOrder(order);
      return true;
    }

    setStatus(`Saved test order exists for tournament ${order.tournamentId}.\nWaiting until target page is opened.`, "info", true);
    return false;
  }

  function startHookPolling() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      try {
        if (installQrInterceptor()) {
          clearInterval(timer);
          setStatus([
            "Ready.",
            "",
            "JOPT-RCP QR will be handled by this script.",
            "Other QR/Game ID values are passed to PokerWeb unchanged.",
            "",
            `Test QR: ${CONFIG.order.qrValue}`
          ].join("\n"), "info", false);
        } else if (attempts >= CONFIG.hookMaxAttempts) {
          clearInterval(timer);
          setStatus([
            "Panel is running, but window.gameidSearchAction was not found.",
            "",
            "Open the PokerWeb QR scan UI and refresh if needed.",
            `Test QR: ${CONFIG.order.qrValue}`
          ].join("\n"), "warning", true);
        }
      } catch (err) {
        clearInterval(timer);
        fail(err);
      }
    }, CONFIG.hookPollMs);
  }

  function bootstrap() {
    ensurePanel();
    installInputQrListeners();
    setStatus("Panel loaded.\nInitializing...", "info", false);

    let resumed = false;
    try {
      resumed = resumeSavedOrder();
    } catch (err) {
      sessionStorage.removeItem(CONFIG.storageKey);
      throw err;
    }

    if (!resumed) {
      if (jumpIfOrderAlreadyScanned()) return;
      scanPageForQrDuringStartup();
      startHookPolling();
    }
  }

  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
    } else {
      bootstrap();
    }
  } catch (err) {
    try {
      fail(err);
    } catch (secondaryError) {
      errorLog("Fatal initialization error", err, secondaryError);
      alert(`${LOG_PREFIX} fatal initialization error: ${err && err.message ? err.message : String(err)}`);
    }
  }
})();
