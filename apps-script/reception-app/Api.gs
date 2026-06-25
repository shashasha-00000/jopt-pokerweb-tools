function getReceptionBootstrap() {
  return {
    ok: true,
    version: RCP_APP.version,
    qr_prefix: RCP_APP.qrPrefix,
    qr_version: RCP_APP.qrVersion,
    tournaments: findEnabledTournaments_(),
    ticket_rules: findEnabledTicketRules_()
  };
}

function createReceptionOrder(input) {
  const payload = normalizeOrderInput_(input);
  const tournament = findTournamentOrThrow_(payload.tournament_id);
  const calculated = calculateOrder_(payload, tournament);
  const orderId = nextOrderId_();
  const now = new Date();

  const qrData = buildQrData_(orderId, tournament, payload, calculated);
  const qrPayload = `${RCP_APP.qrPrefix}:${RCP_APP.qrVersion}:${base64UrlEncode_(JSON.stringify(qrData))}`;

  appendObject_(RCP_APP.sheets.orders, {
    order_id: orderId,
    status: 'READY',
    qr_payload: qrPayload,
    qr_json: JSON.stringify(qrData),
    game_id: payload.game_id,
    tournament_id: payload.tournament_id,
    entry_mode: payload.entry_mode,
    en_qty: calculated.items.EN,
    re_qty: calculated.items.RE,
    te_qty: calculated.items.TE,
    main_ticket_required: calculated.main_ticket_required,
    gross_amount: calculated.gross_amount,
    amount_due: calculated.amount_due,
    cash_amount: calculated.payments.cash,
    credit_card_amount: calculated.payments.credit_card,
    usdt_amount: calculated.payments.usdt,
    point_amount: calculated.payments.point,
    contract_amount: calculated.payments.contract,
    voucher_ticket_amount: calculated.payments.voucher_ticket,
    created_by: payload.created_by,
    note: payload.note,
    created_at: now,
    updated_at: now
  });

  Object.keys(calculated.payments).forEach(type => {
    const amount = calculated.payments[type];
    if (!amount) return;
    appendObject_(RCP_APP.sheets.payments, {
      payment_id: `${orderId}-${type}`,
      order_id: orderId,
      payment_type: type.toUpperCase(),
      amount,
      note: '',
      created_at: now,
      updated_at: now
    });
  });

  appendLog_({
    order_id: orderId,
    source: 'APP',
    action: 'CREATE_ORDER',
    result: 'OK',
    message: `Created ${orderId}`,
    payload_json: JSON.stringify(qrData)
  });

  return {
    ok: true,
    order_id: orderId,
    qr_payload: qrPayload,
    qr_json: qrData,
    amount_due: calculated.amount_due,
    payments_total: calculated.payments_total
  };
}

function appendReceptionLog(payload) {
  appendLog_({
    order_id: payload && payload.order_id,
    source: payload && payload.source || 'APP',
    action: payload && payload.action || 'LOG',
    result: payload && payload.result || 'OK',
    message: payload && payload.message || '',
    payload_json: JSON.stringify(payload || {})
  });
  return { ok: true };
}

function normalizeOrderInput_(input) {
  const obj = input || {};
  const gameId = String(obj.game_id || '').replace(/\D/g, '');
  if (!/^\d{8}$/.test(gameId)) {
    throw new Error('Game ID must be 8 digits.');
  }

  const tournamentId = String(obj.tournament_id || '').trim();
  if (!tournamentId) throw new Error('Tournament is required.');

  const entryMode = String(obj.entry_mode || '').trim().toUpperCase();
  if (!['EN', 'RE', 'TE_EN', 'TE_RE'].includes(entryMode)) {
    throw new Error('Invalid entry mode.');
  }

  return {
    game_id: gameId,
    tournament_id: tournamentId,
    entry_mode: entryMode,
    created_by: String(obj.created_by || 'PLAYER').toUpperCase() === 'STAFF' ? 'STAFF' : 'PLAYER',
    note: String(obj.note || ''),
    payments: {
      cash: number_(obj.payments && obj.payments.cash),
      credit_card: number_(obj.payments && obj.payments.credit_card),
      usdt: number_(obj.payments && obj.payments.usdt),
      point: number_(obj.payments && obj.payments.point),
      contract: number_(obj.payments && obj.payments.contract),
      voucher_ticket: number_(obj.payments && obj.payments.voucher_ticket)
    }
  };
}

