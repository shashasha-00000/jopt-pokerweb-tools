/**
 * POKER＋サテライト入賞者のうち、付与確認結果が水色の行だけを
 * PokerWeb チケット付与ツール用 TSV に出力する。
 *
 * 初回:
 *   installPokerPlusTicketTsvMenu()
 *
 * 実行:
 *   buildPokerPlusTicketTsv()
 *
 * このスクリプトは TSV を生成するだけで、PokerWeb への付与は行わない。
 */

const PPT_CONFIG = {
  SOURCE_SHEET_NAME: '付与確認',
  OUTPUT_SHEET_NAME: 'POKER＋チケット付与TSV',
  HEADER_ROW: 1,
  GAME_ID_COLUMN: 7,
  UNIQUE_ID_COLUMN: 2,
  POKERPLUS_UNIQUE_ID_COLUMN: 3,
  COUNT_HEADER: 'count',
  MATCH_COLOR_CHECK_COLUMN: 2,
  MATCH_COLOR: '#00ffff',
  DONE_CHECK_COLUMN: null,
  MAIL_TARGET_COLUMN: 9,
  NAME_COLUMN: 5,
  FORM_RESPONSE_SHEET_NAME: 'フォームの回答 1',
  FORM_EMAIL_COLUMN: 2,
  FORM_UNIQUE_ID_COLUMN: 5,
  ISSUE_MAIL_FROM: 'customer@japanopenpoker.com',
  ISSUE_MAIL_FROM_NAME: 'JOPT カスタマーサポート',
  ISSUE_MAIL_SUBJECT: '【JOPT】POKER+サテライト通過チケット付与に関するご確認のお願い',
  OUTPUT_HEADERS: ['GameID', 'チケット名'],
  TICKET_NAME: '【オンライン】JOPT 2026 Tokyo #02 / Main Event / -2026.07.20'
};

function installPokerPlusTicketTsvMenu() {
  PPT_addMenu_();
  PPT_alert_(
    'メニュー「POKER＋チケットTSV」を追加しました。\n' +
    'Spreadsheet を再読み込みするとメニューが表示されます。'
  );
}

function onOpen() {
  PPT_addMenu_();
}

function PPT_addMenu_() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('POKER＋チケットTSV')
      .addItem('付与確認タブからTSV生成', 'buildPokerPlusTicketTsv')
      .addSeparator()
      .addItem('I列対象者のメール下書き作成', 'createPokerPlusGameIdIssueDrafts')
      .addToUi();
  } catch (error) {
    throw new Error(
      'Spreadsheet の UI を取得できません。対象 Google Sheet に紐づいた ' +
      'Apps Script プロジェクトから実行してください。'
    );
  }
}

function buildPokerPlusTicketTsv() {
  try {
    PPT_buildPokerPlusTicketTsv_();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error(error && error.stack ? error.stack : error);
    PPT_alert_('TSV 生成を停止しました。\n\n' + message);
    throw error;
  }
}

function createPokerPlusGameIdIssueDrafts() {
  try {
    PPT_createPokerPlusGameIdIssueDrafts_();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error(error && error.stack ? error.stack : error);
    PPT_alert_('メール下書き作成を停止しました。\n\n' + message);
    throw error;
  }
}

