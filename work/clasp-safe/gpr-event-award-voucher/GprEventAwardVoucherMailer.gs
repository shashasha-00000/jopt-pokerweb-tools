const GPR_MAIL_CONFIG = {
  menuName: 'GPR Voucherメール',
  sourceSheetName: 'シート1',
  templateSheetName: 'シート2',
  masterSheetName: 'シート3',
  logSheetName: 'GPR_MAIL_LOG',
  defaultBcc: 'customer@japanopenpoker.com',
  from: 'customer@japanopenpoker.com',
  fromName: 'JOPTカスタマーサポート',
  maxDraftsPerRun: 50,
  defaultTournament: 'JOPT 2026 Tokyo #02',
  includeSystemNameNoteByDefault: false,
  status: {
    notCreated: '未作成',
    drafted: '草稿作成済',
    sent: '送信済',
    error: 'エラー'
  },
  extraHeaders: ['送信状況', '草稿作成', '送信日時', 'エラー', 'Draft ID', 'Gmail Message ID'],
  sourceHeaderAliases: {
    player: ['Player', 'プレイヤー', 'ニックネーム'],
    gameId: ['Game ID', 'GameID'],
    grantContent: ['付与内容'],
    quantity: ['枚数'],
    notes: ['備考'],
    status: ['送信状況'],
    draftedCheck: ['草稿作成'],
    sentAt: ['送信日時'],
    error: ['エラー'],
    draftId: ['Draft ID'],
    gmailMessageId: ['Gmail Message ID'],
    availableTournament: ['利用可能大会'],
    grantStatus: ['付与状況'],
    sendTarget: ['送信対象']
  },
  masterHeaderAliases: {
    gameId: ['Game ID', 'GameID', 'PokerWeb Game', 'PokerWeb GameID'],
    name: ['氏名', '名前'],
    nickname: ['ニックネーム', 'Player'],
    email: ['メールアドレス', 'E-mail', 'Email']
  }
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(GPR_MAIL_CONFIG.menuName)
    .addItem('選択行の草稿を作成', 'gprCreateDraftsForSelectedRows')
    .addItem('対象者全員の草稿を作成', 'gprCreateDraftsForAllRows')
    .addSeparator()
    .addItem('送信状況をリセット', 'gprResetMailStatus')
    .addToUi();
}

function gprCreateDraftsForSelectedRows() {
  gprRunDraftCreation_({ selectedOnly: true });
}

function gprCreateDraftsForAllRows() {
  gprRunDraftCreation_({ selectedOnly: false });
}

function gprResetMailStatus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = gprGetSourceSheet_(ss);
  const map = gprEnsureSourceColumns_(sheet);
  const ui = SpreadsheetApp.getUi();
  const result = ui.alert(
    '確認',
    '送信状況・草稿作成・送信日時・エラー・Draft ID・Gmail Message ID をリセットします。よろしいですか？',
    ui.ButtonSet.OK_CANCEL
  );
  if (result !== ui.Button.OK) return;

  const startRow = map.headerRow + 1;
  const lastRow = sheet.getLastRow();
  if (lastRow < startRow) return;

  const rowCount = lastRow - startRow + 1;
  sheet.getRange(startRow, map.statusCol, rowCount, 1).clearContent();
  sheet.getRange(startRow, map.draftedCheckCol, rowCount, 1).clearContent().insertCheckboxes();
  sheet.getRange(startRow, map.sentAtCol, rowCount, 1).clearContent();
  sheet.getRange(startRow, map.errorCol, rowCount, 1).clearContent();
  sheet.getRange(startRow, map.draftIdCol, rowCount, 1).clearContent();
  sheet.getRange(startRow, map.gmailMessageIdCol, rowCount, 1).clearContent();
}

