const fs = require('fs');
const path = require('path');
const vm = require('vm');

const project = path.resolve(__dirname, '..', 'apps-script', 'slack-task-scanner');
const files = ['Config.gs', 'Code.gs', 'Slack.gs', 'Classifier.gs', 'Sheet.gs', 'Calendar.gs', 'Dashboard.gs'];
const source = files.map(file => fs.readFileSync(path.join(project, file), 'utf8')).join('\n');

function formatDate(date, zone, pattern) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  if (pattern === 'yyyy,M,d') return `${parts.year},${Number(parts.month)},${Number(parts.day)}`;
  if (pattern === 'yyyy/MM/dd HH:mm') return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
  if (pattern === 'yyyy-MM-dd') return `${parts.year}-${parts.month}-${parts.day}`;
  return `${parts.year}/${parts.month}/${parts.day}`;
}

const context = {
  console,
  Utilities: {
    formatDate,
    getUuid: () => 'test-uuid',
    sleep: () => {}
  }
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'slack-task-scanner.gs' });

const now = new Date('2026-08-21T04:00:00.000Z');
function row(overrides = {}) {
  const values = new Array(30).fill('');
  values[0] = overrides.status || '待确认';
  values[1] = overrides.title || '测试任务';
  values[3] = overrides.priority || '中';
  values[7] = overrides.waitingFor || '';
  values[8] = overrides.lastUpdated === undefined ? '2026/08/21' : overrides.lastUpdated;
  values[18] = overrides.id || 'task-id';
  values[19] = overrides.remindAt || '';
  values[20] = Boolean(overrides.pinned);
  values[23] = overrides.deadline || '';
  values[25] = Boolean(overrides.syncCalendar);
  return values;
}

const cases = [
  [row({ status: '已完成' }), 'completed'],
  [row({ pinned: true }), 'now'],
  [row({ waitingFor: '负责人' }), 'waiting'],
  [row({ lastUpdated: '2026/08/01' }), 'forgotten'],
  [row({ priority: '高' }), 'now'],
  [row({ deadline: '2026/08/23' }), 'now'],
  [row({ deadline: '2026/09/30' }), 'backlog'],
  [row({}), 'backlog'],
  [row({ remindAt: '2026/08/21 15:00', deadline: '2026/08/21' }), 'snoozed']
];

for (const [values, expected] of cases) {
  const actual = context.dashboardTaskFromRow_(values, 2, now).lane;
  if (actual !== expected) throw new Error(`lane expected ${expected}, got ${actual}`);
}

