/**
 * 汎用メール送信ツール
 *
 * 必要シート:
 *   1. 送信データ
 *      - 「メールアドレス」だけが固定の必須入力列
 *      - その他の列は、件名・本文の {{列名}} として自由に使用可能
 *   2. メール本文
 *      - A1: 件名 / B1: 件名テンプレート
 *      - A2: 本文 / B2: 本文テンプレート
 *      - A3: 添付ファイル / B3: 共通添付のGoogle Drive URLまたはファイルID
 *        複数ファイルはB3内で改行して指定する。
 *
 * 送信は「下書き作成」→「送信OK」→「承認済み下書きを送信」の順で行う。
 */
const GENERIC_MAIL_CONFIG = {
  dataSheetName: '送信データ',
  contentSheetName: 'メール本文',

  emailHeader: 'メールアドレス',
  targetHeader: '送信対象',
  sendOkHeader: '送信OK',
  draftIdHeader: 'Draft ID',
  resultHeader: '処理結果',
  sentAtHeader: '送信日時',

  attachmentSetting: '添付ファイル',
  maxAttachmentCount: 250,
  maxTotalAttachmentBytes: 25 * 1024 * 1024,

  from: 'customer@japanopenpoker.com',
  senderName: 'JOPT',
  bcc: 'customer@japanopenpoker.com'
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('汎用メール')
    .addItem('初期シートを作成', 'setupGenericMailSheets')
    .addSeparator()
    .addItem('送信前チェック', 'checkGenericMailData')
    .addItem('Gmail下書きを作成', 'createGenericMailDrafts')
    .addItem('送信OKの下書きを送信', 'sendApprovedGenericMailDrafts')
    .addToUi();
}

/**
 * 初回用の2シートを作成する。既存データは上書きしない。
 */
function setupGenericMailSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = genericMailGetOrCreateSheet_(
    ss,
    GENERIC_MAIL_CONFIG.dataSheetName
  );
  const contentSheet = genericMailGetOrCreateSheet_(
    ss,
    GENERIC_MAIL_CONFIG.contentSheetName
  );

  if (dataSheet.getLastRow() === 0) {
    dataSheet.getRange(1, 1, 1, 5).setValues([[
      GENERIC_MAIL_CONFIG.emailHeader,
      GENERIC_MAIL_CONFIG.sendOkHeader,
      GENERIC_MAIL_CONFIG.draftIdHeader,
      GENERIC_MAIL_CONFIG.resultHeader,
      GENERIC_MAIL_CONFIG.sentAtHeader
    ]]);
    dataSheet.setFrozenRows(1);
  }

  if (contentSheet.getLastRow() === 0) {
    contentSheet.getRange('A1:B3').setValues([
      ['件名', ''],
      ['本文', ''],
      [GENERIC_MAIL_CONFIG.attachmentSetting, '']
    ]);
    contentSheet.setColumnWidth(1, 100);
    contentSheet.setColumnWidth(2, 600);
    contentSheet.getRange('B2').setWrap(true);
    contentSheet.getRange('B3').setWrap(true);
  } else {
    genericMailEnsureAttachmentSetting_(contentSheet);
  }

  SpreadsheetApp.getUi().alert(
    '初期設定完了',
    [
      '「送信データ」と「メール本文」を準備しました。',
      '',
      '送信データには、必要な差し込み列を自由に追加できます。',
      '例: 氏名、大会名、クーポンコード',
      '',
      'メール本文では {{氏名}} のように列名を指定してください。',
      '共通添付は「添付ファイル」にGoogle Drive URLまたはファイルIDを入力してください。',
      '複数ファイルはセル内で改行してください。'
    ].join('\n'),
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * 実際の送信や下書き作成をせず、対象行とエラーを確認する。
 */
function checkGenericMailData() {
  const queueData = genericMailBuildQueue_(false);
  const lines = [
    '送信対象: ' + queueData.targetCount + '件',
    '下書き作成可能: ' + queueData.queue.length + '件',
    '下書き作成済み: ' + queueData.draftExistsCount + '件',
    '送信済み: ' + queueData.sentCount + '件',
    '重複除外: ' + queueData.duplicateCount + '件',
    'エラー: ' + queueData.errors.length + '件',
    '共通添付: ' + queueData.attachments.names.length + '件' +
      '（' + genericMailFormatBytes_(queueData.attachments.totalBytes) + '）'
  ];

  if (queueData.attachments.names.length) {
    lines.push('', '添付ファイル:');
    queueData.attachments.names.forEach(function(name) {
      lines.push('・' + name);
    });
  }

  if (queueData.variables.length) {
    lines.push('', '使用変数: ' + queueData.variables.join(', '));
  }

  if (queueData.errors.length) {
    lines.push('', 'エラー詳細:');
    queueData.errors.slice(0, 15).forEach(function(item) {
      lines.push('行' + item.rowNumber + ': ' + item.message);
    });
    if (queueData.errors.length > 15) {
      lines.push('ほか ' + (queueData.errors.length - 15) + '件');
    }
  }

  SpreadsheetApp.getUi().alert(
    '送信前チェック',
    lines.join('\n'),
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * 送信対象行のGmail下書きを作成する。
 */
function createGenericMailDrafts() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    genericMailAssertSender_();
    genericMailEnsureOperationalHeaders_();

    const queueData = genericMailBuildQueue_(true);
    const resultColumn = queueData.headerMap[GENERIC_MAIL_CONFIG.resultHeader] + 1;
    const draftIdColumn = queueData.headerMap[GENERIC_MAIL_CONFIG.draftIdHeader] + 1;

    queueData.errors.forEach(function(item) {
      queueData.sheet
        .getRange(item.rowNumber, resultColumn)
        .setValue('エラー: ' + item.message);
    });
    queueData.duplicates.forEach(function(item) {
      queueData.sheet
        .getRange(item.rowNumber, resultColumn)
        .setValue('重複除外（行' + item.firstRowNumber + 'と同一）');
    });

    if (queueData.queue.length === 0) {
      SpreadsheetApp.getUi().alert(
        '作成対象なし',
        [
          '新しく下書きを作成できる行がありません。',
          'エラー: ' + queueData.errors.length + '件',
          '下書き作成済み: ' + queueData.draftExistsCount + '件',
          '送信済み: ' + queueData.sentCount + '件',
          '重複除外: ' + queueData.duplicateCount + '件'
        ].join('\n'),
        SpreadsheetApp.getUi().ButtonSet.OK
      );
      return;
    }

    const answer = SpreadsheetApp.getUi().alert(
      'Gmail下書き作成',
      [
        queueData.queue.length + '件の下書きを作成します。',
        '送信元: ' + GENERIC_MAIL_CONFIG.from,
        'BCC: ' + GENERIC_MAIL_CONFIG.bcc,
        '共通添付: ' + queueData.attachments.names.length + '件' +
          '（' + genericMailFormatBytes_(queueData.attachments.totalBytes) + '）',
        '',
        'よろしいですか？'
      ].join('\n'),
      SpreadsheetApp.getUi().ButtonSet.OK_CANCEL
    );

    if (answer !== SpreadsheetApp.getUi().Button.OK) {
      return;
    }

    let created = 0;
    let failed = 0;

    queueData.queue.forEach(function(item) {
      try {
        const draft = GmailApp.createDraft(
          item.email,
          item.subject,
          item.body,
          {
            from: GENERIC_MAIL_CONFIG.from,
            name: GENERIC_MAIL_CONFIG.senderName,
            bcc: GENERIC_MAIL_CONFIG.bcc,
            attachments: queueData.attachments.blobs
          }
        );

        queueData.sheet
          .getRange(item.rowNumber, draftIdColumn)
          .setValue(draft.getId());
        queueData.sheet
          .getRange(item.rowNumber, resultColumn)
          .setValue('下書き作成済み');
        created++;
      } catch (error) {
        queueData.sheet
          .getRange(item.rowNumber, resultColumn)
          .setValue('下書きエラー: ' + genericMailErrorMessage_(error));
        failed++;
      }
    });

    SpreadsheetApp.getUi().alert(
      '下書き作成完了',
      [
        '作成: ' + created + '件',
        '失敗: ' + failed + '件',
        '重複除外: ' + queueData.duplicateCount + '件',
        '事前チェックエラー: ' + queueData.errors.length + '件',
        '',
        'Gmailで内容を確認し、送信する行の「送信OK」に OK を入力してください。'
      ].join('\n'),
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } finally {
    lock.releaseLock();
  }
}

/**
 * 「送信OK」が入力された行の保存済みGmail下書きだけを送信する。
 */
function sendApprovedGenericMailDrafts() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const sheet = genericMailRequireSheet_(
      GENERIC_MAIL_CONFIG.dataSheetName
    );
    const headerData = genericMailReadHeaders_(sheet);
    const headerMap = headerData.headerMap;

    [
      GENERIC_MAIL_CONFIG.emailHeader,
      GENERIC_MAIL_CONFIG.sendOkHeader,
      GENERIC_MAIL_CONFIG.draftIdHeader,
      GENERIC_MAIL_CONFIG.resultHeader,
      GENERIC_MAIL_CONFIG.sentAtHeader
    ].forEach(function(header) {
      if (headerMap[header] === undefined) {
        throw new Error('必須列「' + header + '」が見つかりません。');
      }
    });

    if (sheet.getLastRow() <= headerData.headerRow) {
      throw new Error('送信データがありません。');
    }

    const values = sheet
      .getRange(
        headerData.headerRow + 1,
        1,
        sheet.getLastRow() - headerData.headerRow,
        sheet.getLastColumn()
      )
      .getDisplayValues();

    const approved = [];
    values.forEach(function(row, index) {
      const rowNumber = headerData.headerRow + 1 + index;
      const sendOk = row[headerMap[GENERIC_MAIL_CONFIG.sendOkHeader]];
      const draftId = String(
        row[headerMap[GENERIC_MAIL_CONFIG.draftIdHeader]] || ''
      ).trim();
      const result = String(
        row[headerMap[GENERIC_MAIL_CONFIG.resultHeader]] || ''
      ).trim();

      if (
        genericMailIsApproved_(sendOk) &&
        draftId &&
        result !== '送信済み'
      ) {
        approved.push({
          rowNumber: rowNumber,
          draftId: draftId
        });
      }
    });

    if (!approved.length) {
      SpreadsheetApp.getUi().alert(
        '送信対象なし',
        '「送信OK」が入力された未送信の下書きはありません。',
        SpreadsheetApp.getUi().ButtonSet.OK
      );
      return;
    }

    const answer = SpreadsheetApp.getUi().alert(
      'メール送信確認',
      [
        approved.length + '件のGmail下書きを送信します。',
        '',
        '送信後は取り消せません。よろしいですか？'
      ].join('\n'),
      SpreadsheetApp.getUi().ButtonSet.YES_NO
    );

    if (answer !== SpreadsheetApp.getUi().Button.YES) {
      return;
    }

    const resultColumn = headerMap[GENERIC_MAIL_CONFIG.resultHeader] + 1;
    const sentAtColumn = headerMap[GENERIC_MAIL_CONFIG.sentAtHeader] + 1;
    let sent = 0;
    let failed = 0;

    approved.forEach(function(item) {
      try {
        GmailApp.getDraft(item.draftId).send();
        sheet.getRange(item.rowNumber, resultColumn).setValue('送信済み');
        sheet.getRange(item.rowNumber, sentAtColumn).setValue(new Date());
        sent++;
      } catch (error) {
        sheet
          .getRange(item.rowNumber, resultColumn)
          .setValue('送信エラー: ' + genericMailErrorMessage_(error));
        failed++;
      }
    });

    SpreadsheetApp.getUi().alert(
      '送信処理完了',
      [
        '送信済み: ' + sent + '件',
        '失敗: ' + failed + '件'
      ].join('\n'),
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } finally {
    lock.releaseLock();
  }
}

function genericMailBuildQueue_(requireOperationalHeaders) {
  const sheet = genericMailRequireSheet_(
    GENERIC_MAIL_CONFIG.dataSheetName
  );
  const template = genericMailReadContent_();
  const attachments = genericMailReadAttachments_(template.attachmentSource);
  const headerData = genericMailReadHeaders_(sheet);
  const headers = headerData.headers;
  const headerMap = headerData.headerMap;

  if (headerMap[GENERIC_MAIL_CONFIG.emailHeader] === undefined) {
    throw new Error(
      '必須列「' + GENERIC_MAIL_CONFIG.emailHeader + '」が見つかりません。'
    );
  }

  if (requireOperationalHeaders) {
    [
      GENERIC_MAIL_CONFIG.draftIdHeader,
      GENERIC_MAIL_CONFIG.resultHeader,
      GENERIC_MAIL_CONFIG.sentAtHeader
    ].forEach(function(header) {
      if (headerMap[header] === undefined) {
        throw new Error('運用列「' + header + '」が見つかりません。');
      }
    });
  }

  const variables = genericMailExtractVariables_(
    template.subject + '\n' + template.body
  );
  const missingHeaders = variables.filter(function(variable) {
    return headerMap[variable] === undefined;
  });

  if (missingHeaders.length) {
    throw new Error(
      'テンプレートで使用している列が送信データにありません: ' +
      missingHeaders.join(', ')
    );
  }

  const result = {
    sheet: sheet,
    headerMap: headerMap,
    variables: variables,
    attachments: attachments,
    queue: [],
    errors: [],
    duplicates: [],
    targetCount: 0,
    draftExistsCount: 0,
    sentCount: 0,
    duplicateCount: 0
  };

  if (sheet.getLastRow() <= headerData.headerRow) {
    return result;
  }

  const values = sheet
    .getRange(
      headerData.headerRow + 1,
      1,
      sheet.getLastRow() - headerData.headerRow,
      sheet.getLastColumn()
    )
    .getDisplayValues();
  const seenMailKeys = {};

  values.forEach(function(row, index) {
    const rowNumber = headerData.headerRow + 1 + index;
    const email = genericMailNormalizeEmail_(
      row[headerMap[GENERIC_MAIL_CONFIG.emailHeader]]
    );
    const targetValue =
      headerMap[GENERIC_MAIL_CONFIG.targetHeader] === undefined
        ? Boolean(email)
        : row[headerMap[GENERIC_MAIL_CONFIG.targetHeader]];

    if (!genericMailIsTarget_(targetValue)) {
      return;
    }

    result.targetCount++;

    const rowData = {};
    headers.forEach(function(header, columnIndex) {
      rowData[header] = row[columnIndex];
    });

    const rowErrors = [];
    if (!genericMailIsValidEmail_(email)) {
      rowErrors.push('メールアドレスが不正です。');
    }

    const emptyVariables = variables.filter(function(variable) {
      return String(rowData[variable] || '').trim() === '';
    });
    if (emptyVariables.length) {
      rowErrors.push(
        '差し込み値が空です: ' + emptyVariables.join(', ')
      );
    }

    const subject = genericMailReplaceVariables_(
      template.subject,
      rowData
    );
    const body = genericMailReplaceVariables_(
      template.body,
      rowData
    );
    const mailKey = email + '\n' + subject + '\n' + body;

    const sentResult =
      headerMap[GENERIC_MAIL_CONFIG.resultHeader] === undefined
        ? ''
        : String(
          row[headerMap[GENERIC_MAIL_CONFIG.resultHeader]] || ''
        ).trim();
    if (sentResult === '送信済み') {
      if (!seenMailKeys[mailKey]) {
        seenMailKeys[mailKey] = rowNumber;
      }
      result.sentCount++;
      return;
    }

    const draftId =
      headerMap[GENERIC_MAIL_CONFIG.draftIdHeader] === undefined
        ? ''
        : String(
          row[headerMap[GENERIC_MAIL_CONFIG.draftIdHeader]] || ''
        ).trim();
    if (draftId) {
      if (!seenMailKeys[mailKey]) {
        seenMailKeys[mailKey] = rowNumber;
      }
      result.draftExistsCount++;
      return;
    }

    if (rowErrors.length) {
      result.errors.push({
        rowNumber: rowNumber,
        message: rowErrors.join(' ')
      });
      return;
    }

    if (seenMailKeys[mailKey]) {
      result.duplicates.push({
        rowNumber: rowNumber,
        firstRowNumber: seenMailKeys[mailKey]
      });
      result.duplicateCount++;
      return;
    }

    seenMailKeys[mailKey] = rowNumber;

    result.queue.push({
      rowNumber: rowNumber,
      email: email,
      subject: subject,
      body: body
    });
  });

  return result;
}

function genericMailReadContent_() {
  const sheet = genericMailRequireSheet_(
    GENERIC_MAIL_CONFIG.contentSheetName
  );
  const lastRow = Math.max(sheet.getLastRow(), 2);
  const values = sheet.getRange(1, 1, lastRow, 2).getDisplayValues();
  const settings = {};

  values.forEach(function(row) {
    const key = String(row[0] || '').trim();
    if (key) {
      settings[key] = String(row[1] || '');
    }
  });

  const subject = String(settings['件名'] || '').trim();
  const body = String(settings['本文'] || '');
  const attachmentSource = String(
    settings[GENERIC_MAIL_CONFIG.attachmentSetting] || ''
  );

  if (!subject) {
    throw new Error('「メール本文」シートの件名が空です。');
  }
  if (!body.trim()) {
    throw new Error('「メール本文」シートの本文が空です。');
  }

  return {
    subject: subject,
    body: body,
    attachmentSource: attachmentSource
  };
}

function genericMailEnsureAttachmentSetting_(sheet) {
  const lastRow = Math.max(sheet.getLastRow(), 1);
  const labels = sheet.getRange(1, 1, lastRow, 1).getDisplayValues();
  const exists = labels.some(function(row) {
    return String(row[0] || '').trim() ===
      GENERIC_MAIL_CONFIG.attachmentSetting;
  });

  if (exists) {
    return;
  }

  const targetRow = String(sheet.getRange('A3').getDisplayValue() || '').trim()
    ? sheet.getLastRow() + 1
    : 3;
  sheet.getRange(targetRow, 1).setValue(
    GENERIC_MAIL_CONFIG.attachmentSetting
  );
  sheet.getRange(targetRow, 2).setWrap(true);
}

function genericMailReadAttachments_(source) {
  const references = String(source || '')
    .split(/\r?\n/)
    .map(function(value) {
      return String(value || '').trim();
    })
    .filter(Boolean);
  const seenIds = {};
  const files = [];

  references.forEach(function(reference) {
    const parsed = genericMailParseDriveReference_(reference);
    if (seenIds[parsed.id]) {
      return;
    }
    seenIds[parsed.id] = true;

    try {
      const file = parsed.resourceKey
        ? DriveApp.getFileByIdAndResourceKey(parsed.id, parsed.resourceKey)
        : DriveApp.getFileById(parsed.id);
      const blob = genericMailCreateAttachmentBlob_(file);
      files.push({
        id: parsed.id,
        name: blob.getName() || file.getName(),
        blob: blob,
        size: blob.getBytes().length
      });
    } catch (error) {
      throw new Error(
        '添付ファイルを読み込めません: ' + reference + '（' +
        genericMailErrorMessage_(error) + '）'
      );
    }
  });

  if (files.length > GENERIC_MAIL_CONFIG.maxAttachmentCount) {
    throw new Error(
      '添付ファイルは最大' +
      GENERIC_MAIL_CONFIG.maxAttachmentCount + '件です。'
    );
  }

  const totalBytes = files.reduce(function(total, file) {
    return total + file.size;
  }, 0);
  if (totalBytes > GENERIC_MAIL_CONFIG.maxTotalAttachmentBytes) {
    throw new Error(
      '添付ファイルの合計サイズが25MBを超えています: ' +
      genericMailFormatBytes_(totalBytes)
    );
  }

  return {
    blobs: files.map(function(file) { return file.blob; }),
    names: files.map(function(file) { return file.name; }),
    ids: files.map(function(file) { return file.id; }),
    totalBytes: totalBytes
  };
}

function genericMailParseDriveReference_(reference) {
  const value = String(reference || '').trim();
  if (/^[A-Za-z0-9_-]{20,}$/.test(value)) {
    return { id: value, resourceKey: '' };
  }

  const idMatch = value.match(/\/d\/([A-Za-z0-9_-]{20,})/) ||
    value.match(/[?&]id=([A-Za-z0-9_-]{20,})/);
  if (!idMatch) {
    throw new Error(
      '添付ファイルにはGoogle Drive URLまたはファイルIDを指定してください: ' +
      value
    );
  }

  const resourceKeyMatch = value.match(/[?&]resourcekey=([^&#]+)/i);
  return {
    id: idMatch[1],
    resourceKey: resourceKeyMatch
      ? decodeURIComponent(resourceKeyMatch[1])
      : ''
  };
}

function genericMailCreateAttachmentBlob_(file) {
  const mimeType = file.getMimeType();
  const pdfMimeTypes = [
    MimeType.GOOGLE_DOCS,
    MimeType.GOOGLE_SHEETS,
    MimeType.GOOGLE_SLIDES,
    MimeType.GOOGLE_DRAWINGS
  ];

  if (pdfMimeTypes.indexOf(mimeType) !== -1) {
    return file
      .getAs(MimeType.PDF)
      .setName(file.getName() + '.pdf');
  }

  if (mimeType.indexOf('application/vnd.google-apps.') === 0) {
    throw new Error(
      'このGoogle Driveファイル形式は添付できません: ' + file.getName()
    );
  }

  return file.getBlob().setName(file.getName());
}

function genericMailFormatBytes_(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) {
    return value + ' B';
  }
  if (value < 1024 * 1024) {
    return (value / 1024).toFixed(1) + ' KB';
  }
  return (value / 1024 / 1024).toFixed(1) + ' MB';
}

function genericMailExtractVariables_(text) {
  const variables = [];
  const seen = {};
  const pattern = /{{\s*([^{}]+?)\s*}}/g;
  let match;

  while ((match = pattern.exec(String(text || ''))) !== null) {
    const variable = String(match[1] || '').trim();
    if (variable && !seen[variable]) {
      seen[variable] = true;
      variables.push(variable);
    }
  }

  return variables;
}

function genericMailReplaceVariables_(text, rowData) {
  return String(text || '').replace(
    /{{\s*([^{}]+?)\s*}}/g,
    function(match, variableName) {
      const key = String(variableName || '').trim();
      return rowData[key] === undefined || rowData[key] === null
        ? ''
        : String(rowData[key]);
    }
  );
}

function genericMailReadHeaders_(sheet) {
  if (sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) {
    throw new Error('「送信データ」シートに表頭がありません。');
  }

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(function(value) {
      return String(value || '').trim();
    });
  const headerMap = {};

  headers.forEach(function(header, index) {
    if (!header) {
      return;
    }
    if (headerMap[header] !== undefined) {
      throw new Error('表頭「' + header + '」が重複しています。');
    }
    headerMap[header] = index;
  });

  return {
    headerRow: 1,
    headers: headers,
    headerMap: headerMap
  };
}

function genericMailEnsureOperationalHeaders_() {
  const sheet = genericMailRequireSheet_(
    GENERIC_MAIL_CONFIG.dataSheetName
  );
  const headerData = genericMailReadHeaders_(sheet);
  const required = [
    GENERIC_MAIL_CONFIG.sendOkHeader,
    GENERIC_MAIL_CONFIG.draftIdHeader,
    GENERIC_MAIL_CONFIG.resultHeader,
    GENERIC_MAIL_CONFIG.sentAtHeader
  ];
  let nextColumn = sheet.getLastColumn() + 1;

  required.forEach(function(header) {
    if (headerData.headerMap[header] === undefined) {
      sheet.getRange(1, nextColumn).setValue(header);
      nextColumn++;
    }
  });
}

function genericMailAssertSender_() {
  const from = GENERIC_MAIL_CONFIG.from.toLowerCase();
  const effectiveUser = String(
    Session.getEffectiveUser().getEmail() || ''
  ).toLowerCase();
  const aliases = GmailApp.getAliases().map(function(alias) {
    return String(alias || '').toLowerCase();
  });

  if (from !== effectiveUser && aliases.indexOf(from) === -1) {
    throw new Error(
      '送信元「' +
      GENERIC_MAIL_CONFIG.from +
      '」を現在のGmailアカウントで使用できません。'
    );
  }
}

function genericMailIsTarget_(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return value === true ||
    normalized === 'TRUE' ||
    normalized === '1' ||
    normalized === '送信' ||
    normalized === 'OK' ||
    normalized === '〇' ||
    normalized === '○';
}

function genericMailIsApproved_(value) {
  return genericMailIsTarget_(value);
}

function genericMailNormalizeEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function genericMailIsValidEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function genericMailGetOrCreateSheet_(ss, sheetName) {
  return ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
}

function genericMailRequireSheet_(sheetName) {
  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(sheetName);

  if (!sheet) {
    throw new Error(
      'シート「' +
      sheetName +
      '」が見つかりません。先に初期シートを作成してください。'
    );
  }

  return sheet;
}

function genericMailErrorMessage_(error) {
  return error && error.message ? error.message : String(error);
}