function gprRunDraftCreation_(options) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sourceSheet = gprGetSourceSheet_(ss);
    const masterSheet = gprGetMasterSheet_(ss);
    const templateSheet = gprGetTemplateSheet_(ss);
    const sourceMap = gprEnsureSourceColumns_(sourceSheet);
    const masterMap = gprFindMasterHeaderMap_(masterSheet);
    const template = gprReadTemplate_(templateSheet);
    const selectedRows = options.selectedOnly ? gprGetSelectedSourceRows_(sourceSheet, sourceMap.headerRow) : null;

    const rawRows = gprReadSourceRows_(sourceSheet, sourceMap, selectedRows);
    const grouped = gprGroupRowsByCustomer_(rawRows);
    const recipients = gprBuildRecipients_(grouped, masterSheet, masterMap);
    const targets = recipients.filter(gprIsDraftTarget_);

    if (!targets.length) {
      SpreadsheetApp.getUi().alert('草稿作成対象がありません。');
      return;
    }

    if (targets.length > GPR_MAIL_CONFIG.maxDraftsPerRun) {
      throw new Error('1回の実行上限は ' + GPR_MAIL_CONFIG.maxDraftsPerRun + ' 名です。対象: ' + targets.length + ' 名');
    }

    let created = 0;
    let reused = 0;
    let errors = 0;

    targets.forEach(target => {
      try {
        const mail = gprBuildMail_(target, template);
        const draftInfo = gprFindOrCreateDraft_(target, mail);
        gprMarkDraftSuccess_(sourceSheet, sourceMap, target, draftInfo);
        gprAppendLog_(ss, 'draft', target, draftInfo.reused ? '既存下書きを使用' : '下書き作成済', '');
        if (draftInfo.reused) reused++;
        else created++;
      } catch (error) {
        gprMarkDraftError_(sourceSheet, sourceMap, target, error);
        gprAppendLog_(ss, 'draft', target, 'エラー', error.message);
        errors++;
      }
    });

    SpreadsheetApp.getUi().alert(
      'Gmail下書き作成が完了しました。\n\n' +
      '対象: ' + targets.length + '名\n' +
      '新規作成: ' + created + '件\n' +
      '既存再利用: ' + reused + '件\n' +
      'エラー: ' + errors + '件'
    );
  } finally {
    lock.releaseLock();
  }
}

function gprGetSourceSheet_(ss) {
  const sheet = ss.getSheetByName(GPR_MAIL_CONFIG.sourceSheetName) || ss.getActiveSheet();
  if (!sheet) throw new Error('付与一覧シートが見つかりません。');
  return sheet;
}

function gprGetTemplateSheet_(ss) {
  const sheet = ss.getSheetByName(GPR_MAIL_CONFIG.templateSheetName);
  if (!sheet) throw new Error('文面草稿シート（シート2）が見つかりません。');
  return sheet;
}

function gprGetMasterSheet_(ss) {
  const sheet = ss.getSheetByName(GPR_MAIL_CONFIG.masterSheetName);
  if (!sheet) throw new Error('宛先マスタシート（シート3）が見つかりません。');
  return sheet;
}

function gprEnsureSourceColumns_(sheet) {
  const headerRow = gprFindHeaderRow_(sheet, ['付与内容', '枚数', 'Game ID']);
  const headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(gprText_);
  const map = {
    headerRow: headerRow,
    playerCol: gprFindHeaderAliasIndex_(headers, GPR_MAIL_CONFIG.sourceHeaderAliases.player),
    gameIdCol: gprFindHeaderAliasIndex_(headers, GPR_MAIL_CONFIG.sourceHeaderAliases.gameId),
    grantContentCol: gprFindHeaderAliasIndex_(headers, GPR_MAIL_CONFIG.sourceHeaderAliases.grantContent),
    quantityCol: gprFindHeaderAliasIndex_(headers, GPR_MAIL_CONFIG.sourceHeaderAliases.quantity),
    notesCol: gprFindHeaderAliasIndex_(headers, GPR_MAIL_CONFIG.sourceHeaderAliases.notes),
    availableTournamentCol: gprFindHeaderAliasIndex_(headers, GPR_MAIL_CONFIG.sourceHeaderAliases.availableTournament),
    grantStatusCol: gprFindHeaderAliasIndex_(headers, GPR_MAIL_CONFIG.sourceHeaderAliases.grantStatus),
    sendTargetCol: gprFindHeaderAliasIndex_(headers, GPR_MAIL_CONFIG.sourceHeaderAliases.sendTarget)
  };

  GPR_MAIL_CONFIG.extraHeaders.forEach(header => {
    if (headers.indexOf(header) < 0) {
      sheet.getRange(headerRow, sheet.getLastColumn() + 1).setValue(header);
      headers.push(header);
    }
  });

  map.statusCol = headers.indexOf('送信状況') + 1;
  map.draftedCheckCol = headers.indexOf('草稿作成') + 1;
  map.sentAtCol = headers.indexOf('送信日時') + 1;
  map.errorCol = headers.indexOf('エラー') + 1;
  map.draftIdCol = headers.indexOf('Draft ID') + 1;
  map.gmailMessageIdCol = headers.indexOf('Gmail Message ID') + 1;

  const startRow = headerRow + 1;
  const rowCount = Math.max(sheet.getMaxRows() - headerRow, 1);
  sheet.getRange(startRow, map.draftedCheckCol, rowCount, 1).insertCheckboxes();
  sheet.hideColumns(map.draftIdCol, 2);

  return map;
}

