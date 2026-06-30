/**
 * 事前予約メール REPORT 作成ツール
 *
 * このファイルは単独の Apps Script プロジェクトで使用する。
 * 元シート「フォームの回答 1」は、送信成功時の A/D/E 列チェックと
 * P列の支払期限、Q列の手動指示以外は変更しない。
 */

const RESERVATION_MAIL_CONFIG = {
  sourceSheetName: 'フォームの回答 1',
  headerRow: 14,
  dataStartRow: 15,
  timestampHeader: 'タイムスタンプ',

  columns: {
    paymentInviteSent: 1, // A: チェック済み = 支払案内を処理済み
    paymentConfirmed: 2, // B: チェック済み = 決済確認済み
    dayGuideSent: 4,      // D: チェック済み = 当日案内を送信済み
    cancelMailSent: 5,    // E: チェック済み = キャンセルメール送信済み
    email: 7,            // G
    gameId: 8,           // H
    playerName: 9,       // I
    paymentMethod: 10,   // J
    paymentDeadline: 16, // P: 自動計算した支払期限
    manualAction: 17     // Q: cancel / キャンセル
  },

  paymentMethods: {
    coin: 'Poker Web Coin',
    livePocket: 'LivePocket決済（コンビニ、クレジットカード）',
    contract: '選手契約履行'
  },

  eventName: 'JOPT 2026 Tokyo #02 / NLH Heads-up Championship',
  livePocketUrl: 'https://livepocket.jp/e/larsf',
  from: 'customer@japanopenpoker.com',
  fromName: 'Japan Open Poker Tour / JOPT',
  bcc: 'customer@japanopenpoker.com',

  /**
   * 将来、同じ Gmail アカウントの送信済みメールを検索し、
   * 同一宛先・同一件名を REPORT から除外したい場合だけ true にする。
   * 同僚が別アカウントから手動送信したメールは検出できない。
   */
  excludeAlreadySentByGmail: false,
  sentMailLookbackDays: 365,

  // REPORT作成時に対象者全員分のGmail下書きを自動作成する。
  createDraftsWhenBuildingReport: true
};

const RESERVATION_REPORT_HEADERS = [
  '元行',
  'メール種別',
  'メールアドレス',
  'プレイヤーネーム',
  'GameID',
  '決済方法',
  '支払期限',
  '件名',
  '本文',
  'Gmail作成リンク',
  '送信OK',
  'Draft ID',
  '送信ステータス',
  '送信日時'
];

function onOpen() {
  reservationMailReportOnOpen();
}

function reservationMailReportOnOpen() {
  SpreadsheetApp.getUi()
    .createMenu('事前予約メールREPORT')
    .addItem('初期設定：期限列・自動色分けを準備', 'setupReservationDeadlineAndColors')
    .addSeparator()
    .addItem('COIN支払案内REPORT', 'createCoinPaymentInviteReport')
    .addItem('LivePocket支払案内REPORT', 'createLivePocketPaymentInviteReport')
    .addItem('支払案内の送信済みをA列に反映', 'syncPaymentInviteSentChecks')
    .addSeparator()
    .addItem('決済完了・当日案内REPORT（B列チェック済み）', 'createPaymentConfirmedReport')
    .addItem('選手契約履行 当日案内REPORT', 'createContractConfirmedReport')
    .addItem('当日案内の送信済みをD列に反映', 'syncDayGuideSentChecks')
    .addSeparator()
    .addItem('支払予定確認メール一括作成', 'createPaymentReminderReport')
    .addItem('期限超過者をキャンセル候補に追加', 'markOverdueRowsAsCancelCandidates')
    .addItem('キャンセルメール一括作成', 'createCancelReport')
    .addSeparator()
    .addItem('開いているREPORTのGmail下書きを一括作成', 'createDraftsFromActiveReservationReport')
    .addItem('開いているREPORTの送信OKメールを送信', 'sendApprovedFromActiveReservationReport')
    .addToUi();
}

function createCoinPaymentInviteReport() {
  reservationBuildReport_({
    sheetName: 'REPORT_COIN_PAYMENT_INVITE',
    mailType: 'COIN支払案内',
    matches: row =>
      !row.paymentInviteSent &&
      !row.paymentConfirmed &&
      row.paymentMethod === RESERVATION_MAIL_CONFIG.paymentMethods.coin,
    makeMail: reservationMakeCoinPaymentInvite_
  });
}

function createLivePocketPaymentInviteReport() {
  reservationBuildReport_({
    sheetName: 'REPORT_LIVEPOCKET_PAYMENT_INVITE',
    mailType: 'LivePocket支払案内',
    matches: row =>
      !row.paymentInviteSent &&
      !row.paymentConfirmed &&
      row.paymentMethod === RESERVATION_MAIL_CONFIG.paymentMethods.livePocket,
    makeMail: reservationMakeLivePocketPaymentInvite_
  });
}