function PPT_createPokerPlusGameIdIssueDrafts_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Spreadsheet を取得できません。');

  const source = ss.getActiveSheet();
  if (!source || source.getName() !== PPT_CONFIG.SOURCE_SHEET_NAME) {
    throw new Error(
      '実行対象は「' + PPT_CONFIG.SOURCE_SHEET_NAME + '」タブのみです。' +
      '対象タブを開いてから再実行してください。'
    );
  }

  PPT_assertMailConfig_();

  const formSheet = ss.getSheetByName(PPT_CONFIG.FORM_RESPONSE_SHEET_NAME);
  if (!formSheet) {
    throw new Error('「' + PPT_CONFIG.FORM_RESPONSE_SHEET_NAME + '」タブが見つかりません。');
  }

  const sourceLastRow = source.getLastRow();
  const sourceLastColumn = source.getLastColumn();
  if (sourceLastRow <= PPT_CONFIG.HEADER_ROW) {
    throw new Error('付与確認タブにデータ行がありません。');
  }
  if (sourceLastColumn < Math.max(
    PPT_CONFIG.UNIQUE_ID_COLUMN,
    PPT_CONFIG.NAME_COLUMN,
    PPT_CONFIG.MAIL_TARGET_COLUMN
  )) {
    throw new Error('付与確認タブの列数が不足しています。');
  }

  const sourceDisplayValues = source
    .getRange(1, 1, sourceLastRow, sourceLastColumn)
    .getDisplayValues();

  const formLastRow = formSheet.getLastRow();
  const formRequiredColumn = Math.max(PPT_CONFIG.FORM_EMAIL_COLUMN, PPT_CONFIG.FORM_UNIQUE_ID_COLUMN);
  if (formLastRow <= PPT_CONFIG.HEADER_ROW || formSheet.getLastColumn() < formRequiredColumn) {
    throw new Error('フォーム回答タブに必要なデータまたは列がありません。');
  }

  const formDisplayValues = formSheet
    .getRange(1, 1, formLastRow, formSheet.getLastColumn())
    .getDisplayValues();
  const emailsByUniqueId = {};

  formDisplayValues.slice(PPT_CONFIG.HEADER_ROW).forEach((row, offset) => {
    const uniqueId = PPT_normalizeDigits_(row[PPT_CONFIG.FORM_UNIQUE_ID_COLUMN - 1]);
    const email = PPT_text_(row[PPT_CONFIG.FORM_EMAIL_COLUMN - 1]).toLowerCase();
    if (!uniqueId && !email) return;

    if (!uniqueId || !PPT_isValidEmail_(email)) return;
    if (emailsByUniqueId[uniqueId] && emailsByUniqueId[uniqueId] !== email) {
      throw new Error(
        'フォーム回答で固有識別番号 [' + uniqueId + '] に複数のメールアドレスがあります。'
      );
    }
    emailsByUniqueId[uniqueId] = email;
  });

  const targets = [];
  const errors = [];
  const targetEmails = {};

  sourceDisplayValues.slice(PPT_CONFIG.HEADER_ROW).forEach((row, offset) => {
    const sheetRow = PPT_CONFIG.HEADER_ROW + offset + 1;
    if (!PPT_text_(row[PPT_CONFIG.MAIL_TARGET_COLUMN - 1])) return;

    const uniqueId = PPT_normalizeDigits_(row[PPT_CONFIG.UNIQUE_ID_COLUMN - 1]);
    const name = PPT_text_(row[PPT_CONFIG.NAME_COLUMN - 1]);
    const email = emailsByUniqueId[uniqueId] || '';
    if (!uniqueId) {
      errors.push(sheetRow + '行目: 付与確認B列の固有識別番号が不正です。');
      return;
    }
    if (!email) {
      errors.push(sheetRow + '行目: フォーム回答からメールアドレスを特定できません。固有識別番号=[' + uniqueId + ']');
      return;
    }
    if (!name) {
      errors.push(sheetRow + '行目: 付与確認E列の氏名が空白です。');
      return;
    }
    if (targetEmails[email]) {
      errors.push(
        sheetRow + '行目: 同じメールアドレスが複数のGAME ID不備行にあります。最初の対象行=' +
        targetEmails[email] + '行目 / email=[' + email + ']'
      );
      return;
    }

    targetEmails[email] = sheetRow;
    targets.push({ sheetRow, email, name });
  });

  if (!targets.length && !errors.length) {
    throw new Error(PPT_CONFIG.MAIL_TARGET_COLUMN + '列目に文字がある対象行はありません。');
  }
  if (errors.length) {
    throw new Error(
      '安全のためメール下書きを作成しませんでした。\n\n' +
      errors.slice(0, 20).join('\n') +
      (errors.length > 20 ? '\n...ほか ' + (errors.length - 20) + ' 件' : '')
    );
  }

  const existingDraftKeys = {};
  GmailApp.getDrafts().forEach(draft => {
    const message = draft.getMessage();
    const to = PPT_text_(message.getTo()).toLowerCase();
    const subject = PPT_text_(message.getSubject());
    existingDraftKeys[to + '\n' + subject] = true;
  });

  const duplicates = targets.filter(target =>
    existingDraftKeys[target.email + '\n' + PPT_CONFIG.ISSUE_MAIL_SUBJECT]
  );
  if (duplicates.length) {
    throw new Error(
      '同じ宛先・件名の Gmail 下書きが既にあるため、安全のため停止しました。\n' +
      duplicates.slice(0, 20).map(target =>
        target.sheetRow + '行目: ' + target.email
      ).join('\n')
    );
  }

  const availableAliases = GmailApp.getAliases().map(alias => PPT_text_(alias).toLowerCase());
  if (!availableAliases.includes(PPT_CONFIG.ISSUE_MAIL_FROM.toLowerCase())) {
    throw new Error(
      '送信元メールアドレス [' + PPT_CONFIG.ISSUE_MAIL_FROM + '] は、' +
      '現在の Gmail アカウントで使用できる送信エイリアスではありません。'
    );
  }

  targets.forEach(target => {
    GmailApp.createDraft(
      target.email,
      PPT_CONFIG.ISSUE_MAIL_SUBJECT,
      PPT_buildIssueMailBody_(target.name),
      {
        from: PPT_CONFIG.ISSUE_MAIL_FROM,
        name: PPT_CONFIG.ISSUE_MAIL_FROM_NAME,
        bcc: PPT_CONFIG.ISSUE_MAIL_FROM
      }
    );
  });

  PPT_alert_(
    'I列対象者のメール下書きを作成しました。\n\n' +
    '作成件数: ' + targets.length + ' 件\n' +
    'Gmail の下書きを確認してから手動で送信してください。'
  );
}

