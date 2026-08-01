/**
 * Template-driven pre-reservation mailer.
 *
 * Reads templates extracted from Gmail compose hyperlinks and builds a send report
 * from a response sheet whose headers may vary by event/staff.
 */

const PRE_RES_TEMPLATE_MAILER = {
  menuName: '事前予約メール送信',
  templateSourceSheetName: 'PreReservationTemplateSource',
  reportSheetName: 'REPORT_PRE_RES_MAIL',
  livePocketGameIdSheetName: 'LIVEPOCKET_GAME_ID',
  livePocketGameIdHeaders: ['Game ID', '照合結果', 'プレイヤーネーム', '元シート行'],
  from: 'customer@japanopenpoker.com',
  fromName: 'Japan Open Poker Tour / JOPT',
  defaultBcc: 'customer@japanopenpoker.com',
  timezone: 'Asia/Tokyo',
  headerSearchRows: 40,
  maxReadRows: 3000,
  sourceSheetNamePatterns: [/^フォーム.*回答/i, /^フォーム.*回.*/i],
  reportHeaders: [
    'source_sheet',
    'source_row',
    'mail_type',
    'email',
    'player_name',
    'game_id',
    'payment_method',
    'payment_deadline',
    'subject',
    'body',
    'Gmailリンク',
    '送信OK',
    'Draft ID',
    'Draft Status',
    '送信ステータス',
    '送信日時'
  ],
  templateTypes: ['coin_payment', 'livepocket_payment', 'contract_confirmed', 'day_guide', 'cancel'],
  manualActionOptions: ['キャンセル', 'キャンセル通知済', 'テスト', '重複', 'スキップ'],
  manualSkipPattern: /テスト|test|重複|除外|スキップ|skip/i
};

const PRE_RES_SOURCE_HEADER_ALIASES = {
  paymentInviteSentCol: ['決済メール送信'],
  paymentConfirmedCol: ['決済確認'],
  dayGuideSentCol: ['当日案内メール'],
  cancelMailSentCol: ['キャンセルメール'],
  paymentDeadlineCol: ['支払期限'],
  timestampCol: ['タイムスタンプ'],
  emailCol: ['メールアドレス', '代表者のメールアドレス'],
  playerNameCol: ['プレイヤーネーム【代表者】', 'プレイヤーネーム', 'お名前'],
  gameIdCol: ['GameID【代表者】', 'Game ID【代表者】', 'GameID', 'Game ID'],
  paymentMethodCol: ['決済方法', '決済方法選択'],
  voucherAnswerCol: ['いくらのバウチャーを何枚使用しますか？', 'どのバウチャーを何枚ご利用されますか？'],
  manualActionCol: ['手動指示', '手動操作']
};

function openPreReservationTemplateDrivenMailMenu() {
  SpreadsheetApp.getUi()
    .createMenu(PRE_RES_TEMPLATE_MAILER.menuName)
    .addItem('手動指示の選択肢を設定', 'applyPreReservationManualActionDropdown')
    .addItem('重複申請を整理（最新を残す）', 'markDuplicatePreReservationApplications')
    .addItem('LivePocket決済確認を反映', 'syncLivePocketPaymentConfirmations')
    .addSeparator()
    .addItem('REPORT作成：全対象', 'buildPreReservationTemplateDrivenMailReport')
    .addSeparator()
    .addItem('REPORT作成：COIN支払案内', 'buildPreReservationCoinPaymentReport')
    .addItem('REPORT作成：LivePocket支払案内', 'buildPreReservationLivePocketPaymentReport')
    .addItem('REPORT作成：選手契約履行 当日案内', 'buildPreReservationContractConfirmedReport')
    .addItem('REPORT作成：当日案内', 'buildPreReservationDayGuideReport')
    .addItem('REPORT作成：キャンセル通知', 'buildPreReservationCancelReport')
    .addSeparator()
    .addItem('REPORTのGmail下書きを作成', 'createDraftsFromPreReservationTemplateDrivenMailReport')
    .addItem('REPORTの送信OKメールを送信', 'sendApprovedPreReservationTemplateDrivenMailReport')
    .addToUi();
}

function applyPreReservationManualActionDropdown() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ctx = preResMailerResolveContext_(ss);
  const appliedRows = preResMailerApplyManualActionValidation_(ctx.sourceSheet, ctx.sourceMap);
  SpreadsheetApp.getUi().alert(
    '手動指示の選択肢を設定しました。\n\n' +
    '対象シート: ' + ctx.sourceSheet.getName() + '\n' +
    '候補: ' + PRE_RES_TEMPLATE_MAILER.manualActionOptions.join(' / ') + '\n' +
    '適用行数: ' + appliedRows + '行'
  );
}

function markDuplicatePreReservationApplications() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  preResMailerEnsureTokyoTimezone_(ss);
  const ctx = preResMailerResolveContext_(ss);
  if (!ctx.sourceMap.manualActionCol) {
    throw new Error('手動指示（または手動操作）列が見つかりませんでした。');
  }

  const source = preResMailerReadSourceRowsWithoutUpdates_(ctx.sourceSheet, ctx.sourceMap);
  const candidates = source.rows.filter(row =>
    (row.email || row.gameId) &&
    !preResMailerIsManualSkip_(row.manualAction)
  );
  const groups = preResMailerGroupRowsByIdentity_(candidates);
  const duplicateRows = [];

  groups.forEach(group => {
    if (group.rows.length < 2) return;
    group.rows.forEach(row => {
      if (row.sourceRow !== group.latest.sourceRow) duplicateRows.push(row);
    });
  });

  let newlyMarked = 0;
  if (source.rowCount > 0 && duplicateRows.length > 0) {
    const actionRange = ctx.sourceSheet.getRange(
      source.startRow,
      ctx.sourceMap.manualActionCol,
      source.rowCount,
      1
    );
    const actionValues = actionRange.getValues();

    duplicateRows.forEach(row => {
      const index = row.sourceRow - source.startRow;
      if (preResMailerText_(actionValues[index][0]) !== '重複') {
        actionValues[index][0] = '重複';
        newlyMarked++;
      }
    });

    if (newlyMarked > 0) actionRange.setValues(actionValues);
  }

  SpreadsheetApp.getUi().alert(
    '重複申請の整理が完了しました。\n\n' +
    '対象シート: ' + ctx.sourceSheet.getName() + '\n' +
    '重複グループ: ' + groups.filter(group => group.rows.length > 1).length + '件\n' +
    '重複として扱う旧申請: ' + duplicateRows.length + '件\n' +
    '今回「重複」を設定: ' + newlyMarked + '件\n\n' +
    'すでに手動で「重複」が選択されていた行は、判定対象から除外しています。'
  );
}

