/**
 * JOPT 2026 Tokyo #02 / NLH 3on3 reservation mail REPORT tool.
 *
 * Source sheet:
 * - 3on3: Japanese applications and Japanese mail templates.
 *
 * Mail copy source: user-provided original text.
 * Operational rules:
 * - Hidden rows are still read.
 * - Duplicate applications are merged by representative email first, then GameID; the latest timestamp wins.
 * - E列 キャンセル has the highest priority.
 * - Normal mails never include rows where E列 キャンセル is TRUE.
 * - X列 メール指示 can force Main Ticket confirmation mail only when it is ticket要確認.
 */

const R3ON3 = {
  from: 'customer@japanopenpoker.com',
  fromName: 'Japan Open Poker Tour / JOPT',
  bcc: 'customer@japanopenpoker.com',
  createDraftsWhenBuildingReport: true,
  excludeAlreadySentByGmail: false,
  sentMailLookbackDays: 365,
  headerRow: 13,
  dataStartRow: 14,
  manualInstructionColumn: 24, // X
  sheets: {
    jp: {
      name: '3on3',
      menuLabel: '日本語',
      eventName: 'JOPT 2026 Tokyo #02 / NLH 3on3',
      customerNameSuffix: ' 様',
      deadlineLabel: '23:59まで',
      hasFinalNotice: true
    }
  },
  columns: {
    paymentInviteSent: 1,
    paymentConfirmed: 2,
    entryDone: 3,
    dayGuideSent: 4,
    cancel: 5,
    paymentDeadline: 6,
    timestamp: 7,
    playerName: 8,
    email: 9,
    gameId: 10,
    mainTicketChoice: 11,
    paymentMethod: 12,
    facilityPaymentMethod: 13
  }
};

const R3ON3_REPORT_HEADERS = [
  '元行',
  'メール種別',
  '言語',
  'メールアドレス',
  'プレイヤーネーム',
  'GameID',
  '決済区分',
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
  reservation3on3MailReportOnOpen();
}

function reservation3on3MailReportOnOpen() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('3on3事前予約メールREPORT')
    .addItem('初期設定：期限列・X列を準備', 'setup3on3ReservationDeadlineAndColumns')
    .addItem('診断REPORT：読み取り結果を確認', 'create3on3ReadDiagnosticReport')
    .addSeparator()
    .addItem('30,000 COIN支払案内', 'create3on3JpFullCoinPaymentInviteReport')
    .addItem('30,000 LivePocket支払案内', 'create3on3JpFullLivePocketPaymentInviteReport')
    .addItem('Main Ticket確認依頼', 'create3on3JpNoMainTicketReport')
    .addSeparator()
    .addItem('Ticket+9,000 COIN支払案内', 'create3on3JpTicketCoinPaymentInviteReport')
    .addItem('Ticket+9,000 LivePocket支払案内', 'create3on3JpTicketLivePocketPaymentInviteReport')
    .addSeparator()
    .addItem('選手契約履行 当日案内', 'create3on3JpContractConfirmedReport')
    .addItem('Ticket+選手契約履行 当日案内', 'create3on3JpTicketContractConfirmedReport')
    .addItem('決済完了・当日案内', 'create3on3JpPaymentConfirmedReport')
    .addSeparator()
    .addItem('支払い最終案内', 'create3on3JpPaymentFinalNoticeReport')
    .addItem('キャンセル通知', 'create3on3JpCancelReport')
    .addSeparator()
    .addItem('期限超過者をキャンセル候補としてE列TRUEにする', 'mark3on3OverdueRowsAsCancelCandidates')
    .addSeparator()
    .addItem('開いているREPORTのGmail下書きを一括作成', 'createDraftsFromActive3on3ReservationReport')
    .addItem('開いているREPORTの送信OKメールを送信', 'sendApprovedFromActive3on3ReservationReport')
    .addToUi();
}

function create3on3JpFullCoinPaymentInviteReport() { reservation3on3RunReport_('jp', 'full_coin'); }
function create3on3JpFullLivePocketPaymentInviteReport() { reservation3on3RunReport_('jp', 'full_livepocket'); }
function create3on3JpNoMainTicketReport() { reservation3on3RunReport_('jp', 'no_ticket'); }
function create3on3JpTicketCoinPaymentInviteReport() { reservation3on3RunReport_('jp', 'ticket_coin'); }
function create3on3JpTicketLivePocketPaymentInviteReport() { reservation3on3RunReport_('jp', 'ticket_livepocket'); }
function create3on3JpContractConfirmedReport() { reservation3on3RunReport_('jp', 'contract'); }
function create3on3JpTicketContractConfirmedReport() { reservation3on3RunReport_('jp', 'ticket_contract'); }
function create3on3JpPaymentConfirmedReport() { reservation3on3RunReport_('jp', 'payment_confirmed'); }
function create3on3JpPaymentFinalNoticeReport() { reservation3on3RunReport_('jp', 'final_notice'); }
function create3on3JpCancelReport() { reservation3on3RunReport_('jp', 'cancel'); }

function create3on3ReadDiagnosticReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const source = ss.getSheetByName(R3ON3.sheets.jp.name);
  if (!source) throw new Error('元シート「' + R3ON3.sheets.jp.name + '」が見つかりません。');

  const rows = reservation3on3ReadLatestRows_(source, 'jp');
  const output = [[
    '元行',
    '最新採用',
    '重複キー',
    'タイムスタンプ',
    'Eキャンセル',
    'A決済案内',
    'B決済確認',
    'D当日案内',
    'H代表者名',
    'Iメール',
    'J代表者GameID',
    'K Main Ticket選択',
    'L 30,000決済方法',
    'M 9,000決済方法',
    'Xメール指示',
    'Ticket利用判定',
    'Ticket確認メール判定',
    '有効決済方法',
    '通常メール対象',
    'Ticket+LivePocket対象'
  ]];

  rows.forEach(row => {
    output.push([
      row.sourceRow,
      row.isLatest ? 'YES' : 'NO',
      row.dedupeKey,
      row.timestamp,
      row.cancelChecked,
      row.paymentInviteSent,
      row.paymentConfirmed,
      row.dayGuideSent,
      row.playerName,
      row.email,
      row.gameId,
      row.mainTicketChoice,
      row.paymentMethod,
      row.facilityPaymentMethod,
      row.manualInstruction,
      row.usesMainTicket,
      row.ticketNeedsConfirmation,
      row.effectivePaymentMethod,
      reservation3on3NormalMailTarget_(row),
      reservation3on3NormalMailTarget_(row) &&
        !row.paymentInviteSent &&
        !row.paymentConfirmed &&
        row.usesMainTicket &&
        !row.ticketNeedsConfirmation &&
        reservation3on3IsLivePocket_(row.facilityPaymentMethod)
    ]);
  });

  const report = reservation3on3GetOrCreateReportSheet_(ss, 'REPORT_3ON3_DIAGNOSTIC');
  report.clear();
  report.getRange(1, 1, output.length, output[0].length).setValues(output);
  report.getRange(1, 1, 1, output[0].length).setFontWeight('bold').setBackground('#fff2cc');
  report.setFrozenRows(1);
  report.autoResizeColumns(1, output[0].length);
  report.activate();
}

