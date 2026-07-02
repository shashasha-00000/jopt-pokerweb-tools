/**
 * ReceiptUnifiedFlow.gs
 *
 * Unified receipt workflow source for Google Apps Script.
 * This file is maintained directly.
 */

/*******************************************************
 * PW TSV / tournament extraction / mail row workflow
 *
 * PW TSVショウ用 + 領収書申請入力 / フォームの回答 1 から、
 * トナメ抜き出しへ今回分を追加して既存番号体系に乗せ、
 * CSV書き出しシートから領収書Noだけ読み、
 * 書き出しデータ / メール送信 の末尾へ今回分だけ追加する。
 *
 * 重要:
 * - 既存行、表頭、数式、書式、列幅を変更しない
 * - 出力先表がない、または表頭が一致しない場合は停止する
 * - 同じ入力を再実行した場合は追加せず停止する
 * - CHECK_REPORT はこのスクリプト専用なので内容を更新する
 * - 手入力を優先し、不足項目だけフォーム回答から補完する
 *******************************************************/

const RSA_CONFIG = {
  PW_SHEET_NAME: 'PW TSVショウ用',
  APPLICATION_SHEET_NAME: '領収書申請入力',
  FORM_SHEET_NAMES: ['フォームの回答 1'],
  NUKIDASHI_SHEET_NAME: 'トナメ抜き出し',
  CSV_FORMULA_SHEET_BASE_NAME: 'CSV書き出しシート（緑以外いじらない',
  AI_CSV_SHEET_NAME: '書き出しデータ',
  MAIL_SHEET_NAMES: ['メール送信', 'メール送信一覧'],
  CHECK_SHEET_NAME: 'CHECK_REPORT',
  RUN_LOG_SHEET_NAME: '領収書半自動_RUN_LOG',
  SETTINGS_SHEET_NAME: '領収書設定',

  HEADER_ROW: 1,
  DATA_START_ROW: 2,

  PW_HEADERS: [
    'Game ID', '購入時間', '年', '月', '日', '大会名',
    '種別', '現金', 'クレジットカード', 'ポイント', 'USDT'
  ],

  APPLICATION_HEADERS: [
    'Game ID', '氏名', 'メールアドレス', '宛名'
  ],

  FORM_HEADERS: {
    gameId: [
      'Game ID', 'GameID', 'ゲームID',
      'Game ID（８桁、ドット含まない）',
      'Game ID（8桁、ドット含まない）',
      'Game ID (8桁、ドット含まない)'
    ],
    name: ['本名(フルネーム)', '本名', '名前', '氏名'],
    email: [
      '領収書受け取り用メールアドレス',
      '受け取り用メールアドレス',
      'メールアドレス', 'Email', 'メール'
    ],
    receiptName: ['宛名', '領収書の宛名']
  },

  SETTINGS_HEADERS: ['設定項目', '設定値', '説明'],

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
    usdt: 17,
    imageNumber: 28
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
  RSA_ensureSettingsSheet_(ss);
  RSA_prepareMailSheet_(RSA_getOrCreateMailSheet_(ss));

  RSA_addMenu_();
  RSA_alert_(
    '初期設定が完了しました。\n\n' +
    '書き出しデータ / 領収書申請入力 / CHECK_REPORT / 領収書設定 を準備しました。\n' +
    '領収書申請入力を優先し、不足項目はフォーム回答から補完します。'
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
    .addItem('1. PW TSV→トナメ抜き出し チェック', 'previewReceiptPwToNukidashi')
    .addItem('1. PW TSV→トナメ抜き出し 実行', 'appendReceiptPwToNukidashi')
    .addSeparator()
    .addItem('2. 選択トナメ行→メール送信生成', 'buildReceiptMailRowsFromSelectedNukidashi')
    .addItem('2. 最新トナメ行→メール送信生成', 'buildReceiptMailRowsFromLatestNukidashi')
    .addItem('書き出しデータを開く', 'openReceiptAiOutputSheet')
    .addSeparator()
    .addItem('選択行のGmail下書きを作成', 'createReceiptDraftsForSelectedRows')
    .addItem('未作成行のGmail下書きを作成', 'createReceiptDraftsForUnfinishedRows')
    .addSeparator()
    .addItem('選択行のOK下書きを送信', 'sendApprovedReceiptDraftsForSelectedRows')
    .addItem('未送信行のOK下書きを送信', 'sendApprovedReceiptDraftsForUnsentRows')
    .addSeparator()
    .addItem('初期設定・不足表を準備', 'setupReceiptSemiAutoAppend')
    .addItem('メール送信の表頭だけ修正', 'fixReceiptMailHeaders')
    .addItem('領収書設定を開く', 'openReceiptSettings')
    .addItem('CHECK_REPORTを開く', 'openReceiptCheckReport')
    .addToUi();
}

function previewReceiptPwToNukidashi() {
  RSA_runNukidashiOnly_(true);
}

function appendReceiptPwToNukidashi() {
  RSA_runNukidashiOnly_(false);
}

function RSA_runNukidashiOnly_(previewOnly) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const pwSheet = RSA_requiredSheet_(ss, RSA_CONFIG.PW_SHEET_NAME);
    const applicationSheet = RSA_requiredSheet_(ss, RSA_CONFIG.APPLICATION_SHEET_NAME);
    const formSheet = RSA_getSelectedFormSheet_(ss);
    const nukidashiSheet = RSA_requiredSheet_(ss, RSA_CONFIG.NUKIDASHI_SHEET_NAME);
    const checkRows = [];
    const pwRows = RSA_readPwRows_(pwSheet);
    const applicationMap = RSA_readApplications_(applicationSheet, checkRows).map;
    const formMap = formSheet ? RSA_readFormMap_(formSheet, checkRows) : {};

    if (!pwRows.length) {
      throw new Error('PW TSVショウ用 に処理対象行がありません。');
    }

    const matched = [];
    pwRows.forEach(pw => {
      const app = RSA_mergeApplicant_(applicationMap[pw.gameIdKey], formMap[pw.gameIdKey]);
      if (!app) {
        checkRows.push(['PWのみ', pw.gameId, '', '手書き入力とフォーム回答のどちらにも対応するGame IDがありません']);
        return;
      }
      if (!app.name || !app.email) {
        checkRows.push(['資料不足', pw.gameId, app.name, '氏名またはメールアドレスを確認してください']);
        return;
      }

      const total = pw.cash + pw.creditCard + pw.points + pw.usdt;
      if (total <= 0) checkRows.push(['金額確認', pw.gameId, app.name, '総金額が0以下です']);
      matched.push({ pw: pw, app: app, total: total });
    });

    if (!matched.length) {
      RSA_writeCheckReport_(ss, checkRows);
      throw new Error('トナメ抜き出しへ追加できる行がありません。CHECK_REPORTを確認してください。');
    }

    const runKey = RSA_buildRunKey_(matched);
    const props = PropertiesService.getDocumentProperties();
    if (!previewOnly && props.getProperty('RSA_LAST_NUKIDASHI_RUN_KEY') === runKey) {
      throw new Error('同じPW TSV内容はすでにトナメ抜き出しへ追加済みです。');
    }

    const rows = matched.map(item => ({
      gameId: item.pw.gameId,
      name: item.app.name,
      email: item.app.email,
      receiptName: item.app.receiptName,
      year: item.pw.year,
      month: item.pw.month,
      day: item.pw.day,
      tournament: item.pw.tournament,
      type: item.pw.type,
      cash: item.pw.cash,
      creditCard: item.pw.creditCard,
      points: item.pw.points,
      usdt: item.pw.usdt
    }));
    const prepared = RSA_prepareNukidashiAppend_(nukidashiSheet, rows);
    RSA_writeCheckReport_(ss, checkRows);

    if (previewOnly) {
      RSA_alert_(
        'トナメ抜き出し生成前チェック完了。まだ書き込んでいません。\n\n' +
        '追加予定: ' + rows.length + '行（' + prepared.startRow + '行目から）\n' +
        'CHECK: ' + checkRows.length + '件'
      );
      return;
    }

    RSA_commitNukidashiAppend_(prepared);
    const clearedDuplicateGameIds = RSA_clearDuplicateGameIdsInRange_(
      nukidashiSheet,
      prepared.startRow,
      rows.length
    );
    const manualByGameId = {};
    matched.forEach(item => {
      if (!item.app.manualRowNo) return;
      manualByGameId[item.pw.gameIdKey] = {
        rowNo: item.app.manualRowNo,
        gameIdKey: item.pw.gameIdKey
      };
    });
    props.setProperties({
      RSA_LAST_NUKIDASHI_START_ROW: String(prepared.startRow),
      RSA_LAST_NUKIDASHI_ROW_COUNT: String(rows.length),
      RSA_LAST_NUKIDASHI_RUN_KEY: runKey,
      RSA_LAST_NUKIDASHI_SHEET_NAME: nukidashiSheet.getName(),
      RSA_LAST_NUKIDASHI_MANUAL_BY_GAME_ID: JSON.stringify(manualByGameId)
    });

    RSA_alert_(
      'PW TSVからトナメ抜き出しへの追加が完了しました。\n\n' +
      '追加: ' + rows.length + '行（' + prepared.startRow + '行目から）\n' +
      '重複Game IDクリア: ' + clearedDuplicateGameIds + '行\n' +
      '書き出しデータ・CSV・メール送信は変更していません。'
    );
  } finally {
    lock.releaseLock();
  }
}