function syncLivePocketPaymentConfirmations() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  preResMailerEnsureTokyoTimezone_(ss);
  const ctx = preResMailerResolveContext_(ss);
  const map = ctx.sourceMap;

  if (!map.paymentConfirmedCol) throw new Error('決済確認列が見つかりませんでした。');
  if (!map.gameIdCol) throw new Error('Game ID列が見つかりませんでした。');
  if (!map.paymentMethodCol) throw new Error('決済方法列が見つかりませんでした。');

  let paymentSheet = ss.getSheetByName(PRE_RES_TEMPLATE_MAILER.livePocketGameIdSheetName);
  if (!paymentSheet) {
    paymentSheet = ss.insertSheet(PRE_RES_TEMPLATE_MAILER.livePocketGameIdSheetName);
    preResMailerPrepareLivePocketGameIdSheet_(paymentSheet);
    SpreadsheetApp.getUi().alert(
      PRE_RES_TEMPLATE_MAILER.livePocketGameIdSheetName + ' を作成しました。\n\n' +
      'A2以降に、LivePocketで決済完了した全Game IDを貼り付けてから、\n' +
      'もう一度「LivePocket決済確認を反映」を実行してください。'
    );
    return;
  }

  const lastRow = Math.max(paymentSheet.getLastRow(), 1);
  const gameIdValues = paymentSheet.getRange(1, 1, lastRow, 1).getDisplayValues();
  const firstValue = preResMailerNormalizeGameId_(gameIdValues[0][0]);
  const hasHeader = preResMailerIsGameIdHeader_(firstValue);

  if (!firstValue && lastRow === 1) {
    preResMailerPrepareLivePocketGameIdSheet_(paymentSheet);
    SpreadsheetApp.getUi().alert(
      PRE_RES_TEMPLATE_MAILER.livePocketGameIdSheetName + ' のA2以降に、\n' +
      'LivePocketで決済完了した全Game IDを貼り付けてください。'
    );
    return;
  }

  if (hasHeader) {
    paymentSheet.getRange(1, 1, 1, PRE_RES_TEMPLATE_MAILER.livePocketGameIdHeaders.length)
      .setValues([PRE_RES_TEMPLATE_MAILER.livePocketGameIdHeaders])
      .setFontWeight('bold')
      .setBackground('#d9ead3');
    paymentSheet.setFrozenRows(1);
  }

  const source = preResMailerReadSourceRowsWithoutUpdates_(ctx.sourceSheet, map);
  const activeCandidates = source.rows.filter(row =>
    (row.email || row.gameId) &&
    !preResMailerIsManualSkip_(row.manualAction)
  );
  const activeGroups = preResMailerGroupRowsByIdentity_(activeCandidates);
  const activeCandidateRows = {};
  const activeLatestRows = {};
  activeCandidates.forEach(row => {
    activeCandidateRows[row.sourceRow] = true;
  });
  activeGroups.forEach(group => {
    activeLatestRows[group.latest.sourceRow] = true;
  });

  const livePocketRowsByGameId = {};
  source.rows.forEach(row => {
    if (!preResMailerIsLivePocket_(row.paymentMethod)) return;
    const gameId = preResMailerNormalizeGameId_(row.gameId);
    if (!gameId) return;
    if (!livePocketRowsByGameId[gameId]) livePocketRowsByGameId[gameId] = [];
    livePocketRowsByGameId[gameId].push(row);
  });

  const results = gameIdValues.map(() => ['', '', '']);
  if (hasHeader) {
    results[0] = PRE_RES_TEMPLATE_MAILER.livePocketGameIdHeaders.slice(1);
  }

  const seenInput = {};
  const newlyConfirmedRows = {};
  const newlyConfirmedDetails = [];
  let inputCount = 0;
  let alreadyConfirmed = 0;
  let unmatched = 0;
  let oldDuplicate = 0;
  let needsReview = 0;
  let duplicateInput = 0;

  for (let index = hasHeader ? 1 : 0; index < gameIdValues.length; index++) {
    const gameId = preResMailerNormalizeGameId_(gameIdValues[index][0]);
    if (!gameId) continue;
    inputCount++;

    if (seenInput[gameId]) {
      results[index] = ['入力重複', '', ''];
      duplicateInput++;
      continue;
    }
    seenInput[gameId] = true;

    const matches = livePocketRowsByGameId[gameId] || [];
    const matchResult = preResMailerClassifyLivePocketPayment_(
      matches,
      activeCandidateRows,
      activeLatestRows
    );
    results[index] = [
      matchResult.status,
      matchResult.row ? matchResult.row.playerName : '',
      matchResult.row ? matchResult.row.sourceRow : ''
    ];

    if (matchResult.category === 'unmatched') unmatched++;
    if (matchResult.category === 'old_duplicate') oldDuplicate++;
    if (matchResult.category === 'needs_review') needsReview++;
    if (matchResult.category === 'confirmed') alreadyConfirmed++;
    if (matchResult.category !== 'new') continue;

    const latestMatch = matchResult.row;
    newlyConfirmedRows[latestMatch.sourceRow] = true;
    newlyConfirmedDetails.push(
      (latestMatch.playerName || '名前なし') + ' / ' + gameId + ' / 元シート' + latestMatch.sourceRow + '行'
    );
  }

  const rowsToConfirm = Object.keys(newlyConfirmedRows).map(Number);
  if (rowsToConfirm.length > 0) {
    const ranges = rowsToConfirm.map(row => ctx.sourceSheet.getRange(row, map.paymentConfirmedCol).getA1Notation());
    ctx.sourceSheet.getRangeList(ranges).setValue(true);
  }

  paymentSheet.getRange(1, 2, lastRow, 3).setValues(results);
  paymentSheet.setColumnWidth(1, 180);
  paymentSheet.setColumnWidth(2, 180);
  paymentSheet.setColumnWidth(3, 180);
  paymentSheet.setColumnWidth(4, 100);

  const detailText = newlyConfirmedDetails.length
    ? '\n\n今回新規確認:\n' + newlyConfirmedDetails.slice(0, 20).join('\n') +
      (newlyConfirmedDetails.length > 20 ? '\nほか' + (newlyConfirmedDetails.length - 20) + '件' : '')
    : '';

  SpreadsheetApp.getUi().alert(
    'LivePocket決済確認の反映が完了しました。\n\n' +
    '入力Game ID: ' + inputCount + '件\n' +
    '今回新規確認: ' + rowsToConfirm.length + '件\n' +
    '確認済み: ' + alreadyConfirmed + '件\n' +
    '申請なし: ' + unmatched + '件\n' +
    '重複旧申請・要確認: ' + oldDuplicate + '件\n' +
    'その他要確認: ' + needsReview + '件\n' +
    '入力重複: ' + duplicateInput + '件' +
    detailText
  );
}

