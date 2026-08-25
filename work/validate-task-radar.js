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
if (!context.isFullScanSlackChannel_('C0924RS04CU') ||
    vm.runInContext('CONFIG.CS_FULL_SCAN_LOOKBACK_HOURS', context) !== 6) {
  throw new Error('CS full-scan configuration is incorrect');
}

const regressionParentTs = '1787544000.000001';
const regressionHit = context.makeHistoryHit_('C0924RS04CU', {
  ts: regressionParentTs,
  user: 'URYO',
  text: 'PW　チケットトナメ　DBI表記について',
  reply_count: 1,
  latest_reply: '1787545807.258779'
});
const regressionThread = [
  { ts: regressionParentTs, user: 'URYO', text: 'PW　チケットトナメ　DBI表記について' },
  {
    ts: '1787545807.258779', thread_ts: regressionParentTs, user: 'URYO',
    text: '<!subteam^S092SRF3JG0>'
  }
];
const regressionCandidates = context.buildUniqueCandidates_([regressionHit]);
const regressionKey = `C0924RS04CU|${regressionParentTs}`;
if (!regressionCandidates[regressionKey] ||
    regressionCandidates[regressionKey].messageTs !== regressionParentTs ||
    regressionThread[1].text.indexOf('<!subteam^S092SRF3JG0>') === -1) {
  throw new Error('CS full-scan regression thread was not deduplicated by parent thread_ts');
}
const normalizedRegression = context.normalizeSlackMessage_(
  regressionHit,
  regressionThread,
  { id: 'C0924RS04CU', name: 'cs_カスタマーチーム' },
  { id: 'URYO', name: 'Ryo YAMAGUCHI' },
  'https://example.slack.com/thread'
);
if (normalizedRegression.uniqueKey !== regressionKey ||
    normalizedRegression.thread.length !== 2) {
  throw new Error('CS parent and replies were not normalized into one thread-level item');
}

const otherChannelCsHit = context.makeRawMentionHit_('COTHER', 'other', {
  ts: '1787545000.000001', user: 'UOTHER', text: '<!subteam^S092SRF3JG0> 確認お願いします'
}, null);
const otherChannelDirectHit = context.makeRawMentionHit_('COTHER', 'other', {
  ts: '1787545001.000001', user: 'UOTHER', text: '<@U0ANUSDNVMK> 確認お願いします'
}, null);
const otherChannelPlainHit = context.makeRawMentionHit_('COTHER', 'other', {
  ts: '1787545002.000001', user: 'UOTHER', text: '通常メッセージ'
}, null);
if (!otherChannelCsHit || otherChannelCsHit.slackType !== '@cs' ||
    !otherChannelDirectHit || otherChannelDirectHit.slackType !== '个人提及' ||
    otherChannelPlainHit !== null) {
  throw new Error('raw mention filtering for ordinary channels failed');
}

context.fetchThread_ = () => regressionThread;
const replyMentionHits = context.convertRecentChannelMessagesToMentionHits_(
  'COTHER',
  'other',
  [{
    ts: regressionParentTs,
    user: 'UOTHER',
    text: '通常の親メッセージ',
    reply_count: 1,
    latest_reply: '1787545807.258779'
  }],
  Number(regressionParentTs) - 1
);
if (replyMentionHits.length !== 1 || replyMentionHits[0].slackType !== '@cs' ||
    replyMentionHits[0].threadTs !== regressionParentTs || !replyMentionHits[0].prefetchedThread) {
  throw new Error('raw @cs mention in a recent thread reply was not collected');
}

const taskSlackRow = new Array(30).fill('');
taskSlackRow[0] = '进行中';
taskSlackRow[1] = '用户手动修改后的标题';
taskSlackRow[10] = true;
taskSlackRow[12] = 'https://example.slack.com/archives/C1/p1787544000000001';
taskSlackRow[13] = regressionParentTs;
taskSlackRow[14] = regressionParentTs;
taskSlackRow[15] = 'C0924RS04CU';
taskSlackRow[22] = '任务';
taskSlackRow[27] = regressionParentTs;
const loadedTaskRow = context.taskFromValues_(taskSlackRow, 2);
if (loadedTaskRow.ignored || loadedTaskRow.stage !== '任务') {
  throw new Error('converted Slack task row must remain trackable even when confirmed');
}
const trackedStats = {};
const trackedSheet = {
  getLastRow: () => 2,
  getRange: () => ({ getValues: () => [taskSlackRow] })
};
const trackedHits = context.collectTrackedSlackHits_(trackedSheet, trackedStats);
if (trackedHits.length !== 1 || trackedHits[0].threadTs !== regressionParentTs) {
  throw new Error('stage=任务 Slack row was not included in continued tracking');
}

