const PORTAL_TASK_HEADERS = [
  'タスクID', 'タスク名', '説明', 'カテゴリ', '完成度', '完成状況・更新理由',
  '易用度', '利用難易度', '担当者', '利用者・利用部署', '最終動作確認日',
  '表示順', 'AI操作マニュアルMD'
];
const PORTAL_RESOURCE_HEADERS = [
  'リソースID', 'タスクID', 'リソース名', '種類', '必要ツール', '導入方式',
  'URL', 'ソース・参照', '補足', '表示順'
];
const PORTAL_MANUAL_HEADERS = ['タスクID', 'タスク名', 'MDファイル名', 'マニュアル本文', '更新日時'];
const PORTAL_SUBMISSION_HEADERS = ['投稿ID', '投稿日時', '投稿者', 'タスク名', '説明', '想定リソース', '担当者', '利用者・利用部署', '補足', '状態', '管理者メモ'];
const PORTAL_GUIDE_HEADERS = ['ガイドID', 'タイトル', '概要', 'MDファイル名', 'マニュアル本文'];
const PORTAL_SETTING_HEADERS = ['設定キー', '設定値', '説明'];
const PORTAL_ARCHIVE_TASK_HEADERS = ['削除日時', '削除者'].concat(PORTAL_TASK_HEADERS);
const PORTAL_ARCHIVE_RESOURCE_HEADERS = ['削除日時', '削除者'].concat(PORTAL_RESOURCE_HEADERS);
const PORTAL_ARCHIVE_MANUAL_HEADERS = ['削除日時', '削除者'].concat(PORTAL_MANUAL_HEADERS);

function PORTAL_setupSheets_(ss, rebuild) {
  if (rebuild) PORTAL_removeOldCatalog_(ss);

  const taskSheet = PORTAL_getOrCreateSheet_(ss, 'タスク一覧', PORTAL_TASK_HEADERS);
  const resourceSheet = PORTAL_getOrCreateSheet_(ss, 'タスクリソース', PORTAL_RESOURCE_HEADERS);
  const manualSheet = PORTAL_getOrCreateSheet_(ss, 'AIマニュアル', PORTAL_MANUAL_HEADERS);
  const submissionSheet = PORTAL_getOrCreateSheet_(ss, '投稿受付', PORTAL_SUBMISSION_HEADERS);
  const guideSheet = PORTAL_getOrCreateSheet_(ss, '利用ガイド', PORTAL_GUIDE_HEADERS);
  const settingSheet = PORTAL_getOrCreateSheet_(ss, '設定', PORTAL_SETTING_HEADERS);

  if (rebuild) {
    PORTAL_resetSheet_(taskSheet, PORTAL_TASK_HEADERS);
    PORTAL_resetSheet_(resourceSheet, PORTAL_RESOURCE_HEADERS);
    PORTAL_resetSheet_(manualSheet, PORTAL_MANUAL_HEADERS);
    PORTAL_resetSheet_(guideSheet, PORTAL_GUIDE_HEADERS);
    PORTAL_resetSheet_(settingSheet, PORTAL_SETTING_HEADERS);
    PORTAL_migrateSubmissionHeaders_(submissionSheet);
  }

  PORTAL_prepareSheet_(taskSheet, PORTAL_TASK_HEADERS, [170, 260, 520, 120, 90, 440, 90, 360, 120, 170, 130, 80, 320]);
  PORTAL_prepareSheet_(resourceSheet, PORTAL_RESOURCE_HEADERS, [190, 180, 250, 140, 260, 190, 360, 420, 360, 80]);
  PORTAL_prepareSheet_(manualSheet, PORTAL_MANUAL_HEADERS, [180, 260, 340, 720, 160]);
  PORTAL_prepareSheet_(submissionSheet, PORTAL_SUBMISSION_HEADERS, [190, 160, 220, 260, 420, 360, 120, 180, 320, 100, 260]);
  PORTAL_prepareSheet_(guideSheet, PORTAL_GUIDE_HEADERS, [180, 280, 560, 320, 760]);
  PORTAL_prepareSheet_(settingSheet, PORTAL_SETTING_HEADERS, [230, 360, 520]);

  const addedTasks = PORTAL_seedMissingTasks_(taskSheet);
  const addedResources = PORTAL_seedMissingResources_(resourceSheet);
  const addedManuals = PORTAL_seedMissingManuals_(manualSheet);
  PORTAL_seedGuides_(guideSheet, rebuild);
  PORTAL_seedSettings_(settingSheet, rebuild);
  PORTAL_applyValidations_(taskSheet, resourceSheet, submissionSheet);
  PORTAL_applyBodyFormatting_(taskSheet, resourceSheet, manualSheet, guideSheet);

  return { addedTasks: addedTasks, addedResources: addedResources, addedManuals: addedManuals };
}