function reservation3on3RunReport_(lang, type) {
  const definition = reservation3on3Definition_(lang, type);
  reservation3on3BuildReport_(definition);
}

function reservation3on3Definition_(lang, type) {
  const sheetConfig = R3ON3.sheets[lang];
  const labelPrefix = sheetConfig.menuLabel;
  const defs = {
    full_coin: {
      sheetName: 'REPORT_3ON3_' + lang.toUpperCase() + '_FULL_COIN',
      mailType: labelPrefix + ' 30,000 COIN支払案内',
      mark: 'payment_invite',
      matches: row => reservation3on3NormalMailTarget_(row) &&
        !row.paymentInviteSent && !row.paymentConfirmed && !row.usesMainTicket &&
        reservation3on3IsCoin_(row.paymentMethod),
      makeMail: row => reservation3on3Mail_(lang, 'full_coin', row)
    },
    full_livepocket: {
      sheetName: 'REPORT_3ON3_' + lang.toUpperCase() + '_FULL_LIVEPOCKET',
      mailType: labelPrefix + ' 30,000 LivePocket支払案内',
      mark: 'payment_invite',
      matches: row => reservation3on3NormalMailTarget_(row) &&
        !row.paymentInviteSent && !row.paymentConfirmed && !row.usesMainTicket &&
        reservation3on3IsLivePocket_(row.paymentMethod),
      makeMail: row => reservation3on3Mail_(lang, 'full_livepocket', row)
    },
    no_ticket: {
      sheetName: 'REPORT_3ON3_' + lang.toUpperCase() + '_NO_MAIN_TICKET',
      mailType: labelPrefix + ' Main Ticket確認依頼',
      mark: 'ticket_confirm',
      matches: row => reservation3on3NormalMailTarget_(row) &&
        row.usesMainTicket && row.ticketNeedsConfirmation && !row.paymentConfirmed,
      makeMail: row => reservation3on3Mail_(lang, 'no_ticket', row)
    },
    ticket_coin: {
      sheetName: 'REPORT_3ON3_' + lang.toUpperCase() + '_TICKET_COIN',
      mailType: labelPrefix + ' Ticket+9,000 COIN支払案内',
      mark: 'payment_invite',
      matches: row => reservation3on3NormalMailTarget_(row) &&
        !row.paymentInviteSent && !row.paymentConfirmed && row.usesMainTicket &&
        !row.ticketNeedsConfirmation && reservation3on3IsCoin_(row.facilityPaymentMethod),
      makeMail: row => reservation3on3Mail_(lang, 'ticket_coin', row)
    },
    ticket_livepocket: {
      sheetName: 'REPORT_3ON3_' + lang.toUpperCase() + '_TICKET_LIVEPOCKET',
      mailType: labelPrefix + ' Ticket+9,000 LivePocket支払案内',
      mark: 'payment_invite',
      matches: row => reservation3on3NormalMailTarget_(row) &&
        !row.paymentInviteSent && !row.paymentConfirmed && row.usesMainTicket &&
        !row.ticketNeedsConfirmation && reservation3on3IsLivePocket_(row.facilityPaymentMethod),
      makeMail: row => reservation3on3Mail_(lang, 'ticket_livepocket', row)
    },
    contract: {
      sheetName: 'REPORT_3ON3_' + lang.toUpperCase() + '_CONTRACT',
      mailType: labelPrefix + ' 選手契約履行 当日案内',
      mark: 'day_guide',
      matches: row => reservation3on3NormalMailTarget_(row) &&
        !row.dayGuideSent && !row.usesMainTicket && reservation3on3IsContract_(row.paymentMethod),
      makeMail: row => reservation3on3Mail_(lang, 'contract', row)
    },
    ticket_contract: {
      sheetName: 'REPORT_3ON3_' + lang.toUpperCase() + '_TICKET_CONTRACT',
      mailType: labelPrefix + ' Ticket+選手契約履行 当日案内',
      mark: 'day_guide',
      matches: row => reservation3on3NormalMailTarget_(row) &&
        !row.dayGuideSent && row.usesMainTicket &&
        !row.ticketNeedsConfirmation && reservation3on3IsContract_(row.facilityPaymentMethod),
      makeMail: row => reservation3on3Mail_(lang, 'ticket_contract', row)
    },
    payment_confirmed: {
      sheetName: 'REPORT_3ON3_' + lang.toUpperCase() + '_PAYMENT_CONFIRMED',
      mailType: labelPrefix + ' 決済完了・当日案内',
      mark: 'day_guide',
      matches: row => reservation3on3NormalMailTarget_(row) &&
        row.paymentConfirmed && !row.dayGuideSent &&
        !reservation3on3IsContract_(row.paymentMethod) &&
        !reservation3on3IsContract_(row.facilityPaymentMethod),
      makeMail: row => reservation3on3Mail_(lang, 'payment_confirmed', row)
    },
    final_notice: {
      sheetName: 'REPORT_3ON3_' + lang.toUpperCase() + '_FINAL_NOTICE',
      mailType: labelPrefix + ' 支払い最終案内',
      mark: '',
      matches: row => reservation3on3NormalMailTarget_(row) &&
        row.paymentInviteSent && !row.paymentConfirmed && !row.dayGuideSent,
      makeMail: row => reservation3on3Mail_(lang, 'final_notice', row)
    },
    cancel: {
      sheetName: 'REPORT_3ON3_' + lang.toUpperCase() + '_CANCEL',
      mailType: labelPrefix + ' キャンセル通知',
      mark: 'cancel',
      matches: row => row.isLatest && row.cancelChecked && !row.cancelNoticeSent,
      makeMail: row => reservation3on3Mail_(lang, 'cancel', row)
    }
  };
  if (!defs[type]) throw new Error('Unknown report type: ' + type);
  if (type === 'final_notice' && !sheetConfig.hasFinalNotice) {
    throw new Error('English final notice template has not been provided.');
  }
  return Object.assign({ lang, sourceSheetName: sheetConfig.name }, defs[type]);
}

