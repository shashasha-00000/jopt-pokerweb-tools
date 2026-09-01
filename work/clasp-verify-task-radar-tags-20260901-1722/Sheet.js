function getTaskSheet_() {
  var spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var spreadsheetTimeZone = spreadsheet.getSpreadsheetTimeZone();
  if (spreadsheetTimeZone !== CONFIG.TIME_ZONE) {
    throw new Error(
      'Spreadsheet のタイムゾーンを ' + CONFIG.TIME_ZONE +
      ' に設定してください。現在値: ' + spreadsheetTimeZone
    );
  }

  var sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    throw new Error('Sheet が見つかりません: ' + CONFIG.SHEET_NAME);
  }
  return sheet;
}

function ensureSheetStructure_(sheet) {
  var requiredColumns = CONFIG.SHEET_HEADERS.length;
  if (sheet.getMaxColumns() < requiredColumns) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), requiredColumns - sheet.getMaxColumns());
  }

  var extensionColumnCount = requiredColumns - 10;
  var existingHeaders = sheet.getRange(1, 11, 1, extensionColumnCount).getDisplayValues()[0];
  var requiredHeaders = CONFIG.SHEET_HEADERS.slice(10);

  existingHeaders.forEach(function(value, index) {
    if (value && value !== requiredHeaders[index]) {
      throw new Error(
        '既存列 ' + columnNumberToLetter_(index + 11) + '1 を上書きできません。' +
        '期待値=' + requiredHeaders[index] + ' 現在値=' + value
      );
    }
  });

  requiredHeaders.forEach(function(header, index) {
    if (!existingHeaders[index]) {
      sheet.getRange(1, index + 11).setValue(header);
    }
  });

  if (sheet.getMaxRows() >= 2) {
    var checkboxRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    sheet.getRange(2, CONFIG.COL.CONFIRMED, sheet.getMaxRows() - 1, 1)
      .setDataValidation(checkboxRule);
    sheet.getRange(2, CONFIG.COL.PINNED, sheet.getMaxRows() - 1, 1)
      .setDataValidation(checkboxRule);
    sheet.getRange(2, CONFIG.COL.SYNC_CALENDAR, sheet.getMaxRows() - 1, 1)
      .setDataValidation(checkboxRule);
    sheet.getRange(2, CONFIG.COL.SLACK_UPDATE_PENDING, sheet.getMaxRows() - 1, 1)
      .setDataValidation(checkboxRule);
    sheet.getRange(2, CONFIG.COL.SLACK_DM_ENABLED, sheet.getMaxRows() - 1, 1)
      .setDataValidation(checkboxRule);

    var statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['待确认', '进行中', '已完成'], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, CONFIG.COL.STATUS, sheet.getMaxRows() - 1, 1)
      .setDataValidation(statusRule);
    sheet.getRange(2, CONFIG.COL.REMIND_AT, sheet.getMaxRows() - 1, 1)
      .setNumberFormat(CONFIG.DATE_TIME_FORMAT);
    sheet.getRange(2, CONFIG.COL.MESSAGE_TS, sheet.getMaxRows() - 1, 2)
      .setNumberFormat('@');
    sheet.getRange(2, CONFIG.COL.DEADLINE, sheet.getMaxRows() - 1, 1)
      .setNumberFormat(CONFIG.DATE_FORMAT);
    sheet.getRange(2, CONFIG.COL.CALENDAR_REMINDER_AT, sheet.getMaxRows() - 1, 1)
      .setNumberFormat(CONFIG.DATE_TIME_FORMAT);
    sheet.getRange(2, CONFIG.COL.SLACK_DM_SEND_AT, sheet.getMaxRows() - 1, 1)
      .setNumberFormat(CONFIG.DATE_TIME_FORMAT);
  }

  ensureTaskIds_(sheet);
  ensureProcessingStages_(sheet);
}

