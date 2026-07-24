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
 * - 領収書番号を採番し、PDFをDriveへ直接生成する
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
    ['EVENT_NAME', '', '本批次の管理・PDF表示に使う代表名。Form抽出条件ではありません'],
    ['FORM_EVENT_FILTER', '', 'Form回答を特定イベントだけに絞る場合のみ設定。全イベントなら空白'],
    ['PW_EVENT_KEYWORDS', '', 'PW 1.6.17へ渡す大会キーワード。複数は改行、空白なら期間内すべて'],
    ['PW_DATE_RANGE', '', 'PW 1.6.17検索期間 例: 11/7/2026 - 22/7/2026'],
    ['EVENT_LABEL', '', 'PDF・メールに表示するイベント名。空白ならEVENT_NAME'],
    ['NEXT_RECEIPT_NO', '900000', '次に採番する領収書番号。実験用番号を設定'],
    ['DATE_FROM', '', '対象購入日の開始 YYYY-MM-DD。空白なら制限なし'],
    ['DATE_TO', '', '対象購入日の終了 YYYY-MM-DD。空白なら制限なし'],
    ['RECEIPT_FOLDER_URL', '', '実験PDF保存先DriveフォルダURLまたはID'],
    ['TEST_MODE', 'ON', 'ONなら下書き宛先をTEST_EMAILへ変更'],
    ['TEST_EMAIL', '', '実験下書きの宛先'],
    ['FROM_ALIAS', '', 'Gmail送信元エイリアス。未設定なら空白'],
    ['FROM_NAME', 'Japan Open Poker Tour / JOPT', 'メール送信者表示名'],
    ['BCC', '', 'BCC。実験中は空白推奨'],
    ['SUBJECT', '電子領収書の送付について', 'メール件名'],
    ['MAX_RECEIPTS_PER_RUN', '20', '1回のPDF生成上限。実験中は小さい値を推奨'],
    ['MAX_DRAFTS_PER_SEND', '20', '1回の送信草稿上限'],
    ['MAX_ATTACHMENT_MB', '20', '1通の添付合計上限MB'],
    ['MAX_EXECUTION_SECONDS', '240', '各重処理の自主停止秒数。Google強制停止前に終了']
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
    eventName: ['対象イベント', 'イベント名', 'eventName', '大会名']
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
      .addItem('7. 未生成PDFを生成', 'RSE_generatePendingFiles')
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

    installOpenTrigger_();
    addMenu();
    alert_(
      '実験版の初期設定が完了しました。\n\n' +
      '最初に RSE_設定 の大会名・PW検索条件・保存先・開始番号を確認してください。\n' +
      'TEST_MODE=ON のまま、実験用DriveフォルダとTEST_EMAILを設定してください。'
    );
  }

  function refreshGameIdCheck() {
    const lock = LockService.getDocumentLock();
    lock.waitLock(30000);
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      assertInitialized_(ss);
      const settings = readSettings_(ss);
      validateGameIdSettings_(settings);
      const formSheet = requiredSheet_(ss, settings.FORM_SHEET_NAME || CONFIG.DEFAULT_FORM_SHEET);
      const checkSheet = requiredSheet_(ss, CONFIG.GAME_ID_CHECK_SHEET);
      const applicationResult = readApplications_(formSheet, settings);
      const prior = objectMapBy_(readObjects_(checkSheet), 'checkKey');
      const nameGames = buildSharedValueMap_(applicationResult.byGameId, 'name');
      const emailGames = buildSharedValueMap_(applicationResult.byGameId, 'email');
      const rows = [];

      Object.keys(applicationResult.byGameId).sort().forEach(gameId => {
        const info = applicationResult.byGameId[gameId];
        const app = info.application;
        const checkKey = 'APP__' + compact_(settings.EVENT_NAME) + '__' + gameId;
        const sourceHash = hash_((info.applications || [app]).map(item => [
          item.rowNo, item.gameId, item.name, item.email, item.recipient, item.eventName
        ].join('|')).join('\n'));
        const old = prior[checkKey] || {};
        const finalGameId = normalizeGameId_(old['Game ID']) || gameId;
        const finalName = text_(old['確定本名'] || app.name);
        const finalEmail = text_(old['確定メールアドレス'] || app.email).toLowerCase();
        const finalRecipient = removeSama_(old['確定宛名'] !== undefined ? old['確定宛名'] : app.recipient);
        const policy = text_(old['処理方針'] || '採用');
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
          settings.EVENT_NAME,
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
          settings.EVENT_NAME, app.applicationKey || ''
        ]);
      });

      writeManagedRows_(checkSheet, GAME_ID_CHECK_HEADERS, rows, [17]);
      formatGameIdCheckSheet_(checkSheet, rows.length);
      const unresolved = countUnresolvedGameIdRows_(readObjects_(checkSheet));
      alert_(
        'Game ID CHECK更新完了。\n\n' +
        'Game ID: ' + Object.keys(applicationResult.byGameId).length + '件\n' +
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
    const settings = readSettings_(ss);
    validateGameIdSettings_(settings);
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
    const gameIdCounts = {};
    adoptedGameIds.forEach(gameId => { gameIdCounts[gameId] = (gameIdCounts[gameId] || 0) + 1; });
    const duplicateGameIds = Object.keys(gameIdCounts).filter(gameId => gameIdCounts[gameId] > 1);
    if (duplicateGameIds.length) {
      throw new Error('採用済みGame IDがCHECK内で重複しています: ' + duplicateGameIds.join(', '));
    }
    const gameIds = uniqueStrings_(adoptedGameIds);
    const keywords = parseSettingList_(settings.PW_EVENT_KEYWORDS);
    if (!gameIds.length) throw new Error('採用済みGame IDがありません');

    const headers = ['Game ID'].concat(keywords.map((_, index) => '大会名' + (index + 1)));
    const output = gameIds.map(gameId => [gameId].concat(keywords));
    writePwInputRows_(outputSheet, headers, output);
    const tsv = output.map(row => row.join('\t')).join('\n');
    showPwInputDialog_(settings.PW_DATE_RANGE, tsv, output.length);
  }

  function refreshReceiptCheck() {
    const lock = LockService.getDocumentLock();
    lock.waitLock(30000);
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      assertInitialized_(ss);
      const settings = readSettings_(ss);
      validateCheckSettings_(settings);
      const applications = readConfirmedApplications_(ss);
      const pwSheet = requiredSheet_(ss, settings.PW_SHEET_NAME || CONFIG.DEFAULT_PW_SHEET);
      const pwResult = readPwRows_(pwSheet, settings);
      const checkSheet = requiredSheet_(ss, CONFIG.CHECK_SHEET);
      const ledgerMap = buildLedgerMap_(readObjects_(requiredSheet_(ss, CONFIG.LEDGER_SHEET)));
      const prior = objectMapBy_(readObjects_(checkSheet), 'checkKey');
      const rows = buildReceiptCheckRows_(applications, pwResult, ledgerMap, prior, settings);

      writeManagedRows_(checkSheet, CHECK_HEADERS, rows, [28, 37]);
      formatReceiptCheckSheet_(checkSheet, rows.length);
      PropertiesService.getDocumentProperties().deleteProperty('RSE_CONFIRMED_RECEIPT_BATCH_HASH');
      const unresolved = countUnresolvedReceiptRows_(readObjects_(checkSheet));
      alert_(
        '領収書CHECK更新完了。\n\n明細: ' + rows.length + '件\n未解決: ' + unresolved + '件\n\n' +
        '正常行は自動確定です。確認必要行だけ修正し、確認OKをONにしてください。'
      );
    } finally {
      lock.releaseLock();
    }
  }

  function buildReceiptCheckRows_(applications, pwResult, ledgerMap, prior, settings) {
    const output = [];
    const pwByGameId = pwResult.byGameId;
    const allGameIds = uniqueStrings_(Object.keys(applications).concat(Object.keys(pwByGameId))).sort();
    const invalidPwGameIds = new Set(pwResult.invalid
      .map(item => normalizeGameId_((item.pw || {}).gameId))
      .filter(Boolean));
    const seenPayments = new Set();

    pwResult.invalid.forEach(item => {
      const pw = item.pw || {};
      const checkKey = 'INVALID_PW__' + (pw.rowNo || output.length + 2);
      output.push(makeReceiptCheckRow_({
        judgement: '確認必要', state: '未確定', message: item.message,
        checkKey, sourceHash: hash_(item.message + '|' + JSON.stringify(pw)),
        application: applications[pw.gameId] || {}, pw, policy: '', old: prior[checkKey] || {}
      }));
    });

    allGameIds.forEach(gameId => {
      const app = applications[gameId];
      const pwRows = pwByGameId[gameId] || [];
      if (!app) {
        pwRows.forEach(pw => {
          const checkKey = 'PW_ONLY__' + gameId + '__' + pw.rowNo;
          output.push(makeReceiptCheckRow_({
            judgement: '確認必要', state: '未確定',
            message: '確定済みGame ID申請がありません', checkKey,
            sourceHash: hash_(JSON.stringify(pw)), application: {}, pw,
            policy: '', old: prior[checkKey] || {}
          }));
        });
        return;
      }

      if (!pwRows.length) {
        if (invalidPwGameIds.has(gameId)) return;
        const checkKey = 'FORM_ONLY__' + gameId;
        output.push(makeReceiptCheckRow_({
          judgement: '確認必要', state: '未確定',
          message: '確定済み申請がありますがPW TSVに支払明細がありません', checkKey,
          sourceHash: hash_(JSON.stringify(app)), application: app, pw: {},
          policy: '', old: prior[checkKey] || {}
        }));
        return;
      }

      pwRows.forEach(pw => {
        const total = calcTotal_(pw);
        const paymentKey = makePaymentKey_({
          gameId, eventName: settings.EVENT_NAME, tournament: pw.tournament,
          purchaseTime: pw.purchaseTime, type: pw.type, total
        });
        const checkKey = paymentKey + '__PWROW__' + pw.rowNo;
        const old = prior[checkKey] || {};
        const finalName = text_(old['本名'] || app.name);
        const finalEmail = text_(old['メールアドレス'] || app.email).toLowerCase();
        const finalRecipient = removeSama_(old['宛名'] !== undefined ? old['宛名'] : app.recipient);
        const pdfKey = makePdfKey_(paymentKey, finalRecipient);
        const existingPdf = ledgerMap.byPdfKey[pdfKey];
        const existingPayment = ledgerMap.byPaymentKey[paymentKey];
        const sourceHash = hash_([
          app.applicationKey, gameId, app.name, app.email, app.recipient,
          pw.purchaseTime, pw.year, pw.month, pw.day, pw.tournament, pw.type,
          pw.cash, pw.creditCard, pw.points, pw.usdt, total
        ].join('|'));
        const messages = [];
        let judgement = 'OK';
        let policy = text_(old['処理方針'] || '新規発行');
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

        if (existingPdf) {
          const oldEmail = text_(existingPdf['メールアドレス']).toLowerCase();
          if (oldEmail && oldEmail !== finalEmail) {
            judgement = '確認必要';
            requiresManual = true;
            messages.push('同じPDFの既存送信先とメールアドレスが異なります');
          } else {
            judgement = '重複済み';
            policy = '重複として除外';
            messages.push('同一支払・同一宛名の管理記録あり: ' + text_(existingPdf.status));
          }
        } else if (existingPayment) {
          judgement = '確認必要';
          requiresManual = true;
          policy = text_(old['処理方針'] || '');
          messages.push('同一支払に別宛名のPDFがあります。新規発行するか除外するか人工確認が必要');
        }

        if (text_(old.sourceHash) && text_(old.sourceHash) !== sourceHash) {
          judgement = '確認必要';
          requiresManual = true;
          messages.push('前回CHECK後にFormまたはPW元データが変わりました。再確認が必要');
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
          existing: existingPdf || null,
          preserveConfirmation: oldStillConfirmed
        }));
      });
    });
    return output;
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
    const status = text_(existing.status || old['ファイル状態']);
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
      existing['領収書No'] || old['領収書No'] || '',
      existing.PDF_FILE_ID || old.PDF_FILE_ID || '', existing.PDF_URL || old.PDF_URL || '',
      status, existing['Draft ID'] || old['Draft ID'] || '',
      text_(existing.status).includes('下書き') ? existing.status : old['草稿ステータス'] || '',
      false, text_(existing.status) === '送信済み' ? '送信済み' : old['送信ステータス'] || '',
      existing['メール送信日時'] || old['送信日時'] || ''
    ];
  }

  function confirmReceiptCheck() {
    const lock = LockService.getDocumentLock();
    lock.waitLock(30000);
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = requiredSheet_(ss, CONFIG.CHECK_SHEET);
      const settings = readSettings_(ss);
      const rows = readObjects_(sheet);
      const errors = [];
      let confirmed = 0;
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
            eventName: data.eventName,
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
      assertReceiptBatchConfirmed_(ss, sheet);
      const rows = readObjects_(sheet);
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
    const lock = LockService.getDocumentLock();
    lock.waitLock(30000);
    try {
      const startedAt = Date.now();
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const settings = readSettings_(ss);
      validateGenerationSettings_(settings);
      const sheet = requiredSheet_(ss, CONFIG.CHECK_SHEET);
      const ledgerSheet = requiredSheet_(ss, CONFIG.LEDGER_SHEET);
      assertReceiptBatchConfirmed_(ss, sheet);
      const folder = getFolder_(settings.RECEIPT_FOLDER_URL);
      const ledgerMap = buildLedgerMap_(readObjects_(ledgerSheet));
      const maxFiles = positiveIntegerSetting_(settings.MAX_RECEIPTS_PER_RUN, 20);
      const maxSeconds = positiveIntegerSetting_(settings.MAX_EXECUTION_SECONDS, 240);
      const rows = readObjects_(sheet);
      let generated = 0;
      let reused = 0;
      let errors = 0;
      let stoppedByTime = false;

      for (let index = 0; index < rows.length; index++) {
        if (generated + reused >= maxFiles) break;
        if ((Date.now() - startedAt) / 1000 >= maxSeconds) {
          stoppedByTime = true;
          break;
        }
        const row = rows[index];
        const rowNo = index + 2;
        if (text_(row['処理方針']) !== '新規発行') continue;
        if (text_(row.PDF_FILE_ID)) continue;
        const receiptNo = text_(row['領収書No']);
        if (!receiptNo) continue;

        try {
          const data = receiptDataFromCheckRow_(row, settings);
          data.receiptNo = receiptNo;
          const paymentKey = makePaymentKey_({
            gameId: data.gameId, eventName: data.eventName, tournament: data.tournament,
            purchaseTime: data.purchaseTime, type: data.type, total: data.total
          });
          const pdfKey = makePdfKey_(paymentKey, data.recipient);
          if (paymentKey !== text_(row.paymentKey)) throw new Error('paymentKeyがCHECK確定時から変化しています');

          let file = null;
          let existing = ledgerMap.byPdfKey[pdfKey];
          if (existing && text_(existing.PDF_FILE_ID)) {
            if (text_(existing['領収書No']) && text_(existing['領収書No']) !== receiptNo) {
              throw new Error('同じpdfKeyの既存領収書番号が今回の採番と一致しません');
            }
            file = DriveApp.getFileById(text_(existing.PDF_FILE_ID));
            reused++;
          } else {
            file = findSingleFileByName_(folder, makeReceiptFileName_(data, settings));
            if (file) reused++;
          }

          setHeaderValue_(sheet, CHECK_HEADERS, rowNo, 'ファイル状態', '生成中');
          SpreadsheetApp.flush();

          if (!file) {
            const fileName = makeReceiptFileName_(data, settings);
            file = folder.createFile(makeReceiptPdfBlob_(data, settings).setName(fileName)).setName(fileName);
            generated++;
          }

          if (!existing) {
            appendLedger_(ledgerSheet, {
              pdfKey, paymentKey, receiptNo, data, file,
              status: 'PDF作成済み', applicationKey: text_(row['申請キー']), note: 'RSE実験版'
            });
            existing = {
              pdfKey, paymentKey, '領収書No': receiptNo, 'メールアドレス': data.email,
              PDF_FILE_ID: file.getId(), PDF_URL: file.getUrl(), status: 'PDF作成済み'
            };
            ledgerMap.byPdfKey[pdfKey] = existing;
            if (!ledgerMap.byPaymentKey[paymentKey]) ledgerMap.byPaymentKey[paymentKey] = existing;
          }

          setHeaderValue_(sheet, CHECK_HEADERS, rowNo, 'pdfKey', pdfKey);
          setHeaderValue_(sheet, CHECK_HEADERS, rowNo, 'PDF_FILE_ID', file.getId());
          setHeaderValue_(sheet, CHECK_HEADERS, rowNo, 'PDF_URL', file.getUrl());
          setHeaderValue_(sheet, CHECK_HEADERS, rowNo, 'ファイル状態', 'PDF作成済み');
        } catch (error) {
          errors++;
          setHeaderValue_(sheet, CHECK_HEADERS, rowNo, 'ファイル状態', '生成エラー');
          setHeaderValue_(sheet, CHECK_HEADERS, rowNo, '確認内容', error.message || String(error));
        }
      }

      const pending = readObjects_(sheet).filter(row =>
        text_(row['処理方針']) === '新規発行' && text_(row['領収書No']) && !text_(row.PDF_FILE_ID)
      ).length;
      alert_(
        '未生成PDF処理が完了しました。\n\n新規生成: ' + generated +
        '\n既存/中断ファイル再利用: ' + reused + '\nエラー: ' + errors +
        '\n残り: ' + pending + (stoppedByTime ? '\n自主停止時間に達したため、再度同じボタンを実行してください。' : '')
      );
    } finally {
      lock.releaseLock();
    }
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
      assertReceiptBatchConfirmed_(ss, sheet);
      const rows = readCheckObjects_(sheet).filter(row => text_(row['処理方針']) === '新規発行');
      const groups = groupCheckRowsForDraft_(rows);
      const maxDrafts = positiveIntegerSetting_(settings.MAX_DRAFTS_PER_SEND, 20);
      const maxSeconds = positiveIntegerSetting_(settings.MAX_EXECUTION_SECONDS, 240);
      let created = 0;
      let incomplete = 0;
      let errors = 0;
      let stoppedByTime = false;
      let draftRecoveryMap = null;

      for (const groupKey of Object.keys(groups)) {
        if (created >= maxDrafts) break;
        if ((Date.now() - startedAt) / 1000 >= maxSeconds) {
          stoppedByTime = true;
          break;
        }
        const group = groups[groupKey];
        if (group.every(row => text_(row['Draft ID']))) continue;
        if (group.some(row => !text_(row.PDF_FILE_ID))) {
          incomplete++;
          continue;
        }
        let draftMayExist = false;
        try {
          const emails = uniqueStrings_(group.map(row => text_(row['メールアドレス']).toLowerCase()));
          if (emails.length !== 1 || !validEmail_(emails[0])) throw new Error('同一申請内のメールアドレスが一致しません');
          const items = group.map(row => {
            const data = receiptDataFromCheckRow_(row, settings);
            data.receiptNo = text_(row['領収書No']);
            return {
              rowNo: row.__rowNo, pdfKey: text_(row.pdfKey), paymentKey: text_(row.paymentKey),
              receiptNo: data.receiptNo, file: DriveApp.getFileById(text_(row.PDF_FILE_ID)), data
            };
          });
          const draftKey = makeDraftKey_(items);
          const existingDraftIds = uniqueStrings_(group.map(row => text_(row['Draft ID'])));
          if (existingDraftIds.length > 1) throw new Error('同一申請内に複数のDraft IDがあります');
          const recovering = group.some(row => text_(row['草稿ステータス']) === '草稿作成中');
          group.forEach(row => writeCheckStatus_(sheet, row.__rowNo, '草稿作成中', ''));
          SpreadsheetApp.flush();

          let draft = existingDraftIds.length ? GmailApp.getDraft(existingDraftIds[0]) : null;
          if (!draft && recovering) {
            if (!draftRecoveryMap) draftRecoveryMap = buildDraftRecoveryMap_();
            draft = draftRecoveryMap[draftKey] || null;
          }
          if (!draft) draft = createDraftForPreparedItems_(items, settings, draftKey);
          draftMayExist = true;
          const draftId = draft.getId();
          if (draftRecoveryMap) draftRecoveryMap[draftKey] = draft;
          const draftTo = draftRecipient_(items[0].data, settings);
          items.forEach(item => {
            updateCheckDraft_(sheet, item.rowNo, draftId, '下書き作成済み');
            updateLedgerDraft_(ledgerSheet, item.pdfKey, draftId, draftTo, '下書き作成済み');
          });
          created++;
        } catch (error) {
          errors++;
          const message = error.message || String(error);
          group.forEach(row => {
            if (draftMayExist) writeCheckStatus_(sheet, row.__rowNo, '草稿作成中', message);
            else writeCheckError_(sheet, row.__rowNo, message);
          });
        }
      }

      const pending = readObjects_(sheet).filter(row =>
        text_(row['処理方針']) === '新規発行' && text_(row.PDF_FILE_ID) && !text_(row['Draft ID'])
      ).length;
      alert_(
        '未作成Gmail草稿処理が完了しました。\n\n作成: ' + created + '通\n未完成申請: ' + incomplete +
        '\nエラー: ' + errors + '\n草稿未作成明細: ' + pending +
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
      assertReceiptBatchConfirmed_(ss, checkSheet);
      const rows = readCheckObjects_(checkSheet);
      const draftGroups = {};

      rows.forEach(row => {
        const draftId = text_(row['Draft ID']);
        if (!draftId || text_(row['送信ステータス']) === '送信済み') return;
        if (!draftGroups[draftId]) draftGroups[draftId] = [];
        draftGroups[draftId].push(row);
      });

      const approvedDraftIds = Object.keys(draftGroups).filter(draftId => {
        return draftGroups[draftId].every(row => isOn_(row['送信OK']));
      });

      if (!approvedDraftIds.length) {
        throw new Error('全添付行で送信OKになっているGmail草稿がありません。');
      }

      const settings = readSettings_(ss);
      const maxDrafts = positiveIntegerSetting_(settings.MAX_DRAFTS_PER_SEND, 20);
      if (approvedDraftIds.length > maxDrafts) {
        throw new Error(
          '承認済み草稿が1回の送信上限を超えています。\n' +
          '承認済み: ' + approvedDraftIds.length + '通 / 上限: ' + maxDrafts + '通'
        );
      }

      let sentDrafts = 0;
      let sentReceipts = 0;
      let errors = 0;

      approvedDraftIds.forEach(draftId => {
        const group = draftGroups[draftId];
        try {
          const draft = GmailApp.getDraft(draftId);
          if (!draft) throw new Error('Gmail下書きが見つかりません: ' + draftId);
          group.forEach(row => {
            setCheckValue_(checkSheet, row.__rowNo, '送信ステータス', '送信処理中');
            updateLedgerStatus_(ledgerSheet, text_(row.pdfKey), '送信処理中', 'Gmail送信開始');
          });
          draft.send();
          const sentAt = new Date();
          sentDrafts++;
          sentReceipts += group.length;

          group.forEach(row => {
            updateCheckSent_(checkSheet, row.__rowNo, sentAt);
            updateLedgerSent_(ledgerSheet, text_(row.pdfKey), sentAt);
          });
        } catch (error) {
          errors++;
          const message = error.message || String(error);
          group.forEach(row => {
            writeCheckSendError_(checkSheet, row.__rowNo, message);
            updateLedgerStatus_(ledgerSheet, text_(row.pdfKey), '送信確認必要', message);
          });
        }
      });

      alert_(
        '承認済み草稿の送信処理が完了しました。\n\n' +
        '送信メール: ' + sentDrafts + '\n' +
        '領収書: ' + sentReceipts + '\n' +
        'エラー: ' + errors
      );
    } finally {
      lock.releaseLock();
    }
  }


  function readApplications_(sheet, settings) {
    const table = readTable_(sheet);
    const indexes = aliasIndexes_(table.headers, FORM_ALIASES, ['gameId', 'name', 'email']);
    const groups = {};
    const invalid = [];

    table.rows.forEach((row, index) => {
      const rowNo = index + 2;
      const rawEventName = valueAt_(row, indexes.eventName);
      const formEventFilter = text_(settings.FORM_EVENT_FILTER);
      if (formEventFilter && rawEventName && !sameEvent_(rawEventName, formEventFilter)) return;

      const app = {
        rowNo,
        timestamp: valueAt_(row, indexes.timestamp),
        gameId: normalizeGameId_(valueAt_(row, indexes.gameId)),
        name: text_(valueAt_(row, indexes.name)),
        email: text_(valueAt_(row, indexes.email)).toLowerCase(),
        recipient: removeSama_(valueAt_(row, indexes.recipient)),
        eventName: text_(rawEventName || settings.EVENT_NAME)
      };
      app.applicationKey = makeApplicationKey_(app);

      const errors = [];
      if (!app.gameId) errors.push('Game IDが不正または空白');
      if (!app.name) errors.push('本名が空白');
      if (!validEmail_(app.email)) errors.push('メールアドレスが不正');
      if (indexes.eventName >= 0 && formEventFilter && !text_(rawEventName)) {
        errors.push('対象イベントが空白');
      }

      if (errors.length) {
        invalid.push({ application: app, message: 'Form ' + rowNo + '行: ' + errors.join(' / ') });
        return;
      }

      if (!groups[app.gameId]) groups[app.gameId] = [];
      groups[app.gameId].push(app);
    });

    const byGameId = {};
    Object.keys(groups).forEach(gameId => {
      const applications = groups[gameId];
      const profiles = uniqueStrings_(applications.map(app => {
        const parts = [compact_(app.name), app.email.toLowerCase(), compact_(app.recipient)];
        if (text_(settings.FORM_EVENT_FILTER)) parts.push(compact_(app.eventName));
        return parts.join('|');
      }));
      const latest = applications[applications.length - 1];
      const conflict = profiles.length > 1;

      byGameId[gameId] = {
        application: latest,
        applications,
        conflict,
        duplicateExactCount: applications.length,
        message: conflict
          ? '同一Game IDに本名・メール・宛名・イベントが異なるForm回答があります。対象回答を1件に整理してください'
          : ''
      };
    });

    return { byGameId, invalid };
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
      if (!dateInRange_(pw, settings.DATE_FROM, settings.DATE_TO)) errors.push('設定した対象日範囲外');

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
    const originalTo = first.email;
    const testMode = isOn_(settings.TEST_MODE);
    const to = draftRecipient_(first, settings);
    if (!validEmail_(to)) throw new Error('下書き宛先メールアドレスが不正です: ' + to);

    const subject = (testMode ? '[EXP TEST] ' : '') + text_(settings.SUBJECT || '電子領収書の送付について');
    const body = buildMailBody_(
      first.name,
      settings.EVENT_LABEL || first.eventName,
      items.length,
      testMode ? originalTo : ''
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

  function draftRecipient_(data, settings) {
    return isOn_(settings.TEST_MODE) ? text_(settings.TEST_EMAIL) : text_(data.email).toLowerCase();
  }

  function receiptDataFromCheckRow_(row, settings) {
    const total = money_(row['総金額']);
    const tax = Math.floor(total / 11);
    return {
      gameId: normalizeGameId_(row['Game ID']),
      name: text_(row['本名']),
      email: text_(row['メールアドレス']).toLowerCase(),
      recipient: removeSama_(row['宛名']),
      eventName: text_(row.eventName || settings.EVENT_NAME),
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

  function buildMailBody_(name, eventName, count, originalTo) {
    const testNotice = originalTo
      ? '【実験モード】本来の送信先: ' + originalTo + '\n\n'
      : '';
    const addressee = text_(name) ? text_(name) + ' 様' : 'お客様';
    const eventLabel = formatEventLabel_(eventName);
    return testNotice + `${addressee}

平素よりお世話になっております。
ジャパンオープンポーカーツアー株式会社カスタマーサポートのショウです。

この度は${eventLabel}にご参加いただき、誠にありがとうございました。

電子領収書を${count}件発行いたしましたので、添付にてお送りいたします。
なお、電子チケットおよび選手契約履行によるエントリーにつきましては、領収書の発行対象外となっております。

ご不明点やご質問などがございましたら、本メールへのご返信にてお気軽にお問い合わせください。
今後ともどうぞよろしくお願いいたします。`;
  }

  function makeReceiptPdfBlob_(data, settings) {
    const html = buildReceiptHtml_(data, settings);
    return Utilities.newBlob(html, 'text/html', 'receipt.html').getAs(MimeType.PDF);
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
    const label = formatEventLabel_(settings.EVENT_LABEL || data.eventName || settings.EVENT_NAME);
    const name = data.name ? data.name + ' 様' : 'お客様';
    return sanitizeFileName_(label + ' 領収書_' + name + '-' + data.receiptNo + '.pdf');
  }

  function appendLedger_(sheet, item) {
    const d = item.data;
    sheet.appendRow([
      item.pdfKey, item.paymentKey, item.receiptNo, d.gameId, d.name, d.email,
      d.recipient, d.eventName, d.tournament, d.purchaseTime, d.type, d.total,
      item.file.getId(), item.file.getUrl(), '', '', '', '', item.status,
      item.applicationKey, item.note || ''
    ]);
  }


  function buildLedgerMap_(rows) {
    const byPdfKey = {};
    const byPaymentKey = {};

    rows.forEach(row => {
      const status = text_(row.status);
      if (CONFIG.INACTIVE_LEDGER_STATUSES.indexOf(status) >= 0) return;
      const pdfKey = text_(row.pdfKey);
      const paymentKey = text_(row.paymentKey);
      if (pdfKey) byPdfKey[pdfKey] = row;
      if (paymentKey && !byPaymentKey[paymentKey]) byPaymentKey[paymentKey] = row;
    });

    return { byPdfKey, byPaymentKey };
  }

  function updateLedgerDraft_(sheet, pdfKey, draftId, draftTo, status) {
    updateLedgerByPdfKey_(sheet, pdfKey, row => {
      row['Draft ID'] = draftId;
      row['草稿作成日時'] = new Date();
      row['送信先'] = draftTo;
      row.status = status;
    });
  }

  function updateLedgerSent_(sheet, pdfKey, sentAt) {
    updateLedgerByPdfKey_(sheet, pdfKey, row => {
      row['メール送信日時'] = sentAt;
      row.status = '送信済み';
    });
  }

  function updateLedgerStatus_(sheet, pdfKey, status, note) {
    updateLedgerByPdfKey_(sheet, pdfKey, row => {
      row.status = status;
      row['備考'] = note || row['備考'];
    });
  }

  function updateLedgerByPdfKey_(sheet, pdfKey, mutator) {
    if (!pdfKey || sheet.getLastRow() < 2) return;
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(text_);
    const keyCol = headers.indexOf('pdfKey');
    for (let r = values.length - 1; r >= 1; r--) {
      if (text_(values[r][keyCol]) !== pdfKey) continue;
      const obj = {};
      headers.forEach((header, index) => { obj[header] = values[r][index]; });
      mutator(obj);
      headers.forEach((header, index) => { values[r][index] = obj[header]; });
      sheet.getRange(r + 1, 1, 1, headers.length).setValues([values[r]]);
      return;
    }
  }


  function readCheckObjects_(sheet) {
    return readObjects_(sheet).map((row, index) => Object.assign(row, { __rowNo: index + 2 }));
  }


  function updateCheckDraft_(sheet, rowNo, draftId, status) {
    setCheckValue_(sheet, rowNo, 'Draft ID', draftId);
    setCheckValue_(sheet, rowNo, '草稿ステータス', status);
    setCheckValue_(sheet, rowNo, '確認内容', '');
  }

  function updateCheckSent_(sheet, rowNo, sentAt) {
    setCheckValue_(sheet, rowNo, '送信ステータス', '送信済み');
    setCheckValue_(sheet, rowNo, '送信日時', sentAt);
    setCheckValue_(sheet, rowNo, '確認内容', '');
  }

  function writeCheckError_(sheet, rowNo, message) {
    setCheckValue_(sheet, rowNo, '草稿ステータス', 'エラー');
    setCheckValue_(sheet, rowNo, '確認内容', message);
  }

  function writeCheckStatus_(sheet, rowNo, status, message) {
    setCheckValue_(sheet, rowNo, '草稿ステータス', status);
    setCheckValue_(sheet, rowNo, '確認内容', message);
  }

  function writeCheckSendError_(sheet, rowNo, message) {
    setCheckValue_(sheet, rowNo, '送信ステータス', '送信確認必要');
    setCheckValue_(sheet, rowNo, '確認内容', message);
  }

  function setCheckValue_(sheet, rowNo, header, value) {
    const column = CHECK_HEADERS.indexOf(header) + 1;
    if (column < 1) throw new Error('RSE_CHECK列が定義されていません: ' + header);
    sheet.getRange(rowNo, column).setValue(value);
  }

  function groupCheckRowsForDraft_(rows) {
    const groups = {};
    rows.forEach(row => {
      const key = [
        text_(row['メールアドレス']).toLowerCase(),
        compact_(row['本名']) || normalizeGameId_(row['Game ID'])
      ].join('|');
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
    });
    return groups;
  }

  function validateGameIdSettings_(settings) {
    validateCheckSettings_(settings);
    if (!text_(settings.PW_DATE_RANGE)) {
      throw new Error('RSE_設定のPW_DATE_RANGEが空です');
    }
  }

  function parseSettingList_(value) {
    return uniqueStrings_(String(value || '')
      .split(/[\r\n,、]+/)
      .map(text_)
      .filter(Boolean));
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

  function assertReceiptBatchConfirmed_(ss, sheet) {
    const rows = readObjects_(sheet);
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
      if (map[gameId]) {
        throw new Error('採用済みGame IDがCHECK内で重複しています: ' + gameId);
      }
      map[gameId] = {
        gameId,
        name: text_(row['確定本名']),
        email: text_(row['確定メールアドレス']).toLowerCase(),
        recipient: removeSama_(row['確定宛名']),
        eventName: text_(row.eventName),
        applicationKey: text_(row['申請キー'])
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

  function setHeaderValue_(sheet, headers, rowNo, header, value) {
    const column = headers.indexOf(header) + 1;
    if (column < 1) throw new Error('列が定義されていません: ' + header);
    sheet.getRange(rowNo, column).setValue(value);
  }

  function activeUserEmail_() {
    return text_(Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || 'unknown');
  }

  function showPwInputDialog_(dateRange, tsv, count) {
    const html = HtmlService.createHtmlOutput(
      '<div style="font-family:Arial,sans-serif;padding:12px">' +
      '<div style="margin-bottom:8px"><b>検索期間 / dateRange</b><br>' + escapeHtml_(dateRange) + '</div>' +
      '<div style="margin-bottom:6px"><b>Input: Game ID + 対象キーワード (' + count + '行)</b></div>' +
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
    Object.keys(applications).forEach(gameId => {
      const info = applications[gameId];
      if (!info || info.conflict) return;
      const raw = field === 'email'
        ? text_(info.application[field]).toLowerCase()
        : compact_(info.application[field]);
      if (!raw) return;
      if (!map[raw]) map[raw] = [];
      map[raw].push(gameId);
    });
    return map;
  }


  function makeApplicationKey_(app) {
    return [
      app.rowNo,
      app.gameId,
      compact_(app.timestamp),
      app.email,
      compact_(app.recipient),
      compact_(app.eventName)
    ].join('__');
  }

  function makePaymentKey_(data) {
    return [
      normalizeGameId_(data.gameId),
      compact_(data.eventName),
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
        existing[text_(row[0])] = true;
      });
    }
    SETTINGS_DEFAULTS.forEach(row => {
      if (!existing[row[0]]) sheet.appendRow(row);
    });
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
    validateCheckSettings_(settings);
    if (!text_(settings.RECEIPT_FOLDER_URL)) throw new Error('RSE_設定のRECEIPT_FOLDER_URLが空です');
    if (isOn_(settings.TEST_MODE) && !validEmail_(settings.TEST_EMAIL)) {
      throw new Error('TEST_MODE=ONですがTEST_EMAILが不正です');
    }
  }

  function validateCheckSettings_(settings) {
    if (!text_(settings.EVENT_NAME)) {
      throw new Error('RSE_設定のEVENT_NAMEが空です。対象イベントを明示してください');
    }
  }

  function positiveIntegerSetting_(value, fallback) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number > 0 ? number : fallback;
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

  function dateInRange_(pw, fromText, toText) {
    if (!fromText && !toText) return true;
    const iso = [pw.year, String(pw.month).padStart(2, '0'), String(pw.day).padStart(2, '0')].join('-');
    if (fromText && iso < fromText) return false;
    if (toText && iso > toText) return false;
    return true;
  }

  function sameEvent_(a, b) {
    return compact_(a) === compact_(b);
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
    if (!text) return '【EXP】';
    if (/^【.*】$/.test(text)) return text;
    return '【' + text.replace(/^【|】$/g, '') + '】';
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
    createPendingDrafts,
    sendApproved,
    _test: {
      normalizeGameId_, makePaymentKey_, makePdfKey_, money_, calcTotal_, compact_,
      hash_, parseSettingList_, gameIdFinalHash_, receiptFinalHash_, receiptBatchHash_,
      isGameIdCheckRowResolved_, isReceiptCheckRowResolved_, makeReceiptFileName_,
      makeReceiptCheckRow_, buildReceiptCheckRows_, groupCheckRowsForDraft_
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

function RSE_createPendingDrafts() {
  RSE.createPendingDrafts();
}

function RSE_sendApproved() {
  RSE.sendApproved();
}
