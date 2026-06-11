/*******************************************************
 * ReceiptSemiAutoAppend.gs
 *
 * PW TSVショウ用 + 領収書申請入力 から、
 * トナメ抜き出しへ今回分を追加して既存番号体系に乗せ、
 * CSV書き出しシートから領収書Noだけ読み、
 * 書き出しデータ / メール送信 の末尾へ今回分だけ追加する。
 *
 * 重要:
 * - 既存行、表頭、数式、書式、列幅を変更しない
 * - 出力先表がない、または表頭が一致しない場合は停止する
 * - 同じ入力を再実行した場合は追加せず停止する
 * - CHECK_REPORT はこのスクリプト専用なので内容を更新する
 *******************************************************/

const RSA_CONFIG = {
  PW_SHEET_NAME: 'PW TSVショウ用',
  APPLICATION_SHEET_NAME: '領収書申請入力',
  NUKIDASHI_SHEET_NAME: 'トナメ抜き出し',
  CSV_FORMULA_SHEET_NAME: 'CSV書き出しシート（緑以外いじらない',
  AI_CSV_SHEET_NAME: '書き出しデータ',
  MAIL_SHEET_NAME: 'メール送信',
  CHECK_SHEET_NAME: 'CHECK_REPORT',
  RUN_LOG_SHEET_NAME: '領収書半自動_RUN_LOG',

  HEADER_ROW: 1,
  DATA_START_ROW: 2,

  PW_HEADERS: [
    'Game ID', '購入時間', '年', '月', '日', '大会名',
    '種別', '現金', 'クレジットカード', 'ポイント', 'USDT'
  ],

  APPLICATION_HEADERS: [
    'Game ID', '氏名', 'メールアドレス', '宛名'
  ],

  AI_CSV_HEADERS: [
    '領収書No', '宛名', '年', '月', '日付', '総金額',
    '現金', 'クレジットカード', 'ポイント', '消費税等',
    '税抜き', 'トーナメント名', '画像タイトルA', '画像タイトルB'
  ],

  NUKIDASHI_HEADER_ROW: 1,
  NUKIDASHI_COLUMNS: {
    gameId: 3,
    name: 4,
    email: 5,
    receiptName: 6,
    year: 8,
    month: 9,
    day: 10,
    tournament: 11,
    type: 12,
    cash: 14,
    creditCard: 15,
    points: 16,
    usdt: 17
  },

  MAIL_HEADERS: [
    '', '氏名', '氏名 様', '件数', 'ファイル名フィルター',
    '添付照合用氏名', 'メールアドレス', '下書きステータス',
    'エラー', '添付ファイル名一覧', 'Draft ID', '送信OK',
    '送信ステータス', '送信日時'
  ],

  CHECK_HEADERS: ['区分', 'Game ID', '氏名', '内容'],
  RUN_LOG_HEADERS: ['日時', 'runKey', 'AI開始行', 'AI行数', 'メール開始行', 'メール行数']
};

/**
 * 初回だけ実行する。
 * 入力表・書き出し表・チェック表・実行履歴表を準備する。
 * メール送信 は既存表を使うため自動作成しない。
 */
function setupReceiptSemiAutoAppend() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  RSA_ensureOwnedSheet_(ss, RSA_CONFIG.APPLICATION_SHEET_NAME, RSA_CONFIG.APPLICATION_HEADERS);
  RSA_ensureOwnedSheet_(ss, RSA_CONFIG.AI_CSV_SHEET_NAME, RSA_CONFIG.AI_CSV_HEADERS);
  RSA_ensureOwnedSheet_(ss, RSA_CONFIG.CHECK_SHEET_NAME, RSA_CONFIG.CHECK_HEADERS);
  RSA_ensureOwnedSheet_(ss, RSA_CONFIG.RUN_LOG_SHEET_NAME, RSA_CONFIG.RUN_LOG_HEADERS);

  RSA_addMenu_();
  RSA_alert_(
    '初期設定が完了しました。\n\n' +
    '書き出しデータ / 領収書申請入力 / CHECK_REPORT を準備しました。\n' +
    'メール送信 は既存表を使用します。'
  );
}

