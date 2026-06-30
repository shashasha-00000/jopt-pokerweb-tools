/**
 * 事前予約コントロールパネル母版.
 *
 * Customer-facing mail bodies are intentionally left blank.
 * Fill PRE_RES_MAIL_TEMPLATES after user-provided original text is confirmed.
 */

const PRE_RES_CONFIG = {
  sheetName: 'フォームの回答 1',
  headerRow: 14,
  dataStartRow: 15,
  defaultBcc: 'customer@japanopenpoker.com',
  maxReadRows: 1000,
  autoFillPaymentDeadline: false,
  defaultPaymentDeadlineDays: 3,
  eventNameOverride: 'SPADIE TOKYO 42nd / NLH Heads-up Championship',
  eventKeyOverride: 'NLH Heads-up Championship',
  livePocketUrl: '',
  events: {
    'Open Face Chinese Poker': {
      max: 64,
      advancePaymentAmount: 20000,
      dayOfPaymentAmount: 1000,
      livePocketUrl: 'https://livepocket.jp/e/u560d',
      staffName: '大園',
      tournamentDateTime: '2026年8月10日(月) 12:00 トーナメント開始',
      receptionStart: '11:00',
      receptionClose: '11:45',
      receptionNote: '・受付はご予約者ご本人様のみとさせていただきます。'
    },
    'NLH Team Battle -3on3-': {
      max: 72,
      advancePaymentAmount: 30000,
      dayOfPaymentAmount: 3000,
      livePocketUrl: 'https://livepocket.jp/e/34npl',
      staffName: '澤木',
      tournamentDateTime: '2026年8月10日(月) 18:00 トーナメント開始',
      receptionStart: '17:00',
      receptionClose: '17:45',
      receptionNote: '・当日は３名お揃いになられてから、代表者様のみ受付をされてください。'
    },
    'NLH Tag Battle -2on2-': {
      max: 64,
      advancePaymentAmount: 20000,
      dayOfPaymentAmount: 2000,
      staffName: '澤木',
      tournamentDateTime: '2026年8月12日(水) 19:00 トーナメント開始',
      receptionStart: '18:00',
      receptionClose: '18:45',
      receptionNote: '・当日は２名お揃いになられてから、代表者様のみ受付をされてください。'
    },
    'NLH Heads-up Knockout - 3on3 -': {
      max: 64,
      advancePaymentAmount: 30000,
      dayOfPaymentAmount: 3000,
      livePocketUrl: 'https://livepocket.jp/e/ax_qy',
      staffName: '合澤',
      tournamentDateTime: '2026年8月13日(木) 19:00 トーナメント開始',
      receptionStart: '18:00',
      receptionClose: '18:45',
      receptionNote: '・代表者様のみ受付をされてください。'
    },
    'NLH Heads-up Championship': {
      max: 32,
      advancePaymentAmount: 50000,
      dayOfPaymentAmount: 1000,
      livePocketUrl: 'https://livepocket.jp/e/gyu3_',
      staffName: 'ノギフン',
      tournamentDateTime: '2026年8月14日(金) 13:00 トーナメント開始',
      receptionStart: '12:00',
      receptionClose: '12:45',
      receptionNote: '・当日はご到着されましたら、受付をされてください。'
    }
  },
  cells: {
    title: 'A1',
    editFormLink: 'A6',
    publishedFormLink: 'A7',
    coinMail: 'B9',
    livePocketMail: 'C9',
    contractConfirmedMail: 'D9',
    dayGuideMail: 'B10',
    livePocketUrlLabel: 'F10',
    livePocketUrlValue: 'F11',
    cancelMail: 'B11',
    maxValue: 'D12',
    totalApplications: 'D13',
    paymentConfirmed: 'F13',
    contractCount: 'H13',
    coinCount: 'J13',
    livePocketCount: 'L13'
  },
  columns: {
    paymentInviteSent: 1,   // A: 決済メール送信
    paymentConfirmed: 2,    // B: 決済確認
    pwEntry: 3,             // C: PWエントリー
    dayGuideSent: 4,        // D: 当日案内メール
    cancelMailSent: 5,      // E: キャンセルメール
    paymentDeadline: 6,     // F: 支払期限
    timestamp: 7,           // G: タイムスタンプ
    email: 8,               // H: メールアドレス
    gameId: 9,              // I: GameID
    playerName: 10,         // J: プレイヤーネーム
    paymentMethod: 11,      // K: 決済方法
    voucherAnswer: 15       // O: どのバウチャーを何枚ご利用されますか？
    // 手動指示は表の最後尾に動的に追加されるため固定列番号は持たない（preResManualActionCol_参照）
  }
};