function gprFindMasterHeaderMap_(sheet) {
  const headerRow = gprFindHeaderRow_(sheet, ['Game ID', 'メールアドレス']);
  const headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(gprText_);
  return {
    headerRow: headerRow,
    gameIdCol: gprFindHeaderAliasIndex_(headers, GPR_MAIL_CONFIG.masterHeaderAliases.gameId),
    nameCol: gprFindHeaderAliasIndex_(headers, GPR_MAIL_CONFIG.masterHeaderAliases.name),
    nicknameCol: gprFindHeaderAliasIndex_(headers, GPR_MAIL_CONFIG.masterHeaderAliases.nickname),
    emailCol: gprFindHeaderAliasIndex_(headers, GPR_MAIL_CONFIG.masterHeaderAliases.email)
  };
}

function gprFindHeaderRow_(sheet, requiredAliases) {
  const maxRows = Math.min(sheet.getLastRow(), 20);
  const values = sheet.getRange(1, 1, maxRows, sheet.getLastColumn()).getDisplayValues();
  for (let row = 0; row < values.length; row++) {
    const headers = values[row].map(gprText_);
    const ok = requiredAliases.every(alias =>
      headers.some(header => header.toLowerCase() === alias.toLowerCase())
    );
    if (ok) return row + 1;
  }
  throw new Error('見出し行を特定できませんでした: ' + sheet.getName());
}

function gprFindHeaderAliasIndex_(headers, aliases) {
  for (let i = 0; i < aliases.length; i++) {
    const want = gprText_(aliases[i]).toLowerCase();
    for (let j = 0; j < headers.length; j++) {
      if (headers[j].toLowerCase() === want) return j + 1;
    }
  }
  return 0;
}

function gprGetSelectedSourceRows_(sheet, headerRow) {
  const range = sheet.getActiveRange();
  if (!range || range.getSheet().getName() !== sheet.getName()) return [];
  const rows = [];
  for (let row = range.getRow(); row < range.getRow() + range.getNumRows(); row++) {
    if (row > headerRow) rows.push(row);
  }
  return rows;
}

function gprReadSourceRows_(sheet, map, selectedRows) {
  const startRow = map.headerRow + 1;
  const lastRow = sheet.getLastRow();
  if (lastRow < startRow) return [];

  const values = sheet.getRange(startRow, 1, lastRow - startRow + 1, sheet.getLastColumn()).getValues();
  const rows = [];
  values.forEach((row, index) => {
    const sourceRow = startRow + index;
    if (selectedRows && selectedRows.length && selectedRows.indexOf(sourceRow) < 0) return;
    if (!map.grantContentCol || !map.gameIdCol) return;
    const grantContent = gprText_(row[map.grantContentCol - 1]);
    const gameId = gprNormalizeGameId_(row[map.gameIdCol - 1]);
    if (!grantContent && !gameId) return;
    rows.push({
      sourceRow: sourceRow,
      player: map.playerCol ? gprText_(row[map.playerCol - 1]) : '',
      gameId: gameId,
      grantContent: grantContent,
      quantity: map.quantityCol ? gprToPositiveInt_(row[map.quantityCol - 1], 1) : 1,
      notes: map.notesCol ? gprText_(row[map.notesCol - 1]) : '',
      availableTournament: map.availableTournamentCol ? gprText_(row[map.availableTournamentCol - 1]) : '',
      grantStatus: map.grantStatusCol ? gprText_(row[map.grantStatusCol - 1]) : '',
      sendTarget: map.sendTargetCol ? row[map.sendTargetCol - 1] : true,
      sendStatus: map.statusCol ? gprText_(row[map.statusCol - 1]) : '',
      draftId: map.draftIdCol ? gprText_(row[map.draftIdCol - 1]) : '',
      gmailMessageId: map.gmailMessageIdCol ? gprText_(row[map.gmailMessageIdCol - 1]) : ''
    });
  });
  return rows;
}