function reservation3on3NormalMailTarget_(row) {
  return row.isLatest && !row.cancelChecked;
}

function setup3on3ReservationDeadlineAndColumns() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let updatedSheets = 0;
  Object.keys(R3ON3.sheets).forEach(lang => {
    const cfg = R3ON3.sheets[lang];
    const sheet = ss.getSheetByName(cfg.name);
    if (!sheet) return;
    reservation3on3SetupOneSheet_(sheet);
    updatedSheets++;
  });
  SpreadsheetApp.getUi().alert('初期設定が完了しました。\n対象シート: ' + updatedSheets);
}

function reservation3on3SetupOneSheet_(sheet) {
  const c = R3ON3.columns;
  sheet.getRange(R3ON3.headerRow, R3ON3.manualInstructionColumn).setValue('メール指示');
  const instructionRange = sheet.getRange(
    R3ON3.dataStartRow,
    R3ON3.manualInstructionColumn,
    Math.max(sheet.getMaxRows() - R3ON3.dataStartRow + 1, 1),
    1
  );
  const validation = SpreadsheetApp.newDataValidation()
    .requireValueInList(['', 'ticket要確認', 'ticket確認メール済', 'キャンセル通知済'], true)
    .setAllowInvalid(true)
    .build();
  instructionRange.setDataValidation(validation);
  const lastRow = Math.max(sheet.getLastRow(), R3ON3.dataStartRow);
  const dataRows = lastRow - R3ON3.dataStartRow + 1;
  const timestamps = sheet.getRange(R3ON3.dataStartRow, c.timestamp, dataRows, 1).getValues();
  const existingDeadlines = sheet.getRange(R3ON3.dataStartRow, c.paymentDeadline, dataRows, 1).getValues();
  const deadlineValues = timestamps.map((row, index) => [
    reservation3on3ValidDate_(existingDeadlines[index][0]) ||
    reservation3on3CalculateDeadline_(row[0])
  ]);
  sheet.getRange(R3ON3.dataStartRow, c.paymentDeadline, dataRows, 1)
    .setValues(deadlineValues)
    .setNumberFormat('m/d(aaa)');
}

function mark3on3OverdueRowsAsCancelCandidates() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let count = 0;
  Object.keys(R3ON3.sheets).forEach(lang => {
    const sheet = ss.getSheetByName(R3ON3.sheets[lang].name);
    if (!sheet) return;
    const cells = reservation3on3ReadLatestRows_(sheet, lang)
      .filter(row => row.isLatest && !row.cancelChecked && !row.paymentConfirmed && row.deadlineDate &&
        row.deadlineDate.getTime() < reservation3on3Today_().getTime())
      .map(row => 'E' + row.sourceRow);
    if (cells.length) {
      sheet.getRangeList(cells).setValue(true);
      count += cells.length;
    }
  });
  SpreadsheetApp.getUi().alert('期限超過者をE列キャンセル候補にしました。\n更新: ' + count + '件');
}

function reservation3on3BuildReport_(definition) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const source = ss.getSheetByName(definition.sourceSheetName);
  if (!source) throw new Error('元シート「' + definition.sourceSheetName + '」が見つかりません。');

  const output = [];
  const gmailLinks = [];
  let createdDrafts = 0;
  let reusedDrafts = 0;
  let draftErrors = 0;
  let skippedAsAlreadySent = 0;
  const rows = reservation3on3ReadLatestRows_(source, definition.lang);

  rows.forEach(row => {
    if (!row.email || !row.playerName || !definition.matches(row)) return;
    const mail = definition.makeMail(row);
    if (reservation3on3WasAlreadySent_(row.email, mail.subject)) {
      skippedAsAlreadySent++;
      return;
    }

    let draftId = '';
    let draftStatus = '';
    if (R3ON3.createDraftsWhenBuildingReport) {
      try {
        const draftResult = reservation3on3FindOrCreateDraft_(row.email, mail.subject, mail.body);
        draftId = draftResult.draftId;
        draftStatus = draftResult.reused ? '既存下書きを使用' : '下書き作成済み';
        if (draftResult.reused) reusedDrafts++;
        else createdDrafts++;
      } catch (error) {
        draftStatus = '下書き作成エラー: ' + error.message;
        draftErrors++;
      }
    }

    output.push([
      row.sourceRow,
      definition.mailType,
      R3ON3.sheets[definition.lang].menuLabel,
      row.email,
      row.playerName,
      row.gameId,
      row.mainTicketChoice,
      row.effectivePaymentMethod,
      row.deadlineWithTime,
      mail.subject,
      mail.body,
      'Gmailで作成',
      false,
      draftId,
      draftStatus,
      ''
    ]);
    gmailLinks.push(reservation3on3BuildGmailComposeUrl_(row.email, mail.subject, mail.body));
  });

  const report = reservation3on3GetOrCreateReportSheet_(ss, definition.sheetName);
  report.clear();
  report.getRange(1, 1, 1, R3ON3_REPORT_HEADERS.length)
    .setValues([R3ON3_REPORT_HEADERS])
    .setFontWeight('bold')
    .setBackground('#d9ead3');
  report.setFrozenRows(1);

  if (output.length) {
    report.getRange(2, 1, output.length, R3ON3_REPORT_HEADERS.length).setValues(output);
    const richLinks = gmailLinks.map(url => [
      SpreadsheetApp.newRichTextValue().setText('Gmailで作成').setLinkUrl(url).build()
    ]);
    report.getRange(2, 12, richLinks.length, 1).setRichTextValues(richLinks);
    report.getRange(2, 13, output.length, 1).insertCheckboxes();
  }

  report.autoResizeColumns(1, 10);
  report.setColumnWidth(11, 540);
  report.setColumnWidth(12, 140);
  report.getRange(1, 1, Math.max(output.length + 1, 1), R3ON3_REPORT_HEADERS.length)
    .setVerticalAlignment('top');
  report.getRange(2, 11, Math.max(output.length, 1), 1).setWrap(true);
  report.activate();

  const duplicateMessage = R3ON3.excludeAlreadySentByGmail
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