function receiptSemiAutoOnOpen() {
  RSA_addMenu_();
}

function onOpen() {
  RSA_addMenu_();
}

function RSA_addMenu_() {
  SpreadsheetApp.getUi()
    .createMenu('領収書半自動')
    .addItem('生成前チェック（書き込みなし）', 'previewReceiptCsvAndMailList')
    .addItem('書き出しデータ・メール送信生成', 'buildReceiptCsvAndMailList')
    .addItem('書き出しデータを開く', 'openReceiptAiOutputSheet')
    .addSeparator()
    .addItem('メール送信の表頭だけ修正', 'fixReceiptMailHeaders')
    .addItem('CHECK_REPORTを開く', 'openReceiptCheckReport')
    .addToUi();
}

function previewReceiptCsvAndMailList() {
  RSA_runBuild_(true);
}

/**
 * メイン処理。
 * 今回分を既存出力表の末尾へ追加する。
 */
function buildReceiptCsvAndMailList() {
  RSA_runBuild_(false);
}

function RSA_runBuild_(previewOnly) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const pwSheet = RSA_requiredSheet_(ss, RSA_CONFIG.PW_SHEET_NAME);
    const applicationSheet = RSA_requiredSheet_(ss, RSA_CONFIG.APPLICATION_SHEET_NAME);
    const nukidashiSheet = RSA_requiredSheet_(ss, RSA_CONFIG.NUKIDASHI_SHEET_NAME);
    const csvFormulaSheet = RSA_requiredSheet_(ss, RSA_CONFIG.CSV_FORMULA_SHEET_NAME);
    const aiSheet = RSA_requiredSheet_(ss, RSA_CONFIG.AI_CSV_SHEET_NAME);
    const mailSheet = RSA_requiredSheet_(ss, RSA_CONFIG.MAIL_SHEET_NAME);

    RSA_assertExactHeaders_(aiSheet, RSA_CONFIG.AI_CSV_HEADERS);
    RSA_assertMailHeaders_(mailSheet);

    const checkRows = [];
    const pwRows = RSA_readPwRows_(pwSheet);
    const applicationResult = RSA_readApplications_(applicationSheet, checkRows);
    const applicationMap = applicationResult.map;

    if (!pwRows.length) {
      throw new Error('PW TSVショウ用 に処理対象行がありません。');
    }
    if (!Object.keys(applicationMap).length) {
      throw new Error('領収書申請入力 に有効な申請がありません。');
    }

    const pwGameIds = new Set(pwRows.map(row => row.gameIdKey));
    Object.keys(applicationMap).forEach(gameIdKey => {
      if (!pwGameIds.has(gameIdKey)) {
        const app = applicationMap[gameIdKey];
        checkRows.push(['申請のみ', app.gameId, app.name, '申請表 Game ID がPW TSVに見つかりません']);
      }
    });

    const matched = [];
    pwRows.forEach(pw => {
      const app = applicationMap[pw.gameIdKey];
      if (!app) {
        checkRows.push(['PWのみ', pw.gameId, '', 'PW TSV Game ID に対応する申請がありません。領収書は生成しません']);
        return;
      }

      const total = pw.cash + pw.creditCard + pw.points + pw.usdt;
      if (total <= 0) {
        checkRows.push(['金額確認', pw.gameId, app.name, '総金額が0以下です']);
      }
      if (!app.email) {
        checkRows.push(['メール確認', pw.gameId, app.name, 'メールアドレスが空白です']);
      }
      if (RSA_isNoAddressee_(app.receiptName)) {
        checkRows.push(['宛名確認', pw.gameId, app.name, '宛名なしのため、宛名を空白で生成します']);
      }

      matched.push({ pw: pw, app: app, total: total });
    });

    if (!matched.length) {
      RSA_writeCheckReport_(ss, checkRows);
      throw new Error('申請表とPW TSVで一致するGame IDがありません。CHECK_REPORTを確認してください。');
    }

    const runKey = RSA_buildRunKey_(matched);
    RSA_assertRunNotProcessed_(ss, runKey);

    const personCounts = {};
    const groupedMail = {};
    const mailOrder = [];
    const nukidashiRows = [];
    const aiItems = [];

    matched.forEach(item => {
      const app = item.app;
      const pw = item.pw;
      const personKey = RSA_personKey_(app.name, app.email);

      personCounts[personKey] = (personCounts[personKey] || 0) + 1;
      const imageNo = personCounts[personKey];
      const tax = Math.floor(item.total / 11);

      nukidashiRows.push({
        gameId: pw.gameId,
        name: app.name,
        email: app.email,
        receiptName: app.receiptName,
        year: pw.year,
        month: pw.month,
        day: pw.day,
        tournament: pw.tournament,
        type: pw.type,
        cash: pw.cash,
        creditCard: pw.creditCard,
        points: pw.points,
        usdt: pw.usdt
      });

      aiItems.push({
        receiptName: RSA_isNoAddressee_(app.receiptName) ? '' : app.receiptName,
        year: pw.year,
        month: pw.month,
        day: pw.day,
        total: item.total,
        cash: pw.cash,
        creditCard: pw.creditCard,
        points: pw.points,
        tax: tax,
        taxExcluded: item.total - tax,
        tournament: pw.tournament,
        titleA: app.name ? app.name + ' 様' : '',
        imageNo: imageNo
      });

      if (!groupedMail[personKey]) {
        groupedMail[personKey] = {
          gameId: pw.gameId,
          name: app.name,
          email: app.email,
          count: 0
        };
        mailOrder.push(personKey);
      }
      groupedMail[personKey].count = imageNo;
    });

    mailOrder.forEach(key => {
      const item = groupedMail[key];
      if (item.count > 1) {
        checkRows.push(['メール統合', '', item.name, '同一 氏名+メール の複数領収書を1行に統合しました。件数=' + item.count]);
      }
    });

    const mailRows = mailOrder.map(key => {
      const item = groupedMail[key];
      return [
        '',
        item.name,
        item.name ? item.name + ' 様' : '',
        item.count,
        '', // E: ファイル名フィルター。必要時に手動で 2,3,4,5 等を入力する
        '', // F: 添付照合用氏名
        item.email,
        '',
        '',
        '',
        '',
        '',
        '',
        ''
      ];
    });

    RSA_addExistingMailWarnings_(mailSheet, mailRows, checkRows);

    const nukidashiAppend = RSA_prepareNukidashiAppend_(nukidashiSheet, nukidashiRows);
    const placeholderAiRows = aiItems.map(() => new Array(RSA_CONFIG.AI_CSV_HEADERS.length).fill(''));
    const aiAppend = RSA_prepareAppend_(aiSheet, placeholderAiRows, RSA_CONFIG.AI_CSV_HEADERS.length);
    const mailAppend = RSA_prepareAppend_(mailSheet, mailRows, RSA_CONFIG.MAIL_HEADERS.length);

    RSA_writeCheckReport_(ss, checkRows);

    if (previewOnly) {
      RSA_alert_(
        '生成前チェックが完了しました。表への追加はしていません。\n\n' +
        'トナメ抜き出し予定: ' + nukidashiRows.length + '行（' + nukidashiAppend.startRow + '行目から）\n' +
        '書き出しデータ予定: ' + aiItems.length + '行（' + aiAppend.startRow + '行目から）\n' +
        'メール送信予定: ' + mailRows.length + '行（' + mailAppend.startRow + '行目から）\n' +
        '領収書No: 生成時にCSV書き出しシートから読み取ります\n' +
        'CHECK: ' + checkRows.length + '件'
      );
      return;
    }

    RSA_commitNukidashiAppend_(nukidashiAppend);
    SpreadsheetApp.flush();

    const receiptNos = RSA_readReceiptNosFromCsvFormula_(csvFormulaSheet, nukidashiAppend.startRow, aiItems.length);
    aiAppend.rows = RSA_buildAiRowsFromItems_(aiItems, receiptNos);

    RSA_commitAppend_(aiAppend);
    RSA_commitAppend_(mailAppend);

    const aiStartRow = aiAppend.startRow;
    const mailStartRow = mailAppend.startRow;

    RSA_writeRunLog_(ss, [
      new Date(), runKey, aiStartRow, aiItems.length, mailStartRow, mailRows.length
    ]);

    PropertiesService.getDocumentProperties().setProperties({
      RSA_LAST_AI_START_ROW: String(aiStartRow),
      RSA_LAST_AI_ROW_COUNT: String(aiItems.length),
      RSA_LAST_RUN_KEY: runKey
    });

    RSA_alert_(
      '今回分の追加が完了しました。\n\n' +
      'トナメ抜き出し追加: ' + nukidashiRows.length + '行（' + nukidashiAppend.startRow + '行目から）\n' +
      '書き出しデータ追加: ' + aiItems.length + '行（' + aiStartRow + '行目から）\n' +
      'メール送信追加: ' + mailRows.length + '行（' + mailStartRow + '行目から）\n' +
      'CHECK: ' + checkRows.length + '件'
    );
  } finally {
    lock.releaseLock();
  }
}