function createPaymentConfirmedReport() {
  reservationBuildReport_({
    sheetName: 'REPORT_PAYMENT_CONFIRMED',
    mailType: '決済完了・当日案内',
    matches: row =>
      row.paymentConfirmed &&
      !row.dayGuideSent &&
      reservationIsStandardPayment_(row.paymentMethod),
    makeMail: reservationMakePaymentConfirmed_
  });
}

function createContractConfirmedReport() {
  reservationBuildReport_({
    sheetName: 'REPORT_CONTRACT_CONFIRMED',
    mailType: '選手契約履行 当日案内',
    matches: row =>
      !row.dayGuideSent &&
      row.paymentMethod === RESERVATION_MAIL_CONFIG.paymentMethods.contract,
    makeMail: reservationMakeContractConfirmed_
  });
}

function createPaymentReminderReport() {
  reservationBuildReport_({
    sheetName: 'REPORT_PAYMENT_REMINDER',
    mailType: '支払予定確認・リマインド',
    matches: row =>
      row.paymentInviteSent &&
      !row.paymentConfirmed &&
      reservationIsStandardPayment_(row.paymentMethod),
    makeMail: reservationMakePaymentReminder_
  });
}

function createCancelReport() {
  reservationBuildReport_({
    sheetName: 'REPORT_CANCEL',
    mailType: 'キャンセル通知',
    matches: row =>
      !row.cancelMailSent &&
      reservationIsCancelRequested_(row.manualAction),
    makeMail: reservationMakeCancel_
  });
}

function markOverdueRowsAsCancelCandidates() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(RESERVATION_MAIL_CONFIG.sourceSheetName);
  if (!sheet) throw new Error('元シートが見つかりません。');

  const c = RESERVATION_MAIL_CONFIG.columns;
  const lastRow = sheet.getLastRow();
  if (lastRow < RESERVATION_MAIL_CONFIG.dataStartRow) {
    SpreadsheetApp.getUi().alert('対象データがありません。');
    return;
  }

  const rowCount = lastRow - RESERVATION_MAIL_CONFIG.dataStartRow + 1;
  const values = sheet
    .getRange(RESERVATION_MAIL_CONFIG.dataStartRow, 1, rowCount, c.manualAction)
    .getValues();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cellsToMark = [];

  values.forEach((row, index) => {
    const paymentConfirmed = reservationIsChecked_(row[c.paymentConfirmed - 1]);
    const cancelMailSent = reservationIsChecked_(row[c.cancelMailSent - 1]);
    const deadline = reservationValidDate_(row[c.paymentDeadline - 1]);
    const manualAction = reservationText_(row[c.manualAction - 1]);

    if (
      deadline &&
      deadline.getTime() < today.getTime() &&
      !paymentConfirmed &&
      !cancelMailSent &&
      !manualAction
    ) {
      cellsToMark.push(
        reservationColumnToLetter_(c.manualAction) +
        (RESERVATION_MAIL_CONFIG.dataStartRow + index)
      );
    }
  });

  if (cellsToMark.length) {
    sheet.getRangeList(cellsToMark).setValue('キャンセル');
  }

  SpreadsheetApp.getUi().alert(
    '期限超過者をキャンセル候補に追加しました。\n追加: ' +
    cellsToMark.length + '件\n\nQ列を確認し、送信しない方は「キャンセル」を削除してください。'
  );
}

function syncPaymentInviteSentChecks() {
  reservationSyncSentChecks_({
    label: '支払案内',
    targetColumn: RESERVATION_MAIL_CONFIG.columns.paymentInviteSent,
    matches: row =>
      !row.paymentInviteSent &&
      reservationIsStandardPayment_(row.paymentMethod),
    makeMail: row => row.paymentMethod === RESERVATION_MAIL_CONFIG.paymentMethods.coin
      ? reservationMakeCoinPaymentInvite_(row)
      : reservationMakeLivePocketPaymentInvite_(row)
  });
}

function syncDayGuideSentChecks() {
  reservationSyncSentChecks_({
    label: '決済完了・当日案内',
    targetColumn: RESERVATION_MAIL_CONFIG.columns.dayGuideSent,
    matches: row =>
      row.paymentConfirmed &&
      !row.dayGuideSent &&
      reservationIsStandardPayment_(row.paymentMethod),
    makeMail: reservationMakePaymentConfirmed_
  });
}