const PRE_RES_MAIL_TEMPLATES = {
  coin_payment: {
    label: 'メール作成（コイン）',
    subjectSuffix: '事前決済のご案内',
    subjectPattern: '【{{EVENT_NAME}}】 事前決済のご案内',
    body: `{{NAME}}様

お世話になっております。
ジャパンオープンポーカーツアー株式会社の{{STAFF_NAME}}と申します。

この度は 「{{EVENT_NAME}}」にお申込みいただき、誠にありがとうございます。
事前決済について詳細をお送りいたします。

■事前決済
Poker Web Coin にて「JOPTクラブ」宛に {{ADVANCE_PAYMENT_AMOUNT}} coinをトランスファーしてください。
※フォームで入力いただいたGame IDで照合を行います。

➤トランスファー先：JOPTクラブ
➤金額：{{ADVANCE_PAYMENT_AMOUNT}} coin
➤トランスファー期限：{{PAYMENT_DEADLINE}}
※期限までにお支払いが確認できなかった場合、自動的にキャンセルとなります。
※いかなる理由においても決済完了後のご返金は致しかねますので、予めご了承いただけますと幸いです。
※決済の確認が取れ次第、決済完了および当日のご案内メールをお送りいたします。

何かご不明な点がございましたら、下記の連絡先よりお気軽にお問い合わせくださいませ。

メールアドレス：customer＠japanopenpoker.com
公式LINE：https://lin.ee/ckO5p3F

営業時間：10時～19時 (水・日を除く)
`
  },
  livepocket_payment: {
    label: 'メール作成（LivePocket）',
    subjectSuffix: '事前決済のご案内',
    subjectPattern: '【{{EVENT_NAME}}】 事前決済のご案内',
    body: `{{NAME}}様

お世話になっております。
ジャパンオープンポーカーツアー株式会社の{{STAFF_NAME}} と申します。

この度は 「 {{EVENT_NAME}} 」 にお申込みいただき、誠にありがとうございます。
事前決済について詳細をお送りいたします。

■事前決済
下記リンクからLive Pocket にてお支払いをお願いいたします。

➤お支払い用リンク：{{LIVEPOCKET_URL}}
➤金額：{{ADVANCE_PAYMENT_AMOUNT}}円
➤お支払い期限：{{PAYMENT_DEADLINE}}
※期限までにお支払いが確認できなかった場合、自動的にキャンセルとなります。
※いかなる理由においても決済完了後のご返金は致しかねますので、予めご了承いただけますと幸いです。
※決済の確認が取れ次第、決済完了および当日のご案内メールをお送りいたします。

何かご不明な点がございましたら、下記の連絡先よりお気軽にお問い合わせくださいませ。

メールアドレス：customer＠japanopenpoker.com
公式LINE：https://lin.ee/ckO5p3F

営業時間：10時～19時 (水・日を除く)
`
  },
  contract_confirmed: {
    label: 'メール作成（決済完了＆当日案内）',
    subjectSuffix: '決済完了および当日のご案内',
    subjectPattern: '【{{EVENT_NAME}}】 当日のご案内',
    body: `{{NAME}}様

お世話になっております。
ジャパンオープンポーカーツアー株式会社の{{STAFF_NAME}}と申します。

この度は 「{{EVENT_NAME}}」 にお申込みいただき、誠にありがとうございます。

選手契約履行にて事前決済が完了いたしました。
つきましては、当日のご案内を以下の通りお知らせいたします。

■ 大会概要
・会場：ベルサール高田馬場
・住所：〒169-0072 東京都新宿区大久保３丁目８−２ 住友不動産新宿ガーデンタワーB2・1F
・日時：{{TOURNAMENT_DATETIME}}
・受付開始：{{RECEPTION_START}}
※エントリー受付は{{RECEPTION_CLOSE}}までにお越しください。
・当日お支払い金額：ドリンクチケット {{DAY_OF_PAYMENT_AMOUNT}}円

■受付に関して
{{RECEPTION_NOTE}}
・トーナメント開始時間までに受付を完了されていない場合は、着席されるまでの間、置きバケとなりゲームは進行します。置きバケ中は、BTNは移動しブラインドは都度回収されます。
・事前決済いただいた分につきましてはご参加できなかった場合もご返金致しかねます。
・リエントリーはございません。


何かご不明な点がございましたら、下記の連絡先よりお気軽にお問い合わせくださいませ。

メールアドレス：customer＠japanopenpoker.com
公式LINE：https://lin.ee/ckO5p3F


営業時間：10時～19時 (水・日を除く)
`
  },
  day_guide: {
    label: 'メール作成（当日案内）',
    subjectSuffix: '当日のご案内',
    subjectPattern: '【{{EVENT_NAME}}】 当日のご案内',
    body: `{{NAME}}様

お世話になっております。
ジャパンオープンポーカーツアー株式会社の{{STAFF_NAME}}と申します。
この度は「 {{EVENT_NAME}} 」にお申込みいただき、誠にありがとうございます。

決済の確認が取れましたので、お申込みが完了いたしました。
つきましては、当日のご案内を以下の通りお知らせいたします。

■ 大会概要
・会場：ベルサール高田馬場
・住所：〒169-0072 東京都新宿区大久保３丁目８−２ 住友不動産新宿ガーデンタワーB2・1F
・日時：{{TOURNAMENT_DATETIME}}
・受付開始：{{RECEPTION_START}}
※エントリー受付は{{RECEPTION_CLOSE}}までにお越しください。
・当日お支払い金額：ドリンクチケット {{DAY_OF_PAYMENT_AMOUNT}}円

■受付に関して
{{RECEPTION_NOTE}}
・トーナメント開始時間までに受付を完了されていない場合は、着席されるまでの間、置きバケとなりゲームは進行します。置きバケ中は、BTNは移動しブラインドは都度回収されます。
・事前決済いただいた分につきましてはご参加できなかった場合もご返金致しかねます。
・リエントリーはございません。

ご不明点がございましたらお気軽にご連絡ください。
よろしくお願いいたします。

メールアドレス：customer＠japanopenpoker.com
公式LINE：https://lin.ee/ckO5p3F
営業時間：10時～19時 (水・日を除く)
`
  },
  cancel: {
    label: 'メール作成（キャンセル）',
    subjectSuffix: '申込のキャンセルについて',
    subjectPattern: '【{{EVENT_NAME}}】 事前予約キャンセルのお知らせ',
    body: `{{NAME}}様

お世話になっております。
ジャパンオープンポーカーツアー株式会社の {{STAFF_NAME}} でございます。

この度は、「{{EVENT_NAME}}」へお申し込みいただき、誠にありがとうございます。

ご連絡を差し上げておりましたが、現時点までにご返信をいただけていないため、誠に恐縮ではございますが、今回のお申込みはキャンセルとさせていただきました。

当日受付もございますので、ご都合がよろしければぜひ会場へお越しくださいませ。
※当日受付は先着順となり、定員に達し次第受付を終了いたします。あらかじめご了承ください。

何かご不明な点がございましたら、下記の連絡先よりお気軽にお問い合わせくださいませ。

メールアドレス：customer＠japanopenpoker.com
公式LINE：https://lin.ee/ckO5p3F

営業時間：10時～19時 (水・日を除く)
`
  }
};

