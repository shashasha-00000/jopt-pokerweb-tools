// ==UserScript==
// @name         PW 大会作成 Auto
// @namespace    pw-tournament-create-auto
// @version      0.2.2
// @description  API-first tournament create flow from fixed TSV: create, settings, items, and Ticket Link in 10-tournament rounds.
// @updateURL    https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-tournament-create-auto.user.js
// @downloadURL  https://raw.githubusercontent.com/shashasha-00000/jopt-pokerweb-tools/main/tampermonkey/pw-tournament-create-auto.user.js
// @author       xhpc007 + ChatGPT
// @match        https://japanopt.pokerweb.com.br/cb/*
// @match        https://japanopt.pokerweb.com.br/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const DEFAULT_INPUT = `大会名\t日付\t開始時間\tEN名称\tEN略称\tEN金額\tEN手数料\tEN回数\tENチップ数\tRE名称\tRE略称\tRE金額\tRE手数料\tRE回数\tREチップ数\tTE名称\tTE略称\tTE金額\tTE手数料\tTE回数\tチケット名称
test7777\t2026/07/02\t13:00\t\t\t80000\t1000\t1\t\t\t\t80000\t0\t3\t\t\t\t-74998\t0\t0\t【SPADIE TOKYO 42nd】Main Event / -2026.08.31`;

  const STORAGE = {
    input: "PW_BG_CREATE_INPUT_V01",
    report: "PW_BG_CREATE_REPORT_V01"
  };

  const SPEED = {
    tournamentBatchSize: 10,
    afterCreateMs: 120,
    afterUsdtMs: 30,
    afterItemMs: 30,
    afterTicketRoundMs: 50,
    betweenBatchMs: 120,
    refetchAfterEachItem: false
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

  const GENERAL_SETTINGS = [
    { campo: "config_imprimirutilizados", status: "1", label: "SALE_TICKET_VIEW" },
    { campo: "config_imprimirdireto", status: "1", label: "TICKET_PRINT_DIRECT" },
    { campo: "config_sentarjog", status: "0", label: "DEFAULT_NO_SEAT" },
    { campo: "ticket_direitoimg", status: "1", label: "TICKET_IMAGE_RIGHTS" },
    { campo: "vendas_moeda_virtual", status: "1", label: "VIRTUAL_CURRENCY" }
  ];

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

  function isBlankOrNumericZero(value) {
    const s = normalizeText(value).replace(/[￥¥,\s]/g, "");
    if (!s) return true;
    return /^[-+]?0+(?:\.0+)?$/.test(s);
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

      const teAmount = normalizeAmount(cell("TE金額"));
      const teFee = normalizeAmount(cell("TE手数料"));
      const teLimit = normalizeLimit(cell("TE回数"));
      const hasTicketEntry = ![teAmount, teFee, teLimit].every(isBlankOrNumericZero);

      return {
        rowNo,
        name,
        date,
        time,
        entry: {
          nome: cell("EN名称") || "Entry",
          siglas: cell("EN略称") || "En",
          lookupNome: "Entry",
          lookupSiglas: "En",
          valor: normalizeAmount(cell("EN金額")),
          taxa: normalizeAmount(cell("EN手数料")),
          limite: normalizeLimit(cell("EN回数")),
          fichas: normalizeAmount(cell("ENチップ数")) || DEFAULTS.entryChips,
          reposicionar: DEFAULTS.entryReposicionar
        },
        reEntry: {
          nome: cell("RE名称") || "Re Entry",
          siglas: cell("RE略称") || "Re",
          lookupNome: "Re Entry",
          lookupSiglas: "Re",
          valor: normalizeAmount(cell("RE金額")),
          taxa: normalizeAmount(cell("RE手数料")),
          limite: normalizeLimit(cell("RE回数")),
          fichas: normalizeAmount(cell("REチップ数")) || DEFAULTS.reEntryChips,
          reposicionar: DEFAULTS.reEntryReposicionar
        },
        ticketEntry: hasTicketEntry
          ? {
              nome: cell("TE名称") || "Ticket Entry",
              siglas: cell("TE略称") || "TE",
              lookupNome: "Ticket Entry",
              lookupSiglas: "TE",
              valor: teAmount,
              taxa: teFee,
              limite: teLimit,
              fichas: DEFAULTS.teChips,
              reposicionar: DEFAULTS.ticketReposicionar
            }
          : null,
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
      log(`   EN: ${t.entry.nome}/${t.entry.siglas} / ${t.entry.valor} + ${t.entry.taxa} / limit=${t.entry.limite} / chips=${t.entry.fichas}`);
      log(`   RE: ${t.reEntry.nome}/${t.reEntry.siglas} / ${t.reEntry.valor} + ${t.reEntry.taxa} / limit=${t.reEntry.limite} / chips=${t.reEntry.fichas}`);
      log(t.ticketEntry
        ? `   TE: ${t.ticketEntry.nome}/${t.ticketEntry.siglas} / ${t.ticketEntry.valor} + ${t.ticketEntry.taxa} / limit=${t.ticketEntry.limite}`
        : "   TE: (none)");
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

  async function setGeneralSetting(id, setting) {
    const body = new URLSearchParams();
    body.set("campo", setting.campo);
    body.set("id_torneio", id);
    body.set("status", setting.status);
    const res = await fetch("/cb/torneio/abas/configuracao/alterar_campos", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: body.toString(),
      credentials: "same-origin"
    });
    if (!res.ok) throw new Error(`${setting.label} failed status=${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res;
  }

  async function applyGeneralSettings(id) {
    for (const setting of GENERAL_SETTINGS) {
      await setGeneralSetting(id, setting);
      log(`GENERAL_SETTING_OK ${setting.label} ${setting.campo}=${setting.status}`);
      await sleep(30);
    }
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
    const siglasCandidates = [...new Set([
      normalizeText(item.lookupSiglas),
      normalizeText(item.siglas)
    ].filter(Boolean))];
    const nameCandidates = [...new Set([
      normalizeText(item.lookupNome),
      normalizeText(item.nome)
    ].filter(Boolean))];
    return items.find(x => siglasCandidates.includes(x.siglas)) ||
      items.find(x => nameCandidates.includes(x.nome)) ||
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

  async function prepareTournament(context) {
    const { t, index, total, batchNo, batchCount } = context;
    log(`START_TOURNAMENT ${index + 1}/${total} batch=${batchNo}/${batchCount} row=${t.rowNo} ${t.name}`);
    const id = await createTournament(t);
    context.id = id;
    log(`CREATE_OK ${index + 1}/${total} ${t.name} id=${id} url=${location.origin}/cb/torneio/painel/${id}`);
    await sleep(SPEED.afterCreateMs);

    await applyGeneralSettings(id);
    log(`GENERAL_SETTINGS_OK ${index + 1}/${total} ${t.name} 1/2/4/5=ON 3=OFF`);
    await sleep(SPEED.afterUsdtMs);

    let doc = await fetchTournamentDoc(id);
    const items = [t.entry, t.reEntry, t.ticketEntry].filter(Boolean);
    if (!t.ticketEntry) log(`ITEM_SKIP ${index + 1}/${total} ${t.name} Ticket Entry/TE reason=not configured`);
    for (const item of items) {
      const result = await saveItemByHtml(id, doc, item);
      log(`ITEM_${result.action}_OK ${index + 1}/${total} ${t.name} ${item.nome}/${item.siglas} value=${item.valor} id_item=${result.id_item || "(new)"}`);
      await sleep(SPEED.afterItemMs);
      if (SPEED.refetchAfterEachItem) doc = await fetchTournamentDoc(id);
    }

    context.prepared = true;
    return context;
  }

  async function linkTicketRound(contexts, ticketIndex, batchNo, batchCount) {
    const active = contexts.filter(context =>
      !context.failed &&
      context.prepared &&
      context.t.tickets.length > ticketIndex
    );

    if (!active.length) return;

    log(`LINK_ROUND_START batch=${batchNo}/${batchCount} ticket=${ticketIndex + 1} tournaments=${active.length}`);

    const pageResults = await Promise.allSettled(active.map(async context => ({
      context,
      doc: await fetchTournamentDoc(context.id),
      ticket: context.t.tickets[ticketIndex]
    })));

    const ready = [];
    pageResults.forEach((result, i) => {
      const context = active[i];
      if (result.status === "fulfilled") {
        ready.push(result.value);
        return;
      }
      context.failed = true;
      context.error = result.reason?.message || String(result.reason || "FETCH_FAILED");
      log(`LINK_PAGE_ERROR batch=${batchNo}/${batchCount} row=${context.t.rowNo} id=${context.id} ${context.t.name} ticket=${ticketIndex + 1}/${context.t.tickets.length} ${context.error}`);
    });

    const postResults = await Promise.allSettled(ready.map(async item => ({
      ...item,
      result: await linkTicketByHtml(item.context.id, item.doc, item.ticket)
    })));

    postResults.forEach((result, i) => {
      const item = ready[i];
      const context = item.context;
      if (result.status === "fulfilled") {
        const found = result.value.result;
        context.linkedTickets = ticketIndex + 1;
        log(`LINK_OK batch=${batchNo}/${batchCount} row=${context.t.rowNo} id=${context.id} ${context.t.name} ticket=${ticketIndex + 1}/${context.t.tickets.length} ${item.ticket} value=${found.option.value} match=${found.matchType}`);
        return;
      }
      context.failed = true;
      context.error = result.reason?.message || String(result.reason || "LINK_FAILED");
      log(`LINK_ERROR batch=${batchNo}/${batchCount} row=${context.t.rowNo} id=${context.id} ${context.t.name} ticket=${ticketIndex + 1}/${context.t.tickets.length} ${item.ticket} ${context.error}`);
    });

    log(`LINK_ROUND_DONE batch=${batchNo}/${batchCount} ticket=${ticketIndex + 1} ok=${postResults.filter(x => x.status === "fulfilled").length} failed=${pageResults.filter(x => x.status === "rejected").length + postResults.filter(x => x.status === "rejected").length}`);
    await sleep(SPEED.afterTicketRoundMs);
  }

  async function processTournamentBatch(tournaments, batchStart, total, batchNo, batchCount) {
    const contexts = tournaments.map((t, offset) => ({
      t,
      index: batchStart + offset,
      total,
      batchNo,
      batchCount,
      id: "",
      prepared: false,
      linkedTickets: 0,
      failed: false,
      error: ""
    }));

    log(`BATCH_START ${batchNo}/${batchCount} tournaments=${contexts.length}`);

    const prepareResults = await Promise.allSettled(contexts.map(context => prepareTournament(context)));
    prepareResults.forEach((result, i) => {
      if (result.status === "fulfilled") return;
      const context = contexts[i];
      context.failed = true;
      context.error = result.reason?.message || String(result.reason || "PREPARE_FAILED");
      log(`PREPARE_ERROR batch=${batchNo}/${batchCount} row=${context.t.rowNo} id=${context.id || "(not-created)"} ${context.t.name} ${context.error}`);
    });

    const maxTickets = contexts.reduce((max, context) =>
      context.failed ? max : Math.max(max, context.t.tickets.length), 0);

    for (let ticketIndex = 0; ticketIndex < maxTickets; ticketIndex++) {
      await linkTicketRound(contexts, ticketIndex, batchNo, batchCount);
    }

    contexts.forEach(context => {
      if (context.failed) return;
      log(`DONE_TOURNAMENT ${context.index + 1}/${total} row=${context.t.rowNo} tickets=${context.t.tickets.length} ${location.origin}/cb/torneio/painel/${context.id}`);
    });

    log(`BATCH_DONE ${batchNo}/${batchCount} ok=${contexts.filter(x => !x.failed).length} failed=${contexts.filter(x => x.failed).length}`);
    return contexts;
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

    const batchSize = SPEED.tournamentBatchSize;
    const batchCount = Math.ceil(tournaments.length / batchSize);
    log(`START batch count=${tournaments.length} batchSize=${batchSize} batches=${batchCount}`);
    const results = [];

    for (let batchStart = 0; batchStart < tournaments.length; batchStart += batchSize) {
      const batchNo = Math.floor(batchStart / batchSize) + 1;
      const batch = tournaments.slice(batchStart, batchStart + batchSize);
      const contexts = await processTournamentBatch(
        batch,
        batchStart,
        tournaments.length,
        batchNo,
        batchCount
      );
      results.push(...contexts);
      await sleep(SPEED.betweenBatchMs);
    }

    const successful = results.filter(result => !result.failed);
    const failed = results.filter(result => result.failed);
    log(`DONE batch count=${results.length} ok=${successful.length} failed=${failed.length}`);
    results.forEach(result => log(
      `RESULT ${result.index + 1}. status=${result.failed ? "ERROR" : "OK"} row=${result.t.rowNo} id=${result.id || ""} tickets=${result.linkedTickets}/${result.t.tickets.length} ${result.t.name}${result.error ? ` error=${result.error}` : ""}`
    ));
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