function preResMailerClassifyLivePocketPayment_(matches, activeCandidateRows, activeLatestRows) {
  if (!matches.length) {
    return { status: '申請なし', category: 'unmatched', row: null };
  }

  const latestMatch = matches.find(row =>
    activeLatestRows[row.sourceRow] &&
    !preResMailerIsManualSkip_(row.manualAction)
  );

  if (!latestMatch) {
    const manuallyDuplicated = matches.some(row => /重複/.test(preResMailerText_(row.manualAction)));
    const supersededApplication = matches.some(row =>
      activeCandidateRows[row.sourceRow] &&
      !activeLatestRows[row.sourceRow]
    );
    const isOldDuplicate = manuallyDuplicated || supersededApplication;
    return {
      status: isOldDuplicate ? '重複旧申請・要確認' : '対象外・要確認',
      category: isOldDuplicate ? 'old_duplicate' : 'needs_review',
      row: matches[0]
    };
  }

  if (latestMatch.cancelMailSent || /キャンセル/.test(preResMailerText_(latestMatch.manualAction))) {
    return { status: 'キャンセル済・要確認', category: 'needs_review', row: latestMatch };
  }

  if (latestMatch.paymentConfirmed) {
    return { status: '確認済み', category: 'confirmed', row: latestMatch };
  }

  return { status: '今回新規確認', category: 'new', row: latestMatch };
}

function buildPreReservationTemplateDrivenMailReport() {
  preResMailerBuildReport_('', '全対象');
}

function buildPreReservationCoinPaymentReport() {
  preResMailerBuildReport_('coin_payment', 'COIN支払案内');
}

function buildPreReservationLivePocketPaymentReport() {
  preResMailerBuildReport_('livepocket_payment', 'LivePocket支払案内');
}

function buildPreReservationContractConfirmedReport() {
  preResMailerBuildReport_('contract_confirmed', '選手契約履行 当日案内');
}

function buildPreReservationDayGuideReport() {
  preResMailerBuildReport_('day_guide', '当日案内');
}

function buildPreReservationCancelReport() {
  preResMailerBuildReport_('cancel', 'キャンセル通知');
}

function preResMailerBuildReport_(mailTypeFilter, reportLabel) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  preResMailerEnsureTokyoTimezone_(ss);
  const ctx = preResMailerResolveContext_(ss);
  const templates = preResMailerLoadTemplates_(ss, ctx);
  const rows = preResMailerReadSourceRows_(ctx.sourceSheet, ctx.sourceMap);
  const latestRows = preResMailerKeepLatestRows_(rows);
  const output = [];
  const richLinks = [];

  latestRows.forEach(row => {
    const mailType = preResMailerMailTypeForRow_(row);
    if (!mailType) return;
    if (mailTypeFilter && mailType !== mailTypeFilter) return;

    const template = templates[mailType];
    if (!template) return;

    const mail = preResMailerBuildMail_(template, row, ctx);
    output.push([
      ctx.sourceSheet.getName(),
      row.sourceRow,
      mailType,
      row.email,
      row.playerName,
      row.gameId,
      row.paymentMethod,
      row.deadlineWithTime,
      mail.subject,
      mail.body,
      'Gmailで作成',
      false,
      '',
      '',
      '',
      ''
    ]);
    richLinks.push([
      SpreadsheetApp.newRichTextValue()
        .setText('Gmailで作成')
        .setLinkUrl(preResMailerBuildComposeUrl_(row.email, template.bcc, mail.subject, mail.body))
        .build()
    ]);
  });

  const report = preResMailerGetOrCreateReportSheet_(ss);
  report.clear();
  report.getRange(1, 1, 1, PRE_RES_TEMPLATE_MAILER.reportHeaders.length)
    .setValues([PRE_RES_TEMPLATE_MAILER.reportHeaders])
    .setFontWeight('bold')
    .setBackground('#d9ead3');
  report.setFrozenRows(1);

  if (output.length) {
    report.getRange(2, 1, output.length, PRE_RES_TEMPLATE_MAILER.reportHeaders.length).setValues(output);
    report.getRange(2, 11, richLinks.length, 1).setRichTextValues(richLinks);
    report.getRange(2, 12, output.length, 1).insertCheckboxes();
    report.getRange(2, 10, output.length, 1).setWrap(true);
  }

  report.autoResizeColumns(1, 9);
  report.setColumnWidth(10, 500);
  report.setColumnWidth(11, 120);
  report.activate();

  SpreadsheetApp.getUi().alert(
    'REPORTを作成しました。\n\n' +
    '種別: ' + reportLabel + '\n' +
    '対象: ' + output.length + '件\n' +
    '元シート: ' + ctx.sourceSheet.getName()
  );
}

