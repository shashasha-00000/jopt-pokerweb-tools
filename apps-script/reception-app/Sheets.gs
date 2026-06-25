function getSheet_(name) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) throw new Error(`Missing sheet: ${name}. Run setupReceptionMvp() first.`);
  return sheet;
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  const width = Math.max(sheet.getLastColumn(), headers.length);
  const current = sheet.getRange(1, 1, 1, width).getValues()[0].map(String);
  const currentHeaders = current.filter(Boolean);
  if (currentHeaders.length === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  const missing = headers.filter(header => !currentHeaders.includes(header));
  if (missing.length) {
    sheet.getRange(1, currentHeaders.length + 1, 1, missing.length).setValues([missing]);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

function readObjects_(sheetName) {
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(String);
  return values.slice(1)
    .filter(row => row.some(value => value !== '' && value != null))
    .map(row => {
      const obj = {};
      headers.forEach((header, index) => {
        if (header) obj[header] = row[index];
      });
      return obj;
    });
}

function appendObject_(sheetName, object) {
  const sheet = getSheet_(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const row = headers.map(header => Object.prototype.hasOwnProperty.call(object, header) ? object[header] : '');
  sheet.appendRow(row);
}

function findEnabledTournaments_() {
  const now = new Date();
  return readObjects_(RCP_APP.sheets.receptionSettings)
    .filter(row => isTrue_(row['受付ON']))
    .filter(row => String(row['PW大会ID'] || '').trim())
    .filter(row => isWithinReceptionWindow_(row, now))
    .sort((a, b) => number_(a['表示順']) - number_(b['表示順']))
    .map(row => {
      const tournamentId = String(row['PW大会ID']).trim();
      return {
        tournament_id: tournamentId,
        display_name: String(row['大会名'] || tournamentId),
        event_date: row['開催日'],
        reception_start: row['受付開始'],
        reception_end: row['受付終了'],
        group_name: String(row['大会グループ'] || ''),
        pw_url: buildPokerWebTournamentUrl_(tournamentId),
        has_te: isTrue_(row['TEあり']),
        en_amount: number_(row['EN金額']),
        re_amount: number_(row['RE金額']),
        te_amount: number_(row['TE金額']),
        main_ticket_name_exact: String(row['TE必要チケット名'] || ''),
        main_ticket_required: number_(row['TE必要枚数']),
        main_ticket_face_value: number_(row['TE必要チケット額']),
        dedicated_voucher_keyword: String(row['専用Voucherキーワード'] || ''),
        enabled: true
      };
    });
}

function findEnabledTicketRules_() {
  return readObjects_(RCP_APP.sheets.ticketRules)
    .filter(row => isTrue_(row.enabled))
    .map(row => ({
      rule_id: String(row.rule_id),
      category: String(row.category),
      priority: number_(row.priority),
      ticket_name_exact: String(row.ticket_name_exact || ''),
      face_value: number_(row.face_value),
      allow_as_te: isTrue_(row.allow_as_te),
      allow_as_voucher: isTrue_(row.allow_as_voucher),
      allow_partial: isTrue_(row.allow_partial)
    }));
}

function seedMvpRows_() {
  seedReceptionSetting4905_();
  seedTicketRules_();
  seedSetting_('qr_prefix', RCP_APP.qrPrefix, 'QR prefix used by Tampermonkey.');
  seedSetting_('app_version', RCP_APP.version, 'Reception HTML app version.');
}

function seedReceptionSetting4905_() {
  const existing = readObjects_(RCP_APP.sheets.receptionSettings)
    .some(row => String(row['PW大会ID']) === '4905');
  if (existing) return;

  appendObject_(RCP_APP.sheets.receptionSettings, {
    '受付ON': true,
    '表示順': 100,
    '大会グループ': 'MVP',
    '大会名': 'test10086',
    '開催日': '',
    'PW大会ID': '4905',
    '受付開始': '',
    '受付終了': '',
    'EN金額': 31000,
    'RE金額': 30000,
    'TE金額': -12000,
    'TEあり': true,
    'TE必要チケット名': 'JOPT 2026 Grand Final / Main Event / -2027.03.31',
    'TE必要枚数': 1,
    'TE必要チケット額': 10000,
    '専用Voucherキーワード': '',
    'メモ': 'MVP test tournament.'
  });
}

function seedTicketRules_() {
  const existingIds = new Set(readObjects_(RCP_APP.sheets.ticketRules).map(row => String(row.rule_id)));

  if (!existingIds.has('MAIN_EVENT_2026')) {
    appendObject_(RCP_APP.sheets.ticketRules, {
      rule_id: 'MAIN_EVENT_2026',
      enabled: true,
      category: 'MAIN_TICKET',
      priority: 500,
      ticket_name_exact: 'JOPT 2026 Grand Final / Main Event / -2027.03.31',
      face_value: 10000,
      allow_as_te: true,
      allow_as_voucher: true,
      allow_partial: true,
      note: 'TE利用可。Voucher利用も可（優先順位は低め）。'
    });
  }

  if (!existingIds.has('VOUCHER_2026_10000')) {
    appendObject_(RCP_APP.sheets.ticketRules, {
      rule_id: 'VOUCHER_2026_10000',
      enabled: true,
      category: 'VOUCHER',
      priority: 100,
      ticket_name_exact: '【JOPT 2026 Grand Final】10,000 Voucher / -2026.07.31',
      face_value: 10000,
      allow_as_te: false,
      allow_as_voucher: true,
      allow_partial: true,
      note: 'MVP voucher rule.'
    });
  }
}

function seedSetting_(key, value, note) {
  const existing = readObjects_(RCP_APP.sheets.settings).some(row => String(row.key) === key);
  if (existing) return;
  appendObject_(RCP_APP.sheets.settings, {
    key,
    value,
    note,
    updated_at: new Date()
  });
}

function number_(value) {
  const n = Number(String(value == null ? '' : value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function isTrue_(value) {
  const text = String(value == null ? '' : value).trim().toUpperCase();
  return value === true || ['TRUE', 'YES', 'Y', '1', 'ON'].includes(text);
}

function isWithinReceptionWindow_(row, now) {
  const start = parseSheetDate_(row['受付開始']);
  const end = parseSheetDate_(row['受付終了']);
  if (start && now < start) return false;
  if (end && now > end) return false;
  return true;
}

function parseSheetDate_(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) return value;
  const parsed = new Date(String(value).trim());
  return isNaN(parsed.getTime()) ? null : parsed;
}

function buildPokerWebTournamentUrl_(tournamentId) {
  return `https://japanopt.pokerweb.com.br/cb/torneio/painel/${String(tournamentId || '').trim()}`;
}

function formatReceptionMvpSheets_() {
  formatReceptionSettingsSheet_();
  [
    RCP_APP.sheets.orders,
    RCP_APP.sheets.payments,
    RCP_APP.sheets.ticketRules,
    RCP_APP.sheets.settings,
    RCP_APP.sheets.logs
  ].forEach(formatSystemSheet_);
}

function formatReceptionSettingsSheet_() {
  const sheet = getSheet_(RCP_APP.sheets.receptionSettings);
  const lastColumn = sheet.getLastColumn();
  const maxRows = Math.max(sheet.getMaxRows(), 200);

  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(6);
  sheet.getRange(1, 1, 1, lastColumn)
    .setBackground('#173f63')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  sheet.setRowHeight(1, 34);
  sheet.getRange(1, 1, maxRows, lastColumn)
    .setFontFamily('Arial')
    .setFontSize(10)
    .setBorder(true, true, true, true, true, true, '#d9e2ec', SpreadsheetApp.BorderStyle.SOLID);

  colorColumnsByHeader_(sheet, [
    '受付ON', '表示順', '大会グループ', '大会名', '開催日', 'PW大会ID',
    '受付開始', '受付終了', 'EN金額', 'RE金額', 'TE金額', 'TEあり',
    'TE必要チケット名', 'TE必要枚数', 'TE必要チケット額', '専用Voucherキーワード', 'メモ'
  ], '#fff2cc');

  setColumnWidthsByHeader_(sheet, {
    '受付ON': 72,
    '表示順': 72,
    '大会グループ': 120,
    '大会名': 220,
    '開催日': 110,
    'PW大会ID': 95,
    '受付開始': 145,
    '受付終了': 145,
    'EN金額': 90,
    'RE金額': 90,
    'TE金額': 90,
    'TEあり': 70,
    'TE必要チケット名': 300,
    'TE必要枚数': 110,
    'TE必要チケット額': 130,
    '専用Voucherキーワード': 220,
    'メモ': 260
  });

  const headers = getHeaders_(sheet);
  ['受付ON', 'TEあり'].forEach(header => {
    const col = headers.indexOf(header) + 1;
    if (col > 0) {
      sheet.getRange(2, col, maxRows - 1, 1).insertCheckboxes();
      sheet.getRange(2, col, maxRows - 1, 1).setHorizontalAlignment('center');
    }
  });

  ['EN金額', 'RE金額', 'TE金額', 'TE必要チケット額'].forEach(header => {
    const col = headers.indexOf(header) + 1;
    if (col > 0) sheet.getRange(2, col, maxRows - 1, 1).setNumberFormat('#,##0');
  });

  ['開催日'].forEach(header => {
    const col = headers.indexOf(header) + 1;
    if (col > 0) sheet.getRange(2, col, maxRows - 1, 1).setNumberFormat('yyyy/mm/dd');
  });

  ['受付開始', '受付終了'].forEach(header => {
    const col = headers.indexOf(header) + 1;
    if (col > 0) sheet.getRange(2, col, maxRows - 1, 1).setNumberFormat('yyyy/mm/dd hh:mm');
  });

  ['PW大会ID'].forEach(header => {
    const col = headers.indexOf(header) + 1;
    if (col > 0) sheet.getRange(2, col, maxRows - 1, 1).setNumberFormat('@');
  });

  addHeaderNote_(sheet, '受付開始', 'yyyy/mm/dd hh:mm。空白なら制限なし。0時をまたぐ場合は終了日を翌日にしてください。');
  addHeaderNote_(sheet, '受付終了', 'yyyy/mm/dd hh:mm。空白なら制限なし。0時をまたぐ場合は終了日を翌日にしてください。');
  addHeaderNote_(sheet, 'TE金額', 'PWの Ticket Entry 項目金額。割引項目ならマイナスで入力。例: -12000');
  addHeaderNote_(sheet, 'PW大会ID', 'PokerWeb URL 末尾の数字。例: /painel/4905 の 4905。');

  applyReceptionConditionalFormatting_(sheet);
}

function formatSystemSheet_(sheetName) {
  const sheet = getSheet_(sheetName);
  const lastColumn = sheet.getLastColumn();
  if (!lastColumn) return;

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, lastColumn)
    .setBackground('#334e68')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  if (sheetName === RCP_APP.sheets.orders) {
    setTextFormatByHeader_(sheet, ['order_id', 'game_id', 'tournament_id', 'entry_mode']);
  }
  if (sheetName === RCP_APP.sheets.payments) {
    setTextFormatByHeader_(sheet, ['payment_id', 'order_id', 'payment_type']);
  }

  sheet.autoResizeColumns(1, Math.min(lastColumn, 12));
}

function getHeaders_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
}

function colorColumnsByHeader_(sheet, headersToColor, color) {
  const headers = getHeaders_(sheet);
  const rows = sheet.getMaxRows();
  headersToColor.forEach(header => {
    const col = headers.indexOf(header) + 1;
    if (col > 0) sheet.getRange(2, col, rows - 1, 1).setBackground(color);
  });
}

function setColumnWidthsByHeader_(sheet, widths) {
  const headers = getHeaders_(sheet);
  Object.keys(widths).forEach(header => {
    const col = headers.indexOf(header) + 1;
    if (col > 0) sheet.setColumnWidth(col, widths[header]);
  });
}

function setTextFormatByHeader_(sheet, headersToFormat) {
  const headers = getHeaders_(sheet);
  const rows = Math.max(sheet.getMaxRows() - 1, 1);
  headersToFormat.forEach(header => {
    const col = headers.indexOf(header) + 1;
    if (col > 0) sheet.getRange(2, col, rows, 1).setNumberFormat('@');
  });
}

function addHeaderNote_(sheet, header, note) {
  const headers = getHeaders_(sheet);
  const col = headers.indexOf(header) + 1;
  if (col > 0) sheet.getRange(1, col).setNote(note);
}

function applyReceptionConditionalFormatting_(sheet) {
  const headers = getHeaders_(sheet);
  const rules = [];
  const maxRows = sheet.getMaxRows();

  ['PW大会ID', '大会名', 'EN金額'].forEach(header => {
    const col = headers.indexOf(header) + 1;
    if (col <= 0) return;
    const range = sheet.getRange(2, col, maxRows - 1, 1);
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenCellEmpty()
      .setBackground('#fce8e6')
      .setRanges([range])
      .build());
  });

  sheet.setConditionalFormatRules(rules);
}