function createDraftsFromActive3on3ReservationReport() {
  const sheet = reservation3on3GetActiveReportSheet_();
  const lastRow = sheet.getLastRow();
  let created = 0;
  for (let row = 2; row <= lastRow; row++) {
    const values = sheet.getRange(row, 1, 1, R3ON3_REPORT_HEADERS.length).getValues()[0];
    if (!values[3] || values[13] || values[14] === '送信済み') continue;
    try {
      const draftResult = reservation3on3FindOrCreateDraft_(values[3], values[9], values[10]);
      sheet.getRange(row, 14).setValue(draftResult.draftId);
      sheet.getRange(row, 15).setValue(draftResult.reused ? '既存下書きを使用' : '下書き作成済み');
      created++;
    } catch (error) {
      sheet.getRange(row, 15).setValue('下書き作成エラー: ' + error.message);
    }
  }
  SpreadsheetApp.getUi().alert('Gmail下書きを作成しました。\n作成: ' + created + '件');
}

function sendApprovedFromActive3on3ReservationReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const report = reservation3on3GetActiveReportSheet_();
  const lastRow = report.getLastRow();
  let sent = 0;
  let errors = 0;

  for (let row = 2; row <= lastRow; row++) {
    const values = report.getRange(row, 1, 1, R3ON3_REPORT_HEADERS.length).getValues()[0];
    const sourceRow = Number(values[0]);
    const mailType = reservation3on3Text_(values[1]);
    const langLabel = reservation3on3Text_(values[2]);
    const sendOk = reservation3on3IsChecked_(values[12]);
    const draftId = reservation3on3Text_(values[13]);
    const sendStatus = reservation3on3Text_(values[14]);
    if (!sendOk || !draftId || sendStatus === '送信済み') continue;

    try {
      GmailApp.getDraft(draftId).send();
      report.getRange(row, 15).setValue('送信済み');
      report.getRange(row, 16).setValue(new Date());
      reservation3on3UpdateSourceAfterSend_(ss, langLabel, sourceRow, mailType);
      sent++;
    } catch (error) {
      report.getRange(row, 15).setValue('送信エラー: ' + error.message);
      errors++;
    }
  }

  SpreadsheetApp.getUi().alert('送信処理が完了しました。\n送信: ' + sent + '件\nエラー: ' + errors + '件');
}

function reservation3on3UpdateSourceAfterSend_(ss, langLabel, sourceRow, mailType) {
  const source = ss.getSheetByName(R3ON3.sheets.jp.name);
  if (!source) return;
  const c = R3ON3.columns;
  if (mailType.indexOf('支払案内') >= 0 || mailType.indexOf('Payment Instructions') >= 0) {
    source.getRange(sourceRow, c.paymentInviteSent).setValue(true);
    const deadline =
      reservation3on3ValidDate_(source.getRange(sourceRow, c.paymentDeadline).getValue()) ||
      reservation3on3CalculateDeadline_(source.getRange(sourceRow, c.timestamp).getValue());
    source.getRange(sourceRow, c.paymentDeadline).setValue(deadline).setNumberFormat('m/d(aaa)');
  }
  if (mailType.indexOf('Main Ticket確認依頼') >= 0) {
    reservation3on3SetManualInstruction_(source, sourceRow, 'ticket確認メール済');
  }
  if (mailType.indexOf('当日案内') >= 0 || mailType.indexOf('Day Info') >= 0 || mailType.indexOf('Payment Confirmed') >= 0) {
    source.getRange(sourceRow, c.dayGuideSent).setValue(true);
  }
  if (mailType.indexOf('キャンセル') >= 0 || mailType.indexOf('Cancellation') >= 0) {
    source.getRange(sourceRow, c.cancel).setValue(true);
    reservation3on3SetManualInstruction_(source, sourceRow, 'キャンセル通知済');
  }
}

function reservation3on3ReadLatestRows_(sheet, lang) {
  const lastRow = sheet.getLastRow();
  if (lastRow < R3ON3.dataStartRow) return [];
  const readCols = Math.max(sheet.getLastColumn(), R3ON3.manualInstructionColumn);
  const values = sheet.getRange(R3ON3.dataStartRow, 1, lastRow - R3ON3.dataStartRow + 1, readCols).getValues();
  const rows = values.map((rowValues, index) =>
    reservation3on3ParseSourceRow_(rowValues, R3ON3.dataStartRow + index, lang)
  );
  const latestByKey = {};
  const manualInstructionByKey = {};
  const cancelNoticeSentByKey = {};
  rows.forEach(row => {
    if (!row.dedupeKey) return;
    const existing = latestByKey[row.dedupeKey];
    if (!existing || reservation3on3CompareRowFreshness_(row, existing) > 0) {
      latestByKey[row.dedupeKey] = row;
    }
    if (row.ticketNeedsConfirmation) {
      manualInstructionByKey[row.dedupeKey] = row.manualInstruction || 'ticket確認';
    }
    if (row.cancelNoticeSent) {
      cancelNoticeSentByKey[row.dedupeKey] = true;
    }
  });
  rows.forEach(row => {
    row.isLatest = latestByKey[row.dedupeKey] === row;
    if (row.isLatest && manualInstructionByKey[row.dedupeKey]) {
      row.manualInstruction = manualInstructionByKey[row.dedupeKey];
      row.ticketNeedsConfirmation = true;
    }
    if (row.isLatest && cancelNoticeSentByKey[row.dedupeKey]) {
      row.cancelNoticeSent = true;
    }
  });
  return rows;
}

function reservation3on3CompareRowFreshness_(a, b) {
  const at = a.timestampDate ? a.timestampDate.getTime() : 0;
  const bt = b.timestampDate ? b.timestampDate.getTime() : 0;
  if (at !== bt) return at - bt;
  return a.sourceRow - b.sourceRow;
}

