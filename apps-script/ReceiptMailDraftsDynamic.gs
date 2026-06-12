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
  SHEET_NAME: 'メール送信',

  // 対象行は ReceiptSemiAutoAppend.gs が保存した最新生成範囲を自動使用する。

  // ★ここにDriveフォルダURLを入れる
  RECEIPT_FOLDER_URLS: [
    'https://drive.google.com/drive/u/0/folders/1dpd9yrFXU3-5fYdTWGl-5MYK69UiG2Nd'
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


/**
 * 全表：下書き作成
 * まずこれを実行
 */
function createReceiptDraftsAllRows() {
  const sheet = receipt_getTargetSheet_();
  const folders = receipt_getReceiptFolders_();

  receipt_setupHeaders_(sheet);

  const targetRange = receipt_getLatestBatchRange_(sheet);
  const startRow = targetRange.startRow;
  const endRow = targetRange.endRow;
  receipt_showToast_('最新分の領収書ファイルを検索しています...', 'Gmail下書き作成');

  const duplicateNameSet = receipt_buildDuplicateNameSet_(sheet, startRow, endRow);
  const receiptFiles = receipt_buildReceiptFileListFromFolders_(folders);

  let createdCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (let row = startRow; row <= endRow; row++) {
    const result = receipt_createDraftForRow_(sheet, receiptFiles, duplicateNameSet, row);

    if (result === 'created') createdCount++;
    if (result === 'skipped') skippedCount++;
    if (result === 'error') errorCount++;

    Utilities.sleep(200);
  }

  Logger.log('全表 下書き作成完了');
  Logger.log('対象範囲: ' + startRow + '〜' + endRow + '行');
  Logger.log('作成: ' + createdCount + '件');
  Logger.log('スキップ: ' + skippedCount + '件');
  Logger.log('エラー: ' + errorCount + '件');

  receipt_showResult_(
    '最新分 Gmail下書き作成完了\n\n' +
    '対象行: ' + startRow + '〜' + endRow + '\n' +
    '作成: ' + createdCount + '件\n' +
    'スキップ: ' + skippedCount + '件\n' +
    'エラー: ' + errorCount + '件'
  );
}


/**
 * 全表：L列がOKの下書きだけ送信
 */
function sendApprovedReceiptDraftsAllRows() {
  const sheet = receipt_getTargetSheet_();

  const targetRange = receipt_getLatestBatchRange_(sheet);
  const startRow = targetRange.startRow;
  const endRow = targetRange.endRow;
  receipt_showToast_('最新分のL列「OK」を確認して送信しています...', 'Gmail送信');

  let sentCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (let row = startRow; row <= endRow; row++) {
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
      continue;
    }

    if (error !== '') {
      skippedCount++;
      continue;
    }

    if (!draftId) {
      skippedCount++;
      continue;
    }

    if (sendOk !== 'OK') {
      skippedCount++;
      continue;
    }

    if (sendStatus === '送信済み') {
      skippedCount++;
      continue;
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
  }

  Logger.log('全表 送信完了');
  Logger.log('対象範囲: ' + startRow + '〜' + endRow + '行');
  Logger.log('送信済み: ' + sentCount + '件');
  Logger.log('スキップ: ' + skippedCount + '件');
  Logger.log('送信エラー: ' + errorCount + '件');

  receipt_showResult_(
    '最新分 Gmail送信完了\n\n' +
    '対象行: ' + startRow + '〜' + endRow + '\n' +
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

  const targetRange = receipt_getLatestBatchRange_(sheet);
  const startRow = targetRange.startRow;
  const endRow = targetRange.endRow;

  Logger.log('=== 全表 送信対象チェック開始 ===');
  Logger.log('対象範囲: ' + startRow + '〜' + endRow + '行');

  for (let row = startRow; row <= endRow; row++) {
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

  Logger.log('=== 全表 送信対象チェック終了 ===');
}


/**
 * エラー行だけ再下書き作成
 * エラー修正後に使う
 */
function retryReceiptErrorRows() {
  const sheet = receipt_getTargetSheet_();
  const folders = receipt_getReceiptFolders_();

  receipt_setupHeaders_(sheet);

  const targetRange = receipt_getLatestBatchRange_(sheet);
  const startRow = targetRange.startRow;
  const endRow = targetRange.endRow;
  receipt_showToast_('最新分のエラー行を再処理しています...', 'Gmail下書き再作成');

  const duplicateNameSet = receipt_buildDuplicateNameSet_(sheet, startRow, endRow);
  const receiptFiles = receipt_buildReceiptFileListFromFolders_(folders);

  let createdCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (let row = startRow; row <= endRow; row++) {
    const draftStatus = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_DRAFT_STATUS).getValue() || '').trim();
    const error = String(sheet.getRange(row, RECEIPT_MAIL_CONFIG.COL_ERROR).getValue() || '').trim();

    if (draftStatus !== 'エラー' && !error) {
      skippedCount++;
      continue;
    }

    const result = receipt_createDraftForRow_(sheet, receiptFiles, duplicateNameSet, row);

    if (result === 'created') createdCount++;
    if (result === 'skipped') skippedCount++;
    if (result === 'error') errorCount++;

    Utilities.sleep(200);
  }

  Logger.log('エラー行 再下書き作成完了');
  Logger.log('対象範囲: ' + startRow + '〜' + endRow + '行');
  Logger.log('作成: ' + createdCount + '件');
  Logger.log('スキップ: ' + skippedCount + '件');
  Logger.log('エラー: ' + errorCount + '件');

  receipt_showResult_(
    '最新分 エラー行再処理完了\n\n' +
    '対象行: ' + startRow + '〜' + endRow + '\n' +
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
  const eventLabel = String(RECEIPT_MAIL_CONFIG.EVENT_LABEL || '').trim();

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
  const urls = RECEIPT_MAIL_CONFIG.RECEIPT_FOLDER_URLS || [];

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
 * 領収書_酒井慎吾 様-1.pdf
 */
function receipt_extractNameFromReceiptFileName_(fileName) {
  const text = receipt_normalizeUnicode_(String(fileName || ''));

  let match = text.match(/領収書_(.+?)\s*様\s*-\s*\d+/);
  if (match && match[1]) {
    return receipt_cleanExtractedName_(match[1]);
  }

  match = text.match(/領収書_(.+?)\s*様/);
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
  const sheet = ss.getSheetByName(RECEIPT_MAIL_CONFIG.SHEET_NAME);

  if (!sheet) {
    throw new Error('対象シートが見つかりません: ' + RECEIPT_MAIL_CONFIG.SHEET_NAME);
  }

  return sheet;
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


/**
 * 半自動生成で最後に追加したメール送信行だけを対象にする。
 * 行番号をコードへ手入力する必要はない。
 */
function receipt_getLatestBatchRange_(sheet) {
  const props = PropertiesService.getDocumentProperties();
  const startRow = Number(props.getProperty('RSA_LAST_MAIL_START_ROW') || 0);
  const rowCount = Number(props.getProperty('RSA_LAST_MAIL_ROW_COUNT') || 0);
  const lastRow = sheet.getLastRow();

  if (!Number.isInteger(startRow) || startRow < 2 ||
      !Number.isInteger(rowCount) || rowCount < 1) {
    throw new Error(
      '最新のメール送信対象行を取得できません。先に「書き出しデータ・メール送信生成」を実行してください。'
    );
  }

  const endRow = startRow + rowCount - 1;

  if (endRow > lastRow) {
    throw new Error(
      '保存された最新処理範囲がメール送信表の最終行を超えています。' +
      '先に「書き出しデータ・メール送信生成」を再実行してください。'
    );
  }

  return {
    startRow: startRow,
    endRow: endRow
  };
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