/**
 * DriveにCSVファイルは作らず、書き出しデータ表を開く。
 */
function exportLatestReceiptAiCsvToDrive() {
  openReceiptAiOutputSheet();
  RSA_alert_('CSVファイルのDrive出力は廃止しました。書き出しデータ表を開きました。');
}

function openReceiptAiOutputSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = RSA_requiredSheet_(ss, RSA_CONFIG.AI_CSV_SHEET_NAME);
  ss.setActiveSheet(sheet);
}

function fixReceiptMailHeaders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = RSA_requiredSheet_(ss, RSA_CONFIG.MAIL_SHEET_NAME);
  RSA_fixMailHeaders_(sheet);
  RSA_alert_('メール送信の表頭 A〜N だけを修正しました。既存データ行は変更していません。');
}

function openReceiptCheckReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = RSA_ensureOwnedSheet_(ss, RSA_CONFIG.CHECK_SHEET_NAME, RSA_CONFIG.CHECK_HEADERS);
  ss.setActiveSheet(sheet);
}

function RSA_readPwRows_(sheet) {
  const objects = RSA_readSheetObjects_(sheet);
  const rows = [];

  objects.forEach(obj => {
    const gameId = RSA_getAny_(obj, ['Game ID', 'GameID']);
    const gameIdKey = RSA_normalizeGameId_(gameId);
    const tournament = RSA_text_(RSA_getAny_(obj, ['大会名', 'トーナメント', 'トーナメント名']));

    if (!gameIdKey && !tournament) return;
    if (!gameIdKey || !tournament) return;

    rows.push({
      gameId: RSA_text_(gameId),
      gameIdKey: gameIdKey,
      purchaseTime: RSA_text_(RSA_getAny_(obj, ['購入時間'])),
      year: RSA_getAny_(obj, ['年']),
      month: RSA_getAny_(obj, ['月']),
      day: RSA_getAny_(obj, ['日', '日付']),
      tournament: tournament,
      type: RSA_text_(RSA_getAny_(obj, ['種別'])),
      cash: RSA_money_(RSA_getAny_(obj, ['現金'])),
      creditCard: RSA_money_(RSA_getAny_(obj, ['クレジットカード'])),
      points: RSA_money_(RSA_getAny_(obj, ['ポイント'])),
      usdt: RSA_money_(RSA_getAny_(obj, ['USDT']))
    });
  });

  return rows;
}

