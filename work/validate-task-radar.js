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
  if (pattern === 'H') return String(Number(parts.hour));
  if (pattern === 'yyyy/MM/dd HH:mm') return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
  if (pattern === 'yyyy-MM-dd') return `${parts.year}-${parts.month}-${parts.day}`;
  if (pattern === 'yyyyMMddHHmm') return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`;
  if (pattern === "yyyy-MM-dd'T'HH:mm") return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  if (pattern === "yyyy-MM-dd'T'HH:mm:ssXXX") return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00+09:00`;
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
  const values = new Array(39).fill('');
  values[0] = overrides.status || '待确认';
  values[1] = overrides.title || '测试任务';
  values[2] = overrides.category || '';
  values[3] = overrides.priority || '中';
  values[7] = overrides.waitingFor || '';
  values[8] = overrides.lastUpdated === undefined ? '2026/08/21' : overrides.lastUpdated;
  values[18] = overrides.id || 'task-id';
  values[19] = overrides.remindAt || '';
  values[20] = Boolean(overrides.pinned);
  values[23] = overrides.deadline || '';
  values[25] = Boolean(overrides.syncCalendar);
  values[30] = overrides.calendarReminderAt || '';
  values[31] = overrides.calendarGuestEmails || '';
  values[32] = Boolean(overrides.slackDmEnabled);
  values[33] = overrides.slackDmRecipientNames || '';
  values[35] = overrides.slackDmSendAt || '';
  values[36] = overrides.slackDmText || '';
  values[37] = overrides.slackDmScheduleRecords || '';
  values[38] = overrides.tags || '';
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
if (!html.includes('立即同步 Slack') || !html.includes('.syncSlackEventsFromDashboard()')) {
  throw new Error('manual Slack queue sync UI is missing');
}
if (!html.includes('标签筛选') || !html.includes('taskExistingTagSelect') ||
    !html.includes('taskNewTagInput') || !html.includes('activeTags')) {
  throw new Error('multi-tag task filtering UI is missing');
}
if (!html.includes('已完成') || !html.includes('回收站') ||
    !html.includes('恢复任务') || !html.includes('恢复到待整理')) {
  throw new Error('completed and trash recovery UI is missing');
}
if (!html.includes('max-height: calc(100dvh - 40px)') || !html.includes('overflow-y: auto')) {
  throw new Error('task modal must remain vertically scrollable');
}
if (html.includes("if (event.target.id === 'editModal') closeEditModal()") ||
    html.includes("if (event.target.id === 'linkModal') closeLinkModal()")) {
  throw new Error('modal must not close when the backdrop is clicked');
}
if (!html.includes('runInboxUpdate(Object.assign(payload, { taskId: editingTaskId, action: \'convert\' }), closeEditModal)') ||
    (html.match(/closeEditModal\(\);/g) || []).length < 2) {
  throw new Error('task editor must close only after a successful save');
}
if (!html.includes("document.getElementById('saveEdit').disabled = isBusy")) {
  throw new Error('task editor save button must be disabled while saving');
}
if (html.includes('tasks.map(taskCard)')) {
  throw new Error('active task cards must not receive the array index as completed mode');
}
if (!html.includes('关联现有任务') || !html.includes('applySlackUpdate')) {
  throw new Error('Slack task linking UI is missing');
}
if (!html.includes('截止日期（DL）') || !html.includes('创建 Google Calendar 弹窗提醒') ||
    !html.includes('提醒日期和时间（必须人工填写）') || !html.includes('同事邮箱（日历邀请）') ||
    !html.includes('以我的个人 Slack 账号预约 DM') || !html.includes('Slack DM 原文（不会自动生成）')) {
  throw new Error('deadline and Calendar controls are missing');
}
if (html.includes('taskCategoryInput')) {
  throw new Error('legacy category input must not remain in the task editor');
}