function PORTAL_removeOldCatalog_(ss) {
  [
    'ツール一覧', '削除済みツール', '削除済みタスク',
    '削除済みリソース', '削除済みマニュアル'
  ].forEach((name) => {
    const sheet = ss.getSheetByName(name);
    if (sheet && ss.getSheets().length > 1) ss.deleteSheet(sheet);
  });
}

function PORTAL_getOrCreateSheet_(ss, name, headers) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sheet;
}

function PORTAL_resetSheet_(sheet, headers) {
  const filter = sheet.getFilter();
  if (filter) filter.remove();
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}

function PORTAL_migrateSubmissionHeaders_(sheet) {
  const current = sheet.getRange(1, 1, 1, PORTAL_SUBMISSION_HEADERS.length).getDisplayValues()[0];
  const legacy = ['投稿ID', '投稿日時', '投稿者', 'ツール名', '仕事内容', '必要ツール', '担当者', '利用者・利用部署', '補足', '状態', '管理者メモ'];
  if (current.join('\t') === legacy.join('\t')) {
    sheet.getRange(1, 1, 1, PORTAL_SUBMISSION_HEADERS.length).setValues([PORTAL_SUBMISSION_HEADERS]);
  }
}

function PORTAL_prepareSheet_(sheet, headers, widths) {
  const current = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  if (current.every((value) => !value)) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else if (current.join('\t') !== headers.join('\t')) {
    throw new Error(sheet.getName() + ' の表頭が想定と異なります。自動上書きしません。');
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#16324f')
    .setFontColor('#ffffff')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 34);
  widths.forEach((width, index) => sheet.setColumnWidth(index + 1, width));
  if (!sheet.getFilter()) sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 2), headers.length).createFilter();
}

function PORTAL_applyBodyFormatting_() {
  Array.prototype.slice.call(arguments).forEach((sheet) => {
    if (sheet.getLastRow() < 2) return;
    const range = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn());
    range.setVerticalAlignment('top').setWrap(true);
  });
}

function PORTAL_seedMissingTasks_(sheet) {
  const existing = PORTAL_existingIds_(sheet);
  const missing = PORTAL_SEED_TASKS.filter((item) => !existing.has(item.id));
  if (!missing.length) return 0;
  const rows = missing.map((item) => PORTAL_taskRow_(item));
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, PORTAL_TASK_HEADERS.length).setValues(rows);
  PORTAL_formatTaskSheet_(sheet);
  return rows.length;
}

function PORTAL_seedMissingResources_(sheet) {
  const existing = PORTAL_existingIds_(sheet);
  const missing = PORTAL_SEED_RESOURCES.filter((item) => !existing.has(item.id));
  if (!missing.length) return 0;
  const rows = missing.map((item) => PORTAL_resourceRow_(item));
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, PORTAL_RESOURCE_HEADERS.length).setValues(rows);
  return rows.length;
}

function PORTAL_seedMissingManuals_(sheet) {
  const existing = PORTAL_existingIds_(sheet);
  const taskById = {};
  PORTAL_SEED_TASKS.forEach((item) => { taskById[item.id] = item; });
  const rows = Object.keys(PORTAL_SEED_MANUALS)
    .filter((id) => !existing.has(id))
    .map((id) => [id, taskById[id].name, taskById[id].manualFile, PORTAL_SEED_MANUALS[id], new Date()]);
  if (!rows.length) return 0;
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, PORTAL_MANUAL_HEADERS.length).setValues(rows);
  sheet.getRange(2, 5, sheet.getLastRow() - 1, 1).setNumberFormat('yyyy/MM/dd HH:mm');
  return rows.length;
}