function RSA_readApplications_(sheet, checkRows) {
  const objects = RSA_readSheetObjects_(sheet);
  const map = {};

  objects.forEach(obj => {
    const gameId = RSA_getAny_(obj, ['Game ID', 'GameID']);
    const gameIdKey = RSA_normalizeGameId_(gameId);
    if (!gameIdKey) return;

    const app = {
      gameId: RSA_text_(gameId),
      gameIdKey: gameIdKey,
      name: RSA_text_(RSA_getAny_(obj, ['氏名', '本名', '名前'])),
      email: RSA_text_(RSA_getAny_(obj, ['メールアドレス', '受け取り用メールアドレス', 'メール'])),
      receiptName: RSA_text_(RSA_getAny_(obj, ['宛名', '領収書の宛名']))
    };

    if (map[gameIdKey]) {
      checkRows.push(['重複申請', app.gameId, app.name, '同一 Game ID が申請表に複数あります。先頭行を使用します']);
      return;
    }
    map[gameIdKey] = app;
  });

  return { map: map };
}

function RSA_readSheetObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(RSA_text_);
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((header, index) => {
      if (header) obj[header] = row[index];
    });
    return obj;
  });
}

function RSA_prepareAppend_(sheet, rows, columnCount) {
  const startRow = Math.max(sheet.getLastRow() + 1, 2);
  if (!rows.length) {
    return {
      sheet: sheet,
      rows: rows,
      columnCount: columnCount,
      startRow: startRow,
      target: null
    };
  }

  const requiredLastRow = startRow + rows.length - 1;

  if (requiredLastRow > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), requiredLastRow - sheet.getMaxRows());
  }

  const target = sheet.getRange(startRow, 1, rows.length, columnCount);
  const existing = target.getValues();
  const hasExistingContent = existing.some(row => row.some(value => RSA_text_(value) !== ''));

  if (hasExistingContent) {
    throw new Error('追加予定範囲に既存内容があります。安全のため停止しました: ' + sheet.getName() + ' ' + startRow + '行目以降');
  }

  return {
    sheet: sheet,
    rows: rows,
    columnCount: columnCount,
    startRow: startRow,
    target: target
  };
}