function createDraftsFromPreReservationTemplateDrivenMailReport() {
  const report = preResMailerGetActiveReportSheet_();
  const lastRow = report.getLastRow();
  let created = 0;
  let reused = 0;
  let errors = 0;

  for (let row = 2; row <= lastRow; row++) {
    const values = report.getRange(row, 1, 1, PRE_RES_TEMPLATE_MAILER.reportHeaders.length).getValues()[0];
    const email = preResMailerText_(values[3]);
    const subject = preResMailerText_(values[8]);
    const body = String(values[9] == null ? '' : values[9]);
    const draftId = preResMailerText_(values[12]);
    const sendStatus = preResMailerText_(values[14]);
    if (!email || !subject || !body || draftId || sendStatus === '送信済み') continue;

    try {
      const result = preResMailerFindOrCreateDraft_(email, PRE_RES_TEMPLATE_MAILER.defaultBcc, subject, body);
      report.getRange(row, 13).setValue(result.draftId);
      report.getRange(row, 14).setValue(result.reused ? '既存下書きを使用' : '下書き作成済み');
      if (result.reused) reused++;
      else created++;
    } catch (error) {
      report.getRange(row, 14).setValue('エラー: ' + error.message);
      errors++;
    }
  }

  SpreadsheetApp.getUi().alert(
    'Gmail下書き作成が完了しました。\n\n' +
    '作成: ' + created + '件\n' +
    '再利用: ' + reused + '件\n' +
    'エラー: ' + errors + '件'
  );
}

function sendApprovedPreReservationTemplateDrivenMailReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const report = preResMailerGetActiveReportSheet_();
  const sourceCache = {};
  let sent = 0;
  let errors = 0;

  for (let row = 2; row <= report.getLastRow(); row++) {
    const values = report.getRange(row, 1, 1, PRE_RES_TEMPLATE_MAILER.reportHeaders.length).getValues()[0];
    const sourceSheetName = preResMailerText_(values[0]);
    const sourceRow = Number(values[1]);
    const mailType = preResMailerText_(values[2]);
    const sendOk = preResMailerIsChecked_(values[11]);
    const draftId = preResMailerText_(values[12]);
    const sendStatus = preResMailerText_(values[14]);
    if (!sendOk || !draftId || sendStatus === '送信済み') continue;

    try {
      GmailApp.getDraft(draftId).send();
      report.getRange(row, 15).setValue('送信済み');
      report.getRange(row, 16).setValue(new Date());

      if (!sourceCache[sourceSheetName]) {
        const sourceSheet = ss.getSheetByName(sourceSheetName);
        if (!sourceSheet) throw new Error('元シートが見つかりません: ' + sourceSheetName);
        sourceCache[sourceSheetName] = {
          sheet: sourceSheet,
          map: preResMailerFindSourceColumnMap_(sourceSheet)
        };
      }

      preResMailerMarkSourceAfterSend_(
        sourceCache[sourceSheetName].sheet,
        sourceCache[sourceSheetName].map,
        sourceRow,
        mailType
      );
      sent++;
    } catch (error) {
      report.getRange(row, 15).setValue('エラー: ' + error.message);
      errors++;
    }
  }

  SpreadsheetApp.getUi().alert(
    '送信処理が完了しました。\n\n' +
    '送信: ' + sent + '件\n' +
    'エラー: ' + errors + '件'
  );
}

function preResMailerResolveContext_(ss) {
  const activeSheet = ss.getActiveSheet();
  const sourceSheet = preResMailerFindSourceSheet_(ss, activeSheet);
  const sourceMap = preResMailerFindSourceColumnMap_(sourceSheet);
  const controlSheet = preResMailerLooksLikeControlSheet_(activeSheet) ? activeSheet : null;
  return {
    sourceSheet,
    sourceMap,
    controlSheet,
    eventName: preResMailerResolveEventName_(ss, controlSheet, sourceSheet),
    livePocketUrl: controlSheet ? preResMailerFindLivePocketUrl_(controlSheet) : ''
  };
}

function preResMailerEnsureTokyoTimezone_(ss) {
  if (ss.getSpreadsheetTimeZone() !== PRE_RES_TEMPLATE_MAILER.timezone) {
    ss.setSpreadsheetTimeZone(PRE_RES_TEMPLATE_MAILER.timezone);
  }
}

function preResMailerFindSourceSheet_(ss, activeSheet) {
  if (activeSheet && preResMailerCanBeSourceSheet_(activeSheet)) return activeSheet;

  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const name = sheets[i].getName();
    if (!PRE_RES_TEMPLATE_MAILER.sourceSheetNamePatterns.some(pattern => pattern.test(name))) continue;
    if (preResMailerCanBeSourceSheet_(sheets[i])) return sheets[i];
  }

  for (let i = 0; i < sheets.length; i++) {
    if (preResMailerCanBeSourceSheet_(sheets[i])) return sheets[i];
  }

  throw new Error('元の回答シートを特定できませんでした。');
}

function preResMailerCanBeSourceSheet_(sheet) {
  try {
    preResMailerFindSourceColumnMap_(sheet);
    return true;
  } catch (error) {
    return false;
  }
}