function buildReceiptMailRowsFromLatestNukidashi() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const props = PropertiesService.getDocumentProperties();
    const startRow = Number(props.getProperty('RSA_LAST_NUKIDASHI_START_ROW') || 0);
    const rowCount = Number(props.getProperty('RSA_LAST_NUKIDASHI_ROW_COUNT') || 0);

    if (!Number.isInteger(startRow) || startRow < 2 || !Number.isInteger(rowCount) || rowCount < 1) {
      throw new Error('最新のトナメ抜き出し範囲がありません。先に手順1を実行してください。');
    }

    const savedNukidashiSheetName = props.getProperty('RSA_LAST_NUKIDASHI_SHEET_NAME');
    const nukidashiSheet = savedNukidashiSheetName
      ? ss.getSheetByName(savedNukidashiSheetName)
      : RSA_requiredSheet_(ss, RSA_CONFIG.NUKIDASHI_SHEET_NAME);
    if (!nukidashiSheet) {
      throw new Error('保存されたトナメ抜き出し表が見つかりません: ' + savedNukidashiSheetName);
    }
    const mailSheet = RSA_getOrCreateMailSheet_(ss);
    RSA_prepareMailSheet_(mailSheet);
    RSA_assertMailHeaders_(mailSheet);

    const c = RSA_CONFIG.NUKIDASHI_COLUMNS;
    const grouped = {};
    const order = [];
    const checkRows = [];
    let manualByGameId = {};

    try {
      manualByGameId = JSON.parse(props.getProperty('RSA_LAST_NUKIDASHI_MANUAL_BY_GAME_ID') || '{}');
    } catch (_) {}

    for (let rowNo = startRow; rowNo < startRow + rowCount; rowNo++) {
      const rowValues = nukidashiSheet
        .getRange(rowNo, 1, 1, Math.max(c.imageNumber, c.tournament))
        .getDisplayValues()[0];
      const imageCount = RSA_count_(rowValues[c.imageNumber - 1]);
      const hasDetail = Boolean(
        RSA_text_(rowValues[c.tournament - 1]) ||
        RSA_normalizeGameId_(rowValues[c.gameId - 1])
      );
      if (imageCount <= 0 && !hasDetail) continue;
      if (imageCount <= 0) {
        checkRows.push([
          '画像番号不足',
          RSA_text_(rowValues[c.gameId - 1]),
          RSA_text_(rowValues[c.name - 1]),
          'AB列「画像タイトルB」が空白、0、または数値ではありません: ' + rowNo + '行'
        ]);
        continue;
      }

      const owner = RSA_readNukidashiOwnerAtRow_(nukidashiSheet, rowNo);
      if (!owner.name || !owner.email) {
        checkRows.push(['メール資料不足', owner.gameId, owner.name, '氏名またはメールアドレスを特定できません: ' + rowNo + '行']);
        continue;
      }

      const key = RSA_personKey_(owner.name, owner.email);
      if (!grouped[key]) {
        grouped[key] = {
          gameId: owner.gameId,
          name: owner.name,
          email: owner.email,
          count: imageCount,
          manualSources: []
        };
        order.push(key);
      } else {
        grouped[key].count = Math.max(grouped[key].count, imageCount);
      }

      const source = manualByGameId[owner.gameIdKey];
      if (source && !grouped[key].manualSources.some(item => item.gameIdKey === owner.gameIdKey)) {
        grouped[key].manualSources.push(source);
      }
    }

    if (checkRows.length) {
      RSA_writeCheckReport_(ss, checkRows);
      throw new Error('メール送信行を生成できないトナメ行があります。CHECK_REPORTを確認してください。');
    }
    if (!order.length) throw new Error('対象のトナメ抜き出し範囲にメール生成対象がありません。大会名・氏名・メールアドレスを確認してください。');

    const mailRows = order.map(key => {
      const item = grouped[key];
      return [
        '', item.name, item.name + ' 様', item.count,
        '', '', item.email, '', '', '', '', '', '', ''
      ];
    });

    RSA_addExistingMailWarnings_(mailSheet, mailRows, checkRows);
    RSA_writeCheckReport_(ss, checkRows);
    const prepared = RSA_prepareAppend_(mailSheet, mailRows, RSA_CONFIG.MAIL_HEADERS.length);
    RSA_commitAppend_(prepared);

    const manualRowsByMailRow = {};
    order.forEach((key, index) => {
      const sources = grouped[key].manualSources;
      if (sources.length) manualRowsByMailRow[String(prepared.startRow + index)] = sources;
    });

    props.setProperties({
      RSA_LAST_MAIL_START_ROW: String(prepared.startRow),
      RSA_LAST_MAIL_ROW_COUNT: String(mailRows.length),
      RSA_MANUAL_ROWS_BY_MAIL_ROW: JSON.stringify(manualRowsByMailRow)
    });

    RSA_alert_(
      '最新のトナメ抜き出しからメール送信行を生成しました。\n\n' +
      '追加: ' + mailRows.length + '行（' + prepared.startRow + '行目から）\n' +
      'CSV・書き出しデータは変更していません。'
    );
  } finally {
    lock.releaseLock();
  }
}

function buildReceiptMailRowsFromSelectedNukidashi() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();

  RSA_assertNukidashiSheetStructure_(sheet);

  const range = sheet.getActiveRange();
  if (!range || range.getRow() < 2) {
    throw new Error('トナメ抜き出し の第2行以降を選択してください。');
  }

  const startRow = range.getRow();
  const rowCount = range.getNumRows();

  PropertiesService.getDocumentProperties().setProperties({
    RSA_LAST_NUKIDASHI_START_ROW: String(startRow),
    RSA_LAST_NUKIDASHI_ROW_COUNT: String(rowCount),
    RSA_LAST_NUKIDASHI_SHEET_NAME: sheet.getName(),
    RSA_LAST_NUKIDASHI_MANUAL_BY_GAME_ID: '{}'
  });

  buildReceiptMailRowsFromLatestNukidashi();
}

/**
 * メイン処理。
 * 今回分を既存出力表の末尾へ追加する。
 */
function RSA_runBuild_(previewOnly) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const pwSheet = RSA_requiredSheet_(ss, RSA_CONFIG.PW_SHEET_NAME);
    const applicationSheet = RSA_requiredSheet_(ss, RSA_CONFIG.APPLICATION_SHEET_NAME);
    const formSheet = RSA_getSelectedFormSheet_(ss);
    const nukidashiSheet = RSA_requiredSheet_(ss, RSA_CONFIG.NUKIDASHI_SHEET_NAME);
    const csvFormulaSheet = RSA_requiredCsvFormulaSheet_(ss);
    const aiSheet = RSA_requiredSheet_(ss, RSA_CONFIG.AI_CSV_SHEET_NAME);
    const mailSheet = RSA_getOrCreateMailSheet_(ss);

    RSA_assertExactHeaders_(aiSheet, RSA_CONFIG.AI_CSV_HEADERS);
    RSA_prepareMailSheet_(mailSheet);
    RSA_assertMailHeaders_(mailSheet);

    const checkRows = [];
    const pwRows = RSA_readPwRows_(pwSheet);
    const applicationResult = RSA_readApplications_(applicationSheet, checkRows);
    const applicationMap = applicationResult.map;
    const formMap = formSheet ? RSA_readFormMap_(formSheet, checkRows) : {};

    if (!pwRows.length) {
      throw new Error('PW TSVショウ用 に処理対象行がありません。');
    }
    if (!Object.keys(applicationMap).length && !Object.keys(formMap).length) {
      RSA_writeCheckReport_(ss, checkRows);
      throw new Error(
        '領収書申請入力とフォーム回答のどちらにも有効な申請がありません。' +
        (formSheet ? 'CHECK_REPORTでフォーム列の認識結果を確認してください。' : 'フォーム回答シートが見つかりません。')
      );
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
      const app = RSA_mergeApplicant_(applicationMap[pw.gameIdKey], formMap[pw.gameIdKey]);
      if (!app) {
        checkRows.push(['PWのみ', pw.gameId, '', '手書き入力とフォーム回答のどちらにも対応するGame IDがありません。領収書は生成しません']);
        return;
      }

      if (!app.name || !app.email) {
        checkRows.push(['資料不足', pw.gameId, app.name, '氏名またはメールアドレスを手書き入力かフォーム回答で確認してください']);
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
          count: 0,
          manualSources: []
        };
        mailOrder.push(personKey);
      }
      groupedMail[personKey].count = imageNo;
      if (app.manualRowNo && !groupedMail[personKey].manualSources.some(source => source.gameIdKey === app.gameIdKey)) {
        groupedMail[personKey].manualSources.push({
          rowNo: app.manualRowNo,
          gameIdKey: app.gameIdKey
        });
      }
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
    RSA_clearDuplicateGameIdsInRange_(nukidashiSheet, nukidashiAppend.startRow, nukidashiRows.length);
    SpreadsheetApp.flush();

    const receiptNos = RSA_readReceiptNosFromCsvFormula_(csvFormulaSheet, nukidashiAppend.startRow, aiItems.length);
    aiAppend.rows = RSA_buildAiRowsFromItems_(aiItems, receiptNos);

    RSA_commitAppend_(aiAppend);
    RSA_commitAppend_(mailAppend);

    const aiStartRow = aiAppend.startRow;
    const mailStartRow = mailAppend.startRow;
    const manualRowsByMailRow = {};
    mailOrder.forEach((key, index) => {
      const sources = groupedMail[key].manualSources;
      if (sources.length) manualRowsByMailRow[String(mailStartRow + index)] = sources;
    });

    RSA_writeRunLog_(ss, [
      new Date(), runKey, aiStartRow, aiItems.length, mailStartRow, mailRows.length
    ]);

    PropertiesService.getDocumentProperties().setProperties({
      RSA_LAST_AI_START_ROW: String(aiStartRow),
      RSA_LAST_AI_ROW_COUNT: String(aiItems.length),
      RSA_LAST_MAIL_START_ROW: String(mailStartRow),
      RSA_LAST_MAIL_ROW_COUNT: String(mailRows.length),
      RSA_LAST_RUN_KEY: runKey,
      RSA_MANUAL_ROWS_BY_MAIL_ROW: JSON.stringify(manualRowsByMailRow)
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
function openReceiptAiOutputSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = RSA_requiredSheet_(ss, RSA_CONFIG.AI_CSV_SHEET_NAME);
  ss.setActiveSheet(sheet);
}

function fixReceiptMailHeaders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = RSA_getOrCreateMailSheet_(ss);
  RSA_prepareMailSheet_(sheet);
  RSA_alert_('メール送信の表頭 A〜N だけを修正しました。既存データ行は変更していません。');
}