function reservation3on3ParseSourceRow_(values, sourceRow, lang) {
  const c = R3ON3.columns;
  const timestamp = values[c.timestamp - 1];
  const timestampDate = reservation3on3ValidDate_(timestamp);
  const deadlineDate =
    reservation3on3ValidDate_(values[c.paymentDeadline - 1]) ||
    reservation3on3CalculateDeadline_(timestamp);
  const playerName = reservation3on3Text_(values[c.playerName - 1]);
  const email = reservation3on3Text_(values[c.email - 1]);
  const gameId = reservation3on3NormalizeGameId_(values[c.gameId - 1]);
  const mainTicketChoice = reservation3on3Text_(values[c.mainTicketChoice - 1]);
  const paymentMethod = reservation3on3Text_(values[c.paymentMethod - 1]);
  const facilityPaymentMethod = reservation3on3Text_(values[c.facilityPaymentMethod - 1]);
  const manualInstruction = reservation3on3Text_(values[R3ON3.manualInstructionColumn - 1]);
  const usesMainTicket = reservation3on3UsesMainTicket_(mainTicketChoice);
  const effectivePaymentMethod = usesMainTicket ? facilityPaymentMethod : paymentMethod;

  return {
    sourceRow,
    lang,
    timestamp,
    timestampDate,
    deadlineDate,
    paymentInviteSent: reservation3on3IsChecked_(values[c.paymentInviteSent - 1]),
    paymentConfirmed: reservation3on3IsChecked_(values[c.paymentConfirmed - 1]),
    entryDone: reservation3on3IsChecked_(values[c.entryDone - 1]),
    dayGuideSent: reservation3on3IsChecked_(values[c.dayGuideSent - 1]),
    cancelChecked: reservation3on3IsChecked_(values[c.cancel - 1]),
    playerName,
    email,
    gameId,
    mainTicketChoice,
    paymentMethod,
    facilityPaymentMethod,
    effectivePaymentMethod,
    usesMainTicket,
    manualInstruction,
    ticketNeedsConfirmation: reservation3on3TicketNeedsConfirmation_(manualInstruction),
    cancelNoticeSent: reservation3on3CancelNoticeSent_(manualInstruction),
    deadlineWithTime: reservation3on3FormatDeadline_(deadlineDate, true, lang),
    deadlineDateOnly: reservation3on3FormatDeadline_(deadlineDate, false, lang),
    dedupeKey: email ? 'mail:' + email.toLowerCase() : (gameId ? 'gid:' + gameId : 'row:' + sourceRow),
    isLatest: false
  };
}

function reservation3on3Mail_(lang, type, row) {
  return lang === 'en' ? reservation3on3MailEn_(type, row) : reservation3on3MailJp_(type, row);
}