function RSA_commitAppend_(prepared) {
  if (!prepared.rows.length) return;

  const templateRow = prepared.startRow - 1;
  if (templateRow >= 2) {
    prepared.sheet.getRange(templateRow, 1, 1, prepared.columnCount)
      .copyTo(prepared.target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  }

  prepared.target.setValues(prepared.rows);
}

function RSA_prepareNukidashiAppend_(sheet, rows) {
  const lastDataRow = RSA_findNukidashiLastDataRow_(sheet);
  const startRow = Math.max(lastDataRow + 1, 2);
  const requiredLastRow = startRow + rows.length - 1;

  if (requiredLastRow > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), requiredLastRow - sheet.getMaxRows());
  }

  RSA_assertNukidashiInputRangeEmpty_(sheet, startRow, rows.length);

  return {
    sheet: sheet,
    rows: rows,
    startRow: startRow,
    templateRow: Math.max(lastDataRow, 2),
    columnCount: sheet.getLastColumn()
  };
}

function RSA_commitNukidashiAppend_(prepared) {
  if (!prepared.rows.length) return;

  const sheet = prepared.sheet;
  const startRow = prepared.startRow;
  const rowCount = prepared.rows.length;
  const columnCount = prepared.columnCount;

  if (prepared.templateRow >= 2 && columnCount > 0) {
    const target = sheet.getRange(startRow, 1, rowCount, columnCount);
    sheet.getRange(prepared.templateRow, 1, 1, columnCount)
      .copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);

    RSA_fillMissingNukidashiFormulas_(sheet, prepared.templateRow, startRow, rowCount, columnCount);
  }

  const c = RSA_CONFIG.NUKIDASHI_COLUMNS;
  RSA_writeNukidashiColumn_(sheet, startRow, c.gameId, prepared.rows.map(row => RSA_numberOrTextGameId_(row.gameId)));
  RSA_writeNukidashiColumn_(sheet, startRow, c.name, prepared.rows.map(row => row.name));
  RSA_writeNukidashiColumn_(sheet, startRow, c.email, prepared.rows.map(row => row.email));
  RSA_writeNukidashiColumn_(sheet, startRow, c.receiptName, prepared.rows.map(row => row.receiptName));
  RSA_writeNukidashiColumn_(sheet, startRow, c.year, prepared.rows.map(row => row.year));
  RSA_writeNukidashiColumn_(sheet, startRow, c.month, prepared.rows.map(row => row.month));
  RSA_writeNukidashiColumn_(sheet, startRow, c.day, prepared.rows.map(row => row.day));
  RSA_writeNukidashiColumn_(sheet, startRow, c.tournament, prepared.rows.map(row => row.tournament));
  RSA_writeNukidashiColumn_(sheet, startRow, c.type, prepared.rows.map(row => row.type));
  RSA_writeNukidashiColumn_(sheet, startRow, c.cash, prepared.rows.map(row => row.cash));
  RSA_writeNukidashiColumn_(sheet, startRow, c.creditCard, prepared.rows.map(row => row.creditCard));
  RSA_writeNukidashiColumn_(sheet, startRow, c.points, prepared.rows.map(row => row.points));
  RSA_writeNukidashiColumn_(sheet, startRow, c.usdt, prepared.rows.map(row => row.usdt));
}