function openReceiptSettings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = RSA_ensureSettingsSheet_(ss);
  ss.setActiveSheet(sheet);
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

  objects.forEach((obj, index) => {
    const gameId = RSA_getAny_(obj, ['Game ID', 'GameID']);
    const gameIdKey = RSA_normalizeGameId_(gameId);
    if (!gameIdKey) return;

    const app = {
      gameId: RSA_text_(gameId),
      gameIdKey: gameIdKey,
      rowNo: index + 2,
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

function RSA_readFormMap_(sheet, checkRows) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return {};

  const headers = values[0].map(RSA_text_);
  const columns = {
    gameId: RSA_findHeader_(headers, RSA_CONFIG.FORM_HEADERS.gameId),
    name: RSA_findHeader_(headers, RSA_CONFIG.FORM_HEADERS.name),
    email: RSA_findHeader_(headers, RSA_CONFIG.FORM_HEADERS.email),
    receiptName: RSA_findHeader_(headers, RSA_CONFIG.FORM_HEADERS.receiptName)
  };

  if (columns.gameId < 0 || columns.name < 0 || columns.email < 0) {
    const missing = [];
    if (columns.gameId < 0) missing.push('Game ID');
    if (columns.name < 0) missing.push('本名');
    if (columns.email < 0) missing.push('メールアドレス');
    checkRows.push([
      'フォーム確認', '', '',
      'フォーム回答で列を判定できません: ' + missing.join(' / ') + '（表: ' + sheet.getName() + '）'
    ]);
    return {};
  }

  const map = {};
  values.slice(1).forEach((row, index) => {
    const gameId = row[columns.gameId];
    const gameIdKey = RSA_normalizeGameId_(gameId);
    if (!gameIdKey) return;

    const item = {
      gameId: RSA_text_(gameId),
      gameIdKey: gameIdKey,
      rowNo: index + 2,
      name: RSA_text_(row[columns.name]),
      email: RSA_text_(row[columns.email]),
      receiptName: columns.receiptName >= 0 ? RSA_text_(row[columns.receiptName]) : ''
    };

    if (map[gameIdKey]) {
      checkRows.push(['重複フォーム', item.gameId, item.name, '同一 Game ID がフォーム回答に複数あります。後の回答を使用します']);
    }
    map[gameIdKey] = item;
  });

  return map;
}

function RSA_mergeApplicant_(manual, form) {
  if (!manual && !form) return null;

  const merged = {
    gameId: RSA_text_((manual && manual.gameId) || (form && form.gameId)),
    gameIdKey: (manual && manual.gameIdKey) || (form && form.gameIdKey),
    name: RSA_text_((manual && manual.name) || (form && form.name)),
    email: RSA_text_((manual && manual.email) || (form && form.email)),
    receiptName: RSA_text_((manual && manual.receiptName) || (form && form.receiptName)),
    manualRowNo: manual ? manual.rowNo : 0,
    usedFormFallback: Boolean(manual && form && (
      (!manual.name && form.name) ||
      (!manual.email && form.email) ||
      (!manual.receiptName && form.receiptName)
    ))
  };

  return merged;
}

function RSA_findHeader_(headers, candidates) {
  const normalized = headers.map(RSA_text_);
  for (const candidate of candidates) {
    const index = normalized.indexOf(RSA_text_(candidate));
    if (index >= 0) return index;
  }
  return -1;
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

function RSA_readNukidashiOwnerAtRow_(sheet, rowNo) {
  const c = RSA_CONFIG.NUKIDASHI_COLUMNS;
  const width = Math.max(c.gameId, c.name, c.email);

  for (let row = rowNo; row >= RSA_CONFIG.NUKIDASHI_HEADER_ROW + 1; row--) {
    const values = sheet.getRange(row, 1, 1, width).getDisplayValues()[0];
    const name = RSA_text_(values[c.name - 1]);
    const email = RSA_text_(values[c.email - 1]);
    if (!name && !email) continue;

    const gameId = RSA_text_(values[c.gameId - 1]);
    return {
      gameId: gameId,
      gameIdKey: RSA_normalizeGameId_(gameId),
      name: name,
      email: email
    };
  }

  return { gameId: '', gameIdKey: '', name: '', email: '' };
}

function RSA_assertNukidashiSheetStructure_(sheet) {
  const c = RSA_CONFIG.NUKIDASHI_COLUMNS;
  const headers = sheet
    .getRange(RSA_CONFIG.NUKIDASHI_HEADER_ROW, 1, 1, c.imageNumber)
    .getDisplayValues()[0]
    .map(RSA_text_);
  const validGameId = ['Game ID', 'GameID'].indexOf(headers[c.gameId - 1]) >= 0;
  const validName = ['名前', '氏名', '本名'].indexOf(headers[c.name - 1]) >= 0;
  const validEmail = ['メールアドレス', 'メール'].indexOf(headers[c.email - 1]) >= 0;
  const validTournament = ['トーナメント', 'トーナメント名', '大会名'].indexOf(headers[c.tournament - 1]) >= 0;
  const validImageTitleA = headers[c.imageNumber - 2] === '画像タイトルA';
  const validImageTitleB = headers[c.imageNumber - 1] === '画像タイトルB';

  if (!validGameId || !validName || !validEmail || !validTournament || !validImageTitleA || !validImageTitleB) {
    throw new Error(
      '選択中の表はトナメ抜き出し形式ではありません: ' + sheet.getName() +
      '（C列=GameID、D列=名前、E列=メールアドレス、K列=トーナメント、AA列=画像タイトルA、AB列=画像タイトルBを確認してください）'
    );
  }
}

function RSA_count_(value) {
  const number = Number(String(value === null || value === undefined ? '' : value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
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
      .filter(key => key !== 'imageNumber')
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

function RSA_clearDuplicateGameIdsInRange_(sheet, startRow, rowCount) {
  if (!rowCount) return 0;

  const gameIdColumn = RSA_CONFIG.NUKIDASHI_COLUMNS.gameId;
  const values = sheet.getRange(startRow, gameIdColumn, rowCount, 1).getDisplayValues();
  const seen = new Set();
  const duplicateRows = [];

  values.forEach((row, index) => {
    const key = RSA_normalizeGameId_(row[0]);
    if (!key) return;
    if (seen.has(key)) {
      duplicateRows.push(startRow + index);
      return;
    }
    seen.add(key);
  });

  duplicateRows.forEach(rowNo => {
    sheet.getRange(rowNo, gameIdColumn).clearContent();
  });

  return duplicateRows.length;
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

function RSA_ensureSettingsSheet_(ss) {
  let sheet = ss.getSheetByName(RSA_CONFIG.SETTINGS_SHEET_NAME);
  if (!sheet) {
    const defaultFolderUrl = typeof RECEIPT_MAIL_CONFIG !== 'undefined' &&
      RECEIPT_MAIL_CONFIG.RECEIPT_FOLDER_URLS &&
      RECEIPT_MAIL_CONFIG.RECEIPT_FOLDER_URLS.length
      ? RECEIPT_MAIL_CONFIG.RECEIPT_FOLDER_URLS.join('\n')
      : '';
    sheet = ss.insertSheet(RSA_CONFIG.SETTINGS_SHEET_NAME);
    sheet.getRange(1, 1, 1, RSA_CONFIG.SETTINGS_HEADERS.length).setValues([RSA_CONFIG.SETTINGS_HEADERS]);
    sheet.getRange(2, 1, 5, RSA_CONFIG.SETTINGS_HEADERS.length).setValues([
      ['PNG DriveフォルダURL', defaultFolderUrl, '複数ある場合は設定値セル内で改行してください'],
      ['下書き成功後に手入力をクリア', 'ON', 'ONで、今回の下書き成功行に使った手入力だけをクリアします'],
      ['CSV書き出しシート名', '', '候補が複数ある場合は使用する表を選択してください'],
      ['フォーム回答シート名', '', 'フォーム回答を使用する場合は対象表を選択してください'],
      ['EVENT LABEL', '', '空白なら追加用の共通本文、入力ありなら大会名入り本文を使用します']
    ]);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, RSA_CONFIG.SETTINGS_HEADERS.length);
  }

  const settingRow = RSA_ensureSettingRow_(
    sheet,
    'CSV書き出しシート名',
    '',
    '候補が複数ある場合は使用する表を選択してください'
  );
  const candidateNames = RSA_findCsvFormulaSheets_(ss).map(candidate => candidate.getName());
  const valueCell = sheet.getRange(settingRow, 2);
  if (candidateNames.length) {
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(candidateNames, true)
      .setAllowInvalid(false)
      .build();
    valueCell.setDataValidation(rule);
    if (!RSA_text_(valueCell.getDisplayValue()) && candidateNames.length === 1) {
      valueCell.setValue(candidateNames[0]);
    }
  }

  const formSettingRow = RSA_ensureSettingRow_(
    sheet,
    'フォーム回答シート名',
    '',
    'フォーム回答を使用する場合は対象表を選択してください'
  );
  const formCandidateNames = RSA_findFormSheets_(ss).map(candidate => candidate.getName());
  const formValueCell = sheet.getRange(formSettingRow, 2);
  if (formCandidateNames.length) {
    const formRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(formCandidateNames, true)
      .setAllowInvalid(false)
      .build();
    formValueCell.setDataValidation(formRule);
    if (!RSA_text_(formValueCell.getDisplayValue()) && formCandidateNames.length === 1) {
      formValueCell.setValue(formCandidateNames[0]);
    }
  }
  RSA_ensureSettingRow_(
    sheet,
    'EVENT LABEL',
    '',
    '空白なら追加用の共通本文、入力ありなら大会名入り本文を使用します'
  );
  return sheet;
}

function RSA_ensureSettingRow_(sheet, key, defaultValue, description) {
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const keys = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat().map(RSA_text_);
    const index = keys.indexOf(key);
    if (index >= 0) return index + 2;
  }
  const row = Math.max(lastRow + 1, 2);
  sheet.getRange(row, 1, 1, 3).setValues([[key, defaultValue, description]]);
  return row;
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

  if (sheet.getMaxColumns() < expected.length) {
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

function RSA_prepareMailSheet_(sheet) {
  if (sheet.getMaxColumns() < RSA_CONFIG.MAIL_HEADERS.length) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      RSA_CONFIG.MAIL_HEADERS.length - sheet.getMaxColumns()
    );
  }

  const range = sheet.getRange(1, 1, 1, RSA_CONFIG.MAIL_HEADERS.length);
  const current = range.getDisplayValues()[0];
  const completed = RSA_CONFIG.MAIL_HEADERS.map((expected, index) => {
    return RSA_text_(current[index]) ? current[index] : expected;
  });
  range.setValues([completed]);
}

function RSA_requiredSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error('必要な表が見つかりません。自動作成せず停止しました: ' + name);
  }
  return sheet;
}

function RSA_findFirstSheet_(ss, names) {
  for (const name of names) {
    const sheet = ss.getSheetByName(name);
    if (sheet) return sheet;
  }
  return null;
}

function RSA_getSelectedFormSheet_(ss) {
  const selectedName = RSA_getSettingValue_(ss, 'フォーム回答シート名');
  if (selectedName) {
    const selectedSheet = ss.getSheetByName(selectedName);
    if (selectedSheet) return selectedSheet;
    throw new Error('領収書設定で選択したフォーム回答シートが見つかりません: ' + selectedName);
  }

  const exactSheet = RSA_findFirstSheet_(ss, RSA_CONFIG.FORM_SHEET_NAMES);
  if (exactSheet) return exactSheet;

  const candidates = RSA_findFormSheets_(ss);
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    throw new Error(
      'フォーム回答シートの候補が複数あります。領収書設定で使用する表を選択してください: ' +
      candidates.map(sheet => sheet.getName()).join(' / ')
    );
  }
  return null;
}

function RSA_findFormSheets_(ss) {
  return ss.getSheets().filter(sheet => {
    const name = RSA_text_(sheet.getName());
    return name.indexOf('フォーム') >= 0 || name.indexOf('回答') >= 0;
  });
}

function RSA_requiredSheetAny_(ss, names) {
  const sheet = RSA_findFirstSheet_(ss, names);
  if (sheet) return sheet;
  throw new Error('必要な表が見つかりません: ' + names.join(' / '));
}

function RSA_getOrCreateMailSheet_(ss) {
  const existing = RSA_findFirstSheet_(ss, RSA_CONFIG.MAIL_SHEET_NAMES);
  if (existing) return existing;

  const sheet = ss.insertSheet('メール送信一覧');
  RSA_prepareMailSheet_(sheet);
  sheet.setFrozenRows(1);
  return sheet;
}

function RSA_requiredCsvFormulaSheet_(ss) {
  const selectedName = RSA_getSettingValue_(ss, 'CSV書き出しシート名');
  if (selectedName) {
    const selectedSheet = ss.getSheetByName(selectedName) ||
      RSA_findSheetByLooseName_(ss, selectedName);
    if (selectedSheet) return selectedSheet;
    throw new Error('領収書設定で選択したCSV書き出しシートが見つかりません: ' + selectedName);
  }

  const candidates = RSA_findCsvFormulaSheets_(ss);

  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    throw new Error(
      'CSV書き出しシートの候補が複数あります。領収書設定で使用する表を選択してください: ' +
      candidates.map(sheet => sheet.getName()).join(' / ')
    );
  }

  throw new Error('CSV書き出しシートが見つかりません: ' + RSA_CONFIG.CSV_FORMULA_SHEET_BASE_NAME + '）');
}

function RSA_findCsvFormulaSheets_(ss) {
  const baseName = RSA_CONFIG.CSV_FORMULA_SHEET_BASE_NAME;
  const baseKey = RSA_looseSheetNameKey_(baseName);
  return ss.getSheets().filter(sheet => {
    const name = sheet.getName();
    if (name === baseName || name === baseName + '）') return true;
    const nameKey = RSA_looseSheetNameKey_(name);
    if (nameKey === baseKey) return true;
    const suffix = name.slice(baseName.length);
    return /^(?:\uFF09)? \(\d+\)$/.test(suffix);
  });
}

function RSA_findSheetByLooseName_(ss, expectedName) {
  const expectedKey = RSA_looseSheetNameKey_(expectedName);
  if (!expectedKey) return null;

  const matches = ss.getSheets().filter(sheet => RSA_looseSheetNameKey_(sheet.getName()) === expectedKey);
  return matches.length === 1 ? matches[0] : null;
}

function RSA_looseSheetNameKey_(name) {
  let text = String(name || '');
  if (text.normalize) text = text.normalize('NFKC');
  return text
    .replace(/[\s\u3000]/g, '')
    .replace(/[()（）]/g, '')
    .trim()
    .toLowerCase();
}

function RSA_getSettingValue_(ss, key) {
  const sheet = ss.getSheetByName(RSA_CONFIG.SETTINGS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return '';
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues();
  for (const row of values) {
    if (RSA_text_(row[0]) === key) return RSA_text_(row[1]);
  }
  return '';
}

function RSA_clearManualInputsForDraftRow_(mailRow) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!RSA_isSettingEnabled_(ss, '下書き成功後に手入力をクリア', true)) return;

  const props = PropertiesService.getDocumentProperties();
  const raw = props.getProperty('RSA_MANUAL_ROWS_BY_MAIL_ROW') || '{}';
  let mapping;
  try {
    mapping = JSON.parse(raw);
  } catch (error) {
    throw new Error('手入力クリア情報を読み取れません: ' + error.message);
  }

  const sources = mapping[String(mailRow)] || [];
  if (!sources.length) return;

  const sheet = ss.getSheetByName(RSA_CONFIG.APPLICATION_SHEET_NAME);
  if (!sheet) return;

  const gameIds = sheet.getLastRow() >= 2
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues().flat()
    : [];

  sources.forEach(source => {
    const expectedKey = RSA_normalizeGameId_(source.gameIdKey);
    let rowNo = Number(source.rowNo);
    const currentKey = rowNo >= 2 ? RSA_normalizeGameId_(sheet.getRange(rowNo, 1).getDisplayValue()) : '';

    if (!expectedKey || currentKey !== expectedKey) {
      const index = gameIds.findIndex(value => RSA_normalizeGameId_(value) === expectedKey);
      rowNo = index >= 0 ? index + 2 : 0;
    }

    if (rowNo >= 2) {
      sheet.getRange(rowNo, 1, 1, RSA_CONFIG.APPLICATION_HEADERS.length).clearContent();
    }
  });

  delete mapping[String(mailRow)];
  props.setProperty('RSA_MANUAL_ROWS_BY_MAIL_ROW', JSON.stringify(mapping));
}

