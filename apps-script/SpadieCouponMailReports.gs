/**
 * SPADIE coupon mail REPORT tool.
 *
 * Source sheet columns:
 *   A: イベント
 *   B: 入賞者名
 *   C: 入賞Email
 *   D: Coupon Code
 *
 * Flow:
 *   1. Open the source sheet and run createSpadieCouponMailReport().
 *   2. Review the generated REPORT_SPADIE_COUPON_MAIL sheet.
 *   3. Run createDraftsFromSpadieCouponMailReport().
 *   4. Optional: enter OK in the 送信OK column, then run sendApprovedSpadieCouponMails().
 */

const SPADIE_COUPON_MAIL_CONFIG = {
  reportSheetName: 'REPORT_SPADIE_COUPON_MAIL',
  headerRow: 1,
  dataStartRow: 2,
  from: 'customer@japanopenpoker.com',
  fromName: 'JOPT Gamesカスタマーサポート',
  bcc: 'customer@japanopenpoker.com',
  subject: '【JOPT Games】SPADIEサテライトチケットのご案内',
  excludeAlreadySentByGmail: true,
  sentMailLookbackDays: 365,
  columns: {
    eventName: 1,
    playerName: 2,
    email: 3,
    couponCode: 4
  }
};

const SPADIE_COUPON_REPORT_HEADERS = [
  '元行',
  'イベント',
  '入賞者名',
  'メールアドレス',
  'クーポンコード',
  '件名',
  '本文',
  '下書きステータス',
  'エラー',
  'Draft ID',
  '送信OK',
  '送信ステータス',
  '送信日時'
];

function onOpen() {
  spadieCouponMailOnOpen();
}

function installSpadieCouponMailMenu() {
  spadieCouponMailOnOpen();
  SPADIE_alert_(
    'メニュー「SPADIEクーポンメール」を追加しました。\n' +
    'Spreadsheetを再読み込みするとメニューが表示されます。'
  );
}

function spadieCouponMailOnOpen() {
  SpreadsheetApp.getUi()
    .createMenu('SPADIEクーポンメール')
    .addItem('現在のシートからREPORT作成', 'createSpadieCouponMailReport')
    .addItem('REPORTのGmail下書きを作成', 'createDraftsFromSpadieCouponMailReport')
    .addItem('REPORTの下書き状態を修復', 'repairSpadieCouponMailReportDraftStatus')
    .addItem('REPORTの送信OKメールを送信', 'sendApprovedSpadieCouponMails')
    .addToUi();
}

function createSpadieCouponMailReport() {
  try {
    SPADIE_createReport_();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error(error && error.stack ? error.stack : error);
    SPADIE_alert_('REPORT作成を停止しました。\n\n' + message);
    throw error;
  }
}

function createDraftsFromSpadieCouponMailReport() {
  try {
    SPADIE_createDraftsFromReport_();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error(error && error.stack ? error.stack : error);
    SPADIE_alert_('Gmail下書き作成を停止しました。\n\n' + message);
    throw error;
  }
}

function sendApprovedSpadieCouponMails() {
  try {
    SPADIE_sendApprovedFromReport_();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error(error && error.stack ? error.stack : error);
    SPADIE_alert_('送信処理を停止しました。\n\n' + message);
    throw error;
  }
}

function repairSpadieCouponMailReportDraftStatus() {
  try {
    SPADIE_repairReportDraftStatus_();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error(error && error.stack ? error.stack : error);
    SPADIE_alert_('REPORT修復を停止しました。\n\n' + message);
    throw error;
  }
}

