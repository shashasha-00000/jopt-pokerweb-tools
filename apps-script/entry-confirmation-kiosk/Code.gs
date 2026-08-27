const ENTRY_CONFIRMATION_APP = Object.freeze({
  version: '0.2.4',
  spreadsheetId: '1-J-S4xPpzlN1AYK4YgYghrqVgMpafsRYsrWJjiPBtuk',
  logSheetName: '確認ログ',
  timeZone: 'Asia/Tokyo',
  defaultDeviceId: '受付PAD-01'
});

function doGet() {
  const template = HtmlService.createTemplateFromFile('Index');
  template.appVersion = ENTRY_CONFIRMATION_APP.version;
  template.defaultDeviceId = ENTRY_CONFIRMATION_APP.defaultDeviceId;

  return template
    .evaluate()
    .setTitle('エントリー確認 | JOPT')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function recordConfirmation(payload) {
  const request = normalizeConfirmationRequest_(payload);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getLogSheet_();
    const duplicate = findRequestId_(sheet, request.requestId);
    if (duplicate) {
      return duplicate;
    }

    const now = new Date();
    sheet.appendRow([
      now,
      request.deviceId,
      request.deliveryMode === 'RETRY' ? 'CONFIRMED_DELAYED' : 'CONFIRMED',
      request.requestId,
      ENTRY_CONFIRMATION_APP.version,
      request.clientClickedAt || '',
      request.deliveryMode === 'RETRY' ? '遅延補記' : '即時'
    ]);

    const row = sheet.getLastRow();
    sheet.getRange(row, 1).setNumberFormat('yyyy/mm/dd hh:mm:ss');
    if (request.clientClickedAt) {
      sheet.getRange(row, 6).setNumberFormat('yyyy/mm/dd hh:mm:ss');
    }
    SpreadsheetApp.flush();

    return {
      ok: true,
      duplicate: false,
      recordedAtJst: Utilities.formatDate(
        now,
        ENTRY_CONFIRMATION_APP.timeZone,
        'yyyy/MM/dd HH:mm:ss'
      ),
      deviceId: request.deviceId,
      requestId: request.requestId
    };
  } finally {
    lock.releaseLock();
  }
}

function verifySetup() {
  const spreadsheet = SpreadsheetApp.openById(ENTRY_CONFIRMATION_APP.spreadsheetId);
  const sheet = getLogSheet_();
  return {
    ok: true,
    spreadsheetId: spreadsheet.getId(),
    spreadsheetName: spreadsheet.getName(),
    sheetName: sheet.getName(),
    spreadsheetTimeZone: spreadsheet.getSpreadsheetTimeZone(),
    scriptTimeZone: Session.getScriptTimeZone(),
    appVersion: ENTRY_CONFIRMATION_APP.version
  };
}

function getLogSheet_() {
  if (
    !ENTRY_CONFIRMATION_APP.spreadsheetId ||
    ENTRY_CONFIRMATION_APP.spreadsheetId === 'SET_AFTER_SHEET_CREATION'
  ) {
    throw new Error('ログ保存先のスプレッドシートIDが未設定です。');
  }

  const spreadsheet = SpreadsheetApp.openById(ENTRY_CONFIRMATION_APP.spreadsheetId);
  if (spreadsheet.getSpreadsheetTimeZone() !== ENTRY_CONFIRMATION_APP.timeZone) {
    spreadsheet.setSpreadsheetTimeZone(ENTRY_CONFIRMATION_APP.timeZone);
  }

  let sheet = spreadsheet.getSheetByName(ENTRY_CONFIRMATION_APP.logSheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(ENTRY_CONFIRMATION_APP.logSheetName);
  }

  ensureLogHeader_(sheet);
  return sheet;
}

function ensureLogHeader_(sheet) {
  const baseHeaders = ['日本時間', 'デバイスID', '結果', '記録ID', 'APPバージョン'];
  const headers = baseHeaders.concat(['端末クリック時間', '記録方式']);
  const current = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  const matches = headers.every((header, index) => current[index] === header);
  if (matches) return;

  const baseMatches = baseHeaders.every((header, index) => current[index] === header);
  if (sheet.getLastRow() > 0 && current.some(String) && !baseMatches) {
    throw new Error('確認ログのヘッダーが想定と異なります。');
  }

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#e8eaed')
    .setFontWeight('bold');
  sheet.setColumnWidths(1, 1, 170);
  sheet.setColumnWidths(2, 1, 130);
  sheet.setColumnWidths(3, 1, 110);
  sheet.setColumnWidths(4, 1, 280);
  sheet.setColumnWidths(5, 1, 130);
  sheet.setColumnWidths(6, 1, 170);
  sheet.setColumnWidths(7, 1, 110);
}

function normalizeConfirmationRequest_(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const deviceId = String(source.deviceId || ENTRY_CONFIRMATION_APP.defaultDeviceId).trim();
  const requestId = String(source.requestId || '').trim();
  const clientClickedAtIso = String(source.clientClickedAtIso || '').trim();
  const clientClickedAt = clientClickedAtIso ? new Date(clientClickedAtIso) : null;
  const deliveryMode = source.deliveryMode === 'RETRY' ? 'RETRY' : 'REALTIME';

  if (!deviceId || deviceId.length > 60) {
    throw new Error('デバイスIDが不正です。');
  }
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
    throw new Error('記録IDが不正です。');
  }
  if (clientClickedAt && Number.isNaN(clientClickedAt.getTime())) {
    throw new Error('端末クリック時間が不正です。');
  }

  return { deviceId, requestId, clientClickedAt, deliveryMode };
}

function findRequestId_(sheet, requestId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const match = sheet
    .getRange(2, 4, lastRow - 1, 1)
    .createTextFinder(requestId)
    .matchEntireCell(true)
    .findNext();

  if (!match) return null;

  const row = match.getRow();
  return {
    ok: true,
    duplicate: true,
    recordedAtJst: sheet.getRange(row, 1).getDisplayValue(),
    deviceId: sheet.getRange(row, 2).getDisplayValue(),
    requestId
  };
}
