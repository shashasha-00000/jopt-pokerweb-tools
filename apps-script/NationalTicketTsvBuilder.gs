/**
 * PokerWeb ナショナルチケット付与用 TSV を、現在開いている運用表から生成する。
 *
 * 初回:
 *   installNationalTicketTsvMenu()
 *
 * 実行:
 *   buildNationalTicketTsv()
 *
 * ルール:
 * - D列「対象プロモ」が A: Millions + PPC
 * - D列「対象プロモ」が B / C: Millions
 * - I列「Millons1」と J列「PPC」は付与済み CHECK。未チェック分だけ出力する
 * - K列「WeChat送信」はチケット付与判定に使用しない
 * - H列に何か入力がある行はスキップする（対象外として無視）
 *
 * 出力は「GameID」「チケット名」だけ。個人情報列は読み取らず、出力もしない。
 */

const NTB_CONFIG = {
  OUTPUT_SHEET_NAME: 'ナショナルチケット付与TSV',
  HEADER_ROW: 1,
  REQUIRED_COLUMN_HEADERS: {
    3: 'Game ID',
    4: '対象プロモ',
    9: 'Millons1',
    10: 'PPC',
    11: 'WeChat送信'
  },
  OUTPUT_HEADERS: ['GameID', 'チケット名'],
  MILLIONS_TICKET: '【JOPT 2026 Tokyo #02】NLH Millions Voucher / -2026.07.31 (海外対応分)',
  PPC_TICKET: '【JOPT 2026 Tokyo #02】NLH Poker Players Championship Voucher / -2026.07.31 (海外対応分)'
};

function installNationalTicketTsvMenu() {
  NTB_addMenu_();
  NTB_alert_(
    'メニュー「ナショナルチケットTSV」を追加しました。\n' +
    'Spreadsheetを再読み込みするとメニューが表示されます。'
  );
}

function onOpen() {
  NTB_addMenu_();
}

function NTB_addMenu_() {
  try {
    SpreadsheetApp.getUi()
    .createMenu('ナショナルチケットTSV')
    .addItem('現在のシートからTSV生成', 'buildNationalTicketTsv')
    .addToUi();
  } catch (error) {
    throw new Error(
      'SpreadsheetのUIを取得できません。対象Google Sheetを開き、' +
      '「拡張機能 > Apps Script」から、このSheetに紐づいたプロジェクトへコードを追加してください。'
    );
  }
}

function buildNationalTicketTsv() {
  try {
    NTB_buildNationalTicketTsv_();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error(error && error.stack ? error.stack : error);
    NTB_alert_('TSV生成を停止しました。\n\n' + message);
    throw error;
  }
}

function NTB_buildNationalTicketTsv_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Spreadsheetを取得できません。対象Spreadsheetに紐づいた Apps Script から実行してください。');
  }

  const source = ss.getActiveSheet();
  if (!source) {
    throw new Error('現在開いているシートを取得できません。');
  }

  if (source.getName() === NTB_CONFIG.OUTPUT_SHEET_NAME) {
    throw new Error('出力シートでは実行できません。元の運用表を開いてから実行してください。');
  }

  const values = source.getDataRange().getValues();
  if (values.length < 2) {
    throw new Error('データ行がありません。');
  }

  const headers = values[NTB_CONFIG.HEADER_ROW - 1].map(NTB_text_);
  NTB_assertRequiredColumns_(headers);

  const gameIdColumn = 2;
  const promoColumn = 3;
  const skipColumn = 7;
  const millionsCheckColumn = 8;
  const ppcCheckColumn = 9;

  const outputRows = [];
  const errors = [];
  let skippedCount = 0;

  values.slice(NTB_CONFIG.HEADER_ROW).forEach((row, offset) => {
    const sheetRow = NTB_CONFIG.HEADER_ROW + offset + 1;
    if (NTB_text_(row[skipColumn])) {
      skippedCount += 1;
      return;
    }
    const promo = NTB_text_(row[promoColumn]).toUpperCase();
    const millionsDone = NTB_isChecked_(row[millionsCheckColumn]);
    const ppcDone = NTB_isChecked_(row[ppcCheckColumn]);
    const hasRelevantData = promo || NTB_text_(row[gameIdColumn]) || millionsDone || ppcDone;

    if (!hasRelevantData) return;
    if (!['A', 'B', 'C'].includes(promo)) {
      errors.push(sheetRow + '行目: 対象プロモが A / B / C ではありません: [' + promo + ']');
      return;
    }

    const gameId = NTB_normalizeGameId_(row[gameIdColumn]);
    if (!gameId) {
      errors.push(sheetRow + '行目: Game ID が空白または不正です。');
      return;
    }

    if (!millionsDone) {
      outputRows.push([gameId, NTB_CONFIG.MILLIONS_TICKET]);
    }

    if (promo === 'A' && !ppcDone) {
      outputRows.push([gameId, NTB_CONFIG.PPC_TICKET]);
    }
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

  NTB_alert_(
    'TSV出力を更新しました。\n\n' +
      '未付与タスク: ' + outputRows.length + ' 件\n' +
      'H列入力によりスキップ: ' + skippedCount + ' 件\n' +
      '出力シート: ' + NTB_CONFIG.OUTPUT_SHEET_NAME + '\n\n' +
      'A:B列を表頭ごとコピーして PokerWeb のツールへ貼り付けてください。\n' +
      '付与完了後、元表の対応する Millons1 / PPC を手動でCHECKしてください。'
  );
}

function NTB_getOrCreateOutputSheet_(ss) {
  return ss.getSheetByName(NTB_CONFIG.OUTPUT_SHEET_NAME) ||
    ss.insertSheet(NTB_CONFIG.OUTPUT_SHEET_NAME);
}

function NTB_assertRequiredColumns_(headers) {
  const differences = [];

  Object.keys(NTB_CONFIG.REQUIRED_COLUMN_HEADERS).forEach(columnText => {
    const column = Number(columnText);
    const expected = NTB_CONFIG.REQUIRED_COLUMN_HEADERS[column];
    const actual = headers[column - 1] || '';
    if (actual !== expected) {
      differences.push(column + '列目: 期待=[' + expected + '] 実際=[' + actual + ']');
    }
  });

  if (differences.length) {
    throw new Error(
      '運用表の列構造が想定と異なるため、安全のため停止しました。\n' +
      differences.join('\n')
    );
  }
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

function NTB_alert_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (_) {
    console.log(message);
  }
}