function PPT_buildPokerPlusTicketTsv_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error(
      'Spreadsheet を取得できません。対象 Spreadsheet に紐づいた Apps Script から実行してください。'
    );
  }

  const source = ss.getActiveSheet();
  if (!source || source.getName() !== PPT_CONFIG.SOURCE_SHEET_NAME) {
    throw new Error(
      '実行対象は「' + PPT_CONFIG.SOURCE_SHEET_NAME + '」タブのみです。' +
      '対象タブを開いてから再実行してください。'
    );
  }

  PPT_assertConfig_();

  const lastRow = source.getLastRow();
  const lastColumn = source.getLastColumn();
  const requiredLastColumn = PPT_requiredLastColumn_();

  if (lastRow < PPT_CONFIG.HEADER_ROW) {
    throw new Error('ヘッダー行がありません。');
  }
  if (lastColumn < requiredLastColumn) {
    throw new Error(
      '列数が不足しています。最低 ' + requiredLastColumn + ' 列必要ですが、実際は ' +
      lastColumn + ' 列です。'
    );
  }

  const sourceRange = source.getRange(1, 1, lastRow, lastColumn);
  const values = sourceRange.getValues();
  const displayValues = sourceRange.getDisplayValues();
  const headers = values[PPT_CONFIG.HEADER_ROW - 1].map(PPT_text_);
  PPT_assertRequiredColumns_(headers);
  const countColumn = PPT_findUniqueHeaderColumn_(headers, PPT_CONFIG.COUNT_HEADER);

  const dataRowCount = lastRow - PPT_CONFIG.HEADER_ROW;
  const outputRows = [];
  const errors = [];
  const firstRowsByGameId = {};
  const colorCounts = {};
  let matchingColorRows = 0;
  let matchingUniqueIdRows = 0;

  if (dataRowCount > 0) {
    const matchColors = PPT_getDisplayBackgrounds_(
      source.getRange(
        PPT_CONFIG.HEADER_ROW + 1,
        PPT_CONFIG.MATCH_COLOR_CHECK_COLUMN,
        dataRowCount,
        1
      )
    );

    values.slice(PPT_CONFIG.HEADER_ROW).forEach((row, offset) => {
      const displayRow = displayValues[PPT_CONFIG.HEADER_ROW + offset];
      const sheetRow = PPT_CONFIG.HEADER_ROW + offset + 1;
      const color = PPT_normalizeColor_(matchColors[offset][0]);
      colorCounts[color || '(空白)'] = (colorCounts[color || '(空白)'] || 0) + 1;

      if (color !== PPT_normalizeColor_(PPT_CONFIG.MATCH_COLOR)) return;
      matchingColorRows++;
      if (PPT_CONFIG.DONE_CHECK_COLUMN &&
          PPT_isChecked_(row[PPT_CONFIG.DONE_CHECK_COLUMN - 1])) return;

      const formUniqueId = PPT_normalizeDigits_(displayRow[PPT_CONFIG.UNIQUE_ID_COLUMN - 1]);
      const pokerPlusUniqueId = PPT_normalizeDigits_(
        displayRow[PPT_CONFIG.POKERPLUS_UNIQUE_ID_COLUMN - 1]
      );
      if (!formUniqueId || !pokerPlusUniqueId) {
        errors.push(
          sheetRow + '行目: B列またはC列の固有識別番号が空白、または数字を確認できません。'
        );
        return;
      }
      if (formUniqueId !== pokerPlusUniqueId) {
        errors.push(
          sheetRow + '行目: B列とC列の固有識別番号が一致しません。' +
          'B=[' + formUniqueId + '] C=[' + pokerPlusUniqueId + ']'
        );
        return;
      }
      matchingUniqueIdRows++;

      const gameId = PPT_normalizeGameId_(displayRow[PPT_CONFIG.GAME_ID_COLUMN - 1]);
      if (!gameId) {
        errors.push(sheetRow + '行目: GameID が空白または不正です。8桁の数字である必要があります。');
        return;
      }

      if (firstRowsByGameId[gameId]) {
        errors.push(
          sheetRow + '行目: GameID [' + gameId + '] が重複しています。' +
          '最初の対象行は ' + firstRowsByGameId[gameId] + ' 行目です。'
        );
        return;
      }

      const ticketCount = PPT_parsePositiveInteger_(displayRow[countColumn - 1]);
      if (!ticketCount) {
        errors.push(
          sheetRow + '行目: count が空白または不正です。1以上の整数である必要があります。' +
          '実際=[' + PPT_text_(displayRow[countColumn - 1]) + ']'
        );
        return;
      }

      firstRowsByGameId[gameId] = sheetRow;
      for (let ticketNo = 0; ticketNo < ticketCount; ticketNo++) {
        outputRows.push([gameId, PPT_CONFIG.TICKET_NAME]);
      }
    });
  }

  if (errors.length) {
    throw new Error(
      '安全のため出力シートを更新しませんでした。\n\n' +
      errors.slice(0, 20).join('\n') +
      (errors.length > 20 ? '\n...ほか ' + (errors.length - 20) + ' 件' : '')
    );
  }

  const output = PPT_getOrCreateOutputSheet_(ss);
  output.clearContents();
  output.getRange('A:B').setNumberFormat('@');
  output.getRange(1, 1, 1, PPT_CONFIG.OUTPUT_HEADERS.length)
    .setValues([PPT_CONFIG.OUTPUT_HEADERS])
    .setFontWeight('bold')
    .setBackground('#d9ead3');

  if (outputRows.length) {
    output.getRange(2, 1, outputRows.length, PPT_CONFIG.OUTPUT_HEADERS.length)
      .setValues(outputRows);
  }

  output.setFrozenRows(1);
  output.autoResizeColumns(1, PPT_CONFIG.OUTPUT_HEADERS.length);
  ss.setActiveSheet(output);

  PPT_alert_(
    'POKER＋チケット付与 TSV を更新しました。\n\n' +
    '出力件数: ' + outputRows.length + ' 件\n' +
    '出力シート: ' + PPT_CONFIG.OUTPUT_SHEET_NAME + '\n\n' +
    '判定情報:\n' +
    '色確認列: ' + PPT_CONFIG.MATCH_COLOR_CHECK_COLUMN + '列目\n' +
    '設定した水色: ' + PPT_CONFIG.MATCH_COLOR + '\n' +
    '水色一致行: ' + matchingColorRows + ' 件\n' +
    '水色かつB/C一致行: ' + matchingUniqueIdRows + ' 件\n' +
    '読み取った色: ' + PPT_formatColorCounts_(colorCounts)
  );
}

