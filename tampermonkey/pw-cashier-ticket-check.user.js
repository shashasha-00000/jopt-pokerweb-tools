// ==UserScript==
// @name         PW キャッシャーチケット Check
// @namespace    pw-cashier-ticket-check
// @version      0.1.0
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-cashier-ticket-check.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-cashier-ticket-check.user.js
// @description  Quick read-only Main Event ticket check from the PokerWeb tournament cashier page.
// @author       xhpc007 + Codex
// @match        https://japanopt.pokerweb.com.br/cb/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const APP = {
    panelId: "pwctq-panel",
    bodyId: "pwctq-body",
    idsKey: "PWCTQ_GAME_IDS",
    keywordsKey: "PWCTQ_KEYWORDS",
    collapsedKey: "PWCTQ_COLLAPSED",
    defaultKeywords: "Main Event",
    playerSearchUrl: "/cb/jogadores/search",
    cashierUrl: "/cb/torneio/abas/caixa/dados_caixa",
    delayMs: 180
  };

  let running = false;
  let stopRequested = false;
  let lastOutput = "";

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

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatGameId(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (digits.length !== 8) return String(value || "");
    return `${digits.slice(0, 4)}.${digits.slice(4)}`;
  }

  function getCurrentTournamentId() {
    const match = location.pathname.match(/\/cb\/torneio\/painel\/(\d+)/);
    return match ? match[1] : "";
  }

  function parseGameIds(raw) {
    const seen = new Set();
    const ids = [];
    const text = String(raw || "");
    const regex = /(?:^|\D)(\d{4}[\s.-]?\d{4}|\d{8})(?=\D|$)/g;
    let match;

    while ((match = regex.exec(text))) {
      const gameId = match[1].replace(/\D/g, "");
      if (gameId.length !== 8 || seen.has(gameId)) continue;
      seen.add(gameId);
      ids.push(gameId);
    }

    return ids;
  }

  function parseKeywords(raw) {
    return String(raw || "")
      .split(/\r?\n/)
      .map(normalizeText)
      .filter(Boolean)
      .map(value => value.toLowerCase());
  }

  function parseHtml(html) {
    return new DOMParser().parseFromString(String(html || ""), "text/html");
  }

  async function postForm(url, data) {
    const body = new URLSearchParams();
    Object.entries(data || {}).forEach(([key, value]) => body.append(key, value));

    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.text();
  }

  async function findInternalPlayerId(gameId) {
    const formattedGameId = formatGameId(gameId);
    const html = await postForm(APP.playerSearchUrl, {
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
      throw new Error(`Player search matched multiple IDs: ${unique.map(x => x.internalId).join(", ")}`);
    }
    throw new Error(`Player not found: ${formattedGameId}`);
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

  async function waitForCondition(checkFn, timeoutMs, label) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = checkFn();
      if (value) return value;
      await sleep(120);
    }
    throw new Error(`Timed out waiting for ${label || "condition"}`);
  }

  async function loadCashier(internalPlayerId, tournamentId) {
    const html = await postForm(APP.cashierUrl, {
      id_jogador: internalPlayerId,
      id_torneio: tournamentId,
      premiacao_origem: "0"
    });

    const container = document.querySelector("#clientes-detalhes");
    if (!container) {
      throw new Error("Open a tournament panel with the cashier area first.");
    }

    replaceHtmlAndRunScripts(container, html);
    await waitForCondition(() => document.querySelector("#form_caixa"), 10000, "#form_caixa");
    await waitForCondition(() => {
      return document.querySelector('#form_caixa input[name="usarvaga[]"]') ||
        document.querySelector("#form_caixa");
    }, 10000, "cashier ticket area");
  }

  function normalizeTicketName(value) {
    return normalizeText(value)
      .replace(/^National Ticket\s*-\s*/i, "")
      .replace(/^Ticket\s*-\s*/i, "")
      .replace(/\s*Source:\s*JOPT\s*-\s*Japan Open Poker Tour\s*/gi, "")
      .trim();
  }

  function getTicketName(checkbox) {
    const row = checkbox.closest("tr");
    if (!row) return "";

    const cells = Array.from(row.querySelectorAll("td"));
    const source = cells[1] || row;
    const clone = source.cloneNode(true);
    for (const selector of ["input", "button", "select", "textarea", ".vaga_editar_valor"]) {
      for (const node of Array.from(clone.querySelectorAll(selector))) {
        node.remove();
      }
    }
    return normalizeTicketName(clone.textContent);
  }

  function readCashierTickets(keywords) {
    const tickets = Array.from(document.querySelectorAll('#form_caixa input[name="usarvaga[]"]'))
      .map(checkbox => {
        const row = checkbox.closest("tr");
        const ticketName = getTicketName(checkbox);
        return {
          id: checkbox.value || checkbox.id || "",
          name: ticketName,
          rowText: normalizeText(row ? row.textContent : ticketName)
        };
      })
      .filter(ticket => ticket.name || ticket.rowText);

    if (!keywords.length) return tickets;

    return tickets.filter(ticket => {
      const target = `${ticket.name} ${ticket.rowText}`.toLowerCase();
      return keywords.some(keyword => target.includes(keyword));
    });
  }

  function setStatus(message, isError) {
    const el = document.querySelector("#pwctq-status");
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? "#ffb4b4" : "#bde7ff";
  }

  function setProgress(text) {
    const el = document.querySelector("#pwctq-progress");
    if (el) el.textContent = text || "";
  }

  function renderResults(results) {
    const box = document.querySelector("#pwctq-results");
    if (!box) return;

    const rows = results.map(result => {
      const color = result.error ? "#ffcdcd" : result.count > 0 ? "#b7ffbf" : "#ffe2a8";
      const detail = result.error
        ? result.error
        : result.tickets.length
          ? result.tickets.map(ticket => ticket.name || ticket.rowText || ticket.id).join("<br>")
          : "No matching ticket";

      return `
        <tr>
          <td>${escapeHtml(formatGameId(result.gameId))}</td>
          <td style="color:${color};font-weight:bold;">${escapeHtml(result.status)}</td>
          <td>${escapeHtml(String(result.count))}</td>
          <td>${detail}</td>
        </tr>
      `;
    }).join("");

    box.innerHTML = `
      <div style="max-height:280px;overflow:auto;margin-top:8px;">
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
          <thead>
            <tr>
              <th style="text-align:left;border-bottom:1px solid #52616f;">GameID</th>
              <th style="text-align:left;border-bottom:1px solid #52616f;">Result</th>
              <th style="text-align:left;border-bottom:1px solid #52616f;">Qty</th>
              <th style="text-align:left;border-bottom:1px solid #52616f;">Ticket</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function toTsv(results) {
    const rows = [["GameID", "Result", "Qty", "Ticket", "Error"]];
    for (const result of results) {
      if (result.error) {
        rows.push([formatGameId(result.gameId), "ERROR", "0", "", result.error]);
        continue;
      }
      if (!result.tickets.length) {
        rows.push([formatGameId(result.gameId), "NO", "0", "", ""]);
        continue;
      }
      for (const ticket of result.tickets) {
        rows.push([formatGameId(result.gameId), "YES", String(result.count), ticket.name || ticket.rowText, ""]);
      }
    }
    return rows
      .map(row => row.map(value => normalizeText(value).replace(/\t/g, " ")).join("\t"))
      .join("\n");
  }

  function updateButtons() {
    const run = document.querySelector("#pwctq-run");
    const stop = document.querySelector("#pwctq-stop");
    if (run) run.disabled = running;
    if (stop) stop.disabled = !running;
  }

  async function runCheck() {
    if (running) return;

    const idsInput = document.querySelector("#pwctq-ids");
    const keywordsInput = document.querySelector("#pwctq-keywords");
    const gameIds = parseGameIds(idsInput ? idsInput.value : "");
    const keywords = parseKeywords(keywordsInput ? keywordsInput.value : "");
    const tournamentId = getCurrentTournamentId();

    if (!tournamentId) {
      setStatus("Open a PokerWeb tournament panel page first.", true);
      return;
    }
    if (!gameIds.length) {
      setStatus("Paste one or more 8-digit GameIDs first.", true);
      return;
    }

    localStorage.setItem(APP.idsKey, idsInput.value || "");
    localStorage.setItem(APP.keywordsKey, keywordsInput.value || "");

    running = true;
    stopRequested = false;
    lastOutput = "";
    updateButtons();
    setStatus("Checking...", false);
    renderResults([]);

    const results = [];
    try {
      for (let i = 0; i < gameIds.length; i++) {
        if (stopRequested) break;

        const gameId = gameIds[i];
        setProgress(`${i + 1}/${gameIds.length}  ${formatGameId(gameId)}`);

        try {
          const internalPlayerId = await findInternalPlayerId(gameId);
          await loadCashier(internalPlayerId, tournamentId);
          const tickets = readCashierTickets(keywords);
          results.push({
            gameId,
            status: tickets.length ? "YES" : "NO",
            count: tickets.length,
            tickets,
            error: ""
          });
        } catch (error) {
          results.push({
            gameId,
            status: "ERROR",
            count: 0,
            tickets: [],
            error: error.message || String(error)
          });
        }

        renderResults(results);
        if (i < gameIds.length - 1) await sleep(APP.delayMs);
      }

      lastOutput = toTsv(results);
      const yesCount = results.filter(result => !result.error && result.count > 0).length;
      const errorCount = results.filter(result => result.error).length;
      setStatus(
        `${stopRequested ? "Stopped" : "Done"}: YES ${yesCount} / Total ${results.length} / Error ${errorCount}`,
        errorCount > 0
      );
    } finally {
      running = false;
      updateButtons();
      setProgress("");
    }
  }

  function copyResults() {
    if (!lastOutput) {
      setStatus("No result to copy yet.", true);
      return;
    }
    try {
      if (typeof GM_setClipboard === "function") {
        GM_setClipboard(lastOutput);
      } else {
        navigator.clipboard.writeText(lastOutput);
      }
      setStatus("Result copied.", false);
    } catch (error) {
      setStatus(`Copy failed: ${error.message || error}`, true);
    }
  }

  function setCollapsed(collapsed) {
    const body = document.querySelector(`#${APP.bodyId}`);
    const btn = document.querySelector("#pwctq-min");
    if (body) body.style.display = collapsed ? "none" : "block";
    if (btn) btn.textContent = collapsed ? "Open" : "Min";
    localStorage.setItem(APP.collapsedKey, collapsed ? "1" : "0");
  }

  function installPanel() {
    if (document.getElementById(APP.panelId)) return;
    if (!document.body) return;

    const panel = document.createElement("div");
    panel.id = APP.panelId;
    panel.style.cssText = [
      "position:fixed",
      "right:14px",
      "bottom:14px",
      "z-index:2147483647",
      "width:470px",
      "max-width:calc(100vw - 28px)",
      "box-sizing:border-box",
      "padding:10px",
      "border:2px solid #3b82f6",
      "border-radius:8px",
      "background:rgba(17,24,39,.97)",
      "color:#fff",
      "font:12px/1.45 Arial,'Yu Gothic',Meiryo,sans-serif",
      "box-shadow:0 10px 28px rgba(0,0,0,.4)"
    ].join(";");

    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;">
        <strong style="flex:1;">PW Cashier Ticket Quick Check</strong>
        <button id="pwctq-min" type="button">Min</button>
        <button id="pwctq-close" type="button">x</button>
      </div>
      <div id="${APP.bodyId}" style="margin-top:8px;">
        <textarea id="pwctq-ids" spellcheck="false" placeholder="Paste GameIDs, one per line"
          style="width:100%;height:74px;box-sizing:border-box;font:12px/1.35 Consolas,monospace;"></textarea>
        <details style="margin-top:6px;">
          <summary style="cursor:pointer;">Ticket keyword filter</summary>
          <textarea id="pwctq-keywords" spellcheck="false"
            style="width:100%;height:46px;box-sizing:border-box;font:12px/1.35 Consolas,monospace;"></textarea>
          <div style="color:#cbd5e1;margin-top:3px;">Blank = all cashier tickets. One keyword per line.</div>
        </details>
        <div style="display:flex;gap:6px;margin-top:7px;align-items:center;">
          <button id="pwctq-run" type="button" style="flex:1;">Check</button>
          <button id="pwctq-stop" type="button" disabled>Stop</button>
          <button id="pwctq-copy" type="button">Copy TSV</button>
        </div>
        <div id="pwctq-status" style="margin-top:7px;color:#bde7ff;">Read-only. Open a tournament cashier page, paste GameIDs, then Check.</div>
        <div id="pwctq-progress" style="margin-top:3px;color:#cbd5e1;"></div>
        <div id="pwctq-results"></div>
      </div>
    `;

    document.body.appendChild(panel);
    document.querySelector("#pwctq-ids").value = localStorage.getItem(APP.idsKey) || "";
    document.querySelector("#pwctq-keywords").value = localStorage.getItem(APP.keywordsKey) || APP.defaultKeywords;
    document.querySelector("#pwctq-run").onclick = runCheck;
    document.querySelector("#pwctq-stop").onclick = () => {
      stopRequested = true;
      setStatus("Stopping after the current player...", false);
    };
    document.querySelector("#pwctq-copy").onclick = copyResults;
    document.querySelector("#pwctq-min").onclick = () => {
      const body = document.querySelector(`#${APP.bodyId}`);
      setCollapsed(body && body.style.display !== "none");
    };
    document.querySelector("#pwctq-close").onclick = () => panel.remove();
    setCollapsed(localStorage.getItem(APP.collapsedKey) === "1");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installPanel, { once: true });
  } else {
    installPanel();
  }
})();