function onOpen() {
  preReservationOnOpen();
}

function preReservationOnOpen() {
  SpreadsheetApp.getUi()
    .createMenu('事前予約管理')
    .addItem('①メールリンクを先に作成', 'preResStep1WriteLinksFirst')
    .addItem('②列挿入・統計を更新（①の後に実行）', 'preResStep2InsertColumnsAndStats')
    .addSeparator()
    .addItem('メール作成リンクを更新', 'updatePreReservationMailHyperlinks')
    .addItem('フォームリンクを自動更新', 'updatePreReservationFormLinks')
    .addSeparator()
    .addItem('対象メールのGmail下書きを作成', 'createPreReservationDrafts')
    .addToUi();
}

function preResStep1WriteLinksFirst() {
  const sheet = preResSheet_();
  const mapping = [
    [PRE_RES_CONFIG.cells.coinMail, 'coin_payment'],
    [PRE_RES_CONFIG.cells.livePocketMail, 'livepocket_payment'],
    [PRE_RES_CONFIG.cells.contractConfirmedMail, 'contract_confirmed'],
    [PRE_RES_CONFIG.cells.dayGuideMail, 'day_guide'],
    [PRE_RES_CONFIG.cells.cancelMail, 'cancel']
  ];
  mapping.forEach(item => {
    preResWriteTemplateLink_(sheet, item[0], item[1], preResBlankRow_(sheet));
  });
  updatePreReservationFormLinks();
  SpreadsheetApp.getUi().alert('①メールリンクの作成が完了しました。次に「②列挿入・統計を更新」を実行してください。');
}