function RSA_isSettingEnabled_(ss, key, defaultValue) {
  const sheet = ss.getSheetByName(RSA_CONFIG.SETTINGS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return defaultValue;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues();
  for (const row of values) {
    if (RSA_text_(row[0]) !== key) continue;
    const value = RSA_text_(row[1]).toUpperCase();
    return ['ON', 'TRUE', 'YES', '1', '有効'].indexOf(value) >= 0;
  }
  return defaultValue;
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

/************************************
 * メール送信一覧（5/26最新）→ Gmail下書き作成・OK分送信
 *
 * 正式全表版 v2.1
 *
 * 今回のルール：
 *
 * E列：ファイル名フィルター / MEMO
 * - 空白：ファイル名フィルターなし
 * - 入力あり：ファイル名にその文字列を含む領収書だけ対象
 *
 * 例：
 * E列 = 【SPADIE Season 41st】
 *   → 【SPADIE Season 41st】 領収書_... だけ対象
 *   → 【SPADIE Season 41st 店舗Day1】... は対象外
 *
 * E列 = 店舗Day1
 *   → 店舗Day1 のファイルだけ対象
 *
 *
 * F列：添付照合用氏名
 * - 空白：B列氏名で照合
 * - 1行入力：その名前だけで照合
 * - 複数行入力：複数の名前を許可して照合
 *
 * 例：
 * F列 =
 * 黒崎慎
 *
 * → 黒崎慎 のファイルだけ対象
 *
 * F列 =
 * 黒崎慎
 * 黒崎 慎
 *
 * → 黒崎慎 と 黒崎 慎 の両方を対象
 *
 *
 * 安全設計：
 * - 直接送信しない
 * - まず Gmail 下書きを作成
 * - Draft ID を K列に保存
 * - L列が OK の下書きだけ送信
 * - 送信済み行はスキップ
 * - 既に Draft ID がある行は再作成しない
 * - F列空白で、ゆるい名前一致に複数候補がある場合はエラーにしてF列指定を要求
 *
 *
 * 列想定：
 * A列：GameID / 空白
 * B列：氏名
 * C列：宛名表示用（氏名 様）
 * D列：件数
 * E列：ファイル名フィルター / MEMO
 * F列：添付照合用氏名
 * G列：メールアドレス
 *
 * 出力：
 * H列：下書きステータス
 * I列：エラー
 * J列：添付ファイル名一覧
 * K列：Draft ID
 * L列：送信OK
 * M列：送信ステータス
 * N列：送信日時
 ************************************/

const RECEIPT_MAIL_CONFIG = {
  SHEET_NAMES: ['メール送信', 'メール送信一覧'],
  SETTINGS_SHEET_NAME: '領収書設定',
  SETTINGS_FOLDER_KEY: 'PNG DriveフォルダURL',
  SETTINGS_EVENT_LABEL_KEY: 'EVENT LABEL',

  // Gmail下書き作成は、選択行またはH列未作成行を明示的に対象にする。

  // ★ここにDriveフォルダURLを入れる
  RECEIPT_FOLDER_URLS: [
    'https://drive.google.com/drive/u/0/folders/10CxC__9YxLTG1-K_ufcK7Ioh5lIU2fAH'
  ],

  FROM: 'customer@japanopenpoker.com',
  FROM_NAME: 'Japan Open Poker Tour / JOPT',
  BCC: 'customer@japanopenpoker.com',

  SUBJECT: '電子領収書の送付について',

  EVENT_LABEL: '',

  // 元データ列
  COL_GAME_ID: 1,             // A列
  COL_NAME: 2,                // B列：氏名
  COL_ADDRESSEE: 3,           // C列：宛名表示用（氏名 様）
  COL_ATTACHMENT_COUNT: 4,    // D列：件数
  COL_FILE_FILTER: 5,         // E列：ファイル名フィルター / MEMO
  COL_MATCH_NAME: 6,          // F列：添付照合用氏名
  COL_EMAIL: 7,               // G列：メールアドレス

  // 出力列
  COL_DRAFT_STATUS: 8,        // H列
  COL_ERROR: 9,               // I列
  COL_ATTACHMENT_NAMES: 10,   // J列
  COL_DRAFT_ID: 11,           // K列
  COL_SEND_OK: 12,            // L列
  COL_SEND_STATUS: 13,        // M列
  COL_SENT_AT: 14             // N列
};


function createReceiptDraftsForSelectedRows() {
  const sheet = receipt_getTargetSheet_();
  const rows = receipt_getSelectedTargetRows_(sheet);
  receipt_createDraftsForRows_(sheet, rows, '選択行');
}

function createReceiptDraftsForUnfinishedRows() {
  const sheet = receipt_getTargetSheet_();
  const rows = receipt_getUnfinishedDraftRows_(sheet);
  receipt_createDraftsForRows_(sheet, rows, '未作成行');
}

function createReceiptDraftsAllRows() {
  createReceiptDraftsForUnfinishedRows();
}

function receipt_createDraftsForRows_(sheet, rows, label) {
  if (!rows.length) {
    throw new Error(label + 'のGmail下書き作成対象がありません。');
  }

  const folders = receipt_getReceiptFolders_();

  receipt_setupHeaders_(sheet);

  const startRow = Math.min.apply(null, rows);
  const endRow = Math.max.apply(null, rows);
  receipt_showToast_(label + 'の領収書ファイルを検索しています...', 'Gmail下書き作成');

  const duplicateNameSet = receipt_buildDuplicateNameSet_(sheet, startRow, endRow);
  const receiptFiles = receipt_buildReceiptFileListFromFolders_(folders);

  let createdCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  rows.forEach(row => {
    const result = receipt_createDraftForRow_(sheet, receiptFiles, duplicateNameSet, row);

    if (result === 'created') createdCount++;
    if (result === 'skipped') skippedCount++;
    if (result === 'error') errorCount++;

    Utilities.sleep(200);
  });

  Logger.log(label + ' 下書き作成完了');
  Logger.log('対象行: ' + receipt_formatRowsForMessage_(rows));
  Logger.log('作成: ' + createdCount + '件');
  Logger.log('スキップ: ' + skippedCount + '件');
  Logger.log('エラー: ' + errorCount + '件');

  receipt_showResult_(
    label + ' Gmail下書き作成完了\n\n' +
    '対象行: ' + receipt_formatRowsForMessage_(rows) + '\n' +
    '作成: ' + createdCount + '件\n' +
    'スキップ: ' + skippedCount + '件\n' +
    'エラー: ' + errorCount + '件'
  );
}

function receipt_getSelectedTargetRows_(sheet) {
  const activeSheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (activeSheet.getSheetId() !== sheet.getSheetId()) {
    throw new Error('メール送信表で対象行を選択してから実行してください。');
  }

  const range = activeSheet.getActiveRange();
  if (!range || range.getRow() < 2) {
    throw new Error('メール送信表の2行目以降を選択してください。');
  }

  const startRow = range.getRow();
  const endRow = startRow + range.getNumRows() - 1;
  const rows = [];

  for (let row = startRow; row <= endRow; row++) {
    rows.push(row);
  }

  return rows;
}

function receipt_getUnfinishedDraftRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet
    .getRange(2, 1, lastRow - 1, RECEIPT_MAIL_CONFIG.COL_DRAFT_STATUS)
    .getDisplayValues();
  const rows = [];

  values.forEach((rowValues, index) => {
    const rowNo = index + 2;
    const name = String(rowValues[RECEIPT_MAIL_CONFIG.COL_NAME - 1] || '').trim();
    const email = String(rowValues[RECEIPT_MAIL_CONFIG.COL_EMAIL - 1] || '').trim();
    const draftStatus = String(rowValues[RECEIPT_MAIL_CONFIG.COL_DRAFT_STATUS - 1] || '').trim();

    if (!name && !email) return;
    if (draftStatus === '下書き作成済み') return;

    rows.push(rowNo);
  });

  return rows;
}

function receipt_getUnsentRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet
    .getRange(2, 1, lastRow - 1, RECEIPT_MAIL_CONFIG.COL_SEND_STATUS)
    .getDisplayValues();
  const rows = [];

  values.forEach((rowValues, index) => {
    const rowNo = index + 2;
    const name = String(rowValues[RECEIPT_MAIL_CONFIG.COL_NAME - 1] || '').trim();
    const email = String(rowValues[RECEIPT_MAIL_CONFIG.COL_EMAIL - 1] || '').trim();
    const sendStatus = String(rowValues[RECEIPT_MAIL_CONFIG.COL_SEND_STATUS - 1] || '').trim();

    if (!name && !email) return;
    if (sendStatus === '送信済み') return;

    rows.push(rowNo);
  });

  return rows;
}