const normalized = context.normalizeDashboardTaskInput_({ title: '手动任务', priority: '高' });
if (normalized.title !== '手动任务' || normalized.category !== '未分类') {
  throw new Error('manual task normalization failed');
}
const taggedTask = context.normalizeDashboardTaskInput_({
  title: '标签任务', priority: '中', tags: '#中国, PokerWeb，戦国, 中国'
});
if (taggedTask.tags !== '中国, PokerWeb, 戦国') {
  throw new Error('task tag normalization failed');
}
const tournamentTagCases = [
  ['【JOPT 2026 Tokyo #03】事前予約', 'JOPT TOKYO'],
  ['JOPT GRAND FINAL', 'JOPT TOKYO'],
  ['JOPT 2027 Fukuoka #02', 'JOPT FUKUOKA'],
  ['SPADIE Osaka 2nd', 'SPADIE OSAKA'],
  ['戦国ポーカーツアー 2026 -秋の陣-', '戦国'],
  ['戦国ポーカーツアー 春の陣', '戦国'],
  ['JOPT MASTER 2026', 'master'],
  ['U30 POKER CHAMPIONSHIP #04', 'U-30'],
  ['ABC Poker Tour 2026 Osaka #2', 'ABC POKER TOUR OSAKA']
];
tournamentTagCases.forEach(([input, expected]) => {
  const actual = context.inferTournamentTags_(input);
  if (actual !== expected) throw new Error(`tournament tag expected ${expected}, got ${actual}`);
});
const autoTaggedManualTask = context.normalizeDashboardTaskInput_({
  title: 'JOPT 2026 Sapporo #02 受付準備', tags: '受付'
});
if (autoTaggedManualTask.tags !== '受付, JOPT SAPPORO') {
  throw new Error('manual task tournament tag inference failed');
}
const legacyCategoryTask = context.dashboardTaskFromRow_(row({
  category: '国际・中文', tags: '中国, JOPT #03'
}), 2, now);
if (legacyCategoryTask.tags !== '国际・中文, 中国, JOPT #03') {
  throw new Error('legacy category must be exposed as a normal tag');
}
if (context.mergeDashboardTags_('客户支持', 'false, 频道: jopt_tokyo_全体, JOPT TOKYO') !== '客户支持, JOPT TOKYO') {
  throw new Error('legacy false and channel metadata must not become tags');
}
const migratedCategoryTask = context.normalizeDashboardTaskInput_({
  title: '旧分类迁移', category: '客户支持', tags: 'PokerWeb'
});
if (migratedCategoryTask.category !== '未分类' || migratedCategoryTask.tags !== '客户支持, PokerWeb') {
  throw new Error('legacy category must migrate into tags when saved');
}
const recentCompletedValues = row({ status: '已完成', lastUpdated: '2026/08/21' });
recentCompletedValues[15] = 'C1';
recentCompletedValues[22] = '任务';
if (context.taskFromValues_(recentCompletedValues, 2).ignored) {
  throw new Error('recent completed Slack task must remain trackable for 90 days');
}
const oldCompletedValues = row({ status: '已完成', lastUpdated: '2026/01/01' });
oldCompletedValues[15] = 'C1';
oldCompletedValues[22] = '任务';
if (!context.taskFromValues_(oldCompletedValues, 2).ignored) {
  throw new Error('completed Slack task older than 90 days must stop tracking');
}
if (!source.includes('isDirectTask') || !source.includes('isLinkedThread')) {
  throw new Error('Slack update adoption must support direct and linked tasks');
}
const deadlineTask = context.normalizeDashboardTaskInput_({
  title: '交稿', priority: '中', deadline: '2026-08-27', syncCalendar: true,
  calendarReminderAt: '2026-09-04T09:00',
  calendarGuestEmails: 'COLLEAGUE@example.com, colleague@example.com; second@example.com'
});
if (deadlineTask.deadline !== '2026-08-27' || !deadlineTask.syncCalendar ||
    deadlineTask.calendarReminderAt !== '2026-09-04T09:00' ||
    deadlineTask.calendarGuestEmails !== 'colleague@example.com, second@example.com') {
  throw new Error('deadline normalization failed');
}
const noCalendarTask = context.normalizeDashboardTaskInput_({
  title: '不自动提醒', priority: '中', syncCalendar: false,
  calendarReminderAt: '2026-09-04T09:00', calendarGuestEmails: 'ignored@example.com'
});
if (noCalendarTask.calendarReminderAt !== '' || noCalendarTask.calendarGuestEmails !== '') {
  throw new Error('disabled Calendar must not retain automatic reminder settings');
}
if (source.includes('resetRemindersToDefault') ||
    !source.includes("overrides: [{ method: 'popup', minutes: 0 }]")) {
  throw new Error('Calendar default reminders must never be enabled automatically');
}
const futureSlackDmAt = formatDate(new Date(Date.now() + 24 * 60 * 60 * 1000), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm");
const slackDmTask = context.normalizeDashboardTaskInput_({
  title: 'DM提醒', priority: '中', slackDmEnabled: true,
  slackDmRecipientNames: 'ピヴォ / Fumiya Aizawa, ピヴォ',
  slackDmSendAt: futureSlackDmAt,
  slackDmText: '这是人工填写的原文。'
});
if (slackDmTask.slackDmRecipientNames !== 'ピヴォ / Fumiya Aizawa' ||
    slackDmTask.slackDmSendAt !== futureSlackDmAt ||
    slackDmTask.slackDmText !== '这是人工填写的原文。') {
  throw new Error('personal Slack DM normalization failed');
}
let groupRejected = false;
try {
  context.normalizeSlackDmRecipientNames_('@CS / Fumiya Aizawa');
} catch (error) {
  groupRejected = /用户组/.test(String(error));
}
if (!groupRejected) throw new Error('Slack user groups must not be expanded into DMs');
vm.runInContext(`SLACK_CACHE_.allUsers = [
  { id: 'UPIVO', real_name: 'Pivo', profile: { real_name: 'Pivo', display_name: 'ピヴォ' } },
  { id: 'UFUMIYA', real_name: 'Fumiya Aizawa', profile: { real_name: 'Fumiya Aizawa', display_name: '' } }
]`, context);
const resolvedSlackUsers = context.resolveSlackUsersByFormalNames_('ピヴォ / Fumiya Aizawa');
if (resolvedSlackUsers.map(user => user.id).join(',') !== 'UPIVO,UFUMIYA') {
  throw new Error('Slack formal-name exact matching failed');
}
if (!source.includes("slackApiPost_('chat.scheduleMessage'") ||
    !source.includes("slackApiPost_('chat.deleteScheduledMessage'")) {
  throw new Error('Slack scheduled DM create/cancel implementation is missing');
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
if (!capturedSlackRow || capturedSlackRow.length !== 39 || capturedSlackRow[27] !== '12.000001') {
  throw new Error('new Slack row schema is not A:AM');
}

const manualLinkedRow = row({ id: 'manual-linked', title: 'hendon比赛反映' });
manualLinkedRow[22] = '任务';
const relationRow = new Array(39).fill('');
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
if (context.dashboardHasSlackDmSchedule_(false) ||
    context.dashboardHasSlackDmSchedule_('false') ||
    context.dashboardHasSlackDmSchedule_('[]') ||
    !context.dashboardHasSlackDmSchedule_(JSON.stringify([{
      channel: 'U123', scheduledMessageId: 'Q123'
    }]))) {
  throw new Error('Slack DM scheduled badge validation failed');
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
    vm.runInContext('CONFIG.SHEET_HEADERS[29]', context) !== 'Slack 最新进展摘要' ||
    vm.runInContext('CONFIG.SHEET_HEADERS[30]', context) !== 'Calendar 提醒时间' ||
    vm.runInContext('CONFIG.SHEET_HEADERS[31]', context) !== 'Calendar 同事邮箱' ||
    vm.runInContext('CONFIG.SHEET_HEADERS[32]', context) !== 'Slack DM 提醒' ||
    vm.runInContext('CONFIG.SHEET_HEADERS[37]', context) !== 'Slack Scheduled Message Records' ||
    vm.runInContext('CONFIG.SHEET_HEADERS[38]', context) !== '标签') {
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

const taskSlackRow = new Array(39).fill('');
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
    vm.runInContext('CONFIG.EVENT_TRIGGER_EVERY_HOURS', context) !== 2) {
  throw new Error('Slack event queue processor is missing');
}
if (typeof context.syncSlackEventsFromDashboard !== 'function') {
  throw new Error('manual Slack event sync helper is missing');
}
if (vm.runInContext('CONFIG.AUTOMATIC_POLLING_START_HOUR', context) !== 10 ||
    vm.runInContext('CONFIG.AUTOMATIC_POLLING_END_HOUR', context) !== 19) {
  throw new Error('automatic polling window configuration is incorrect');
}
if (context.isAutomaticPollingWindowOpen_(new Date('2026-09-04T00:59:00.000Z')) ||
    !context.isAutomaticPollingWindowOpen_(new Date('2026-09-04T01:00:00.000Z')) ||
    !context.isAutomaticPollingWindowOpen_(new Date('2026-09-04T09:59:00.000Z')) ||
    context.isAutomaticPollingWindowOpen_(new Date('2026-09-04T10:00:00.000Z'))) {
  throw new Error('automatic polling window boundary is incorrect');
}
if (context.skipScheduledRunOutsidePollingWindow_(null, 'manual-test')) {
  throw new Error('manual polling should not be time restricted');
}

console.log('task radar validation passed');