function reservationSyncSentChecks_(definition) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const source = ss.getSheetByName(RESERVATION_MAIL_CONFIG.sourceSheetName);

  if (!source) {
    throw new Error(
      '元シート「' + RESERVATION_MAIL_CONFIG.sourceSheetName + '」が見つかりません。'
    );
  }

  const lastRow = source.getLastRow();
  if (lastRow < RESERVATION_MAIL_CONFIG.dataStartRow) {
    SpreadsheetApp.getUi().alert('対象データがありません。');
    return;
  }

  const timestampColumn = reservationFindTimestampColumn_(source);
  const readColumnCount = Math.max(
    source.getLastColumn(),
    RESERVATION_MAIL_CONFIG.columns.manualAction,
    timestampColumn
  );
  const values = source
    .getRange(
      RESERVATION_MAIL_CONFIG.dataStartRow,
      1,
      lastRow - RESERVATION_MAIL_CONFIG.dataStartRow + 1,
      readColumnCount
    )
    .getValues();
  const cellsToCheck = [];

  values.forEach((rowValues, index) => {
    const row = reservationParseSourceRow_(
      rowValues,
      RESERVATION_MAIL_CONFIG.dataStartRow + index,
      timestampColumn
    );

    if (!row.email || !definition.matches(row)) {
      return;
    }

    const mail = definition.makeMail(row);
    if (reservationHasSentMail_(row.email, mail.subject)) {
      cellsToCheck.push(
        reservationColumnToLetter_(definition.targetColumn) + row.sourceRow
      );
    }
  });

  if (cellsToCheck.length) {
    source.getRangeList(cellsToCheck).setValue(true);
  }

  SpreadsheetApp.getUi().alert(
    definition.label + 'の送信済みを反映しました。\nチェック更新: ' +
    cellsToCheck.length + '件\n\n' +
    '現在ログイン中のGmailアカウントの送信済みメールだけを確認しています。'
  );
}

function setupReservationDeadlineAndColors() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(RESERVATION_MAIL_CONFIG.sourceSheetName);
  if (!sheet) throw new Error('元シートが見つかりません。');

  const c = RESERVATION_MAIL_CONFIG.columns;
  sheet.getRange(RESERVATION_MAIL_CONFIG.headerRow, c.paymentDeadline).setValue('支払期限');
  sheet.getRange(RESERVATION_MAIL_CONFIG.headerRow, c.manualAction).setValue('手動指示');

  const lastRow = Math.max(sheet.getLastRow(), RESERVATION_MAIL_CONFIG.dataStartRow);
  const dataRows = lastRow - RESERVATION_MAIL_CONFIG.dataStartRow + 1;
  const formatRows = sheet.getMaxRows() - RESERVATION_MAIL_CONFIG.dataStartRow + 1;
  const timestampColumn = reservationFindTimestampColumn_(sheet);
  const timestamps = sheet
    .getRange(RESERVATION_MAIL_CONFIG.dataStartRow, timestampColumn, dataRows, 1)
    .getValues();
  const existingDeadlines = sheet
    .getRange(RESERVATION_MAIL_CONFIG.dataStartRow, c.paymentDeadline, dataRows, 1)
    .getValues();
  const deadlineValues = timestamps.map((row, index) => [
    reservationValidDate_(existingDeadlines[index][0]) ||
    reservationCalculateDeadline_(row[0])
  ]);
  sheet.getRange(RESERVATION_MAIL_CONFIG.dataStartRow, c.paymentDeadline, dataRows, 1)
    .setValues(deadlineValues)
    .setNumberFormat('m/d(aaa)');

  const target = sheet.getRange(
    RESERVATION_MAIL_CONFIG.dataStartRow,
    1,
    formatRows,
    c.manualAction
  );
  const existing = sheet.getConditionalFormatRules().filter(rule =>
    !rule.getRanges().some(range =>
      range.getSheet().getName() === sheet.getName() &&
      range.getA1Notation() === target.getA1Notation()
    )
  );
  const start = RESERVATION_MAIL_CONFIG.dataStartRow;
  const rules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$E' + start + '=TRUE')
      .setBackground('#d9d9d9')
      .setRanges([target])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=OR(LOWER($Q' + start + ')="cancel",$Q' + start + '="キャンセル")')
      .setBackground('#ead1dc')
      .setRanges([target])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$B' + start + '=TRUE')
      .setBackground('#c9daf8')
      .setRanges([target])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($F' + start + '<>"",$B' + start + '=FALSE,$P' + start + '<TODAY())')
      .setBackground('#f4cccc')
      .setRanges([target])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($F' + start + '<>"",$B' + start + '=FALSE,$P' + start + '=TODAY())')
      .setBackground('#fce5cd')
      .setRanges([target])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($F' + start + '<>"",$B' + start + '=FALSE,$P' + start + '>TODAY())')
      .setBackground('#d9ead3')
      .setRanges([target])
      .build()
  ];
  sheet.setConditionalFormatRules(existing.concat(rules));
  SpreadsheetApp.getUi().alert('P列の支払期限と自動色分けを設定しました。');
}