function receipt_formatRowsForMessage_(rows) {
  if (!rows.length) return '';
  const sorted = rows.slice().sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const row = sorted[i];
    if (row === prev + 1) {
      prev = row;
      continue;
    }
    ranges.push(start === prev ? String(start) : start + '〜' + prev);
    start = row;
    prev = row;
  }

  ranges.push(start === prev ? String(start) : start + '〜' + prev);
  return ranges.join(', ');
}


function sendApprovedReceiptDraftsForSelectedRows() {
  const sheet = receipt_getTargetSheet_();
  const rows = receipt_getSelectedTargetRows_(sheet);
  receipt_sendApprovedDraftsForRows_(sheet, rows, '選択行');
}

function sendApprovedReceiptDraftsForUnsentRows() {
  const sheet = receipt_getTargetSheet_();
  const rows = receipt_getUnsentRows_(sheet);
  receipt_sendApprovedDraftsForRows_(sheet, rows, '未送信行');
}

function sendApprovedReceiptDraftsAllRows() {
  sendApprovedReceiptDraftsForSelectedRows();
}

function receipt_sendApprovedDraftsForRows_(sheet, rows, label) {
  if (!rows.length) {
    throw new Error(label + 'のGmail送信対象がありません。');
  }

  receipt_showToast_(label + 'のL列「OK」を確認して送信しています...', 'Gmail送信');

  let sentCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  rows.forEach(row => {
    const draftStatus = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_DRAFT_STATUS).getValue() || '').trim();
    const error = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_ERROR).getValue() || '').trim();
    const draftId = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_DRAFT_ID).getValue() || '').trim();
    const sendOk = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_SEND_OK).getValue() || '').trim();
    const sendStatus = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_SEND_STATUS).getValue() || '').trim();

    const isSendableDraftStatus =
      draftStatus === '下書き作成済み' ||
      draftStatus === '要確認';

    if (!isSendableDraftStatus) {
      skippedCount++;
      return;
    }

    if (error !== '') {
      skippedCount++;
      return;
    }

    if (!draftId) {
      skippedCount++;
      return;
    }

    if (sendOk !== 'OK') {
      skippedCount++;
      return;
    }

    if (sendStatus === '送信済み') {
      skippedCount++;
      return;
    }

    try {
      const draft = GmailApp.getDraft(draftId);
      const message = draft.getMessage();

      const subject = message.getSubject();
      const to = message.getTo();

      if (subject !== RECEIPT_MAIL_CONFIG.SUBJECT) {
        throw new Error('件名が一致しません: ' + subject);
      }

      if (!to) {
        throw new Error('宛先が空です');
      }

      draft.send();

      sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_SEND_STATUS).setValue('送信済み');
      sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_SENT_AT).setValue(new Date());

      sentCount++;
      Utilities.sleep(500);

    } catch (err) {
      sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_SEND_STATUS).setValue('送信エラー: ' + err.message);
      errorCount++;
    }
  });

  Logger.log(label + ' 送信完了');
  Logger.log('対象行: ' + receipt_formatRowsForMessage_(rows));
  Logger.log('送信済み: ' + sentCount + '件');
  Logger.log('スキップ: ' + skippedCount + '件');
  Logger.log('送信エラー: ' + errorCount + '件');

  receipt_showResult_(
    label + ' Gmail送信完了\n\n' +
    '対象行: ' + receipt_formatRowsForMessage_(rows) + '\n' +
    '送信済み: ' + sentCount + '件\n' +
    'スキップ: ' + skippedCount + '件\n' +
    '送信エラー: ' + errorCount + '件'
  );
}


/**
 * 全表：送信対象診断
 */
