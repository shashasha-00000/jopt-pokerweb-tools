/*******************************************************
 * ReceiptFormPwUnifiedFlow.gs
 *
 * フォーム回答 + PW TSV から、行番号を手で変えずに
 * 1. トナメ抜き出しへ追加
 * 2. 追加した行だけからメール送信一覧を追加生成
 *
 * 対象シート:
 * - フォームの回答 1
 * - PW TSVショウ用
 * - トナメ抜き出し
 * - メール送信一覧
 *
 * 既存行は削除しない。出力は末尾追加。
 *******************************************************/

const RFP_CONFIG = {
  FORM_SHEET_NAME: 'フォームの回答 1',
  PW_SHEET_NAME: 'PW TSVショウ用',
  NUKIDASHI_SHEET_NAME: 'トナメ抜き出し',
  MAIL_SHEET_NAME: 'メール送信一覧',
  CHECK_SHEET_NAME: '領収書_FLOW_CHECK',
  MANUAL_FIX_SHEET_NAME: '領収書_FLOW手動補完',
  RUN_LOG_SHEET_NAME: '領収書_FLOW_RUN_LOG',

  PW_HEADER_ROW: 1,
  PW_START_ROW: 2,
  FORM_HEADER_ROW: 1,
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

  MAIL_OUTPUT_COL_COUNT: 14,

  FORM_HEADERS: {
    gameId: ['Game ID', 'GameID', 'ゲームID'],
    name: ['本名(フルネーム)', '本名', '名前', '氏名'],
    email: ['受け取り用メールアドレス', 'メールアドレス', 'Email', 'メール'],
    receiptName: ['宛名', '領収書の宛名']
  },

  PW_HEADERS: {
    gameId: ['Game ID', 'GameID'],
    purchaseTime: ['購入時間'],
    year: ['年'],
    month: ['月'],
    day: ['日', '日付'],
    tournament: ['大会名', 'トーナメント', 'トーナメント名'],
    type: ['種別'],
    cash: ['現金'],
    creditCard: ['クレジットカード'],
    points: ['ポイント'],
    usdt: ['USDT']
  },

  CHECK_HEADERS: ['区分', 'Game ID', '氏名', '内容'],
  MANUAL_FIX_HEADERS: [
    'PW Game ID',
    'PW大会名',
    'PW日付',
    'PW金額',
    '候補Game ID',
    '候補氏名',
    '候補メール',
    '手入力氏名',
    '手入力メール',
    '手入力宛名',
    'メモ'
  ],
  RUN_LOG_HEADERS: ['日時', 'runKey', 'トナメ開始行', 'トナメ行数', 'メール開始行', 'メール行数']
};

function onOpen() {
  RFP_addMenu_();
}

function RFP_addMenu_() {
  SpreadsheetApp.getUi()
    .createMenu('領収書フォームPW')
    .addItem('PW TSVの消し込み行を削除', 'deleteKeshikomiRowsFromPwTsv')
    .addSeparator()
    .addItem('1. PW TSV→トナメ抜き出し チェック', 'previewReceiptFormPwNukidashi')
    .addItem('1. PW TSV→トナメ抜き出し 実行', 'runReceiptFormPwNukidashi')
    .addSeparator()
    .addItem('2. 最新トナメ行→メール送信一覧', 'buildReceiptMailListFromLatestNukidashi')
    .addSeparator()
    .addItem('3. Gmail下書き作成', 'createReceiptDraftsAllRows')
    .addItem('3. エラー行を再下書き', 'retryReceiptErrorRows')
    .addItem('3. OK下書きを送信', 'sendApprovedReceiptDraftsAllRows')
    .addSeparator()
    .addItem('前回生成分をクリア', 'clearLatestReceiptFormPwGeneratedRows')
    .addItem('選択トナメ行の入力列をクリア', 'clearSelectedReceiptFormPwNukidashiRows')
    .addItem('選択トナメ行を削除', 'deleteSelectedReceiptFormPwNukidashiRows')
    .addSeparator()
    .addItem('CHECKを開く', 'openReceiptFormPwCheck')
    .addItem('手動補完を開く', 'openReceiptFormPwManualFix')
    .addToUi();
}

function previewReceiptFormPwNukidashi() {
  RFP_runNukidashiOnly_(true);
}

function runReceiptFormPwNukidashi() {
  RFP_runNukidashiOnly_(false);
}

function previewReceiptFormPwFlow() {
  RFP_runFlow_(true);
}

function runReceiptFormPwFlow() {
  RFP_runFlow_(false);
}

function deleteKeshikomiRowsFromPwTsv() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const pwSheet = RFP_requiredSheet_(ss, RFP_CONFIG.PW_SHEET_NAME);
  const deleted = RFP_deletePwRowsByTournamentKeyword_(pwSheet);
  RFP_alert_('PW TSVショウ用 の「消し込み」行を削除しました: ' + deleted + '行');
}

function RFP_runNukidashiOnly_(previewOnly) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const formSheet = RFP_requiredSheet_(ss, RFP_CONFIG.FORM_SHEET_NAME);
    const pwSheet = RFP_requiredSheet_(ss, RFP_CONFIG.PW_SHEET_NAME);
    const nukidashiSheet = RFP_requiredSheet_(ss, RFP_CONFIG.NUKIDASHI_SHEET_NAME);

    RFP_ensureOwnedSheet_(ss, RFP_CONFIG.CHECK_SHEET_NAME, RFP_CONFIG.CHECK_HEADERS);
    RFP_ensureOwnedSheet_(ss, RFP_CONFIG.MANUAL_FIX_SHEET_NAME, RFP_CONFIG.MANUAL_FIX_HEADERS);
    RFP_ensureOwnedSheet_(ss, RFP_CONFIG.RUN_LOG_SHEET_NAME, RFP_CONFIG.RUN_LOG_HEADERS);

    const checkRows = [];
    const manualFixResult = RFP_readManualFixMap_(ss);
    const manualRows = [];
    const mergedRows = RFP_buildMergedRowsFromInputs_(
      formSheet,
      pwSheet,
      nukidashiSheet,
      checkRows,
      manualFixResult.map,
      manualRows
    );
    RFP_writeManualFixSheet_(ss, manualRows, manualFixResult.byGameId);

    if (!mergedRows.length) {
      RFP_writeCheck_(ss, checkRows);
      throw new Error('追加できる一致データがありません。CHECKを確認してください。');
    }

    const runKey = RFP_buildRunKey_(mergedRows);
    RFP_assertRunNotProcessed_(ss, runKey);

    const nukidashiTargets = RFP_buildNukidashiTargets_(nukidashiSheet, mergedRows, checkRows);
    const nukidashiAppend = RFP_prepareNukidashiAppend_(nukidashiSheet, nukidashiTargets.appends);

    RFP_writeCheck_(ss, checkRows);

    if (previewOnly) {
      RFP_alert_(
        '1. トナメ抜き出し生成前チェック完了。表への追加はしていません。\n\n' +
        '既存行更新予定: ' + nukidashiTargets.updates.length + '行\n' +
        '追加予定: ' + nukidashiTargets.appends.length + '行' +
          (nukidashiTargets.appends.length ? '（' + nukidashiAppend.startRow + '行目から）' : '') + '\n' +
        'CHECK: ' + checkRows.length + '件'
      );
      return;
    }

    RFP_commitNukidashiUpdates_(nukidashiSheet, nukidashiTargets.updates);
    RFP_commitNukidashiAppend_(nukidashiAppend);
    const writtenRows = RFP_buildWrittenNukidashiRows_(nukidashiTargets, nukidashiAppend);
    RFP_clearDuplicateGameIdsInWrittenRows_(nukidashiSheet, writtenRows);
    SpreadsheetApp.flush();

    PropertiesService.getDocumentProperties().setProperties({
      RFP_LAST_NUKIDASHI_ROWS: writtenRows.map(row => row.rowNo).join(','),
      RFP_LAST_NUKIDASHI_UPDATE_ROWS: nukidashiTargets.updates.map(row => row.rowNo).join(','),
      RFP_LAST_NUKIDASHI_APPEND_START_ROW: nukidashiTargets.appends.length ? String(nukidashiAppend.startRow) : '',
      RFP_LAST_NUKIDASHI_APPEND_ROW_COUNT: String(nukidashiTargets.appends.length),
      RFP_LAST_NUKIDASHI_ROW_COUNT: String(writtenRows.length),
      RFP_LAST_RUN_KEY: runKey
    });

    RFP_writeRunLog_(ss, [
      new Date(),
      runKey,
      writtenRows.map(row => row.rowNo).join(','),
      writtenRows.length,
      '',
      ''
    ]);

    RFP_alert_(
      '1. トナメ抜き出し生成完了\n\n' +
      '既存行更新: ' + nukidashiTargets.updates.length + '行\n' +
      '追加: ' + nukidashiTargets.appends.length + '行' +
        (nukidashiTargets.appends.length ? '（' + nukidashiAppend.startRow + '行目から）' : '') + '\n' +
      '次に「2. 最新トナメ行→メール送信一覧」を実行してください。'
    );
  } finally {
    lock.releaseLock();
  }
}