function createDraftsFromActiveReservationReport() {
  const sheet = reservationGetActiveReportSheet_();
  const lastRow = sheet.getLastRow();
  let created = 0;

  for (let row = 2; row <= lastRow; row++) {
    const values = sheet.getRange(row, 1, 1, 14).getValues()[0];
    if (!values[2] || values[11] || values[12] === '送信済み') continue;

    try {
      const draftResult = reservationFindOrCreateDraft_(values[2], values[7], values[8]);
      sheet.getRange(row, 12).setValue(draftResult.draftId);
      sheet.getRange(row, 13).setValue(
        draftResult.reused ? '既存下書きを使用' : '下書き作成済み'
      );
      created++;
    } catch (error) {
      sheet.getRange(row, 13).setValue('下書き作成エラー: ' + error.message);
    }
  }

  SpreadsheetApp.getUi().alert('Gmail下書きを作成しました。\n作成: ' + created + '件');
}

function sendApprovedFromActiveReservationReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const report = reservationGetActiveReportSheet_();
  const source = ss.getSheetByName(RESERVATION_MAIL_CONFIG.sourceSheetName);
  const lastRow = report.getLastRow();
  let sent = 0;
  let errors = 0;

  for (let row = 2; row <= lastRow; row++) {
    const values = report.getRange(row, 1, 1, 14).getValues()[0];
    const sourceRow = Number(values[0]);
    const mailType = reservationText_(values[1]);
    const sendOk = reservationIsChecked_(values[10]);
    const draftId = reservationText_(values[11]);
    const sendStatus = reservationText_(values[12]);

    if (!sendOk || !draftId || sendStatus === '送信済み') continue;

    try {
      GmailApp.getDraft(draftId).send();
      report.getRange(row, 13).setValue('送信済み');
      report.getRange(row, 14).setValue(new Date());
      reservationUpdateSourceAfterSend_(source, sourceRow, mailType);
      sent++;
    } catch (error) {
      report.getRange(row, 13).setValue('送信エラー: ' + error.message);
      errors++;
    }
  }

  SpreadsheetApp.getUi().alert(
    '送信処理が完了しました。\n送信: ' + sent + '件\nエラー: ' + errors + '件'
  );
}

function reservationUpdateSourceAfterSend_(source, sourceRow, mailType) {
  const c = RESERVATION_MAIL_CONFIG.columns;

  if (mailType === 'COIN支払案内' || mailType === 'LivePocket支払案内') {
    source.getRange(sourceRow, c.paymentInviteSent).setValue(true);
    const timestampColumn = reservationFindTimestampColumn_(source);
    const deadline =
      reservationValidDate_(source.getRange(sourceRow, c.paymentDeadline).getValue()) ||
      reservationCalculateDeadline_(source.getRange(sourceRow, timestampColumn).getValue());
    source.getRange(sourceRow, c.paymentDeadline)
      .setValue(deadline)
      .setNumberFormat('m/d(aaa)');
  }

  if (mailType === '決済完了・当日案内' || mailType === '選手契約履行 当日案内') {
    source.getRange(sourceRow, c.dayGuideSent).setValue(true);
  }

  if (mailType === 'キャンセル通知') {
    source.getRange(sourceRow, c.cancelMailSent).setValue(true);
  }
}

function reservationGetActiveReportSheet_() {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName().indexOf('REPORT_') !== 0) {
    throw new Error('先に対象の REPORT シートを開いてください。');
  }
  return sheet;
}