function PORTAL_seedGuides_(sheet, rebuild) {
  if (!rebuild && sheet.getLastRow() > 1) return;
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, PORTAL_GUIDE_HEADERS.length).clearContent();
  const rows = PORTAL_SEED_GUIDES.map((guide) => [guide.id, guide.title, guide.summary, guide.fileName, guide.markdown]);
  sheet.getRange(2, 1, rows.length, PORTAL_GUIDE_HEADERS.length).setValues(rows);
}

function PORTAL_seedSettings_(sheet, rebuild) {
  if (!rebuild && sheet.getLastRow() > 1) return;
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, PORTAL_SETTING_HEADERS.length).clearContent();
  const rows = [
    ['APP_TITLE', PORTAL_TITLE, 'Web App表示名'],
    ['ALLOWED_DOMAIN', PORTAL_ALLOWED_DOMAIN, 'ログイン・編集を許可するドメイン'],
    ['SPREADSHEET_ID', PORTAL_EXPECTED_SPREADSHEET_ID, '管理Sheet ID'],
    ['COMPLETION_RULE', '0-100', '完成度: 進捗、Bug、更新頻度'],
    ['USABILITY_RULE', '易/普通/難', '利用・再利用の難しさ'],
    ['TIME_ZONE', 'Asia/Tokyo', '表示・保存・判定の基準時区'],
  ];
  sheet.getRange(2, 1, rows.length, PORTAL_SETTING_HEADERS.length).setValues(rows);
}

function PORTAL_applyValidations_(taskSheet, resourceSheet, submissionSheet) {
  const scoreRule = SpreadsheetApp.newDataValidation().requireNumberBetween(0, 100).setAllowInvalid(false).build();
  const easyRule = SpreadsheetApp.newDataValidation().requireValueInList(['易', '普通', '難'], true).setAllowInvalid(false).build();
  const typeRule = SpreadsheetApp.newDataValidation().requireValueInList(['Tampermonkey', 'Google Apps Script', 'HTML', 'Google Sheet', 'Web App', 'AI操作マニュアル', 'その他'], true).setAllowInvalid(true).build();
  const installRule = SpreadsheetApp.newDataValidation().requireValueInList(['クリックしてインストール', 'AIマニュアルで導入', 'GSと同じプロジェクトへ追加', '参考テンプレートを開く', '参考データを開く', 'Web Appを開く', '既存APPを開く', '既存Sheetで使用', 'ファイルをダウンロード'], true).setAllowInvalid(true).build();
  const statusRule = SpreadsheetApp.newDataValidation().requireValueInList(['審査中', '確認中', '公開', '保留', '却下'], true).setAllowInvalid(false).build();

  taskSheet.getRange(2, 5, Math.max(taskSheet.getMaxRows() - 1, 1), 1).setDataValidation(scoreRule);
  taskSheet.getRange(2, 7, Math.max(taskSheet.getMaxRows() - 1, 1), 1).setDataValidation(easyRule);
  resourceSheet.getRange(2, 4, Math.max(resourceSheet.getMaxRows() - 1, 1), 1).setDataValidation(typeRule);
  resourceSheet.getRange(2, 6, Math.max(resourceSheet.getMaxRows() - 1, 1), 1).setDataValidation(installRule);
  submissionSheet.getRange(2, 10, Math.max(submissionSheet.getMaxRows() - 1, 1), 1).setDataValidation(statusRule);
}

function PORTAL_formatTaskSheet_(sheet) {
  if (sheet.getLastRow() < 2) return;
  sheet.getRange(2, 5, sheet.getLastRow() - 1, 1).setNumberFormat('0"%"');
  sheet.getRange(2, 12, sheet.getLastRow() - 1, 1).setNumberFormat('0');
}

function PORTAL_existingIds_(sheet) {
  const ids = new Set();
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues().forEach((row) => {
      if (row[0]) ids.add(row[0]);
    });
  }
  return ids;
}