function buildReceiptMailListFromLatestNukidashi() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const nukidashiSheet = RFP_requiredSheet_(ss, RFP_CONFIG.NUKIDASHI_SHEET_NAME);
    const mailSheet = RFP_requiredSheet_(ss, RFP_CONFIG.MAIL_SHEET_NAME);
    const props = PropertiesService.getDocumentProperties();
    const rowNumbers = RFP_parseRowNumbers_(props.getProperty('RFP_LAST_NUKIDASHI_ROWS'));

    if (!rowNumbers.length) {
      throw new Error('最新のトナメ抜き出し行が記録されていません。先に「1. PW TSV→トナメ抜き出し 実行」を実行してください。');
    }

    const mailRows = RFP_buildMailRowsFromNukidashiRowNumbers_(nukidashiSheet, rowNumbers);
    if (!mailRows.length) {
      throw new Error('メール送信一覧に追加できる行がありません。トナメ抜き出しの氏名・画像タイトルBを確認してください。');
    }

    const mailAppend = RFP_prepareAppend_(mailSheet, mailRows, RFP_CONFIG.MAIL_OUTPUT_COL_COUNT);
    RFP_commitAppend_(mailAppend);

    props.setProperties({
      RFP_LAST_MAIL_START_ROW: String(mailAppend.startRow),
      RFP_LAST_MAIL_ROW_COUNT: String(mailRows.length)
    });

    RFP_alert_(
      '2. メール送信一覧生成完了\n\n' +
      '追加: ' + mailRows.length + '行（' + mailAppend.startRow + '行目から）\n' +
      '次に「3. Gmail下書き作成」を実行してください。'
    );
  } finally {
    lock.releaseLock();
  }
}

function RFP_runFlow_(previewOnly) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const formSheet = RFP_requiredSheet_(ss, RFP_CONFIG.FORM_SHEET_NAME);
    const pwSheet = RFP_requiredSheet_(ss, RFP_CONFIG.PW_SHEET_NAME);
    const nukidashiSheet = RFP_requiredSheet_(ss, RFP_CONFIG.NUKIDASHI_SHEET_NAME);
    const mailSheet = RFP_requiredSheet_(ss, RFP_CONFIG.MAIL_SHEET_NAME);

    RFP_ensureOwnedSheet_(ss, RFP_CONFIG.CHECK_SHEET_NAME, RFP_CONFIG.CHECK_HEADERS);
    RFP_ensureOwnedSheet_(ss, RFP_CONFIG.RUN_LOG_SHEET_NAME, RFP_CONFIG.RUN_LOG_HEADERS);

    const checkRows = [];
    const formResult = RFP_readFormMap_(formSheet, checkRows);
    const pwRows = RFP_readPwRows_(pwSheet, checkRows);
    const existingNukidashiMap = RFP_readNukidashiIdentityMap_(nukidashiSheet);

    if (!pwRows.length) {
      throw new Error('PW TSVショウ用 に処理対象データがありません。');
    }

    const mergedRows = [];
    const pwGameIds = new Set();

    pwRows.forEach(pw => {
      pwGameIds.add(pw.gameIdKey);
      const form = existingNukidashiMap[pw.gameIdKey] || formResult.map[pw.gameIdKey];

      if (!form) {
        checkRows.push(['PWのみ', pw.gameId, '', 'トナメ抜き出し既存行・フォーム回答のどちらにも対応するGame IDがありません。追加しません']);
        return;
      }

      if (!form.email) {
        checkRows.push(['メール確認', form.gameId, form.name, 'メールアドレスが空白です']);
      }

      mergedRows.push({
        gameId: pw.gameId,
        name: form.name,
        email: form.email,
        receiptName: form.receiptName,
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
    });

    Object.keys(formResult.map).forEach(gameIdKey => {
      if (!pwGameIds.has(gameIdKey) && !existingNukidashiMap[gameIdKey]) {
        const form = formResult.map[gameIdKey];
        checkRows.push(['フォームのみ', form.gameId, form.name, 'PW TSVに対応するGame IDがありません']);
      }
    });

    if (!mergedRows.length) {
      RFP_writeCheck_(ss, checkRows);
      throw new Error('追加できる一致データがありません。CHECKを確認してください。');
    }

    const runKey = RFP_buildRunKey_(mergedRows);
    RFP_assertRunNotProcessed_(ss, runKey);

    const nukidashiTargets = RFP_buildNukidashiTargets_(nukidashiSheet, mergedRows, checkRows);
    const nukidashiAppend = RFP_prepareNukidashiAppend_(nukidashiSheet, nukidashiTargets.appends);
    const mailRows = RFP_buildMailRowsFromMerged_(mergedRows);
    const mailAppend = RFP_prepareAppend_(mailSheet, mailRows, RFP_CONFIG.MAIL_OUTPUT_COL_COUNT);

    RFP_writeCheck_(ss, checkRows);

    if (previewOnly) {
      RFP_alert_(
        '生成前チェック完了。表への追加はしていません。\n\n' +
        'PW対象行: ' + pwRows.length + '\n' +
        'トナメ抜き出し既存行更新予定: ' + nukidashiTargets.updates.length + '行\n' +
        'トナメ抜き出し追加予定: ' + nukidashiTargets.appends.length + '行' +
          (nukidashiTargets.appends.length ? '（' + nukidashiAppend.startRow + '行目から）' : '') + '\n' +
        'メール送信一覧予定: ' + mailRows.length + '行（' + mailAppend.startRow + '行目から）\n' +
        'CHECK: ' + checkRows.length + '件'
      );
      return;
    }

    RFP_commitNukidashiUpdates_(nukidashiSheet, nukidashiTargets.updates);
    RFP_commitNukidashiAppend_(nukidashiAppend);
    const writtenRows = RFP_buildWrittenNukidashiRows_(nukidashiTargets, nukidashiAppend);
    RFP_clearDuplicateGameIdsInWrittenRows_(nukidashiSheet, writtenRows);
    SpreadsheetApp.flush();

    const finalMailRows = RFP_buildMailRowsFromNukidashiRows_(nukidashiSheet, writtenRows);
    mailAppend.rows = finalMailRows;

    RFP_commitAppend_(mailAppend);

    RFP_writeRunLog_(ss, [
      new Date(),
      runKey,
      writtenRows.map(row => row.rowNo).join(','),
      writtenRows.length,
      mailAppend.startRow,
      finalMailRows.length
    ]);
    PropertiesService.getDocumentProperties().setProperties({
      RFP_LAST_NUKIDASHI_ROWS: writtenRows.map(row => row.rowNo).join(','),
      RFP_LAST_NUKIDASHI_UPDATE_ROWS: nukidashiTargets.updates.map(row => row.rowNo).join(','),
      RFP_LAST_NUKIDASHI_APPEND_START_ROW: nukidashiTargets.appends.length ? String(nukidashiAppend.startRow) : '',
      RFP_LAST_NUKIDASHI_APPEND_ROW_COUNT: String(nukidashiTargets.appends.length),
      RFP_LAST_NUKIDASHI_ROW_COUNT: String(writtenRows.length),
      RFP_LAST_MAIL_START_ROW: String(mailAppend.startRow),
      RFP_LAST_MAIL_ROW_COUNT: String(finalMailRows.length),
      RFP_LAST_RUN_KEY: runKey
    });

    RFP_alert_(
      '生成完了\n\n' +
      'トナメ抜き出し既存行更新: ' + nukidashiTargets.updates.length + '行\n' +
      'トナメ抜き出し追加: ' + nukidashiTargets.appends.length + '行' +
        (nukidashiTargets.appends.length ? '（' + nukidashiAppend.startRow + '行目から）' : '') + '\n' +
      'メール送信一覧追加: ' + finalMailRows.length + '行（' + mailAppend.startRow + '行目から）\n' +
      'CHECK: ' + checkRows.length + '件'
    );
  } finally {
    lock.releaseLock();
  }
}

