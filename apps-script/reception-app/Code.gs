const RCP_APP = {
  version: '0.1.2',
  qrPrefix: 'JOPT-RCP',
  qrVersion: 'v1',
  sheets: {
    orders: 'Orders',
    payments: 'OrderPayments',
    ticketRules: 'TicketRules',
    receptionSettings: '受付設定',
    settings: 'Settings',
    logs: 'Logs'
  }
};

function doGet() {
  return HtmlService
    .createTemplateFromFile('Index')
    .evaluate()
    .setTitle('JOPT Entry')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function setupReceptionMvp() {
  const ss = SpreadsheetApp.getActive();

  ensureSheet_(ss, RCP_APP.sheets.orders, [
    'order_id', 'status', 'qr_payload', 'qr_json',
    'game_id', 'tournament_id', 'entry_mode',
    'en_qty', 're_qty', 'te_qty', 'main_ticket_required',
    'gross_amount', 'amount_due',
    'cash_amount', 'credit_card_amount', 'usdt_amount', 'point_amount', 'contract_amount', 'voucher_ticket_amount',
    'created_by', 'note', 'created_at', 'updated_at'
  ]);

  ensureSheet_(ss, RCP_APP.sheets.payments, [
    'payment_id', 'order_id', 'payment_type', 'amount', 'note', 'created_at', 'updated_at'
  ]);

  ensureSheet_(ss, RCP_APP.sheets.ticketRules, [
    'rule_id', 'enabled', 'category', 'priority', 'ticket_name_exact', 'face_value',
    'allow_as_te', 'allow_as_voucher', 'allow_partial', 'note'
  ]);

  ensureSheet_(ss, RCP_APP.sheets.receptionSettings, [
    '受付ON', '表示順', '大会グループ', '大会名', '開催日', 'PW大会ID',
    '受付開始', '受付終了',
    'EN金額', 'RE金額', 'TE金額', 'TEあり',
    'TE必要チケット名', 'TE必要枚数', 'TE必要チケット額',
    '専用Voucherキーワード', 'メモ'
  ]);

  ensureSheet_(ss, RCP_APP.sheets.settings, [
    'key', 'value', 'note', 'updated_at'
  ]);

  ensureSheet_(ss, RCP_APP.sheets.logs, [
    'log_id', 'timestamp', 'order_id', 'source', 'action', 'result', 'message', 'payload_json'
  ]);

  seedMvpRows_();
  formatReceptionMvpSheets_();
  return { ok: true, message: 'Reception MVP sheets are ready.' };
}