function preResStep2InsertColumnsAndStats() {
  const sheet = preResSheet_();
  preResEnsureManagementColumns_(sheet);
  preResPrepareDeadlineAndManualColumns_(sheet);
  preResApplyConditionalFormatting_(sheet);
  preResUpdateStats_(sheet);
  preResPrepareLivePocketUrlField_(sheet);
  SpreadsheetApp.getUi().alert('②列挿入・統計の更新が完了しました。');
}

function preResEnsureManagementColumns_(sheet) {
  const headerRow = PRE_RES_CONFIG.headerRow;
  const c = PRE_RES_CONFIG.columns;
  const firstHeader = preResText_(sheet.getRange(headerRow, 1).getDisplayValue());
  const currentPaymentHeader = preResText_(sheet.getRange(headerRow, c.paymentInviteSent).getDisplayValue());

  if (currentPaymentHeader === '決済メール送信') {
    // 旧バージョン（5列のみ）で初期化済みのシート。支払期限列が無ければ補完する。
    const currentDeadlineHeader = preResText_(sheet.getRange(headerRow, c.paymentDeadline).getDisplayValue());
    if (currentDeadlineHeader !== '支払期限') {
      sheet.insertColumnsBefore(c.paymentDeadline, 1);
      sheet.getRange(headerRow, c.paymentDeadline).setValue('支払期限');
      sheet.getRange(PRE_RES_CONFIG.dataStartRow, c.paymentDeadline, sheet.getMaxRows() - PRE_RES_CONFIG.dataStartRow + 1, 1)
        .setNumberFormat('m/d(aaa)');
    }
    return;
  }
  if (firstHeader !== 'タイムスタンプ') return;

  sheet.insertColumnsBefore(1, 6);
  sheet.getRange(headerRow, 1, 1, 6).setValues([[
    '決済メール送信',
    '決済確認',
    'PWエントリー',
    '当日案内メール',
    'キャンセルメール',
    '支払期限'
  ]]);
  sheet.getRange(PRE_RES_CONFIG.dataStartRow, 1, sheet.getMaxRows() - PRE_RES_CONFIG.dataStartRow + 1, 5)
    .insertCheckboxes();
  sheet.getRange(PRE_RES_CONFIG.dataStartRow, c.paymentDeadline, sheet.getMaxRows() - PRE_RES_CONFIG.dataStartRow + 1, 1)
    .setNumberFormat('m/d(aaa)');
}

function updatePreReservationFormLinks() {
  const sheet = preResSheet_();
  const eventName = preResEventName_(sheet);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const formUrl = ss.getFormUrl();

  if (!formUrl) {
    preResSetPlainCellWithNote_(
      sheet,
      PRE_RES_CONFIG.cells.editFormLink,
      eventName + ' 事前予約フォーム（編集）',
      'このスプレッドシートに紐づくGoogleフォームが見つかりません。'
    );
    preResSetPlainCellWithNote_(
      sheet,
      PRE_RES_CONFIG.cells.publishedFormLink,
      eventName + ' 事前予約フォーム（回答用）',
      'このスプレッドシートに紐づくGoogleフォームが見つかりません。'
    );
    return;
  }

  const form = FormApp.openByUrl(formUrl);
  preResSetHyperlink_(
    sheet,
    PRE_RES_CONFIG.cells.editFormLink,
    form.getEditUrl(),
    eventName + ' 事前予約フォーム（編集）'
  );
  preResSetHyperlink_(
    sheet,
    PRE_RES_CONFIG.cells.publishedFormLink,
    form.getPublishedUrl(),
    eventName + ' 事前予約フォーム（回答用）'
  );
}

function updatePreReservationMailHyperlinks() {
  const sheet = preResSheet_();
  preResUpdateStats_(sheet);

  const mapping = [
    [PRE_RES_CONFIG.cells.coinMail, 'coin_payment'],
    [PRE_RES_CONFIG.cells.livePocketMail, 'livepocket_payment'],
    [PRE_RES_CONFIG.cells.contractConfirmedMail, 'contract_confirmed'],
    [PRE_RES_CONFIG.cells.dayGuideMail, 'day_guide'],
    [PRE_RES_CONFIG.cells.cancelMail, 'cancel']
  ];

  mapping.forEach(item => {
    preResWriteTemplateLink_(sheet, item[0], item[1], preResBlankRow_(sheet));
  });
}