function RFP_buildMergedRowsFromInputs_(formSheet, pwSheet, nukidashiSheet, checkRows, manualFixMap, manualRows) {
  const formResult = RFP_readFormMap_(formSheet, checkRows);
  const pwRows = RFP_readPwRows_(pwSheet, checkRows);
  const existingNukidashiMap = RFP_readNukidashiIdentityMap_(nukidashiSheet);

  if (!pwRows.length) {
    throw new Error('PW TSVショウ用 に処理対象データがありません。');
  }

  const mergedRows = [];
  const pwGameIds = new Set();

  pwRows.forEach(pw => {
    pwGameIds.add(pw.gameIdKey);
    const manualFix = manualFixMap && manualFixMap[pw.gameIdKey];
    const existing = existingNukidashiMap[pw.gameIdKey];
    const formAnswer = formResult.map[pw.gameIdKey];
    const form = RFP_mergeIdentity_(pw.gameId, existing, formAnswer);
    const identity = manualFix || form;

    if (!identity) {
      const candidates = RFP_findFormCandidates_(pw.gameIdKey, formResult.items);
      if (manualRows) {
        RFP_addManualFixRows_(manualRows, pw, candidates);
      }
      checkRows.push([
        'PWのみ',
        pw.gameId,
        '',
        '対応するGame IDがありません。手動補完に候補を出しました: ' + RFP_formatCandidates_(candidates)
      ]);
      return;
    }

    if (!identity.email) {
      checkRows.push(['メール確認', identity.gameId, identity.name, 'メールアドレスが空白です']);
    }

    mergedRows.push({
      gameId: pw.gameId,
      name: identity.name,
      email: identity.email,
      receiptName: identity.receiptName,
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
  });

  Object.keys(formResult.map).forEach(gameIdKey => {
    if (!pwGameIds.has(gameIdKey) && !existingNukidashiMap[gameIdKey]) {
      const form = formResult.map[gameIdKey];
      checkRows.push(['フォームのみ', form.gameId, form.name, 'PW TSVに対応するGame IDがありません']);
    }
  });

  return mergedRows;
}

function RFP_mergeIdentity_(gameId, existing, formAnswer) {
  if (!existing && !formAnswer) return null;

  return {
    rowNo: existing ? existing.rowNo : (formAnswer ? formAnswer.rowNo : ''),
    gameId: RFP_text_(gameId || (existing && existing.gameId) || (formAnswer && formAnswer.gameId)),
    name: RFP_firstDisplayText_(formAnswer && formAnswer.name, existing && existing.name),
    email: RFP_text_((formAnswer && formAnswer.email) || (existing && existing.email)),
    receiptName: RFP_firstDisplayText_(formAnswer && formAnswer.receiptName, existing && existing.receiptName)
  };
}

function RFP_readManualFixMap_(ss) {
  const sheet = RFP_ensureOwnedSheet_(ss, RFP_CONFIG.MANUAL_FIX_SHEET_NAME, RFP_CONFIG.MANUAL_FIX_HEADERS);
  const values = sheet.getDataRange().getValues();
  const map = {};
  const byGameId = {};

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const gameId = row[0];
    const key = RFP_normalizeGameId_(gameId);
    if (!key) continue;

    const manual = {
      gameId: RFP_text_(gameId),
      name: RFP_displayText_(row[7]),
      email: RFP_text_(row[8]),
      receiptName: RFP_displayText_(row[9])
    };
    byGameId[key] = manual;

    if (RFP_text_(manual.name) || manual.email) {
      map[key] = manual;
    }
  }

  return { map: map, byGameId: byGameId };
}

function RFP_writeManualFixSheet_(ss, rows, existingManualByGameId) {
  const sheet = RFP_ensureOwnedSheet_(ss, RFP_CONFIG.MANUAL_FIX_SHEET_NAME, RFP_CONFIG.MANUAL_FIX_HEADERS);
  const width = RFP_CONFIG.MANUAL_FIX_HEADERS.length;
  if (sheet.getLastRow() >= 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, width).clearContent();
  }
  if (!rows.length) return;

  const output = rows.map(row => {
    const key = RFP_normalizeGameId_(row[0]);
    const manual = existingManualByGameId[key] || {};
    const copy = row.slice();
    copy[7] = manual.name || '';
    copy[8] = manual.email || '';
    copy[9] = manual.receiptName || '';
    return copy;
  });
  sheet.getRange(2, 1, output.length, width).setValues(output);
}

function RFP_addManualFixRows_(manualRows, pw, candidates) {
  const rows = candidates.length ? candidates : [null];
  rows.forEach(candidate => {
    manualRows.push([
      pw.gameId,
      pw.tournament,
      [pw.year, pw.month, pw.day].filter(value => RFP_text_(value)).join('/'),
      RFP_receiptAmount_(pw),
      candidate ? candidate.gameId : '',
      candidate ? candidate.name : '',
      candidate ? candidate.email : '',
      '',
      '',
      '',
      candidate ? '候補Game IDとの差: ' + candidate.distance : '候補なし'
    ]);
  });
}