const taskUpdateColumns = [];
const taskUpdateRange = {
  setValue: () => taskUpdateRange,
  setNumberFormat: () => taskUpdateRange,
  getValue: () => '任务',
  getDisplayValue: () => regressionParentTs
};
const taskUpdateSheet = {
  getRange: (rowNumber, column) => {
    taskUpdateColumns.push(column);
    return taskUpdateRange;
  }
};
context.upsertTask_(taskUpdateSheet, { rowNumber: 2, stage: '任务' }, {
  thread: [
    { ts: regressionParentTs, user: 'URYO', text: 'テーマ' },
    { ts: '1787545807.258779', user: 'URYO', text: '更新' }
  ]
}, {});
if (taskUpdateColumns.includes(2) || taskUpdateColumns.includes(3) ||
    taskUpdateColumns.includes(4) || taskUpdateColumns.includes(6)) {
  throw new Error('continued tracking overwrote a user-owned task field');
}

let historyCalls = [];
let listCalls = [];
context.slackApi_ = (method, params) => {
  listCalls.push({ method, params });
  if (!params.cursor) {
    return {
      channels: [{ id: 'C1', name: 'one' }],
      response_metadata: { next_cursor: 'channels-next' }
    };
  }
  return {
    channels: [{ id: 'C2', name: 'two' }],
    response_metadata: { next_cursor: '' }
  };
};
const listedChannels = context.listAccessibleSlackChannels_();
if (listedChannels.length !== 2 || listCalls.length !== 2 ||
    listCalls[1].params.cursor !== 'channels-next' ||
    listCalls[0].params.types !== 'public_channel,private_channel') {
  throw new Error('conversations.list cursor pagination failed');
}

context.slackApi_ = (method, params) => {
  historyCalls.push({ method, params });
  if (!params.cursor) {
    return {
      messages: [{ ts: regressionParentTs, user: 'URYO', text: 'PW　チケットトナメ　DBI表記について' }],
      response_metadata: { next_cursor: 'next-page' }
    };
  }
  return {
    messages: [{
      ts: '1787545000.000001', user: 'UOTHER', text: '別の親メッセージ'
    }],
    response_metadata: { next_cursor: '' }
  };
};
const pagedHistory = context.fetchChannelHistoryHits_('C0924RS04CU', Number(regressionParentTs) - 1);
if (historyCalls.length !== 2 || historyCalls[1].params.cursor !== 'next-page' ||
    pagedHistory.length !== 2) {
  throw new Error('conversations.history cursor pagination failed');
}

const eventThreadTs = '1500000000.000001';
const eventReplyTs = '1787545807.258779';
const eventThread = [
  { ts: eventThreadTs, user: 'UOTHER', text: '数年前の親メッセージ' },
  { ts: '1500000001.000001', thread_ts: eventThreadTs, user: 'U0ANUSDNVMK', text: '以前の自分の返信' },
  { ts: eventReplyTs, thread_ts: eventThreadTs, user: 'UOTHER', text: '今日の新しい返信' }
];
context.fetchThread_ = () => eventThread;
const eventExisting = { byKey: {}, byUrl: {} };
const eventCsHit = context.makeSlackEventHit_({
  eventId: 'Ev-cs', channelId: 'COTHER', messageTs: eventReplyTs,
  threadTs: eventThreadTs, userId: 'UOTHER', text: '<!subteam^S092SRF3JG0> 確認お願いします'
}, eventExisting, {});
if (!eventCsHit || eventCsHit.slackType !== '@cs' || eventCsHit.threadTs !== eventThreadTs) {
  throw new Error('Slack event did not discover @cs in a newly revived old thread');
}