function preResMailerFindSourceColumnMap_(sheet) {
  const maxRows = Math.min(sheet.getLastRow(), PRE_RES_TEMPLATE_MAILER.headerSearchRows);
  if (maxRows < 1 || sheet.getLastColumn() < 1) {
    throw new Error('シートにデータがありません。');
  }

  const values = sheet.getRange(1, 1, maxRows, sheet.getLastColumn()).getDisplayValues();
  for (let rowIndex = 0; rowIndex < values.length; rowIndex++) {
    const headers = values[rowIndex].map(preResMailerText_);
    const map = {
      headerRow: rowIndex + 1,
      paymentInviteSentCol: preResMailerFindHeaderAlias_(headers, PRE_RES_SOURCE_HEADER_ALIASES.paymentInviteSentCol),
      paymentConfirmedCol: preResMailerFindHeaderAlias_(headers, PRE_RES_SOURCE_HEADER_ALIASES.paymentConfirmedCol),
      dayGuideSentCol: preResMailerFindHeaderAlias_(headers, PRE_RES_SOURCE_HEADER_ALIASES.dayGuideSentCol),
      cancelMailSentCol: preResMailerFindHeaderAlias_(headers, PRE_RES_SOURCE_HEADER_ALIASES.cancelMailSentCol),
      paymentDeadlineCol: preResMailerFindHeaderAlias_(headers, PRE_RES_SOURCE_HEADER_ALIASES.paymentDeadlineCol),
      timestampCol: preResMailerFindHeaderAlias_(headers, PRE_RES_SOURCE_HEADER_ALIASES.timestampCol),
      emailCol: preResMailerFindHeaderAlias_(headers, PRE_RES_SOURCE_HEADER_ALIASES.emailCol),
      playerNameCol: preResMailerFindHeaderAlias_(headers, PRE_RES_SOURCE_HEADER_ALIASES.playerNameCol),
      gameIdCol: preResMailerFindHeaderAlias_(headers, PRE_RES_SOURCE_HEADER_ALIASES.gameIdCol),
      paymentMethodCol: preResMailerFindHeaderAlias_(headers, PRE_RES_SOURCE_HEADER_ALIASES.paymentMethodCol),
      voucherAnswerCol: preResMailerFindHeaderAlias_(headers, PRE_RES_SOURCE_HEADER_ALIASES.voucherAnswerCol),
      manualActionCol: preResMailerFindHeaderAlias_(headers, PRE_RES_SOURCE_HEADER_ALIASES.manualActionCol)
    };

    // Very light fallback only for minor wording differences.
    if (!map.playerNameCol) map.playerNameCol = preResMailerFindHeader_(headers, [/プレイヤーネーム【代表者】/, /^プレイヤーネーム$/, /お名前/]);
    if (!map.gameIdCol) map.gameIdCol = preResMailerFindHeader_(headers, [/Game\s*ID【代表者】/i, /^Game\s*ID$/i, /^GameID$/i]);
    if (!map.paymentMethodCol) map.paymentMethodCol = preResMailerFindHeader_(headers, [/決済方法選択/, /^決済方法$/]);
    if (!map.voucherAnswerCol) map.voucherAnswerCol = preResMailerFindHeader_(headers, [/バウチャー/i, /voucher/i]);

    if (map.timestampCol && map.emailCol && (map.playerNameCol || map.gameIdCol)) {
      return map;
    }
  }

  throw new Error('必要な見出しが見つかりませんでした。');
}

function preResMailerApplyManualActionValidation_(sheet, map) {
  if (!map.manualActionCol) {
    throw new Error('手動指示列が見つかりませんでした。');
  }

  const startRow = map.headerRow + 1;
  const rowCount = Math.max(sheet.getMaxRows() - map.headerRow, 1);
  const range = sheet.getRange(startRow, map.manualActionCol, rowCount, 1);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(PRE_RES_TEMPLATE_MAILER.manualActionOptions, true)
    .setAllowInvalid(true)
    .build();

  range.clearDataValidations();
  range.setDataValidation(rule);
  return rowCount;
}

function preResMailerFindHeader_(headers, patterns) {
  for (let i = 0; i < headers.length; i++) {
    for (let j = 0; j < patterns.length; j++) {
      if (patterns[j].test(headers[i])) return i + 1;
    }
  }
  return 0;
}

function preResMailerFindHeaderAlias_(headers, aliases) {
  for (let i = 0; i < aliases.length; i++) {
    const index = headers.indexOf(preResMailerText_(aliases[i]));
    if (index >= 0) return index + 1;
  }
  return 0;
}

function preResMailerResolveEventName_(ss, controlSheet, sourceSheet) {
  if (controlSheet) {
    const value = preResMailerReadEventNameFromSheet_(controlSheet);
    if (value) return value;
  }
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const value = preResMailerReadEventNameFromSheet_(sheets[i]);
    if (value) return value;
  }
  return sourceSheet.getName();
}

function preResMailerReadEventNameFromSheet_(sheet) {
  const cells = ['A1', 'A2', 'A3'];
  for (let i = 0; i < cells.length; i++) {
    const text = preResMailerText_(sheet.getRange(cells[i]).getDisplayValue());
    if (!text) continue;
    if (/予約確認$/.test(text)) return text.replace(/\s*予約確認\s*$/, '');
    if (/SPADIE|JOPT|NLH|Open Face/i.test(text)) return text;
  }
  return '';
}

function preResMailerFindLivePocketUrl_(sheet) {
  const scan = sheet.getRange(1, 1, Math.min(20, sheet.getLastRow()), Math.min(12, sheet.getLastColumn())).getDisplayValues();
  for (let row = 0; row < scan.length; row++) {
    for (let col = 0; col < scan[row].length; col++) {
      if (preResMailerText_(scan[row][col]) !== 'LivePocket URL') continue;
      if (col + 1 < scan[row].length) return preResMailerText_(scan[row][col + 1]);
      if (row + 1 < scan.length) return preResMailerText_(scan[row + 1][col]);
    }
  }
  return '';
}

