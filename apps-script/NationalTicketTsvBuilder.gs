/**
 * PokerWeb ナショナルチケット付与用 TSV を、現在開いている運用表から生成する。
 *
 * 初回:
 *   installNationalTicketTsvMenu()
 *
 * 実行:
 *   buildNationalTicketTsv()
 *
 * 出力は「GameID」「チケット名」だけ。個人情報列は読み取らず、出力もしない。
 */

const NTB_CONFIG = {
  OUTPUT_SHEET_NAME: 'ナショナルチケット付与TSV',
  HEADER_ROW: 1,
  GAME_ID_HEADERS: ['Game ID', 'GameID'],
  OUTPUT_HEADERS: ['GameID', 'チケット名'],
  TICKET_COLUMN_MAP: {
    Millons1: '【JOPT 2026 Tokyo #02】NLH Millions Voucher / -2026.07.31 (海外対応分)',
    PPC: '【JOPT 2026 Tokyo #02】NLH Poker Players Championship Voucher / -2026.07.31 (海外対応分)'
  }
};

function installNationalTicketTsvMenu() {
  SpreadsheetApp.getUi()
    .createMenu('ナショナルチケットTSV')
    .addItem('現在のシートからTSV生成', 'buildNationalTicketTsv')
    .addToUi();

  SpreadsheetApp.getUi().alert(
    'メニュー「ナショナルチケットTSV」を追加しました。\n' +
    'Spreadsheetを再読み込みするとメニューが表示されます。'
  );
}

function buildNationalTicketTsv() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const source = ss.getActiveSheet();

  if (source.getName() === NTB_CONFIG.OUTPUT_SHEET_NAME) {
    throw new Error('出力シートでは実行できません。元の運用表を開いてから実行してください。');
  }

  const values = source.getDataRange().getValues();
  if (values.length < 2) {
    throw new Error('データ行がありません。');
  }

  const headers = values[NTB_CONFIG.HEADER_ROW - 1].map(NTB_text_);
  const gameIdColumn = NTB_findHeader_(headers, NTB_CONFIG.GAME_ID_HEADERS);

  if (gameIdColumn < 0) {
    throw new Error('Game ID 列が見つかりません。対応表頭: ' + NTB_CONFIG.GAME_ID_HEADERS.join(' / '));
  }

  const ticketColumns = Object.keys(NTB_CONFIG.TICKET_COLUMN_MAP).map(header => {
    const index = headers.indexOf(header);
    if (index < 0) {
      throw new Error('チケット判定列が見つかりません: ' + header);
    }
    return {
      index: index,
      ticketName: NTB_CONFIG.TICKET_COLUMN_MAP[header]
    };
  });

  const outputRows = [];
  const errors = [];

  values.slice(NTB_CONFIG.HEADER_ROW).forEach((row, offset) => {
    const sheetRow = NTB_CONFIG.HEADER_ROW + offset + 1;
    const checkedTickets = ticketColumns.filter(item => NTB_isChecked_(row[item.index]));

    if (!checkedTickets.length) return;

    const gameId = NTB_normalizeGameId_(row[gameIdColumn]);
    if (!gameId) {
      errors.push(sheetRow + '行目: チェック済みですが Game ID が空白または不正です。');
      return;
    }

    checkedTickets.forEach(item => {
      outputRows.push([gameId, item.ticketName]);
    });
  });

  if (errors.length) {
    throw new Error(
      '安全のため出力を更新しませんでした。\n\n' +
      errors.slice(0, 20).join('\n') +
      (errors.length > 20 ? '\n...ほか ' + (errors.length - 20) + ' 件' : '')
    );
  }

  const output = NTB_getOrCreateOutputSheet_(ss);
  output.clearContents();
  output.getRange(1, 1, 1, NTB_CONFIG.OUTPUT_HEADERS.length)
    .setValues([NTB_CONFIG.OUTPUT_HEADERS])
    .setFontWeight('bold')
    .setBackground('#d9ead3');

  if (outputRows.length) {
    output.getRange(2, 1, outputRows.length, NTB_CONFIG.OUTPUT_HEADERS.length)
      .setNumberFormat('@')
      .setValues(outputRows);
  }

  output.setFrozenRows(1);
  output.autoResizeColumns(1, NTB_CONFIG.OUTPUT_HEADERS.length);
  ss.setActiveSheet(output);

  SpreadsheetApp.getUi().alert(
    'TSV出力を更新しました。\n\n' +
    '付与タスク: ' + outputRows.length + ' 件\n' +
    '出力シート: ' + NTB_CONFIG.OUTPUT_SHEET_NAME + '\n\n' +
    'A:B列を表頭ごとコピーして PokerWeb のツールへ貼り付けてください。'
  );
}

function NTB_getOrCreateOutputSheet_(ss) {
  return ss.getSheetByName(NTB_CONFIG.OUTPUT_SHEET_NAME) ||
    ss.insertSheet(NTB_CONFIG.OUTPUT_SHEET_NAME);
}

function NTB_findHeader_(headers, candidates) {
  for (const candidate of candidates) {
    const index = headers.indexOf(candidate);
    if (index >= 0) return index;
  }
  return -1;
}

function NTB_normalizeGameId_(value) {
  const digits = String(value === null || value === undefined ? '' : value).replace(/\D/g, '');
  return digits.length === 8 ? digits : '';
}

function NTB_isChecked_(value) {
  return value === true || String(value).trim().toUpperCase() === 'TRUE';
}

function NTB_text_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\u3000/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