function reservationBuildReport_(definition) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const source = ss.getSheetByName(RESERVATION_MAIL_CONFIG.sourceSheetName);

  if (!source) {
    throw new Error(
      '元シート「' + RESERVATION_MAIL_CONFIG.sourceSheetName + '」が見つかりません。'
    );
  }

  const lastRow = source.getLastRow();
  const timestampColumn = reservationFindTimestampColumn_(source);
  const readColumnCount = Math.max(
    source.getLastColumn(),
    RESERVATION_MAIL_CONFIG.columns.manualAction,
    timestampColumn
  );
  const rows = lastRow < RESERVATION_MAIL_CONFIG.dataStartRow
    ? []
    : source
      .getRange(
        RESERVATION_MAIL_CONFIG.dataStartRow,
        1,
        lastRow - RESERVATION_MAIL_CONFIG.dataStartRow + 1,
        readColumnCount
      )
      .getValues();

  const output = [];
  const gmailLinks = [];
  let skippedAsAlreadySent = 0;
  let createdDrafts = 0;
  let reusedDrafts = 0;
  let draftErrors = 0;

  rows.forEach((values, index) => {
    const row = reservationParseSourceRow_(
      values,
      RESERVATION_MAIL_CONFIG.dataStartRow + index,
      timestampColumn
    );

    if (!row.email || !row.playerName || !definition.matches(row)) {
      return;
    }

    const mail = definition.makeMail(row);

    if (reservationWasAlreadySent_(row.email, mail.subject)) {
      skippedAsAlreadySent++;
      return;
    }

    let draftId = '';
    let draftStatus = '';

    if (RESERVATION_MAIL_CONFIG.createDraftsWhenBuildingReport) {
      try {
        const draftResult = reservationFindOrCreateDraft_(
          row.email,
          mail.subject,
          mail.body
        );
        draftId = draftResult.draftId;
        draftStatus = draftResult.reused ? '既存下書きを使用' : '下書き作成済み';
        if (draftResult.reused) {
          reusedDrafts++;
        } else {
          createdDrafts++;
        }
      } catch (error) {
        draftStatus = '下書き作成エラー: ' + error.message;
        draftErrors++;
      }
    }

    output.push([
      row.sourceRow,
      definition.mailType,
      row.email,
      row.playerName,
      row.gameId,
      row.paymentMethod,
      row.deadlineWithTime,
      mail.subject,
      mail.body,
      'Gmailで作成',
      false,
      draftId,
      draftStatus,
      ''
    ]);
    gmailLinks.push(reservationBuildGmailComposeUrl_(row.email, mail.subject, mail.body));
  });

  const report = reservationGetOrCreateReportSheet_(ss, definition.sheetName);
  report.clear();
  report.getRange(1, 1, 1, RESERVATION_REPORT_HEADERS.length)
    .setValues([RESERVATION_REPORT_HEADERS])
    .setFontWeight('bold')
    .setBackground('#d9ead3');
  report.setFrozenRows(1);

  if (output.length) {
    report.getRange(2, 1, output.length, RESERVATION_REPORT_HEADERS.length)
      .setValues(output);

    const richLinks = gmailLinks.map(url => [
      SpreadsheetApp.newRichTextValue()
        .setText('Gmailで作成')
        .setLinkUrl(url)
        .build()
    ]);
    report.getRange(2, 10, richLinks.length, 1).setRichTextValues(richLinks);
    report.getRange(2, 11, output.length, 1).insertCheckboxes();
  }

  report.autoResizeColumns(1, 8);
  report.setColumnWidth(9, 500);
  report.setColumnWidth(10, 140);
  report.getRange(1, 1, Math.max(output.length + 1, 1), RESERVATION_REPORT_HEADERS.length)
    .setVerticalAlignment('top');
  report.getRange(2, 9, Math.max(output.length, 1), 1).setWrap(true);
  report.activate();

  const duplicateMessage = RESERVATION_MAIL_CONFIG.excludeAlreadySentByGmail
    ? '\n送信済み除外: ' + skippedAsAlreadySent + '件'
    : '';
  SpreadsheetApp.getUi().alert(
    definition.sheetName + ' を作成しました。\n対象: ' + output.length + '件' +
    '\n下書き作成: ' + createdDrafts + '件' +
    '\n既存下書きを使用: ' + reusedDrafts + '件' +
    '\n下書きエラー: ' + draftErrors + '件' +
    duplicateMessage
  );
}

function reservationFindOrCreateDraft_(to, subject, body) {
  const drafts = GmailApp.getDrafts();

  for (let index = 0; index < drafts.length; index++) {
    const message = drafts[index].getMessage();
    if (
      reservationNormalizeEmail_(message.getTo()) === reservationNormalizeEmail_(to) &&
      reservationNormalizeEmail_(message.getFrom()) ===
        reservationNormalizeEmail_(RESERVATION_MAIL_CONFIG.from) &&
      reservationEmailListContains_(message.getBcc(), RESERVATION_MAIL_CONFIG.bcc) &&
      message.getSubject() === subject &&
      reservationNormalizeBody_(message.getPlainBody()) === reservationNormalizeBody_(body)
    ) {
      return {
        draftId: drafts[index].getId(),
        reused: true
      };
    }
  }

  reservationAssertFromAlias_();
  const draft = GmailApp.createDraft(to, subject, body, {
    from: RESERVATION_MAIL_CONFIG.from,
    name: RESERVATION_MAIL_CONFIG.fromName,
    bcc: RESERVATION_MAIL_CONFIG.bcc
  });
  return {
    draftId: draft.getId(),
    reused: false
  };
}

function reservationNormalizeEmail_(value) {
  const text = reservationText_(value).toLowerCase();
  const match = text.match(/<([^>]+)>/);
  return match ? match[1].trim() : text;
}

