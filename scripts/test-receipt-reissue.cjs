/* Offline regression checks. No Google/Drive/Gmail access. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../apps-script/ReceiptSemiAutoExperimental.gs'), 'utf8');
const context = vm.createContext({ console, Utilities: {
  formatDate(date, zone) { assert.equal(zone, 'Asia/Tokyo'); return '2026-09-28 12:00:00'; }
}});
vm.runInContext(source + '\nglobalThis.api = RSE._test; globalThis.rse = RSE;', context);
const a = context.api;
const plain = value => JSON.parse(JSON.stringify(value));
const asRow = (headers, values) => Object.fromEntries(headers.map((h, i) => [h, values[i]]));
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS', name); }

const base = { gameId: '76474162', name: 'Test', email: 'test@example.com', recipient: '旧宛名',
  eventName: 'Test event', purchaseTime: '15/08 - 04:10', year: '2026', month: '8', day: '15',
  tournament: '【Test 2026】Sit & Go（8/14）', type: 'En', cash: 1100, creditCard: 2200,
  points: 0, usdt: 0, total: 3300, tax: 300, taxExcluded: 3000, receiptNo: 'TEST-0001' };
const data = a.prepareReceiptDisplayData_(base, {});
const paymentKey = a.makePaymentKey_(data);
const file = { getId: () => 'old-file', getUrl: () => 'https://example.com/old' };
function ledgerRow(d = data, overrides = {}) {
  return asRow(a.LEDGER_HEADERS, a.makeLedgerRowArray_({ data: d, paymentKey: a.makePaymentKey_(d),
    pdfKey: a.makePdfKey_(a.makePaymentKey_(d), d.recipient), receiptNo: d.receiptNo, file,
    applicationKey: 'REQ__76474162__ALL__ALL', status: '送信済み', settings: {}, snapshotVerified: true, ...overrides }));
}
const old = ledgerRow();
const app = { gameId: base.gameId, name: base.name, email: base.email, recipient: '新宛名',
  eventName: base.eventName, allDates: true, instruction: '修正', applicationKey: 'REQ__76474162__ALL__ALL' };
function checkRows(ledger, application = app, prior = {}) {
  const result = a.buildReceiptCheckRows_({ [application.applicationKey]: application },
    { byGameId: { [base.gameId]: [{ ...base, rowNo: 2 }] }, invalid: [] },
    a.buildLedgerMap_(ledger), prior, {}, false);
  assert(result.every(row => row.length === a.CHECK_HEADERS.length));
  return result.map(row => asRow(a.CHECK_HEADERS, row));
}

test('Form: 自動/修正 remain active; 完了/重複 skip', () => {
  assert.equal(a.formStatusDone_('修正'), false);
  assert.equal(a.formStatusDone_('自動'), false);
  assert.equal(a.formStatusDone_('完了'), true);
  assert.equal(a.formStatusDone_('重複'), true);
  const sheet = { getDataRange: () => ({ getValues: () => [
    ['Game ID', '本名', 'メールアドレス', '宛名', '処理終了'],
    [base.gameId, base.name, base.email, '新宛名', '修正'],
    ['12345678', 'Done', base.email, 'Done', '完了'],
    ['23456789', 'Duplicate', base.email, 'Dup', '重複']
  ] }) };
  const found = Object.values(a.readApplications_(sheet, {}).byRequestKey);
  assert.equal(found.length, 1); assert.equal(found[0].application.instruction, '修正');
});
test('Re-fetched correction keeps old number and requires confirmation', () => {
  const row = checkRows([old])[0];
  assert.equal(row['判定'], '差替'); assert.equal(row['領収書No'], base.receiptNo);
  assert.equal(row['宛名'], '新宛名'); assert.equal(row['申請指示'], '修正');
  assert.equal(row['確認状態'], '未確定'); assert.equal(row['確認OK'], false);
  assert.equal(row.PDF_FILE_ID, ''); assert.equal(row['送信OK'], false);
});
test('Missing or ambiguous historical receipt blocks correction', () => {
  assert.equal(checkRows([])[0]['判定'], '確認必要');
  assert.match(a.modificationTargetError_(paymentKey, a.buildLedgerMap_([])), /旧領収書/);
  const conflict = { ...old, '領収書No': 'OTHER-0002', PDF_FILE_ID: 'other' };
  assert.equal(checkRows([old, conflict])[0]['判定'], '確認必要');
  assert.match(a.modificationTargetError_(paymentKey, a.buildLedgerMap_([old]), 'WRONG'), /一致/);
  assert.match(a.modificationTargetError_(paymentKey, a.buildLedgerMap_([old]), ''), /一致/);
});
test('Normal issuance still works without historical receipt', () => {
  const row = checkRows([], { ...app, instruction: '自動' })[0];
  assert.equal(row['判定'], 'OK'); assert.equal(row['領収書No'], '');
});
test('Refreshing an already generated correction preserves delivery state', () => {
  const row = checkRows([old])[0];
  const updated = ledgerRow({ ...data, recipient: app.recipient }, { status: 'PDF作成済み',
    file: { getId: () => 'new-file', getUrl: () => 'https://example.com/new' } });
  const result = checkRows([old, updated], app, { [row.checkKey]: { ...row, PDF_FILE_ID: 'new-file' } })[0];
  assert.equal(result['判定'], 'OK'); assert.equal(result.PDF_FILE_ID, 'new-file');
  assert.equal(result['領収書No'], base.receiptNo);
});
test('Snapshot preserves payment, date, tax and issuer; no fabricated backfill', () => {
  const saved = a.readReceiptSnapshot_(old);
  for (const key of Object.keys(data)) assert.deepEqual(plain(saved.data[key]), plain(data[key]));
  assert(saved.data.issuer.registrationNo);
  const oldImport = ledgerRow(data, { snapshotVerified: false });
  assert.equal(oldImport['生成データJSON'], '');
  assert.throws(() => a.readReceiptSnapshot_(oldImport), /再取得/);
  assert.throws(() => a.readReceiptSnapshot_({ ...old, '領収書No': 'wrong' }), /一致/);
  const changed = JSON.parse(old['生成データJSON']); changed.payload.data.total++;
  assert.throws(() => a.readReceiptSnapshot_({ ...old, '生成データJSON': JSON.stringify(changed) }), /整合性/);
});
test('USDT snapshot reissue retains original rate and only changes recipient HTML', () => {
  const usd = a.prepareReceiptDisplayData_({ ...base, cash: 0, creditCard: 0, usdt: 3300 },
    { byDate: { '2026-08-15': 150 } });
  const snapshot = a.readReceiptSnapshot_(ledgerRow(usd));
  assert.equal(snapshot.data.usdtRate, 150); assert.equal(snapshot.data.displayTotal, 22);
  const before = a.buildReceiptHtml_(snapshot.data, snapshot.settings);
  const after = a.buildReceiptHtml_({ ...snapshot.data, recipient: '新宛名 & Co' }, snapshot.settings);
  const withoutRecipient = html => html.replace(/<div class="recipient">.*?<\/div>/, '');
  assert.equal(withoutRecipient(before), withoutRecipient(after));
  assert(after.includes('新宛名 &amp; Co')); assert(after.includes('22.00') || after.includes('22'));
});

class Sheet {
  constructor(headers, rows = []) { this.cells = [Array.from(headers), ...rows.map(r => Array.from(r))]; this.columns = headers.length; this.writes = []; }
  getName() { return 'RSE_領収書管理'; }
  getMaxColumns() { return this.columns; }
  insertColumnsAfter(_, count) { this.columns += count; }
  getLastRow() { return this.cells.length; }
  getRange(row, col, height, width) {
    const values = () => Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => this.cells[row - 1 + r]?.[col - 1 + c] ?? ''));
    return { getValues: values, getDisplayValues: () => values().map(r => r.map(String)),
      getFormulas: () => values().map(r => r.map(() => '')),
      setValues: input => { this.writes.push({ row, col, input: plain(input) }); input.forEach((r, ri) => r.forEach((v, ci) => {
        this.cells[row - 1 + ri] ||= []; this.cells[row - 1 + ri][col - 1 + ci] = v;
      })); } };
  }
}
test('Schema upgrade only appends headers; repeat upgrade is a no-op', () => {
  for (const [headers, width] of [[a.LEDGER_HEADERS, 21], [a.GAME_ID_CHECK_HEADERS, 21], [a.CHECK_HEADERS, 39]]) {
    const history = Array.from({ length: width }, (_, i) => 'old-' + i);
    const sheet = new Sheet(headers.slice(0, width), [history]);
    a.upgradeReceiptHeaders_(sheet, headers, width);
    assert.deepEqual(sheet.cells[1], history); assert.equal(sheet.writes.length, 1);
    assert.equal(sheet.writes[0].row, 1); assert.equal(sheet.writes[0].col, width + 1);
    a.upgradeReceiptHeaders_(sheet, headers, width); assert.equal(sheet.writes.length, 1);
  }
});
test('Schema upgrade refuses occupied or incompatible columns', () => {
  const occupied = new Sheet(a.LEDGER_HEADERS.slice(0, 21), [Array(21).fill('').concat('keep me')]);
  assert.throws(() => a.upgradeReceiptHeaders_(occupied, a.LEDGER_HEADERS, 21), /上書き/);
  assert.equal(occupied.writes.length, 0);
  const wrong = new Sheet(['wrong', ...a.LEDGER_HEADERS.slice(1, 21)]);
  assert.throws(() => a.upgradeReceiptHeaders_(wrong, a.LEDGER_HEADERS, 21), /異なり/);
});
function directHarness({ cancel = false, duringConfirm, pending = false, selectedRow = 2 } = {}) {
  const ledger = new Sheet(a.LEDGER_HEADERS, [a.LEDGER_HEADERS.map(h => old[h])]);
  ledger.getMaxRows = () => 100;
  ledger.getDataRange = () => ledger.getRange(1, 1, ledger.cells.length, ledger.columns);
  ledger.getActiveRangeList = () => ({ getRanges: () => [{ getNumRows: () => 1, getRow: () => selectedRow }] });
  const settings = new Sheet(['設定項目', '設定値'], [['RECEIPT_FOLDER_URL', '1234567890123456789012345']]);
  const check = new Sheet(a.CHECK_HEADERS, [a.CHECK_HEADERS.map(h => ({
    paymentKey, '処理方針': '新規発行', '送信ステータス': '未送信'
  }[h] || ''))]);
  check.getDataRange = () => check.getRange(1, 1, check.cells.length, check.columns);
  let created = 0, locked = false;
  const ui = { Button: { OK: 'OK' }, ButtonSet: { OK_CANCEL: 'OK_CANCEL' },
    prompt: () => ({ getSelectedButton: () => cancel ? 'CANCEL' : 'OK', getResponseText: () => '新宛名' }),
    alert: (...args) => { if (args.length === 3 && duringConfirm) duringConfirm(ledger); return 'OK'; }
  };
  context.SpreadsheetApp = { getUi: () => ui, getActiveSpreadsheet: () => ({
    getActiveSheet: () => ledger,
    getSheetByName: name => name === 'RSE_設定' ? settings : (name === 'RSE_領収書CHECK' && pending ? check : null)
  }) };
  context.LockService = { getDocumentLock: () => ({ tryLock: () => (locked = true), hasLock: () => locked, releaseLock: () => { locked = false; } }) };
  context.PropertiesService = { getDocumentProperties: () => ({ setProperty() {}, deleteProperty() {} }) };
  context.Session = { getActiveUser: () => ({ getEmail: () => 'operator@example.com' }) };
  context.MimeType = { PDF: 'pdf' };
  context.Utilities.newBlob = () => ({ getAs: () => ({ setName: () => ({}) }) });
  context.DriveApp = { getFolderById: () => ({ createFile: () => {
    created++; return { getId: () => 'new-file', getUrl: () => 'https://example.com/new' };
  } }) };
  context.GmailApp = new Proxy({}, { get() { throw new Error('Unexpected Gmail operation'); } });
  return { ledger, run: () => context.rse.reissueSelectedLedgerPdf(), created: () => created, locked: () => locked };
}
test('Direct snapshot correction appends a version, retains old snapshot and file, sends no mail', () => {
  const h = directHarness(); h.run();
  assert.equal(h.created(), 1); assert.equal(h.locked(), false); assert.equal(h.ledger.cells.length, 3);
  const prior = asRow(a.LEDGER_HEADERS, h.ledger.cells[1]);
  const next = asRow(a.LEDGER_HEADERS, h.ledger.cells[2]);
  assert.equal(prior.status, '差替済み'); assert.equal(prior.PDF_FILE_ID, 'old-file');
  assert.equal(prior['生成データJSON'], old['生成データJSON']);
  assert.equal(next['領収書No'], old['領収書No']); assert.equal(next['元PDF_FILE_ID'], 'old-file');
  assert.equal(next['宛名'], '新宛名'); assert.equal(next.status, 'PDF作成済み（手動補送）');
  assert.equal(a.readReceiptSnapshot_(next).data.recipient, '新宛名');
  assert.throws(h.run, /有効版/); assert.equal(h.created(), 1);
});
test('Cancel, concurrent edits and pending CHECK stop before file creation', () => {
  const cancelled = directHarness({ cancel: true }); cancelled.run();
  assert.equal(cancelled.created(), 0); assert.equal(cancelled.ledger.writes.length, 0);
  const changed = directHarness({ duringConfirm: sheet => { sheet.cells[1][6] = 'Other'; } });
  assert.throws(changed.run, /変わりました/); assert.equal(changed.created(), 0); assert.equal(changed.locked(), false);
  const pending = directHarness({ pending: true });
  assert.throws(pending.run, /処理中/); assert.equal(pending.created(), 0);
});
console.log(`${passed} regression groups passed. Apps Script parsed successfully.`);