function SPADIE_createReport_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Spreadsheetを取得できません。');

  const source = ss.getActiveSheet();
  if (!source) throw new Error('現在開いているシートを取得できません。');
  if (source.getName() === SPADIE_COUPON_MAIL_CONFIG.reportSheetName) {
    throw new Error('REPORTシートでは実行できません。元の一覧シートを開いてから実行してください。');
  }

  SPADIE_assertMailConfig_();

  const lastRow = source.getLastRow();
  const requiredColumn = Math.max(
    SPADIE_COUPON_MAIL_CONFIG.columns.eventName,
    SPADIE_COUPON_MAIL_CONFIG.columns.playerName,
    SPADIE_COUPON_MAIL_CONFIG.columns.email,
    SPADIE_COUPON_MAIL_CONFIG.columns.couponCode
  );
  if (lastRow < SPADIE_COUPON_MAIL_CONFIG.dataStartRow) {
    throw new Error('データ行がありません。');
  }
  if (source.getLastColumn() < requiredColumn) {
    throw new Error('A:D列が必要です。イベント、入賞者名、入賞Email、Coupon Codeを確認してください。');
  }

  const values = source
    .getRange(
      SPADIE_COUPON_MAIL_CONFIG.dataStartRow,
      1,
      lastRow - SPADIE_COUPON_MAIL_CONFIG.dataStartRow + 1,
      requiredColumn
    )
    .getDisplayValues();

  const errors = [];
  const seenEmailsAndCoupons = {};
  const groups = {};
  const groupOrder = [];
  let skippedIncompleteRows = 0;

  values.forEach((row, offset) => {
    const sheetRow = SPADIE_COUPON_MAIL_CONFIG.dataStartRow + offset;
    const eventName = SPADIE_text_(row[SPADIE_COUPON_MAIL_CONFIG.columns.eventName - 1]);
    const playerName = SPADIE_text_(row[SPADIE_COUPON_MAIL_CONFIG.columns.playerName - 1]);
    const email = SPADIE_text_(row[SPADIE_COUPON_MAIL_CONFIG.columns.email - 1]).toLowerCase();
    const couponCode = SPADIE_text_(row[SPADIE_COUPON_MAIL_CONFIG.columns.couponCode - 1]);

    if (!eventName && !playerName && !email && !couponCode) return;

    if (!eventName || !playerName || !email || !couponCode) {
      skippedIncompleteRows++;
      return;
    }

    if (!SPADIE_isValidEmail_(email)) errors.push(sheetRow + '行目: メールアドレスが不正です。[' + email + ']');

    const duplicateKey = email + '\n' + couponCode;
    if (email && couponCode && seenEmailsAndCoupons[duplicateKey]) {
      errors.push(
        sheetRow + '行目: 同じメールアドレスとCoupon Codeの組み合わせが重複しています。最初の行=' +
        seenEmailsAndCoupons[duplicateKey] + '行目'
      );
    }
    seenEmailsAndCoupons[duplicateKey] = sheetRow;

    if (!groups[email]) {
      groups[email] = {
        sourceRows: [],
        eventNames: [],
        playerName: playerName,
        email: email,
        couponCodes: []
      };
      groupOrder.push(email);
    }

    groups[email].sourceRows.push(sheetRow);
    groups[email].eventNames.push(eventName);
    groups[email].couponCodes.push(couponCode);
    if (groups[email].playerName !== playerName) {
      errors.push(
        sheetRow + '行目: 同じメールアドレスに複数の入賞者名があります。最初の名前=[' +
        groups[email].playerName + '] / この行の名前=[' + playerName + ']'
      );
    }
  });

  if (errors.length) {
    throw new Error(
      '安全のためREPORTを作成しませんでした。\n\n' +
      errors.slice(0, 30).join('\n') +
      (errors.length > 30 ? '\n...ほか ' + (errors.length - 30) + ' 件' : '')
    );
  }
  const rows = groupOrder.map(email => {
    const group = groups[email];
    const body = SPADIE_buildMailBody_(group.playerName, group.eventNames, group.couponCodes);
    return [
      group.sourceRows.join(', '),
      group.eventNames.join('\n'),
      group.playerName,
      group.email,
      group.couponCodes.join('\n'),
      SPADIE_COUPON_MAIL_CONFIG.subject,
      body,
      '',
      '',
      '',
      '',
      '',
      ''
    ];
  });

  if (!rows.length) throw new Error('作成対象の行がありません。');

  const report = SPADIE_getOrCreateReportSheet_(ss);
  report.clear();
  report.getRange(1, 1, 1, SPADIE_COUPON_REPORT_HEADERS.length)
    .setValues([SPADIE_COUPON_REPORT_HEADERS])
    .setFontWeight('bold')
    .setBackground('#d9ead3');
  report.getRange(2, 1, rows.length, SPADIE_COUPON_REPORT_HEADERS.length).setValues(rows);
  report.getRange(2, 7, rows.length, 1).setWrap(true);
  report.setFrozenRows(1);
  report.autoResizeColumns(1, SPADIE_COUPON_REPORT_HEADERS.length);
  ss.setActiveSheet(report);

  SPADIE_alert_(
    'REPORTを作成しました。\n\n' +
    '対象: ' + rows.length + '件\n' +
    '未完成行スキップ: ' + skippedIncompleteRows + '件\n' +
    'シート: ' + SPADIE_COUPON_MAIL_CONFIG.reportSheetName + '\n\n' +
    '内容を確認してから「REPORTのGmail下書きを作成」を実行してください。'
  );
}