function gprGroupRowsByCustomer_(rows) {
  const groups = {};
  rows.forEach(row => {
    const key = row.gameId || '';
    if (!key) return;
    if (!groups[key]) {
      groups[key] = {
        key: key,
        rows: [],
        allGrantDone: true
      };
    }
    groups[key].rows.push(row);
    if (row.grantStatus && row.grantStatus !== '付与完了') {
      groups[key].allGrantDone = false;
    }
  });
  return Object.keys(groups).map(key => groups[key]);
}

function gprBuildRecipients_(groups, masterSheet, masterMap) {
  const masterValues = masterSheet.getRange(masterMap.headerRow + 1, 1, Math.max(masterSheet.getLastRow() - masterMap.headerRow, 0), masterSheet.getLastColumn()).getValues();
  const byGameId = {};
  masterValues.forEach(row => {
    const gameId = masterMap.gameIdCol ? gprNormalizeGameId_(row[masterMap.gameIdCol - 1]) : '';
    if (!gameId) return;
    byGameId[gameId] = {
      gameId: gameId,
      name: masterMap.nameCol ? gprText_(row[masterMap.nameCol - 1]) : '',
      nickname: masterMap.nicknameCol ? gprText_(row[masterMap.nicknameCol - 1]) : '',
      email: masterMap.emailCol ? gprText_(row[masterMap.emailCol - 1]) : ''
    };
  });

  return groups.map(group => {
    const master = byGameId[group.key] || {};
    const mergedItems = gprMergeGrantItems_(group.rows);
    const tournaments = gprMergeTournamentNames_(group.rows);
    const needsSystemNameNote = group.rows.some(row => /表示名称|GF|Grand Final/i.test(row.notes));
    const firstRow = group.rows[0] || {};
    return {
      key: group.key,
      rows: group.rows,
      gameId: group.key,
      email: master.email || '',
      customerName: gprResolveCustomerName_(master, firstRow),
      items: mergedItems,
      tournaments: tournaments.length ? tournaments : [GPR_MAIL_CONFIG.defaultTournament],
      allGrantDone: group.allGrantDone,
      alreadySent: group.rows.every(row => row.sendStatus === GPR_MAIL_CONFIG.status.sent),
      existingDraftId: group.rows.find(row => row.draftId) ? group.rows.find(row => row.draftId).draftId : '',
      needsSystemNameNote: needsSystemNameNote
    };
  });
}

function gprMergeGrantItems_(rows) {
  const merged = {};
  rows.forEach(row => {
    const ticketName = gprNormalizeTicketName_(row.grantContent);
    if (!merged[ticketName]) merged[ticketName] = 0;
    merged[ticketName] += row.quantity || 1;
  });
  return Object.keys(merged).map(name => ({
    name: name,
    quantity: merged[name]
  }));
}

function gprMergeTournamentNames_(rows) {
  const set = {};
  rows.forEach(row => {
    const value = gprText_(row.availableTournament) || GPR_MAIL_CONFIG.defaultTournament;
    set[value] = true;
  });
  return Object.keys(set);
}

function gprResolveCustomerName_(master, row) {
  const name = gprText_(master.name) || gprText_(row.player) || gprText_(master.nickname) || 'お客様';
  return /様$/.test(name) ? name : name + '様';
}

function gprIsDraftTarget_(recipient) {
  if (!recipient.email) return false;
  if (recipient.alreadySent) return false;
  if (!recipient.allGrantDone) return false;
  return true;
}

