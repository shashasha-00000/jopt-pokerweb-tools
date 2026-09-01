const PORTAL_TITLE = 'カスタマーチーム AI活用・業務自動化ポータル';
const PORTAL_VERSION = '0.4.1';
const PORTAL_EXPECTED_SPREADSHEET_ID = '1ujMFn2iNWLo7OTmi1VckiP9dYq5SdtIwdCNa5DjBrxc';
const PORTAL_ALLOWED_DOMAIN = 'japanopenpoker.com';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('AI活用ポータル')
    .addItem('初期設定・不足データ追加', 'setupCustomerAiPortal')
    .addItem('現行カタログへ再構築', 'rebuildCustomerAiPortalCatalog')
    .addItem('設定確認', 'verifyCustomerAiPortal')
    .addToUi();
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function doGet() {
  const template = HtmlService.createTemplateFromFile('Index');
  template.appTitle = PORTAL_TITLE;
  template.appVersion = PORTAL_VERSION;
  return template.evaluate()
    .setTitle(PORTAL_TITLE)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function setupCustomerAiPortal() {
  const active = PORTAL_assertTargetSpreadsheet_();
  PropertiesService.getScriptProperties().setProperties({
    PORTAL_SPREADSHEET_ID: active.getId(),
    PORTAL_ALLOWED_DOMAIN: PORTAL_ALLOWED_DOMAIN,
  });
  const result = PORTAL_setupSheets_(active, false);
  PORTAL_notify_(active, '初期設定が完了しました。追加タスク: ' + result.addedTasks + ' / 追加リソース: ' + result.addedResources);
  return result;
}

function rebuildCustomerAiPortalCatalog() {
  const active = PORTAL_assertTargetSpreadsheet_();
  PropertiesService.getScriptProperties().setProperties({
    PORTAL_SPREADSHEET_ID: active.getId(),
    PORTAL_ALLOWED_DOMAIN: PORTAL_ALLOWED_DOMAIN,
  });
  const result = PORTAL_setupSheets_(active, true);
  PORTAL_notify_(active, '現行カタログへ再構築しました。タスク: ' + result.addedTasks + ' / リソース: ' + result.addedResources);
  return result;
}

function verifyCustomerAiPortal() {
  const ss = PORTAL_getSpreadsheet_();
  const required = ['タスク一覧', 'タスクリソース', 'AIマニュアル', '投稿受付', '利用ガイド', '設定'];
  const missing = required.filter((name) => !ss.getSheetByName(name));
  const result = {
    ok: missing.length === 0,
    spreadsheetId: ss.getId(),
    title: ss.getName(),
    timeZone: ss.getSpreadsheetTimeZone(),
    missingSheets: missing,
    version: PORTAL_VERSION,
  };
  PORTAL_notify_(ss, result.ok ? '設定確認OK' : '設定確認NG: ' + missing.join(', '));
  console.log(JSON.stringify(result));
  return result;
}

function getPortalBootstrap() {
  const email = Session.getActiveUser().getEmail() || '';
  const spreadsheet = PORTAL_getSpreadsheet_();
  const taskSheet = spreadsheet.getSheetByName('タスク一覧');
  return {
    title: PORTAL_TITLE,
    version: PORTAL_VERSION,
    currentUser: email,
    canManage: PORTAL_isAllowedUser_(email),
    sheetUrl: spreadsheet.getUrl(),
    taskSheetGid: taskSheet ? taskSheet.getSheetId() : 0,
    tasks: PORTAL_readTasksWithResources_(),
    guides: PORTAL_readGuides_(),
  };
}

function getTaskForEdit(taskId) {
  const email = PORTAL_assertAllowedUser_();
  return PORTAL_getTaskForEdit_(taskId, email);
}

function saveTask(input) {
  const email = PORTAL_assertAllowedUser_();
  return PORTAL_saveTask_(input || {}, email);
}

function archiveTask(taskId) {
  const email = PORTAL_assertAllowedUser_();
  return PORTAL_archiveTask_(taskId, email);
}

function getTaskManual(taskId) {
  const id = PORTAL_text_(taskId);
  if (!id) throw new Error('タスクIDがありません。');
  const manual = PORTAL_readManual_(id);
  if (!manual) throw new Error('AI操作マニュアルが見つかりません: ' + id);
  return manual;
}

function getGuideManual(guideId) {
  const manual = PORTAL_readGuideManual_(guideId);
  if (!manual) throw new Error('共通マニュアルが見つかりません: ' + PORTAL_text_(guideId));
  return manual;
}

function submitAiResult(input) {
  const data = input || {};
  const title = PORTAL_limitText_(data.title, 120);
  const description = PORTAL_limitText_(data.description, 1200);
  if (!title || !description) throw new Error('タスク名と説明を入力してください。');

  const email = PORTAL_assertAllowedUser_();
  const sheet = PORTAL_getSpreadsheet_().getSheetByName('投稿受付');
  if (!sheet) throw new Error('投稿受付シートがありません。');
  const now = new Date();
  const submissionId = 'SUB-' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().slice(0, 8);
  sheet.appendRow([
    submissionId,
    now,
    email,
    title,
    description,
    PORTAL_limitText_(data.resources, 1200),
    PORTAL_limitText_(data.manager, 120) || 'Sha',
    PORTAL_limitText_(data.users, 300) || 'カスタマー',
    PORTAL_limitText_(data.note, 1500),
    '審査中',
    '',
  ]);
  return { ok: true, submissionId: submissionId };
}

function PORTAL_assertTargetSpreadsheet_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active || active.getId() !== PORTAL_EXPECTED_SPREADSHEET_ID) {
    throw new Error('指定された管理Sheetから実行してください。対象ID: ' + PORTAL_EXPECTED_SPREADSHEET_ID);
  }
  return active;
}