function ensureProcessingStages_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var values = sheet.getRange(2, 1, lastRow - 1, CONFIG.SHEET_HEADERS.length).getValues();
  var stages = [];
  var changed = false;
  values.forEach(function(row) {
    var stage = String(row[CONFIG.COL.PROCESSING_STAGE - 1] || '').trim();
    if (!stage && String(row[CONFIG.COL.TASK - 1] || '').trim()) {
      var isSlack = Boolean(String(row[CONFIG.COL.CHANNEL_ID - 1] || '').trim());
      var status = String(row[CONFIG.COL.STATUS - 1] || '').trim();
      var confirmed = row[CONFIG.COL.CONFIRMED - 1] === true ||
        String(row[CONFIG.COL.CONFIRMED - 1]).toUpperCase() === 'TRUE';
      if (isSlack && !confirmed && status !== '已完成' && status !== '完了') {
        stage = '待整理';
      } else if (isSlack) {
        stage = '忽略';
      } else {
        stage = '任务';
      }
      changed = true;
    }
    stages.push([stage]);
  });

  if (changed) {
    sheet.getRange(2, CONFIG.COL.PROCESSING_STAGE, stages.length, 1).setValues(stages);
  }
}

function ensureTaskIds_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var taskValues = sheet.getRange(2, CONFIG.COL.TASK, lastRow - 1, 1).getDisplayValues();
  var idRange = sheet.getRange(2, CONFIG.COL.TASK_ID, lastRow - 1, 1);
  var idValues = idRange.getValues();
  var changed = false;

  idValues.forEach(function(row, index) {
    if (taskValues[index][0] && !String(row[0] || '').trim()) {
      row[0] = Utilities.getUuid();
      changed = true;
    }
  });

  if (changed) {
    idRange.setValues(idValues);
  }
}

function loadExistingTasks_(sheet) {
  var result = { byKey: {}, byUrl: {} };
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return result;

  var values = sheet.getRange(2, 1, lastRow - 1, CONFIG.SHEET_HEADERS.length).getValues();
  values.forEach(function(row, index) {
    var task = taskFromValues_(row, index + 2);
    if (task.key) result.byKey[task.key] = task;
    if (task.url) result.byUrl[task.url] = task;
  });
  return result;
}

function loadTaskRow_(sheet, rowNumber) {
  var values = sheet.getRange(rowNumber, 1, 1, CONFIG.SHEET_HEADERS.length).getValues()[0];
  return taskFromValues_(values, rowNumber);
}

function taskFromValues_(row, rowNumber) {
  var channelId = String(row[CONFIG.COL.CHANNEL_ID - 1] || '').trim();
  var threadTs = String(row[CONFIG.COL.THREAD_TS - 1] || '').trim();
  var messageTs = String(row[CONFIG.COL.MESSAGE_TS - 1] || '').trim();
  var confirmed = row[CONFIG.COL.CONFIRMED - 1] === true ||
    String(row[CONFIG.COL.CONFIRMED - 1]).toUpperCase() === 'TRUE';
  var status = String(row[CONFIG.COL.STATUS - 1] || '').trim();
  var stage = String(row[CONFIG.COL.PROCESSING_STAGE - 1] || '').trim();
  var completed = status === '已完成' || status === '完了';
  var recentlyCompleted = completed &&
    daysSinceDashboardDate_(row[CONFIG.COL.LAST_UPDATED - 1], new Date()) <= 90;

  return {
    rowNumber: rowNumber,
    key: channelId && (threadTs || messageTs)
      ? buildSlackKey_(channelId, threadTs || messageTs)
      : '',
    url: String(row[CONFIG.COL.SLACK_URL - 1] || '').trim(),
    stage: stage,
    ignored: stage === '忽略' || (!stage && confirmed) || (completed && !recentlyCompleted)
  };
}

function findExistingTask_(existing, item) {
  return existing.byKey[item.uniqueKey] ||
    (item.permalink ? existing.byUrl[item.permalink] : null) ||
    null;
}