function RSA_fillMissingNukidashiFormulas_(sheet, templateRow, startRow, rowCount, columnCount) {
  const templateFormulas = sheet.getRange(templateRow, 1, 1, columnCount).getFormulasR1C1()[0];
  const targetRange = sheet.getRange(startRow, 1, rowCount, columnCount);
  const targetFormulas = targetRange.getFormulasR1C1();
  const inputColumns = new Set(
    Object.keys(RSA_CONFIG.NUKIDASHI_COLUMNS)
      .map(key => RSA_CONFIG.NUKIDASHI_COLUMNS[key] - 1)
  );

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    for (let colIndex = 0; colIndex < columnCount; colIndex++) {
      if (inputColumns.has(colIndex)) continue;
      if (targetFormulas[rowIndex][colIndex]) continue;
      if (!templateFormulas[colIndex]) continue;

      sheet.getRange(startRow + rowIndex, colIndex + 1)
        .setFormulaR1C1(templateFormulas[colIndex]);
    }
  }
}

function RSA_writeNukidashiColumn_(sheet, startRow, column, values) {
  sheet.getRange(startRow, column, values.length, 1).setValues(values.map(value => [value]));
}

function RSA_findNukidashiLastDataRow_(sheet) {
  const headerRow = RSA_CONFIG.NUKIDASHI_HEADER_ROW;
  const maxRows = sheet.getMaxRows();
  const keyColumns = [
    RSA_CONFIG.NUKIDASHI_COLUMNS.gameId,
    RSA_CONFIG.NUKIDASHI_COLUMNS.tournament
  ];

  let last = headerRow;

  keyColumns.forEach(column => {
    const values = sheet.getRange(headerRow + 1, column, maxRows - headerRow, 1).getValues();
    for (let i = values.length - 1; i >= 0; i--) {
      if (RSA_text_(values[i][0])) {
        last = Math.max(last, headerRow + 1 + i);
        break;
      }
    }
  });

  return last;
}

function RSA_assertNukidashiInputRangeEmpty_(sheet, startRow, rowCount) {
  if (!rowCount) return;

  // トナメ抜き出しは下方に数式が事前展開されており、
  // 空き行でも En / ¥0 / 様 / 画像番号などの表示値が存在する。
  // データ行の実占有判定は、旧処理と同じく C列Game ID と K列大会名だけで行う。
  const columns = [
    RSA_CONFIG.NUKIDASHI_COLUMNS.gameId,
    RSA_CONFIG.NUKIDASHI_COLUMNS.tournament
  ];

  columns.forEach(column => {
    const range = sheet.getRange(startRow, column, rowCount, 1);
    const values = range.getValues();
    const occupiedRows = [];

    values.forEach((row, index) => {
      if (RSA_text_(row[0]) !== '') {
        occupiedRows.push(startRow + index);
      }
    });

    if (occupiedRows.length) {
      throw new Error(
        'トナメ抜き出し の追加予定行に既存データがあります。安全のため停止しました: ' +
        occupiedRows.join(', ') + '行 / ' + column + '列'
      );
    }
  });
}