function createPreReservationDrafts() {
  const sheet = preResSheet_();
  const rows = preResReadRows_(sheet);
  const manualActionCol = preResManualActionCol_(sheet);
  let created = 0;
  let skipped = 0;
  let errors = 0;

  rows.forEach(row => {
    const type = preResMailTypeForRow_(row);
    if (!type) {
      skipped++;
      return;
    }

    try {
      const mail = preResMakeMail_(type, row);
      GmailApp.createDraft(row.email, mail.subject, mail.body, {
        bcc: PRE_RES_CONFIG.defaultBcc
      });
      preResMarkSourceAfterDraft_(sheet, row, type, manualActionCol);
      created++;
    } catch (error) {
      sheet.getRange(row.sourceRow, manualActionCol)
        .setNote('下書き作成エラー: ' + error.message);
      errors++;
    }
  });

  SpreadsheetApp.getUi().alert(
    'Gmail下書き作成が完了しました。\n\n作成: ' + created +
    '件\nスキップ: ' + skipped + '件\nエラー: ' + errors + '件'
  );
}

function preResMailTypeForRow_(row) {
  if (!row.email) return '';
  if (preResHasVoucher_(row)) return '';
  if (row.cancelMailSent || preResText_(row.manualAction) === 'キャンセル通知済') return '';
  if (preResText_(row.manualAction) === 'キャンセル' && !row.cancelMailSent) return 'cancel';
  if (row.paymentConfirmed && !row.dayGuideSent) return 'day_guide';
  if (preResIsContract_(row.paymentMethod) && !row.dayGuideSent) return 'contract_confirmed';
  if (!row.paymentInviteSent && !row.paymentConfirmed && preResIsCoin_(row.paymentMethod)) return 'coin_payment';
  if (!row.paymentInviteSent && !row.paymentConfirmed && preResIsLivePocket_(row.paymentMethod)) return 'livepocket_payment';
  return '';
}

function preResMarkSourceAfterDraft_(sheet, row, type, manualActionCol) {
  const c = PRE_RES_CONFIG.columns;
  if (type === 'coin_payment' || type === 'livepocket_payment') {
    sheet.getRange(row.sourceRow, c.paymentInviteSent).setValue(true);
  }
  if (type === 'day_guide' || type === 'contract_confirmed') {
    sheet.getRange(row.sourceRow, c.dayGuideSent).setValue(true);
  }
  if (type === 'cancel') {
    sheet.getRange(row.sourceRow, c.cancelMailSent).setValue(true);
    sheet.getRange(row.sourceRow, manualActionCol).setValue('キャンセル通知済');
  }
}

function preResManualActionCol_(sheet) {
  const headerRow = PRE_RES_CONFIG.headerRow;
  const lastCol = sheet.getLastColumn();
  for (let col = 1; col <= lastCol; col++) {
    if (preResText_(sheet.getRange(headerRow, col).getDisplayValue()) === '手動指示') return col;
  }
  const newCol = lastCol + 1;
  sheet.getRange(headerRow, newCol).setValue('手動指示');
  return newCol;
}