function RFP_findFormCandidates_(gameIdKey, formItems) {
  if (!gameIdKey || !formItems || !formItems.length) return [];
  return formItems
    .map(item => {
      const candidateKey = RFP_normalizeGameId_(item.gameId);
      return Object.assign({}, item, {
        distance: RFP_editDistance_(gameIdKey, candidateKey),
        gameIdKey: candidateKey
      });
    })
    .filter(item => {
      if (!item.gameIdKey) return false;
      if (item.distance <= 2) return true;
      if (gameIdKey.length >= 6 && item.gameIdKey.length >= 6 && gameIdKey.slice(0, 6) === item.gameIdKey.slice(0, 6)) return true;
      if (gameIdKey.length >= 4 && item.gameIdKey.length >= 4 && gameIdKey.slice(-4) === item.gameIdKey.slice(-4)) return true;
      return false;
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);
}

function RFP_formatCandidates_(candidates) {
  if (!candidates.length) return '候補なし';
  return candidates.map(item => item.gameId + ' / ' + item.name + ' / ' + item.email).join(' | ');
}

function RFP_editDistance_(a, b) {
  a = RFP_text_(a);
  b = RFP_text_(b);
  const dp = Array(a.length + 1).fill(null).map(() => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[a.length][b.length];
}

function RFP_receiptAmount_(row) {
  return RFP_money_(row.cash) + RFP_money_(row.creditCard) + RFP_money_(row.points) + RFP_money_(row.usdt);
}

function RFP_readFormMap_(formSheet, checkRows) {
  const values = formSheet.getDataRange().getValues();
  if (values.length < 2) return { map: {} };

  const headers = values[0].map(RFP_text_);
  const col = {
    gameId: RFP_findHeader_(headers, RFP_CONFIG.FORM_HEADERS.gameId),
    name: RFP_findHeader_(headers, RFP_CONFIG.FORM_HEADERS.name),
    email: RFP_findHeader_(headers, RFP_CONFIG.FORM_HEADERS.email),
    receiptName: RFP_findHeader_(headers, RFP_CONFIG.FORM_HEADERS.receiptName)
  };

  RFP_assertColumn_(col.gameId, RFP_CONFIG.FORM_SHEET_NAME, 'Game ID');
  RFP_assertColumn_(col.name, RFP_CONFIG.FORM_SHEET_NAME, '氏名');
  RFP_assertColumn_(col.email, RFP_CONFIG.FORM_SHEET_NAME, 'メールアドレス');
  RFP_assertColumn_(col.receiptName, RFP_CONFIG.FORM_SHEET_NAME, '宛名');

  const map = {};
  const items = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const gameId = row[col.gameId];
    const key = RFP_normalizeGameId_(gameId);
    if (!key) continue;

    const item = {
      rowNo: r + 1,
      gameId: RFP_text_(gameId),
      name: RFP_displayText_(row[col.name]),
      email: RFP_text_(row[col.email]),
      receiptName: RFP_displayText_(row[col.receiptName])
    };

    if (map[key]) {
      checkRows.push(['重複フォーム', item.gameId, item.name, '同じGame IDがフォーム回答に複数あります。後の回答を使用します']);
    }

    map[key] = item;
    items.push(item);
  }

  return { map: map, items: items };
}

function RFP_readPwRows_(pwSheet, checkRows) {
  const lastRow = pwSheet.getLastRow();
  const lastCol = pwSheet.getLastColumn();
  if (lastRow < RFP_CONFIG.PW_START_ROW) return [];

  const headers = pwSheet.getRange(RFP_CONFIG.PW_HEADER_ROW, 1, 1, lastCol).getValues()[0].map(RFP_text_);
  const col = {
    gameId: RFP_findHeader_(headers, RFP_CONFIG.PW_HEADERS.gameId),
    purchaseTime: RFP_findHeader_(headers, RFP_CONFIG.PW_HEADERS.purchaseTime),
    year: RFP_findHeader_(headers, RFP_CONFIG.PW_HEADERS.year),
    month: RFP_findHeader_(headers, RFP_CONFIG.PW_HEADERS.month),
    day: RFP_findHeader_(headers, RFP_CONFIG.PW_HEADERS.day),
    tournament: RFP_findHeader_(headers, RFP_CONFIG.PW_HEADERS.tournament),
    type: RFP_findHeader_(headers, RFP_CONFIG.PW_HEADERS.type),
    cash: RFP_findHeader_(headers, RFP_CONFIG.PW_HEADERS.cash),
    creditCard: RFP_findHeader_(headers, RFP_CONFIG.PW_HEADERS.creditCard),
    points: RFP_findHeader_(headers, RFP_CONFIG.PW_HEADERS.points),
    usdt: RFP_findHeader_(headers, RFP_CONFIG.PW_HEADERS.usdt)
  };

  Object.keys(col).forEach(key => {
    if (key !== 'purchaseTime') RFP_assertColumn_(col[key], RFP_CONFIG.PW_SHEET_NAME, key);
  });

  return pwSheet
    .getRange(RFP_CONFIG.PW_START_ROW, 1, lastRow - RFP_CONFIG.PW_START_ROW + 1, lastCol)
    .getValues()
    .map(row => {
      const gameId = row[col.gameId];
      const tournament = row[col.tournament];
      const tournamentText = RFP_text_(tournament);
      const gameIdKey = RFP_normalizeGameId_(gameId);
      const hasRowContent = row.some(value => RFP_text_(value) !== '');
      if (!gameIdKey || !tournamentText) {
        if (hasRowContent && checkRows) {
          checkRows.push([
            'PW除外',
            RFP_text_(gameId),
            '',
            'Game IDまたは大会名が空のため除外しました'
          ]);
        }
        return null;
      }
      if (RFP_isKeshikomiTournament_(tournamentText)) {
        if (checkRows) {
          checkRows.push([
            'PW除外',
            RFP_text_(gameId),
            '',
            '大会名に「消し込み」が含まれるため除外しました: ' + tournamentText
          ]);
        }
        return null;
      }

      return {
        gameId: RFP_text_(gameId),
        gameIdKey: gameIdKey,
        purchaseTime: col.purchaseTime >= 0 ? RFP_text_(row[col.purchaseTime]) : '',
        year: row[col.year],
        month: row[col.month],
        day: row[col.day],
        tournament: tournamentText,
        type: RFP_text_(row[col.type]),
        cash: RFP_money_(row[col.cash]),
        creditCard: RFP_money_(row[col.creditCard]),
        points: RFP_money_(row[col.points]),
        usdt: RFP_money_(row[col.usdt])
      };
    })
    .filter(Boolean);
}

function RFP_isKeshikomiTournament_(tournament) {
  return RFP_text_(tournament).indexOf('消し込み') !== -1;
}

function RFP_deletePwRowsByTournamentKeyword_(pwSheet) {
  const lastRow = pwSheet.getLastRow();
  const lastCol = pwSheet.getLastColumn();
  if (lastRow < RFP_CONFIG.PW_START_ROW) return 0;

  const headers = pwSheet.getRange(RFP_CONFIG.PW_HEADER_ROW, 1, 1, lastCol).getValues()[0].map(RFP_text_);
  const tournamentCol = RFP_findHeader_(headers, RFP_CONFIG.PW_HEADERS.tournament);
  RFP_assertColumn_(tournamentCol, RFP_CONFIG.PW_SHEET_NAME, '大会名');

  const values = pwSheet
    .getRange(RFP_CONFIG.PW_START_ROW, tournamentCol + 1, lastRow - RFP_CONFIG.PW_START_ROW + 1, 1)
    .getValues();

  let deleted = 0;
  for (let index = values.length - 1; index >= 0; index--) {
    if (RFP_isKeshikomiTournament_(values[index][0])) {
      pwSheet.deleteRow(RFP_CONFIG.PW_START_ROW + index);
      deleted++;
    }
  }
  return deleted;
}

function RFP_buildNukidashiTargets_(sheet, mergedRows, checkRows) {
  const placeholders = RFP_findReusableNukidashiRows_(sheet);
  const usedPlaceholderRows = new Set();
  const grouped = new Map();
  const order = [];

  mergedRows.forEach(row => {
    const gameIdKey = RFP_normalizeGameId_(row.gameId);
    if (!grouped.has(gameIdKey)) {
      grouped.set(gameIdKey, []);
      order.push(gameIdKey);
    }
    grouped.get(gameIdKey).push(row);
  });

  const updates = [];
  const appends = [];

  order.forEach(gameIdKey => {
    const rows = grouped.get(gameIdKey);
    const placeholderList = placeholders.get(gameIdKey) || [];
    let activePlaceholder = null;
    let consumedFirst = false;

    rows.forEach((row, index) => {
      const base = Object.assign({}, row, {
        ownerName: row.name,
        ownerEmail: row.email,
        gameIdKey: gameIdKey
      });

      if (index === 0 && placeholderList.length) {
        activePlaceholder = placeholderList.shift();
        usedPlaceholderRows.add(activePlaceholder.rowNo);
        updates.push(Object.assign({}, base, {
          rowNo: activePlaceholder.rowNo,
          writeIdentity: true
        }));
        consumedFirst = true;
        return;
      }

      if (activePlaceholder && activePlaceholder.continuationRows.length) {
        updates.push(Object.assign({}, base, {
          rowNo: activePlaceholder.continuationRows.shift(),
          writeIdentity: true
        }));
        return;
      }

      appends.push(Object.assign({}, base, {
        writeIdentity: true
      }));
    });
  });

  if (usedPlaceholderRows.size) {
    checkRows.push([
      '既存行補完',
      '',
      '',
      'トナメ抜き出しのフォーム占位行を ' + usedPlaceholderRows.size + ' 行使用します'
    ]);
  }

  return {
    updates: updates,
    appends: appends
  };
}

function RFP_findReusableNukidashiRows_(sheet) {
  const c = RFP_CONFIG.NUKIDASHI_COLUMNS;
  const headerRow = RFP_CONFIG.NUKIDASHI_HEADER_ROW;
  const maxRows = sheet.getMaxRows();
  const maxCol = Math.max(c.gameId, c.name, c.email, c.receiptName, c.tournament);
  const values = sheet.getRange(headerRow + 1, 1, maxRows - headerRow, maxCol).getValues();
  const map = new Map();
  const reusable = [];

  values.forEach((row, index) => {
    const rowNo = headerRow + 1 + index;
    const gameId = row[c.gameId - 1];
    const gameIdKey = RFP_normalizeGameId_(gameId);
    if (!gameIdKey) return;

    if (!map.has(gameIdKey)) map.set(gameIdKey, []);
    const item = {
      index: index,
      rowNo: rowNo,
      name: RFP_displayText_(row[c.name - 1]),
      email: RFP_text_(row[c.email - 1]),
      receiptName: RFP_displayText_(row[c.receiptName - 1]),
      continuationRows: []
    };
    reusable.push(item);
    map.get(gameIdKey).push(item);
  });

  reusable.forEach(item => {
    for (let index = item.index + 1; index < values.length; index++) {
      const row = values[index];
      if (RFP_normalizeGameId_(row[c.gameId - 1])) break;
      const hasIdentity =
        RFP_text_(row[c.name - 1]) ||
        RFP_text_(row[c.email - 1]) ||
        RFP_text_(row[c.receiptName - 1]);
      if (hasIdentity) break;
      item.continuationRows.push(headerRow + 1 + index);
    }
    delete item.index;
  });

  return map;
}

function RFP_readNukidashiIdentityMap_(sheet) {
  const reusableRows = RFP_findReusableNukidashiRows_(sheet);
  const map = {};

  reusableRows.forEach((rows, gameIdKey) => {
    if (!rows.length) return;
    const row = rows[0];
    map[gameIdKey] = {
      rowNo: row.rowNo,
      gameId: gameIdKey,
      name: row.name,
      email: row.email,
      receiptName: row.receiptName,
      source: 'トナメ抜き出し'
    };
  });

  return map;
}

function RFP_prepareNukidashiAppend_(sheet, rows) {
  const lastDataRow = RFP_findNukidashiLastDataRow_(sheet);
  const startRow = Math.max(lastDataRow + 1, 2);
  if (rows.length) {
    RFP_ensureRows_(sheet, startRow + rows.length - 1);
    RFP_assertNukidashiKeysEmpty_(sheet, startRow, rows.length);
  }

  return {
    sheet: sheet,
    rows: rows,
    startRow: startRow,
    templateRow: Math.max(lastDataRow, 2),
    columnCount: sheet.getLastColumn()
  };
}

function RFP_commitNukidashiAppend_(prepared) {
  const sheet = prepared.sheet;
  const startRow = prepared.startRow;
  const rowCount = prepared.rows.length;
  if (!rowCount) return;

  if (prepared.templateRow >= 2 && prepared.columnCount > 0) {
    sheet.getRange(prepared.templateRow, 1, 1, prepared.columnCount)
      .copyTo(sheet.getRange(startRow, 1, rowCount, prepared.columnCount), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    RFP_fillMissingFormulas_(sheet, prepared.templateRow, startRow, rowCount, prepared.columnCount);
  }

  RFP_writeNukidashiDataRows_(sheet, startRow, prepared.rows, true);
}

function RFP_commitNukidashiUpdates_(sheet, updates) {
  updates.forEach(row => {
    if (row.writeIdentity) {
      RFP_writeNukidashiIdentityRow_(sheet, row.rowNo, row);
    }
    RFP_writeNukidashiDetailRow_(sheet, row.rowNo, row);
  });
}

function RFP_writeNukidashiDataRows_(sheet, startRow, rows) {
  const c = RFP_CONFIG.NUKIDASHI_COLUMNS;
  RFP_writeColumn_(sheet, startRow, c.gameId, rows.map(row => row.writeIdentity ? RFP_numberOrTextGameId_(row.gameId) : ''));
  RFP_writeColumn_(sheet, startRow, c.name, rows.map(row => row.writeIdentity ? row.name : ''));
  RFP_writeColumn_(sheet, startRow, c.email, rows.map(row => row.writeIdentity ? row.email : ''));
  RFP_writeColumn_(sheet, startRow, c.receiptName, rows.map(row => row.writeIdentity ? row.receiptName : ''));
  RFP_writeColumn_(sheet, startRow, c.year, rows.map(row => row.year));
  RFP_writeColumn_(sheet, startRow, c.month, rows.map(row => row.month));
  RFP_writeColumn_(sheet, startRow, c.day, rows.map(row => row.day));
  RFP_writeColumn_(sheet, startRow, c.tournament, rows.map(row => row.tournament));
  RFP_writeColumn_(sheet, startRow, c.type, rows.map(row => row.type));
  RFP_writeColumn_(sheet, startRow, c.cash, rows.map(row => row.cash));
  RFP_writeColumn_(sheet, startRow, c.creditCard, rows.map(row => row.creditCard));
  RFP_writeColumn_(sheet, startRow, c.points, rows.map(row => row.points));
  RFP_writeColumn_(sheet, startRow, c.usdt, rows.map(row => row.usdt));
}

function RFP_writeNukidashiDetailRow_(sheet, rowNo, row) {
  const c = RFP_CONFIG.NUKIDASHI_COLUMNS;
  sheet.getRange(rowNo, c.year).setValue(row.year);
  sheet.getRange(rowNo, c.month).setValue(row.month);
  sheet.getRange(rowNo, c.day).setValue(row.day);
  sheet.getRange(rowNo, c.tournament).setValue(row.tournament);
  sheet.getRange(rowNo, c.type).setValue(row.type);
  sheet.getRange(rowNo, c.cash).setValue(row.cash);
  sheet.getRange(rowNo, c.creditCard).setValue(row.creditCard);
  sheet.getRange(rowNo, c.points).setValue(row.points);
  sheet.getRange(rowNo, c.usdt).setValue(row.usdt);
}

function RFP_writeNukidashiIdentityRow_(sheet, rowNo, row) {
  const c = RFP_CONFIG.NUKIDASHI_COLUMNS;
  sheet.getRange(rowNo, c.gameId).setValue(RFP_numberOrTextGameId_(row.gameId));
  sheet.getRange(rowNo, c.name).setValue(row.name);
  sheet.getRange(rowNo, c.email).setValue(row.email);
  sheet.getRange(rowNo, c.receiptName).setValue(row.receiptName);
}

function RFP_prepareAppend_(sheet, rows, columnCount) {
  const startRow = Math.max(sheet.getLastRow() + 1, 2);
  RFP_ensureRows_(sheet, startRow + rows.length - 1);

  const target = sheet.getRange(startRow, 1, rows.length, columnCount);
  const existing = target.getValues();
  const hasContent = existing.some(row => row.some(value => RFP_text_(value) !== ''));
  if (hasContent) {
    throw new Error(sheet.getName() + ' の追加予定範囲に既存内容があります: ' + startRow + '行目以降');
  }

  return {
    sheet: sheet,
    rows: rows,
    startRow: startRow,
    columnCount: columnCount,
    target: target
  };
}

function RFP_commitAppend_(prepared) {
  if (!prepared.rows.length) return;

  const templateRow = prepared.startRow - 1;
  const target = prepared.sheet.getRange(prepared.startRow, 1, prepared.rows.length, prepared.columnCount);
  if (templateRow >= 2) {
    prepared.sheet.getRange(templateRow, 1, 1, prepared.columnCount)
      .copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  }

  target.setValues(prepared.rows);
}

function RFP_buildMailRowsFromMerged_(mergedRows) {
  const grouped = new Map();
  const order = [];

  mergedRows.forEach(row => {
    const key = RFP_personKey_(row.name, row.email);
    if (!grouped.has(key)) {
      grouped.set(key, { name: row.name, email: row.email, maxCount: 0 });
      order.push(key);
    }
  });

  return order.map(key => {
    const item = grouped.get(key);
    return RFP_mailRow_(item.name, item.email, 1);
  });
}

function RFP_buildWrittenNukidashiRows_(targets, appendPrepared) {
  const rows = targets.updates.map(row => ({
    rowNo: row.rowNo,
    ownerName: row.ownerName,
    ownerEmail: row.ownerEmail,
    gameIdKey: row.gameIdKey
  }));

  targets.appends.forEach((row, index) => {
    rows.push({
      rowNo: appendPrepared.startRow + index,
      ownerName: row.ownerName,
      ownerEmail: row.ownerEmail,
      gameIdKey: row.gameIdKey
    });
  });

  return rows;
}

function RFP_clearDuplicateGameIdsInWrittenRows_(sheet, writtenRows) {
  const seen = new Set();
  const duplicateRows = [];
  const gameIdCol = RFP_CONFIG.NUKIDASHI_COLUMNS.gameId;

  writtenRows.forEach(item => {
    const key = RFP_normalizeGameId_(item.gameIdKey);
    if (!key) return;

    if (seen.has(key)) {
      duplicateRows.push(item.rowNo);
      return;
    }

    seen.add(key);
  });

  duplicateRows.forEach(rowNo => {
    sheet.getRange(rowNo, gameIdCol).clearContent();
  });
}

function RFP_buildMailRowsFromNukidashiRows_(sheet, writtenRows) {
  const c = RFP_CONFIG.NUKIDASHI_COLUMNS;
  const grouped = new Map();
  const order = [];

  writtenRows.forEach(item => {
    const name = RFP_text_(item.ownerName);
    const email = RFP_text_(item.ownerEmail);
    const count = RFP_count_(sheet.getRange(item.rowNo, c.imageNumber).getDisplayValue());
    if (!name || count <= 0) return;

    const key = RFP_personKey_(name, email);
    if (!grouped.has(key)) {
      grouped.set(key, { name: name, email: email, maxCount: count });
      order.push(key);
    } else {
      grouped.get(key).maxCount = Math.max(grouped.get(key).maxCount, count);
    }
  });

  return order.map(key => {
    const item = grouped.get(key);
    return RFP_mailRow_(item.name, item.email, item.maxCount);
  });
}

function RFP_buildMailRowsFromNukidashiRowNumbers_(sheet, rowNumbers) {
  const c = RFP_CONFIG.NUKIDASHI_COLUMNS;
  const grouped = new Map();
  const order = [];

  rowNumbers.forEach(rowNo => {
    const owner = RFP_readNukidashiOwnerAtRow_(sheet, rowNo);
    const count = RFP_count_(sheet.getRange(rowNo, c.imageNumber).getDisplayValue());
    if (!owner.name || count <= 0) return;

    const key = RFP_personKey_(owner.name, owner.email);
    if (!grouped.has(key)) {
      grouped.set(key, { name: owner.name, email: owner.email, maxCount: count });
      order.push(key);
    } else {
      grouped.get(key).maxCount = Math.max(grouped.get(key).maxCount, count);
    }
  });

  return order.map(key => {
    const item = grouped.get(key);
    return RFP_mailRow_(item.name, item.email, item.maxCount);
  });
}

function RFP_readNukidashiOwnerAtRow_(sheet, rowNo) {
  const c = RFP_CONFIG.NUKIDASHI_COLUMNS;
  for (let r = rowNo; r >= RFP_CONFIG.NUKIDASHI_HEADER_ROW + 1; r--) {
    const values = sheet.getRange(r, 1, 1, Math.max(c.email, c.receiptName)).getValues()[0];
    const name = RFP_displayText_(values[c.name - 1]);
    const email = RFP_text_(values[c.email - 1]);
    if (RFP_text_(name) || email) {
      return {
        name: name,
        email: email
      };
    }
  }
  return { name: '', email: '' };
}

function RFP_mailRow_(name, email, count) {
  return [
    '',
    name,
    name ? name + ' 様' : '',
    count,
    '',
    '',
    email,
    '',
    '',
    '',
    '',
    '',
    '',
    ''
  ];
}

function RFP_findNukidashiLastDataRow_(sheet) {
  const headerRow = RFP_CONFIG.NUKIDASHI_HEADER_ROW;
  const maxRows = sheet.getMaxRows();
  const keyCols = [RFP_CONFIG.NUKIDASHI_COLUMNS.gameId, RFP_CONFIG.NUKIDASHI_COLUMNS.tournament];
  let last = headerRow;

  keyCols.forEach(col => {
    const values = sheet.getRange(headerRow + 1, col, maxRows - headerRow, 1).getValues();
    for (let i = values.length - 1; i >= 0; i--) {
      if (RFP_text_(values[i][0])) {
        last = Math.max(last, headerRow + 1 + i);
        break;
      }
    }
  });

  return last;
}

function RFP_assertNukidashiKeysEmpty_(sheet, startRow, rowCount) {
  const keyCols = [RFP_CONFIG.NUKIDASHI_COLUMNS.gameId, RFP_CONFIG.NUKIDASHI_COLUMNS.tournament];
  keyCols.forEach(col => {
    const values = sheet.getRange(startRow, col, rowCount, 1).getValues();
    const occupied = [];
    values.forEach((row, index) => {
      if (RFP_text_(row[0])) occupied.push(startRow + index);
    });
    if (occupied.length) {
      throw new Error('トナメ抜き出し の追加予定行に既存データがあります: ' + occupied.join(', ') + '行 / ' + col + '列');
    }
  });
}

function RFP_fillMissingFormulas_(sheet, templateRow, startRow, rowCount, columnCount) {
  const templateFormulas = sheet.getRange(templateRow, 1, 1, columnCount).getFormulasR1C1()[0];
  const targetRange = sheet.getRange(startRow, 1, rowCount, columnCount);
  const targetFormulas = targetRange.getFormulasR1C1();
  const inputColumns = new Set([
    RFP_CONFIG.NUKIDASHI_COLUMNS.gameId - 1,
    RFP_CONFIG.NUKIDASHI_COLUMNS.name - 1,
    RFP_CONFIG.NUKIDASHI_COLUMNS.email - 1,
    RFP_CONFIG.NUKIDASHI_COLUMNS.receiptName - 1,
    RFP_CONFIG.NUKIDASHI_COLUMNS.year - 1,
    RFP_CONFIG.NUKIDASHI_COLUMNS.month - 1,
    RFP_CONFIG.NUKIDASHI_COLUMNS.day - 1,
    RFP_CONFIG.NUKIDASHI_COLUMNS.tournament - 1,
    RFP_CONFIG.NUKIDASHI_COLUMNS.type - 1,
    RFP_CONFIG.NUKIDASHI_COLUMNS.cash - 1,
    RFP_CONFIG.NUKIDASHI_COLUMNS.creditCard - 1,
    RFP_CONFIG.NUKIDASHI_COLUMNS.points - 1,
    RFP_CONFIG.NUKIDASHI_COLUMNS.usdt - 1
  ]);

  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < columnCount; c++) {
      if (inputColumns.has(c)) continue;
      if (targetFormulas[r][c]) continue;
      if (!templateFormulas[c]) continue;
      sheet.getRange(startRow + r, c + 1).setFormulaR1C1(templateFormulas[c]);
    }
  }
}