function SPADIE_createDraftsFromReport_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const report = SPADIE_requireReportSheet_(ss);
  SPADIE_assertMailConfig_();
  SPADIE_assertReportHeaders_(report);
  SPADIE_assertAlias_();

  const lastRow = report.getLastRow();
  if (lastRow < 2) throw new Error('REPORTにデータ行がありません。');

  const values = report.getRange(2, 1, lastRow - 1, SPADIE_COUPON_REPORT_HEADERS.length).getValues();
  const existingDraftKeys = SPADIE_collectExistingDraftKeys_();

  let created = 0;
  let skipped = 0;
  let errors = 0;

  values.forEach((row, index) => {
    const sheetRow = index + 2;
    const email = SPADIE_text_(row[3]).toLowerCase();
    const couponCode = SPADIE_text_(row[4]);
    const subject = SPADIE_text_(row[5]);
    const body = String(row[6] || '');
    const draftStatus = SPADIE_text_(row[7]);
    const draftId = SPADIE_text_(row[9]);
    const sendStatus = SPADIE_text_(row[11]);

    if (!email && !subject && !body) {
      skipped++;
      return;
    }
    if (sendStatus === '送信済み') {
      skipped++;
      return;
    }
    if (draftStatus === '下書き作成済み' && draftId) {
      skipped++;
      return;
    }

    try {
      report.getRange(sheetRow, 8, 1, 3).clearContent();

      if (!SPADIE_isValidEmail_(email)) throw new Error('メールアドレスが不正です。');
      if (!subject) throw new Error('件名が空白です。');
      if (!body) throw new Error('本文が空白です。');
      if (SPADIE_wasAlreadySent_(email, subject, couponCode)) {
        report.getRange(sheetRow, 8).setValue('送信済み確認');
        report.getRange(sheetRow, 12).setValue('送信済み確認');
        skipped++;
        return;
      }
      const draftKey = SPADIE_makeMailKey_(email, subject, couponCode);
      if (existingDraftKeys[draftKey]) {
        throw new Error('同じ宛先・件名・クーポンコードのGmail下書きが既にあります。');
      }

      const draft = GmailApp.createDraft(email, subject, body, {
        from: SPADIE_COUPON_MAIL_CONFIG.from,
        name: SPADIE_COUPON_MAIL_CONFIG.fromName,
        bcc: SPADIE_COUPON_MAIL_CONFIG.bcc
      });

      report.getRange(sheetRow, 8).setValue('下書き作成済み');
      report.getRange(sheetRow, 9).clearContent();
      report.getRange(sheetRow, 10).setValue(draft.getId());
      existingDraftKeys[draftKey] = true;
      created++;
      Utilities.sleep(200);
    } catch (error) {
      report.getRange(sheetRow, 8).setValue('エラー');
      report.getRange(sheetRow, 9).setValue(error.message || String(error));
      errors++;
    }
  });

  SPADIE_alert_(
    'Gmail下書き作成が完了しました。\n\n' +
    '作成: ' + created + '件\n' +
    'スキップ: ' + skipped + '件\n' +
    'エラー: ' + errors + '件\n\n' +
    'Gmailの下書きを確認してから手動で送信、または送信OK列にOKを入れて送信処理を実行してください。'
  );
}

function SPADIE_sendApprovedFromReport_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const report = SPADIE_requireReportSheet_(ss);
  SPADIE_assertReportHeaders_(report);

  const lastRow = report.getLastRow();
  if (lastRow < 2) throw new Error('REPORTにデータ行がありません。');

  const values = report.getRange(2, 1, lastRow - 1, SPADIE_COUPON_REPORT_HEADERS.length).getValues();
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  values.forEach((row, index) => {
    const sheetRow = index + 2;
    const subject = SPADIE_text_(row[5]);
    const email = SPADIE_text_(row[3]).toLowerCase();
    const couponCode = SPADIE_text_(row[4]);
    const draftStatus = SPADIE_text_(row[7]);
    const draftId = SPADIE_text_(row[9]);
    const sendOk = SPADIE_text_(row[10]).toUpperCase();
    const sendStatus = SPADIE_text_(row[11]);

    if (sendStatus === '送信済み') {
      skipped++;
      return;
    }
    if (sendOk !== 'OK') {
      skipped++;
      return;
    }
    if (draftStatus !== '下書き作成済み' || !draftId) {
      skipped++;
      return;
    }

    try {
      if (SPADIE_wasAlreadySent_(email, subject, couponCode)) {
        report.getRange(sheetRow, 12).setValue('送信済み確認');
        skipped++;
        return;
      }
      const draft = GmailApp.getDraft(draftId);
      const message = draft.getMessage();
      if (message.getSubject() !== subject) {
        throw new Error('下書きの件名がREPORTと一致しません。');
      }
      draft.send();
      report.getRange(sheetRow, 12).setValue('送信済み');
      report.getRange(sheetRow, 13).setValue(new Date());
      sent++;
      Utilities.sleep(500);
    } catch (error) {
      report.getRange(sheetRow, 12).setValue('送信エラー');
      report.getRange(sheetRow, 9).setValue(error.message || String(error));
      errors++;
    }
  });

  SPADIE_alert_(
    '送信処理が完了しました。\n\n' +
    '送信済み: ' + sent + '件\n' +
    'スキップ: ' + skipped + '件\n' +
    'エラー: ' + errors + '件'
  );
}