function preResMailerLoadTemplates_(ss, ctx) {
  const sheet = ss.getSheetByName(PRE_RES_TEMPLATE_MAILER.templateSourceSheetName);
  if (!sheet) throw new Error('PreReservationTemplateSource が見つかりません。先にテンプレート抽出を実行してください。');

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) throw new Error('PreReservationTemplateSource にデータがありません。');

  const headers = values[0].map(preResMailerText_);
  const idx = {
    extractedAt: headers.indexOf('抽出日時'),
    sourceSheet: headers.indexOf('source_sheet'),
    eventName: headers.indexOf('event_name'),
    mailType: headers.indexOf('mail_type'),
    bcc: headers.indexOf('bcc'),
    subject: headers.indexOf('subject'),
    body: headers.indexOf('body')
  };

  const exact = {};
  const fallback = {};

  for (let row = 1; row < values.length; row++) {
    const item = {
      extractedAt: preResMailerToDate_(values[row][idx.extractedAt]),
      sourceSheet: preResMailerText_(values[row][idx.sourceSheet]),
      eventName: preResMailerText_(values[row][idx.eventName]),
      mailType: preResMailerText_(values[row][idx.mailType]),
      bcc: preResMailerText_(values[row][idx.bcc]) || PRE_RES_TEMPLATE_MAILER.defaultBcc,
      subject: String(values[row][idx.subject] == null ? '' : values[row][idx.subject]),
      body: String(values[row][idx.body] == null ? '' : values[row][idx.body])
    };
    if (!item.mailType || !item.subject || !item.body) continue;

    const isExact = item.eventName === ctx.eventName || (ctx.controlSheet && item.sourceSheet === ctx.controlSheet.getName());
    if (isExact && (!exact[item.mailType] || exact[item.mailType].extractedAt < item.extractedAt)) {
      exact[item.mailType] = item;
    }
    if (!fallback[item.mailType] || fallback[item.mailType].extractedAt < item.extractedAt) {
      fallback[item.mailType] = item;
    }
  }

  const result = {};
  PRE_RES_TEMPLATE_MAILER.templateTypes.forEach(type => {
    result[type] = exact[type] || fallback[type] || null;
  });
  return result;
}

function preResMailerReadSourceRows_(sheet, map) {
  const source = preResMailerReadSourceRowsWithoutUpdates_(sheet, map);
  const startRow = source.startRow;
  const rowCount = source.rowCount;
  const values = source.values;
  const rows = source.rows;
  if (rowCount < 1) return rows;

  if (map.paymentDeadlineCol) {
    const deadlineValues = [];
    let hasUpdate = false;
    for (let i = 0; i < rows.length; i++) {
      const existing = values[i][map.paymentDeadlineCol - 1];
      if (existing === '' || existing == null) {
        deadlineValues.push([rows[i].computedDeadline || '']);
        if (rows[i].computedDeadline) hasUpdate = true;
      } else {
        deadlineValues.push([existing]);
      }
    }

    const deadlineRange = sheet.getRange(startRow, map.paymentDeadlineCol, rowCount, 1);
    if (hasUpdate) deadlineRange.setValues(deadlineValues);
    deadlineRange.setNumberFormat('m/d(aaa)');
  }

  return rows;
}

function preResMailerReadSourceRowsWithoutUpdates_(sheet, map) {
  const startRow = map.headerRow + 1;
  if (sheet.getLastRow() < startRow) {
    return { startRow: startRow, rowCount: 0, values: [], rows: [] };
  }

  const rowCount = Math.min(sheet.getLastRow() - startRow + 1, PRE_RES_TEMPLATE_MAILER.maxReadRows);
  const values = sheet.getRange(startRow, 1, rowCount, sheet.getLastColumn()).getValues();
  return {
    startRow: startRow,
    rowCount: rowCount,
    values: values,
    rows: values.map((row, index) => preResMailerParseSourceRow_(row, startRow + index, map))
  };
}

function preResMailerParseSourceRow_(values, sourceRow, map) {
  const explicitDeadline = map.paymentDeadlineCol ? preResMailerValidDate_(values[map.paymentDeadlineCol - 1]) : null;
  const timestamp = map.timestampCol ? values[map.timestampCol - 1] : '';
  const computedDeadline = explicitDeadline ? null : preResMailerCalculateBusinessDeadline_(timestamp);
  const deadline = explicitDeadline || computedDeadline;
  return {
    sourceRow: sourceRow,
    paymentInviteSent: map.paymentInviteSentCol ? preResMailerIsChecked_(values[map.paymentInviteSentCol - 1]) : false,
    paymentConfirmed: map.paymentConfirmedCol ? preResMailerIsChecked_(values[map.paymentConfirmedCol - 1]) : false,
    dayGuideSent: map.dayGuideSentCol ? preResMailerIsChecked_(values[map.dayGuideSentCol - 1]) : false,
    cancelMailSent: map.cancelMailSentCol ? preResMailerIsChecked_(values[map.cancelMailSentCol - 1]) : false,
    timestamp: timestamp,
    email: map.emailCol ? preResMailerText_(values[map.emailCol - 1]) : '',
    playerName: map.playerNameCol ? preResMailerText_(values[map.playerNameCol - 1]) : '',
    gameId: map.gameIdCol ? preResMailerText_(values[map.gameIdCol - 1]) : '',
    paymentMethod: map.paymentMethodCol ? preResMailerText_(values[map.paymentMethodCol - 1]) : '',
    voucherAnswer: map.voucherAnswerCol ? preResMailerText_(values[map.voucherAnswerCol - 1]) : '',
    manualAction: map.manualActionCol ? preResMailerText_(values[map.manualActionCol - 1]) : '',
    explicitDeadline: explicitDeadline,
    computedDeadline: computedDeadline,
    deadlineWithTime: preResMailerFormatDeadline_(deadline, true),
    deadlineDateOnly: preResMailerFormatDeadline_(deadline, false)
  };
}

function preResMailerKeepLatestRows_(rows) {
  const filtered = rows.filter(row =>
    (row.email || row.gameId) &&
    !/重複申請/.test(row.manualAction) &&
    !preResMailerIsManualSkip_(row.manualAction)
  );
  return preResMailerGroupRowsByIdentity_(filtered).map(group => group.latest);
}