function preResPrepareDeadlineAndManualColumns_(sheet) {
  const manualActionCol = preResManualActionCol_(sheet);

  const validation = SpreadsheetApp.newDataValidation()
    .requireValueInList(['', 'キャンセル', 'キャンセル通知済', '支払い確認', 'テスト'], true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange(PRE_RES_CONFIG.dataStartRow, manualActionCol, sheet.getMaxRows() - PRE_RES_CONFIG.dataStartRow + 1, 1)
    .setDataValidation(validation);

  if (PRE_RES_CONFIG.autoFillPaymentDeadline) {
    preResFillMissingPaymentDeadlines_(sheet);
  }
}

function preResFillMissingPaymentDeadlines_(sheet) {
  const c = PRE_RES_CONFIG.columns;
  const lastRow = sheet.getLastRow();
  if (lastRow < PRE_RES_CONFIG.dataStartRow) return;

  const rowCount = lastRow - PRE_RES_CONFIG.dataStartRow + 1;
  const values = sheet.getRange(PRE_RES_CONFIG.dataStartRow, 1, rowCount, c.paymentDeadline).getValues();
  const output = values.map(row => {
    const existing = preResValidDate_(row[c.paymentDeadline - 1]);
    if (existing) return [existing];
    return [preResCalculateDeadline_(row[c.timestamp - 1])];
  });
  sheet.getRange(PRE_RES_CONFIG.dataStartRow, c.paymentDeadline, rowCount, 1)
    .setValues(output)
    .setNumberFormat('m/d(aaa)');
}

function preResApplyConditionalFormatting_(sheet) {
  const c = PRE_RES_CONFIG.columns;
  const start = PRE_RES_CONFIG.dataStartRow;
  const manualActionCol = preResManualActionCol_(sheet);
  const target = sheet.getRange(start, 1, sheet.getMaxRows() - start + 1, Math.max(sheet.getLastColumn(), manualActionCol));
  const targetA1 = target.getA1Notation();
  const existing = sheet.getConditionalFormatRules().filter(rule =>
    !rule.getRanges().some(range =>
      range.getSheet().getName() === sheet.getName() &&
      range.getA1Notation() === targetA1
    )
  );

  const deadline = preResColLetter_(c.paymentDeadline);
  const paymentConfirmed = preResColLetter_(c.paymentConfirmed);
  const cancelMailSent = preResColLetter_(c.cancelMailSent);
  const manualAction = preResColLetter_(manualActionCol);
  const rules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=OR($' + cancelMailSent + start + '=TRUE,$' + manualAction + start + '="キャンセル通知済")')
      .setBackground('#d9d9d9')
      .setRanges([target])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + manualAction + start + '="キャンセル"')
      .setBackground('#ead1dc')
      .setRanges([target])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + paymentConfirmed + start + '=TRUE')
      .setBackground('#c9daf8')
      .setRanges([target])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($' + deadline + start + '<>"",$' + paymentConfirmed + start + '<>TRUE,$' + deadline + start + '<TODAY())')
      .setBackground('#f4cccc')
      .setRanges([target])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($' + deadline + start + '<>"",$' + paymentConfirmed + start + '<>TRUE,$' + deadline + start + '=TODAY())')
      .setBackground('#fce5cd')
      .setRanges([target])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($' + deadline + start + '<>"",$' + paymentConfirmed + start + '<>TRUE,$' + deadline + start + '>TODAY())')
      .setBackground('#d9ead3')
      .setRanges([target])
      .build()
  ];

  sheet.setConditionalFormatRules(existing.concat(rules));
}

function preResUpdateStats_(sheet) {
  const eventName = preResEventName_(sheet);
  const event = preResEventConfig_(sheet);
  const c = PRE_RES_CONFIG.columns;
  const paymentConfirmedCol = preResColLetter_(c.paymentConfirmed);
  const emailCol = preResColLetter_(c.email);
  const paymentMethodCol = preResColLetter_(c.paymentMethod);
  const paymentConfirmedRange = paymentConfirmedCol + PRE_RES_CONFIG.dataStartRow + ':' + paymentConfirmedCol;
  const emailRange = emailCol + PRE_RES_CONFIG.dataStartRow + ':' + emailCol;
  const paymentMethodRange = paymentMethodCol + PRE_RES_CONFIG.dataStartRow + ':' + paymentMethodCol;

  sheet.getRange(PRE_RES_CONFIG.cells.maxValue).setValue(event.max || '');
  sheet.getRange(PRE_RES_CONFIG.cells.totalApplications).setFormula('=COUNTA(' + emailRange + ')');
  sheet.getRange(PRE_RES_CONFIG.cells.paymentConfirmed).setFormula('=COUNTIF(' + paymentConfirmedRange + ',TRUE)');
  sheet.getRange(PRE_RES_CONFIG.cells.contractCount).setFormula('=COUNTIF(' + paymentMethodRange + ',"*選手契約履行*")');
  sheet.getRange(PRE_RES_CONFIG.cells.coinCount).setFormula('=COUNTIF(' + paymentMethodRange + ',"*Poker Web Coin*")+COUNTIF(' + paymentMethodRange + ',"*webコイン*")');
  sheet.getRange(PRE_RES_CONFIG.cells.livePocketCount).setFormula('=COUNTIF(' + paymentMethodRange + ',"*LivePocket*")');
}

function preResPrepareLivePocketUrlField_(sheet) {
  const eventName = preResEventName_(sheet);
  const event = preResEventConfig_(sheet);
  const valueCell = sheet.getRange(PRE_RES_CONFIG.cells.livePocketUrlValue);
  sheet.getRange(PRE_RES_CONFIG.cells.livePocketUrlLabel).setValue('LivePocket URL');
  if (!preResText_(valueCell.getDisplayValue()) && event.livePocketUrl) {
    valueCell.setValue(event.livePocketUrl);
  }
}