function reservation3on3MailJp_(type, row) {
  const dayInfo = reservation3on3DayInfoJp_();
  const subjectPayment = '【JOPT 2026 Tokyo #02 / NLH 3on3】 事前決済のご案内';
  const subjectDay = '【JOPT 2026 Tokyo #02/ NLH 3on3】 決済完了および当日のご案内';
  const name = row.playerName + ' 様';
  const footer = `メールアドレス：customer＠japanopenpoker.com
公式LINE：https://lin.ee/ckO5p3F

営業時間：10時～19時 (水・日を除く)`;

  const templates = {
    full_coin: {
      subject: subjectPayment,
      body: `${name}

お世話になっております。
ジャパンオープンポーカーツアー株式会社の吉澤と申します。

この度は 「JOPT 2026 Tokyo #02 / NLH 3on3」 にお申込みいただき、誠にありがとうございます。
事前決済について詳細をお送りいたします。

■事前決済
Poker Web Coin にて「JOPTクラブ」宛に 30,000 coinをトランスファーしてください。
※フォームで入力いただいたGame IDで照合を行います。

➤トランスファー先：JOPTクラブ
➤金額：30,000 coin
➤トランスファー期限：${row.deadlineWithTime}
※期限までにお支払いが確認できなかった場合、自動的にキャンセルとなります。
※いかなる理由においても決済完了後のご返金は致しかねますので、予めご了承いただけますと幸いです。
※決済の確認が取れ次第、決済完了および当日のご案内メールをお送りいたします。

何かご不明な点がございましたら、下記の連絡先よりお気軽にお問い合わせくださいませ。

${footer}`
    },
    full_livepocket: {
      subject: subjectPayment,
      body: `${name}

お世話になっております。
ジャパンオープンポーカーツアー株式会社の吉澤と申します。

この度は 「JOPT 2026 Tokyo #02 / NLH 3on3」 にお申込みいただき、誠にありがとうございます。
事前決済について詳細をお送りいたします。

■事前決済
下記リンクからLive Pocket にてお支払いをお願いいたします。

➤お支払い用リンク：https://livepocket.jp/e/fsyv8
➤金額：30,000円
➤お支払い期限：${row.deadlineWithTime}
※期限までにお支払いが確認できなかった場合、自動的にキャンセルとなります。
※いかなる理由においても決済完了後のご返金は致しかねますので、予めご了承いただけますと幸いです。
※決済の確認が取れ次第、決済完了および当日のご案内メールをお送りいたします。

何かご不明な点がございましたら、下記の連絡先よりお気軽にお問い合わせくださいませ。

${footer}`
    },
    ticket_coin: {
      subject: subjectPayment,
      body: `${name}

お世話になっております。
ジャパンオープンポーカーツアー株式会社の吉澤と申します。

この度は 「JOPT 2026 Tokyo #02 / NLH 3on3」 にお申込みいただき、誠にありがとうございます。
事前決済について詳細をお送りいたします。

■事前決済
メインチケットの確認が取れました。
残額の決済につき、Poker Web Coin にて「JOPTクラブ」宛に 9,000 coinをトランスファーしてください。
※フォームで入力いただいたGame IDで照合を行います。

➤トランスファー先：JOPTクラブ
➤金額：9,000 coin
➤トランスファー期限：${row.deadlineWithTime}
※期限までにお支払いが確認できなかった場合、自動的にキャンセルとなります。
※いかなる理由においても決済完了後のご返金は致しかねますので、予めご了承いただけますと幸いです。
※決済の確認が取れ次第、決済完了および当日のご案内メールをお送りいたします。

何かご不明な点がございましたら、下記の連絡先よりお気軽にお問い合わせくださいませ。

${footer}`
    },
    ticket_livepocket: {
      subject: subjectPayment,
      body: `${name}

お世話になっております。
ジャパンオープンポーカーツアー株式会社の吉澤と申します。

この度は 「JOPT 2026 Tokyo #02 / NLH 3on3」 にお申込みいただき、誠にありがとうございます。
事前決済について詳細をお送りいたします。

■事前決済
メインチケットの確認が取れました。
残額の決済につき、下記リンクからLive Pocket にてお支払いをお願いいたします。

➤お支払い用リンク：https://livepocket.jp/e/ifb5x
➤金額：9,000円
➤お支払い期限：${row.deadlineWithTime}
※期限までにお支払いが確認できなかった場合、自動的にキャンセルとなります。
※いかなる理由においても決済完了後のご返金は致しかねますので、予めご了承いただけますと幸いです。
※決済の確認が取れ次第、決済完了および当日のご案内メールをお送りいたします。

何かご不明な点がございましたら、下記の連絡先よりお気軽にお問い合わせくださいませ。

${footer}`
    },
    contract: {
      subject: subjectDay,
      body: `${name}

お世話になっております。
ジャパンオープンポーカーツアー株式会社の吉澤と申します。

この度は 「JOPT 2026 Tokyo #02 / NLH 3on3」 にお申込みいただき、誠にありがとうございます。

選手契約履行にて事前決済が完了いたしました。
つきましては、当日のご案内を以下の通りお知らせいたします。

${dayInfo}


何かご不明な点がございましたら、下記の連絡先よりお気軽にお問い合わせくださいませ。

${footer}`
    },
    ticket_contract: {
      subject: subjectDay,
      body: `${name}

お世話になっております。
ジャパンオープンポーカーツアー株式会社の吉澤と申します。

この度は 「JOPT 2026 Tokyo #02 / NLH 3on3」 にお申込みいただき、誠にありがとうございます。

チケットと選手契約履行にて事前決済が完了いたしました。
つきましては、当日のご案内を以下の通りお知らせいたします。

${dayInfo}


何かご不明な点がございましたら、下記の連絡先よりお気軽にお問い合わせくださいませ。

${footer}`
    },
    payment_confirmed: {
      subject: '【JOPT 2026 Tokyo #02/ NLH 3on3】 当日のご案内',
      body: `${name}

お世話になっております。
ジャパンオープンポーカーツアー株式会社の吉澤と申します。
この度は「JOPT 2026 Tokyo #02 / NLH 3on3」にお申込みいただき、誠にありがとうございます。

決済の確認が取れましたので、お申込みが完了いたしました。
つきましては、当日のご案内を以下の通りお知らせいたします。

${dayInfo}

ご不明点がございましたらお気軽にご連絡ください。
よろしくお願いいたします。

メールアドレス：customer＠japanopenpoker.com
公式LINE：https://lin.ee/ckO5p3F
営業時間：10時～19時 (水・日を除く)`
    },
    no_ticket: {
      subject: '【JOPT 2026 Tokyo #02 / NLH 3on3】お申込み内容ご確認のお願い',
      body: `${name}

お世話になっております。
ジャパンオープンポーカーツアー株式会社の吉澤でございます。

このたびは「JOPT 2026 Tokyo #02　/ NLH 3on3」にお申込みいただき、誠にありがとうございます。

お申込み内容を確認したところ、代表者様のGame IDにて、JOPT Main Ticketの所持確認ができておりませんでした。

恐れ入りますが、内容をご確認のうえ、ご対応いただけますと幸いです。

確認が取れ次第、順次ご案内・対応を進めてまいります。
何卒よろしくお願いいたします。


${footer}`
    },
    final_notice: {
      subject: '【重要】決済に関する最終案内 【JOPT 2026 Tokyo #02 / NLH 3on3】',
      body: `${name}

お世話になっております。
ジャパンオープンポーカーツアー株式会社の澤木でございます。

「JOPT 2026 Tokyo #02 / NLH 3on3」 のご参加に関するお支払いにつきまして、
ご案内の通り、お支払い期日は【　7月13日】までとなっております。

本件につきまして、当日のスムーズな運営および枠の確保の都合上、期日までにお手続きをお願いしております。

お支払いが期日までに完了しなかった場合は、自動的にキャンセル扱いとなり、参加枠は無効となります。  
また、当日受付は事前予約で定員に余裕がある場合に限り実施し、先着順でのご案内となります。

今回のご参加を見送られる場合、または参加のご意思があり期日までにお支払い予定の場合も、確認のためご連絡いただけますと幸いです。

つきましては、期日までにお支払い手続きをお願いいたします。

お手数をおかけいたしますが、何卒よろしくお願いいたします。


${footer}`
    },
    cancel: {
      subject: '【JOPT 2026 Tokyo #02 / NLH 3on3】 申込のキャンセルについて',
      body: `${name}

お世話になっております。
ジャパンオープンポーカーツアー株式会社の吉澤でございます。

この度は、「JOPT 2026 Tokyo #02 / NLH 3on3」へお申し込みいただき、誠にありがとうございます。

ご連絡を差し上げておりましたが、現時点までにご返信をいただけていないため、誠に恐縮ではございますが、今回のお申込みはキャンセルとさせていただきました。

なお、現在もお申し込み受付中となっておりますので、
再度ご参加をご希望の場合は、改めてお申し込みいただけますと幸いです。

何かご不明な点がございましたら、下記の連絡先よりお気軽にお問い合わせくださいませ。

${footer}`
    }
  };
  if (!templates[type]) throw new Error('Unknown Japanese mail type: ' + type);
  return templates[type];
}

function reservation3on3DayInfoJp_() {
  return `■大会概要
・会場：ベルサール高田馬場
　住所：〒169-0072 東京都新宿区大久保3-8-2 
　　　　住友不動産新宿ガーデンタワーB2・1F
・日時：2026年7月16日(木) 20:00 トーナメント開始
・受付開始：19:00
　受付終了：19:45
・当日お支払い金額：ドリンクチケット 3,000円

■受付に関して
・当日は３名お揃いになられてから、代表者様のみ受付をされてください。
・トーナメント開始時間までに受付を完了されていない場合は、着席されるまでの間、置きバケとなりゲームは進行します。置きバケ中は、BTNは移動しブラインドは都度回収されます。
・事前決済いただいた分につきましてはご参加できなかった場合もご返金致しかねます。
・リエントリーはございません。`;
}