function debugReceiptDraftsAllRows() {
  const sheet = receipt_getTargetSheet_();

  const rows = receipt_getSelectedTargetRows_(sheet);

  Logger.log('=== 選択行 送信対象チェック開始 ===');
  Logger.log('対象行: ' + receipt_formatRowsForMessage_(rows));

  for (const row of rows) {
    const name = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_NAME).getValue() || '').trim();
    const email = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_EMAIL).getValue() || '').trim();
    const count = receipt_getAttachmentCount_(sheet, row);
    const fileFilter = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_FILE_FILTER).getValue() || '').trim();
    const matchName = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_MATCH_NAME).getValue() || '').trim();

    const draftStatus = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_DRAFT_STATUS).getValue() || '').trim();
    const error = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_ERROR).getValue() || '').trim();
    const draftId = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_DRAFT_ID).getValue() || '').trim();
    const sendOk = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_SEND_OK).getValue() || '').trim();
    const sendStatus = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_SEND_STATUS).getValue() || '').trim();

    if (!name && !email && count <= 0) {
      continue;
    }

    Logger.log('--- row ' + row + ' / ' + name + ' ---');
    Logger.log('宛先: [' + email + ']');
    Logger.log('件数: [' + count + ']');
    Logger.log('E列ファイル名フィルター: [' + fileFilter + ']');
    Logger.log('F列添付照合用氏名: [' + matchName + ']');
    Logger.log('下書きステータス: [' + draftStatus + ']');
    Logger.log('エラー: [' + error + ']');
    Logger.log('Draft ID: [' + draftId + ']');
    Logger.log('送信OK: [' + sendOk + ']');
    Logger.log('送信ステータス: [' + sendStatus + ']');

    if (count <= 0) {
      Logger.log('SKIP理由: D列件数が空白または0');
      continue;
    }

    const isSendableDraftStatus =
      draftStatus === '下書き作成済み' ||
      draftStatus === '要確認';

    if (!isSendableDraftStatus) {
      Logger.log('SKIP理由: 下書き作成済み / 要確認 ではない');
      continue;
    }

    if (error !== '') {
      Logger.log('SKIP理由: エラー列に値がある');
      continue;
    }

    if (!draftId) {
      Logger.log('SKIP理由: Draft ID が空');
      continue;
    }

    if (sendOk !== 'OK') {
      Logger.log('SKIP理由: 送信OK列が OK ではない');
      continue;
    }

    if (sendStatus === '送信済み') {
      Logger.log('SKIP理由: すでに送信済み');
      continue;
    }

    try {
      const draft = GmailApp.getDraft(draftId);
      const message = draft.getMessage();

      Logger.log('草稿件名: [' + message.getSubject() + ']');
      Logger.log('草稿宛先: [' + message.getTo() + ']');
      Logger.log('SEND対象: 条件OK');
    } catch (err) {
      Logger.log('SKIP理由: Draft取得不可: ' + err.message);
    }
  }

  Logger.log('=== 選択行 送信対象チェック終了 ===');
}


/**
 * エラー行だけ再下書き作成
 * エラー修正後に使う
 */
function retryReceiptErrorRows() {
  const sheet = receipt_getTargetSheet_();
  const folders = receipt_getReceiptFolders_();

  receipt_setupHeaders_(sheet);

  const rows = receipt_getSelectedTargetRows_(sheet);
  const startRow = Math.min.apply(null, rows);
  const endRow = Math.max.apply(null, rows);
  receipt_showToast_('選択行のエラー行を再処理しています...', 'Gmail下書き再作成');

  const duplicateNameSet = receipt_buildDuplicateNameSet_(sheet, startRow, endRow);
  const receiptFiles = receipt_buildReceiptFileListFromFolders_(folders);

  let createdCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  rows.forEach(row => {
    const draftStatus = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_DRAFT_STATUS).getValue() || '').trim();
    const error = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_ERROR).getValue() || '').trim();

    if (draftStatus !== 'エラー' && !error) {
      skippedCount++;
      return;
    }

    const result = receipt_createDraftForRow_(sheet, receiptFiles, duplicateNameSet, row);

    if (result === 'created') createdCount++;
    if (result === 'skipped') skippedCount++;
    if (result === 'error') errorCount++;

    Utilities.sleep(200);
  });

  Logger.log('エラー行 再下書き作成完了');
  Logger.log('対象行: ' + receipt_formatRowsForMessage_(rows));
  Logger.log('作成: ' + createdCount + '件');
  Logger.log('スキップ: ' + skippedCount + '件');
  Logger.log('エラー: ' + errorCount + '件');

  receipt_showResult_(
    '選択行 エラー行再処理完了\n\n' +
    '対象行: ' + receipt_formatRowsForMessage_(rows) + '\n' +
    '作成: ' + createdCount + '件\n' +
    'スキップ: ' + skippedCount + '件\n' +
    'エラー: ' + errorCount + '件'
  );
}


/**
 * 1行分の下書き作成
 */
function receipt_createDraftForRow_(sheet, receiptFiles, duplicateNameSet, row) {
  try {
    const gameId = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_GAME_ID).getValue() || '').trim();
    const name = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_NAME).getValue() || '').trim();
    const addresseeRaw = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_ADDRESSEE).getValue() || '').trim();
    const fileFilter = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_FILE_FILTER).getValue() || '').trim();
    const matchNameRaw = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_MATCH_NAME).getValue() || '').trim();
    const email = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_EMAIL).getValue() || '').trim();
    const expectedAttachmentCount = receipt_getAttachmentCount_(sheet, row);

    const currentStatus = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_DRAFT_STATUS).getValue() || '').trim();
    const currentDraftId = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_DRAFT_ID).getValue() || '').trim();
    const sendStatus = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_SEND_STATUS).getValue() || '').trim();

    if (expectedAttachmentCount <= 0) {
      return 'skipped';
    }

    if (sendStatus === '送信済み') {
      return 'skipped';
    }

    if ((currentStatus === '下書き作成済み' || currentStatus === '要確認') && currentDraftId) {
      return 'skipped';
    }

    receipt_clearDraftResultColumns_(sheet, row);

    if (!name) throw new Error('氏名が空です');
    if (!email) throw new Error('メールアドレスが空です');

    const nameKey = receipt_strictNameKey_(name);
    if (duplicateNameSet.has(nameKey)) {
      throw new Error('同一氏名が複数行に存在します。氏名を確認してください: ' + name);
    }

    receipt_validateEmail_(email);

    const matchResult = receipt_findReceiptFilesForRow_({
      receiptFiles: receiptFiles,
      name: name,
      matchNameRaw: matchNameRaw,
      fileFilter: fileFilter,
      expectedAttachmentCount: expectedAttachmentCount
    });

    const files = matchResult.files;
    const draftStatusToWrite = matchResult.status;
    const warningMessage = matchResult.warningMessage;

    const addressee = receipt_buildAddressee_(addresseeRaw, name);
    const body = receipt_buildMailBody_(addressee);

    const attachments = files.map(fileInfo => fileInfo.file.getBlob().setName(fileInfo.file.getName()));

    const draft = GmailApp.createDraft(email, RECEIPT_MAIL_CONFIG.SUBJECT, body, {
      from: RECEIPT_MAIL_CONFIG.FROM,
      name: RECEIPT_MAIL_CONFIG.FROM_NAME,
      bcc: RECEIPT_MAIL_CONFIG.BCC,
      attachments: attachments
    });

    const draftId = draft.getId();
    const attachmentNames = files.map(fileInfo => fileInfo.file.getName()).join('\n');

    sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_DRAFT_STATUS).setValue(draftStatusToWrite);
    sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_ERROR).clearContent();
    sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_ATTACHMENT_NAMES).setValue(
      warningMessage
        ? attachmentNames + '\n\n【確認メモ】\n' + warningMessage
        : attachmentNames
    );
    sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_DRAFT_ID).setValue(draftId);

    if (typeof RSA_clearManualInputsForDraftRow_ === 'function') {
      try {
        RSA_clearManualInputsForDraftRow_(row);
      } catch (cleanupError) {
        Logger.log('手入力の自動クリアをスキップしました: ' + cleanupError.message);
      }
    }

    Logger.log('下書き作成 row ' + row);
    Logger.log('Game ID: ' + gameId);
    Logger.log('氏名: ' + name);
    Logger.log('宛名: ' + addressee);
    Logger.log('宛先: ' + email);
    Logger.log('E列ファイル名フィルター: ' + fileFilter);
    Logger.log('F列添付照合用氏名: ' + matchNameRaw);
    Logger.log('Draft Status: ' + draftStatusToWrite);
    Logger.log('Draft ID: ' + draftId);
    Logger.log('添付数: ' + attachments.length);
    if (warningMessage) Logger.log('確認メモ: ' + warningMessage);

    return 'created';

  } catch (error) {
    sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_DRAFT_STATUS).setValue('エラー');
    sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_ERROR).setValue(error.message);

    Logger.log('エラー row ' + row);
    Logger.log(error.message);

    return 'error';
  }
}


/**
 * 領収書ファイル検索
 *
 * ルール：
 * 1. E列フィルターが空白なら、ファイル名フィルターなし
 * 2. E列フィルターが入力されているなら、ファイル名にその文字列を含むものだけ対象
 * 3. F列に照合名がある場合、その名前だけで照合。複数行なら複数名を許可。
 * 4. F列が空白の場合、B列氏名で厳密一致を試す
 * 5. F列空白で厳密一致に失敗し、ゆるい一致で複数の名前候補がある場合はエラーにしてF列指定を要求
 * 6. 見つかった添付数は必ずD列件数と一致する必要がある
 */
