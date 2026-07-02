// ==UserScript==
// @name         PW Tournament Background Create
// @namespace    pw-tournament-background-create
// @version      0.1.0
// @description  API-first tournament create flow from fixed TSV: create, USDT, items, and Ticket Link without page-step pipeline.
// @author       xhpc007 + ChatGPT
// @match        https://japanopt.pokerweb.com.br/cb/*
// @match        https://japanopt.pokerweb.com.br/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const DEFAULT_INPUT = `大会名\t日付\t開始時間\tEN金額\tEN手数料\tEN回数\tRE金額\tRE手数料\tRE回数\tTE金額\tTE手数料\tTE回数\tチケット名称
test7777\t2026/07/02\t13:00\t80000\t1000\t1\t80000\t0\t3\t-74998\t0\t0\t【SPADIE TOKYO 42nd】Main Event / -2026.08.31`;

  const STORAGE = {
    input: "PW_BG_CREATE_INPUT_V01",
    report: "PW_BG_CREATE_REPORT_V01"
  };

  const SPEED = {
    afterCreateMs: 120,
    afterUsdtMs: 30,
    afterItemMs: 30,
    afterTicketMs: 50,
    betweenTournamentMs: 120,
    refetchAfterEachItem: false,
    refetchAfterEachTicket: false
  };

  const DEFAULTS = {
    modo: "0",
    qtd_dias: "1",
    vaga_geral: "0",
    vaga_ind: "0",
    datasGeradas: "0",
    id_estrutura: "18",
    id_blind: "1",
    entryChips: "50000",
    reEntryChips: "50000",
    teChips: "0",
    direito_img: "1",
    pts_ranking: "0",
    gameid_bloqueio: "1",
    rake: "0",
    taxa_extras: "",
    entryReposicionar: "0",
    reEntryReposicionar: "1",
    ticketReposicionar: "0"
  };

  const REQUIRED_HEADERS = [
    "大会名",
    "日付",
    "開始時間",
    "EN金額",
    "EN手数料",
    "EN回数",
    "RE金額",
    "RE手数料",
    "RE回数",
    "TE金額",
    "TE手数料",
    "TE回数",
    "チケット名称"
  ];

  const $ = sel => document.querySelector(sel);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function normalizeText(value) {
    return String(value ?? "")
      .replace(/\u3000/g, " ")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeAmount(value) {
    const s = normalizeText(value);
    if (!s) return "";
    return s.replace(/[￥¥,\s]/g, "");
  }

  function normalizeLimit(value) {
    const s = normalizeText(value);
    if (!s) return "";
    const lower = s.toLowerCase();
    if (["無制限", "无限制", "無限", "无限", "unlimited", "infinite", "inf"].includes(lower)) return "0";
    const digits = s.replace(/[^\d]/g, "");
    return digits === "" ? s : String(Number(digits));
  }

  function normalizeDateToDdMmYyyy(value) {
    const s = normalizeText(value);
    let m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
    if (m) return `${String(Number(m[3])).padStart(2, "0")}/${String(Number(m[2])).padStart(2, "0")}/${m[1]}`;
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) return `${String(Number(m[1])).padStart(2, "0")}/${String(Number(m[2])).padStart(2, "0")}/${m[3]}`;
    return s;
  }

  function normalizeTime(value) {
    const s = normalizeText(value);
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    return m ? `${String(Number(m[1])).padStart(2, "0")}:${m[2]}` : s;
  }

  function splitTickets(value) {
    const s = String(value || "").trim();
    if (!s) return [];
    return s.split(/\n|、|，|;|；|\|/).map(normalizeText).filter(Boolean);
  }

  function parseInput(raw) {
    const lines = String(raw || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map(line => line.replace(/\uFEFF/g, ""))
      .filter(line => normalizeText(line));

    if (lines.length < 2) throw new Error("Input must contain header and at least one data row.");

    const header = lines[0].split("\t").map(normalizeText);
    const idx = {};
    header.forEach((h, i) => { if (h) idx[h] = i; });

    const missing = REQUIRED_HEADERS.filter(h => !(h in idx));
    if (missing.length) throw new Error(`Missing headers: ${missing.join(", ")}`);

    return lines.slice(1).map((line, lineIndex) => {
      const cols = line.split("\t");
      const cell = h => normalizeText(cols[idx[h]] ?? "");
      const name = cell("大会名");
      const date = normalizeDateToDdMmYyyy(cell("日付"));
      const time = normalizeTime(cell("開始時間"));
      const rowNo = lineIndex + 2;
      if (!name || !date || !time) {
        throw new Error(`Row ${rowNo}: 大会名 / 日付 / 開始時間 are required.`);
      }

      return {
        rowNo,
        name,
        date,
        time,
        entry: {
          nome: "Entry",
          siglas: "En",
          valor: normalizeAmount(cell("EN金額")),
          taxa: normalizeAmount(cell("EN手数料")),
          limite: normalizeLimit(cell("EN回数")),
          fichas: DEFAULTS.entryChips,
          reposicionar: DEFAULTS.entryReposicionar
        },
        reEntry: {
          nome: "Re Entry",
          siglas: "Re",
          valor: normalizeAmount(cell("RE金額")),
          taxa: normalizeAmount(cell("RE手数料")),
          limite: normalizeLimit(cell("RE回数")),
          fichas: DEFAULTS.reEntryChips,
          reposicionar: DEFAULTS.reEntryReposicionar
        },
        ticketEntry: {
          nome: "Ticket Entry",
          siglas: "TE",
          valor: normalizeAmount(cell("TE金額")),
          taxa: normalizeAmount(cell("TE手数料")),
          limite: normalizeLimit(cell("TE回数")),
          fichas: DEFAULTS.teChips,
          reposicionar: DEFAULTS.ticketReposicionar
        },
        tickets: splitTickets(cols[idx["チケット名称"]] ?? "")
      };
    });
  }

  function log(line) {
    const box = $("#pw-bg-poc-report");
    if (!box) return;
    box.value += `${line}\n`;
    box.scrollTop = box.scrollHeight;
    localStorage.setItem(STORAGE.report, box.value);
    console.log(`[PW-BG-POC] ${line}`);
  }

  function clearLog() {
    const box = $("#pw-bg-poc-report");
    if (box) box.value = "";
    localStorage.removeItem(STORAGE.report);
  }

  function renderPreview() {
    clearLog();
    const raw = $("#pw-bg-poc-input").value;
    localStorage.setItem(STORAGE.input, raw);
    const tournaments = parseInput(raw);
    log(`PREVIEW tournaments=${tournaments.length}`);
    tournaments.forEach((t, i) => {
      log(`${i + 1}. row=${t.rowNo} ${t.name}`);
      log(`   Start: ${t.date} ${t.time}`);
      log(`   Entry: ${t.entry.valor} + ${t.entry.taxa} / limit=${t.entry.limite}`);
      log(`   Re Entry: ${t.reEntry.valor} + ${t.reEntry.taxa} / limit=${t.reEntry.limite}`);
      log(`   Ticket Entry: ${t.ticketEntry.valor} + ${t.ticketEntry.taxa} / limit=${t.ticketEntry.limite}`);
      log(`   Tickets: ${t.tickets.length ? t.tickets.join(" | ") : "(none)"}`);
    });
  }

  async function createTournament(t) {
    const fd = new FormData();
    fd.set("ddTrnNovo[modo]", DEFAULTS.modo);
    fd.set("ddTrnNovo[qtd_dias]", DEFAULTS.qtd_dias);
    fd.set("ddTrnNovo[nome]", t.name);
    fd.set("ddTrnNovo[id_estrutura]", DEFAULTS.id_estrutura);
    fd.set("ddTrnNovo[id_blind]", DEFAULTS.id_blind);
    fd.set("ddTrnNovo[data]", t.date);
    fd.set("ddTrnNovo[hora]", t.time);
    fd.set("ddTrnNovo[vaga_geral]", DEFAULTS.vaga_geral);
    fd.set("ddTrnNovo[vaga_ind]", DEFAULTS.vaga_ind);
    fd.set("ddTrnNovo[datasGeradas]", DEFAULTS.datasGeradas);

    const res = await fetch("/cb/torneio/cadastrar", {
      method: "POST",
      body: fd,
      credentials: "same-origin",
      redirect: "follow"
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (_) {
      throw new Error(`CREATE response is not JSON: ${text.slice(0, 300)}`);
    }
    const id = json?.ddTrns?.id_torneio;
    if (!res.ok || !id) throw new Error(`CREATE failed status=${res.status}: ${text.slice(0, 300)}`);
    return String(id);
  }

  async function fetchTournamentDoc(id) {
    const res = await fetch(`/cb/torneio/painel/${id}`, {
      credentials: "same-origin",
      cache: "no-store"
    });
    const html = await res.text();
    if (!res.ok) throw new Error(`FETCH painel failed status=${res.status}`);
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.__pwBgPocRawHtml = html;
    return doc;
  }

  async function enableVirtualCurrency(id) {
    const body = new URLSearchParams();
    body.set("campo", "vendas_moeda_virtual");
    body.set("id_torneio", id);
    body.set("status", "1");
    const res = await fetch("/cb/torneio/abas/configuracao/alterar_campos", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: body.toString(),
      credentials: "same-origin"
    });
    if (!res.ok) throw new Error(`USDT failed status=${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res;
  }

  function itemData(item) {
    return {
      nome: item.nome,
      siglas: item.siglas,
      fichas: item.fichas,
      limite: item.limite,
      reposicionar: item.reposicionar,
      direito_img: DEFAULTS.direito_img,
      pts_ranking: DEFAULTS.pts_ranking,
      gameid_bloqueio: DEFAULTS.gameid_bloqueio,
      valor: item.valor,
      taxa: item.taxa || "0",
      rake: DEFAULTS.rake,
      taxa_extras: DEFAULTS.taxa_extras
    };
  }

  function applyFormData(fd, data) {
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined && value !== null) fd.set(key, value);
    });
  }

  function existingItems(doc) {
    return [...doc.querySelectorAll('a[href="#modal_item_editar"][data-id_item], [data-id_item][data-nome]')]
      .map(el => ({
        id_item: el.getAttribute("data-id_item") || "",
        nome: normalizeText(el.getAttribute("data-nome") || ""),
        siglas: normalizeText(el.getAttribute("data-siglas") || ""),
        valor: normalizeText(el.getAttribute("data-valor") || ""),
        raw: el.outerHTML
      }))
      .filter(x => x.id_item);
  }

  function findExistingItem(items, item) {
    const siglas = normalizeText(item.siglas);
    const name = normalizeText(item.nome);
    return items.find(x => siglas && x.siglas === siglas) ||
      items.find(x => name && x.nome === name) ||
      null;
  }

  async function saveItemByHtml(id, doc, item) {
    const items = existingItems(doc);
    const existing = findExistingItem(items, item);
    const form = existing
      ? doc.querySelector('form[action*="item_editar"]')
      : doc.querySelector('form[action*="item_criar"]');

    if (!form) throw new Error(`${item.nome}: item form not found`);

    const fd = new FormData(form);
    applyFormData(fd, itemData(item));
    fd.set("id_torneio", id);
    if (existing) fd.set("id_item", existing.id_item);

    const action = form.getAttribute("action") || (existing
      ? "/cb/torneio/abas/configuracao/item_editar"
      : "/cb/torneio/abas/configuracao/item_criar");

    const res = await fetch(action, {
      method: "POST",
      body: fd,
      credentials: "same-origin",
      redirect: "follow"
    });
    if (!res.ok) throw new Error(`${item.nome}: save failed status=${res.status}: ${(await res.text()).slice(0, 300)}`);
    return { action: existing ? "EDIT" : "INSERT", id_item: existing?.id_item || "" };
  }

  function normalizeTicketText(value) {
    return normalizeText(value).replace(/\s+/g, " ");
  }

  function compactTicketText(value) {
    return normalizeTicketText(value)
      .replace(/^ナショナルチケット\s*-\s*/i, "")
      .replace(/\s+/g, "")
      .toLowerCase();
  }

  function findTicketOption(doc, ticketName) {
    const select = doc.querySelector('form[action*="vincular_grupos_vagas"] select[name="grupo_vagas"], select[name="grupo_vagas"]');
    if (!select) throw new Error("Ticket Link select not found");
    const target = normalizeTicketText(ticketName);
    const compactTarget = compactTicketText(target);
    const options = [...select.querySelectorAll("option")]
      .map(option => ({
        value: option.value,
        text: normalizeTicketText(option.textContent || "")
      }))
      .filter(x => /^tn_\d+$/i.test(x.value) && x.text);

    const exact = options.filter(x => x.text === target || x.text === `ナショナルチケット - ${target}`);
    if (exact.length === 1) return { option: exact[0], matchType: "EXACT" };
    if (exact.length > 1) throw new Error(`Ticket ambiguous exact: ${ticketName}`);

    const compact = options.filter(x => compactTicketText(x.text) === compactTarget);
    if (compact.length === 1) return { option: compact[0], matchType: "COMPACT" };
    if (compact.length > 1) throw new Error(`Ticket ambiguous compact: ${ticketName}`);

    const includes = options.filter(x => compactTicketText(x.text).includes(compactTarget));
    if (includes.length === 1) return { option: includes[0], matchType: "INCLUDES_WARN" };
    if (includes.length > 1) throw new Error(`Ticket ambiguous includes: ${ticketName}`);
    throw new Error(`Ticket not found: ${ticketName}`);
  }

  function htmlAttrValue(html, name) {
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`name=["']${escaped}["'][^>]*value=["']([^"']*)["']`, "i"),
      new RegExp(`value=["']([^"']*)["'][^>]*name=["']${escaped}["']`, "i")
    ];
    for (const pattern of patterns) {
      const match = String(html || "").match(pattern);
      if (match) return match[1] || "";
    }
    return "";
  }

  function readCodbloq(doc, form) {
    return form.querySelector('[name="codbloq"]')?.value ||
      doc.querySelector('form[action*="vincular_grupos_vagas"] [name="codbloq"]')?.value ||
      doc.querySelector('[name="codbloq"]')?.value ||
      htmlAttrValue(form.outerHTML, "codbloq") ||
      htmlAttrValue(doc.__pwBgPocRawHtml, "codbloq") ||
      document.querySelector('form[action*="vincular_grupos_vagas"] [name="codbloq"]')?.value ||
      document.querySelector('[name="codbloq"]')?.value ||
      "";
  }

  async function linkTicketByHtml(id, doc, ticketName) {
    const form = doc.querySelector('form[action*="vincular_grupos_vagas"]');
    if (!form) throw new Error("Ticket Link form not found");
    const codbloq = readCodbloq(doc, form);
    if (!codbloq) throw new Error("Ticket Link codbloq not found");

    const found = findTicketOption(doc, ticketName);
    const fd = new FormData();
    fd.set("grupo_vagas", found.option.value);
    fd.set("codbloq", codbloq);
    fd.set("id_torneio", id);

    const res = await fetch(form.getAttribute("action") || "/cb/torneio/abas/configuracao/vincular_grupos_vagas", {
      method: "POST",
      body: fd,
      credentials: "same-origin",
      redirect: "follow"
    });
    if (!res.ok) throw new Error(`Ticket Link failed status=${res.status}: ${(await res.text()).slice(0, 300)}`);
    return found;
  }

  async function processTournament(t, index, total) {
    log(`START_TOURNAMENT ${index + 1}/${total} row=${t.rowNo} ${t.name}`);
    const id = await createTournament(t);
    log(`CREATE_OK id=${id} url=${location.origin}/cb/torneio/painel/${id}`);
    await sleep(SPEED.afterCreateMs);

    await enableVirtualCurrency(id);
    log("USDT_OK");
    await sleep(SPEED.afterUsdtMs);

    let doc = await fetchTournamentDoc(id);
    for (const item of [t.entry, t.reEntry, t.ticketEntry]) {
      const result = await saveItemByHtml(id, doc, item);
      log(`ITEM_${result.action}_OK ${item.nome}/${item.siglas} value=${item.valor} id_item=${result.id_item || "(new)"}`);
      await sleep(SPEED.afterItemMs);
      if (SPEED.refetchAfterEachItem) doc = await fetchTournamentDoc(id);
    }

    if (t.tickets.length && !SPEED.refetchAfterEachItem) {
      doc = await fetchTournamentDoc(id);
    }

    for (const ticket of t.tickets) {
      const result = await linkTicketByHtml(id, doc, ticket);
      log(`LINK_OK ${ticket} value=${result.option.value} match=${result.matchType}`);
      await sleep(SPEED.afterTicketMs);
      if (SPEED.refetchAfterEachTicket) doc = await fetchTournamentDoc(id);
    }

    log(`DONE_TOURNAMENT ${index + 1}/${total} ${location.origin}/cb/torneio/painel/${id}`);
    return id;
  }

  async function runCreate() {
    clearLog();
    const raw = $("#pw-bg-poc-input").value;
    localStorage.setItem(STORAGE.input, raw);
    const tournaments = parseInput(raw);
    const summary = tournaments
      .map((t, i) => `${i + 1}. row=${t.rowNo} ${t.name}\n   ${t.date} ${t.time} / tickets=${t.tickets.length}`)
      .join("\n\n");
    const ok = confirm(
      `Create tournaments?\n\n` +
      `Count: ${tournaments.length}\n\n` +
      `${summary}\n\n` +
      `This writes to PokerWeb.`
    );
    if (!ok) return;

    log(`START batch count=${tournaments.length}`);
    const ids = [];
    for (let i = 0; i < tournaments.length; i++) {
      const id = await processTournament(tournaments[i], i, tournaments.length);
      ids.push(id);
      await sleep(SPEED.betweenTournamentMs);
    }
    log(`DONE batch count=${ids.length}`);
    ids.forEach((id, i) => log(`RESULT ${i + 1}. ${location.origin}/cb/torneio/painel/${id}`));
  }

  function addPanel() {
    if ($("#pw-bg-poc-panel")) return;
    const panel = document.createElement("div");
    panel.id = "pw-bg-poc-panel";
    panel.style.cssText = [
      "position:fixed",
      "right:18px",
      "top:90px",
      "z-index:999999",
      "width:560px",
      "max-height:88vh",
      "overflow:auto",
      "background:#111",
      "color:#fff",
      "border:2px solid #70d6ff",
      "border-radius:8px",
      "padding:12px",
      "font:12px/1.45 Arial,sans-serif",
      "box-shadow:0 10px 30px rgba(0,0,0,.35)"
    ].join(";");

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
        <strong>PW Tournament Background Create</strong>
        <button id="pw-bg-poc-close" style="cursor:pointer;">x</button>
      </div>
      <textarea id="pw-bg-poc-input" style="width:100%;height:105px;box-sizing:border-box;background:#fff;color:#111;font:12px Consolas,monospace;"></textarea>
      <div style="display:flex;gap:6px;margin:8px 0;">
        <button id="pw-bg-poc-preview" style="flex:1;padding:7px;cursor:pointer;">Preview</button>
        <button id="pw-bg-poc-run" style="flex:1;padding:7px;cursor:pointer;background:#ffe08a;">CREATE + SET + LINK</button>
        <button id="pw-bg-poc-clear" style="padding:7px;cursor:pointer;">Clear</button>
        <button id="pw-bg-poc-copy" style="padding:7px;cursor:pointer;">Copy Report</button>
      </div>
      <textarea id="pw-bg-poc-report" readonly style="width:100%;height:220px;box-sizing:border-box;background:#181818;color:#d8f8ff;border:1px solid #555;font:12px Consolas,monospace;"></textarea>
      <div style="margin-top:6px;color:#f6d365;">CREATE button writes to PokerWeb. Preview first.</div>
    `;

    document.body.appendChild(panel);
    $("#pw-bg-poc-input").value = localStorage.getItem(STORAGE.input) || DEFAULT_INPUT;
    $("#pw-bg-poc-report").value = localStorage.getItem(STORAGE.report) || "";
    $("#pw-bg-poc-preview").onclick = () => {
      try {
        renderPreview();
      } catch (e) {
        clearLog();
        log(`ERROR ${e.message || e}`);
      }
    };
    $("#pw-bg-poc-run").onclick = () => runCreate().catch(e => log(`ERROR ${e.message || e}`));
    $("#pw-bg-poc-clear").onclick = () => clearLog();
    $("#pw-bg-poc-copy").onclick = async () => {
      const text = $("#pw-bg-poc-report").value || "";
      await navigator.clipboard.writeText(text);
      alert("Report copied");
    };
    $("#pw-bg-poc-close").onclick = () => panel.remove();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addPanel);
  } else {
    addPanel();
  }
})();