function PORTAL_taskRow_(item) {
  return [item.id, item.name, item.description, item.category, item.completion, item.completionStatus, item.usability, item.difficulty, item.manager, item.users, item.lastVerified, item.order, item.manualFile];
}

function PORTAL_resourceRow_(item) {
  return [item.id, item.taskId, item.name, item.type, item.requiredTools, item.installMode, item.url, item.source, item.note, item.order];
}

function PORTAL_readTasksWithResources_() {
  const tasks = PORTAL_readTasks_();
  const resourceMap = {};
  PORTAL_readResources_().forEach((item) => {
    const taskId = item['タスクID'];
    if (!resourceMap[taskId]) resourceMap[taskId] = [];
    resourceMap[taskId].push(item);
  });
  tasks.forEach((item) => { item.resources = resourceMap[item['タスクID']] || []; });
  return tasks;
}

function PORTAL_readTasks_() {
  const rows = PORTAL_readObjects_('タスク一覧', PORTAL_TASK_HEADERS);
  return rows.sort((a, b) => Number(a['表示順'] || 9999) - Number(b['表示順'] || 9999));
}

function PORTAL_readResources_() {
  const rows = PORTAL_readObjects_('タスクリソース', PORTAL_RESOURCE_HEADERS);
  return rows.sort((a, b) => Number(a['表示順'] || 9999) - Number(b['表示順'] || 9999));
}

function PORTAL_readObjects_(sheetName, expectedHeaders) {
  const sheet = PORTAL_getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(1, 1, sheet.getLastRow(), expectedHeaders.length).getDisplayValues();
  const headers = values.shift();
  return values.filter((row) => PORTAL_text_(row[0])).map((row, rowIndex) => {
    const item = {};
    headers.forEach((header, index) => { item[header] = row[index]; });
    item.__sheetRow = rowIndex + 2;
    return item;
  });
}

function PORTAL_getTaskForEdit_(taskId) {
  const id = PORTAL_text_(taskId);
  if (!id) {
    return {
      task: { 'タスクID': '', 'タスク名': '', '説明': '', 'カテゴリ': '', '完成度': '0', '完成状況・更新理由': '', '易用度': '普通', '利用難易度': '', '担当者': 'Sha', '利用者・利用部署': 'カスタマー', '最終動作確認日': '', '表示順': String(PORTAL_readTasks_().length + 1), 'AI操作マニュアルMD': '' },
      resources: [],
      manual: { taskId: '', taskName: '', fileName: '', markdown: '' },
    };
  }
  const taskItem = PORTAL_readTaskById_(id);
  if (!taskItem) throw new Error('対象タスクが見つかりません: ' + id);
  return {
    task: taskItem,
    resources: PORTAL_readResources_().filter((item) => item['タスクID'] === id),
    manual: PORTAL_readManual_(id) || { taskId: id, taskName: taskItem['タスク名'], fileName: taskItem['AI操作マニュアルMD'], markdown: '' },
  };
}