function PPT_assertConfig_() {
  const positiveIntegerKeys = [
    'HEADER_ROW',
    'GAME_ID_COLUMN',
    'UNIQUE_ID_COLUMN',
    'POKERPLUS_UNIQUE_ID_COLUMN',
    'MATCH_COLOR_CHECK_COLUMN'
  ];

  positiveIntegerKeys.forEach(key => {
    const value = PPT_CONFIG[key];
    if (!Number.isInteger(value) || value < 1) {
      throw new Error('設定 ' + key + ' は 1 以上の整数にしてください。');
    }
  });

  if (PPT_CONFIG.DONE_CHECK_COLUMN !== null &&
      (!Number.isInteger(PPT_CONFIG.DONE_CHECK_COLUMN) || PPT_CONFIG.DONE_CHECK_COLUMN < 1)) {
    throw new Error('設定 DONE_CHECK_COLUMN は null または 1 以上の整数にしてください。');
  }

  if (!/^#[0-9a-f]{6}$/i.test(PPT_CONFIG.MATCH_COLOR)) {
    throw new Error('設定 MATCH_COLOR は #cfe2f3 のような6桁のカラーコードにしてください。');
  }

  if (!PPT_text_(PPT_CONFIG.COUNT_HEADER)) {
    throw new Error('設定 COUNT_HEADER を指定してください。');
  }
}