function SPADIE_repairReportDraftStatus_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const report = SPADIE_requireReportSheet_(ss);
  SPADIE_assertReportHeaders_(report);

  const lastRow = report.getLastRow();
  if (lastRow < 2) throw new Error('REPORTにデータ行がありません。');

  let clearedDeletedDrafts = 0;
  let clearedDuplicateErrors = 0;
  let kept = 0;

  for (let row = 2; row <= lastRow; row++) {
    const draftStatus = SPADIE_text_(report.getRange(row, 8).getValue());
    const error = SPADIE_text_(report.getRange(row, 9).getValue());
    const draftId = SPADIE_text_(report.getRange(row, 10).getValue());
    const sendStatus = SPADIE_text_(report.getRange(row, 12).getValue());

    if (sendStatus === '送信済み') {
      kept++;
      continue;
    }

    if (draftId && !SPADIE_draftExists_(draftId)) {
      report.getRange(row, 8, 1, 3).clearContent();
      clearedDeletedDrafts++;
      continue;
    }

    if (!draftId && draftStatus === 'エラー' && error.indexOf('Gmail下書きが既にあります') >= 0) {
      report.getRange(row, 8, 1, 3).clearContent();
      clearedDuplicateErrors++;
      continue;
    }

    kept++;
  }

  SPADIE_alert_(
    'REPORTの下書き状態を修復しました。\n\n' +
    '削除済みDraft IDのクリア: ' + clearedDeletedDrafts + '件\n' +
    '重複下書きエラーのクリア: ' + clearedDuplicateErrors + '件\n' +
    '変更なし: ' + kept + '件\n\n' +
    '必要に応じて「REPORTのGmail下書きを作成」を再実行してください。'
  );
}

function SPADIE_draftExists_(draftId) {
  try {
    GmailApp.getDraft(draftId);
    return true;
  } catch (_) {
    return false;
  }
}

function SPADIE_buildMailBody_(playerName, eventNames, couponCodes) {
  const eventText = SPADIE_joinJapaneseList_(SPADIE_asList_(eventNames));
  const couponText = SPADIE_asList_(couponCodes).join('\n');

  return (
    playerName + ' 様\n\n' +
    'この度はSPADIEにご参加いただき、誠にありがとうございました。\n' +
    'JOPT Gamesカスタマーサポートです。\n\n' +
    eventText + 'でのご入賞、誠におめでとうございます。\n\n' +
    'SPADIEの入賞特典としてお渡しするサテライトチケットにつきまして、システム上の不具合によりご案内が遅れておりました。\n' +
    'お待たせしてしまい、誠に申し訳ございません。\n\n' +
    '下記のクーポンコードをJOPT Games内でご入力いただくことで、サテライトチケットをお受け取りいただけます。\n\n' +
    '【クーポンコード】\n' +
    couponText + '\n\n' +
    'ご利用方法が分からない場合や、チケットが反映されない場合は、下記のJOPT Games専用LINEまでお問い合わせください。\n\n' +
    '【お問い合わせ先】\n' +
    'https://lin.ee/wdliPf5\n\n' +
    'この度はご案内が遅くなりましたこと、重ねてお詫び申し上げます。\n' +
    '今後ともJOPT Gamesをよろしくお願いいたします。'
  );
}

function SPADIE_asList_(value) {
  if (Array.isArray(value)) return value.map(SPADIE_text_).filter(Boolean);
  return String(value || '')
    .split(/\r?\n/)
    .map(SPADIE_text_)
    .filter(Boolean);
}

function SPADIE_joinJapaneseList_(items) {
  const list = items.map(SPADIE_text_).filter(Boolean);
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  return list.join('と');
}

function SPADIE_getOrCreateReportSheet_(ss) {
  return ss.getSheetByName(SPADIE_COUPON_MAIL_CONFIG.reportSheetName) ||
    ss.insertSheet(SPADIE_COUPON_MAIL_CONFIG.reportSheetName);
}