function gprReadTemplate_(sheet) {
  const values = sheet.getDataRange().getDisplayValues();
  let subject = '';
  let bodyStartRow = -1;
  for (let i = 0; i < values.length; i++) {
    const rowText = values[i].map(gprText_).filter(Boolean);
    if (!subject && rowText.some(text => /件名/.test(text))) {
      subject = '';
      continue;
    }
    if (!subject && rowText.length) {
      subject = rowText.join(' ').trim();
    }
    if (rowText.some(text => /正文/.test(text))) {
      bodyStartRow = i + 1;
      break;
    }
  }

  if (!subject) throw new Error('件名をテンプレートシートから取得できません。');
  if (bodyStartRow < 0) throw new Error('正文の開始位置をテンプレートシートから取得できません。');

  const lines = [];
  for (let i = bodyStartRow; i < values.length; i++) {
    const joined = values[i].map(gprText_).filter(Boolean).join(' ');
    lines.push(joined);
  }
  return {
    subject: subject,
    body: lines.join('\n')
  };
}

function gprBuildMail_(recipient, template) {
  const itemLines = recipient.items.map(item => '・' + item.name + '：' + item.quantity + '枚');
  const tournamentText = recipient.tournaments.join('\n');
  let body = template.body.replace(/\r\n/g, '\n');
  body = body.replace(/〇〇様/g, recipient.customerName);
  body = body.replace(/GAME\s*ID/gi, 'Poker Web');
  body = body.replace(/GAME IDを再起動して、付与内容をご確認ください。/g, 'Poker Webへログインのうえ、付与内容をご確認ください。');
  body = gprReplaceSection_(body, '【付与内容】', '【対象大会】', itemLines);
  body = gprReplaceSection_(body, '【対象大会】', '', tournamentText.split('\n'));
  if (recipient.needsSystemNameNote || GPR_MAIL_CONFIG.includeSystemNameNoteByDefault) {
    body += '\n\nシステム上の表示名称に過去大会名が含まれる場合がございますが、今回ご案内した条件にてご利用いただけます。';
  }
  return {
    subject: template.subject,
    body: body.trim()
  };
}

function gprReplaceSection_(body, startMarker, endMarker, newLines) {
  const lines = body.split('\n');
  const startIndex = lines.findIndex(line => gprText_(line) === startMarker);
  if (startIndex < 0) return body;

  let endIndex = lines.length;
  if (endMarker) {
    const found = lines.findIndex((line, idx) => idx > startIndex && gprText_(line) === endMarker);
    if (found >= 0) endIndex = found;
  }

  const before = lines.slice(0, startIndex + 1);
  const after = lines.slice(endIndex);
  return before.concat(newLines).concat(after).join('\n');
}

function gprFindOrCreateDraft_(recipient, mail) {
  if (recipient.existingDraftId) {
    try {
      const existingDraft = GmailApp.getDraft(recipient.existingDraftId);
      const message = existingDraft.getMessage();
      if (message.getSubject() === mail.subject && gprNormalizeBody_(message.getPlainBody()) === gprNormalizeBody_(mail.body)) {
        return {
          draftId: existingDraft.getId(),
          gmailMessageId: message.getId(),
          reused: true
        };
      }
    } catch (error) {
      // Fall through and recreate.
    }
  }

  const existing = gprFindMatchingDraft_(recipient.email, mail.subject, mail.body);
  if (existing) return existing;

  gprAssertFromAlias_();
  const draft = GmailApp.createDraft(recipient.email, mail.subject, mail.body, {
    from: GPR_MAIL_CONFIG.from,
    name: GPR_MAIL_CONFIG.fromName,
    bcc: GPR_MAIL_CONFIG.defaultBcc
  });
  return {
    draftId: draft.getId(),
    gmailMessageId: draft.getMessage().getId(),
    reused: false
  };
}

function gprFindMatchingDraft_(to, subject, body) {
  const drafts = GmailApp.getDrafts();
  for (let i = 0; i < drafts.length; i++) {
    const msg = drafts[i].getMessage();
    if (
      gprNormalizeEmail_(msg.getTo()) === gprNormalizeEmail_(to) &&
      gprNormalizeEmail_(msg.getFrom()) === gprNormalizeEmail_(GPR_MAIL_CONFIG.from) &&
      gprEmailListContains_(msg.getBcc(), GPR_MAIL_CONFIG.defaultBcc) &&
      msg.getSubject() === subject &&
      gprNormalizeBody_(msg.getPlainBody()) === gprNormalizeBody_(body)
    ) {
      return {
        draftId: drafts[i].getId(),
        gmailMessageId: msg.getId(),
        reused: true
      };
    }
  }
  return null;
}