function PORTAL_getSpreadsheet_() {
  const configured = PropertiesService.getScriptProperties().getProperty('PORTAL_SPREADSHEET_ID');
  const spreadsheetId = configured || PORTAL_EXPECTED_SPREADSHEET_ID;
  if (spreadsheetId !== PORTAL_EXPECTED_SPREADSHEET_ID) throw new Error('管理Sheet IDが想定値と一致しません。');
  return SpreadsheetApp.openById(spreadsheetId);
}

function PORTAL_notify_(spreadsheet, message) {
  try {
    spreadsheet.toast(message, 'AI活用ポータル', 8);
  } catch (error) {
    console.log(message);
  }
}

function PORTAL_text_(value) {
  return value == null ? '' : String(value).trim();
}

function PORTAL_limitText_(value, maxLength) {
  return PORTAL_text_(value).slice(0, maxLength);
}

function PORTAL_url_(value) {
  const url = PORTAL_limitText_(value, 1200);
  if (url && !/^https?:\/\//i.test(url)) throw new Error('URLは http:// または https:// で入力してください。');
  return url;
}

function PORTAL_distributionUrl_(value) {
  const url = PORTAL_url_(value);
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i);
  if (!match) return url;
  return 'https://raw.githubusercontent.com/' + match.slice(1).map(encodeURIComponent).join('/').replace(/%2F/gi, '/');
}

function PORTAL_isAllowedUser_(email) {
  const normalized = PORTAL_text_(email).toLowerCase();
  return Boolean(normalized) && normalized.endsWith('@' + PORTAL_ALLOWED_DOMAIN);
}

function PORTAL_assertAllowedUser_() {
  const email = PORTAL_text_(Session.getActiveUser().getEmail()).toLowerCase();
  if (!PORTAL_isAllowedUser_(email)) throw new Error('@' + PORTAL_ALLOWED_DOMAIN + ' のログインアカウントが必要です。');
  return email;
}