function receipt_findReceiptFilesForRow_(params) {
  const receiptFiles = params.receiptFiles;
  const name = params.name;
  const matchNameRaw = params.matchNameRaw;
  const fileFilter = params.fileFilter;
  const expectedAttachmentCount = params.expectedAttachmentCount;

  const scopedFiles = receiptFiles.filter(fileInfo => {
    return receipt_fileNameMatchesFilter_(fileInfo.fileName, fileFilter);
  });

  const manualNames = receipt_parseMatchNames_(matchNameRaw);

  if (manualNames.length > 0) {
    const manualStrictKeys = manualNames.map(receipt_strictNameKey_).filter(Boolean);

    const manualMatches = receipt_uniqueFileInfos_(
      scopedFiles.filter(fileInfo => manualStrictKeys.indexOf(fileInfo.strictNameKey) >= 0)
    );

    if (manualMatches.length === expectedAttachmentCount) {
      return {
        files: receipt_sortReceiptFiles_(manualMatches),
        status: '下書き作成済み',
        warningMessage:
          'F列「添付照合用氏名」による手動指定で添付ファイルを検出しました。\n' +
          '指定名:\n' + manualNames.join('\n')
      };
    }

    throw new Error(
      'F列「添付照合用氏名」で指定された名前の添付ファイル数が一致しません。\n' +
      '氏名: ' + name + '\n' +
      'F列指定名:\n' + manualNames.join('\n') + '\n' +
      'E列ファイル名フィルター: ' + (fileFilter || '空白') + '\n' +
      '想定: ' + expectedAttachmentCount + '件\n' +
      '検出: ' + manualMatches.length + '件\n\n' +
      '候補:\n' +
      receipt_fileInfoNamesForError_(manualMatches) + '\n\n' +
      'フィルター後の参考候補:\n' +
      receipt_fileInfoNamesForError_(scopedFiles.slice(0, 50))
    );
  }

  const strictKey = receipt_strictNameKey_(name);
  const looseKey = receipt_looseNameKey_(name);

  const strictMatches = receipt_uniqueFileInfos_(
    scopedFiles.filter(fileInfo => fileInfo.strictNameKey === strictKey)
  );

  if (strictMatches.length === expectedAttachmentCount) {
    return {
      files: receipt_sortReceiptFiles_(strictMatches),
      status: '下書き作成済み',
      warningMessage: ''
    };
  }

  const looseMatches = receipt_uniqueFileInfos_(
    scopedFiles.filter(fileInfo => fileInfo.looseNameKey === looseKey)
  );

  if (looseMatches.length === expectedAttachmentCount) {
    const looseStrictNames = receipt_uniqueStrings_(
      looseMatches.map(fileInfo => fileInfo.extractedName)
    );

    if (looseStrictNames.length === 1) {
      return {
        files: receipt_sortReceiptFiles_(looseMatches),
        status: '要確認',
        warningMessage:
          '名前の厳密一致ではなく、ゆるい一致で添付ファイルを検出しました。\n' +
          '必要に応じてF列「添付照合用氏名」に正式なファイル上の氏名を入力してください。\n\n' +
          'B列氏名: ' + name + '\n' +
          'ファイル上の氏名: ' + looseStrictNames[0]
      };
    }

    throw new Error(
      '名前のゆるい一致で複数の氏名候補が見つかりました。\n' +
      '誤添付防止のため、F列「添付照合用氏名」に使用する氏名を入力してください。\n' +
      '複数名を使う場合は、F列に改行で複数入力してください。\n\n' +
      'B列氏名: ' + name + '\n' +
      'E列ファイル名フィルター: ' + (fileFilter || '空白') + '\n' +
      '想定: ' + expectedAttachmentCount + '件\n' +
      '厳密一致: ' + strictMatches.length + '件\n' +
      'ゆるい一致: ' + looseMatches.length + '件\n\n' +
      '氏名候補:\n' +
      looseStrictNames.join('\n') + '\n\n' +
      '候補ファイル:\n' +
      receipt_fileInfoNamesForError_(looseMatches)
    );
  }

  throw new Error(
    '添付ファイル数が一致しません。\n' +
    '照合名: ' + name + '\n' +
    'E列ファイル名フィルター: ' + (fileFilter || '空白') + '\n' +
    '想定: ' + expectedAttachmentCount + '件\n' +
    '厳密一致: ' + strictMatches.length + '件\n' +
    'ゆるい一致: ' + looseMatches.length + '件\n\n' +
    '厳密一致候補:\n' +
    receipt_fileInfoNamesForError_(strictMatches) + '\n\n' +
    'ゆるい一致候補:\n' +
    receipt_fileInfoNamesForError_(looseMatches) + '\n\n' +
    'フィルター後の参考候補:\n' +
    receipt_fileInfoNamesForError_(scopedFiles.slice(0, 50))
  );
}


/**
 * メール本文
 */
function receipt_buildMailBody_(addressee) {
  const eventLabel = receipt_getConfiguredEventLabel_();

  const receiptIntro = eventLabel
    ? `この度は${eventLabel}にご参加いただき、誠にありがとうございました。

電子領収書を発行いたしましたので、添付にてお送りいたします。`
    : `ご依頼の領収書につきまして、別添のとおり送付いたします。`;

  return `${addressee}

平素よりお世話になっております。
ジャパンオープンポーカーツアー株式会社カスタマーサポートのショウです。

${receiptIntro}
なお、電子チケットおよび選手契約履行によるエントリーにつきましては、領収書の発行対象外となっております。

ご不明点やご質問などがございましたら、本メールへのご返信にてお気軽にお問い合わせください。
今後ともどうぞよろしくお願いいたします。`;
}

/**
 * 宛名作成
 */
function receipt_buildAddressee_(addresseeRaw, name) {
  const value = String(addresseeRaw || '').trim();

  if (value) {
    return value.endsWith('様') ? value : value + ' 様';
  }

  return String(name || '').trim() + ' 様';
}


/**
 * 複数のDriveフォルダを取得
 */
function receipt_getReceiptFolders_() {
  const urls = receipt_getConfiguredFolderUrls_();

  if (!urls.length) {
    throw new Error('DriveフォルダURLが設定されていません');
  }

  return urls.map(url => {
    const folderId = receipt_extractDriveFolderId_(url);

    if (!folderId) {
      throw new Error('DriveフォルダIDを取得できません: ' + url);
    }

    return DriveApp.getFolderById(folderId);
  });
}

function receipt_getConfiguredEventLabel_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settingsSheet = ss.getSheetByName(RECEIPT_MAIL_CONFIG.SETTINGS_SHEET_NAME);

  if (settingsSheet && settingsSheet.getLastRow() >= 2) {
    const values = settingsSheet
      .getRange(2, 1, settingsSheet.getLastRow() - 1, 2)
      .getDisplayValues();
    for (const row of values) {
      if (String(row[0] || '').trim() === RECEIPT_MAIL_CONFIG.SETTINGS_EVENT_LABEL_KEY) {
        return String(row[1] || '').trim();
      }
    }
  }

  return String(RECEIPT_MAIL_CONFIG.EVENT_LABEL || '').trim();
}

function receipt_getConfiguredFolderUrls_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settingsSheet = ss.getSheetByName(RECEIPT_MAIL_CONFIG.SETTINGS_SHEET_NAME);

  if (settingsSheet && settingsSheet.getLastRow() >= 2) {
    const values = settingsSheet
      .getRange(2, 1, settingsSheet.getLastRow() - 1, 2)
      .getDisplayValues();

    for (const row of values) {
      if (String(row[0] || '').trim() !== RECEIPT_MAIL_CONFIG.SETTINGS_FOLDER_KEY) continue;
      const urls = String(row[1] || '')
        .split(/\r?\n|,|、/)
        .map(value => value.trim())
        .filter(Boolean);
      if (urls.length) return urls;
    }
  }

  return (RECEIPT_MAIL_CONFIG.RECEIPT_FOLDER_URLS || []).filter(Boolean);
}


/**
 * 複数フォルダから領収書ファイル一覧を作成
 *
 * 注意：
 * - この処理は指定フォルダ直下だけを見ます
 * - 子フォルダの中までは見ません
 */
function receipt_buildReceiptFileListFromFolders_(folders) {
  const list = [];
  const seenFileIds = new Set();

  folders.forEach(folder => {
    const files = folder.getFiles();

    while (files.hasNext()) {
      const file = files.next();

      const fileId = file.getId();

      if (seenFileIds.has(fileId)) {
        continue;
      }

      const fileName = file.getName();
      const normalizedFileNameForCheck = receipt_normalizeForFileCheck_(fileName);
      const mimeType = file.getMimeType();

      const isAllowedFile =
        mimeType === MimeType.PDF ||
        mimeType === MimeType.PNG ||
        mimeType === MimeType.JPEG ||
        normalizedFileNameForCheck.endsWith('.pdf') ||
        normalizedFileNameForCheck.endsWith('.png') ||
        normalizedFileNameForCheck.endsWith('.jpg') ||
        normalizedFileNameForCheck.endsWith('.jpeg');

      if (!isAllowedFile) continue;

      const hasReceipt = receipt_normalizeUnicode_(fileName).includes('領収書');
      const hasSama = receipt_normalizeUnicode_(fileName).includes('様');

      if (!hasReceipt || !hasSama) continue;

      const extractedName = receipt_extractNameFromReceiptFileName_(fileName);

      if (!extractedName) continue;

      seenFileIds.add(fileId);

      list.push({
        file: file,
        fileId: fileId,
        fileName: fileName,
        extractedName: extractedName,
        strictNameKey: receipt_strictNameKey_(extractedName),
        looseNameKey: receipt_looseNameKey_(extractedName)
      });
    }
  });

  list.sort((a, b) => a.fileName.localeCompare(b.fileName, 'ja'));

  Logger.log('領収書ファイル一覧作成完了。対象ファイル数: ' + list.length);
  Logger.log('検索フォルダ数: ' + folders.length);

  return list;
}


/**
 * ファイル名から氏名を抽出
 *
 * 対応例：
 * 【SPADIE Season 41st】 領収書_酒井慎吾 様-1.png
 * 領収書 酒井慎吾 様-1.png
 * 領収書_酒井慎吾 様-1.pdf
 */
function receipt_extractNameFromReceiptFileName_(fileName) {
  const text = receipt_normalizeUnicode_(String(fileName || ''));

  let match = text.match(/領収書[_\s]+(.+?)\s*様\s*-\s*\d+/);
  if (match && match[1]) {
    return receipt_cleanExtractedName_(match[1]);
  }

  match = text.match(/領収書[_\s]+(.+?)\s*様/);
  if (match && match[1]) {
    return receipt_cleanExtractedName_(match[1]);
  }

  return '';
}


/**
 * 抽出名の前にGame IDがある場合だけ除去
 */
function receipt_cleanExtractedName_(text) {
  return receipt_strictNameKey_(
    String(text || '')
      .replace(/^\d{6,}[\s　_\-]+/, '')
  );
}


/**
 * 厳密氏名キー
 *
 * - Unicode正規化：ゴ → ゴ、はづき → はづき
 * - 全角スペース → 半角スペース
 * - 連続スペース → 1個
 * - 前後スペース削除
 * - 中間スペースは残す
 *
 * 黒崎慎 と 黒崎 慎 は別扱い
 */
function receipt_strictNameKey_(text) {
  let s = receipt_normalizeUnicode_(text);

  return String(s || '')
    .replace(/\u3000/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s　]+|[\s　]+$/g, '');
}


/**
 * ゆるい氏名キー
 *
 * - 厳密キーを作った後、全スペース削除
 *
 * 黒崎慎 と 黒崎 慎 は同じキーになる
 * ただし複数候補が出た場合は自動確定せず、F列指定を要求する
 */
function receipt_looseNameKey_(text) {
  return receipt_strictNameKey_(text)
    .replace(/[\s　]+/g, '')
    .trim();
}


/**
 * Unicode正規化
 */
function receipt_normalizeUnicode_(text) {
  let s = String(text || '');

  if (s.normalize) {
    s = s.normalize('NFC');
  }

  return s;
}