function upsertTask_(sheet, existingTask, item, task) {
  var today = formatTokyoDate_(new Date());

  if (!existingTask) {
    var rowNumber = sheet.getLastRow() + 1;
    var row = [
      task.sheetStatus,
      task.title,
      task.category,
      task.priority,
      '',
      task.nextAction,
      task.completion,
      task.waitingFor,
      today,
      task.memo,
      false,
      item.slackType,
      item.permalink,
      item.messageTs,
      item.threadTs,
      item.channelId,
      item.requesterId,
      today,
      Utilities.getUuid(),
      '',
      false,
      'Slack自动收集 · ' + today,
      '待整理',
      '',
      '',
      false,
      '',
      latestSlackThreadTs_(item.thread),
      false,
      latestSlackThreadSummary_(item.thread),
      '',
      '',
      false,
      '',
      '',
      '',
      '',
      '',
      task.tags || ''
    ];

    sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    sheet.getRange(rowNumber, CONFIG.COL.CONFIRMED)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build())
      .setValue(false);
    return 'created';
  }

  var rowNumber = existingTask.rowNumber;
  if (existingTask.stage === '任务') {
    sheet.getRange(rowNumber, CONFIG.COL.LAST_CHECKED).setValue(today);
    updateSlackTrackingState_(sheet, rowNumber, item);
    mergeDetectedTournamentTags_(sheet, rowNumber, task.tags);
    return 'updated';
  }
  var updates = [
    [CONFIG.COL.STATUS, task.sheetStatus],
    [CONFIG.COL.TASK, task.title],
    [CONFIG.COL.NEXT_ACTION, task.nextAction],
    [CONFIG.COL.WAITING_FOR, task.waitingFor],
    [CONFIG.COL.LAST_UPDATED, today],
    [CONFIG.COL.MEMO, task.memo],
    [CONFIG.COL.LAST_CHECKED, today]
  ];

  updates.forEach(function(update) {
    sheet.getRange(rowNumber, update[0]).setValue(update[1]);
  });
  mergeDetectedTournamentTags_(sheet, rowNumber, task.tags);
  updateSlackTrackingState_(sheet, rowNumber, item);
  return 'updated';
}

function mergeDetectedTournamentTags_(sheet, rowNumber, detectedTags) {
  if (!detectedTags) return;
  var current = sheet.getRange(rowNumber, CONFIG.COL.TAGS).getValue();
  sheet.getRange(rowNumber, CONFIG.COL.TAGS)
    .setValue(mergeDashboardTags_(current, detectedTags));
}

function updateSlackTrackingState_(sheet, rowNumber, item) {
  var latestTs = latestSlackThreadTs_(item.thread);
  if (!latestTs) return;
  var stage = String(sheet.getRange(rowNumber, CONFIG.COL.PROCESSING_STAGE).getValue() || '').trim();
  var previousTs = String(sheet.getRange(rowNumber, CONFIG.COL.SLACK_LATEST_TS).getDisplayValue() || '').trim();
  var latestMessage = item.thread.length ? item.thread[item.thread.length - 1] : null;
  var hasNewMessage = previousTs && Number(latestTs) > Number(previousTs);
  if (['关联', '任务'].indexOf(stage) !== -1 && hasNewMessage) {
    if (latestMessage && latestMessage.user !== CONFIG.MY_SLACK_USER_ID) {
      sheet.getRange(rowNumber, CONFIG.COL.SLACK_UPDATE_PENDING).setValue(true);
    }
    sheet.getRange(rowNumber, CONFIG.COL.SLACK_LATEST_UPDATE)
      .setValue(latestSlackThreadSummary_(item.thread));
  }
  sheet.getRange(rowNumber, CONFIG.COL.SLACK_LATEST_TS).setNumberFormat('@').setValue(latestTs);
}

function latestSlackThreadTs_(thread) {
  if (!thread || !thread.length) return '';
  return String(thread[thread.length - 1].ts || '');
}

function latestSlackThreadSummary_(thread) {
  if (!thread || !thread.length) return '';
  return truncateText_(cleanSlackText_(getSlackMessageText_(thread[thread.length - 1])), 300);
}

function buildSlackKey_(channelId, timestamp) {
  return String(channelId || '').trim() + '|' + String(timestamp || '').trim();
}

function columnNumberToLetter_(column) {
  var letter = '';
  var value = column;
  while (value > 0) {
    var remainder = (value - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    value = Math.floor((value - 1) / 26);
  }
  return letter;
}