const tomorrow = context.tomorrowMorningTokyo_(now);
if (formatDate(tomorrow, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') !== '2026/08/22 09:00') {
  throw new Error('tomorrow reminder is not 09:00 Asia/Tokyo');
}

const html = fs.readFileSync(path.join(project, 'Index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('Index.html script block not found');
new Function(scriptMatch[1]);

if (!html.includes('任务雷达') || !html.includes('现在做') || !html.includes('等回复')) {
  throw new Error('Chinese dashboard labels are missing');
}
if (!html.includes('＋ 新建任务') || !html.includes('.createTaskFromDashboard(payload)')) {
  throw new Error('manual task creation UI is missing');
}
if (!html.includes('Slack 待整理') || !html.includes('.updateSlackInboxFromDashboard(payload)')) {
  throw new Error('Slack inbox UI is missing');
}
if (!html.includes('关联现有任务') || !html.includes('applySlackUpdate')) {
  throw new Error('Slack task linking UI is missing');
}
if (!html.includes('截止日期（DL）') || !html.includes('同步到 Google Calendar')) {
  throw new Error('deadline and Calendar controls are missing');
}
if (html.includes("['completed', '已完成'")) {
  throw new Error('completed task filter must stay hidden from the dashboard');
}

const normalized = context.normalizeDashboardTaskInput_({ title: '手动任务', priority: '高' });
if (normalized.title !== '手动任务' || normalized.category !== '未分类') {
  throw new Error('manual task normalization failed');
}
const deadlineTask = context.normalizeDashboardTaskInput_({
  title: '交稿', priority: '中', deadline: '2026-08-27', syncCalendar: true
});
if (deadlineTask.deadline !== '2026-08-27' || !deadlineTask.syncCalendar) {
  throw new Error('deadline normalization failed');
}

const extractedTitle = context.extractSlackThreadTitle_(
  '【プライズ】付与時の一部付与作業自動化\n進捗確認です。',
  '今日テスト可能ならPGチームに行ってお願いして動作確認してみようか'
);
if (extractedTitle !== '【プライズ】付与時の一部付与作業自動化') {
  throw new Error('Slack thread title extraction failed');
}

const participationHit = context.prepareParticipationHit_({
  slackType: '我参与的主题', requesterId: 'U0ANUSDNVMK', messageTs: '10.000001', text: '我来确认'
}, [
  { ts: '10.000001', user: 'U0ANUSDNVMK', text: '我来确认' },
  { ts: '11.000001', user: 'UOTHER', text: '先确认官方 Facebook' },
  { ts: '12.000001', user: 'UOTHER', text: '没有的话用个人账号联系' }
]);
if (participationHit.requesterId !== 'UOTHER' ||
    !participationHit.text.includes('先确认官方 Facebook') ||
    !participationHit.text.includes('没有的话用个人账号联系')) {
  throw new Error('participated thread latest instructions were not selected');
}

let capturedSlackRow = null;
context.SpreadsheetApp = {
  newDataValidation: () => ({ requireCheckbox: () => ({ build: () => ({}) }) })
};
const fakeRange = {
  setValues: values => { capturedSlackRow = values[0]; return fakeRange; },
  setDataValidation: () => fakeRange,
  setValue: () => fakeRange
};
const fakeSheet = { getLastRow: () => 1, getRange: () => fakeRange };
context.upsertTask_(fakeSheet, null, {
  slackType: '我参与的主题', permalink: 'https://example.slack.com/thread',
  messageTs: '11.000001', threadTs: '10.000001', channelId: 'C1', requesterId: 'UOTHER',
  thread: [{ ts: '10.000001', user: 'U0ANUSDNVMK', text: '主题' }, { ts: '12.000001', user: 'UOTHER', text: '下一步' }]
}, {
  sheetStatus: '待确认', title: '主题', category: '', priority: '中', nextAction: '下一步',
  completion: '', waitingFor: '对方', memo: '测试'
});
if (!capturedSlackRow || capturedSlackRow.length !== 30 || capturedSlackRow[27] !== '12.000001') {
  throw new Error('new Slack row schema is not A:AD');
}

const manualLinkedRow = row({ id: 'manual-linked', title: 'hendon比赛反映' });
manualLinkedRow[22] = '任务';
const relationRow = new Array(30).fill('');
relationRow[0] = '待确认';
relationRow[1] = '【Hendon Mob 掲載状況について】';
relationRow[3] = '中';
relationRow[8] = '2026/08/21';
relationRow[12] = 'https://example.slack.com/hendon';
relationRow[15] = 'C0924RS04CU';
relationRow[18] = 'slack-hendon';
relationRow[22] = '关联';
relationRow[26] = 'manual-linked';
relationRow[27] = '1787286932.743459';
relationRow[28] = true;
relationRow[29] = '使用 Facebook 联系 Hendon Mob';
const dashboardRows = [manualLinkedRow, relationRow];
const dashboardRange = { getValues: () => dashboardRows };
context.getTaskSheet_ = () => ({ getLastRow: () => 3, getRange: () => dashboardRange });
context.ensureSheetStructure_ = () => {};
const linkedDashboard = context.getTaskDashboardData();
if (linkedDashboard.tasks.length !== 1 || linkedDashboard.tasks[0].linkedThreads.length !== 1 ||
    !linkedDashboard.tasks[0].hasSlackUpdate || linkedDashboard.counts.slackUpdates !== 1) {
  throw new Error('linked Slack thread was not aggregated into the manual task');
}
if (context.extractMessageTsFromUrl_('https://example.slack.com/archives/C1/p1787036144932059') !== '1787036144.932059') {
  throw new Error('Slack permalink message ts recovery failed');
}

const waitingTask = context.dashboardTaskFromRow_(row({ waitingFor: '领导' }), 2, now);
if (waitingTask.waitingFor !== '领导') {
  throw new Error('waiting-for label must preserve its original text');
}

if (vm.runInContext('CONFIG.SHEET_HEADERS[0]', context) !== '状态') {
  throw new Error('Chinese Sheet headers are missing');
}
if (vm.runInContext('CONFIG.SHEET_HEADERS[22]', context) !== '处理阶段') {
  throw new Error('processing stage backend column is missing');
}
if (vm.runInContext('CONFIG.SHEET_HEADERS[23]', context) !== '截止日期' ||
    vm.runInContext('CONFIG.SHEET_HEADERS[25]', context) !== '同步日历') {
  throw new Error('deadline backend columns are missing');
}
if (vm.runInContext('CONFIG.SHEET_HEADERS[26]', context) !== '关联任务 ID' ||
    vm.runInContext('CONFIG.SHEET_HEADERS[29]', context) !== 'Slack 最新进展摘要') {
  throw new Error('Slack link backend columns are missing');
}
if (!context.isExcludedSlackChannel_('C093Z293J5N') || context.isExcludedSlackChannel_('C0924RS04CU')) {
  throw new Error('Slack exclusion list is incorrect');
}

const manifest = JSON.parse(fs.readFileSync(path.join(project, 'appsscript.json'), 'utf8'));
if (manifest.timeZone !== 'Asia/Tokyo') throw new Error('manifest timezone mismatch');
if (!manifest.oauthScopes.includes('https://www.googleapis.com/auth/calendar')) {
  throw new Error('Calendar OAuth scope is missing');
}
if (typeof context.refreshSlackInboxTitles !== 'function') {
  throw new Error('Slack inbox title refresh helper is missing');
}
if (typeof context.collectTrackedSlackHits_ !== 'function') {
  throw new Error('tracked Slack thread refresh helper is missing');
}

console.log('task radar validation passed');