function findTournamentOrThrow_(tournamentId) {
  const tournament = findEnabledTournaments_().find(row => row.tournament_id === String(tournamentId));
  if (!tournament) throw new Error(`Tournament is not enabled: ${tournamentId}`);
  return tournament;
}

function calculateOrder_(payload, tournament) {
  const isTeMode = payload.entry_mode === 'TE_EN' || payload.entry_mode === 'TE_RE';
  if (isTeMode && !tournament.has_te) {
    throw new Error('Selected tournament does not allow Ticket Entry.');
  }

  const items = {
    EN: payload.entry_mode === 'EN' || payload.entry_mode === 'TE_EN' ? 1 : 0,
    RE: payload.entry_mode === 'RE' || payload.entry_mode === 'TE_RE' ? 1 : 0,
    TE: isTeMode ? 1 : 0
  };

  let amountDue = 0;
  if (payload.entry_mode === 'EN') amountDue = tournament.en_amount;
  if (payload.entry_mode === 'RE') amountDue = tournament.re_amount;
  if (payload.entry_mode === 'TE_EN') amountDue = tournament.en_amount + tournament.te_amount - teTicketValue_(tournament);
  if (payload.entry_mode === 'TE_RE') amountDue = tournament.re_amount + tournament.te_amount - teTicketValue_(tournament);

  const payments = payload.payments;
  const paymentsTotal = Object.keys(payments).reduce((sum, key) => sum + number_(payments[key]), 0);
  if (Math.abs(paymentsTotal - amountDue) > 0.01) {
    throw new Error(`Payment total must equal amount due. due=${amountDue}, paid=${paymentsTotal}`);
  }

  return {
    items,
    main_ticket_required: isTeMode ? tournament.main_ticket_required : 0,
    gross_amount: items.EN ? tournament.en_amount : tournament.re_amount,
    amount_due: amountDue,
    payments,
    payments_total: paymentsTotal
  };
}

function buildQrData_(orderId, tournament, payload, calculated) {
  return {
    version: 1,
    order_id: orderId,
    game_id: payload.game_id,
    tournament_id: tournament.tournament_id,
    display_name: tournament.display_name,
    tournament_url: tournament.pw_url,
    amount_due: calculated.amount_due,
    entry: {
      mode: payload.entry_mode,
      EN: calculated.items.EN,
      RE: calculated.items.RE,
      TE: calculated.items.TE,
      main_ticket_required: calculated.main_ticket_required
    },
    tickets: {
      main_ticket_name_exact: tournament.main_ticket_name_exact,
      main_ticket_face_value: tournament.main_ticket_face_value,
      voucher_ticket_amount: calculated.payments.voucher_ticket
    },
    payments: calculated.payments,
    created_by: payload.created_by,
    created_at: new Date().toISOString()
  };
}

function teTicketValue_(tournament) {
  return tournament.main_ticket_required * tournament.main_ticket_face_value;
}

function nextOrderId_() {
  const date = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  const props = PropertiesService.getScriptProperties();
  const key = `RCP_SEQ_${date}`;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const next = Number(props.getProperty(key) || '0') + 1;
    props.setProperty(key, String(next));
    return `RCP-${date}-${String(next).padStart(6, '0')}`;
  } finally {
    lock.releaseLock();
  }
}

function base64UrlEncode_(text) {
  return Utilities.base64EncodeWebSafe(Utilities.newBlob(text).getBytes()).replace(/=+$/g, '');
}

function appendLog_(entry) {
  appendObject_(RCP_APP.sheets.logs, {
    log_id: Utilities.getUuid(),
    timestamp: new Date(),
    order_id: entry.order_id || '',
    source: entry.source || '',
    action: entry.action || '',
    result: entry.result || '',
    message: entry.message || '',
    payload_json: entry.payload_json || ''
  });
}
