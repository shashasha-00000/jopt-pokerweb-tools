/*******************************************************
 * ReceiptSemiAutoAppend.gs
 *
 * PW TSVショウ用 + 領収書申請入力 から、既存の
 * AI_CSV_EXPORT / メール送信 の末尾へ今回分だけ追加する。
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
  AI_CSV_SHEET_NAME: 'AI_CSV_EXPORT',
  MAIL_SHEET_NAME: 'メール送信',
  CHECK_SHEET_NAME: 'CHECK_REPORT',
  RUN_LOG_SHEET_NAME: '領収書半自動_RUN_LOG',

  HEADER_ROW: 1,
  DATA_START_ROW: 2,

  // 空白の場合、スプレッドシートと同じフォルダへCSVを出力する。
  CSV_OUTPUT_FOLDER_URL_OR_ID: '',
  CSV_FILE_PREFIX: 'AI_CSV_EXPORT_',

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
 * 入力表・チェック表・実行履歴表を準備し、専用onOpenトリガーを登録する。
 * AI_CSV_EXPORT / メール送信 は保護のため自動作成しない。
 */
function setupReceiptSemiAutoAppend() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  RSA_ensureOwnedSheet_(ss, RSA_CONFIG.APPLICATION_SHEET_NAME, RSA_CONFIG.APPLICATION_HEADERS);
  RSA_ensureOwnedSheet_(ss, RSA_CONFIG.CHECK_SHEET_NAME, RSA_CONFIG.CHECK_HEADERS);
  RSA_ensureOwnedSheet_(ss, RSA_CONFIG.RUN_LOG_SHEET_NAME, RSA_CONFIG.RUN_LOG_HEADERS);

  const exists = ScriptApp.getProjectTriggers().some(trigger => {
    return trigger.getHandlerFunction() === 'receiptSemiAutoOnOpen';
  });

  if (!exists) {
    ScriptApp.newTrigger('receiptSemiAutoOnOpen')
      .forSpreadsheet(ss)
      .onOpen()
      .create();
  }

  RSA_addMenu_();
  RSA_alert_(
    '初期設定が完了しました。\n\n' +
    'AI_CSV_EXPORT と メール送信 は既存表を使用します。\n' +
    'この2表は自動作成・変更していません。'
  );
}

function receiptSemiAutoOnOpen() {
  RSA_addMenu_();
}