function reservationNormalizeBody_(value) {
  return reservationText_(value).replace(/\r\n/g, '\n');
}

function reservationEmailListContains_(emailList, expectedEmail) {
  const expected = reservationNormalizeEmail_(expectedEmail);
  return reservationText_(emailList)
    .split(',')
    .map(reservationNormalizeEmail_)
    .indexOf(expected) >= 0;
}

function reservationAssertFromAlias_() {
  const from = RESERVATION_MAIL_CONFIG.from.toLowerCase();
  const available = GmailApp.getAliases().map(alias => String(alias).toLowerCase());
  const effectiveUser = Session.getEffectiveUser().getEmail().toLowerCase();

  if (from !== effectiveUser && available.indexOf(from) < 0) {
    throw new Error(
      '送信元「' + RESERVATION_MAIL_CONFIG.from +
      '」がGmailの送信エイリアスに設定されていません。'
    );
  }
}

function reservationParseSourceRow_(values, sourceRow, timestampColumn) {
  const c = RESERVATION_MAIL_CONFIG.columns;
  const timestamp = values[timestampColumn - 1];
  const deadline =
    reservationValidDate_(values[c.paymentDeadline - 1]) ||
    reservationCalculateDeadline_(timestamp);

  return {
    sourceRow: sourceRow,
    timestamp: timestamp,
    paymentInviteSent: reservationIsChecked_(values[c.paymentInviteSent - 1]),
    paymentConfirmed: reservationIsChecked_(values[c.paymentConfirmed - 1]),
    dayGuideSent: reservationIsChecked_(values[c.dayGuideSent - 1]),
    cancelMailSent: reservationIsChecked_(values[c.cancelMailSent - 1]),
    email: reservationText_(values[c.email - 1]),
    gameId: reservationText_(values[c.gameId - 1]),
    playerName: reservationText_(values[c.playerName - 1]),
    paymentMethod: reservationText_(values[c.paymentMethod - 1]),
    paymentDeadline: values[c.paymentDeadline - 1],
    manualAction: reservationText_(values[c.manualAction - 1]),
    deadlineWithTime: reservationFormatDeadline_(deadline, true),
    deadlineDateOnly: reservationFormatDeadline_(deadline, false)
  };
}

function reservationCalculateDeadline_(timestamp) {
  const date = timestamp instanceof Date ? new Date(timestamp.getTime()) : new Date(timestamp);

  if (isNaN(date.getTime())) {
    return null;
  }

  const appliedAfterBusinessHours = date.getHours() >= 19;
  date.setHours(0, 0, 0, 0);
  const appliedOnClosedDay = !reservationIsBusinessDay_(date);

  if (appliedAfterBusinessHours || appliedOnClosedDay) {
    do {
      date.setDate(date.getDate() + 1);
    } while (!reservationIsBusinessDay_(date));
  }

  let businessDays = 0;

  while (businessDays < 3) {
    date.setDate(date.getDate() + 1);

    if (reservationIsBusinessDay_(date)) {
      businessDays++;
    }
  }

  return date;
}

function reservationIsBusinessDay_(date) {
  const day = date.getDay();
  return day !== 0 && day !== 3;
}

