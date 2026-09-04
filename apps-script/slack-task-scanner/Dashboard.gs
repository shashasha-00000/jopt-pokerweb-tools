/**
 * Chinese task dashboard backed by the same Sheet used by the Slack scanner.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('任务雷达')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function setupDashboard() {
  var sheet = getTaskSheet_();
  ensureSheetStructure_(sheet);
  logRun_('INFO', '任务雷达初始化完成。', {
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    sheetName: CONFIG.SHEET_NAME
  });
}

function syncSlackEventsFromDashboard() {
  processSlackEventQueue();
  return getTaskDashboardData();
}

function getTaskDashboardData() {
  var sheet = getTaskSheet_();
  ensureSheetStructure_(sheet);

  var lastRow = sheet.getLastRow();
  var rows = lastRow < 2
    ? []
    : sheet.getRange(2, 1, lastRow - 1, CONFIG.SHEET_HEADERS.length).getValues();
  var now = new Date();
  var tasks = [];
  var inbox = [];
  var completed = [];
  var trash = [];
  var archivedCompletedCount = 0;
  var linkedByTaskId = {};

  rows.forEach(function(row, index) {
    var stage = cleanDashboardValue_(row[CONFIG.COL.PROCESSING_STAGE - 1]);
    if (stage !== '关联') return;
    var linkedTaskId = cleanDashboardValue_(row[CONFIG.COL.LINKED_TASK_ID - 1]);
    if (!linkedTaskId) return;
    if (!linkedByTaskId[linkedTaskId]) linkedByTaskId[linkedTaskId] = [];
    linkedByTaskId[linkedTaskId].push(dashboardLinkedThreadFromRow_(row, index + 2));
  });

  rows.forEach(function(row, index) {
    var stage = cleanDashboardValue_(row[CONFIG.COL.PROCESSING_STAGE - 1]);
    if (stage === '忽略') {
      var ignoredAction = cleanDashboardValue_(row[CONFIG.COL.LAST_UI_ACTION - 1]);
      if (ignoredAction.indexOf('不是任务') === 0) {
        var trashItem = dashboardInboxFromRow_(row, index + 2, now);
        if (trashItem) trash.push(trashItem);
      }
      return;
    }
    if (stage === '关联') return;
    if (stage === '待整理') {
      var inboxItem = dashboardInboxFromRow_(row, index + 2, now);
      if (inboxItem) inbox.push(inboxItem);
      return;
    }
    var task = dashboardTaskFromRow_(row, index + 2, now);
    if (task) {
      task.linkedThreads = linkedByTaskId[task.id] || [];
      task.hasSlackUpdate = dashboardBoolean_(row[CONFIG.COL.SLACK_UPDATE_PENDING - 1]) ||
        task.linkedThreads.some(function(link) { return link.updatePending; });
      if (task.lane === 'completed') {
        if (daysSinceDashboardDate_(row[CONFIG.COL.LAST_UPDATED - 1], now) <= 90 || task.hasSlackUpdate) {
          completed.push(task);
        } else {
          archivedCompletedCount += 1;
        }
      } else {
        tasks.push(task);
      }
    }
  });

  tasks.sort(compareDashboardTasks_);
  completed.sort(function(a, b) { return b.rowNumber - a.rowNumber; });
  trash.sort(function(a, b) { return b.rowNumber - a.rowNumber; });

  var counts = {
    active: 0,
    now: 0,
    waiting: 0,
    forgotten: 0,
    backlog: 0,
    snoozed: 0,
    inbox: inbox.length,
    completed: completed.length,
    trash: trash.length,
    archivedCompleted: archivedCompletedCount,
    dueSoon: 0,
    overdue: 0
    ,slackUpdates: 0
  };
  tasks.forEach(function(task) {
    counts[task.lane] += 1;
    counts.active += 1;
    if (task.deadlineState === 'soon' || task.deadlineState === 'today') counts.dueSoon += 1;
    if (task.deadlineState === 'overdue') counts.overdue += 1;
    if (task.hasSlackUpdate) counts.slackUpdates += 1;
  });

  return {
    title: '任务雷达',
    updatedAt: formatTokyoDateTime_(now),
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + CONFIG.SPREADSHEET_ID + '/edit',
    counts: counts,
    tasks: tasks,
    inbox: inbox,
    completed: completed,
    trash: trash
  };
}

function dashboardLinkedThreadFromRow_(row, rowNumber) {
  return {
    rowNumber: rowNumber,
    title: cleanDashboardValue_(row[CONFIG.COL.TASK - 1]) || 'Slack 主题',
    slackType: cleanDashboardValue_(row[CONFIG.COL.SLACK_TYPE - 1]),
    slackUrl: cleanDashboardValue_(row[CONFIG.COL.SLACK_URL - 1]),
    lastChecked: formatDashboardDate_(row[CONFIG.COL.LAST_CHECKED - 1], false),
    updatePending: dashboardBoolean_(row[CONFIG.COL.SLACK_UPDATE_PENDING - 1]),
    latestUpdate: cleanDashboardValue_(row[CONFIG.COL.SLACK_LATEST_UPDATE - 1]) ||
      cleanDashboardValue_(row[CONFIG.COL.NEXT_ACTION - 1])
  };
}

function dashboardInboxFromRow_(row, rowNumber, now) {
  var task = dashboardTaskFromRow_(row, rowNumber, now);
  if (!task || task.lane === 'completed') return null;
  return {
    id: task.id,
    title: task.title,
    category: task.category,
    priority: task.priority,
    estimate: task.estimate,
    nextAction: task.nextAction,
    completion: task.completion,
    waitingFor: task.waitingFor,
    memo: task.memo,
    slackType: task.slackType,
    slackUrl: task.slackUrl,
    lastUpdated: task.lastUpdated,
    deadline: task.deadline,
    deadlineInput: task.deadlineInput,
    syncCalendar: task.syncCalendar,
    calendarReminderAt: task.calendarReminderAt,
    calendarGuestEmails: task.calendarGuestEmails,
    slackDmEnabled: task.slackDmEnabled,
    slackDmRecipientNames: task.slackDmRecipientNames,
    slackDmSendAt: task.slackDmSendAt,
    slackDmText: task.slackDmText,
    tags: task.tags,
    sourceLabel: task.sourceLabel
  };
}

function createTaskFromDashboard(request) {
  request = request || {};
  var task = normalizeDashboardTaskInput_(request);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getTaskSheet_();
    ensureSheetStructure_(sheet);
    var now = new Date();
    var rowNumber = sheet.getLastRow() + 1;
    var taskId = 'manual-' + Utilities.formatDate(now, CONFIG.TIME_ZONE, 'yyyyMMdd') + '-' + Utilities.getUuid();
    var row = [
      '待确认',
      task.title,
      task.category,
      task.priority,
      task.estimate,
      task.nextAction,
      task.completion,
      task.waitingFor,
      formatTokyoDate_(now),
      task.memo,
      false,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      taskId,
      '',
      false,
      '手动创建 · ' + formatTokyoDateTime_(now),
      '任务',
      task.deadline ? parseTokyoDateOnly_(task.deadline) : '',
      '',
      false,
      '',
      '',
      false,
      '',
      task.calendarReminderAt ? parseTokyoDateTimeInput_(task.calendarReminderAt) : '',
      task.calendarGuestEmails,
      task.slackDmEnabled,
      task.slackDmRecipientNames,
      '',
      task.slackDmSendAt ? parseTokyoDateTimeInput_(task.slackDmSendAt) : '',
      task.slackDmText,
      '',
      task.tags
    ];
    sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    var checkboxRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    sheet.getRange(rowNumber, CONFIG.COL.CONFIRMED).setDataValidation(checkboxRule).setValue(false);
    sheet.getRange(rowNumber, CONFIG.COL.PINNED).setDataValidation(checkboxRule).setValue(false);
    sheet.getRange(rowNumber, CONFIG.COL.SYNC_CALENDAR).setDataValidation(checkboxRule).setValue(false);
    sheet.getRange(rowNumber, CONFIG.COL.SLACK_DM_ENABLED)
      .setDataValidation(checkboxRule)
      .setValue(task.slackDmEnabled);
    syncCalendarReminderForRow_(sheet, rowNumber, task);
    syncPersonalSlackDmForRow_(sheet, rowNumber, task);
  } finally {
    lock.releaseLock();
  }
  return getTaskDashboardData();
}

function updateSlackInboxFromDashboard(request) {
  request = request || {};
  var taskId = cleanDashboardValue_(request.taskId);
  var action = cleanDashboardValue_(request.action);
  if (!taskId || ['convert', 'ignore', 'link', 'restore'].indexOf(action) === -1) {
    throw new Error('缺少收件箱任务 ID 或操作类型。');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getTaskSheet_();
    ensureSheetStructure_(sheet);
    var rowNumber = findDashboardTaskRow_(sheet, taskId);
    if (!rowNumber) throw new Error('Slack 消息不存在，请刷新页面。');
    var stage = cleanDashboardValue_(sheet.getRange(rowNumber, CONFIG.COL.PROCESSING_STAGE).getValue());
    if (action === 'restore') {
      if (stage !== '忽略') throw new Error('这条 Slack 消息不在回收站。');
    } else if (stage !== '待整理') {
      throw new Error('这条 Slack 消息已经整理过了。');
    }
    if (!cleanDashboardValue_(sheet.getRange(rowNumber, CONFIG.COL.CHANNEL_ID).getValue())) {
      throw new Error('只有 Slack 消息可以从收件箱整理。');
    }

    var now = new Date();
    if (action === 'restore') {
      sheet.getRange(rowNumber, CONFIG.COL.PROCESSING_STAGE).setValue('待整理');
      sheet.getRange(rowNumber, CONFIG.COL.CONFIRMED).setValue(false);
      sheet.getRange(rowNumber, CONFIG.COL.LAST_UI_ACTION)
        .setValue('从回收站恢复 · ' + formatTokyoDateTime_(now));
    } else if (action === 'ignore') {
      sheet.getRange(rowNumber, CONFIG.COL.PROCESSING_STAGE).setValue('忽略');
      sheet.getRange(rowNumber, CONFIG.COL.CONFIRMED).setValue(true);
      sheet.getRange(rowNumber, CONFIG.COL.LAST_UI_ACTION)
        .setValue('不是任务 · ' + formatTokyoDateTime_(now));
    } else if (action === 'convert') {
      var task = normalizeDashboardTaskInput_(request);
      writeDashboardTaskDetails_(sheet, rowNumber, task, now);
      sheet.getRange(rowNumber, CONFIG.COL.STATUS).setValue('待确认');
      sheet.getRange(rowNumber, CONFIG.COL.PROCESSING_STAGE).setValue('任务');
      sheet.getRange(rowNumber, CONFIG.COL.CONFIRMED).setValue(true);
      sheet.getRange(rowNumber, CONFIG.COL.LAST_UI_ACTION)
        .setValue('转为任务 · ' + formatTokyoDateTime_(now));
    } else {
      linkSlackInboxToTask_(sheet, rowNumber, request, now);
    }
  } finally {
    lock.releaseLock();
  }
  return getTaskDashboardData();
}

function linkSlackInboxToTask_(sheet, slackRowNumber, request, now) {
  var linkedTaskId = cleanDashboardValue_(request.linkedTaskId);
  if (!linkedTaskId) throw new Error('请选择需要关联的现有任务。');
  var targetRowNumber = findDashboardTaskRow_(sheet, linkedTaskId);
  if (!targetRowNumber || targetRowNumber === slackRowNumber) {
    throw new Error('关联目标不存在，请刷新后重试。');
  }
  var targetStatus = cleanDashboardValue_(sheet.getRange(targetRowNumber, CONFIG.COL.STATUS).getValue());
  if (targetStatus === '已完成' || targetStatus === '完了') {
    throw new Error('不能关联到已完成任务。');
  }

  sheet.getRange(slackRowNumber, CONFIG.COL.PROCESSING_STAGE).setValue('关联');
  sheet.getRange(slackRowNumber, CONFIG.COL.LINKED_TASK_ID).setValue(linkedTaskId);
  sheet.getRange(slackRowNumber, CONFIG.COL.CONFIRMED).setValue(false);
  sheet.getRange(slackRowNumber, CONFIG.COL.SLACK_UPDATE_PENDING).setValue(false);
  sheet.getRange(slackRowNumber, CONFIG.COL.LAST_UI_ACTION)
    .setValue('关联现有任务 · ' + formatTokyoDateTime_(now));

  if (dashboardBoolean_(request.applyUpdate)) {
    var suggestedAction = cleanDashboardValue_(
      sheet.getRange(slackRowNumber, CONFIG.COL.NEXT_ACTION).getValue()
    );
    if (suggestedAction) {
      sheet.getRange(targetRowNumber, CONFIG.COL.NEXT_ACTION).setValue(suggestedAction);
      sheet.getRange(targetRowNumber, CONFIG.COL.STATUS).setValue('进行中');
    }
  }
  sheet.getRange(targetRowNumber, CONFIG.COL.LAST_UPDATED).setValue(formatTokyoDate_(now));
  sheet.getRange(targetRowNumber, CONFIG.COL.LAST_UI_ACTION)
    .setValue('关联 Slack 主题 · ' + formatTokyoDateTime_(now));
}

function dashboardTaskFromRow_(row, rowNumber, now) {
  var title = cleanDashboardValue_(row[CONFIG.COL.TASK - 1]);
  if (!title) return null;

  var status = cleanDashboardValue_(row[CONFIG.COL.STATUS - 1]);
  var legacyCategory = cleanDashboardValue_(row[CONFIG.COL.CATEGORY - 1]);
  var priority = cleanDashboardValue_(row[CONFIG.COL.PRIORITY - 1]) || '中';
  var waitingFor = cleanDashboardValue_(row[CONFIG.COL.WAITING_FOR - 1]);
  var lastUpdatedValue = row[CONFIG.COL.LAST_UPDATED - 1];
  var remindAtValue = row[CONFIG.COL.REMIND_AT - 1];
  var deadlineValue = row[CONFIG.COL.DEADLINE - 1];
  var storedTags = cleanDashboardValue_(row[CONFIG.COL.TAGS - 1]);
  var pinned = dashboardBoolean_(row[CONFIG.COL.PINNED - 1]);
  var lane = inferDashboardLane_(
    status,
    priority,
    waitingFor,
    lastUpdatedValue,
    remindAtValue,
    deadlineValue,
    pinned,
    now
  );
  var deadlineDays = daysUntilTokyoDate_(deadlineValue, now);
  var deadlineState = dashboardDeadlineState_(deadlineDays);

  return {
    id: cleanDashboardValue_(row[CONFIG.COL.TASK_ID - 1]),
    rowNumber: rowNumber,
    status: status || '待确认',
    statusLabel: dashboardStatusLabel_(status),
    title: title,
    category: legacyCategory || '未分类',
    priority: priority,
    estimate: cleanDashboardValue_(row[CONFIG.COL.ESTIMATE - 1]),
    nextAction: cleanDashboardValue_(row[CONFIG.COL.NEXT_ACTION - 1]) || '还没有填写下一步',
    completion: cleanDashboardValue_(row[CONFIG.COL.COMPLETION - 1]),
    waitingFor: dashboardMeaningfulValue_(waitingFor) ? waitingFor : '',
    lastUpdated: formatDashboardDate_(lastUpdatedValue, false),
    memo: cleanDashboardValue_(row[CONFIG.COL.MEMO - 1]),
    slackType: cleanDashboardValue_(row[CONFIG.COL.SLACK_TYPE - 1]),
    slackUrl: cleanDashboardValue_(row[CONFIG.COL.SLACK_URL - 1]),
    remindAt: formatDashboardDate_(remindAtValue, true),
    deadline: deadlineValue ? formatDashboardDate_(deadlineValue, false) : '',
    deadlineInput: formatTokyoDateInput_(deadlineValue),
    deadlineDays: deadlineDays,
    deadlineState: deadlineState,
    deadlineLabel: dashboardDeadlineLabel_(deadlineDays),
    syncCalendar: dashboardBoolean_(row[CONFIG.COL.SYNC_CALENDAR - 1]),
    calendarReminderAt: formatTokyoDateTimeInput_(row[CONFIG.COL.CALENDAR_REMINDER_AT - 1]),
    calendarGuestEmails: cleanDashboardValue_(row[CONFIG.COL.CALENDAR_GUEST_EMAILS - 1]),
    slackDmEnabled: dashboardBoolean_(row[CONFIG.COL.SLACK_DM_ENABLED - 1]),
    slackDmRecipientNames: cleanDashboardValue_(row[CONFIG.COL.SLACK_DM_RECIPIENT_NAMES - 1]),
    slackDmSendAt: formatTokyoDateTimeInput_(row[CONFIG.COL.SLACK_DM_SEND_AT - 1]),
    slackDmText: cleanDashboardValue_(row[CONFIG.COL.SLACK_DM_TEXT - 1]),
    slackDmScheduled: dashboardHasSlackDmSchedule_(
      row[CONFIG.COL.SLACK_DM_SCHEDULE_RECORDS - 1]
    ),
    tags: mergeDashboardTags_(legacyCategory, [
      storedTags,
      inferTournamentTags_([title, row[CONFIG.COL.MEMO - 1]].join('\n'))
    ].join(', ')),
    pinned: pinned,
    lane: lane,
    laneLabel: dashboardLaneLabel_(lane),
    sourceLabel: cleanDashboardValue_(row[CONFIG.COL.CHANNEL_ID - 1]) ? 'Slack 自动收集' : '手动任务',
    lastUiAction: cleanDashboardValue_(row[CONFIG.COL.LAST_UI_ACTION - 1])
  };
}

function inferDashboardLane_(status, priority, waitingFor, lastUpdated, remindAt, deadline, pinned, now) {
  if (status === '已完成' || status === '完了') return 'completed';

  var reminder = dashboardDateValue_(remindAt);
  if (reminder && reminder.getTime() > now.getTime()) return 'snoozed';
  var deadlineDays = daysUntilTokyoDate_(deadline, now);
  if (deadlineDays !== null && deadlineDays <= CONFIG.DEADLINE_SOON_DAYS) return 'now';
  if (pinned || status === '进行中') return 'now';
  if (dashboardMeaningfulValue_(waitingFor)) return 'waiting';
  if (daysSinceDashboardDate_(lastUpdated, now) >= CONFIG.FORGOTTEN_AFTER_DAYS) return 'forgotten';
  if (priority === '高') return 'now';
  return 'backlog';
}

function compareDashboardTasks_(a, b) {
  var laneOrder = { now: 0, waiting: 1, forgotten: 2, backlog: 3, snoozed: 4, completed: 5 };
  var priorityOrder = { '高': 0, '中': 1, '低': 2 };
  var laneDiff = laneOrder[a.lane] - laneOrder[b.lane];
  if (laneDiff !== 0) return laneDiff;
  var deadlineDiff = dashboardDeadlineSortValue_(a) - dashboardDeadlineSortValue_(b);
  if (deadlineDiff !== 0) return deadlineDiff;
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  var aPriority = Object.prototype.hasOwnProperty.call(priorityOrder, a.priority) ? priorityOrder[a.priority] : 1;
  var bPriority = Object.prototype.hasOwnProperty.call(priorityOrder, b.priority) ? priorityOrder[b.priority] : 1;
  var priorityDiff = aPriority - bPriority;
  if (priorityDiff !== 0) return priorityDiff;
  return a.rowNumber - b.rowNumber;
}

function updateTaskFromDashboard(request) {
  request = request || {};
  var taskId = cleanDashboardValue_(request.taskId);
  var action = cleanDashboardValue_(request.action);
  if (!taskId || !action) throw new Error('缺少任务 ID 或操作类型。');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getTaskSheet_();
    ensureSheetStructure_(sheet);
    var rowNumber = findDashboardTaskRow_(sheet, taskId);
    if (!rowNumber) throw new Error('任务不存在或已经被移动，请刷新页面。');

    var status = cleanDashboardValue_(sheet.getRange(rowNumber, CONFIG.COL.STATUS).getValue());
    if ((status === '已完成' || status === '完了') && action !== 'restore') {
      throw new Error('已完成任务只能先恢复。');
    }

    var now = new Date();
    var actionLabel = applyDashboardAction_(sheet, rowNumber, action, request, now);
    sheet.getRange(rowNumber, CONFIG.COL.LAST_UPDATED).setValue(formatTokyoDate_(now));
    sheet.getRange(rowNumber, CONFIG.COL.LAST_UI_ACTION)
      .setValue(actionLabel + ' · ' + formatTokyoDateTime_(now));
  } finally {
    lock.releaseLock();
  }

  return getTaskDashboardData();
}

function applyDashboardAction_(sheet, rowNumber, action, request, now) {
  if (action === 'restore') {
    sheet.getRange(rowNumber, CONFIG.COL.STATUS).setValue('待确认');
    sheet.getRange(rowNumber, CONFIG.COL.PROCESSING_STAGE).setValue('任务');
    sheet.getRange(rowNumber, CONFIG.COL.REMIND_AT).clearContent();
    restoreLinkedSlackTracking_(sheet, cleanDashboardValue_(
      sheet.getRange(rowNumber, CONFIG.COL.TASK_ID).getValue()
    ), now);
    return '恢复任务';
  }

  if (action === 'complete') {
    removeCalendarReminderForRow_(sheet, rowNumber);
    removePersonalSlackDmForRow_(sheet, rowNumber);
    sheet.getRange(rowNumber, CONFIG.COL.STATUS).setValue('已完成');
    sheet.getRange(rowNumber, CONFIG.COL.REMIND_AT).clearContent();
    return '标记完成';
  }

  if (action === 'start') {
    sheet.getRange(rowNumber, CONFIG.COL.STATUS).setValue('进行中');
    sheet.getRange(rowNumber, CONFIG.COL.REMIND_AT).clearContent();
    return '开始处理';
  }

  if (action === 'pin') {
    var pinned = Boolean(request.pinned);
    sheet.getRange(rowNumber, CONFIG.COL.PINNED).setValue(pinned);
    return pinned ? '置顶' : '取消置顶';
  }

  if (action === 'nextAction') {
    var nextAction = cleanDashboardValue_(request.value);
    if (!nextAction) throw new Error('下一步不能为空。');
    if (nextAction.length > 500) throw new Error('下一步不能超过 500 个字符。');
    sheet.getRange(rowNumber, CONFIG.COL.NEXT_ACTION).setValue(nextAction);
    return '更新下一步';
  }

  if (action === 'applySlackUpdate') {
    return applyLatestLinkedSlackUpdate_(sheet, rowNumber, now);
  }

  if (action === 'edit') {
    var task = normalizeDashboardTaskInput_(request);
    writeDashboardTaskDetails_(sheet, rowNumber, task, now);
    return '编辑任务';
  }

  if (action === 'snooze') {
    var remindAt;
    if (request.until === 'tomorrow') {
      remindAt = tomorrowMorningTokyo_(now);
    } else {
      var minutes = Number(request.minutes);
      if ([30, 120].indexOf(minutes) === -1) throw new Error('不支持这个提醒时间。');
      remindAt = new Date(now.getTime() + minutes * 60 * 1000);
    }
    sheet.getRange(rowNumber, CONFIG.COL.REMIND_AT).setValue(remindAt);
    return '提醒设为 ' + formatTokyoDateTime_(remindAt);
  }

  throw new Error('不支持的操作：' + action);
}

function applyLatestLinkedSlackUpdate_(sheet, targetRowNumber, now) {
  var taskId = cleanDashboardValue_(sheet.getRange(targetRowNumber, CONFIG.COL.TASK_ID).getValue());
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('没有可采用的 Slack 新进展。');
  var rows = sheet.getRange(2, 1, lastRow - 1, CONFIG.SHEET_HEADERS.length).getValues();
  var candidates = [];
  rows.forEach(function(row, index) {
    var stage = cleanDashboardValue_(row[CONFIG.COL.PROCESSING_STAGE - 1]);
    var isDirectTask = index + 2 === targetRowNumber && stage === '任务';
    var isLinkedThread = stage === '关联' &&
      cleanDashboardValue_(row[CONFIG.COL.LINKED_TASK_ID - 1]) === taskId;
    if (!isDirectTask && !isLinkedThread) return;
    if (!dashboardBoolean_(row[CONFIG.COL.SLACK_UPDATE_PENDING - 1])) return;
    candidates.push({ row: row, rowNumber: index + 2 });
  });
  if (!candidates.length) throw new Error('没有可采用的 Slack 新进展。');
  candidates.sort(function(a, b) {
    return Number(b.row[CONFIG.COL.SLACK_LATEST_TS - 1] || 0) -
      Number(a.row[CONFIG.COL.SLACK_LATEST_TS - 1] || 0);
  });
  var latest = candidates[0];
  var nextAction = cleanDashboardValue_(latest.row[CONFIG.COL.SLACK_LATEST_UPDATE - 1]) ||
    cleanDashboardValue_(latest.row[CONFIG.COL.NEXT_ACTION - 1]);
  if (!nextAction) throw new Error('Slack 新进展里没有可采用的下一步。');
  sheet.getRange(targetRowNumber, CONFIG.COL.NEXT_ACTION).setValue(nextAction);
  sheet.getRange(targetRowNumber, CONFIG.COL.STATUS).setValue('进行中');
  candidates.forEach(function(candidate) {
    sheet.getRange(candidate.rowNumber, CONFIG.COL.SLACK_UPDATE_PENDING).setValue(false);
  });
  return '采用 Slack 最新进展';
}

function stopLinkedSlackTracking_(sheet, taskId, now) {
  if (!taskId || sheet.getLastRow() < 2) return;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, CONFIG.SHEET_HEADERS.length).getValues();
  rows.forEach(function(row, index) {
    if (cleanDashboardValue_(row[CONFIG.COL.PROCESSING_STAGE - 1]) !== '关联') return;
    if (cleanDashboardValue_(row[CONFIG.COL.LINKED_TASK_ID - 1]) !== taskId) return;
    var rowNumber = index + 2;
    sheet.getRange(rowNumber, CONFIG.COL.CONFIRMED).setValue(true);
    sheet.getRange(rowNumber, CONFIG.COL.PROCESSING_STAGE).setValue('忽略');
    sheet.getRange(rowNumber, CONFIG.COL.SLACK_UPDATE_PENDING).setValue(false);
    sheet.getRange(rowNumber, CONFIG.COL.LAST_UI_ACTION)
      .setValue('关联任务完成，停止追踪 · ' + formatTokyoDateTime_(now));
  });
}

function restoreLinkedSlackTracking_(sheet, taskId, now) {
  if (!taskId || sheet.getLastRow() < 2) return;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, CONFIG.SHEET_HEADERS.length).getValues();
  rows.forEach(function(row, index) {
    if (cleanDashboardValue_(row[CONFIG.COL.PROCESSING_STAGE - 1]) !== '忽略') return;
    if (cleanDashboardValue_(row[CONFIG.COL.LINKED_TASK_ID - 1]) !== taskId) return;
    var lastAction = cleanDashboardValue_(row[CONFIG.COL.LAST_UI_ACTION - 1]);
    if (lastAction.indexOf('关联任务完成') !== 0) return;
    var rowNumber = index + 2;
    sheet.getRange(rowNumber, CONFIG.COL.CONFIRMED).setValue(false);
    sheet.getRange(rowNumber, CONFIG.COL.PROCESSING_STAGE).setValue('关联');
    sheet.getRange(rowNumber, CONFIG.COL.LAST_UI_ACTION)
      .setValue('主任务恢复，继续追踪 · ' + formatTokyoDateTime_(now));
  });
}

function writeDashboardTaskDetails_(sheet, rowNumber, task, now) {
  var editable = sheet.getRange(rowNumber, CONFIG.COL.TASK, 1, 9).getValues()[0];
  editable[0] = task.title;
  editable[1] = task.category;
  editable[2] = task.priority;
  editable[3] = task.estimate;
  editable[4] = task.nextAction;
  editable[5] = task.completion;
  editable[6] = task.waitingFor;
  editable[7] = formatTokyoDate_(now);
  editable[8] = task.memo;
  sheet.getRange(rowNumber, CONFIG.COL.TASK, 1, 9).setValues([editable]);
  if (task.deadline) {
    sheet.getRange(rowNumber, CONFIG.COL.DEADLINE).setValue(parseTokyoDateOnly_(task.deadline));
  } else {
    sheet.getRange(rowNumber, CONFIG.COL.DEADLINE).clearContent();
  }
  if (task.calendarReminderAt) {
    sheet.getRange(rowNumber, CONFIG.COL.CALENDAR_REMINDER_AT)
      .setValue(parseTokyoDateTimeInput_(task.calendarReminderAt));
  } else {
    sheet.getRange(rowNumber, CONFIG.COL.CALENDAR_REMINDER_AT).clearContent();
  }
  if (task.calendarGuestEmails) {
    sheet.getRange(rowNumber, CONFIG.COL.CALENDAR_GUEST_EMAILS)
      .setValue(task.calendarGuestEmails);
  } else {
    sheet.getRange(rowNumber, CONFIG.COL.CALENDAR_GUEST_EMAILS).clearContent();
  }
  syncCalendarReminderForRow_(sheet, rowNumber, task);
  syncPersonalSlackDmForRow_(sheet, rowNumber, task);
  sheet.getRange(rowNumber, CONFIG.COL.TAGS).setValue(task.tags);
}

function normalizeDashboardTaskInput_(request) {
  var detectedTournamentTags = inferTournamentTags_([
    request.title,
    request.nextAction,
    request.memo
  ].join('\n'));
  var task = {
    title: cleanDashboardValue_(request.title),
    category: '未分类',
    priority: cleanDashboardValue_(request.priority) || '中',
    estimate: cleanDashboardValue_(request.estimate),
    nextAction: cleanDashboardValue_(request.nextAction),
    completion: cleanDashboardValue_(request.completion),
    waitingFor: cleanDashboardValue_(request.waitingFor),
    memo: cleanDashboardValue_(request.memo),
    deadline: cleanDashboardValue_(request.deadline),
    syncCalendar: dashboardBoolean_(request.syncCalendar),
    calendarReminderAt: cleanDashboardValue_(request.calendarReminderAt),
    calendarGuestEmails: normalizeCalendarGuestEmails_(request.calendarGuestEmails),
    slackDmEnabled: dashboardBoolean_(request.slackDmEnabled),
    slackDmRecipientNames: normalizeSlackDmRecipientNames_(request.slackDmRecipientNames),
    slackDmSendAt: cleanDashboardValue_(request.slackDmSendAt),
    slackDmText: String(request.slackDmText || '').trim(),
    tags: normalizeDashboardTags_([
      cleanDashboardValue_(request.category),
      cleanDashboardValue_(request.tags),
      detectedTournamentTags
    ].filter(Boolean).join(', '))
  };
  if (!task.title) throw new Error('任务名称不能为空。');
  if (task.title.length > 120) throw new Error('任务名称不能超过 120 个字符。');
  if (['高', '中', '低'].indexOf(task.priority) === -1) throw new Error('优先级只能是高、中或低。');
  if (task.category.length > 60) throw new Error('分类不能超过 60 个字符。');
  if (task.estimate.length > 60) throw new Error('预计时间不能超过 60 个字符。');
  if (task.nextAction.length > 500) throw new Error('下一步不能超过 500 个字符。');
  if (task.completion.length > 300) throw new Error('完成条件不能超过 300 个字符。');
  if (task.waitingFor.length > 100) throw new Error('等待对象不能超过 100 个字符。');
  if (task.memo.length > CONFIG.MEMO_MAX_LENGTH) throw new Error('备注不能超过 ' + CONFIG.MEMO_MAX_LENGTH + ' 个字符。');
  if (task.deadline && !parseTokyoDateOnly_(task.deadline)) throw new Error('截止日期格式不正确。');
  if (task.calendarReminderAt && !parseTokyoDateTimeInput_(task.calendarReminderAt)) {
    throw new Error('Calendar 提醒日期时间格式不正确。');
  }
  if (task.syncCalendar && !task.calendarReminderAt) {
    throw new Error('请人工填写提醒日期和时间，再创建 Calendar 弹窗提醒。');
  }
  if (!task.syncCalendar) {
    task.calendarReminderAt = '';
    task.calendarGuestEmails = '';
  }
  if (task.slackDmText.length > CONFIG.SLACK_DM_TEXT_MAX_LENGTH) {
    throw new Error('Slack DM 原文不能超过 ' + CONFIG.SLACK_DM_TEXT_MAX_LENGTH + ' 个字符。');
  }
  if (task.slackDmSendAt && !parseTokyoDateTimeInput_(task.slackDmSendAt)) {
    throw new Error('Slack DM 发送日期时间格式不正确。');
  }
  if (task.slackDmEnabled) {
    if (!task.slackDmRecipientNames) throw new Error('请填写个人 Slack 正式全名。');
    if (!task.slackDmSendAt) throw new Error('请人工填写 Slack DM 发送日期和时间。');
    if (!task.slackDmText) throw new Error('请填写要发送的 Slack DM 原文。');
    validateSlackDmScheduleTime_(parseTokyoDateTimeInput_(task.slackDmSendAt), new Date());
  } else {
    task.slackDmRecipientNames = '';
    task.slackDmSendAt = '';
    task.slackDmText = '';
  }
  return task;
}

function normalizeSlackDmRecipientNames_(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  var unique = {};
  var names = raw.split(/[\n\r,，、;；\/]+/).map(function(name) {
    return name.trim();
  }).filter(Boolean).filter(function(name) {
    if (name.charAt(0) === '@') {
      throw new Error('@CS 等用户组不能作为个人 DM 收件人，请填写个人正式全名。');
    }
    var key = normalizeSlackFormalNameKey_(name);
    if (unique[key]) return false;
    unique[key] = true;
    return true;
  });
  if (names.length > CONFIG.SLACK_DM_RECIPIENT_MAX_COUNT) {
    throw new Error('Slack DM 收件人最多可填写 ' + CONFIG.SLACK_DM_RECIPIENT_MAX_COUNT + ' 人。');
  }
  return names.join(' / ');
}

function normalizeSlackFormalNameKey_(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function validateSlackDmScheduleTime_(sendAt, now) {
  if (!sendAt || sendAt.getTime() < now.getTime() + 60 * 1000) {
    throw new Error('Slack DM 发送时间必须至少晚于现在 1 分钟。');
  }
  if (sendAt.getTime() > now.getTime() + CONFIG.SLACK_DM_MAX_FUTURE_DAYS * 24 * 60 * 60 * 1000) {
    throw new Error('Slack DM 最多只能预约未来 ' + CONFIG.SLACK_DM_MAX_FUTURE_DAYS + ' 天。');
  }
}

function normalizeCalendarGuestEmails_(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  var unique = {};
  var emails = raw.split(/[\s,;，；]+/).filter(Boolean).map(function(email) {
    return email.trim().toLowerCase();
  }).filter(function(email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('同事邮箱格式不正确：' + email);
    }
    if (unique[email]) return false;
    unique[email] = true;
    return true;
  });
  if (emails.length > CONFIG.CALENDAR_GUEST_MAX_COUNT) {
    throw new Error('Calendar 同事邮箱最多可填写 ' + CONFIG.CALENDAR_GUEST_MAX_COUNT + ' 个。');
  }
  return emails.join(', ');
}

function normalizeDashboardTags_(value) {
  var unique = {};
  var tags = String(value || '').split(/[\n\r,，、;；]+/).map(function(tag) {
    return tag.trim().replace(/^#+/, '');
  }).filter(Boolean).filter(function(tag) {
    if (tag.length > 40) throw new Error('每个标签不能超过 40 个字符：' + tag);
    var key = tag.toLowerCase();
    if (unique[key]) return false;
    unique[key] = true;
    return true;
  });
  var normalized = tags.join(', ');
  if (normalized.length > 2000) throw new Error('标签总长度不能超过 2000 个字符。');
  return normalized;
}

function mergeDashboardTags_(legacyCategory, storedTags) {
  var values = [];
  var unique = {};
  [legacyCategory, storedTags].forEach(function(value) {
    String(value || '').split(/[\n\r,，、;；]+/).forEach(function(tag) {
      tag = tag.trim().replace(/^#+/, '');
      if (!tag || tag === '未分类' || tag.toUpperCase() === 'FALSE' || /^频道\s*[:：]/u.test(tag)) return;
      var key = tag.toLowerCase();
      if (unique[key]) return;
      unique[key] = true;
      values.push(tag);
    });
  });
  return values.join(', ');
}

function dashboardDeadlineState_(days) {
  if (days === null) return '';
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= CONFIG.DEADLINE_SOON_DAYS) return 'soon';
  return 'scheduled';
}

function dashboardDeadlineLabel_(days) {
  if (days === null) return '';
  if (days < 0) return '已逾期 ' + Math.abs(days) + ' 天';
  if (days === 0) return '今天截止';
  if (days === 1) return '明天截止';
  return '还有 ' + days + ' 天';
}

function dashboardDeadlineSortValue_(task) {
  return task.deadlineDays === null || task.deadlineDays === undefined
    ? Number.POSITIVE_INFINITY
    : task.deadlineDays;
}

function findDashboardTaskRow_(sheet, taskId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var ids = sheet.getRange(2, CONFIG.COL.TASK_ID, lastRow - 1, 1).getDisplayValues();
  for (var index = 0; index < ids.length; index += 1) {
    if (ids[index][0] === taskId) return index + 2;
  }
  return 0;
}

function tomorrowMorningTokyo_(now) {
  var parts = Utilities.formatDate(now, CONFIG.TIME_ZONE, 'yyyy,M,d').split(',');
  return new Date(Date.UTC(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2]) + 1,
    0,
    0,
    0
  ));
}

function dashboardStatusLabel_(status) {
  if (status === '已完成' || status === '完了') return '已完成';
  if (status === '进行中') return '进行中';
  return '待确认';
}

function dashboardLaneLabel_(lane) {
  return {
    now: '现在做',
    waiting: '等回复',
    forgotten: '可能忘了',
    backlog: '任务库',
    snoozed: '稍后提醒',
    completed: '已完成'
  }[lane] || '任务库';
}

function dashboardBoolean_(value) {
  return value === true || String(value || '').toUpperCase() === 'TRUE';
}

function dashboardHasSlackDmSchedule_(value) {
  var cleaned = cleanDashboardValue_(value);
  if (!cleaned || cleaned.toUpperCase() === 'FALSE') return false;
  try {
    var records = JSON.parse(cleaned);
    return Array.isArray(records) && records.length > 0 && records.every(function(record) {
      return record && record.channel && record.scheduledMessageId;
    });
  } catch (error) {
    return false;
  }
}

function dashboardMeaningfulValue_(value) {
  var cleaned = cleanDashboardValue_(value);
  return cleaned && cleaned !== '—' && cleaned !== '-';
}

function cleanDashboardValue_(value) {
  if (value === false) return '';
  return String(value === null || value === undefined ? '' : value).trim();
}

function dashboardDateValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return value;
  }
  if (!value) return null;
  var match = String(value).match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return null;
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] || 0),
    Number(match[5] || 0)
  );
}

function formatDashboardDate_(value, includeTime) {
  var date = dashboardDateValue_(value);
  if (!date) return cleanDashboardValue_(value);
  return includeTime ? formatTokyoDateTime_(date) : formatTokyoDate_(date);
}

function daysSinceDashboardDate_(value, now) {
  var date = dashboardDateValue_(value);
  if (!date) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
}