function RSA_readReceiptNosFromCsvFormula_(sheet, startRow, rowCount) {
  if (!rowCount) return [];

  const values = sheet.getRange(startRow, 1, rowCount, 1).getDisplayValues();
  const receiptNos = values.map(row => RSA_text_(row[0]));
  const missing = [];

  receiptNos.forEach((receiptNo, index) => {
    if (!receiptNo) {
      missing.push(startRow + index);
    }
  });

  if (missing.length) {
    throw new Error(
      'CSV書き出しシートから領収書Noを取得できませんでした。\n' +
      '対象行: ' + missing.join(', ') + '\n' +
      'トナメ抜き出しの公式反映を確認してください。'
    );
  }

  return receiptNos;
}

function RSA_buildAiRowsFromItems_(items, receiptNos) {
  return items.map((item, index) => [
    receiptNos[index],
    item.receiptName,
    item.year,
    item.month,
    item.day,
    item.total,
    item.cash,
    item.creditCard,
    item.points,
    item.tax,
    item.taxExcluded,
    item.tournament,
    item.titleA,
    item.imageNo
  ]);
}

function RSA_addExistingMailWarnings_(mailSheet, newRows, checkRows) {
  if (mailSheet.getLastRow() < 2) return;

  const existing = mailSheet.getRange(2, 1, mailSheet.getLastRow() - 1, 7).getValues();
  const existingKeys = new Set(existing.map(row => RSA_personKey_(row[1], row[6])));

  newRows.forEach(row => {
    const key = RSA_personKey_(row[1], row[6]);
    if (key && existingKeys.has(key)) {
      checkRows.push([
        '既存メール確認',
        '',
        RSA_text_(row[1]),
        'メール送信表に同じ 氏名+メール の既存行があります。Gmail下書き実行前に重複を確認してください'
      ]);
    }
  });
}

function RSA_buildRunKey_(matched) {
  const source = matched.map(item => [
    item.pw.gameIdKey,
    item.pw.purchaseTime,
    item.pw.year,
    item.pw.month,
    item.pw.day,
    item.pw.tournament,
    item.pw.type,
    item.pw.cash,
    item.pw.creditCard,
    item.pw.points,
    item.pw.usdt,
    item.app.name,
    item.app.email,
    item.app.receiptName
  ].join('|')).join('\n');

  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, source, Utilities.Charset.UTF_8);
  return bytes.map(byte => ('0' + ((byte + 256) % 256).toString(16)).slice(-2)).join('');
}

function RSA_assertRunNotProcessed_(ss, runKey) {
  const sheet = RSA_ensureOwnedSheet_(ss, RSA_CONFIG.RUN_LOG_SHEET_NAME, RSA_CONFIG.RUN_LOG_HEADERS);
  if (sheet.getLastRow() < 2) return;

  const keys = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getDisplayValues().flat();
  if (keys.indexOf(runKey) >= 0) {
    throw new Error('同じ入力内容はすでに追加済みです。重複追加を防止するため停止しました。');
  }
}

function RSA_writeRunLog_(ss, row) {
  const sheet = RSA_ensureOwnedSheet_(ss, RSA_CONFIG.RUN_LOG_SHEET_NAME, RSA_CONFIG.RUN_LOG_HEADERS);
  sheet.appendRow(row);
}

function RSA_writeCheckReport_(ss, rows) {
  const sheet = RSA_ensureOwnedSheet_(ss, RSA_CONFIG.CHECK_SHEET_NAME, RSA_CONFIG.CHECK_HEADERS);
  const lastRow = sheet.getLastRow();

  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, RSA_CONFIG.CHECK_HEADERS.length).clearContent();
  }
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, RSA_CONFIG.CHECK_HEADERS.length).setValues(rows);
  }
}