function gprMarkDraftSuccess_(sheet, map, recipient, draftInfo) {
  recipient.rows.forEach(row => {
    sheet.getRange(row.sourceRow, map.statusCol).setValue(GPR_MAIL_CONFIG.status.drafted);
    sheet.getRange(row.sourceRow, map.draftedCheckCol).setValue(true);
    sheet.getRange(row.sourceRow, map.errorCol).clearContent();
    sheet.getRange(row.sourceRow, map.draftIdCol).setValue(draftInfo.draftId);
    sheet.getRange(row.sourceRow, map.gmailMessageIdCol).setValue(draftInfo.gmailMessageId || '');
  });
}

function gprMarkDraftError_(sheet, map, recipient, error) {
  recipient.rows.forEach(row => {
    sheet.getRange(row.sourceRow, map.statusCol).setValue(GPR_MAIL_CONFIG.status.error);
    sheet.getRange(row.sourceRow, map.errorCol).setValue(error.message || String(error));
  });
}

function gprAppendLog_(ss, action, recipient, result, errorText) {
  let sheet = ss.getSheetByName(GPR_MAIL_CONFIG.logSheetName);
  if (!sheet) {
    sheet = ss.insertSheet(GPR_MAIL_CONFIG.logSheetName);
    sheet.getRange(1, 1, 1, 8).setValues([[
      '実行日時', '操作者', 'アクション', 'GameID', '氏名', 'メールアドレス', '結果', 'エラー内容'
    ]]);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([
    new Date(),
    Session.getEffectiveUser().getEmail(),
    action,
    recipient.gameId,
    recipient.customerName,
    recipient.email,
    result,
    errorText || ''
  ]);
}

function gprNormalizeTicketName_(raw) {
  const text = gprText_(raw)
    .replace(/\s*\/\s*-\d{4}\.\d{1,2}\.\d{1,2}\s*$/, '')
    .replace(/^【[^】]+】\s*/, '')
    .trim();

  if (/Main Event/i.test(text)) return 'JOPT 2026 Tokyo #02 Main Event Ticket';
  if (/Millions/i.test(text)) return 'JOPT 2026 Tokyo #02 Millions Ticket';
  if (/Platinum/i.test(text)) return 'JOPT 2026 Tokyo #02 Platinum Ticket';
  if (/50,?000\s*Voucher/i.test(text)) return 'GF ¥50,000 Voucher';
  return text || raw;
}

function gprAssertFromAlias_() {
  const from = GPR_MAIL_CONFIG.from.toLowerCase();
  const aliases = GmailApp.getAliases().map(alias => String(alias).toLowerCase());
  const user = Session.getEffectiveUser().getEmail().toLowerCase();
  if (from !== user && aliases.indexOf(from) < 0) {
    throw new Error('送信元アドレスが Gmail エイリアスに設定されていません: ' + GPR_MAIL_CONFIG.from);
  }
}

function gprNormalizeGameId_(value) {
  return String(value == null ? '' : value).replace(/[^\d]/g, '');
}

function gprNormalizeEmail_(value) {
  const text = gprText_(value).toLowerCase();
  const match = text.match(/<([^>]+)>/);
  return match ? match[1].trim() : text;
}

function gprNormalizeBody_(value) {
  return String(value == null ? '' : value).replace(/\r\n/g, '\n').trim();
}

function gprEmailListContains_(emailList, expected) {
  const want = gprNormalizeEmail_(expected);
  return gprText_(emailList)
    .split(',')
    .map(gprNormalizeEmail_)
    .indexOf(want) >= 0;
}

function gprToPositiveInt_(value, fallback) {
  const n = Number(value);
  return isNaN(n) || n <= 0 ? fallback : n;
}

function gprText_(value) {
  return String(value == null ? '' : value)
    .replace(/\u3000/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\r]+/g, ' ')
    .trim();
}