function PORTAL_saveTask_(input, editorEmail) {
  const data = input || {};
  const isNew = !PORTAL_text_(data.taskId);
  const id = isNew ? PORTAL_newId_('TASK') : PORTAL_limitText_(data.taskId, 120);
  const name = PORTAL_limitText_(data.name, 160);
  const description = PORTAL_limitText_(data.description, 600);
  if (!name || !description) throw new Error('タスク名と説明を入力してください。');

  const manualFile = PORTAL_limitText_(data.manualFile, 260) || id + '_' + PORTAL_safeFileName_(name) + '_AI操作マニュアル.md';
  const taskValues = [[
    id, name, description,
    PORTAL_limitText_(data.category, 100),
    PORTAL_score_(data.completion, '完成度'),
    PORTAL_limitText_(data.completionStatus, 1600),
    PORTAL_usability_(data.usability),
    PORTAL_limitText_(data.difficulty, 1200),
    PORTAL_limitText_(data.manager, 120) || 'Sha',
    PORTAL_limitText_(data.users, 300) || 'カスタマー',
    PORTAL_limitText_(data.lastVerified, 40),
    PORTAL_order_(data.order),
    manualFile,
  ]];
  const resources = Array.isArray(data.resources) ? data.resources.slice(0, 50) : [];

  const normalizedResources = resources.map((entry, index) => {
    const resourceName = PORTAL_limitText_(entry.name, 180);
    if (!resourceName) throw new Error('リソース名を入力してください。');
    return {
      id: PORTAL_limitText_(entry.resourceId, 140) || PORTAL_newId_('RES'),
      taskId: id,
      name: resourceName,
      type: PORTAL_limitText_(entry.type, 80),
      requiredTools: PORTAL_limitText_(entry.requiredTools, 500),
      installMode: PORTAL_limitText_(entry.installMode, 160),
      url: PORTAL_distributionUrl_(entry.url),
      source: PORTAL_limitText_(entry.source, 1600),
      note: PORTAL_limitText_(entry.note, 1600),
      order: index + 1,
    };
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = PORTAL_getSpreadsheet_();
    const taskSheet = ss.getSheetByName('タスク一覧');
    const existingRow = PORTAL_findRowById_(taskSheet, id);
    if (isNew && existingRow) throw new Error('同じタスクIDが存在します。');
    if (!isNew && !existingRow) throw new Error('対象タスクが見つかりません: ' + id);
    const row = existingRow || taskSheet.getLastRow() + 1;
    taskSheet.getRange(row, 1, 1, PORTAL_TASK_HEADERS.length).setValues(taskValues);
    taskSheet.getRange(row, 5).setNumberFormat('0"%"');

    const resourceSheet = ss.getSheetByName('タスクリソース');
    const oldResources = PORTAL_readResources_().filter((item) => item['タスクID'] === id);
    const newIds = new Set(normalizedResources.map((item) => item.id));
    const removed = oldResources.filter((item) => !newIds.has(item['リソースID']));
    if (removed.length) PORTAL_archiveResourceObjects_(ss, removed, editorEmail);
    oldResources.sort((a, b) => b.__sheetRow - a.__sheetRow).forEach((item) => resourceSheet.deleteRow(item.__sheetRow));
    if (normalizedResources.length) {
      const values = normalizedResources.map((item) => PORTAL_resourceRow_(item));
      resourceSheet.getRange(resourceSheet.getLastRow() + 1, 1, values.length, PORTAL_RESOURCE_HEADERS.length).setValues(values);
    }

    const manualSheet = ss.getSheetByName('AIマニュアル');
    const manualRow = PORTAL_findRowById_(manualSheet, id);
    const manualValues = [[id, name, manualFile, PORTAL_limitText_(data.manualMarkdown, 50000), new Date()]];
    const targetManualRow = manualRow || manualSheet.getLastRow() + 1;
    manualSheet.getRange(targetManualRow, 1, 1, PORTAL_MANUAL_HEADERS.length).setValues(manualValues);
    manualSheet.getRange(targetManualRow, 5).setNumberFormat('yyyy/MM/dd HH:mm');
    return PORTAL_readTaskById_(id);
  } finally {
    lock.releaseLock();
  }
}

function PORTAL_archiveTask_(taskId, editorEmail) {
  const id = PORTAL_limitText_(taskId, 120);
  if (!id) throw new Error('タスクIDがありません。');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = PORTAL_getSpreadsheet_();
    const taskSheet = ss.getSheetByName('タスク一覧');
    const taskRow = PORTAL_findRowById_(taskSheet, id);
    if (!taskRow) throw new Error('対象タスクが見つかりません: ' + id);
    const now = new Date();
    const taskValues = taskSheet.getRange(taskRow, 1, 1, PORTAL_TASK_HEADERS.length).getValues()[0];
    PORTAL_appendArchive_(ss, '削除済みタスク', PORTAL_ARCHIVE_TASK_HEADERS, [now, editorEmail].concat(taskValues));

    const resourceSheet = ss.getSheetByName('タスクリソース');
    const resources = PORTAL_readResources_().filter((item) => item['タスクID'] === id);
    PORTAL_archiveResourceObjects_(ss, resources, editorEmail, now);
    resources.sort((a, b) => b.__sheetRow - a.__sheetRow).forEach((item) => resourceSheet.deleteRow(item.__sheetRow));

    const manualSheet = ss.getSheetByName('AIマニュアル');
    const manualRow = PORTAL_findRowById_(manualSheet, id);
    if (manualRow) {
      const manualValues = manualSheet.getRange(manualRow, 1, 1, PORTAL_MANUAL_HEADERS.length).getValues()[0];
      PORTAL_appendArchive_(ss, '削除済みマニュアル', PORTAL_ARCHIVE_MANUAL_HEADERS, [now, editorEmail].concat(manualValues));
      manualSheet.deleteRow(manualRow);
    }
    taskSheet.deleteRow(taskRow);
    return { ok: true, taskId: id };
  } finally {
    lock.releaseLock();
  }
}