function preResMailerGroupRowsByIdentity_(rows) {
  if (!rows.length) return [];

  const parent = rows.map((_, index) => index);
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }

  const byEmail = {};
  const byGameId = {};
  rows.forEach((row, index) => {
    const emailKey = row.email ? row.email.toLowerCase() : '';
    const gameKey = preResMailerNormalizeGameId_(row.gameId);
    if (emailKey && byEmail[emailKey] != null) union(index, byEmail[emailKey]);
    if (gameKey && byGameId[gameKey] != null) union(index, byGameId[gameKey]);
    if (emailKey) byEmail[emailKey] = index;
    if (gameKey) byGameId[gameKey] = index;
  });

  const groups = {};
  rows.forEach((row, index) => {
    const root = find(index);
    if (!groups[root]) groups[root] = { rows: [], latest: null };
    groups[root].rows.push(row);
    if (!groups[root].latest || preResMailerIsLaterApplication_(row, groups[root].latest)) {
      groups[root].latest = row;
    }
  });

  return Object.keys(groups).map(key => groups[key]);
}

function preResMailerIsLaterApplication_(candidate, current) {
  const candidateTime = preResMailerToDate_(candidate.timestamp).getTime();
  const currentTime = preResMailerToDate_(current.timestamp).getTime();
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  return Number(candidate.sourceRow || 0) > Number(current.sourceRow || 0);
}

function preResMailerMailTypeForRow_(row) {
  if (!row.email) return '';
  if (row.voucherAnswer) return '';
  if (preResMailerIsManualSkip_(row.manualAction)) return '';
  if (/キャンセル通知済/.test(row.manualAction)) return '';
  if (/キャンセル/.test(row.manualAction) && !row.cancelMailSent) return 'cancel';
  if (row.cancelMailSent) return '';
  if (preResMailerIsContract_(row.paymentMethod) && !row.dayGuideSent) return 'contract_confirmed';
  if (row.paymentConfirmed && !row.dayGuideSent) return 'day_guide';
  if (!row.paymentInviteSent && !row.paymentConfirmed && preResMailerIsCoin_(row.paymentMethod)) return 'coin_payment';
  if (!row.paymentInviteSent && !row.paymentConfirmed && preResMailerIsLivePocket_(row.paymentMethod)) return 'livepocket_payment';
  return '';
}

function preResMailerIsManualSkip_(value) {
  return PRE_RES_TEMPLATE_MAILER.manualSkipPattern.test(preResMailerText_(value));
}

function preResMailerBuildMail_(template, row, ctx) {
  return {
    subject: preResMailerHydrateText_(template.subject, row, ctx).trim(),
    body: preResMailerHydrateBody_(template.body, row, ctx)
  };
}

function preResMailerHydrateBody_(body, row, ctx) {
  let text = preResMailerHydrateText_(body, row, ctx).replace(/\r\n/g, '\n');
  if (/^[ \u3000]*様/m.test(text)) {
    text = text.replace(/^[ \u3000]*様/m, row.playerName + '様');
  }
  text = text.replace(/(➤(?:お支払い|トランスファー)期限：)\s*月日.*?(?=\n|$)/g, '$1' + row.deadlineWithTime);
  text = text.replace(/(➤(?:お支払い|トランスファー)期限：)\s*(?=\n|$)/g, '$1' + row.deadlineWithTime);
  if (ctx.livePocketUrl) {
    text = text.replace(/(➤お支払い用リンク：)\s*(?=\n|$)/g, '$1' + ctx.livePocketUrl);
  }
  return text.trim();
}

function preResMailerHydrateText_(text, row, ctx) {
  return String(text || '')
    .replace(/\{\{NAME\}\}/g, row.playerName)
    .replace(/\{\{EVENT_NAME\}\}/g, ctx.eventName)
    .replace(/\{\{GAME_ID\}\}/g, row.gameId)
    .replace(/\{\{PAYMENT_DEADLINE\}\}/g, row.deadlineWithTime)
    .replace(/\{\{LIVEPOCKET_URL\}\}/g, ctx.livePocketUrl || '');
}

function preResMailerFindOrCreateDraft_(to, bcc, subject, body) {
  const drafts = GmailApp.getDrafts();
  const normalizedTo = preResMailerNormalizeEmail_(to);
  const normalizedFrom = preResMailerNormalizeEmail_(PRE_RES_TEMPLATE_MAILER.from);
  const normalizedBcc = preResMailerNormalizeEmail_(bcc || PRE_RES_TEMPLATE_MAILER.defaultBcc);
  const normalizedBody = preResMailerNormalizeBody_(body);

  for (let i = 0; i < drafts.length; i++) {
    const message = drafts[i].getMessage();
    if (
      preResMailerNormalizeEmail_(message.getTo()) === normalizedTo &&
      preResMailerNormalizeEmail_(message.getFrom()) === normalizedFrom &&
      preResMailerEmailListContains_(message.getBcc(), normalizedBcc) &&
      message.getSubject() === subject &&
      preResMailerNormalizeBody_(message.getPlainBody()) === normalizedBody
    ) {
      return { draftId: drafts[i].getId(), reused: true };
    }
  }

  preResMailerAssertFromAlias_();
  const draft = GmailApp.createDraft(to, subject, body, {
    from: PRE_RES_TEMPLATE_MAILER.from,
    name: PRE_RES_TEMPLATE_MAILER.fromName,
    bcc: normalizedBcc
  });
  return { draftId: draft.getId(), reused: false };
}

function preResMailerAssertFromAlias_() {
  const from = PRE_RES_TEMPLATE_MAILER.from.toLowerCase();
  const available = GmailApp.getAliases().map(alias => String(alias).toLowerCase());
  const effectiveUser = Session.getEffectiveUser().getEmail().toLowerCase();
  if (from !== effectiveUser && available.indexOf(from) < 0) {
    throw new Error('送信元アドレスが Gmail のエイリアスに設定されていません: ' + PRE_RES_TEMPLATE_MAILER.from);
  }
}