const participatedEventHit = context.makeSlackEventHit_({
  eventId: 'Ev-participated', channelId: 'COTHER', messageTs: eventReplyTs,
  threadTs: eventThreadTs, userId: 'UOTHER', text: '今日の新しい返信'
}, eventExisting, {});
if (!participatedEventHit || participatedEventHit.slackType !== '我参与的主题' ||
    !participatedEventHit.prefetchedThread || participatedEventHit.threadTs !== eventThreadTs) {
  throw new Error('Slack event did not revive a previously participated old thread');
}

const historicalCsThread = [
  {
    ts: eventThreadTs,
    user: 'UOTHER',
    text: '<!subteam^S092SRF3JG0> 数年前の確認依頼'
  },
  {
    ts: eventReplyTs,
    thread_ts: eventThreadTs,
    user: 'UOTHER2',
    text: '今日の新しい返信（mentionなし）'
  }
];
context.fetchThread_ = () => historicalCsThread;
const historicalCsStats = context.createEventRunStats_();
const historicalCsEventHit = context.makeSlackEventHit_({
  eventId: 'Ev-historical-cs', channelId: 'COTHER', messageTs: eventReplyTs,
  threadTs: eventThreadTs, userId: 'UOTHER2', text: '今日の新しい返信（mentionなし）'
}, eventExisting, {}, historicalCsStats);
if (!historicalCsEventHit || historicalCsEventHit.slackType !== '@cs' ||
    historicalCsEventHit.threadTs !== eventThreadTs ||
    historicalCsEventHit.prefetchedThread !== historicalCsThread) {
  throw new Error('plain reply did not revive an old thread containing historical @cs');
}

const historicalDirectThread = [
  {
    ts: eventThreadTs,
    user: 'UOTHER',
    text: '<@U0ANUSDNVMK> 数年前の確認依頼'
  },
  {
    ts: eventReplyTs,
    thread_ts: eventThreadTs,
    user: 'UOTHER2',
    text: '今日の新しい返信（mentionなし）'
  }
];
context.fetchThread_ = () => historicalDirectThread;
const historicalDirectEventHit = context.makeSlackEventHit_({
  eventId: 'Ev-historical-direct', channelId: 'COTHER', messageTs: eventReplyTs,
  threadTs: eventThreadTs, userId: 'UOTHER2', text: '今日の新しい返信（mentionなし）'
}, eventExisting, {});
if (!historicalDirectEventHit || historicalDirectEventHit.slackType !== '个人提及') {
  throw new Error('plain reply did not revive an old thread containing historical direct mention');
}

context.fetchThread_ = () => [
  { ts: eventThreadTs, user: 'UOTHER', text: '関係のない親メッセージ' },
  { ts: eventReplyTs, thread_ts: eventThreadTs, user: 'UOTHER2', text: '関係のない返信' }
];
const unrelatedStats = context.createEventRunStats_();
const unrelatedEventHit = context.makeSlackEventHit_({
  eventId: 'Ev-unrelated', channelId: 'COTHER', messageTs: eventReplyTs,
  threadTs: eventThreadTs, userId: 'UOTHER2', text: '関係のない返信'
}, eventExisting, {}, unrelatedStats);
if (unrelatedEventHit !== null || unrelatedStats.ignoredReasons.unrelated_thread !== 1) {
  throw new Error('unrelated Slack event should not enter Task Radar');
}

const fullScanEventHit = context.makeSlackEventHit_({
  eventId: 'Ev-full-scan', channelId: 'C0924RS04CU', messageTs: eventReplyTs,
  threadTs: eventThreadTs, userId: 'UOTHER', text: 'CS チャンネルの返信'
}, eventExisting, {});
if (!fullScanEventHit || fullScanEventHit.slackType !== '客服频道全量') {
  throw new Error('CS full-scan channel event was not retained');
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
if (typeof context.processSlackEventQueue !== 'function' ||
    vm.runInContext('CONFIG.EVENT_TRIGGER_EVERY_MINUTES', context) !== 1) {
  throw new Error('Slack event queue processor is missing');
}

console.log('task radar validation passed');