function PORTAL_archiveResourceObjects_(ss, resources, editorEmail, now) {
  if (!resources.length) return;
  const timestamp = now || new Date();
  resources.forEach((item) => {
    const values = PORTAL_RESOURCE_HEADERS.map((header) => item[header]);
    PORTAL_appendArchive_(ss, '削除済みリソース', PORTAL_ARCHIVE_RESOURCE_HEADERS, [timestamp, editorEmail].concat(values));
  });
}

function PORTAL_appendArchive_(ss, name, headers, values) {
  const sheet = PORTAL_getOrCreateArchiveSheet_(ss, name, headers);
  sheet.appendRow(values);
}

function PORTAL_getOrCreateArchiveSheet_(ss, name, headers) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#5f6368').setFontColor('#ffffff');
  return sheet;
}

function PORTAL_readTaskById_(taskId) {
  return PORTAL_readTasksWithResources_().find((item) => item['タスクID'] === taskId) || null;
}

function PORTAL_readResourceById_(resourceId) {
  const id = PORTAL_text_(resourceId);
  return PORTAL_readResources_().find((item) => item['リソースID'] === id) || null;
}

function PORTAL_findRowById_(sheet, id) {
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
  for (let index = 0; index < values.length; index += 1) {
    if (values[index][0] === id) return index + 2;
  }
  return 0;
}

function PORTAL_readGuides_() {
  return PORTAL_readObjects_('利用ガイド', PORTAL_GUIDE_HEADERS).map((item) => ({
    id: item['ガイドID'], title: item['タイトル'], summary: item['概要'], fileName: item['MDファイル名'],
  }));
}

function PORTAL_readGuideManual_(guideId) {
  const id = PORTAL_text_(guideId);
  const item = PORTAL_readObjects_('利用ガイド', PORTAL_GUIDE_HEADERS).find((row) => row['ガイドID'] === id);
  if (!item) return null;
  return { taskId: id, taskName: item['タイトル'], fileName: item['MDファイル名'], markdown: item['マニュアル本文'] };
}

function PORTAL_readManual_(taskId) {
  const sheet = PORTAL_getSpreadsheet_().getSheetByName('AIマニュアル');
  const row = PORTAL_findRowById_(sheet, taskId);
  if (!row) return null;
  const values = sheet.getRange(row, 1, 1, PORTAL_MANUAL_HEADERS.length).getDisplayValues()[0];
  return { taskId: values[0], taskName: values[1], fileName: values[2], markdown: values[3], updatedAt: values[4] };
}

function PORTAL_score_(value, label) {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error(label + 'は0〜100で入力してください。');
  return Math.round(score);
}

function PORTAL_usability_(value) {
  const text = PORTAL_text_(value);
  if (['易', '普通', '難'].indexOf(text) === -1) throw new Error('易用度は「易・普通・難」から選択してください。');
  return text;
}

function PORTAL_order_(value) {
  const order = Number(value);
  return Number.isFinite(order) && order > 0 ? Math.round(order) : 9999;
}

function PORTAL_newId_(prefix) {
  return prefix + '-' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMddHHmmss') + '-' + Utilities.getUuid().slice(0, 8);
}

function PORTAL_safeFileName_(value) {
  return PORTAL_text_(value).replace(/[\\\/:*?"<>|]/g, '_').slice(0, 120);
}
