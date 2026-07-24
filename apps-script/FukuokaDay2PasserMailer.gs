const FUKUOKA_DAY2_MAIL_CONFIG = {
  sourceSheetName: 'フォームの回答',
  templateSheetName: 'シート2',
  playerHeader: 'プレイヤーネーム',
  emailHeader: 'メールアドレス',
  bodyPlaceholder: '〇〇  様',
  from: 'customer@japanopenpoker.com',
  bcc: 'customer@japanopenpoker.com'
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Fukuoka Day2メール')
    .addItem('案内メールの下書きを作成', 'createFukuokaDay2PasserDrafts')
    .addToUi();
}

/**
 * フォーム回答者向けに Fukuoka Main Event Day2 案内メールの下書きを作成する。
 *
 * シート2:
 *   A1 = 件名
 *   A2 以降の A 列 = 本文
 *
 * フォームの回答:
 *   プレイヤーネーム = 宛名
 *   メールアドレス = 宛先
 *
 * 同名のメールアドレス列が複数ある場合は、各行の右端から
 * 最初に見つかった有効なメールアドレスを使用する。
 */
function createFukuokaDay2PasserDrafts() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ui = SpreadsheetApp.getUi();
    const sourceSheet = ss.getSheetByName(FUKUOKA_DAY2_MAIL_CONFIG.sourceSheetName);
    const templateSheet = ss.getSheetByName(FUKUOKA_DAY2_MAIL_CONFIG.templateSheetName);

    if (!sourceSheet) {
      throw new Error('シート「' + FUKUOKA_DAY2_MAIL_CONFIG.sourceSheetName + '」が見つかりません。');
    }
    if (!templateSheet) {
      throw new Error('シート「' + FUKUOKA_DAY2_MAIL_CONFIG.templateSheetName + '」が見つかりません。');
    }

    const template = fukuokaDay2ReadTemplate_(templateSheet);
    const recipients = fukuokaDay2ReadRecipients_(sourceSheet);

    if (recipients.valid.length === 0) {
      throw new Error('下書きを作成できる回答がありません。名前とメールアドレスを確認してください。');
    }

    const confirmMessage = [
      recipients.valid.length + '件のGmail下書きを作成します。',
      '',
      'From: ' + FUKUOKA_DAY2_MAIL_CONFIG.from,
      'BCC: ' + FUKUOKA_DAY2_MAIL_CONFIG.bcc,
      '件名: ' + template.subject,
      '',
      '同じ関数を再実行すると重複した下書きが作成されます。作成してよろしいですか？'
    ].join('\n');

    const answer = ui.alert('Fukuoka Day2 案内メール', confirmMessage, ui.ButtonSet.OK_CANCEL);
    if (answer !== ui.Button.OK) return;

    fukuokaDay2AssertSender_();

    let createdCount = 0;
    const errors = recipients.invalid.slice();

    recipients.valid.forEach(function(recipient) {
      try {
        const body = template.body.replace(
          FUKUOKA_DAY2_MAIL_CONFIG.bodyPlaceholder,
          recipient.playerName + '  様'
        );

        GmailApp.createDraft(recipient.email, template.subject, body, {
          from: FUKUOKA_DAY2_MAIL_CONFIG.from,
          bcc: FUKUOKA_DAY2_MAIL_CONFIG.bcc
        });
        createdCount++;
      } catch (error) {
        errors.push('行' + recipient.rowNumber + ': ' + error.message);
      }
    });

    const resultLines = [
      '下書き作成完了: ' + createdCount + '件',
      '未作成・エラー: ' + errors.length + '件'
    ];

    if (errors.length > 0) {
      resultLines.push('', errors.slice(0, 20).join('\n'));
      if (errors.length > 20) {
        resultLines.push('ほか ' + (errors.length - 20) + '件');
      }
    }

    ui.alert('Fukuoka Day2 案内メール', resultLines.join('\n'), ui.ButtonSet.OK);
  } finally {
    lock.releaseLock();
  }
}

function fukuokaDay2ReadTemplate_(sheet) {
  const subject = String(sheet.getRange('A1').getDisplayValue()).trim();
  const lastRow = Math.max(sheet.getLastRow(), 2);
  const body = sheet
    .getRange(2, 1, lastRow - 1, 1)
    .getDisplayValues()
    .map(function(row) {
      return row[0];
    })
    .join('\n')
    .trim();

  if (!subject) {
    throw new Error('シート2のA1にメール件名を入力してください。');
  }
  if (!body) {
    throw new Error('シート2のA2以降にメール本文を入力してください。');
  }
  if (body.indexOf(FUKUOKA_DAY2_MAIL_CONFIG.bodyPlaceholder) === -1) {
    throw new Error(
      'メール本文に宛名の置換文字「' +
        FUKUOKA_DAY2_MAIL_CONFIG.bodyPlaceholder +
        '」が見つかりません。'
    );
  }

  return {
    subject: subject,
    body: body
  };
}

function fukuokaDay2ReadRecipients_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 2 || lastColumn < 1) {
    return {
      valid: [],
      invalid: []
    };
  }

  const values = sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
  const headers = values[0].map(function(value) {
    return String(value).trim();
  });
  const playerColumn = headers.indexOf(FUKUOKA_DAY2_MAIL_CONFIG.playerHeader);
  const emailColumns = [];

  headers.forEach(function(header, index) {
    if (header === FUKUOKA_DAY2_MAIL_CONFIG.emailHeader) {
      emailColumns.push(index);
    }
  });

  if (playerColumn === -1) {
    throw new Error('列「' + FUKUOKA_DAY2_MAIL_CONFIG.playerHeader + '」が見つかりません。');
  }
  if (emailColumns.length === 0) {
    throw new Error('列「' + FUKUOKA_DAY2_MAIL_CONFIG.emailHeader + '」が見つかりません。');
  }

  const valid = [];
  const invalid = [];

  for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
    const row = values[rowIndex];
    const playerName = String(row[playerColumn]).trim();
    const email = fukuokaDay2FindRightmostEmail_(row, emailColumns);
    const rowHasData = row.some(function(value) {
      return String(value).trim() !== '';
    });

    if (!rowHasData) continue;

    if (!playerName) {
      invalid.push('行' + (rowIndex + 1) + ': プレイヤーネームが空です。');
      continue;
    }
    if (!email) {
      invalid.push('行' + (rowIndex + 1) + ': 有効なメールアドレスがありません。');
      continue;
    }

    valid.push({
      rowNumber: rowIndex + 1,
      playerName: playerName,
      email: email
    });
  }

  return {
    valid: valid,
    invalid: invalid
  };
}

function fukuokaDay2FindRightmostEmail_(row, emailColumns) {
  for (let index = emailColumns.length - 1; index >= 0; index--) {
    const email = String(row[emailColumns[index]]).trim();
    if (fukuokaDay2IsValidEmail_(email)) {
      return email;
    }
  }
  return '';
}

function fukuokaDay2IsValidEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function fukuokaDay2AssertSender_() {
  const sender = FUKUOKA_DAY2_MAIL_CONFIG.from.toLowerCase();
  const effectiveUser = String(Session.getEffectiveUser().getEmail()).toLowerCase();
  const aliases = GmailApp.getAliases().map(function(alias) {
    return String(alias).toLowerCase();
  });

  if (effectiveUser !== sender && aliases.indexOf(sender) === -1) {
    throw new Error(
      FUKUOKA_DAY2_MAIL_CONFIG.from +
        ' を送信元として使用できません。Gmailの差出人アドレス設定を確認してください。'
    );
  }
}