function RSA_ensureOwnedSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    RSA_assertExactHeaders_(sheet, headers);
  }
  return sheet;
}

function RSA_assertExactHeaders_(sheet, expected) {
  if (sheet.getLastColumn() < expected.length) {
    throw new Error('表の列数が不足しています。既存表は変更せず停止しました: ' + sheet.getName());
  }

  const actual = sheet.getRange(1, 1, 1, expected.length).getDisplayValues()[0].map(RSA_text_);
  const differences = [];

  expected.forEach((header, index) => {
    if (actual[index] !== RSA_text_(header)) {
      differences.push((index + 1) + '列目: 期待=[' + header + '] 実際=[' + actual[index] + ']');
    }
  });

  if (differences.length) {
    throw new Error(
      '表頭が想定と異なります。既存表は変更せず停止しました: ' + sheet.getName() + '\n' +
      differences.join('\n')
    );
  }
}

function RSA_assertMailHeaders_(sheet) {
  const expected = RSA_CONFIG.MAIL_HEADERS;

  if (sheet.getLastColumn() < expected.length) {
    throw new Error('表の列数が不足しています。既存表は変更せず停止しました: ' + sheet.getName());
  }

  const actual = sheet.getRange(1, 1, 1, expected.length).getDisplayValues()[0].map(RSA_text_);
  const differences = [];

  expected.forEach((header, index) => {
    // A列、E列、F列は旧表では空白、新表では説明用表頭が入るため、両方を許可する。
    if (index === 0) return;
    if (index === 4 && (actual[index] === '' || actual[index] === 'ファイル名フィルター')) return;
    if (index === 5 && (actual[index] === '' || actual[index] === '添付照合用氏名')) return;

    if (actual[index] !== RSA_text_(header)) {
      differences.push((index + 1) + '列目: 期待=[' + header + '] 実際=[' + actual[index] + ']');
    }
  });

  if (differences.length) {
    throw new Error(
      'メール送信の表頭が想定と異なります。既存表は変更せず停止しました。\n' +
      differences.join('\n')
    );
  }
}

function RSA_fixMailHeaders_(sheet) {
  if (sheet.getMaxColumns() < RSA_CONFIG.MAIL_HEADERS.length) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      RSA_CONFIG.MAIL_HEADERS.length - sheet.getMaxColumns()
    );
  }

  sheet.getRange(1, 1, 1, RSA_CONFIG.MAIL_HEADERS.length)
    .setValues([RSA_CONFIG.MAIL_HEADERS]);
}

function RSA_requiredSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error('必要な表が見つかりません。自動作成せず停止しました: ' + name);
  }
  return sheet;
}

function RSA_getAny_(obj, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(obj, name)) return obj[name];
  }
  return '';
}

function RSA_normalizeGameId_(value) {
  return String(value === null || value === undefined ? '' : value).replace(/\D/g, '');
}

function RSA_numberOrTextGameId_(value) {
  const key = RSA_normalizeGameId_(value);
  if (/^\d+$/.test(key)) return Number(key);
  return RSA_text_(value);
}

function RSA_personKey_(name, email) {
  const n = RSA_text_(name);
  const e = RSA_text_(email).toLowerCase();
  return n || e ? n + '||' + e : '';
}

function RSA_isNoAddressee_(value) {
  const text = RSA_text_(value).replace(/\s/g, '');
  return !text || text === '宛名なし';
}

function RSA_text_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\u3000/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function RSA_money_(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value === null || value === undefined ? '' : value)
    .replace(/[￥¥,\s　円]/g, '')
    .replace(/-$/, '')
    .trim();
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function RSA_formatYen_(value) {
  return '¥' + Math.round(Number(value) || 0).toLocaleString('ja-JP') + '-';
}

function RSA_alert_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    console.log(message);
  }
}