function RFP_writeColumn_(sheet, startRow, column, values) {
  sheet.getRange(startRow, column, values.length, 1).setValues(values.map(value => [value]));
}

function RFP_writeCheck_(ss, rows) {
  const sheet = RFP_ensureOwnedSheet_(ss, RFP_CONFIG.CHECK_SHEET_NAME, RFP_CONFIG.CHECK_HEADERS);
  if (sheet.getLastRow() >= 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, RFP_CONFIG.CHECK_HEADERS.length).clearContent();
  }
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, RFP_CONFIG.CHECK_HEADERS.length).setValues(rows);
  }
}

function RFP_writeRunLog_(ss, row) {
  const sheet = RFP_ensureOwnedSheet_(ss, RFP_CONFIG.RUN_LOG_SHEET_NAME, RFP_CONFIG.RUN_LOG_HEADERS);
  sheet.appendRow(row);
}

function RFP_assertRunNotProcessed_(ss, runKey) {
  const sheet = RFP_ensureOwnedSheet_(ss, RFP_CONFIG.RUN_LOG_SHEET_NAME, RFP_CONFIG.RUN_LOG_HEADERS);
  if (sheet.getLastRow() < 2) return;

  const keys = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getDisplayValues().flat();
  if (keys.indexOf(runKey) >= 0) {
    throw new Error('同じ入力内容はすでに追加済みです。重複追加を防止するため停止しました。');
  }
}

