/**
 * ReceiptSemiAutoExperimental.gs
 *
 * 実験版の半自動領収書フロー。
 *
 * 人が行うこと:
 * - Google Form の回答を確認する
 * - PokerWeb から支払TSVを取得して PW TSVショウ用 に貼り付ける
 * - CHECK結果を確認し、確定・送信OKを明示する
 *
 * スクリプトが行うこと:
 * - Game IDでForm回答とPW TSVを結合する
 * - 重複申請、同一支払、宛名/送信先衝突をCHECKする
 * - 領収書番号を採番し、ブラウザ描画したPDFをDriveへ保存する
 * - 生成したDrive FileをそのままGmail下書きへ添付する
 * - 承認済み下書きだけ送信する
 *
 * 既存の手動版・自動版とは独立して動かすため、Sheet名と関数名はRSE専用。
 * 初回は RSE_setup() をApps Scriptエディタから実行する。
 */

const RSE = (() => {
  const CONFIG = {
    MENU_NAME: '領収書 半自動 EXP',
    SETTINGS_SHEET: 'RSE_設定',
    GAME_ID_CHECK_SHEET: 'RSE_GAME_ID_CHECK',
    PW_INPUT_SHEET: 'RSE_PW_INPUT',
    CHECK_SHEET: 'RSE_領収書CHECK',
    LEDGER_SHEET: 'RSE_領収書管理',
    DEFAULT_FORM_SHEET: 'フォームの回答 1',
    DEFAULT_PW_SHEET: 'PW TSVショウ用',
    FORM_PROCESSED_HEADER: '処理終了',
    HEADER_ROW: 1,
    DATA_START_ROW: 2,
    COMPANY_ADDRESS: '〒162-0845　東京都新宿区市谷本村町 2-21<br>市ケ谷キャナルコート 3階',
    COMPANY_NAME: 'ジャパンオープンポーカーツアー株式会社',
    REGISTRATION_NO: '登録番号：T2010001175193',
    FONT_FAMILY: '"Noto Sans JP", "Yu Gothic", "Meiryo", "BIZ UDGothic", sans-serif',
    INACTIVE_LEDGER_STATUSES: ['取消', '取消し', '取り消し', '差替済み']
  };

  const SETTINGS_DEFAULTS = [
    ['FORM_SHEET_NAME', CONFIG.DEFAULT_FORM_SHEET, 'Google Form回答Sheet名'],
    ['PW_SHEET_NAME', CONFIG.DEFAULT_PW_SHEET, '人工取得したPW TSVのSheet名'],
    ['NEXT_RECEIPT_NO', '900000', '次に採番する領収書番号'],
    ['MAX_RECEIPTS_PER_RUN', '', '空白なら全件生成。必要時だけ1回あたりの上限件数を入力'],
    ['PDF_FETCH_BATCH_SIZE', '200', 'ブラウザが1回に取得するPDF件数。推奨200、設定範囲1～500'],
    ['PDF_UPLOAD_BATCH_SIZE', '10', 'GSへ1回に返してDrive保存するPDF件数。推奨10、設定範囲1～50'],
    ['RECEIPT_FOLDER_URL', '', 'PDF保存先DriveフォルダURLまたはID'],
    ['FROM_ALIAS', '', 'Gmail送信元エイリアス。未設定なら空白'],
    ['FROM_NAME', 'Japan Open Poker Tour / JOPT', 'メール送信者表示名'],
    ['BCC', '', 'BCC'],
    ['SUBJECT', '電子領収書の送付について', 'メール件名']
  ];

  const GAME_ID_CHECK_HEADERS = [
    '判定', '確認状態', '確認内容', 'checkKey', 'sourceHash', 'confirmedHash',
    'Game ID', '回答数', '原始本名', '原始メールアドレス', '原始宛名',
    '確定本名', '確定メールアドレス', '確定宛名', '処理方針', '修正理由',
    '確認OK', '確認日時', '確認者', 'eventName', '申請キー'
  ];

  const PW_INPUT_HEADERS = ['Game ID'];

  const CHECK_HEADERS = [
    '判定', '確認状態', '確認内容', 'checkKey', 'sourceHash', 'confirmedHash',
    '申請キー', 'paymentKey', 'pdfKey', 'Game ID', '本名', 'メールアドレス',
    '宛名', 'eventName', '購入時間', '年', '月', '日', '大会名', '種別',
    '現金', 'クレジットカード', 'ポイント', 'USDT', '総金額',
    '処理方針', '修正理由', '確認OK', '確認日時', '確認者',
    '領収書No', 'PDF_FILE_ID', 'PDF_URL', 'ファイル状態', 'Draft ID',
    '草稿ステータス', '送信OK', '送信ステータス', '送信日時'
  ];

  const LEDGER_HEADERS = [
    'pdfKey', 'paymentKey', '領収書No', 'Game ID', '本名', 'メールアドレス',
    '宛名', 'eventName', '大会名', '購入時間', '種別', '総金額',
    'PDF_FILE_ID', 'PDF_URL', 'Draft ID', '草稿作成日時', 'メール送信日時',
    '送信先', 'status', '申請キー', '備考'
  ];

  const SETTINGS_HEADERS = ['設定項目', '設定値', '説明'];

  const FORM_ALIASES = {
    timestamp: ['タイムスタンプ', 'Timestamp', '申請日'],
    gameId: [
      'Game ID', 'GameID', 'ゲームID',
      'Game ID（８桁、ドット含まない）',
      'Game ID（8桁、ドット含まない）',
      'Game ID (8桁、ドット含まない)'
    ],
    name: ['本名(フルネーム)', '本名', '名前', '氏名'],
    email: [
      '領収書受け取り用メールアドレス', '受け取り用メールアドレス',
      'メールアドレス', 'Email', 'email', 'メール'
    ],
    recipient: ['宛名', '領収書の宛名'],
    eventName: ['対象大会', '対象イベント', 'イベント名', 'eventName', '大会名'],
    startDate: ['対象期間 （開始日）', '対象期間（開始日）', '開始日', '対象開始日'],
    endDate: ['対象期間（終了日）', '対象期間 （終了日）', '終了日', '対象終了日'],
    processed: ['処理終了']
  };

  const PW_ALIASES = {
    gameId: ['Game ID', 'GameID', 'ゲームID'],
    purchaseTime: ['購入時間', '購入日時'],
    year: ['年'],
    month: ['月'],
    day: ['日', '日付'],
    tournament: ['大会名', 'トーナメント名', 'トーナメント'],
    type: ['種別', '区分'],
    cash: ['現金'],
    creditCard: ['クレジットカード', 'カード'],
    points: ['ポイント', 'Point'],
    usdt: ['USDT']
  };

  function addMenu() {
    SpreadsheetApp.getUi()
      .createMenu(CONFIG.MENU_NAME)
      .addItem('初期設定', 'RSE_setup')
      .addSeparator()
      .addItem('1. Form → Game ID CHECK更新', 'RSE_refreshGameIdCheck')
      .addItem('2. Game ID CHECKを確定', 'RSE_confirmGameIdCheck')
      .addItem('3. PW 1.6.17入力を生成・表示', 'RSE_buildPwInput')
      .addSeparator()
      .addItem('4. PW TSV → 領収書CHECK更新', 'RSE_refreshReceiptCheck')
      .addItem('5. 領収書CHECKを確定', 'RSE_confirmReceiptCheck')
      .addItem('6. 未採番行へ領収書番号を採番', 'RSE_assignReceiptNumbers')
      .addSeparator()
      .addItem('7. ブラウザで未生成PDFを生成', 'RSE_generatePendingFiles')
      .addItem('8. 未作成Gmail草稿を生成', 'RSE_createPendingDrafts')
      .addItem('9. 送信OK → 承認済み草稿を送信', 'RSE_sendApproved')
      .addToUi();
  }

  function setup() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const settingsSheet = ensureSheet_(ss, CONFIG.SETTINGS_SHEET, SETTINGS_HEADERS);
    ensureSettingsDefaults_(settingsSheet);
    ensureSheet_(ss, CONFIG.GAME_ID_CHECK_SHEET, GAME_ID_CHECK_HEADERS);
    ensureSheet_(ss, CONFIG.PW_INPUT_SHEET, PW_INPUT_HEADERS);
    ensureSheet_(ss, CONFIG.CHECK_SHEET, CHECK_HEADERS);
    ensureSheet_(ss, CONFIG.LEDGER_SHEET, LEDGER_HEADERS);
    const settings = readSettings_(ss);
    ensureFormProcessedColumn_(requiredSheet_(ss, settings.FORM_SHEET_NAME || CONFIG.DEFAULT_FORM_SHEET));

    installOpenTrigger_();
    addMenu();
    alert_(
      '初期設定が完了しました。\n\n' +
      'RSE_設定 の保存先・開始番号・メール設定を確認してください。\n' +
      'フォーム回答Sheetには「処理終了」列を追加しました。'
    );
  }

  function refreshGameIdCheck() {
    const lock = LockService.getDocumentLock();
    lock.waitLock(30000);
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      assertInitialized_(ss);
      const settings = readSettings_(ss);
      const formSheet = requiredSheet_(ss, settings.FORM_SHEET_NAME || CONFIG.DEFAULT_FORM_SHEET);
      ensureFormProcessedColumn_(formSheet);
      const checkSheet = requiredSheet_(ss, CONFIG.GAME_ID_CHECK_SHEET);
      const applicationResult = readApplications_(formSheet, settings);
      const prior = objectMapBy_(readObjects_(checkSheet), 'checkKey');
      const nameGames = buildSharedValueMap_(applicationResult.byRequestKey, 'name');
      const emailGames = buildSharedValueMap_(applicationResult.byRequestKey, 'email');
      const rows = [];

      Object.keys(applicationResult.byRequestKey).sort().forEach(applicationKey => {
        const info = applicationResult.byRequestKey[applicationKey];
        const app = info.application;
        const gameId = app.gameId;
        const checkKey = 'APP__' + applicationKey;
        const sourceHash = hash_((info.applications || [app]).map(item => [
          item.rowNo, item.gameId, item.name, item.email, item.recipient, item.startDate, item.endDate
        ].join('|')).join('\n'));
        const old = prior[checkKey] || {};
        const finalGameId = normalizeGameId_(old['Game ID']) || gameId;
        const finalName = text_(old['確定本名'] || app.name);
        const finalEmail = text_(old['確定メールアドレス'] || app.email).toLowerCase();
        const finalRecipient = removeSama_(old['確定宛名'] !== undefined ? old['確定宛名'] : app.recipient);
        const policy = text_(old['処理方針']) === '除外' && text_(old['確認状態']) === '確定済み'
          ? '除外'
          : '採用';
        const messages = [];
        let judgement = 'OK';
        let requiresManual = false;

        if (info.conflict) {
          judgement = '確認必要';
          requiresManual = true;
          messages.push(info.message);
        } else if (info.duplicateExactCount > 1) {
          messages.push('同一内容の回答' + info.duplicateExactCount + '件を1件へ統合');
        }

        const nameKey = compact_(app.name);
        if (nameKey && nameGames[nameKey] && nameGames[nameKey].length > 1) {
          if (judgement === 'OK') judgement = '警告';
          requiresManual = true;
          messages.push('同名の別Game IDあり: ' + nameGames[nameKey].join(', '));
        }

        const emailKey = app.email.toLowerCase();
        if (emailKey && emailGames[emailKey] && emailGames[emailKey].length > 1) {
          judgement = '確認必要';
          requiresManual = true;
          messages.push('同一メールの別Game IDあり: ' + emailGames[emailKey].join(', '));
        }

        const finalHash = gameIdFinalHash_({
          sourceHash, gameId: finalGameId, finalName, finalEmail, finalRecipient, policy
        });
        const oldStillConfirmed = text_(old.sourceHash) === sourceHash &&
          text_(old.confirmedHash) === finalHash &&
          ['確定済み', '自動確定'].indexOf(text_(old['確認状態'])) >= 0;
        const autoConfirmed = !requiresManual && policy === '採用';
        const confirmedState = oldStillConfirmed
          ? text_(old['確認状態'])
          : (autoConfirmed ? '自動確定' : '未確定');
        const confirmedHash = oldStillConfirmed
          ? text_(old.confirmedHash)
          : (autoConfirmed ? finalHash : '');

        rows.push([
          judgement,
          confirmedState,
          messages.join(' / '),
          checkKey,
          sourceHash,
          confirmedHash,
          finalGameId,
          info.duplicateExactCount,
          app.name,
          app.email,
          app.recipient,
          finalName,
          finalEmail,
          finalRecipient,
          policy,
          text_(old['修正理由']),
          false,
          oldStillConfirmed ? old['確認日時'] || '' : '',
          oldStillConfirmed ? old['確認者'] || '' : '',
          [app.startDate, app.endDate].join(' - '),
          app.applicationKey
        ]);
      });

      applicationResult.invalid.forEach(item => {
        const app = item.application || {};
        const checkKey = 'INVALID_FORM__' + (app.rowNo || rows.length + 2);
        const sourceHash = hash_(item.message + '|' + JSON.stringify(app));
        const old = prior[checkKey] || {};
        const policy = text_(old['処理方針'] || '');
        const finalHash = gameIdFinalHash_({
          sourceHash,
          gameId: old['Game ID'] || app.gameId,
          finalName: old['確定本名'] || app.name,
          finalEmail: old['確定メールアドレス'] || app.email,
          finalRecipient: old['確定宛名'] || app.recipient,
          policy
        });
        const confirmed = text_(old.sourceHash) === sourceHash &&
          text_(old.confirmedHash) === finalHash &&
          text_(old['確認状態']) === '確定済み';
        rows.push([
          '確認必要', confirmed ? '確定済み' : '未確定', item.message,
          checkKey, sourceHash, confirmed ? finalHash : '', old['Game ID'] || app.gameId || '', 1,
          app.name || '', app.email || '', app.recipient || '',
          old['確定本名'] || app.name || '', old['確定メールアドレス'] || app.email || '',
          old['確定宛名'] || app.recipient || '', policy, old['修正理由'] || '', false,
          confirmed ? old['確認日時'] || '' : '', confirmed ? old['確認者'] || '' : '',
          app.eventName || '', app.applicationKey || ''
        ]);
      });

      writeManagedRows_(checkSheet, GAME_ID_CHECK_HEADERS, rows, [17]);
      formatGameIdCheckSheet_(checkSheet, rows.length);
      const unresolved = countUnresolvedGameIdRows_(readObjects_(checkSheet));
      alert_(
        'Game ID CHECK更新完了。\n\n' +
        '申請期間: ' + Object.keys(applicationResult.byRequestKey).length + '件\n' +
        '要確認: ' + unresolved + '件\n\n' +
        '緑色の確定値・処理方針を修正し、確認OKをONにして「CHECKを確定」を実行してください。'
      );
    } finally {
      lock.releaseLock();
    }
  }

  function confirmGameIdCheck() {
    const lock = LockService.getDocumentLock();
    lock.waitLock(30000);
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = requiredSheet_(ss, CONFIG.GAME_ID_CHECK_SHEET);
      const rows = readObjects_(sheet);
      let confirmed = 0;
      const errors = [];

      rows.forEach((row, index) => {
        const rowNo = index + 2;
        if (!isOn_(row['確認OK'])) return;
        const policy = text_(row['処理方針']);
        const gameId = normalizeGameId_(row['Game ID']);
        const finalName = text_(row['確定本名']);
        const finalEmail = text_(row['確定メールアドレス']).toLowerCase();
        const finalRecipient = removeSama_(row['確定宛名']);
        const reason = text_(row['修正理由']);

        if (['採用', '除外'].indexOf(policy) < 0) {
          errors.push(rowNo + '行: 処理方針は採用または除外');
          return;
        }
        if (policy === '採用' && (!gameId || !finalName || !validEmail_(finalEmail))) {
          errors.push(rowNo + '行: 採用には有効なGame ID・本名・メールが必要');
          return;
        }
        if (text_(row['判定']) === '確認必要' && !reason) {
          errors.push(rowNo + '行: 確認必要行は修正理由が必要');
          return;
        }

        const confirmedHash = gameIdFinalHash_({
          sourceHash: text_(row.sourceHash), gameId, finalName, finalEmail, finalRecipient, policy
        });
        setHeaderValue_(sheet, GAME_ID_CHECK_HEADERS, rowNo, 'confirmedHash', confirmedHash);
        setHeaderValue_(sheet, GAME_ID_CHECK_HEADERS, rowNo, '確認状態', '確定済み');
        setHeaderValue_(sheet, GAME_ID_CHECK_HEADERS, rowNo, '確認日時', new Date());
        setHeaderValue_(sheet, GAME_ID_CHECK_HEADERS, rowNo, '確認者', activeUserEmail_());
        setHeaderValue_(sheet, GAME_ID_CHECK_HEADERS, rowNo, '確認OK', false);
        confirmed++;
      });

      const unresolved = countUnresolvedGameIdRows_(readObjects_(sheet));
      alert_(
        'Game ID CHECK確定処理。\n\n確定: ' + confirmed + '件\n未解決: ' + unresolved + '件' +
        (errors.length ? '\n\nエラー:\n' + errors.slice(0, 20).join('\n') : '')
      );
    } finally {
      lock.releaseLock();
    }
  }

  function buildPwInput() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const checkSheet = requiredSheet_(ss, CONFIG.GAME_ID_CHECK_SHEET);
    const outputSheet = requiredSheet_(ss, CONFIG.PW_INPUT_SHEET);
    const rows = readObjects_(checkSheet);
    const unresolved = rows.filter(row => !isGameIdCheckRowResolved_(row));
    if (unresolved.length) {
      throw new Error('未確定のGame ID CHECKがあります。先に解決してください: ' + unresolved.length + '件');
    }

    const adoptedGameIds = rows
      .filter(row => text_(row['処理方針']) === '採用')
      .map(row => normalizeGameId_(row['Game ID']));
    const gameIds = uniqueStrings_(adoptedGameIds);
    if (!gameIds.length) throw new Error('採用済みGame IDがありません');

    const headers = ['Game ID'];
    const output = gameIds.map(gameId => [gameId]);
    writePwInputRows_(outputSheet, headers, output);
    const tsv = output.map(row => row.join('\t')).join('\n');
    showPwInputDialog_(tsv, output.length);
  }

  function refreshReceiptCheck() {
    const lock = LockService.getDocumentLock();
    lock.waitLock(30000);
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      assertInitialized_(ss);
      const settings = readSettings_(ss);
      const applications = readConfirmedApplications_(ss);
      const pwSheet = requiredSheet_(ss, settings.PW_SHEET_NAME || CONFIG.DEFAULT_PW_SHEET);
      const pwResult = readPwRows_(pwSheet, settings);
      const checkSheet = requiredSheet_(ss, CONFIG.CHECK_SHEET);
      const ledgerMap = buildLedgerMap_(readObjects_(requiredSheet_(ss, CONFIG.LEDGER_SHEET)));
      const prior = objectMapBy_(readObjects_(checkSheet), 'checkKey');
      const rows = buildReceiptCheckRows_(applications, pwResult, ledgerMap, prior, settings);
      const intersection = receiptIntersectionStats_(applications, pwResult);
      const replacementCount = rows.filter(row => text_(row[0]) === '差替').length;

      writeManagedRows_(checkSheet, CHECK_HEADERS, rows, [28, 37]);
      formatReceiptCheckSheet_(checkSheet, rows.length);
      const mailState = readSheetUpdateState_(checkSheet);
      const mailGroups = groupCheckRowsForDraft_(
        mailState.objects.filter(row => text_(row['処理方針']) === '新規発行')
      );
      Object.keys(mailGroups).forEach(gameId => {
        normalizeMailGroupDisplay_(mailState, mailGroups[gameId]);
        applyMailGroupConflictToCheck_(mailState, mailGroups[gameId]);
      });
      writeSheetUpdateState_(checkSheet, mailState);
      formatMailGroupControls_(checkSheet, mailGroups);
      PropertiesService.getDocumentProperties().deleteProperty('RSE_CONFIRMED_RECEIPT_BATCH_HASH');
      const unresolved = countUnresolvedReceiptRows_(readObjects_(checkSheet));
      alert_(
        '領収書CHECK更新完了。\n\n' +
        '対象明細: ' + rows.length + '件\n' +
        'Game ID CHECK確定値による自動差替: ' + replacementCount + '件\n' +
        '今回TSVなしでスキップした申請: ' + intersection.formOnlyGameIds + '件\n' +
        'Form申請なしでスキップしたGame ID: ' + intersection.pwOnlyGameIds + '件\n' +
        '不正TSV行スキップ: ' + intersection.invalidPwRows + '件\n' +
        '未解決: ' + unresolved + '件\n\n' +
        '正常行は自動確定です。\n' +
        '確認必要行は K～M列の確定値とZ列の処理方針を確認・修正し、' +
        'AA列に修正理由、AB列をONにしてからメニュー5を実行してください。'
      );
    } finally {
      lock.releaseLock();
    }
  }

  function buildReceiptCheckRows_(applications, pwResult, ledgerMap, prior, settings) {
    const output = [];
    const pwByGameId = pwResult.byGameId;
    const matchedApplicationKeys = Object.keys(applications)
      .filter(applicationKey => {
        const app = applications[applicationKey];
        return (pwByGameId[app.gameId] || []).some(pw => pwMatchesApplicationPeriod_(pw, app));
      })
      .sort();
    const seenPayments = new Set();

    matchedApplicationKeys.forEach(applicationKey => {
      const app = applications[applicationKey];
      const gameId = app.gameId;
      const pwRows = (pwByGameId[gameId] || []).filter(pw => pwMatchesApplicationPeriod_(pw, app));

      pwRows.forEach(pw => {
        const total = calcTotal_(pw);
        const paymentKey = makePaymentKey_({
          gameId, tournament: pw.tournament,
          purchaseTime: pw.purchaseTime, type: pw.type, total
        });
        const checkKey = paymentKey + '__PWROW__' + pw.rowNo;
        const old = prior[checkKey] || {};
        // Game ID CHECK の確定値を下流の唯一の人物情報として扱う。
        // 領収書CHECKの旧値は履歴であり、確定値を逆方向に上書きしてはいけない。
        const finalName = text_(app.name);
        const finalEmail = text_(app.email).toLowerCase();
        const finalRecipient = removeSama_(app.recipient);
        const pdfKey = makePdfKey_(paymentKey, finalRecipient);
        const existingPdf = ledgerMap.byPdfKey[pdfKey];
        const existingPayment = ledgerMap.byPaymentKey[paymentKey];
        const existingRecord = existingPdf || existingPayment || null;
        const existingName = text_(existingRecord && existingRecord['本名']);
        const existingEmail = text_(existingRecord && existingRecord['メールアドレス']).toLowerCase();
        const existingRecipient = removeSama_(existingRecord && existingRecord['宛名']);
        const existingPdfKey = text_(existingRecord && existingRecord.pdfKey);
        const authorityChanged = Boolean(text_(old.sourceHash)) && (
          text_(old['本名']) !== finalName ||
          text_(old['メールアドレス']).toLowerCase() !== finalEmail ||
          removeSama_(old['宛名']) !== finalRecipient
        );
        const replacement = Boolean(existingRecord) && (
          (existingName && existingName !== finalName) ||
          (existingEmail && existingEmail !== finalEmail) ||
          (existingPdfKey ? existingPdfKey !== pdfKey : (existingRecipient && existingRecipient !== finalRecipient))
        );
        const sourceHash = hash_([
          app.applicationKey, gameId, app.name, app.email, app.recipient,
          pw.purchaseTime, pw.year, pw.month, pw.day, pw.tournament, pw.type,
          pw.cash, pw.creditCard, pw.points, pw.usdt, total
        ].join('|'));
        const messages = [];
        let judgement = 'OK';
        let policy = authorityChanged ? '新規発行' : text_(old['処理方針'] || '新規発行');
        let requiresManual = false;

        if (total <= 0) {
          judgement = '対象外';
          policy = '対象外';
          messages.push('総金額が0以下');
        }
        if (seenPayments.has(paymentKey)) {
          judgement = '確認必要';
          policy = text_(old['処理方針'] || '重複として除外');
          requiresManual = true;
          messages.push('同じPW TSV内に同一paymentKeyがあります');
        }
        seenPayments.add(paymentKey);
        if (!validEmail_(finalEmail)) {
          judgement = '確認必要';
          requiresManual = true;
          messages.push('確定メールアドレスが不正');
        }

        if (replacement) {
          judgement = '差替';
          policy = '新規発行';
          messages.push('Game ID CHECKの最新確定値を採用。旧領収書番号を再利用して自動差替');
        } else if (existingPdf) {
          const oldEmail = text_(existingPdf['メールアドレス']).toLowerCase();
          if (oldEmail && oldEmail !== finalEmail) {
            judgement = '確認必要';
            requiresManual = true;
            messages.push('同じPDFの既存送信先とメールアドレスが異なります');
          } else if (text_(existingPdf.status) !== '送信済み') {
            judgement = 'OK';
            policy = '新規発行';
            messages.push('同一PDFの未送信処理を継続: ' + text_(existingPdf.status));
          } else {
            judgement = '重複済み';
            policy = '重複として除外';
            messages.push('同一支払・同一宛名の管理記録あり: ' + text_(existingPdf.status));
          }
        } else if (existingPayment) {
          judgement = '差替';
          policy = '新規発行';
          messages.push('同一支払の宛名変更。旧領収書番号を再利用して自動差替');
        }

        if (text_(old.sourceHash) && text_(old.sourceHash) !== sourceHash && !authorityChanged) {
          judgement = '確認必要';
          requiresManual = true;
          messages.push('前回CHECK後にFormまたはPW元データが変わりました。再確認が必要');
        } else if (authorityChanged) {
          messages.push('領収書CHECK旧値よりGame ID CHECKの確定値を優先');
        }

        const finalHash = receiptFinalHash_({
          sourceHash, finalName, finalEmail, finalRecipient, policy
        });
        const oldStillConfirmed = text_(old.sourceHash) === sourceHash &&
          text_(old.confirmedHash) === finalHash &&
          ['確定済み', '自動確定'].indexOf(text_(old['確認状態'])) >= 0;
        const autoConfirmed = !requiresManual && ['新規発行', '対象外', '重複として除外'].indexOf(policy) >= 0;
        const state = oldStillConfirmed ? text_(old['確認状態']) : (autoConfirmed ? '自動確定' : '未確定');
        const confirmedHash = oldStillConfirmed ? text_(old.confirmedHash) : (autoConfirmed ? finalHash : '');

        output.push(makeReceiptCheckRow_({
          judgement, state, message: messages.join(' / '), checkKey, sourceHash,
          confirmedHash, application: Object.assign({}, app, {
            name: finalName, email: finalEmail, recipient: finalRecipient
          }), pw, paymentKey, pdfKey, total, policy, old,
          existing: replacement ? null : (existingPdf || null),
          receiptNo: replacement
            ? text_(existingRecord && existingRecord['領収書No'])
            : (existingPayment && !existingPdf ? text_(existingPayment['領収書No']) : ''),
          preserveConfirmation: oldStillConfirmed,
          resetDeliveryState: replacement
        }));
      });
    });
    return output;
  }

  function receiptIntersectionStats_(applications, pwResult) {
    const pwByGameId = (pwResult && pwResult.byGameId) || {};
    const applicationList = Object.keys(applications || {}).map(key => applications[key]);
    const applicationGameIds = new Set(applicationList.map(app => app.gameId));
    return {
      formOnlyGameIds: applicationList.filter(app =>
        !(pwByGameId[app.gameId] || []).some(pw => pwMatchesApplicationPeriod_(pw, app))
      ).length,
      pwOnlyGameIds: Object.keys(pwByGameId).filter(gameId => !applicationGameIds.has(gameId)).length,
      invalidPwRows: ((pwResult && pwResult.invalid) || []).length
    };
  }

  function makeReceiptCheckRow_(params) {
    const app = params.application || {};
    const pw = params.pw || {};
    const old = params.old || {};
    const existing = params.existing || {};
    const total = params.total === undefined ? calcTotal_(pw) : params.total;
    const finalName = text_(app.name !== undefined ? app.name : old['本名']);
    const finalEmail = text_(app.email !== undefined ? app.email : old['メールアドレス']).toLowerCase();
    const finalRecipient = removeSama_(app.recipient !== undefined ? app.recipient : old['宛名']);
    const policy = text_(params.policy !== undefined ? params.policy : old['処理方針']);
    const finalHash = receiptFinalHash_({
      sourceHash: params.sourceHash,
      finalName,
      finalEmail,
      finalRecipient,
      policy
    });
    const preserve = Boolean(params.preserveConfirmation) || (
      text_(old.sourceHash) === text_(params.sourceHash) &&
      text_(old.confirmedHash) === finalHash &&
      ['確定済み', '自動確定'].indexOf(text_(old['確認状態'])) >= 0
    );
    const resetDeliveryState = Boolean(params.resetDeliveryState);
    const status = resetDeliveryState ? '' : text_(existing.status || old['ファイル状態']);
    return [
      params.judgement || '確認必要', preserve ? text_(old['確認状態']) : (params.state || '未確定'), params.message || '',
      params.checkKey || '', params.sourceHash || '', preserve ? text_(old.confirmedHash) : (params.confirmedHash || ''),
      app.applicationKey || '', params.paymentKey || '', params.pdfKey || '',
      app.gameId || pw.gameId || '', finalName, finalEmail, finalRecipient,
      app.eventName || '', pw.purchaseTime || '', pw.year || '', pw.month || '', pw.day || '',
      pw.tournament || '', pw.type || '', money_(pw.cash), money_(pw.creditCard),
      money_(pw.points), money_(pw.usdt), total, policy,
      text_(old['修正理由']), false,
      preserve ? old['確認日時'] || '' : '', preserve ? old['確認者'] || '' : '',
      params.receiptNo || existing['領収書No'] || old['領収書No'] || '',
      resetDeliveryState ? '' : (existing.PDF_FILE_ID || old.PDF_FILE_ID || ''),
      resetDeliveryState ? '' : (existing.PDF_URL || old.PDF_URL || ''),
      status,
      resetDeliveryState ? '' : (existing['Draft ID'] || old['Draft ID'] || ''),
      resetDeliveryState
        ? ''
        : (text_(existing.status).includes('下書き') ? existing.status : old['草稿ステータス'] || ''),
      false,
      resetDeliveryState
        ? ''
        : (text_(existing.status) === '送信済み' ? '送信済み' : old['送信ステータス'] || ''),
      resetDeliveryState ? '' : (existing['メール送信日時'] || old['送信日時'] || '')
    ];
  }

  function confirmReceiptCheck() {
    const lock = LockService.getDocumentLock();
    lock.waitLock(30000);
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = requiredSheet_(ss, CONFIG.CHECK_SHEET);
      const settings = readSettings_(ss);
      const rows = readObjects_(sheet).map((row, index) => Object.assign(row, { __rowNo: index + 2 }));
      const errors = [];
      let confirmed = 0;
      const mailGroups = groupCheckRowsForDraft_(
        rows.filter(row => text_(row['処理方針']) === '新規発行')
      );
      Object.keys(mailGroups).forEach(gameId => {
        const info = mailGroupInfo_(mailGroups[gameId]);
        if (!info.leader || !isOn_(info.leader['確認OK'])) return;
        if (info.names.length <= 1 && info.emails.length <= 1) return;
        if (info.rows.some(row => text_(row.PDF_FILE_ID) || text_(row['Draft ID']))) {
          errors.push(info.leader.__rowNo + '行: Game ID資料統一はPDF・草稿作成前だけ実行できます');
          return;
        }
        const finalName = text_(info.leader['本名']);
        const finalEmail = text_(info.leader['メールアドレス']).toLowerCase();
        const reason = text_(info.leader['修正理由']);
        if (!finalName || !validEmail_(finalEmail) || !reason) {
          errors.push(info.leader.__rowNo + '行: K列本名・L列メール・AA列修正理由を入力してください');
          return;
        }
        info.rows.forEach(row => {
          row['本名'] = finalName;
          row['メールアドレス'] = finalEmail;
          row['修正理由'] = reason;
          row['確認OK'] = true;
          setHeaderValue_(sheet, CHECK_HEADERS, row.__rowNo, '本名', finalName);
          setHeaderValue_(sheet, CHECK_HEADERS, row.__rowNo, 'メールアドレス', finalEmail);
          setHeaderValue_(sheet, CHECK_HEADERS, row.__rowNo, '修正理由', reason);
          setHeaderValue_(sheet, CHECK_HEADERS, row.__rowNo, '確認OK', true);
        });
      });
      rows.forEach((row, index) => {
        if (!isOn_(row['確認OK'])) return;
        const rowNo = index + 2;
        const policy = text_(row['処理方針']);
        const allowed = ['新規発行', '対象外', '重複として除外'];
        if (allowed.indexOf(policy) < 0) {
          errors.push(rowNo + '行: 処理方針が不正');
          return;
        }
        if (policy === '新規発行' && (!normalizeGameId_(row['Game ID']) || !validEmail_(row['メールアドレス']))) {
          errors.push(rowNo + '行: 新規発行にはGame IDとメールが必要');
          return;
        }
        if (text_(row['判定']) === '確認必要' && !text_(row['修正理由'])) {
          errors.push(rowNo + '行: 確認必要行は修正理由が必要');
          return;
        }
        const confirmedHash = receiptFinalHash_({
          sourceHash: text_(row.sourceHash), finalName: row['本名'],
          finalEmail: row['メールアドレス'], finalRecipient: row['宛名'], policy
        });
        if ((text_(row.PDF_FILE_ID) || text_(row['Draft ID'])) && text_(row.confirmedHash) !== confirmedHash) {
          errors.push(rowNo + '行: PDFまたは草稿作成後の確定値変更はできません。管理記録を人工確認してください');
          return;
        }
        if (policy === '新規発行') {
          const data = receiptDataFromCheckRow_(row, settings);
          const paymentKey = makePaymentKey_({
            gameId: data.gameId,
            tournament: data.tournament,
            purchaseTime: data.purchaseTime,
            type: data.type,
            total: data.total
          });
          if (paymentKey !== text_(row.paymentKey)) {
            errors.push(rowNo + '行: 支払元データがCHECK生成時から変更されています。領収書CHECKを更新してください');
            return;
          }
          setHeaderValue_(sheet, CHECK_HEADERS, rowNo, 'pdfKey', makePdfKey_(paymentKey, data.recipient));
        }
        setHeaderValue_(sheet, CHECK_HEADERS, rowNo, 'confirmedHash', confirmedHash);
        setHeaderValue_(sheet, CHECK_HEADERS, rowNo, '確認状態', '確定済み');
        setHeaderValue_(sheet, CHECK_HEADERS, rowNo, '確認日時', new Date());
        setHeaderValue_(sheet, CHECK_HEADERS, rowNo, '確認者', activeUserEmail_());
        setHeaderValue_(sheet, CHECK_HEADERS, rowNo, '確認OK', false);
        confirmed++;
      });

      const refreshed = readObjects_(sheet);
      const unresolved = countUnresolvedReceiptRows_(refreshed);
      if (!unresolved) {
        PropertiesService.getDocumentProperties()
          .setProperty('RSE_CONFIRMED_RECEIPT_BATCH_HASH', receiptBatchHash_(refreshed));
      } else {
        PropertiesService.getDocumentProperties().deleteProperty('RSE_CONFIRMED_RECEIPT_BATCH_HASH');
      }
      alert_(
        '領収書CHECK確定処理。\n\n確定: ' + confirmed + '件\n未解決: ' + unresolved + '件' +
        (!unresolved ? '\n本批次CHECKを確定しました。' : '') +
        (errors.length ? '\n\nエラー:\n' + errors.slice(0, 20).join('\n') : '')
      );
    } finally {
      lock.releaseLock();
    }
  }

  function assignReceiptNumbers() {
    const lock = LockService.getDocumentLock();
    lock.waitLock(30000);
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = requiredSheet_(ss, CONFIG.CHECK_SHEET);
      const rows = readObjects_(sheet);
      assertReceiptBatchConfirmed_(ss, sheet, rows);
      const receiptColumn = CHECK_HEADERS.indexOf('領収書No') + 1;
      const receiptValues = rows.map(row => [text_(row['領収書No'])]);
      const targets = [];
      rows.forEach((row, index) => {
        if (text_(row['処理方針']) !== '新規発行') return;
        if (text_(row['領収書No'])) return;
        targets.push(index);
      });
      const reserved = reserveReceiptNumbers_(ss, targets.length);
      targets.forEach((rowIndex, index) => { receiptValues[rowIndex][0] = reserved[index]; });
      if (receiptValues.length) {
        sheet.getRange(2, receiptColumn, receiptValues.length, 1).setValues(receiptValues).setNumberFormat('@');
      }
      alert_('領収書番号の採番が完了しました。\n\n新規採番: ' + targets.length + '件');
    } finally {
      lock.releaseLock();
    }
  }

  function generatePendingFiles() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const settings = readSettings_(ss);
    validateGenerationSettings_(settings);
    const sheet = requiredSheet_(ss, CONFIG.CHECK_SHEET);
    assertReceiptBatchConfirmed_(ss, sheet);
    const html = HtmlService.createHtmlOutputFromFile('ReceiptSemiAutoRenderer')
      .setWidth(560)
      .setHeight(620);
    SpreadsheetApp.getUi().showModelessDialog(html, '領収書PDF ブラウザ生成');
  }

  function getRenderBatch(options) {
    const lock = LockService.getDocumentLock();
    lock.waitLock(30000);
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const settings = readSettings_(ss);
      validateGenerationSettings_(settings);
      const sheet = requiredSheet_(ss, CONFIG.CHECK_SHEET);
      const ledgerSheet = requiredSheet_(ss, CONFIG.LEDGER_SHEET);
      const folder = getFolder_(settings.RECEIPT_FOLDER_URL);
      const ledgerMap = buildLedgerMap_(readObjects_(ledgerSheet));
      const checkState = readSheetUpdateState_(sheet);
      const rows = checkState.objects;
      assertReceiptBatchConfirmed_(ss, sheet, rows);
      const limit = optionalPositiveIntegerSetting_(settings.MAX_RECEIPTS_PER_RUN);
      const fetchBatchSize = boundedIntegerSetting_(settings.PDF_FETCH_BATCH_SIZE, 200, 1, 500);
      const uploadBatchSize = boundedIntegerSetting_(settings.PDF_UPLOAD_BATCH_SIZE, 10, 1, 50);
      const requested = positiveIntegerSetting_(options && options.maxJobs, fetchBatchSize);
      const batchSize = Math.min(requested, fetchBatchSize, limit || fetchBatchSize);
      const pendingBefore = rows.filter(row =>
        text_(row['処理方針']) === '新規発行' && text_(row['領収書No']) && !text_(row.PDF_FILE_ID)
      ).length;
      const jobs = [];
      const ledgerRowsToAppend = [];
      let checkChanged = false;

      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        const rowNo = row.__rowNo;
        if (text_(row['処理方針']) !== '新規発行') continue;
        if (text_(row.PDF_FILE_ID)) continue;
        const receiptNo = text_(row['領収書No']);
        if (!receiptNo) continue;

        const data = receiptDataFromCheckRow_(row, settings);
        data.receiptNo = receiptNo;
        const paymentKey = makePaymentKey_({
          gameId: data.gameId, tournament: data.tournament,
          purchaseTime: data.purchaseTime, type: data.type, total: data.total
        });
        const pdfKey = makePdfKey_(paymentKey, data.recipient);
        if (paymentKey !== text_(row.paymentKey) || pdfKey !== text_(row.pdfKey)) {
          throw new Error(rowNo + '行: CHECK確定後にpaymentKey/pdfKeyが変化しています');
        }

        const replacement = text_(row['判定']) === '差替';
        const existing = ledgerMap.byPdfKey[pdfKey];
        if (!replacement && existing && text_(existing.PDF_FILE_ID)) {
          const file = DriveApp.getFileById(text_(existing.PDF_FILE_ID));
          applyRenderedFileToCheckState_(checkState, row, file, pdfKey);
          checkChanged = true;
          continue;
        }

        const fileName = makeReceiptFileName_(data, settings);
        const namedFile = replacement ? null : findSingleFileByName_(folder, fileName);
        if (namedFile) {
          applyRenderedFileToCheckState_(checkState, row, namedFile, pdfKey);
          ledgerRowsToAppend.push(makeLedgerRowArray_({
            pdfKey, paymentKey, receiptNo, data, file: namedFile,
            status: 'PDF作成済み', applicationKey: text_(row['申請キー']), note: '既存ファイル再登録'
          }));
          ledgerMap.byPdfKey[pdfKey] = { PDF_FILE_ID: namedFile.getId() };
          checkChanged = true;
          continue;
        }

        setUpdateStateValue_(checkState, row, 'ファイル状態', 'ブラウザ生成待ち');
        checkChanged = true;
        jobs.push({
          rowNo,
          pdfKey,
          paymentKey,
          receiptNo,
          fileName,
          html: buildReceiptHtml_(data, settings)
        });
        if (jobs.length >= batchSize) break;
      }

      if (checkChanged) writeSheetUpdateState_(sheet, checkState);
      if (ledgerRowsToAppend.length) appendLedgerRows_(ledgerSheet, ledgerRowsToAppend);
      return {
        done: jobs.length === 0,
        pending: pendingBefore,
        limit,
        fetchBatchSize,
        uploadBatchSize,
        jobs
      };
    } finally {
      lock.releaseLock();
    }
  }

  function saveRenderedPdfBatch(payload) {
    const lock = LockService.getDocumentLock();
    lock.waitLock(30000);
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const settings = readSettings_(ss);
      validateGenerationSettings_(settings);
      const sheet = requiredSheet_(ss, CONFIG.CHECK_SHEET);
      const ledgerSheet = requiredSheet_(ss, CONFIG.LEDGER_SHEET);
      const items = Array.isArray(payload && payload.items) ? payload.items : [];
      const uploadBatchSize = boundedIntegerSetting_(settings.PDF_UPLOAD_BATCH_SIZE, 10, 1, 50);
      if (!items.length || items.length > uploadBatchSize) {
        throw new Error('PDF保存バッチは1～' + uploadBatchSize + '件で指定してください');
      }
      const checkState = readSheetUpdateState_(sheet);
      assertReceiptBatchConfirmed_(ss, sheet, checkState.objects);
      const ledgerMap = buildLedgerMap_(readObjects_(ledgerSheet));
      const folder = getFolder_(settings.RECEIPT_FOLDER_URL);
      const ledgerRowsToAppend = [];
      const results = [];
      const replacementsToArchive = [];

      items.forEach(item => {
        const rowNo = Math.floor(Number(item && item.rowNo));
        const row = checkState.objects[rowNo - 2];
        try {
          if (!row || row.__rowNo !== rowNo) throw new Error('対象CHECK行が見つかりません');
          if (text_(row.PDF_FILE_ID)) {
            results.push({ rowNo, ok: true, reused: true });
            return;
          }
          const data = receiptDataFromCheckRow_(row, settings);
          data.receiptNo = text_(row['領収書No']);
          const paymentKey = makePaymentKey_({
            gameId: data.gameId, tournament: data.tournament,
            purchaseTime: data.purchaseTime, type: data.type, total: data.total
          });
          const pdfKey = makePdfKey_(paymentKey, data.recipient);
          if (pdfKey !== text_(item.pdfKey) || pdfKey !== text_(row.pdfKey)) {
            throw new Error('pdfKeyが一致しません。CHECKを更新してください');
          }

          const replacement = text_(row['判定']) === '差替';
          const existing = ledgerMap.byPdfKey[pdfKey];
          if (!replacement && existing && text_(existing.PDF_FILE_ID)) {
            const existingFile = DriveApp.getFileById(text_(existing.PDF_FILE_ID));
            applyRenderedFileToCheckState_(checkState, row, existingFile, pdfKey);
            results.push({ rowNo, ok: true, reused: true });
            return;
          }

          const base64 = String(item.base64 || '').replace(/^data:application\/pdf;base64,/, '');
          if (!base64) throw new Error('PDFデータが空です');
          const fileName = makeReceiptFileName_(data, settings);
          const file = folder.createFile(
            Utilities.newBlob(Utilities.base64Decode(base64), MimeType.PDF, fileName)
          ).setName(fileName);
          applyRenderedFileToCheckState_(checkState, row, file, pdfKey);
          ledgerRowsToAppend.push(makeLedgerRowArray_({
            pdfKey, paymentKey, receiptNo: data.receiptNo, data, file,
            status: 'PDF作成済み', applicationKey: text_(row['申請キー']), note: 'ブラウザ一括生成'
          }));
          ledgerMap.byPdfKey[pdfKey] = { PDF_FILE_ID: file.getId() };
          if (replacement) {
            replacementsToArchive.push({
              paymentKey,
              activeFileId: file.getId(),
              oldRows: ledgerMap.byPaymentKeyRows[paymentKey] || []
            });
          }
          results.push({ rowNo, ok: true, fileId: file.getId(), fileUrl: file.getUrl(), fileName });
        } catch (error) {
          if (row) {
            setUpdateStateValue_(checkState, row, 'ファイル状態', '生成エラー');
            setUpdateStateValue_(checkState, row, '確認内容', error.message || String(error));
          }
          results.push({ rowNo, ok: false, error: error.message || String(error) });
        }
      });

      writeSheetUpdateState_(sheet, checkState);
      if (ledgerRowsToAppend.length) appendLedgerRows_(ledgerSheet, ledgerRowsToAppend);
      replacementsToArchive.forEach(item => {
        trashSupersededDriveFiles_(item.oldRows, item.activeFileId);
      });
      deleteSupersededGmailDrafts_(
        replacementsToArchive.reduce((rows, item) => rows.concat(item.oldRows || []), [])
      );
      return {
        ok: results.every(result => result.ok),
        saved: results.filter(result => result.ok).length,
        errors: results.filter(result => !result.ok).length,
        results
      };
    } finally {
      lock.releaseLock();
    }
  }

  function applyRenderedFileToCheckState_(state, row, file, pdfKey) {
    setUpdateStateValue_(state, row, 'pdfKey', pdfKey);
    setUpdateStateValue_(state, row, 'PDF_FILE_ID', file.getId());
    setUpdateStateValue_(state, row, 'PDF_URL', file.getUrl());
    setUpdateStateValue_(state, row, 'ファイル状態', 'PDF作成済み');
    setUpdateStateValue_(state, row, '確認内容', '');
  }

  function createPendingDrafts() {
    const lock = LockService.getDocumentLock();
    lock.waitLock(30000);
    try {
      const startedAt = Date.now();
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const settings = readSettings_(ss);
      validateGenerationSettings_(settings);
      const sheet = requiredSheet_(ss, CONFIG.CHECK_SHEET);
      const ledgerSheet = requiredSheet_(ss, CONFIG.LEDGER_SHEET);
      const checkState = readSheetUpdateState_(sheet);
      assertReceiptBatchConfirmed_(ss, sheet, checkState.objects);
      const rows = checkState.objects.filter(row => text_(row['処理方針']) === '新規発行');
      const groups = groupCheckRowsForDraft_(rows);
      const ledgerState = readLedgerUpdateState_(ledgerSheet);
      const maxDrafts = positiveIntegerSetting_(settings.MAX_DRAFTS_PER_SEND, 20);
      const maxSeconds = positiveIntegerSetting_(settings.MAX_EXECUTION_SECONDS, 240);
      let created = 0;
      let incomplete = 0;
      let errors = 0;
      let stoppedByTime = false;
      let draftRecoveryMap = null;
      let ledgerChanged = false;
      const plans = [];

      for (const groupKey of Object.keys(groups)) {
        const group = groups[groupKey];
        const info = normalizeMailGroupDisplay_(checkState, group);
        const leader = info.leader;
        if (!leader) continue;
        if (text_(leader['送信ステータス']) === '送信済み') continue;
        if (info.draftIds.length > 1) {
          errors++;
          continue;
        }
        if (group.some(row => !text_(row.PDF_FILE_ID))) {
          setUpdateStateValue_(checkState, leader, '草稿ステータス', 'PDF未完成');
          setUpdateStateValue_(checkState, leader, '確認内容', 'このGame IDには未生成PDFがあります。先にメニュー7を完了してください。');
          incomplete++;
          continue;
        }
        if (info.emails.length !== 1 || !validEmail_(info.emails[0]) || info.names.length !== 1) {
          setUpdateStateValue_(checkState, leader, '草稿ステータス', '人工確認必要');
          setUpdateStateValue_(
            checkState,
            leader,
            '確認内容',
            '同一Game ID内の本名またはメールが一致しません。K列・L列を正しい値へ統一し、AA列に理由、AB列を確認後、メニュー5を実行してください。'
          );
          errors++;
          continue;
        }
        if (info.draftIds.length === 1 && text_(leader['草稿ステータス']) === '下書き作成済み') continue;
        if (plans.length >= maxDrafts) break;
        setUpdateStateValue_(checkState, leader, '草稿ステータス', '草稿作成中');
        setUpdateStateValue_(checkState, leader, '確認内容', '');
        plans.push({ groupKey, group, leader, existingDraftId: info.draftIds[0] || '' });
      }

      writeSheetUpdateState_(sheet, checkState);
      SpreadsheetApp.flush();

      for (const plan of plans) {
        if ((Date.now() - startedAt) / 1000 >= maxSeconds) {
          stoppedByTime = true;
          break;
        }
        const group = plan.group;
        const leader = plan.leader;
        try {
          const items = group.map(row => {
            const data = receiptDataFromCheckRow_(row, settings);
            data.receiptNo = text_(row['領収書No']);
            return {
              rowNo: row.__rowNo, pdfKey: text_(row.pdfKey), paymentKey: text_(row.paymentKey),
              receiptNo: data.receiptNo, file: DriveApp.getFileById(text_(row.PDF_FILE_ID)), data
            };
          });
          const draftKey = makeDraftKey_(items);
          let draft = plan.existingDraftId ? GmailApp.getDraft(plan.existingDraftId) : null;
          if (!draft) {
            if (!draftRecoveryMap) draftRecoveryMap = buildDraftRecoveryMap_();
            draft = draftRecoveryMap[draftKey] || null;
          }
          if (!draft) draft = createDraftForPreparedItems_(items, settings, draftKey);
          const draftId = draft.getId();
          if (draftRecoveryMap) draftRecoveryMap[draftKey] = draft;
          const draftTo = text_(items[0].data.email).toLowerCase();
          setUpdateStateValue_(checkState, leader, 'Draft ID', draftId);
          setUpdateStateValue_(checkState, leader, '草稿ステータス', '下書き作成済み');
          setUpdateStateValue_(checkState, leader, '確認内容', '');
          group.slice(1).forEach(row => {
            ['Draft ID', '草稿ステータス', '送信OK', '送信ステータス', '送信日時']
              .forEach(header => setUpdateStateValue_(checkState, row, header, ''));
          });
          mutateLedgerFieldsForPdfKeys_(ledgerState, items.map(item => item.pdfKey), {
            'Draft ID': draftId,
            '草稿作成日時': new Date(),
            '送信先': draftTo,
            status: '下書き作成済み'
          });
          ledgerChanged = true;
          created++;
        } catch (error) {
          errors++;
          const message = error.message || String(error);
          setUpdateStateValue_(checkState, leader, '草稿ステータス', 'エラー');
          setUpdateStateValue_(
            checkState,
            leader,
            '確認内容',
            '原因を修正してメニュー8を再実行してください。既存Draft IDが有効なら再利用し、同じGame IDの草稿を重複作成しません。\nエラー: ' + message
          );
        }
      }

      writeSheetUpdateState_(sheet, checkState);
      if (ledgerChanged) writeLedgerUpdateState_(ledgerSheet, ledgerState);
      formatMailGroupControls_(sheet, groups);
      const pending = Object.keys(groups).filter(gameId => {
        const info = mailGroupInfo_(groups[gameId]);
        return info.leader && text_(info.leader['送信ステータス']) !== '送信済み' && !text_(info.leader['Draft ID']);
      }).length;
      alert_(
        'Game ID単位のGmail草稿処理が完了しました。\n\n作成・復旧: ' + created + '通\nPDF未完成Game ID: ' + incomplete +
        '\n人工確認・エラー: ' + errors + '\n草稿未作成Game ID: ' + pending +
        (stoppedByTime ? '\n自主停止時間に達したため、再度同じボタンを実行してください。' : '')
      );
    } finally {
      lock.releaseLock();
    }
  }


  function sendApproved() {
    const lock = LockService.getDocumentLock();
    lock.waitLock(30000);

    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      assertInitialized_(ss);
      const checkSheet = requiredSheet_(ss, CONFIG.CHECK_SHEET);
      const ledgerSheet = requiredSheet_(ss, CONFIG.LEDGER_SHEET);
      const checkState = readSheetUpdateState_(checkSheet);
      assertReceiptBatchConfirmed_(ss, checkSheet, checkState.objects);
      const rows = checkState.objects;
      const groups = groupCheckRowsForDraft_(
        rows.filter(row => text_(row['処理方針']) === '新規発行')
      );
      const approvedGroups = [];

      Object.keys(groups).forEach(gameId => {
        const info = normalizeMailGroupDisplay_(checkState, groups[gameId]);
        if (!info.leader || text_(info.leader['送信ステータス']) === '送信済み') return;
        if (info.draftIds.length !== 1 || !isOn_(info.leader['送信OK'])) return;
        approvedGroups.push(info);
      });

      if (!approvedGroups.length) {
        writeSheetUpdateState_(checkSheet, checkState);
        const completedApplications = syncFormProcessedFromCheck_(ss, checkSheet, rows);
        if (completedApplications) {
          alert_(
            '新規送信対象はありませんでした。\n\n' +
            '既存の送信済み記録からForm回答を完了へ更新: ' + completedApplications + '件'
          );
          return;
        }
        throw new Error('全添付行で送信OKになっているGmail草稿がありません。');
      }

      const settings = readSettings_(ss);
      const maxDrafts = positiveIntegerSetting_(settings.MAX_DRAFTS_PER_SEND, 20);
      if (approvedGroups.length > maxDrafts) {
        throw new Error(
          '承認済み草稿が1回の送信上限を超えています。\n' +
          '承認済み: ' + approvedGroups.length + '通 / 上限: ' + maxDrafts + '通'
        );
      }

      let sentDrafts = 0;
      let sentReceipts = 0;
      let errors = 0;
      const ledgerState = readLedgerUpdateState_(ledgerSheet);
      let ledgerChanged = false;

      approvedGroups.forEach(info => {
        const pdfKeys = info.rows.map(row => text_(row.pdfKey));
        setUpdateStateValue_(checkState, info.leader, '送信ステータス', '送信処理中');
        setUpdateStateValue_(checkState, info.leader, '確認内容', '');
        mutateLedgerFieldsForPdfKeys_(ledgerState, pdfKeys, {
          status: '送信処理中',
          '備考': 'Gmail送信開始'
        });
        ledgerChanged = true;
      });
      writeSheetUpdateState_(checkSheet, checkState);
      if (ledgerChanged) writeLedgerUpdateState_(ledgerSheet, ledgerState);
      SpreadsheetApp.flush();

      approvedGroups.forEach(info => {
        const group = info.rows;
        const leader = info.leader;
        const draftId = info.draftIds[0];
        const pdfKeys = group.map(row => text_(row.pdfKey));
        try {
          const draft = GmailApp.getDraft(draftId);
          if (!draft) throw new Error('Gmail下書きが見つかりません: ' + draftId);
          draft.send();
          const sentAt = new Date();
          sentDrafts++;
          sentReceipts += group.length;

          setUpdateStateValue_(checkState, leader, '草稿ステータス', '送信済み');
          setUpdateStateValue_(checkState, leader, '送信ステータス', '送信済み');
          setUpdateStateValue_(checkState, leader, '送信日時', sentAt);
          setUpdateStateValue_(checkState, leader, '確認内容', '');
          mutateLedgerFieldsForPdfKeys_(ledgerState, pdfKeys, {
            status: '送信済み',
            'メール送信日時': sentAt
          });

          group.forEach(row => {
            markReplacedLedgerState_(
              ledgerState,
              text_(row.paymentKey),
              text_(row.pdfKey),
              text_(row.PDF_FILE_ID)
            );
          });
        } catch (error) {
          errors++;
          const message = error.message || String(error);
          setUpdateStateValue_(checkState, leader, '送信ステータス', '送信確認必要');
          setUpdateStateValue_(
            checkState,
            leader,
            '確認内容',
            'Gmailの送信済みを先に確認してください。\n' +
            '送信済みなら組長行のAL列を「送信済み」、AM列を送信日時にしてメニュー9を再実行します。\n' +
            '未送信で草稿が残っていれば、そのままメニュー9を再実行します。\n' +
            '草稿も無ければ組長行のAI～AK列を空にしてメニュー8から作り直します。\n' +
            'エラー: ' + message
          );
          mutateLedgerFieldsForPdfKeys_(ledgerState, pdfKeys, {
            status: '送信確認必要',
            '備考': message
          });
        }
      });

      writeSheetUpdateState_(checkSheet, checkState);
      writeLedgerUpdateState_(ledgerSheet, ledgerState);
      const completedApplications = syncFormProcessedFromCheck_(ss, checkSheet, rows);
      alert_(
        '承認済み草稿の送信処理が完了しました。\n\n' +
        '送信メール: ' + sentDrafts + '\n' +
        '領収書: ' + sentReceipts + '\n' +
        '処理終了Form回答: ' + completedApplications + '\n' +
        'エラー: ' + errors
      );
    } finally {
      lock.releaseLock();
    }
  }


  function readApplications_(sheet, settings) {
    const table = readTable_(sheet);
    const indexes = aliasIndexes_(table.headers, FORM_ALIASES, ['gameId', 'name', 'email', 'startDate', 'endDate']);
    const groups = {};
    const invalid = [];

    table.rows.forEach((row, index) => {
      const rowNo = index + 2;
      if (indexes.processed >= 0 && formStatusDone_(valueAt_(row, indexes.processed))) return;
      const rawEventName = valueAt_(row, indexes.eventName);

      const app = {
        rowNo,
        timestamp: valueAt_(row, indexes.timestamp),
        gameId: normalizeGameId_(valueAt_(row, indexes.gameId)),
        name: text_(valueAt_(row, indexes.name)),
        email: text_(valueAt_(row, indexes.email)).toLowerCase(),
        recipient: removeSama_(valueAt_(row, indexes.recipient)),
        eventName: text_(rawEventName),
        startDate: normalizeIsoDate_(valueAt_(row, indexes.startDate)),
        endDate: normalizeIsoDate_(valueAt_(row, indexes.endDate))
      };
      app.applicationKey = makeApplicationKey_(app);

      const errors = [];
      if (!app.gameId) errors.push('Game IDが不正または空白');
      if (!app.name) errors.push('本名が空白');
      if (!validEmail_(app.email)) errors.push('メールアドレスが不正');
      if (!app.startDate) errors.push('対象期間（開始日）が不正または空白');
      if (!app.endDate) errors.push('対象期間（終了日）が不正または空白');
      if (app.startDate && app.endDate && app.startDate > app.endDate) errors.push('対象期間の開始日が終了日より後です');
      if (errors.length) {
        invalid.push({ application: app, message: 'Form ' + rowNo + '行: ' + errors.join(' / ') });
        return;
      }

      if (!groups[app.applicationKey]) groups[app.applicationKey] = [];
      groups[app.applicationKey].push(app);
    });

    const byRequestKey = {};
    Object.keys(groups).forEach(applicationKey => {
      const applications = groups[applicationKey]
        .slice()
        .sort((left, right) => Number(left.rowNo || 0) - Number(right.rowNo || 0));
      const profiles = uniqueStrings_(applications.map(app => {
        return [compact_(app.name), app.email.toLowerCase(), compact_(app.recipient)].join('|');
      }));
      const latest = applications[applications.length - 1];
      const conflict = profiles.length > 1;

      byRequestKey[applicationKey] = {
        application: latest,
        applications,
        conflict,
        duplicateExactCount: applications.length,
        message: conflict
          ? '同一Game ID・同一対象期間に本名・メール・宛名が異なるForm回答があります。対象回答を1件に整理してください'
          : ''
      };
    });

    return { byRequestKey, invalid };
  }

  function readPwRows_(sheet, settings) {
    const table = readTable_(sheet);
    const indexes = aliasIndexes_(table.headers, PW_ALIASES, [
      'gameId', 'purchaseTime', 'year', 'month', 'day', 'tournament',
      'cash', 'creditCard', 'points', 'usdt'
    ]);
    const byGameId = {};
    const invalid = [];

    table.rows.forEach((row, index) => {
      const rowNo = index + 2;
      const pw = {
        rowNo,
        gameId: normalizeGameId_(valueAt_(row, indexes.gameId)),
        purchaseTime: text_(valueAt_(row, indexes.purchaseTime)),
        year: text_(valueAt_(row, indexes.year)),
        month: text_(valueAt_(row, indexes.month)),
        day: text_(valueAt_(row, indexes.day)),
        tournament: text_(valueAt_(row, indexes.tournament)),
        type: text_(valueAt_(row, indexes.type)),
        cash: money_(valueAt_(row, indexes.cash)),
        creditCard: money_(valueAt_(row, indexes.creditCard)),
        points: money_(valueAt_(row, indexes.points)),
        usdt: money_(valueAt_(row, indexes.usdt))
      };

      const errors = [];
      if (!pw.gameId) errors.push('Game IDが不正または空白');
      if (!pw.tournament) errors.push('大会名が空白');
      if (!pw.year || !pw.month || !pw.day) errors.push('領収日が不足');
      if (errors.length) {
        invalid.push({ pw, message: 'PW TSV ' + rowNo + '行: ' + errors.join(' / ') });
        return;
      }

      if (!byGameId[pw.gameId]) byGameId[pw.gameId] = [];
      byGameId[pw.gameId].push(pw);
    });

    return { byGameId, invalid };
  }


  function createDraftForPreparedItems_(items, settings, draftKey) {
    const first = items[0].data;
    const to = first.email;
    if (!validEmail_(to)) throw new Error('下書き宛先メールアドレスが不正です: ' + to);

    const subject = text_(settings.SUBJECT || '電子領収書の送付について');
    const body = buildMailBody_(
      first.name,
      eventLabelForItems_(items),
      items.length
    );
    const attachments = items.map(item => item.file.getBlob().setName(item.file.getName()));
    const totalAttachmentBytes = attachments.reduce((sum, blob) => sum + blob.getBytes().length, 0);
    const maxAttachmentMb = positiveNumberSetting_(settings.MAX_ATTACHMENT_MB, 20);
    if (totalAttachmentBytes > maxAttachmentMb * 1024 * 1024) {
      throw new Error(
        '添付合計サイズが設定上限を超えています: ' +
        (totalAttachmentBytes / 1024 / 1024).toFixed(1) + 'MB / ' + maxAttachmentMb + 'MB'
      );
    }

    const options = {
      name: text_(settings.FROM_NAME || 'Japan Open Poker Tour / JOPT'),
      attachments,
      htmlBody: '<div style="white-space:pre-wrap">' + escapeHtml_(body).replace(/\n/g, '<br>') +
        '</div><span style="display:none">RSE-DRAFT-KEY:' + escapeHtml_(draftKey) + '</span>'
    };

    const fromAlias = text_(settings.FROM_ALIAS);
    const bcc = text_(settings.BCC);
    if (fromAlias) options.from = fromAlias;
    if (bcc) options.bcc = bcc;

    return GmailApp.createDraft(to, subject, body, options);
  }

  function makeDraftKey_(items) {
    return hash_(items.map(item => text_(item.pdfKey)).sort().join('\n'));
  }

  function buildDraftRecoveryMap_() {
    const map = {};
    GmailApp.getDrafts().forEach(draft => {
      const body = draft.getMessage().getBody();
      const match = String(body || '').match(/RSE-DRAFT-KEY:([A-Za-z0-9-]+)/);
      if (match && !map[match[1]]) map[match[1]] = draft;
    });
    return map;
  }

  function receiptDataFromCheckRow_(row, settings) {
    const total = money_(row['総金額']);
    const tax = Math.floor(total / 11);
    return {
      gameId: normalizeGameId_(row['Game ID']),
      name: text_(row['本名']),
      email: text_(row['メールアドレス']).toLowerCase(),
      recipient: removeSama_(row['宛名']),
      eventName: text_(row.eventName || eventLabelFromTournament_(row['大会名'])),
      purchaseTime: text_(row['購入時間']),
      year: text_(row['年']),
      month: text_(row['月']),
      day: text_(row['日']),
      tournament: text_(row['大会名']),
      type: text_(row['種別']),
      cash: money_(row['現金']),
      creditCard: money_(row['クレジットカード']),
      points: money_(row['ポイント']),
      usdt: money_(row.USDT),
      total,
      tax,
      taxExcluded: total - tax,
      receiptNo: ''
    };
  }

  function buildMailBody_(name, eventName, count) {
    const addressee = text_(name) ? text_(name) + ' 様' : 'お客様';
    const eventLabel = formatEventLabel_(eventName);
    return `${addressee}

平素よりお世話になっております。
ジャパンオープンポーカーツアー株式会社カスタマーサポートのショウです。

この度は${eventLabel}にご参加いただき、誠にありがとうございました。

電子領収書を${count}件発行いたしましたので、添付にてお送りいたします。
なお、電子チケットおよび選手契約履行によるエントリーにつきましては、領収書の発行対象外となっております。

ご不明点やご質問などがございましたら、本メールへのご返信にてお気軽にお問い合わせください。
今後ともどうぞよろしくお願いいたします。`;
  }

  function buildReceiptHtml_(data, settings) {
    const recipient = removeSama_(data.recipient);
    const recipientHtml = recipient
      ? `<span class="recipient-name">${escapeHtml_(recipient)}</span><span class="recipient-sama">様</span>`
      : '';
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
 @page{size:A4 landscape;margin:0}html,body{margin:0;padding:0;width:297mm;height:210mm;font-family:${CONFIG.FONT_FAMILY};color:#231815;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
 .page{position:relative;width:297mm;height:210mm;overflow:hidden;background:#fff}.headerSvg{position:absolute;left:0;top:0;width:297mm;height:31mm}
.tournament{position:absolute;left:7mm;top:52mm;width:165mm;font-size:4.4mm;line-height:1.35}.right{position:absolute;left:198mm;top:50mm;width:88mm;font-size:5.2mm;font-weight:700}
.right .row{display:flex;justify-content:space-between;margin-bottom:4mm}.right .value{font-size:6.2mm}.recipient{position:absolute;top:78mm;left:67mm;width:166mm;text-align:center;font-weight:700;white-space:nowrap;height:17mm}
.recipient-name{display:inline-block;font-size:10.5mm;width:122mm}.recipient-sama{display:inline-block;font-size:13.5mm;margin-left:10mm}.line1,.line2{position:absolute;left:67mm;width:166mm;height:.25mm;background:#231815}.line1{top:96mm}.line2{top:126mm}
.amount{position:absolute;top:108mm;left:67mm;width:166mm;text-align:center;font-size:13mm;font-weight:700;letter-spacing:1mm}.note{position:absolute;top:138mm;left:62mm;width:175mm;text-align:center;font-size:5.4mm;letter-spacing:.45mm}
.breakdown{position:absolute;left:7mm;top:148mm;width:113mm;font-size:5.1mm}.breakdown-title{font-size:5.7mm;margin-bottom:2mm}.b-line{border-top:.25mm solid #231815;height:8mm;display:flex;align-items:center}.b-label{width:68mm;padding-left:2mm}.b-value{width:40mm}
.tax{border-top:.25mm solid #231815;border-bottom:.25mm solid #231815;display:grid;grid-template-columns:21mm 49mm 40mm;height:21mm}.tax-rate{border-right:.25mm solid #231815;display:flex;flex-direction:column;justify-content:center;padding-left:3mm}.tax-col{display:flex;flex-direction:column}.tax-cell{height:10.5mm;display:flex;align-items:center;padding-left:4mm;border-bottom:.25mm solid #231815}.tax-cell:last-child{border-bottom:0}
.company{position:absolute;left:151mm;top:166mm;width:135mm;text-align:center;font-size:5.4mm;line-height:1.55}.company-name{font-size:6mm;margin-top:4mm;font-weight:700}.reg{font-size:5.1mm}
</style></head><body><div class="page">
 <svg class="headerSvg" viewBox="0 0 2970 310" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="2970" height="310" fill="#2f4d9c"/><text x="1485" y="205" text-anchor="middle" font-family="BIZ UDGothic, BIZ UDPGothic, sans-serif" font-size="145" font-weight="700" letter-spacing="26" fill="#ffffff">領収書</text></svg>
<div class="tournament">${escapeHtml_(data.tournament)}</div>
<div class="right"><div class="row"><span>No.</span><span class="value">${escapeHtml_(data.receiptNo)}</span></div><div class="row"><span>領収日</span><span class="value">${escapeHtml_(data.year)}年 ${escapeHtml_(data.month)}月 ${escapeHtml_(data.day)}日</span></div></div>
<div class="recipient">${recipientHtml}</div><div class="line1"></div>
<div class="amount">${escapeHtml_(formatYen_(data.total))}</div><div class="line2"></div>
<div class="note">但　施設利用料として　上記正に領収しました</div>
<div class="breakdown"><div class="breakdown-title">内訳</div>
<div class="b-line"><div class="b-label">現金</div><div class="b-value">${escapeHtml_(formatYen_(data.cash))}</div></div>
<div class="b-line"><div class="b-label">クレジットカード</div><div class="b-value">${escapeHtml_(formatYen_(data.creditCard))}</div></div>
<div class="b-line"><div class="b-label">ポイント</div><div class="b-value">${escapeHtml_(formatYen_(data.points))}</div></div>
<div class="tax"><div class="tax-rate"><div>税率</div><div>10%</div></div><div class="tax-col"><div class="tax-cell">金額（税抜き）</div><div class="tax-cell">消費税額等</div></div><div class="tax-col"><div class="tax-cell">${escapeHtml_(formatYen_(data.taxExcluded))}</div><div class="tax-cell">${escapeHtml_(formatYen_(data.tax))}</div></div></div>
</div>
<div class="company"><div>${CONFIG.COMPANY_ADDRESS}</div><div class="company-name">${CONFIG.COMPANY_NAME}</div><div class="reg">${CONFIG.REGISTRATION_NO}</div></div>
</div></body></html>`;
  }

  function makeReceiptFileName_(data, settings) {
    const label = formatEventLabel_(eventLabelFromTournament_(data.tournament) || data.eventName);
    const name = data.name ? data.name + ' 様' : 'お客様';
    return sanitizeFileName_(label + ' 領収書_' + name + '-' + data.receiptNo + '.pdf');
  }

  function appendLedger_(sheet, item) {
    appendLedgerRows_(sheet, [makeLedgerRowArray_(item)]);
  }

  function makeLedgerRowArray_(item) {
    const d = item.data;
    return [
      item.pdfKey, item.paymentKey, item.receiptNo, d.gameId, d.name, d.email,
      d.recipient, d.eventName, d.tournament, d.purchaseTime, d.type, d.total,
      item.file.getId(), item.file.getUrl(), '', '', '', '', item.status,
      item.applicationKey, item.note || ''
    ];
  }

  function appendLedgerRows_(sheet, rows) {
    if (!rows || !rows.length) return;
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, LEDGER_HEADERS.length).setValues(rows);
  }


  function buildLedgerMap_(rows) {
    const byPdfKey = {};
    const byPaymentKey = {};
    const byPaymentKeyRows = {};

    rows.forEach(row => {
      const status = text_(row.status);
      if (CONFIG.INACTIVE_LEDGER_STATUSES.indexOf(status) >= 0) return;
      const pdfKey = text_(row.pdfKey);
      const paymentKey = text_(row.paymentKey);
      if (pdfKey) byPdfKey[pdfKey] = row;
      if (paymentKey) {
        // 管理表は追記式なので、最後の有効行を現在値として扱う。
        byPaymentKey[paymentKey] = row;
        if (!byPaymentKeyRows[paymentKey]) byPaymentKeyRows[paymentKey] = [];
        byPaymentKeyRows[paymentKey].push(row);
      }
    });

    return { byPdfKey, byPaymentKey, byPaymentKeyRows };
  }

  function trashSupersededDriveFiles_(ledgerRows, activeFileId) {
    const fileIds = uniqueStrings_((ledgerRows || [])
      .map(row => text_(row.PDF_FILE_ID))
      .filter(fileId => fileId && fileId !== text_(activeFileId)));
    fileIds.forEach(fileId => {
      try {
        const file = DriveApp.getFileById(fileId);
        if (!file.isTrashed()) file.setTrashed(true);
      } catch (error) {
        Logger.log('旧差替PDFをゴミ箱へ移動できませんでした: ' + fileId + ' / ' + (error.message || error));
      }
    });
    return fileIds;
  }

  function deleteSupersededGmailDrafts_(ledgerRows) {
    const draftIds = uniqueStrings_((ledgerRows || [])
      .map(row => text_(row['Draft ID']))
      .filter(Boolean));
    draftIds.forEach(draftId => {
      try {
        const draft = GmailApp.getDraft(draftId);
        if (draft) draft.deleteDraft();
      } catch (error) {
        // 送信済みDraft IDは取得できないため正常系として無視する。
        Logger.log('旧差替Draftは削除済みまたは取得不能です: ' + draftId);
      }
    });
    return draftIds;
  }

  function readLedgerUpdateState_(sheet) {
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(text_);
    const columns = {};
    headers.forEach((header, index) => { columns[header] = index; });
    const byPdfKey = {};
    const byPaymentKey = {};

    for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
      const rowNo = rowIndex + 1;
      const pdfKey = text_(values[rowIndex][columns.pdfKey]);
      const paymentKey = text_(values[rowIndex][columns.paymentKey]);
      if (pdfKey) byPdfKey[pdfKey] = rowNo;
      if (paymentKey) {
        if (!byPaymentKey[paymentKey]) byPaymentKey[paymentKey] = [];
        byPaymentKey[paymentKey].push(rowNo);
      }
    }
    return { values, headers, columns, byPdfKey, byPaymentKey };
  }

  function mutateLedgerFieldsForPdfKeys_(state, pdfKeys, fields) {
    const rowNos = uniqueStrings_((pdfKeys || []).map(pdfKey => state.byPdfKey[text_(pdfKey)]));
    rowNos.forEach(rowNo => {
      Object.keys(fields).forEach(header => {
        const column = state.columns[header];
        if (column === undefined) throw new Error('管理表列が見つかりません: ' + header);
        state.values[rowNo - 1][column] = fields[header];
      });
    });
    return rowNos;
  }

  function writeLedgerUpdateState_(sheet, state) {
    if (state.values.length < 2) return;
    sheet.getRange(2, 1, state.values.length - 1, state.headers.length)
      .setValues(state.values.slice(1));
  }

  function markReplacedLedgerState_(state, paymentKey, activePdfKey, activeFileId) {
    if (!paymentKey || !activePdfKey) return [];
    const changedRowNos = [];
    const paymentCol = state.columns.paymentKey;
    const pdfCol = state.columns.pdfKey;
    const fileCol = state.columns.PDF_FILE_ID;
    const statusCol = state.columns.status;
    const noteCol = state.columns['備考'];
    (state.byPaymentKey[paymentKey] || []).forEach(rowNo => {
      const row = state.values[rowNo - 1];
      if (text_(row[paymentCol]) !== paymentKey) return;
      const samePdfKey = text_(row[pdfCol]) === activePdfKey;
      const sameFile = !text_(activeFileId) || text_(row[fileCol]) === text_(activeFileId);
      if (samePdfKey && sameFile) return;
      if (CONFIG.INACTIVE_LEDGER_STATUSES.indexOf(text_(row[statusCol])) >= 0) return;
      row[statusCol] = '差替済み';
      row[noteCol] = '差替先: ' + activePdfKey;
      changedRowNos.push(rowNo);
    });
    return changedRowNos;
  }

  function ensureFormProcessedColumn_(sheet) {
    const lastColumn = Math.max(sheet.getLastColumn(), 1);
    const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(text_);
    let column = headers.findIndex(header => normalizeHeader_(header) === normalizeHeader_(CONFIG.FORM_PROCESSED_HEADER)) + 1;

    if (!column) {
      column = lastColumn + 1;
      if (sheet.getMaxColumns() < column) sheet.insertColumnAfter(sheet.getMaxColumns());
      sheet.getRange(1, column).setValue(CONFIG.FORM_PROCESSED_HEADER);
    }

    const statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['自動', '完了', '重複'], true)
      .setAllowInvalid(false)
      .build();
    const validationRowCount = Math.max(sheet.getMaxRows() - 1, 1);
    sheet.getRange(2, column, validationRowCount, 1).setDataValidation(statusRule);

    if (sheet.getLastRow() >= 2) {
      const range = sheet.getRange(2, column, sheet.getLastRow() - 1, 1);
      const values = range.getValues().map(row => {
        const value = row[0];
        if (value === true || text_(value) === '完了') return ['完了'];
        if (text_(value) === '重複') return ['重複'];
        return ['自動'];
      });
      range.setValues(values);
    }
    return column;
  }

  function syncFormProcessedFromCheck_(ss, checkSheet, currentCheckRows) {
    const settings = readSettings_(ss);
    const formSheet = requiredSheet_(ss, settings.FORM_SHEET_NAME || CONFIG.DEFAULT_FORM_SHEET);
    const processedColumn = ensureFormProcessedColumn_(formSheet);
    const checkRows = currentCheckRows || readCheckObjects_(checkSheet);
    const completedApplicationKeys = completedApplicationKeysFromCheckRows_(checkRows);

    if (!completedApplicationKeys.size || formSheet.getLastRow() < 2) return 0;

    const values = formSheet.getDataRange().getDisplayValues();
    const indexes = aliasIndexes_(values[0], FORM_ALIASES, ['gameId', 'startDate', 'endDate']);
    const processedValues = values.slice(1).map(row => [row[processedColumn - 1]]);
    let updated = 0;
    for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
      const applicationKey = makeApplicationKey_({
        gameId: valueAt_(values[rowIndex], indexes.gameId),
        startDate: valueAt_(values[rowIndex], indexes.startDate),
        endDate: valueAt_(values[rowIndex], indexes.endDate)
      });
      if (!completedApplicationKeys.has(applicationKey) || formStatusDone_(values[rowIndex][processedColumn - 1])) continue;
      processedValues[rowIndex - 1][0] = '完了';
      updated++;
    }
    if (updated) {
      formSheet.getRange(2, processedColumn, processedValues.length, 1).setValues(processedValues);
    }
    return updated;
  }

  function completedApplicationKeysFromCheckRows_(checkRows) {
    const byApplicationKey = {};
    const sentGameIds = new Set();

    (checkRows || []).forEach(row => {
      if (text_(row['送信ステータス']) === '送信済み') {
        const gameId = normalizeGameId_(row['Game ID']);
        if (gameId) sentGameIds.add(gameId);
      }
      const applicationKey = text_(row['申請キー']);
      if (!applicationKey) return;
      if (!byApplicationKey[applicationKey]) byApplicationKey[applicationKey] = [];
      byApplicationKey[applicationKey].push(row);
    });

    const completedApplicationKeys = new Set();
    Object.keys(byApplicationKey).forEach(applicationKey => {
      const rows = byApplicationKey[applicationKey];
      const issueRows = rows.filter(row => text_(row['処理方針']) === '新規発行');
      const completed = issueRows.length
        ? issueRows.every(row => sentGameIds.has(normalizeGameId_(row['Game ID'])))
        : rows.every(row => ['対象外', '重複として除外'].indexOf(text_(row['処理方針'])) >= 0);
      if (completed) completedApplicationKeys.add(applicationKey);
    });
    return completedApplicationKeys;
  }


  function readCheckObjects_(sheet) {
    return readObjects_(sheet).map((row, index) => Object.assign(row, { __rowNo: index + 2 }));
  }

  function readSheetUpdateState_(sheet) {
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(text_);
    const columns = {};
    headers.forEach((header, index) => { columns[header] = index; });
    const objects = values.slice(1).map((row, index) => {
      const object = { __rowNo: index + 2 };
      headers.forEach((header, column) => { object[header] = row[column]; });
      return object;
    });
    return { values, headers, columns, objects };
  }

  function setUpdateStateValue_(state, row, header, value) {
    const column = state.columns[header];
    if (column === undefined) throw new Error('Sheet列が見つかりません: ' + header);
    row[header] = value;
    state.values[row.__rowNo - 1][column] = value;
  }

  function writeSheetUpdateState_(sheet, state) {
    if (state.values.length < 2) return;
    sheet.getRange(2, 1, state.values.length - 1, state.headers.length)
      .setValues(state.values.slice(1));
  }


  function columnToLetter_(column) {
    let value = Math.floor(Number(column));
    let result = '';
    while (value > 0) {
      value--;
      result = String.fromCharCode(65 + (value % 26)) + result;
      value = Math.floor(value / 26);
    }
    return result;
  }

  function groupCheckRowsForDraft_(rows) {
    const groups = {};
    rows.forEach(row => {
      const key = normalizeGameId_(row['Game ID']);
      if (!key) return;
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
    });
    Object.keys(groups).forEach(key => {
      groups[key].sort((a, b) => Number(a.__rowNo || 0) - Number(b.__rowNo || 0));
    });
    return groups;
  }

  function mailGroupInfo_(group) {
    const rows = (group || []).slice().sort((a, b) => Number(a.__rowNo || 0) - Number(b.__rowNo || 0));
    return {
      rows,
      leader: rows[0] || null,
      gameId: rows.length ? normalizeGameId_(rows[0]['Game ID']) : '',
      names: uniqueStrings_(rows.map(row => text_(row['本名'])).filter(Boolean)),
      emails: uniqueStrings_(rows.map(row => text_(row['メールアドレス']).toLowerCase()).filter(Boolean)),
      draftIds: uniqueStrings_(rows.map(row => text_(row['Draft ID'])).filter(Boolean)),
      draftStatuses: uniqueStrings_(rows.map(row => text_(row['草稿ステータス'])).filter(Boolean)),
      sendStatuses: uniqueStrings_(rows.map(row => text_(row['送信ステータス'])).filter(Boolean)),
      sentTimes: rows.map(row => row['送信日時']).filter(value => text_(value)),
      approved: rows.some(row => isOn_(row['送信OK']))
    };
  }

  function normalizeMailGroupDisplay_(state, group) {
    const info = mailGroupInfo_(group);
    if (!info.leader) return info;
    const leader = info.leader;
    const draftId = info.draftIds.length === 1 ? info.draftIds[0] : '';
    const sent = info.sendStatuses.indexOf('送信済み') >= 0;
    const sendStatus = sent
      ? '送信済み'
      : (info.sendStatuses.length === 1 ? info.sendStatuses[0] : '');
    const draftStatus = sent
      ? '送信済み'
      : (info.draftStatuses.length === 1 ? info.draftStatuses[0] : '');
    const sentAt = info.sentTimes.length ? info.sentTimes[0] : '';

    setUpdateStateValue_(state, leader, 'Draft ID', draftId);
    setUpdateStateValue_(state, leader, '草稿ステータス', draftStatus);
    setUpdateStateValue_(state, leader, '送信OK', info.approved);
    setUpdateStateValue_(state, leader, '送信ステータス', sendStatus);
    setUpdateStateValue_(state, leader, '送信日時', sentAt);
    info.rows.slice(1).forEach(row => {
      ['Draft ID', '草稿ステータス', '送信OK', '送信ステータス', '送信日時']
        .forEach(header => setUpdateStateValue_(state, row, header, ''));
    });

    if (info.draftIds.length > 1) {
      setUpdateStateValue_(state, leader, '草稿ステータス', '人工確認必要');
      setUpdateStateValue_(
        state,
        leader,
        '確認内容',
        '同一Game IDに複数Draft IDがあります: ' + info.draftIds.join(', ') +
        '。Gmailで正しい草稿を確認し、余分な草稿を削除してからAI列へ正しいDraft IDを入力してください。'
      );
    }
    return info;
  }

  function applyMailGroupConflictToCheck_(state, group) {
    const info = mailGroupInfo_(group);
    if (!info.leader || (info.names.length <= 1 && info.emails.length <= 1)) return false;
    setUpdateStateValue_(state, info.leader, '判定', '確認必要');
    setUpdateStateValue_(state, info.leader, '確認状態', '未確定');
    setUpdateStateValue_(state, info.leader, 'confirmedHash', '');
    setUpdateStateValue_(
      state,
      info.leader,
      '確認内容',
      '同一Game ID内の本名またはメールが一致しません。グループ先頭行のK列・L列を正しい値へ修正し、AA列へ理由、AB列をONにしてメニュー5を実行してください。先頭行の値を同一Game ID全体へ適用します。'
    );
    return true;
  }

  function objectMapBy_(rows, key) {
    const map = {};
    rows.forEach(row => {
      const value = text_(row[key]);
      if (value) map[value] = row;
    });
    return map;
  }

  function hash_(value) {
    const source = String(value === null || value === undefined ? '' : value);
    let hash = 2166136261;
    for (let index = 0; index < source.length; index++) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return 'fnv1a-' + ('00000000' + (hash >>> 0).toString(16)).slice(-8) + '-' + source.length;
  }

  function gameIdFinalHash_(data) {
    return hash_([
      text_(data.sourceHash), normalizeGameId_(data.gameId), text_(data.finalName),
      text_(data.finalEmail).toLowerCase(), removeSama_(data.finalRecipient), text_(data.policy)
    ].join('\n'));
  }

  function receiptFinalHash_(data) {
    return hash_([
      text_(data.sourceHash), text_(data.finalName), text_(data.finalEmail).toLowerCase(),
      removeSama_(data.finalRecipient), text_(data.policy)
    ].join('\n'));
  }

  function isGameIdCheckRowResolved_(row) {
    const policy = text_(row['処理方針']);
    if (['採用', '除外'].indexOf(policy) < 0) return false;
    if (policy === '採用' && (
      !normalizeGameId_(row['Game ID']) || !text_(row['確定本名']) ||
      !validEmail_(row['確定メールアドレス'])
    )) return false;
    const currentHash = gameIdFinalHash_({
      sourceHash: row.sourceHash,
      gameId: row['Game ID'],
      finalName: row['確定本名'],
      finalEmail: row['確定メールアドレス'],
      finalRecipient: row['確定宛名'],
      policy
    });
    return ['確定済み', '自動確定'].indexOf(text_(row['確認状態'])) >= 0 &&
      text_(row.confirmedHash) === currentHash;
  }

  function countUnresolvedGameIdRows_(rows) {
    return rows.filter(row => !isGameIdCheckRowResolved_(row)).length;
  }

  function isReceiptCheckRowResolved_(row) {
    const policy = text_(row['処理方針']);
    if (['新規発行', '対象外', '重複として除外'].indexOf(policy) < 0) {
      return false;
    }
    if (policy === '新規発行' && (
      !normalizeGameId_(row['Game ID']) || !text_(row['本名']) || !validEmail_(row['メールアドレス'])
    )) return false;
    const currentHash = receiptFinalHash_({
      sourceHash: row.sourceHash,
      finalName: row['本名'],
      finalEmail: row['メールアドレス'],
      finalRecipient: row['宛名'],
      policy
    });
    return ['確定済み', '自動確定'].indexOf(text_(row['確認状態'])) >= 0 &&
      text_(row.confirmedHash) === currentHash;
  }

  function countUnresolvedReceiptRows_(rows) {
    return rows.filter(row => !isReceiptCheckRowResolved_(row)).length;
  }

  function receiptBatchHash_(rows) {
    const fields = [
      'checkKey', 'sourceHash', 'confirmedHash', '申請キー', 'paymentKey', 'pdfKey',
      'Game ID', '本名', 'メールアドレス', '宛名', 'eventName', '購入時間',
      '年', '月', '日', '大会名', '種別', '現金', 'クレジットカード',
      'ポイント', 'USDT', '総金額', '処理方針'
    ];
    const normalized = rows.map(row => fields.map(field => text_(row[field])).join('\t')).sort();
    return hash_(normalized.join('\n'));
  }

  function assertReceiptBatchConfirmed_(ss, sheet, existingRows) {
    const rows = existingRows || readObjects_(sheet);
    if (!rows.length) throw new Error('領収書CHECKが空です');
    const unresolved = countUnresolvedReceiptRows_(rows);
    if (unresolved) throw new Error('未確定または確定後に変更された領収書CHECKがあります: ' + unresolved + '件');
    const saved = PropertiesService.getDocumentProperties().getProperty('RSE_CONFIRMED_RECEIPT_BATCH_HASH');
    const current = receiptBatchHash_(rows);
    if (!saved || saved !== current) {
      throw new Error('領収書CHECKの確定記録がないか、確定後に内容が変更されています。「領収書CHECKを確定」を再実行してください。');
    }
  }

  function readConfirmedApplications_(ss) {
    const sheet = requiredSheet_(ss, CONFIG.GAME_ID_CHECK_SHEET);
    const rows = readObjects_(sheet);
    if (!rows.length) throw new Error('Game ID CHECKが空です');
    const unresolved = countUnresolvedGameIdRows_(rows);
    if (unresolved) throw new Error('未確定または確定後に変更されたGame ID CHECKがあります: ' + unresolved + '件');
    const map = {};
    rows.forEach(row => {
      if (text_(row['処理方針']) !== '採用') return;
      const gameId = normalizeGameId_(row['Game ID']);
      const applicationKey = text_(row['申請キー']);
      const period = parseApplicationKey_(applicationKey);
      if (!applicationKey || !period.startDate || !period.endDate) {
        throw new Error('申請キーから対象期間を取得できません: ' + applicationKey);
      }
      map[applicationKey] = {
        gameId,
        name: text_(row['確定本名']),
        email: text_(row['確定メールアドレス']).toLowerCase(),
        recipient: removeSama_(row['確定宛名']),
        eventName: text_(row.eventName),
        startDate: period.startDate,
        endDate: period.endDate,
        applicationKey
      };
    });
    return map;
  }

  function writeManagedRows_(sheet, headers, rows, checkboxColumns) {
    if (sheet.getMaxColumns() < headers.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
    }
    const requiredRows = rows.length + 1;
    if (sheet.getMaxRows() < requiredRows) {
      sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
    }
    const previousRows = Math.max(sheet.getLastRow() - 1, 0);
    if (previousRows) {
      sheet.getRange(2, 1, previousRows, headers.length).clearContent().clearDataValidations();
    }
    if (rows.length) {
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
      (checkboxColumns || []).forEach(column => {
        sheet.getRange(2, column, rows.length, 1).insertCheckboxes();
      });
    }
    sheet.setFrozenRows(1);
  }

  function writePwInputRows_(sheet, headers, rows) {
    if (sheet.getMaxColumns() < headers.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
    }
    const requiredRows = rows.length + 1;
    if (sheet.getMaxRows() < requiredRows) {
      sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
    }
    const clearRows = Math.max(sheet.getLastRow(), 1);
    const clearColumns = Math.max(sheet.getLastColumn(), headers.length);
    sheet.getRange(1, 1, clearRows, clearColumns).clearContent().clearDataValidations();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (rows.length) {
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
      sheet.getRange(2, 1, rows.length, 1).setNumberFormat('@');
    }
    sheet.setFrozenRows(1);
  }

  function formatGameIdCheckSheet_(sheet, rowCount) {
    if (!rowCount) return;
    sheet.getRange(2, 7, rowCount, 1).setNumberFormat('@');
    sheet.getRange(2, 7, rowCount, 1).setBackground('#d9ead3');
    sheet.getRange(2, 12, rowCount, 5).setBackground('#d9ead3');
    const validation = SpreadsheetApp.newDataValidation()
      .requireValueInList(['採用', '除外'], true).setAllowInvalid(false).build();
    sheet.getRange(2, 15, rowCount, 1).setDataValidation(validation);
  }

  function formatReceiptCheckSheet_(sheet, rowCount) {
    if (!rowCount) return;
    sheet.getRange(2, 10, rowCount, 1).setNumberFormat('@');
    sheet.getRange(2, 32, rowCount, 3).setNumberFormat('@');
    sheet.getRange(2, 11, rowCount, 3).setBackground('#d9ead3');
    sheet.getRange(2, 26, rowCount, 2).setBackground('#d9ead3');
    const validation = SpreadsheetApp.newDataValidation()
      .requireValueInList(['新規発行', '対象外', '重複として除外'], true)
      .setAllowInvalid(false).build();
    sheet.getRange(2, 26, rowCount, 1).setDataValidation(validation);
  }

  function formatMailGroupControls_(sheet, groups) {
    const rowCount = Math.max(sheet.getLastRow() - 1, 0);
    if (!rowCount) return;
    const sendOkColumn = CHECK_HEADERS.indexOf('送信OK') + 1;
    const mailStartColumn = CHECK_HEADERS.indexOf('Draft ID') + 1;
    sheet.getRange(2, sendOkColumn, rowCount, 1).clearDataValidations();
    sheet.getRange(2, mailStartColumn, rowCount, 5).setBackground(null);
    const leaderRows = Object.keys(groups || {})
      .map(gameId => mailGroupInfo_(groups[gameId]).leader)
      .filter(Boolean)
      .map(row => row.__rowNo);
    if (!leaderRows.length) return;
    const sendOkLetter = columnToLetter_(sendOkColumn);
    const mailStartLetter = columnToLetter_(mailStartColumn);
    const mailEndLetter = columnToLetter_(mailStartColumn + 4);
    sheet.getRangeList(leaderRows.map(rowNo => sendOkLetter + rowNo)).insertCheckboxes();
    sheet.getRangeList(leaderRows.map(rowNo => mailStartLetter + rowNo + ':' + mailEndLetter + rowNo))
      .setBackground('#fff2cc');
  }

  function setHeaderValue_(sheet, headers, rowNo, header, value) {
    const column = headers.indexOf(header) + 1;
    if (column < 1) throw new Error('列が定義されていません: ' + header);
    sheet.getRange(rowNo, column).setValue(value);
  }

  function activeUserEmail_() {
    return text_(Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || 'unknown');
  }

  function showPwInputDialog_(tsv, count) {
    const html = HtmlService.createHtmlOutput(
      '<div style="font-family:Arial,sans-serif;padding:12px">' +
      '<div style="margin-bottom:6px"><b>Input: Game ID (' + count + '行)</b></div>' +
      '<textarea id="rseTsv" readonly style="width:100%;height:330px;box-sizing:border-box;font-family:monospace">' +
      escapeHtml_(tsv) + '</textarea>' +
      '<button style="margin-top:10px;width:100%;height:38px" onclick="var x=document.getElementById(\'rseTsv\');x.select();document.execCommand(\'copy\');this.textContent=\'コピー済み\';">TSVをコピー</button>' +
      '</div>'
    ).setWidth(720).setHeight(500);
    SpreadsheetApp.getUi().showModalDialog(html, 'PW 1.6.17 入力');
  }

  function reserveReceiptNumbers_(ss, count) {
    if (!count) return [];
    const sheet = requiredSheet_(ss, CONFIG.SETTINGS_SHEET);
    const values = sheet.getDataRange().getDisplayValues();
    for (let index = 1; index < values.length; index++) {
      if (text_(values[index][0]) !== 'NEXT_RECEIPT_NO') continue;
      const nextNo = Math.floor(Number(values[index][1]));
      if (!Number.isFinite(nextNo) || nextNo < 1) {
        throw new Error('RSE_設定のNEXT_RECEIPT_NOが不正です');
      }
      sheet.getRange(index + 1, 2).setValue(nextNo + count);
      return Array.from({ length: count }, (_, offset) => String(nextNo + offset));
    }
    throw new Error('RSE_設定にNEXT_RECEIPT_NOがありません');
  }

  function findSingleFileByName_(folder, fileName) {
    const files = folder.getFilesByName(fileName);
    if (!files.hasNext()) return null;
    const file = files.next();
    if (files.hasNext()) throw new Error('同名PDFが複数あります。Driveを人工確認してください: ' + fileName);
    return file;
  }

  function buildSharedValueMap_(applications, field) {
    const map = {};
    Object.keys(applications).forEach(key => {
      const info = applications[key];
      if (!info || info.conflict) return;
      const raw = field === 'email'
        ? text_(info.application[field]).toLowerCase()
        : compact_(info.application[field]);
      if (!raw) return;
      if (!map[raw]) map[raw] = [];
      const gameId = normalizeGameId_(info.application.gameId);
      if (gameId && map[raw].indexOf(gameId) < 0) map[raw].push(gameId);
    });
    return map;
  }


  function makeApplicationKey_(app) {
    return ['REQ', normalizeGameId_(app.gameId), normalizeIsoDate_(app.startDate), normalizeIsoDate_(app.endDate)].join('__');
  }

  function makePaymentKey_(data) {
    return [
      normalizeGameId_(data.gameId),
      compact_(data.tournament),
      compact_(data.purchaseTime),
      compact_(data.type),
      Math.round(Number(data.total || 0))
    ].join('__');
  }

  function makePdfKey_(paymentKey, recipient) {
    return paymentKey + '__' + compact_(recipient);
  }

  function calcTotal_(row) {
    return money_(row.cash) + money_(row.creditCard) + money_(row.points) + money_(row.usdt);
  }

  function readTable_(sheet) {
    const values = sheet.getDataRange().getValues();
    if (!values.length) throw new Error('Sheetが空です: ' + sheet.getName());
    return {
      headers: values[0].map(text_),
      rows: values.slice(1).filter(row => row.some(value => text_(value) !== ''))
    };
  }

  function readObjects_(sheet) {
    const table = readTable_(sheet);
    return table.rows.map(row => {
      const obj = {};
      table.headers.forEach((header, index) => {
        if (header) obj[header] = row[index];
      });
      return obj;
    });
  }

  function aliasIndexes_(headers, aliases, requiredKeys) {
    const normalized = headers.map(normalizeHeader_);
    const result = {};
    Object.keys(aliases).forEach(key => {
      const candidates = aliases[key].map(normalizeHeader_);
      result[key] = normalized.findIndex(header => candidates.indexOf(header) >= 0);
    });
    const missing = requiredKeys.filter(key => result[key] < 0);
    if (missing.length) throw new Error('必要な表頭が見つかりません: ' + missing.join(', '));
    return result;
  }

  function valueAt_(row, index) {
    return index >= 0 ? row[index] : '';
  }

  function ensureSheet_(ss, name, headers) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    if (sheet.getMaxColumns() < headers.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
    }
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else {
      const actual = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0].map(text_);
      if (actual.join('\t') !== headers.join('\t')) {
        throw new Error(name + ' の表頭が実験版定義と一致しません。既存Sheetを確認してください。');
      }
    }
    sheet.setFrozenRows(1);
    return sheet;
  }

  function ensureSettingsDefaults_(sheet) {
    const existing = {};
    if (sheet.getLastRow() >= 2) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues().forEach(row => {
        const key = text_(row[0]);
        if (key) existing[key] = row[1];
      });
    }
    const rows = SETTINGS_DEFAULTS.map(row => [
      row[0],
      Object.prototype.hasOwnProperty.call(existing, row[0]) ? existing[row[0]] : row[1],
      row[2]
    ]);
    if (sheet.getLastRow() >= 2) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, SETTINGS_HEADERS.length).clearContent();
    }
    if (rows.length) sheet.getRange(2, 1, rows.length, SETTINGS_HEADERS.length).setValues(rows);
    const trailingRows = sheet.getLastRow() - rows.length - 1;
    if (trailingRows > 0) {
      sheet.getRange(rows.length + 2, 1, trailingRows, SETTINGS_HEADERS.length).clearContent();
    }
  }

  function readSettings_(ss) {
    const sheet = requiredSheet_(ss, CONFIG.SETTINGS_SHEET);
    const settings = {};
    if (sheet.getLastRow() < 2) return settings;
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues().forEach(row => {
      const key = text_(row[0]);
      if (key) settings[key] = text_(row[1]);
    });
    return settings;
  }

  function assertInitialized_(ss) {
    [CONFIG.SETTINGS_SHEET, CONFIG.GAME_ID_CHECK_SHEET, CONFIG.PW_INPUT_SHEET, CONFIG.CHECK_SHEET, CONFIG.LEDGER_SHEET]
      .forEach(name => requiredSheet_(ss, name));
  }

  function validateGenerationSettings_(settings) {
    if (!text_(settings.RECEIPT_FOLDER_URL)) throw new Error('RSE_設定のRECEIPT_FOLDER_URLが空です');
  }

  function positiveIntegerSetting_(value, fallback) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function optionalPositiveIntegerSetting_(value) {
    const raw = text_(value);
    if (!raw) return 0;
    const number = Math.floor(Number(raw));
    if (!Number.isFinite(number) || number < 1) {
      throw new Error('MAX_RECEIPTS_PER_RUNは空白または1以上の整数を設定してください');
    }
    return number;
  }

  function boundedIntegerSetting_(value, fallback, minimum, maximum) {
    const raw = text_(value);
    if (!raw) return fallback;
    const number = Math.floor(Number(raw));
    if (!Number.isFinite(number) || number < minimum) return fallback;
    return Math.min(number, maximum);
  }

  function positiveNumberSetting_(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function requiredSheet_(ss, name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) throw new Error('必要なSheetが見つかりません: ' + name);
    return sheet;
  }

  function getFolder_(urlOrId) {
    const id = extractDriveId_(urlOrId);
    if (!id) throw new Error('DriveフォルダURLまたはIDが不正です');
    return DriveApp.getFolderById(id);
  }

  function extractDriveId_(value) {
    const text = String(value || '').trim();
    if (/^[A-Za-z0-9_-]{20,}$/.test(text)) return text;
    const match = text.match(/\/folders\/([A-Za-z0-9_-]+)/) || text.match(/[?&]id=([A-Za-z0-9_-]+)/);
    return match ? match[1] : '';
  }

  function installOpenTrigger_() {
    const exists = ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === 'RSE_onOpen');
    if (!exists) {
      ScriptApp.newTrigger('RSE_onOpen')
        .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
        .onOpen()
        .create();
    }
  }

  function uniqueStrings_(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function normalizeHeader_(value) {
    return text_(value).replace(/[\s\u3000_*＊]/g, '').toLowerCase();
  }

  function normalizeGameId_(value) {
    const digits = String(value === null || value === undefined ? '' : value).replace(/\D/g, '');
    return digits.length === 8 ? digits : '';
  }

  function normalizeIsoDate_(value) {
    if (value instanceof Date && !isNaN(value.getTime())) {
      return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd');
    }
    const source = text_(value).normalize ? text_(value).normalize('NFKC') : text_(value);
    let match = source.match(/^(\d{4})[\/.\-年](\d{1,2})[\/.\-月](\d{1,2})日?$/);
    if (!match) {
      const dayFirst = source.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
      if (dayFirst) match = [dayFirst[0], dayFirst[3], dayFirst[2], dayFirst[1]];
    }
    if (!match) return '';
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return '';
    return [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
  }

  function parseApplicationKey_(applicationKey) {
    const parts = text_(applicationKey).split('__');
    return parts.length === 4 && parts[0] === 'REQ'
      ? { gameId: normalizeGameId_(parts[1]), startDate: normalizeIsoDate_(parts[2]), endDate: normalizeIsoDate_(parts[3]) }
      : { gameId: '', startDate: '', endDate: '' };
  }

  function pwIsoDate_(pw) {
    return normalizeIsoDate_([pw.year, pw.month, pw.day].join('-'));
  }

  function pwMatchesApplicationPeriod_(pw, app) {
    const date = pwIsoDate_(pw);
    return Boolean(date && app && app.startDate && app.endDate && date >= app.startDate && date <= app.endDate);
  }

  function formStatusDone_(value) {
    return value === true || ['完了', '重複'].indexOf(text_(value)) >= 0;
  }

  function text_(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/\u3000/g, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t\r\n]+/g, ' ')
      .trim();
  }

  function compact_(value) {
    let text = text_(value);
    if (text.normalize) text = text.normalize('NFKC');
    return text.replace(/[\s\u3000\/／|｜]/g, '').toLowerCase();
  }

  function removeSama_(value) {
    return text_(value).replace(/\s*様\s*$/, '').trim();
  }

  function money_(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const number = Number(String(value === null || value === undefined ? '' : value).replace(/[^\d.-]/g, ''));
    return Number.isFinite(number) ? number : 0;
  }

  function formatYen_(value) {
    return '¥' + Math.round(Number(value) || 0).toLocaleString('ja-JP') + '-';
  }

  function validEmail_(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text_(value));
  }

  function isOn_(value) {
    if (value === true || value === 1) return true;
    return ['ON', 'TRUE', 'YES', 'OK', '1', '生成OK', '送信OK'].indexOf(text_(value).toUpperCase()) >= 0;
  }

  function formatEventLabel_(value) {
    const text = text_(value);
    if (!text) return '各大会';
    if (/^【.*】$/.test(text)) return text;
    return '【' + text.replace(/^【|】$/g, '') + '】';
  }

  function eventLabelFromTournament_(tournament) {
    const name = text_(tournament);
    if (!name) return '';
    const bracket = name.match(/^【[^】]+】/);
    return bracket ? bracket[0] : name;
  }

  function eventLabelForItems_(items) {
    const labels = uniqueStrings_((items || []).map(item =>
      eventLabelFromTournament_(item && item.data ? item.data.tournament : '')
    ));
    if (!labels.length) return '各大会';
    return labels.join('・');
  }

  function sanitizeFileName_(value) {
    return text_(value).replace(/[\\/:*?"<>|]/g, '_');
  }

  function escapeHtml_(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function alert_(message) {
    try {
      SpreadsheetApp.getUi().alert(message);
    } catch (_) {
      Logger.log(message);
    }
  }

  return {
    addMenu,
    setup,
    refreshGameIdCheck,
    confirmGameIdCheck,
    buildPwInput,
    refreshReceiptCheck,
    confirmReceiptCheck,
    assignReceiptNumbers,
    generatePendingFiles,
    getRenderBatch,
    saveRenderedPdfBatch,
    createPendingDrafts,
    sendApproved,
    _test: {
      normalizeGameId_, makePaymentKey_, makePdfKey_, money_, calcTotal_, compact_, text_,
      hash_, gameIdFinalHash_, receiptFinalHash_, receiptBatchHash_,
      isGameIdCheckRowResolved_, isReceiptCheckRowResolved_, makeReceiptFileName_,
      makeReceiptCheckRow_, buildReceiptCheckRows_, groupCheckRowsForDraft_,
      completedApplicationKeysFromCheckRows_, receiptIntersectionStats_,
      normalizeIsoDate_, parseApplicationKey_, pwMatchesApplicationPeriod_,
      readLedgerUpdateState_, mutateLedgerFieldsForPdfKeys_, markReplacedLedgerState_,
      readSheetUpdateState_, normalizeMailGroupDisplay_, mailGroupInfo_,
      columnToLetter_
    }
  };
})();

function RSE_onOpen() {
  RSE.addMenu();
}

function RSE_setup() {
  RSE.setup();
}

function RSE_refreshGameIdCheck() {
  RSE.refreshGameIdCheck();
}

function RSE_confirmGameIdCheck() {
  RSE.confirmGameIdCheck();
}

function RSE_buildPwInput() {
  RSE.buildPwInput();
}

function RSE_refreshReceiptCheck() {
  RSE.refreshReceiptCheck();
}

function RSE_confirmReceiptCheck() {
  RSE.confirmReceiptCheck();
}

function RSE_assignReceiptNumbers() {
  RSE.assignReceiptNumbers();
}

function RSE_generatePendingFiles() {
  RSE.generatePendingFiles();
}

function RSE_getRenderBatch(options) {
  return RSE.getRenderBatch(options);
}

function RSE_saveRenderedPdfBatch(payload) {
  return RSE.saveRenderedPdfBatch(payload);
}

function RSE_createPendingDrafts() {
  RSE.createPendingDrafts();
}

function RSE_sendApproved() {
  RSE.sendApproved();
}