/**
 * ファイル判定用
 */
function receipt_normalizeForFileCheck_(text) {
  return receipt_normalizeUnicode_(text)
    .replace(/\s+/g, '')
    .replace(/　+/g, '')
    .trim()
    .toLowerCase();
}


/**
 * E列ファイル名フィルター
 *
 * 空白なら全て通す
 * 複数行ある場合は、どれか1つを含めば通す
 */
/**
 * E列ファイル名フィルター
 *
 * 新ルール：
 *
 * 1. 空白なら全て通す
 *
 * 2. E列が数字だけの場合：
 *    例：4
 *    例：4,5,6
 *    例：4 5 6
 *    例：4
 *        5
 *        6
 *
 *    → ファイル名末尾の「様-番号」で照合する
 *    → 領収書_山田太郎 様-4.png だけ通す
 *
 * 3. E列が「番号:」または「No:」始まりの場合：
 *    例：番号:4,5,6
 *    例：No:4,5,6
 *
 *    → 同じく「様-番号」で照合する
 *
 * 4. それ以外は旧仕様：
 *    ファイル名にその文字列を含むものだけ通す
 */
function receipt_fileNameMatchesFilter_(fileName, filterText) {
  const raw = String(filterText || '').trim();

  if (!raw) {
    return true;
  }

  const numberFilter = receipt_parseReceiptNumberFilter_(raw);

  if (numberFilter.enabled) {
    const receiptNo = receipt_extractReceiptNumberFromFileName_(fileName);

    if (!receiptNo) {
      return false;
    }

    return numberFilter.numbers.indexOf(receiptNo) >= 0;
  }

  const fileNameN = receipt_normalizeUnicode_(fileName);

  const filters = raw
    .split(/\r?\n|,|、|，|;|；|\|/)
    .map(v => receipt_normalizeUnicode_(v).trim())
    .filter(Boolean);

  if (!filters.length) {
    return true;
  }

  return filters.some(filter => fileNameN.indexOf(filter) >= 0);
}


/**
 * E列から領収書番号フィルターを解析
 *
 * 対応：
 * 4
 * 4,5,6
 * 4 5 6
 * 4
 * 5
 * 6
 * 番号:4,5,6
 * No:4,5,6
 * no：4、5、6
 */
function receipt_parseReceiptNumberFilter_(text) {
  let raw = String(text || '').trim();

  if (!raw) {
    return {
      enabled: false,
      numbers: []
    };
  }

  raw = receipt_normalizeUnicode_(raw)
    .replace(/^番号\s*[:：]\s*/i, '')
    .replace(/^no\.?\s*[:：]\s*/i, '')
    .replace(/^receipt\s*no\.?\s*[:：]\s*/i, '')
    .trim();

  const tokens = raw
    .split(/\r?\n|,|、|，|;|；|\||\s+/)
    .map(v => String(v || '').trim())
    .filter(Boolean);

  if (!tokens.length) {
    return {
      enabled: false,
      numbers: []
    };
  }

  const allNumeric = tokens.every(v => /^\d+$/.test(v));

  if (!allNumeric) {
    return {
      enabled: false,
      numbers: []
    };
  }

  const numbers = receipt_uniqueStrings_(
    tokens.map(v => String(Number(v)))
  );

  return {
    enabled: numbers.length > 0,
    numbers: numbers
  };
}


/**
 * ファイル名から「様-番号」の番号だけ抽出
 *
 * 対応例：
 * 【SPADIE Season 41st】 領収書_山田太郎 様-4.png
 * 領収書_山田太郎 様 - 4.pdf
 */
function receipt_extractReceiptNumberFromFileName_(fileName) {
  const text = receipt_normalizeUnicode_(String(fileName || ''));

  const match = text.match(/様\s*-\s*(\d+)/);

  if (!match || !match[1]) {
    return '';
  }

  return String(Number(match[1]));
}


/**
 * F列 添付照合用氏名
 *
 * 改行、読点、カンマ、セミコロン、縦棒区切りに対応
 */
function receipt_parseMatchNames_(text) {
  return String(text || '')
    .split(/\r?\n|,|、|，|;|；|\|/)
    .map(v => receipt_strictNameKey_(v))
    .filter(Boolean);
}


/**
 * FileInfo配列の重複除去
 */
function receipt_uniqueFileInfos_(items) {
  const seen = new Set();
  const result = [];

  items.forEach(item => {
    if (!item || !item.fileId) return;

    if (seen.has(item.fileId)) return;

    seen.add(item.fileId);
    result.push(item);
  });

  return result;
}


/**
 * 文字列配列の重複除去
 */
function receipt_uniqueStrings_(values) {
  const seen = new Set();
  const result = [];

  values.forEach(value => {
    const key = receipt_strictNameKey_(value);
    if (!key) return;

    if (seen.has(key)) return;

    seen.add(key);
    result.push(key);
  });

  return result;
}


/**
 * 領収書ファイル並び順
 */
function receipt_sortReceiptFiles_(files) {
  return files.slice().sort((a, b) => a.fileName.localeCompare(b.fileName, 'ja'));
}


/**
 * エラー表示用ファイル名一覧
 */
function receipt_fileInfoNamesForError_(files) {
  if (!files || !files.length) {
    return '';
  }

  return receipt_uniqueFileInfos_(files)
    .map(fileInfo => fileInfo.fileName)
    .join('\n');
}


/**
 * メールアドレス簡易チェック
 */
function receipt_validateEmail_(email) {
  const value = String(email || '').trim();

  if (!value) throw new Error('メールアドレスが空です');

  if (value.includes(' ') || value.includes('　')) {
    throw new Error('メールアドレスに空白があります: ' + value);
  }

  if (value.includes('＠')) {
    throw new Error('メールアドレスに全角＠があります: ' + value);
  }

  const simplePattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!simplePattern.test(value)) {
    throw new Error('メール形式不正: ' + value);
  }

  const localPart = value.split('@')[0];
  const domainPart = value.split('@')[1];

  if (localPart.endsWith('.')) {
    throw new Error('@の直前に「.」があります: ' + value);
  }

  if (domainPart.endsWith('.')) {
    throw new Error('ドメイン末尾が「.」です: ' + value);
  }
}


/**
 * 対象シート取得
 */
function receipt_getTargetSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  for (const name of RECEIPT_MAIL_CONFIG.SHEET_NAMES) {
    const sheet = ss.getSheetByName(name);
    if (sheet) return sheet;
  }
  throw new Error('対象シートが見つかりません: ' + RECEIPT_MAIL_CONFIG.SHEET_NAMES.join(' / '));
}


/**
 * Google DriveフォルダURLからID抽出
 */
function receipt_extractDriveFolderId_(url) {
  if (!url) return '';

  let match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) return match[1];

  match = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match && match[1]) return match[1];

  if (/^[a-zA-Z0-9_-]{20,}$/.test(url)) return url;

  return '';
}


/**
 * D列 件数取得
 */
function receipt_getAttachmentCount_(sheet, row) {
  const raw = sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_ATTACHMENT_COUNT).getValue();

  if (raw === '' || raw === null) return 0;

  const count = Number(raw);

  if (!Number.isFinite(count)) return 0;
  if (count <= 0) return 0;

  return Math.floor(count);
}


/**
 * 結果列クリア
 */
function receipt_clearDraftResultColumns_(sheet, row) {
  sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_DRAFT_STATUS).clearContent();
  sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_ERROR).clearContent();
  sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_ATTACHMENT_NAMES).clearContent();
  sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_DRAFT_ID).clearContent();
  sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_SEND_STATUS).clearContent();
  sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_SENT_AT).clearContent();
}


/**
 * ヘッダー作成
 */
function receipt_setupHeaders_(sheet) {
  sheet.getRange(1, RECEIPT_MAIL_CONFIG.COL_FILE_FILTER).setValue('ファイル名フィルター');
  sheet.getRange(1, RECEIPT_MAIL_CONFIG.COL_MATCH_NAME).setValue('添付照合用氏名');
  sheet.getRange(1, RECEIPT_MAIL_CONFIG.COL_DRAFT_STATUS).setValue('下書きステータス');
  sheet.getRange(1, RECEIPT_MAIL_CONFIG.COL_ERROR).setValue('エラー');
  sheet.getRange(1, RECEIPT_MAIL_CONFIG.COL_ATTACHMENT_NAMES).setValue('添付ファイル名一覧');
  sheet.getRange(1, RECEIPT_MAIL_CONFIG.COL_DRAFT_ID).setValue('Draft ID');
  sheet.getRange(1, RECEIPT_MAIL_CONFIG.COL_SEND_OK).setValue('送信OK');
  sheet.getRange(1, RECEIPT_MAIL_CONFIG.COL_SEND_STATUS).setValue('送信ステータス');
  sheet.getRange(1, RECEIPT_MAIL_CONFIG.COL_SENT_AT).setValue('送信日時');
}


function receipt_showToast_(message, title) {
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(message, title || '領収書メール', 5);
  } catch (e) {
    Logger.log(message);
  }
}

function receipt_showResult_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    Logger.log(message);
  }
}


/**
 * 同一氏名の重複チェック用Set作成
 *
 * 同じ氏名が複数行にある場合は、下書き作成時にエラーにする。
 * ここでは厳密キーだけを見る。
 * 黒崎慎 と 黒崎 慎 は別扱い。
 */
function receipt_buildDuplicateNameSet_(sheet, startRow, endRow) {
  const nameCounts = {};

  for (let row = startRow; row <= endRow; row++) {
    const name = receipt_strictNameKey_(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_NAME).getValue());

    if (!name) continue;

    if (!nameCounts[name]) {
      nameCounts[name] = 0;
    }

    nameCounts[name]++;
  }

  const duplicateSet = new Set();

  Object.keys(nameCounts).forEach(name => {
    if (nameCounts[name] >= 2) {
      duplicateSet.add(name);
    }
  });

  if (duplicateSet.size > 0) {
    Logger.log('同一氏名重複あり: ' + Array.from(duplicateSet).join(', '));
  }

  return duplicateSet;
}