function RFP_buildRunKey_(rows) {
  const source = rows.map(row => [
    row.gameId,
    row.name,
    row.email,
    row.receiptName,
    row.year,
    row.month,
    row.day,
    row.tournament,
    row.type,
    row.cash,
    row.creditCard,
    row.points,
    row.usdt
  ].join('|')).join('\n');

  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, source, Utilities.Charset.UTF_8);
  return bytes.map(byte => ('0' + ((byte + 256) % 256).toString(16)).slice(-2)).join('');
}

function openReceiptFormPwCheck() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setActiveSheet(RFP_ensureOwnedSheet_(ss, RFP_CONFIG.CHECK_SHEET_NAME, RFP_CONFIG.CHECK_HEADERS));
}

function openReceiptFormPwManualFix() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setActiveSheet(RFP_ensureOwnedSheet_(ss, RFP_CONFIG.MANUAL_FIX_SHEET_NAME, RFP_CONFIG.MANUAL_FIX_HEADERS));
}

function clearLatestReceiptFormPwGeneratedRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getDocumentProperties();
  const nukidashiSheet = RFP_requiredSheet_(ss, RFP_CONFIG.NUKIDASHI_SHEET_NAME);
  const mailSheet = RFP_requiredSheet_(ss, RFP_CONFIG.MAIL_SHEET_NAME);

  const updateRows = RFP_parseRowNumbers_(props.getProperty('RFP_LAST_NUKIDASHI_UPDATE_ROWS'));
  const fallbackRows = RFP_parseRowNumbers_(props.getProperty('RFP_LAST_NUKIDASHI_ROWS'));
  const appendStart = Number(props.getProperty('RFP_LAST_NUKIDASHI_APPEND_START_ROW') || 0);
  const appendCount = Number(props.getProperty('RFP_LAST_NUKIDASHI_APPEND_ROW_COUNT') || 0);
  const mailStart = Number(props.getProperty('RFP_LAST_MAIL_START_ROW') || 0);
  const mailCount = Number(props.getProperty('RFP_LAST_MAIL_ROW_COUNT') || 0);

  if (!updateRows.length && !fallbackRows.length && !appendCount && !mailCount) {
    RFP_alert_('前回生成分の記録がありません。');
    return;
  }

  if (!RFP_confirm_(
    '前回生成分をクリアします。\n\n' +
    'トナメ抜き出し既存行: 入力列だけクリア\n' +
    'トナメ抜き出し追加行: 行ごと削除\n' +
    'メール送信一覧追加行: 行ごと削除\n\n' +
    '続行しますか？'
  )) return;

  const rowsToClear = updateRows.length ? updateRows : fallbackRows;
  const appendRows = appendCount > 0 ? RFP_rangeRows_(appendStart, appendCount) : [];
  const appendSet = new Set(appendRows);
  const oldRowsToClear = rowsToClear.filter(rowNo => !appendSet.has(rowNo));

  RFP_clearNukidashiInputRows_(nukidashiSheet, oldRowsToClear);
  if (mailStart > 1 && mailCount > 0) {
    mailSheet.deleteRows(mailStart, mailCount);
  }
  if (appendStart > 1 && appendCount > 0) {
    nukidashiSheet.deleteRows(appendStart, appendCount);
  }

  props.deleteProperty('RFP_LAST_NUKIDASHI_ROWS');
  props.deleteProperty('RFP_LAST_NUKIDASHI_UPDATE_ROWS');
  props.deleteProperty('RFP_LAST_NUKIDASHI_APPEND_START_ROW');
  props.deleteProperty('RFP_LAST_NUKIDASHI_APPEND_ROW_COUNT');
  props.deleteProperty('RFP_LAST_NUKIDASHI_ROW_COUNT');
  props.deleteProperty('RFP_LAST_MAIL_START_ROW');
  props.deleteProperty('RFP_LAST_MAIL_ROW_COUNT');

  RFP_alert_(
    '前回生成分をクリアしました。\n\n' +
    '入力列クリア: ' + oldRowsToClear.length + '行\n' +
    'トナメ削除: ' + appendCount + '行\n' +
    'メール削除: ' + mailCount + '行'
  );
}

function clearSelectedReceiptFormPwNukidashiRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  if (sheet.getName() !== RFP_CONFIG.NUKIDASHI_SHEET_NAME) {
    throw new Error('トナメ抜き出しで行を選択してから実行してください。');
  }

  const range = sheet.getActiveRange();
  if (!range) throw new Error('クリア対象の行を選択してください。');

  const startRow = Math.max(range.getRow(), RFP_CONFIG.NUKIDASHI_HEADER_ROW + 1);
  const endRow = range.getLastRow();
  const rowNumbers = RFP_rangeRows_(startRow, endRow - startRow + 1);

  if (!rowNumbers.length) throw new Error('データ行を選択してください。');
  if (!RFP_confirm_(
    '選択中のトナメ抜き出し行の入力列だけクリアします。\n\n' +
    '対象行: ' + startRow + '〜' + endRow + '\n' +
    '公式列・書式・行そのものは残します。\n\n' +
    '続行しますか？'
  )) return;

  RFP_clearNukidashiInputRows_(sheet, rowNumbers);
  RFP_alert_('選択行の入力列をクリアしました: ' + rowNumbers.length + '行');
}

function deleteSelectedReceiptFormPwNukidashiRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  if (sheet.getName() !== RFP_CONFIG.NUKIDASHI_SHEET_NAME) {
    throw new Error('トナメ抜き出しで削除したい行を選択してから実行してください。');
  }

  const range = sheet.getActiveRange();
  if (!range) throw new Error('削除対象の行を選択してください。');

  const startRow = Math.max(range.getRow(), RFP_CONFIG.NUKIDASHI_HEADER_ROW + 1);
  const endRow = range.getLastRow();
  const rowCount = endRow - startRow + 1;

  if (rowCount <= 0) throw new Error('データ行を選択してください。');
  if (!RFP_confirm_(
    '選択中のトナメ抜き出し行を行ごと削除します。\n\n' +
    '対象行: ' + startRow + '〜' + endRow + '\n\n' +
    'これは行そのものを削除します。続行しますか？'
  )) return;

  sheet.deleteRows(startRow, rowCount);
  RFP_alert_('選択行を削除しました: ' + rowCount + '行');
}