function PPT_assertMailConfig_() {
  const positiveIntegerKeys = [
    'HEADER_ROW',
    'UNIQUE_ID_COLUMN',
    'NAME_COLUMN',
    'MAIL_TARGET_COLUMN',
    'FORM_EMAIL_COLUMN',
    'FORM_UNIQUE_ID_COLUMN'
  ];

  positiveIntegerKeys.forEach(key => {
    const value = PPT_CONFIG[key];
    if (!Number.isInteger(value) || value < 1) {
      throw new Error('設定 ' + key + ' は 1 以上の整数にしてください。');
    }
  });

  if (!PPT_text_(PPT_CONFIG.FORM_RESPONSE_SHEET_NAME)) {
    throw new Error('設定 FORM_RESPONSE_SHEET_NAME を指定してください。');
  }
  if (!PPT_text_(PPT_CONFIG.ISSUE_MAIL_SUBJECT) ||
      !PPT_isValidEmail_(PPT_CONFIG.ISSUE_MAIL_FROM) ||
      !PPT_text_(PPT_CONFIG.ISSUE_MAIL_FROM_NAME)) {
    throw new Error('メール件名、送信元メールアドレス、送信者名を CONFIG に指定してください。');
  }
}

function PPT_buildIssueMailBody_(name) {
  return (
    name + ' 様\n\n' +
    'お世話になっております。\n' +
    'ジャパンオープンポーカーツアー株式会社 カスタマーサポートのショウと申します。\n\n' +
    'この度は、POKER+にて弊社開催のサテライトを通過されましたこと、誠におめでとうございます。\n\n' +
    '先日ご回答いただいたフォームに記載されたGame IDでは、PokerWebアカウントの確認が取れず、' +
    '現在チケットを付与できない状況となっております。\n\n' +
    'Game IDに誤りがある、またはPokerWeb上でJOPTクラブへの登録がお済みでない可能性がございます。\n\n' +
    'お手数をおかけいたしますが、正しいGame IDおよびJOPTクラブへの登録状況をご確認のうえ、' +
    '本メールへのご返信にて正しいGame IDをお送りいただけますと幸いです。\n\n' +
    '何卒よろしくお願いいたします。\n\n' +
    'ジャパンオープンポーカーツアー株式会社\n' +
    'カスタマーサポート'
  );
}

function PPT_requiredLastColumn_() {
  return Math.max(
    PPT_CONFIG.GAME_ID_COLUMN,
    PPT_CONFIG.UNIQUE_ID_COLUMN,
    PPT_CONFIG.POKERPLUS_UNIQUE_ID_COLUMN,
    PPT_CONFIG.MATCH_COLOR_CHECK_COLUMN,
    PPT_CONFIG.DONE_CHECK_COLUMN || 0
  );
}