function RSA_addMenu_() {
  SpreadsheetApp.getUi()
    .createMenu('領収書半自動')
    .addItem('生成前チェック（書き込みなし）', 'previewReceiptCsvAndMailList')
    .addItem('CSV・メール送信生成', 'buildReceiptCsvAndMailList')
    .addItem('AI CSV をDrive出力', 'exportLatestReceiptAiCsvToDrive')
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
    const aiSheet = RSA_requiredSheet_(ss, RSA_CONFIG.AI_CSV_SHEET_NAME);
    const mailSheet = RSA_requiredSheet_(ss, RSA_CONFIG.MAIL_SHEET_NAME);

    RSA_assertExactHeaders_(aiSheet, RSA_CONFIG.AI_CSV_HEADERS);
    RSA_assertExactHeaders_(mailSheet, RSA_CONFIG.MAIL_HEADERS);

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

    const currentMaxReceiptNo = RSA_findMaxReceiptNo_(aiSheet);
    const personCounts = {};
    const groupedMail = {};
    const mailOrder = [];
    const aiRows = [];

    matched.forEach((item, index) => {
      const app = item.app;
      const pw = item.pw;
      const personKey = RSA_personKey_(app.name, app.email);

      personCounts[personKey] = (personCounts[personKey] || 0) + 1;
      const imageNo = personCounts[personKey];
      const tax = Math.floor(item.total / 11);

      aiRows.push([
        currentMaxReceiptNo + index + 1,
        RSA_isNoAddressee_(app.receiptName) ? '' : app.receiptName,
        pw.year,
        pw.month,
        pw.day,
        RSA_formatYen_(item.total),
        RSA_formatYen_(pw.cash),
        RSA_formatYen_(pw.creditCard),
        RSA_formatYen_(pw.points),
        RSA_formatYen_(tax),
        RSA_formatYen_(item.total - tax),
        pw.tournament,
        app.name ? app.name + ' 様' : '',
        imageNo
      ]);

      if (!groupedMail[personKey]) {
        groupedMail[personKey] = {
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
        '',
        '',
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

    // 両方の出力先を先に検査し、片方だけ書き込まれる状態を防ぐ。
    const aiAppend = RSA_prepareAppend_(aiSheet, aiRows, RSA_CONFIG.AI_CSV_HEADERS.length);
    const mailAppend = RSA_prepareAppend_(mailSheet, mailRows, RSA_CONFIG.MAIL_HEADERS.length);

    RSA_writeCheckReport_(ss, checkRows);

    if (previewOnly) {
      RSA_alert_(
        '生成前チェックが完了しました。表への追加はしていません。\n\n' +
        'AI CSV予定: ' + aiRows.length + '行（' + aiAppend.startRow + '行目から）\n' +
        'メール送信予定: ' + mailRows.length + '行（' + mailAppend.startRow + '行目から）\n' +
        '次の領収書No: ' + (currentMaxReceiptNo + 1) + '\n' +
        'CHECK: ' + checkRows.length + '件'
      );
      return;
    }

    RSA_commitAppend_(aiAppend);
    RSA_commitAppend_(mailAppend);

    const aiStartRow = aiAppend.startRow;
    const mailStartRow = mailAppend.startRow;

    RSA_writeRunLog_(ss, [
      new Date(), runKey, aiStartRow, aiRows.length, mailStartRow, mailRows.length
    ]);

    PropertiesService.getDocumentProperties().setProperties({
      RSA_LAST_AI_START_ROW: String(aiStartRow),
      RSA_LAST_AI_ROW_COUNT: String(aiRows.length),
      RSA_LAST_RUN_KEY: runKey
    });

    RSA_alert_(
      '今回分の追加が完了しました。\n\n' +
      'AI CSV追加: ' + aiRows.length + '行（' + aiStartRow + '行目から）\n' +
      'メール送信追加: ' + mailRows.length + '行（' + mailStartRow + '行目から）\n' +
      'CHECK: ' + checkRows.length + '件'
    );
  } finally {
    lock.releaseLock();
  }
}

/**
 * 最後に生成したAI CSV行だけをCSV化する。
 */
function exportLatestReceiptAiCsvToDrive() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = RSA_requiredSheet_(ss, RSA_CONFIG.AI_CSV_SHEET_NAME);
  RSA_assertExactHeaders_(sheet, RSA_CONFIG.AI_CSV_HEADERS);

  const props = PropertiesService.getDocumentProperties();
  const startRow = Number(props.getProperty('RSA_LAST_AI_START_ROW') || 0);
  const rowCount = Number(props.getProperty('RSA_LAST_AI_ROW_COUNT') || 0);

  if (startRow < 2 || rowCount < 1) {
    throw new Error('このスクリプトで生成した最新AI CSVデータがありません。');
  }

  const values = [
    RSA_CONFIG.AI_CSV_HEADERS,
    ...sheet.getRange(startRow, 1, rowCount, RSA_CONFIG.AI_CSV_HEADERS.length).getDisplayValues()
  ];

  const csv = values.map(row => row.map(RSA_csvCell_).join(',')).join('\r\n');
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const fileName = RSA_CONFIG.CSV_FILE_PREFIX + stamp + '.csv';
  const blob = Utilities.newBlob('\uFEFF' + csv, 'text/csv', fileName);
  const folder = RSA_getCsvOutputFolder_(ss);
  const file = folder.createFile(blob);

  RSA_alert_('AI CSVをDriveへ出力しました。\n\n' + file.getName() + '\n' + file.getUrl());
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

function RSA_findMaxReceiptNo_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  return sheet.getRange(2, 1, lastRow - 1, 1).getValues()
    .reduce((max, row) => Math.max(max, RSA_money_(row[0])), 0);
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

function RSA_csvCell_(value) {
  const text = String(value === null || value === undefined ? '' : value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function RSA_getCsvOutputFolder_(ss) {
  const configured = RSA_text_(RSA_CONFIG.CSV_OUTPUT_FOLDER_URL_OR_ID);
  if (configured) {
    const match = configured.match(/folders\/([a-zA-Z0-9_-]+)/) ||
      configured.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
      configured.match(/^([a-zA-Z0-9_-]{20,})$/);
    if (!match) throw new Error('CSV_OUTPUT_FOLDER_URL_OR_ID からDriveフォルダIDを取得できません。');
    return DriveApp.getFolderById(match[1]);
  }

  const file = DriveApp.getFileById(ss.getId());
  const parents = file.getParents();
  return parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
}

function RSA_alert_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    console.log(message);
  }
}