function RFP_requiredSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('シートが見つかりません: ' + name);
  return sheet;
}

function RFP_ensureOwnedSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function RFP_findHeader_(headers, aliases) {
  const normalized = headers.map(RFP_normalizeHeader_);
  for (const alias of aliases) {
    const idx = normalized.indexOf(RFP_normalizeHeader_(alias));
    if (idx >= 0) return idx;
  }
  return -1;
}

function RFP_assertColumn_(idx, sheetName, label) {
  if (idx < 0) throw new Error('シート「' + sheetName + '」に必要な列「' + label + '」が見つかりません。');
}

function RFP_normalizeHeader_(value) {
  return RFP_text_(value)
    .replace(/\s+/g, '')
    .replace(/[（）]/g, ch => ch === '（' ? '(' : ')')
    .toLowerCase();
}

function RFP_displayText_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm:ss');
  }
  return String(value === null || value === undefined ? '' : value);
}

function RFP_firstDisplayText_(primary, fallback) {
  const primaryText = RFP_displayText_(primary);
  return RFP_text_(primaryText) ? primaryText : RFP_displayText_(fallback);
}

function RFP_text_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm:ss');
  }
  return String(value === null || value === undefined ? '' : value)
    .replace(/\u3000/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function RFP_normalizeGameId_(value) {
  return RFP_text_(value).replace(/\D/g, '');
}

function RFP_numberOrTextGameId_(value) {
  const key = RFP_normalizeGameId_(value);
  return /^\d+$/.test(key) ? Number(key) : RFP_text_(value);
}

function RFP_money_(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value === null || value === undefined ? '' : value)
    .replace(/[￥¥,\s　円]/g, '')
    .replace(/-$/, '')
    .trim();
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

function RFP_count_(value) {
  const n = RFP_money_(value);
  return n > 0 ? Math.floor(n) : 0;
}

function RFP_personKey_(name, email) {
  return RFP_text_(name) + '||' + RFP_text_(email).toLowerCase();
}

function RFP_parseRowNumbers_(value) {
  return RFP_text_(value)
    .split(',')
    .map(text => Number(RFP_text_(text)))
    .filter(number => Number.isInteger(number) && number > RFP_CONFIG.NUKIDASHI_HEADER_ROW);
}

function RFP_rangeRows_(startRow, rowCount) {
  const rows = [];
  if (!Number.isInteger(startRow) || !Number.isInteger(rowCount) || rowCount <= 0) return rows;

  for (let i = 0; i < rowCount; i++) {
    const rowNo = startRow + i;
    if (rowNo > RFP_CONFIG.NUKIDASHI_HEADER_ROW) rows.push(rowNo);
  }
  return rows;
}

function RFP_clearNukidashiInputRows_(sheet, rowNumbers) {
  const uniqueRows = Array.from(new Set(rowNumbers))
    .filter(rowNo => Number.isInteger(rowNo) && rowNo > RFP_CONFIG.NUKIDASHI_HEADER_ROW)
    .sort((a, b) => a - b);

  uniqueRows.forEach(rowNo => {
    sheet.getRange(rowNo, 3, 1, 4).clearContent();  // C:F
    sheet.getRange(rowNo, 8, 1, 5).clearContent();  // H:L
    sheet.getRange(rowNo, 14, 1, 4).clearContent(); // N:Q
  });
}

function RFP_ensureRows_(sheet, requiredLastRow) {
  if (requiredLastRow > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), requiredLastRow - sheet.getMaxRows());
  }
}

function RFP_alert_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    console.log(message);
  }
}

function RFP_confirm_(message) {
  try {
    const ui = SpreadsheetApp.getUi();
    return ui.alert('確認', message, ui.ButtonSet.OK_CANCEL) === ui.Button.OK;
  } catch (e) {
    console.log(message);
    return true;
  }
}