function PPT_assertRequiredColumns_(headers) {
  const differences = [];
  const gameIdHeader = PPT_text_(headers[PPT_CONFIG.GAME_ID_COLUMN - 1]).replace(/\s+/g, '').toLowerCase();
  const uniqueIdHeader = PPT_text_(headers[PPT_CONFIG.UNIQUE_ID_COLUMN - 1]).replace(/\s+/g, '');
  const pokerPlusUniqueIdHeader = PPT_text_(
    headers[PPT_CONFIG.POKERPLUS_UNIQUE_ID_COLUMN - 1]
  ).replace(/\s+/g, '');

  if (gameIdHeader !== 'gameid') {
    differences.push(
      PPT_CONFIG.GAME_ID_COLUMN + '列目: GameID ヘッダーを確認できません。実際=[' +
      (headers[PPT_CONFIG.GAME_ID_COLUMN - 1] || '') + ']'
    );
  }

  if (!/固有.*識別.*番号|識別.*番号/.test(uniqueIdHeader)) {
    differences.push(
      PPT_CONFIG.UNIQUE_ID_COLUMN + '列目: 固有識別番号系のヘッダーを確認できません。実際=[' +
      (headers[PPT_CONFIG.UNIQUE_ID_COLUMN - 1] || '') + ']'
    );
  }

  if (!/固有.*識別.*番号|識別.*番号/.test(pokerPlusUniqueIdHeader)) {
    differences.push(
      PPT_CONFIG.POKERPLUS_UNIQUE_ID_COLUMN +
      '列目: POKER＋側の固有識別番号系ヘッダーを確認できません。実際=[' +
      (headers[PPT_CONFIG.POKERPLUS_UNIQUE_ID_COLUMN - 1] || '') + ']'
    );
  }

  if (differences.length) {
    throw new Error(
      '付与確認タブの列構造が想定と異なるため、安全のため停止しました。\n' +
      differences.join('\n')
    );
  }
}

function PPT_findUniqueHeaderColumn_(headers, expectedHeader) {
  const normalizedExpected = PPT_text_(expectedHeader).toLowerCase();
  const matches = [];

  headers.forEach((header, index) => {
    if (PPT_text_(header).toLowerCase() === normalizedExpected) {
      matches.push(index + 1);
    }
  });

  if (matches.length !== 1) {
    throw new Error(
      '付与確認タブの「' + expectedHeader + '」列を一意に確認できないため、安全のため停止しました。' +
      '該当列数=' + matches.length
    );
  }

  return matches[0];
}

function PPT_getDisplayBackgrounds_(range) {
  if (typeof range.getDisplayBackgrounds === 'function') {
    return range.getDisplayBackgrounds();
  }

  // getDisplayBackgrounds() 非対応環境では getBackgrounds() を使用する。
  // 条件付き書式の表示色を取得できない環境では、照合結果を値で持つ列へ切り替えること。
  return range.getBackgrounds();
}

function PPT_getOrCreateOutputSheet_(ss) {
  return ss.getSheetByName(PPT_CONFIG.OUTPUT_SHEET_NAME) ||
    ss.insertSheet(PPT_CONFIG.OUTPUT_SHEET_NAME);
}

function PPT_normalizeGameId_(value) {
  const digits = PPT_normalizeDigits_(value);
  return digits.length === 8 ? digits : '';
}

function PPT_normalizeDigits_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/[０-９]/g, digit => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0))
    .replace(/\D/g, '');
}

function PPT_parsePositiveInteger_(value) {
  const text = PPT_text_(value);
  if (!/^\d+$/.test(text)) return 0;

  const number = Number(text);
  return Number.isSafeInteger(number) && number >= 1 ? number : 0;
}

function PPT_isValidEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(PPT_text_(value));
}

function PPT_normalizeColor_(value) {
  return PPT_text_(value).toLowerCase();
}

function PPT_formatColorCounts_(colorCounts) {
  return Object.keys(colorCounts)
    .sort((a, b) => colorCounts[b] - colorCounts[a])
    .slice(0, 10)
    .map(color => color + '=' + colorCounts[color] + '件')
    .join(', ');
}

function PPT_isChecked_(value) {
  return value === true || String(value).trim().toUpperCase() === 'TRUE';
}

function PPT_text_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\u3000/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function PPT_alert_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (_) {
    console.log(message);
  }
}
