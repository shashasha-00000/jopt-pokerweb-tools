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
  from: 'customer@japanopenpoker.com',
  fromName: 'Japan Open Poker Tour / JOPT',
  defaultBcc: 'customer@japanopenpoker.com',
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
  templateTypes: ['coin_payment', 'livepocket_payment', 'contract_confirmed', 'day_guide', 'cancel']
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
  manualActionCol: ['手動指示']
};

function openPreReservationTemplateDrivenMailMenu() {
  SpreadsheetApp.getUi()
    .createMenu(PRE_RES_TEMPLATE_MAILER.menuName)
    .addItem('REPORT作成', 'buildPreReservationTemplateDrivenMailReport')
    .addItem('REPORTのGmail下書きを作成', 'createDraftsFromPreReservationTemplateDrivenMailReport')
    .addItem('REPORTの送信OKメールを送信', 'sendApprovedPreReservationTemplateDrivenMailReport')
    .addToUi();
}

function buildPreReservationTemplateDrivenMailReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ctx = preResMailerResolveContext_(ss);
  const templates = preResMailerLoadTemplates_(ss, ctx);
  const rows = preResMailerReadSourceRows_(ctx.sourceSheet, ctx.sourceMap);
  const latestRows = preResMailerKeepLatestRows_(rows);
  const output = [];
  const richLinks = [];

  latestRows.forEach(row => {
    const mailType = preResMailerMailTypeForRow_(row);
    if (!mailType) return;

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
  const startRow = map.headerRow + 1;
  if (sheet.getLastRow() < startRow) return [];
  const rowCount = Math.min(sheet.getLastRow() - startRow + 1, PRE_RES_TEMPLATE_MAILER.maxReadRows);
  const values = sheet.getRange(startRow, 1, rowCount, sheet.getLastColumn()).getValues();
  const rows = values.map((row, index) => preResMailerParseSourceRow_(row, startRow + index, map));

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

    if (hasUpdate) {
      sheet.getRange(startRow, map.paymentDeadlineCol, rowCount, 1)
        .setValues(deadlineValues)
        .setNumberFormat('m/d(aaa)');
    }
  }

  return rows;
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
    !/重複申請/.test(row.manualAction)
  );
  if (!filtered.length) return [];

  const parent = filtered.map((_, index) => index);
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
  filtered.forEach((row, index) => {
    const emailKey = row.email ? row.email.toLowerCase() : '';
    const gameKey = row.gameId || '';
    if (emailKey && byEmail[emailKey] != null) union(index, byEmail[emailKey]);
    if (gameKey && byGameId[gameKey] != null) union(index, byGameId[gameKey]);
    if (emailKey) byEmail[emailKey] = index;
    if (gameKey) byGameId[gameKey] = index;
  });

  const groups = {};
  filtered.forEach((row, index) => {
    const root = find(index);
    if (!groups[root] || preResMailerToDate_(row.timestamp) >= preResMailerToDate_(groups[root].timestamp)) {
      groups[root] = row;
    }
  });

  return Object.keys(groups).map(key => groups[key]);
}

function preResMailerMailTypeForRow_(row) {
  if (!row.email) return '';
  if (row.voucherAnswer) return '';
  if (/キャンセル通知済/.test(row.manualAction)) return '';
  if (/キャンセル/.test(row.manualAction) && !row.cancelMailSent) return 'cancel';
  if (row.cancelMailSent) return '';
  if (preResMailerIsContract_(row.paymentMethod) && !row.dayGuideSent) return 'contract_confirmed';
  if (row.paymentConfirmed && !row.dayGuideSent) return 'day_guide';
  if (!row.paymentInviteSent && !row.paymentConfirmed && preResMailerIsCoin_(row.paymentMethod)) return 'coin_payment';
  if (!row.paymentInviteSent && !row.paymentConfirmed && preResMailerIsLivePocket_(row.paymentMethod)) return 'livepocket_payment';
  return '';
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
  date.setHours(0, 0, 0, 0);
  return date;
}

function preResMailerCalculateBusinessDeadline_(timestamp) {
  const base = timestamp instanceof Date ? new Date(timestamp.getTime()) : new Date(timestamp);
  if (isNaN(base.getTime())) return null;
  const timezone = Session.getScriptTimeZone();
  const parts = Utilities.formatDate(base, timezone, 'yyyy,M,d,H').split(',');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const hour = Number(parts[3]);

  const start = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (hour >= 19) start.setDate(start.getDate() + 1);

  let counted = 0;
  const cursor = new Date(start.getTime());
  cursor.setDate(cursor.getDate() + 1);
  while (counted < 3) {
    if (preResMailerIsBusinessDay_(cursor, timezone)) {
      counted++;
      if (counted >= 3) break;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  cursor.setHours(0, 0, 0, 0);
  return cursor;
}

function preResMailerIsBusinessDay_(date, timezone) {
  const dayOfWeek = Number(Utilities.formatDate(date, timezone || Session.getScriptTimeZone(), 'u'));
  return dayOfWeek !== 3 && dayOfWeek !== 7;
}

function preResMailerFormatDeadline_(date, includeTime) {
  if (!date) return '';
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const text = (date.getMonth() + 1) + '月' + date.getDate() + '日(' + weekdays[date.getDay()] + ')';
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
