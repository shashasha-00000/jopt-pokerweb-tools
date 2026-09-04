// ==UserScript==
// @name         PW 大会作成 Auto
// @namespace    pw-tournament-create-auto
// @version      0.4.0
// @description  API-first tournament create flow from fixed TSV with independent per-tournament workers.
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

  const DEFAULT_INPUT = `大会名\t日付\t開始時間\tEN名称\tEN略称\tEN金額\tEN手数料\tEN回数\tENチップ数\tRE名称\tRE略称\tRE金額\tRE手数料\tRE回数\tREチップ数\tチケット名称
test7777\t2026/07/02\t13:00\t\t\t80000\t1000\t1\t\t\t\t80000\t0\t3\t\t【SPADIE TOKYO 42nd】Main Event / -2026.08.31`;

  const STORAGE = {
    input: "PW_BG_CREATE_INPUT_V01",
    report: "PW_BG_CREATE_REPORT_V01"
  };

  const SPEED = {
    maxConcurrentTournaments: 10,
    afterCreateMs: 120,
    afterUsdtMs: 30,
    afterItemMs: 30,
    afterTicketMs: 50,
    betweenWorkerTasksMs: 120,
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
    "開始時間"
  ];

  const ITEM_FIELD_DEFS = [
    { suffix: "名称", key: "nome", normalize: normalizeText },
    { suffix: "略称", key: "siglas", normalize: normalizeText },
    { suffix: "金額", key: "valor", normalize: normalizeAmount },
    { suffix: "手数料", key: "taxa", normalize: normalizeAmount },
    { suffix: "回数", key: "limite", normalize: normalizeLimit },
    { suffix: "チップ数", key: "fichas", normalize: normalizeAmount }
  ];

  const $ = sel => document.querySelector(sel);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let running = false;

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

  function configuredConcurrency() {
    const value = Number(SPEED.maxConcurrentTournaments);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`SPEED.maxConcurrentTournaments must be a positive integer: ${SPEED.maxConcurrentTournaments}`);
    }
    return value;
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

  function itemGroup(prefix, cell, options = {}) {
    const raw = {};
    const values = {};
    const provided = {};
    ITEM_FIELD_DEFS.forEach(field => {
      raw[field.key] = cell(`${prefix}${field.suffix}`);
      provided[field.key] = raw[field.key] !== "";
      values[field.key] = field.normalize(raw[field.key]);
    });
    if (!Object.values(provided).some(Boolean)) return null;

    const slot = Number(options.slot || 0);
    return {
      label: options.label || prefix,
      slot,
      mode: options.mode || "insert",
      nome: values.nome || options.defaultName || `Item ${slot}`,
      siglas: values.siglas || options.defaultAbbr || `I${slot}`,
      valor: values.valor,
      taxa: values.taxa,
      limite: values.limite,
      fichas: values.fichas,
      reposicionar: options.reposition || DEFAULTS.ticketReposicionar,
      provided
    };
  }

  function dynamicItemSlots(header) {
    return [...new Set(header.map(h => {
      const match = h.match(/^item(\d+)(?:名称|略称|金額|手数料|回数|チップ数)$/i);
      return match ? Number(match[1]) : 0;
    }).filter(slot => slot >= 3))].sort((a, b) => a - b);
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

    const itemSlots = dynamicItemSlots(header);
    const skippedRows = [];
    const tournaments = lines.slice(1).map((line, lineIndex) => {
      const cols = line.split("\t");
      const cell = h => normalizeText(cols[idx[h]] ?? "");
      const name = cell("大会名");
      const date = normalizeDateToDdMmYyyy(cell("日付"));
      const time = normalizeTime(cell("開始時間"));
      const rowNo = lineIndex + 2;
      if (!name || !date || !time) {
        skippedRows.push({ rowNo, reason: "大会名 / 日付 / 開始時間不足" });
        return null;
      }

      const items = [];
      const entry = itemGroup("EN", cell, {
        label: "item1/EN",
        slot: 1,
        mode: "edit-default",
        defaultName: "Entry",
        defaultAbbr: "En",
        reposition: DEFAULTS.entryReposicionar
      });
      const reEntry = itemGroup("RE", cell, {
        label: "item2/RE",
        slot: 2,
        mode: "edit-default",
        defaultName: "Re Entry",
        defaultAbbr: "Re",
        reposition: DEFAULTS.reEntryReposicionar
      });
      if (entry) items.push(entry);
      if (reEntry) items.push(reEntry);

      itemSlots.forEach(slot => {
        const item = itemGroup(`item${slot}`, cell, {
          label: `item${slot}`,
          slot,
          mode: "insert"
        });
        if (item) items.push(item);
      });

      if (!itemSlots.includes(3)) {
        const legacyTeValues = ["TE名称", "TE略称", "TE金額", "TE手数料", "TE回数", "TEチップ数"].map(cell);
        const legacyTeConfigured = legacyTeValues.some((value, i) =>
          i < 2 || i === 5 ? value !== "" : !isBlankOrNumericZero(value)
        );
        if (legacyTeConfigured) {
          const legacyTe = itemGroup("TE", cell, {
            label: "item3/TE(legacy)",
            slot: 3,
            mode: "insert",
            defaultName: "Ticket Entry",
            defaultAbbr: "TE"
          });
          if (legacyTe) items.push(legacyTe);
        }
      }

      return {
        rowNo,
        name,
        date,
        time,
        items,
        tickets: splitTickets(cell("チケット名称"))
      };
    }).filter(Boolean);

    if (!tournaments.length) throw new Error("No creatable rows. 大会名 / 日付 / 開始時間を確認してください。");
    tournaments.skippedRows = skippedRows;
    return tournaments;
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
    tournaments.skippedRows.forEach(row => log(`ROW_SKIP row=${row.rowNo} reason=${row.reason}`));
    tournaments.forEach((t, i) => {
      log(`${i + 1}. row=${t.rowNo} ${t.name}`);
      log(`   Start: ${t.date} ${t.time}`);
      if (!t.items.length) log("   Items: (no changes)");
      t.items.forEach(item => log(`   ${item.label}: ${item.nome}/${item.siglas} / ${item.valor || "(no change)"} + ${item.taxa || "(no change)"} / limit=${item.limite || "(no change)"} / chips=${item.fichas || "(no change)"}`));
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

  async function applyGeneralSettings(id, context) {
    for (const setting of GENERAL_SETTINGS) {
      await setGeneralSetting(id, setting);
      log(`GENERAL_SETTING_OK worker=${context.workerId} row=${context.t.rowNo} id=${id} ${setting.label} ${setting.campo}=${setting.status}`);
      await sleep(30);
    }
  }

  function itemData(item, existing = null) {
    const value = (key, fallback) => {
      if (item.provided?.[key]) return item[key];
      if (existing && existing[key] !== "") return existing[key];
      return fallback;
    };
    return {
      nome: value("nome", item.nome),
      siglas: value("siglas", item.siglas),
      fichas: value("fichas", "0"),
      limite: value("limite", "0"),
      reposicionar: existing?.reposicionar || item.reposicionar || "0",
      direito_img: existing?.direito_img || DEFAULTS.direito_img,
      pts_ranking: existing?.pts_ranking || DEFAULTS.pts_ranking,
      gameid_bloqueio: existing?.gameid_bloqueio || DEFAULTS.gameid_bloqueio,
      valor: value("valor", "0"),
      taxa: value("taxa", "0"),
      rake: existing?.rake || DEFAULTS.rake,
      taxa_extras: existing?.taxa_extras || DEFAULTS.taxa_extras
    };
  }

  function applyFormData(fd, data) {
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined && value !== null) fd.set(key, value);
    });
  }

  function existingItems(doc) {
    return [...doc.querySelectorAll('a[href="#modal_item_editar"][data-id_item], [data-id_item][data-nome]')]
      .map((el, index) => ({
        slot: index + 1,
        id_item: el.getAttribute("data-id_item") || "",
        nome: normalizeText(el.getAttribute("data-nome") || ""),
        siglas: normalizeText(el.getAttribute("data-siglas") || ""),
        valor: normalizeText(el.getAttribute("data-valor") || ""),
        taxa: normalizeText(el.getAttribute("data-taxa") || ""),
        taxa_extras: normalizeText(el.getAttribute("data-taxa_extras") || ""),
        rake: normalizeText(el.getAttribute("data-rake") || ""),
        fichas: normalizeText(el.getAttribute("data-fichas") || ""),
        limite: normalizeText(el.getAttribute("data-limite") || ""),
        reposicionar: normalizeText(el.getAttribute("data-reposicionar") || ""),
        direito_img: normalizeText(el.getAttribute("data-direito_img") || ""),
        pts_ranking: normalizeText(el.getAttribute("data-pts_ranking") || ""),
        gameid_bloqueio: normalizeText(el.getAttribute("data-gameid_bloqueio") || ""),
        raw: el.outerHTML
      }))
      .filter(x => x.id_item);
  }

  async function saveItemByHtml(id, doc, item) {
    const items = existingItems(doc);
    const existing = item.mode === "edit-default"
      ? items.find(existingItem => existingItem.slot === item.slot) || null
      : null;
    if (item.mode === "edit-default" && !existing) {
      throw new Error(`${item.label}: default item ${item.slot} not found`);
    }
    const form = existing
      ? doc.querySelector('form[action*="item_editar"]')
      : doc.querySelector('form[action*="item_criar"]');

    if (!form) throw new Error(`${item.nome}: item form not found`);

    const fd = new FormData(form);
    applyFormData(fd, itemData(item, existing));
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
    return { action: existing ? "EDIT" : "INSERT", id_item: existing?.id_item || "", slot: item.slot };
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
    const { t, index, total, workerId } = context;
    context.stage = "CREATE";
    log(`START_TOURNAMENT ${index + 1}/${total} worker=${workerId} row=${t.rowNo} ${t.name}`);
    const id = await createTournament(t);
    context.id = id;
    log(`CREATE_OK ${index + 1}/${total} worker=${workerId} row=${t.rowNo} ${t.name} id=${id} url=${location.origin}/cb/torneio/painel/${id}`);
    await sleep(SPEED.afterCreateMs);

    context.stage = "GENERAL_SETTINGS";
    await applyGeneralSettings(id, context);
    log(`GENERAL_SETTINGS_OK ${index + 1}/${total} worker=${workerId} row=${t.rowNo} id=${id} ${t.name} 1/2/4/5=ON 3=OFF`);
    await sleep(SPEED.afterUsdtMs);

    context.stage = "ITEM_PAGE_FETCH";
    let doc = await fetchTournamentDoc(id);
    if (!t.items.length) log(`ITEM_SKIP ${index + 1}/${total} worker=${workerId} row=${t.rowNo} id=${id} ${t.name} reason=no item changes`);
    for (const item of t.items) {
      context.stage = `ITEM_${item.siglas || item.nome}`;
      const result = await saveItemByHtml(id, doc, item);
      log(`ITEM_${result.action}_OK ${index + 1}/${total} worker=${workerId} row=${t.rowNo} id=${id} ${t.name} slot=${result.slot} ${item.nome}/${item.siglas} value=${item.valor || "(unchanged)"} id_item=${result.id_item || "(new)"}`);
      await sleep(SPEED.afterItemMs);
      if (SPEED.refetchAfterEachItem) doc = await fetchTournamentDoc(id);
    }

    context.prepared = true;
    return context;
  }

  async function processTournament(context) {
    const { t, index, total, workerId } = context;

    try {
      await prepareTournament(context);

      for (let ticketIndex = 0; ticketIndex < t.tickets.length; ticketIndex++) {
        const ticket = t.tickets[ticketIndex];
        context.stage = `TICKET_${ticketIndex + 1}_PAGE_FETCH`;
        const doc = await fetchTournamentDoc(context.id);

        context.stage = `TICKET_${ticketIndex + 1}_LINK`;
        const found = await linkTicketByHtml(context.id, doc, ticket);
        context.linkedTickets = ticketIndex + 1;
        log(`LINK_OK ${index + 1}/${total} worker=${workerId} row=${t.rowNo} id=${context.id} ${t.name} ticket=${ticketIndex + 1}/${t.tickets.length} ${ticket} value=${found.option.value} match=${found.matchType}`);
        await sleep(SPEED.afterTicketMs);
      }

      context.stage = "DONE";
      log(`DONE_TOURNAMENT ${index + 1}/${total} worker=${workerId} row=${t.rowNo} id=${context.id} tickets=${context.linkedTickets}/${t.tickets.length} ${location.origin}/cb/torneio/painel/${context.id}`);
    } catch (e) {
      context.failed = true;
      context.error = e?.message || String(e || "UNKNOWN_ERROR");
      log(`TOURNAMENT_ERROR ${index + 1}/${total} worker=${workerId} row=${t.rowNo} id=${context.id || "(not-created)"} stage=${context.stage} ${t.name} ${context.error}`);
    }

    return context;
  }

  async function runCreate() {
    if (running) return alert("CREATE is already running.");

    clearLog();
    const raw = $("#pw-bg-poc-input").value;
    localStorage.setItem(STORAGE.input, raw);
    const tournaments = parseInput(raw);
    const maxConcurrency = configuredConcurrency();
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

    running = true;
    const runButton = $("#pw-bg-poc-run");
    if (runButton) runButton.disabled = true;

    try {
      const contexts = tournaments.map((t, index) => ({
        t,
        index,
        total: tournaments.length,
        workerId: 0,
        id: "",
        prepared: false,
        linkedTickets: 0,
        failed: false,
        stage: "QUEUED",
        error: ""
      }));
      const workerCount = Math.min(maxConcurrency, contexts.length);
      let nextIndex = 0;
      let completed = 0;

      log(`START count=${contexts.length} workers=${workerCount}`);

      const worker = async workerId => {
        while (true) {
          const contextIndex = nextIndex++;
          if (contextIndex >= contexts.length) return;

          const context = contexts[contextIndex];
          context.workerId = workerId;
          log(`WORKER_CLAIM worker=${workerId} task=${context.index + 1}/${context.total} row=${context.t.rowNo} ${context.t.name}`);
          await processTournament(context);
          completed++;
          log(`WORKER_RELEASE worker=${workerId} task=${context.index + 1}/${context.total} completed=${completed}/${contexts.length} status=${context.failed ? "ERROR" : "OK"} id=${context.id || "(not-created)"}`);
          await sleep(SPEED.betweenWorkerTasksMs);
        }
      };

      await Promise.all(Array.from({ length: workerCount }, (_, index) => worker(index + 1)));

      const successful = contexts.filter(result => !result.failed);
      const failed = contexts.filter(result => result.failed);
      log(`DONE count=${contexts.length} workers=${workerCount} ok=${successful.length} failed=${failed.length}`);
      contexts.forEach(result => log(
        `RESULT ${result.index + 1}. status=${result.failed ? "ERROR" : "OK"} worker=${result.workerId} row=${result.t.rowNo} id=${result.id || ""} stage=${result.stage} tickets=${result.linkedTickets}/${result.t.tickets.length} ${result.t.name}${result.error ? ` error=${result.error}` : ""}`
      ));
    } finally {
      running = false;
      if (runButton && runButton.isConnected) runButton.disabled = false;
    }
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