function reservation3on3MailEn_(type, row) {
  const name = row.playerName ? 'Dear ' + row.playerName + ',' : 'Dear ,';
  const footer = `If you have any questions, please feel free to contact us using the information below.

Email: customer@japanopenpoker.com
Official LINE: https://lin.ee/ckO5p3F

Business Hours: 10:00 AM-7:00 PM
(excluding Wednesdays and Sundays)`;
  const dayInfo = `■ Tournament Information

・Venue: Bellesalle Takadanobaba
　Address: Shinjuku Garden Tower B2 and 1F
　3-8-2 Okubo, Shinjuku-ku, Tokyo 169-0072

・Date and Time: Thursday, July 16, 2026
　Tournament begins at 8:00 PM

・Registration Opens: 7:00 PM
　Registration Closes: 7:45 PM

・Payment Required on the Day:
　JPY 3,000 for drink tickets

■ Registration Information

・Please come to the registration desk after all three team members have arrived. Only the team representative should complete the registration process.

・If registration has not been completed by the tournament start time, your stack will be placed at the table and the game will proceed until you are seated. During this time, the dealer button will continue to move and the blinds will be collected as usual.

・Advance payments are non-refundable even if you are unable to participate.

・Re-entry is not available.`;

  const templates = {
    full_coin: {
      subject: '[JOPT 2026 Tokyo #02 / NLH 3on3] Advance Payment Instructions',
      body: `${name}

This is Yoshizawa from the Japan Open Poker Tour.

Thank you for registering for “JOPT 2026 Tokyo #02 / NLH 3on3.”

Please find the advance payment instructions below.

■ Advance Payment

Please transfer 30,000 Poker Web Coins to “JOPT Club.”

※ We will confirm the payment using the Game ID provided in the registration form.

➤ Transfer Recipient: JOPT Club
➤ Amount: 30,000 coins
➤ Payment Deadline: ${row.deadlineWithTime}

※ If we are unable to confirm your payment by the deadline, your registration will be automatically canceled.
※ Please note that payments are non-refundable under any circumstances once completed.
※ Once your payment has been confirmed, we will send you a payment confirmation email together with information for the tournament day.

${footer}`
    },
    full_livepocket: {
      subject: '[JOPT 2026 Tokyo #02 / NLH 3on3] Advance Payment Instructions',
      body: `${name}

This is Yoshizawa from the Japan Open Poker Tour.

Thank you for registering for “JOPT 2026 Tokyo #02 / NLH 3on3.”

Please find the advance payment instructions below.

■ Advance Payment

Please complete your payment through LivePocket using the link below.

➤ Payment Link: https://livepocket.jp/e/fsyv8
➤ Amount: JPY 30,000
➤ Payment Deadline: ${row.deadlineWithTime}

※ If we are unable to confirm your payment by the deadline, your registration will be automatically canceled.
※ Please note that payments are non-refundable under any circumstances once completed.
※ Once your payment has been confirmed, we will send you a payment confirmation email together with information for the tournament day.

${footer}`
    },
    no_ticket: {
      subject: '[JOPT 2026 Tokyo #02 / NLH 3on3] Main Ticket Confirmation Required',
      body: `${name}

This is Yoshizawa from the Japan Open Poker Tour.

Thank you for registering for “JOPT 2026 Tokyo #02 / NLH 3on3.”

After reviewing your registration, we were unable to confirm that the team representative holds a JOPT Main Ticket under the Game ID provided.

Please review the information and take the necessary action.

Once we are able to confirm the ticket, we will proceed with the next steps.

Thank you for your cooperation.

${footer}`
    },
    ticket_coin: {
      subject: '[JOPT 2026 Tokyo #02 / NLH 3on3] Advance Payment Instructions',
      body: `${name}

This is Yoshizawa from the Japan Open Poker Tour.

Thank you for registering for “JOPT 2026 Tokyo #02 / NLH 3on3.”

Please find the advance payment instructions below.

■ Advance Payment

We have confirmed your Main Event Ticket.

To pay the remaining balance, please transfer 9,000 Poker Web Coins to “JOPT Club.”

※ We will confirm the payment using the Game ID provided in the registration form.

➤ Transfer Recipient: JOPT Club
➤ Amount: 9,000 coins
➤ Payment Deadline: ${row.deadlineWithTime}

※ If we are unable to confirm your payment by the deadline, your registration will be automatically canceled.
※ Please note that payments are non-refundable under any circumstances once completed.
※ Once your payment has been confirmed, we will send you a payment confirmation email together with information for the tournament day.

${footer}`
    },
    ticket_livepocket: {
      subject: '[JOPT 2026 Tokyo #02 / NLH 3on3] Advance Payment Instructions',
      body: `${name}

This is Yoshizawa from the Japan Open Poker Tour.

Thank you for registering for “JOPT 2026 Tokyo #02 / NLH 3on3.”

Please find the advance payment instructions below.

■ Advance Payment

We have confirmed your Main Event Ticket.

To pay the remaining balance, please complete your payment through LivePocket using the link below.

➤ Payment Link: https://livepocket.jp/e/ifb5x
➤ Amount: JPY 9,000
➤ Payment Deadline: ${row.deadlineWithTime}

※ If we are unable to confirm your payment by the deadline, your registration will be automatically canceled.
※ Please note that payments are non-refundable under any circumstances once completed.
※ Once your payment has been confirmed, we will send you a payment confirmation email together with information for the tournament day.

${footer}`
    },
    contract: {
      subject: '[JOPT 2026 Tokyo #02 / NLH 3on3] Registration Confirmation and Tournament Day Information',
      body: `${name}

This is Yoshizawa from the Japan Open Poker Tour.

Thank you for registering for “JOPT 2026 Tokyo #02 / NLH 3on3.”

Your advance payment has been completed through the player contract arrangement.

Please find the tournament day information below.

${dayInfo}

${footer}`
    },
    ticket_contract: {
      subject: '[JOPT 2026 Tokyo #02 / NLH 3on3] Registration Confirmation and Tournament Day Information',
      body: `${name}

This is Yoshizawa from the Japan Open Poker Tour.

Thank you for registering for “JOPT 2026 Tokyo #02 / NLH 3on3.”

Your advance payment has been completed using a Main Event Ticket and through the player contract arrangement.

Please find the tournament day information below.

${dayInfo}

${footer}`
    },
    payment_confirmed: {
      subject: '[JOPT 2026 Tokyo #02 / NLH 3on3] Registration Confirmation and Tournament Day Information',
      body: `${name}

This is Yoshizawa from the Japan Open Poker Tour.

Thank you for registering for “JOPT 2026 Tokyo #02 / NLH 3on3.”

We have confirmed your payment, and your registration is now complete.

Please find the tournament day information below.

${dayInfo}

${footer}`
    },
    cancel: {
      subject: '[JOPT 2026 Tokyo #02 / NLH 3on3] Registration Cancellation',
      body: `${name}

This is Yoshizawa from the Japan Open Poker Tour.

Thank you for registering for “JOPT 2026 Tokyo #02 / NLH 3on3.”

We previously contacted you regarding your registration. However, as we have not received a response from you, we regret to inform you that your registration has been canceled.

Registration is still open. If you would still like to participate, please submit a new application.

${footer}`
    }
  };
  if (!templates[type]) throw new Error('Unknown English mail type: ' + type);
  return templates[type];
}