function reservationValidDate_(value) {
  if (value === '' || value == null) {
    return null;
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function reservationFormatDeadline_(date, includeTime) {
  if (!date) {
    return '日付要確認';
  }

  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const text =
    (date.getMonth() + 1) + '月' +
    date.getDate() + '日(' +
    weekdays[date.getDay()] + ')';

  return includeTime ? text + ' 23:59まで' : text;
}

function reservationMakeCoinPaymentInvite_(row) {
  return {
    subject: '【事前決済のご案内】' + RESERVATION_MAIL_CONFIG.eventName,
    body: `${row.playerName} 様

お世話になっております。
ジャパンオープンポーカーツアー株式会社の大園と申します。

この度は 「${RESERVATION_MAIL_CONFIG.eventName}」 にお申込みいただき、誠にありがとうございます。
事前決済について詳細をお送りいたします。

■事前決済
Poker Web Coin にて「JOPTクラブ」宛に 150,000 coinをトランスファーしてください。
※フォームで入力いただいたGame IDで照合を行います。

➤トランスファー先：JOPTクラブ
➤金額：150,000 coin
➤トランスファー期限：${row.deadlineWithTime}
※期限までにお支払いが確認できなかった場合、自動的にキャンセルとなります。
※いかなる理由においても決済完了後のご返金は致しかねますので、予めご了承いただけますと幸いです。
※決済の確認が取れ次第、決済完了および当日のご案内メールをお送りいたします。

何かご不明な点がございましたら、下記の連絡先よりお気軽にお問い合わせくださいませ。

メールアドレス：customer＠japanopenpoker.com
公式LINE：https://lin.ee/ckO5p3F

営業時間：10時～19時 (水・日を除く)`
  };
}

function reservationMakeLivePocketPaymentInvite_(row) {
  return {
    subject: '【事前決済のご案内】' + RESERVATION_MAIL_CONFIG.eventName,
    body: `${row.playerName} 様

お世話になっております。
ジャパンオープンポーカーツアー株式会社の大園と申します。

この度は 「${RESERVATION_MAIL_CONFIG.eventName}」 にお申込みいただき、誠にありがとうございます。
事前決済について詳細をお送りいたします。

■事前決済
下記リンクからLive Pocket にてお支払いをお願いいたします。

➤お支払い用リンク：${RESERVATION_MAIL_CONFIG.livePocketUrl}
➤金額：150,000円
➤お支払い期限：${row.deadlineWithTime}
※期限までにお支払いが確認できなかった場合、自動的にキャンセルとなります。
※いかなる理由においても決済完了後のご返金は致しかねますので、予めご了承いただけますと幸いです。
※決済の確認が取れ次第、決済完了および当日のご案内メールをお送りいたします。

何かご不明な点がございましたら、下記の連絡先よりお気軽にお問い合わせくださいませ。

メールアドレス：customer＠japanopenpoker.com
公式LINE：https://lin.ee/ckO5p3F

営業時間：10時～19時 (水・日を除く)`
  };
}

function reservationMakePaymentConfirmed_(row) {
  return {
    subject: '【当日のご案内】' + RESERVATION_MAIL_CONFIG.eventName,
    body: `${row.playerName} 様

お世話になっております。
ジャパンオープンポーカーツアー株式会社の大園と申します。
この度は「${RESERVATION_MAIL_CONFIG.eventName}」にお申込みいただき、誠にありがとうございます。

決済の確認が取れましたので、お申込み完了のご連絡とさせていただきます。
つきましては、当日のご案内を以下の通りお知らせいたします。

■ 大会概要
・会場：ベルサール高田馬場
・住所：〒169-0072 東京都新宿区大久保３丁目８−２ 住友不動産新宿ガーデンタワーB2・1F
・日時：2026年7月17日(金) 15:00 トーナメント開始
・受付開始：14:00
　※エントリー受付は14:45までにお越しください。
・当日お支払い金額：ドリンクチケット 1,000円

■受付に関して
 ・受付はご予約者ご本人様のみとさせていただきます。
・トーナメント開始時間までに受付を完了されていない場合は、着席されるまでの間、置きバケとなりゲームは進行します。置きバケ中はハンドは配らず、1分ごとにBTNは移動しブラインドは都度回収されます。
 ・事前決済いただいた分につきましてはご参加できなかった場合もご返金致しかねます。
・リエントリーはございません。

ご不明点がございましたらお気軽にご連絡ください。
よろしくお願いいたします。

メールアドレス：customer＠japanopenpoker.com
公式LINE：https://lin.ee/ckO5p3F
営業時間：10時～19時 (水・日を除く)`
  };
}

function reservationMakeContractConfirmed_(row) {
  return {
    subject: '【事前決済のご案内】' + RESERVATION_MAIL_CONFIG.eventName,
    body: `${row.playerName} 様

お世話になっております。
ジャパンオープンポーカーツアー株式会社の大園と申します。
この度は「${RESERVATION_MAIL_CONFIG.eventName}」にお申込みいただき、誠にありがとうございます。

選手契約履行にて事前決済が完了いたしました。
つきましては、当日のご案内を以下の通りお知らせいたします。

■ 大会概要
・会場：ベルサール高田馬場
・住所：〒169-0072 東京都新宿区大久保３丁目８−２ 住友不動産新宿ガーデンタワーB2・1F
・日時：2026年7月17日(金) 15:00 トーナメント開始
・受付開始：14:00
　※エントリー受付は14:45までにお越しください。
・当日お支払い金額：ドリンクチケット 1,000円

■受付に関して
 ・受付はご予約者ご本人様のみとさせていただきます。
・トーナメント開始時間までに受付を完了されていない場合は、着席されるまでの間、置きバケとなりゲームは進行します。置きバケ中はハンドは配らず、1分ごとにBTNは移動しブラインドは都度回収されます。
 ・事前決済いただいた分につきましてはご参加できなかった場合もご返金致しかねます。
・リエントリーはございません。

ご不明点がございましたらお気軽にご連絡ください。
よろしくお願いいたします。


メールアドレス：customer＠japanopenpoker.com
公式LINE：https://lin.ee/ckO5p3F

営業時間：10時～19時 (水・日を除く)`
  };
}

function reservationMakePaymentReminder_(row) {
  return {
    subject: '【ご確認】' + RESERVATION_MAIL_CONFIG.eventName + ' お支払い予定について',
    body: `${row.playerName} 様

お世話になっております。
ジャパンオープンポーカーツアー株式会社の大園でございます。

「${RESERVATION_MAIL_CONFIG.eventName}」 のご参加に関するお支払いにつきまして、
ご案内の通り、お支払い期日は【${row.deadlineDateOnly}】までとなっております。

本件につきまして、当日のスムーズな運営および枠の確保の都合上、
期日までにお手続きをお願いしております。

恐れ入りますが、現時点でのお支払い予定について、
以下の内容をご一報いただけますでしょうか。

・${row.deadlineDateOnly}までにお支払い予定の場合
　→おおよそのお支払い予定日

・ご参加を見送られる場合
　→その旨ご連絡ください

なお、期日までにお支払いの確認が取れない場合は、
キャンセル扱いとさせていただきますので、あらかじめご了承ください。

お手数をおかけいたしますが、何卒よろしくお願いいたします。


メールアドレス：customer＠japanopenpoker.com
公式LINE：https://lin.ee/ckO5p3F

営業時間：10時～19時 (水・日を除く)`
  };
}

function reservationMakeCancel_(row) {
  return {
    subject: RESERVATION_MAIL_CONFIG.eventName + ' 申込のキャンセルについて',
    body: `${row.playerName} 様

お世話になっております。
ジャパンオープンポーカーツアー株式会社の大園でございます。

この度は、「JOPT 2026 Tokyo #02 /  NLH Heads-up Championship 」へお申し込みいただき、誠にありがとうございます。

ご連絡を差し上げておりましたが、現時点までにご返信をいただけていないため、誠に恐縮ではございますが、今回のお申込みはキャンセルとさせていただきました。

なお、現在もお申し込み受付中となっておりますので、
再度ご参加をご希望の場合は、改めてお申し込みいただけますと幸いです。

何かご不明な点がございましたら、下記の連絡先よりお気軽にお問い合わせくださいませ。

メールアドレス：customer＠japanopenpoker.com
公式LINE：https://lin.ee/ckO5p3F

営業時間：10時～19時 (水・日を除く)`
  };
}

function reservationBuildGmailComposeUrl_(to, subject, body) {
  return 'https://mail.google.com/mail/?view=cm&fs=1' +
    '&to=' + encodeURIComponent(to) +
    '&su=' + encodeURIComponent(subject) +
    '&body=' + encodeURIComponent(body);
}

function reservationWasAlreadySent_(email, subject) {
  if (!RESERVATION_MAIL_CONFIG.excludeAlreadySentByGmail) {
    return false;
  }

  return reservationHasSentMail_(email, subject);
}

function reservationHasSentMail_(email, subject) {
  const safeEmail = String(email).replace(/"/g, '');
  const safeSubject = String(subject).replace(/"/g, '');
  const query =
    'in:sent newer_than:' + RESERVATION_MAIL_CONFIG.sentMailLookbackDays + 'd ' +
    'to:"' + safeEmail + '" subject:"' + safeSubject + '"';

  return GmailApp.search(query, 0, 1).length > 0;
}

function reservationIsStandardPayment_(paymentMethod) {
  return paymentMethod === RESERVATION_MAIL_CONFIG.paymentMethods.coin ||
    paymentMethod === RESERVATION_MAIL_CONFIG.paymentMethods.livePocket;
}

function reservationIsCancelRequested_(value) {
  const text = reservationText_(value);
  return text.toLowerCase() === 'cancel' || text === 'キャンセル';
}

function reservationIsChecked_(value) {
  return value === true ||
    String(value).trim().toUpperCase() === 'TRUE' ||
    String(value).trim() === '✓';
}

function reservationText_(value) {
  return String(value == null ? '' : value).trim();
}

function reservationGetOrCreateReportSheet_(ss, sheetName) {
  return ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
}

function reservationColumnToLetter_(column) {
  let result = '';
  let value = column;

  while (value > 0) {
    value--;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }

  return result;
}

function reservationFindTimestampColumn_(source) {
  const headers = source
    .getRange(RESERVATION_MAIL_CONFIG.headerRow, 1, 1, source.getLastColumn())
    .getDisplayValues()[0]
    .map(reservationText_);
  const index = headers.indexOf(RESERVATION_MAIL_CONFIG.timestampHeader);

  if (index < 0) {
    throw new Error(
      RESERVATION_MAIL_CONFIG.headerRow + '行目に「' +
      RESERVATION_MAIL_CONFIG.timestampHeader + '」列が見つかりません。'
    );
  }

  return index + 1;
}