function preResMailerMarkSourceAfterSend_(sheet, map, sourceRow, mailType) {
  if ((mailType === 'coin_payment' || mailType === 'livepocket_payment') && map.paymentInviteSentCol) {
    sheet.getRange(sourceRow, map.paymentInviteSentCol).setValue(true);
  }
  if ((mailType === 'day_guide' || mailType === 'contract_confirmed') && map.dayGuideSentCol) {
    sheet.getRange(sourceRow, map.dayGuideSentCol).setValue(true);
  }
  if (mailType === 'cancel' && map.cancelMailSentCol) {
    sheet.getRange(sourceRow, map.cancelMailSentCol).setValue(true);
    if (map.manualActionCol) {
      sheet.getRange(sourceRow, map.manualActionCol).setValue('キャンセル通知済');
    }
  }
}

function preResMailerGetOrCreateReportSheet_(ss) {
  let sheet = ss.getSheetByName(PRE_RES_TEMPLATE_MAILER.reportSheetName);
  if (!sheet) sheet = ss.insertSheet(PRE_RES_TEMPLATE_MAILER.reportSheetName);
  return sheet;
}

function preResMailerPrepareLivePocketGameIdSheet_(sheet) {
  sheet.getRange(1, 1, 1, PRE_RES_TEMPLATE_MAILER.livePocketGameIdHeaders.length)
    .setValues([PRE_RES_TEMPLATE_MAILER.livePocketGameIdHeaders])
    .setFontWeight('bold')
    .setBackground('#d9ead3');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 180);
  sheet.setColumnWidth(3, 180);
  sheet.setColumnWidth(4, 100);
}

function preResMailerGetActiveReportSheet_() {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== PRE_RES_TEMPLATE_MAILER.reportSheetName) {
    throw new Error('先に REPORT_PRE_RES_MAIL を開いてください。');
  }
  return sheet;
}

function preResMailerLooksLikeControlSheet_(sheet) {
  return !!(sheet && preResMailerReadEventNameFromSheet_(sheet));
}

function preResMailerBuildComposeUrl_(to, bcc, subject, body) {
  return 'https://mail.google.com/mail/?view=cm&fs=1' +
    '&to=' + encodeURIComponent(to || '') +
    '&bcc=' + encodeURIComponent(bcc || PRE_RES_TEMPLATE_MAILER.defaultBcc) +
    '&su=' + encodeURIComponent(subject || '') +
    '&body=' + encodeURIComponent(body || '');
}

function preResMailerToDate_(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || 0);
  return isNaN(date.getTime()) ? new Date(0) : date;
}

function preResMailerValidDate_(value) {
  if (value === '' || value == null) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (isNaN(date.getTime())) return null;
  const parts = Utilities.formatDate(date, PRE_RES_TEMPLATE_MAILER.timezone, 'yyyy,M,d').split(',');
  return preResMailerCreateTokyoDate_(Number(parts[0]), Number(parts[1]), Number(parts[2]));
}

function preResMailerCalculateBusinessDeadline_(timestamp) {
  const base = timestamp instanceof Date ? new Date(timestamp.getTime()) : new Date(timestamp);
  if (isNaN(base.getTime())) return null;
  const timezone = PRE_RES_TEMPLATE_MAILER.timezone;
  const parts = Utilities.formatDate(base, timezone, 'yyyy,M,d,H').split(',');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const hour = Number(parts[3]);

  const start = preResMailerCreateTokyoDate_(year, month, day);
  if (hour >= 19) start.setUTCDate(start.getUTCDate() + 1);

  let counted = 0;
  const cursor = new Date(start.getTime());
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (counted < 3) {
    if (preResMailerIsBusinessDay_(cursor, timezone)) {
      counted++;
      if (counted >= 3) break;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return cursor;
}

function preResMailerCreateTokyoDate_(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day) - 9 * 60 * 60 * 1000);
}

function preResMailerIsBusinessDay_(date, timezone) {
  const dayOfWeek = Number(Utilities.formatDate(date, timezone || PRE_RES_TEMPLATE_MAILER.timezone, 'u'));
  return dayOfWeek !== 3 && dayOfWeek !== 7;
}

function preResMailerFormatDeadline_(date, includeTime) {
  if (!date) return '';
  const parts = Utilities.formatDate(date, PRE_RES_TEMPLATE_MAILER.timezone, 'M,d,u').split(',');
  const weekdays = ['月', '火', '水', '木', '金', '土', '日'];
  const text = parts[0] + '月' + parts[1] + '日(' + weekdays[Number(parts[2]) - 1] + ')';
  return includeTime ? text + '23:59まで' : text;
}

function preResMailerIsChecked_(value) {
  return value === true || String(value).trim().toUpperCase() === 'TRUE';
}

function preResMailerIsCoin_(value) {
  return /Poker Web Coin|webコイン|coin/i.test(preResMailerText_(value));
}

function preResMailerIsLivePocket_(value) {
  return /LivePocket/i.test(preResMailerText_(value));
}

function preResMailerIsContract_(value) {
  return /選手契約履行|contract|player contract/i.test(preResMailerText_(value));
}

function preResMailerNormalizeEmail_(value) {
  const text = preResMailerText_(value).toLowerCase();
  const match = text.match(/<([^>]+)>/);
  return match ? match[1].trim() : text;
}

function preResMailerNormalizeBody_(value) {
  return String(value == null ? '' : value).replace(/\r\n/g, '\n').trim();
}

function preResMailerEmailListContains_(emailList, expectedEmail) {
  return preResMailerText_(emailList)
    .split(',')
    .map(preResMailerNormalizeEmail_)
    .indexOf(preResMailerNormalizeEmail_(expectedEmail)) >= 0;
}

function preResMailerText_(value) {
  return String(value == null ? '' : value)
    .replace(/\u3000/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\r\n]+/g, ' ')
    .trim();
}

function preResMailerNormalizeGameId_(value) {
  return preResMailerText_(value);
}

function preResMailerIsGameIdHeader_(value) {
  return /^(?:Game\s*ID|ゲーム\s*ID)$/i.test(preResMailerText_(value));
}