function reservation3on3IsCoin_(value) {
  return /Poker Web Coin|coin/i.test(reservation3on3Text_(value));
}

function reservation3on3IsLivePocket_(value) {
  return /LivePocket/i.test(reservation3on3Text_(value));
}

function reservation3on3IsContract_(value) {
  return /選手契約履行|contract|player contract/i.test(reservation3on3Text_(value));
}

function reservation3on3UsesMainTicket_(value) {
  return /メインチケット|Main Ticket|1Ticket|1 Ticket/i.test(reservation3on3Text_(value));
}

function reservation3on3TicketNeedsConfirmation_(value) {
  return reservation3on3Text_(value) === 'ticket要確認';
}

function reservation3on3CancelNoticeSent_(value) {
  return reservation3on3Text_(value) === 'キャンセル通知済';
}

function reservation3on3SetManualInstruction_(sheet, sourceRow, value) {
  sheet.getRange(sourceRow, R3ON3.manualInstructionColumn).setValue(value);
}

function reservation3on3GetActiveReportSheet_() {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName().indexOf('REPORT_3ON3_') !== 0) {
    throw new Error('先に対象の REPORT_3ON3 シートを開いてください。');
  }
  return sheet;
}

function reservation3on3GetOrCreateReportSheet_(ss, sheetName) {
  return ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
}

function reservation3on3FindOrCreateDraft_(to, subject, body) {
  const drafts = GmailApp.getDrafts();
  for (let index = 0; index < drafts.length; index++) {
    const message = drafts[index].getMessage();
    if (
      reservation3on3NormalizeEmail_(message.getTo()) === reservation3on3NormalizeEmail_(to) &&
      reservation3on3NormalizeEmail_(message.getFrom()) === reservation3on3NormalizeEmail_(R3ON3.from) &&
      reservation3on3EmailListContains_(message.getBcc(), R3ON3.bcc) &&
      message.getSubject() === subject &&
      reservation3on3NormalizeBody_(message.getPlainBody()) === reservation3on3NormalizeBody_(body)
    ) {
      return { draftId: drafts[index].getId(), reused: true };
    }
  }
  reservation3on3AssertFromAlias_();
  const draft = GmailApp.createDraft(to, subject, body, {
    from: R3ON3.from,
    name: R3ON3.fromName,
    bcc: R3ON3.bcc
  });
  return { draftId: draft.getId(), reused: false };
}

function reservation3on3AssertFromAlias_() {
  const from = R3ON3.from.toLowerCase();
  const available = GmailApp.getAliases().map(alias => String(alias).toLowerCase());
  const effectiveUser = Session.getEffectiveUser().getEmail().toLowerCase();
  if (from !== effectiveUser && available.indexOf(from) < 0) {
    throw new Error('送信元「' + R3ON3.from + '」がGmailの送信エイリアスに設定されていません。');
  }
}

function reservation3on3BuildGmailComposeUrl_(to, subject, body) {
  return 'https://mail.google.com/mail/?view=cm&fs=1' +
    '&to=' + encodeURIComponent(to) +
    '&bcc=' + encodeURIComponent(R3ON3.bcc) +
    '&su=' + encodeURIComponent(subject) +
    '&body=' + encodeURIComponent(body);
}

function reservation3on3WasAlreadySent_(email, subject) {
  if (!R3ON3.excludeAlreadySentByGmail) return false;
  const safeEmail = String(email).replace(/"/g, '');
  const safeSubject = String(subject).replace(/"/g, '');
  const query =
    'in:sent newer_than:' + R3ON3.sentMailLookbackDays + 'd ' +
    'to:"' + safeEmail + '" subject:"' + safeSubject + '"';
  return GmailApp.search(query, 0, 1).length > 0;
}

function reservation3on3CalculateDeadline_(timestamp) {
  const date = timestamp instanceof Date ? new Date(timestamp.getTime()) : new Date(timestamp);
  if (isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3);
  return date;
}

function reservation3on3FormatDeadline_(date, includeTime, lang) {
  if (!date) return lang === 'en' ? 'Date to be confirmed' : '日付要確認';
  const weekdaysJp = ['日', '月', '火', '水', '木', '金', '土'];
  if (lang === 'en') {
    const text = Utilities.formatDate(date, Session.getScriptTimeZone(), 'MMM d, yyyy');
    return includeTime ? text + ', 11:59 PM' : text;
  }
  const text = (date.getMonth() + 1) + '月' + date.getDate() + '日(' + weekdaysJp[date.getDay()] + ')';
  return includeTime ? text + ' 23:59まで' : text;
}

function reservation3on3ValidDate_(value) {
  if (!value) return null;
  if (typeof value === 'string' && !/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(value)) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function reservation3on3Today_() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function reservation3on3IsChecked_(value) {
  return value === true || String(value).toLowerCase() === 'true' || value === 'TRUE';
}

function reservation3on3Text_(value) {
  return String(value == null ? '' : value)
    .replace(/\u3000/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\r\n]+/g, ' ')
    .trim();
}

function reservation3on3NormalizeGameId_(value) {
  const text = reservation3on3Text_(value);
  const digits = text.replace(/\D/g, '');
  if (digits.length >= 8) return digits.slice(0, 8);
  return text;
}

function reservation3on3NormalizeEmail_(value) {
  const text = reservation3on3Text_(value).toLowerCase();
  const match = text.match(/<([^>]+)>/);
  return match ? match[1].trim() : text;
}

function reservation3on3NormalizeBody_(value) {
  return String(value == null ? '' : value).replace(/\r\n/g, '\n').trim();
}

function reservation3on3EmailListContains_(emailList, expectedEmail) {
  const expected = reservation3on3NormalizeEmail_(expectedEmail);
  return reservation3on3Text_(emailList)
    .split(',')
    .map(reservation3on3NormalizeEmail_)
    .indexOf(expected) >= 0;
}