function preResWriteTemplateLink_(sheet, cellA1, type, row) {
  const template = PRE_RES_MAIL_TEMPLATES[type];
  if (!template) throw new Error('Unknown mail type: ' + type);
  if (!preResText_(template.body)) {
    preResSetPlainCellWithNote_(
      sheet,
      cellA1,
      template.label,
      '本文未設定です。ユーザー提供原文を PRE_RES_MAIL_TEMPLATES.' + type + '.body に設定してください。'
    );
    return;
  }

  const mail = preResMakeMail_(type, row);
  const url = preResBuildGmailComposeUrl_('', mail.subject, mail.body);
  preResSetHyperlink_(sheet, cellA1, url, template.label);
}

function preResMakeMail_(type, row) {
  const template = PRE_RES_MAIL_TEMPLATES[type];
  if (!template) throw new Error('Unknown mail type: ' + type);
  if (!preResText_(template.body)) {
    throw new Error('本文未設定: ' + type);
  }
  const eventName = preResEventName_(preResSheet_());
  const subject = template.subjectPattern
    ? preResRenderTemplate_(template.subjectPattern, row)
    : (template.subjectPrefix
      ? template.subjectPrefix + eventName + ' ' + template.subjectSuffix
      : '【' + eventName + '】' + template.subjectSuffix);
  return {
    subject,
    body: preResRenderTemplate_(template.body, row)
  };
}

function preResRenderTemplate_(template, row) {
  const sheet = preResSheet_();
  const eventName = preResEventName_(sheet);
  const event = preResEventConfig_(sheet);
  const replacements = {
    NAME: row.playerName || '',
    EVENT_NAME: eventName,
    STAFF_NAME: event.staffName || '澤木',
    ADVANCE_PAYMENT_AMOUNT: preResFormatNumber_(event.advancePaymentAmount),
    DAY_OF_PAYMENT_AMOUNT: preResFormatNumber_(event.dayOfPaymentAmount),
    PAYMENT_DEADLINE: row.deadlineWithTime || '',
    LIVEPOCKET_URL: preResLivePocketUrl_(sheet, event),
    TOURNAMENT_DATETIME: event.tournamentDateTime || '',
    RECEPTION_START: event.receptionStart || '',
    RECEPTION_CLOSE: event.receptionClose || '',
    RECEPTION_NOTE: event.receptionNote || '',
    GAME_ID: row.gameId || ''
  };

  return String(template).replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : match
  );
}

function preResReadRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < PRE_RES_CONFIG.dataStartRow) return [];

  const manualActionCol = preResManualActionCol_(sheet);
  const readCols = Math.max(sheet.getLastColumn(), manualActionCol);
  const rowCount = Math.min(
    lastRow - PRE_RES_CONFIG.dataStartRow + 1,
    PRE_RES_CONFIG.maxReadRows
  );
  const values = sheet.getRange(PRE_RES_CONFIG.dataStartRow, 1, rowCount, readCols).getValues();

  return values.map((row, index) => preResParseRow_(row, PRE_RES_CONFIG.dataStartRow + index, manualActionCol));
}

function preResParseRow_(values, sourceRow, manualActionCol) {
  const c = PRE_RES_CONFIG.columns;
  const deadline = preResValidDate_(values[c.paymentDeadline - 1]);
  return {
    sourceRow,
    paymentInviteSent: preResIsChecked_(values[c.paymentInviteSent - 1]),
    paymentConfirmed: preResIsChecked_(values[c.paymentConfirmed - 1]),
    pwEntry: preResIsChecked_(values[c.pwEntry - 1]),
    dayGuideSent: preResIsChecked_(values[c.dayGuideSent - 1]),
    cancelMailSent: preResIsChecked_(values[c.cancelMailSent - 1]),
    timestamp: values[c.timestamp - 1],
    email: preResText_(values[c.email - 1]),
    gameId: preResText_(values[c.gameId - 1]),
    playerName: preResText_(values[c.playerName - 1]),
    paymentMethod: preResText_(values[c.paymentMethod - 1]),
    voucherAnswer: preResText_(values[c.voucherAnswer - 1]),
    paymentDeadline: values[c.paymentDeadline - 1],
    manualAction: preResText_(values[manualActionCol - 1]),
    deadlineWithTime: preResFormatDeadline_(deadline, true),
    deadlineDateOnly: preResFormatDeadline_(deadline, false)
  };
}

function preResBlankRow_(sheet) {
  return {
    sourceRow: 0,
    playerName: '',
    email: '',
    gameId: '',
    paymentMethod: '',
    voucherAnswer: '',
    deadlineWithTime: '',
    deadlineDateOnly: ''
  };
}

function preResSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const active = ss.getActiveSheet();
  if (active && preResLooksLikeControlSheet_(active)) return active;

  const configured = ss.getSheetByName(PRE_RES_CONFIG.sheetName);
  if (configured) return configured;

  const management = ss.getSheetByName('管理');
  if (management) return management;

  if (active) return active;

  throw new Error('対象シートが見つかりません。対象シートを開いてから実行してください。');
}

function preResEventName_(sheet) {
  if (PRE_RES_CONFIG.eventNameOverride) return PRE_RES_CONFIG.eventNameOverride;
  const title = preResText_(sheet.getRange(PRE_RES_CONFIG.cells.title).getDisplayValue());
  return title.replace(/\s*予約確認\s*$/, '');
}

function preResEventKey_(sheet) {
  if (PRE_RES_CONFIG.eventKeyOverride) return PRE_RES_CONFIG.eventKeyOverride;
  const title = preResText_(sheet.getRange(PRE_RES_CONFIG.cells.title).getDisplayValue());
  return title.replace(/\s*予約確認\s*$/, '');
}

function preResEventConfig_(sheet) {
  return PRE_RES_CONFIG.events[preResEventKey_(sheet)] || {};
}

function preResLivePocketUrl_(sheet, event) {
  return preResText_(sheet.getRange(PRE_RES_CONFIG.cells.livePocketUrlValue).getDisplayValue()) ||
    PRE_RES_CONFIG.livePocketUrl ||
    preResText_(event && event.livePocketUrl);
}

function preResLooksLikeControlSheet_(sheet) {
  const title = preResText_(sheet.getRange(PRE_RES_CONFIG.cells.title).getDisplayValue());
  const emailHeader = preResText_(sheet.getRange(PRE_RES_CONFIG.headerRow, PRE_RES_CONFIG.columns.email).getDisplayValue());
  return /予約確認$/.test(title) || emailHeader === 'メールアドレス';
}

function preResBuildGmailComposeUrl_(to, subject, body) {
  return 'https://mail.google.com/mail/?view=cm&fs=1' +
    '&to=' + encodeURIComponent(to || '') +
    '&bcc=' + encodeURIComponent(PRE_RES_CONFIG.defaultBcc) +
    '&su=' + encodeURIComponent(subject) +
    '&body=' + encodeURIComponent(body);
}

function preResSetHyperlink_(sheet, cellA1, url, label) {
  const formula = '=HYPERLINK("' + preResEscapeFormula_(url) + '","' + preResEscapeFormula_(label) + '")';
  // セルが「書式なしテキスト」になっていると数式が評価されず文字列のまま表示されるため、先に解除する。
  const range = sheet.getRange(cellA1);
  range.setNumberFormat('General');
  range.setFormula(formula).setNote('');
}

function preResSetPlainCellWithNote_(sheet, cellA1, value, note) {
  sheet.getRange(cellA1).setValue(value).setNote(note || '');
}

function preResCalculateDeadline_(timestamp) {
  const date = timestamp instanceof Date ? new Date(timestamp.getTime()) : new Date(timestamp);
  if (isNaN(date.getTime())) return '';
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + PRE_RES_CONFIG.defaultPaymentDeadlineDays);
  return date;
}

function preResFormatDeadline_(date, includeTime) {
  if (!date) return '';
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const text = (date.getMonth() + 1) + '月' + date.getDate() + '日(' + weekdays[date.getDay()] + ')';
  return includeTime ? text + ' 23:59まで' : text;
}

function preResValidDate_(value) {
  if (value === '' || value == null) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function preResIsChecked_(value) {
  return value === true || String(value).trim().toUpperCase() === 'TRUE';
}

function preResIsCoin_(value) {
  return /Poker Web Coin|webコイン|コイン|coin/i.test(preResText_(value));
}

function preResIsLivePocket_(value) {
  return /LivePocket/i.test(preResText_(value));
}

function preResIsContract_(value) {
  return /選手契約履行|contract|player contract/i.test(preResText_(value));
}

function preResHasVoucher_(row) {
  return !!preResText_(row && row.voucherAnswer);
}

function preResText_(value) {
  return String(value == null ? '' : value)
    .replace(/　/g, ' ')
    .replace(/ /g, ' ')
    .replace(/[ \t\r\n]+/g, ' ')
    .trim();
}

function preResFormatNumber_(value) {
  if (value === '' || value == null) return '';
  return Number(value).toLocaleString('ja-JP');
}

function preResEscapeFormula_(value) {
  return String(value == null ? '' : value).replace(/"/g, '""');
}

function preResColLetter_(column) {
  let result = '';
  let value = column;
  while (value > 0) {
    value--;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}