function SPADIE_requireReportSheet_(ss) {
  if (!ss) throw new Error('Spreadsheetを取得できません。');
  const sheet = ss.getActiveSheet();
  if (!sheet || sheet.getName() !== SPADIE_COUPON_MAIL_CONFIG.reportSheetName) {
    throw new Error(
      'REPORT_SPADIE_COUPON_MAILシートを開いてから実行してください。'
    );
  }
  return sheet;
}

function SPADIE_assertReportHeaders_(sheet) {
  const headers = sheet.getRange(1, 1, 1, SPADIE_COUPON_REPORT_HEADERS.length)
    .getValues()[0]
    .map(SPADIE_text_);
  const differences = [];
  SPADIE_COUPON_REPORT_HEADERS.forEach((expected, index) => {
    if (headers[index] !== expected) {
      differences.push((index + 1) + '列目: 期待=[' + expected + '] 実際=[' + headers[index] + ']');
    }
  });
  if (differences.length) {
    throw new Error(
      'REPORTの列構造が想定と異なるため停止しました。\n' +
      differences.join('\n')
    );
  }
}

function SPADIE_assertMailConfig_() {
  if (!SPADIE_isValidEmail_(SPADIE_COUPON_MAIL_CONFIG.from)) {
    throw new Error('送信元メールアドレスが不正です。');
  }
  if (!SPADIE_COUPON_MAIL_CONFIG.fromName) {
    throw new Error('送信者名が空白です。');
  }
  if (!SPADIE_COUPON_MAIL_CONFIG.subject) {
    throw new Error('件名が空白です。');
  }
  if (SPADIE_COUPON_MAIL_CONFIG.bcc && !SPADIE_isValidEmail_(SPADIE_COUPON_MAIL_CONFIG.bcc)) {
    throw new Error('BCCメールアドレスが不正です。');
  }
}

function SPADIE_assertAlias_() {
  const available = GmailApp.getAliases().map(alias => SPADIE_text_(alias).toLowerCase());
  const effectiveUser = Session.getEffectiveUser().getEmail().toLowerCase();
  const from = SPADIE_COUPON_MAIL_CONFIG.from.toLowerCase();
  if (from !== effectiveUser && !available.includes(from)) {
    throw new Error(
      '送信元メールアドレス [' + SPADIE_COUPON_MAIL_CONFIG.from + '] は、' +
      '現在のGmailアカウントで使用できる送信エイリアスではありません。'
    );
  }
}

function SPADIE_collectExistingDraftKeys_() {
  const keys = {};
  GmailApp.getDrafts().forEach(draft => {
    const message = draft.getMessage();
    const to = SPADIE_text_(message.getTo()).toLowerCase();
    const subject = SPADIE_text_(message.getSubject());
    const body = message.getPlainBody();
    const couponCode = SPADIE_extractCouponCodeFromBody_(body);
    if (couponCode) {
      keys[SPADIE_makeMailKey_(to, subject, couponCode)] = true;
    }
  });
  return keys;
}

function SPADIE_makeMailKey_(email, subject, couponCode) {
  return [
    SPADIE_text_(email).toLowerCase(),
    SPADIE_text_(subject),
    SPADIE_text_(couponCode)
  ].join('\n');
}

function SPADIE_extractCouponCodeFromBody_(body) {
  const text = String(body || '').replace(/\r\n/g, '\n');
  const match = text.match(/【クーポンコード】\s*\n([\s\S]*?)(?:\n\s*\n|$)/);
  return match ? SPADIE_asList_(match[1]).join('\n') : '';
}

function SPADIE_wasAlreadySent_(email, subject, couponCode) {
  if (!SPADIE_COUPON_MAIL_CONFIG.excludeAlreadySentByGmail) return false;
  if (!email || !subject || !couponCode) return false;

  const safeEmail = String(email).replace(/"/g, '');
  const safeSubject = String(subject).replace(/"/g, '');
  const couponCodes = SPADIE_asList_(couponCode);
  if (!couponCodes.length) return false;
  const newerThanDays = Number(SPADIE_COUPON_MAIL_CONFIG.sentMailLookbackDays) || 365;
  const query =
    'in:sent newer_than:' + newerThanDays + 'd ' +
    'to:"' + safeEmail + '" subject:"' + safeSubject + '" ' +
    couponCodes.map(code => '"' + String(code).replace(/"/g, '') + '"').join(' ');

  return GmailApp.search(query, 0, 1).length > 0;
}

function SPADIE_isValidEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function SPADIE_text_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\u3000/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function SPADIE_alert_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (_) {
    console.log(message);
  }
}
