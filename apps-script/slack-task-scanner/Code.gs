/**
 * Main time-triggered entry point.
 */
function scanSlackTasks() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    logRun_('WARN', '別の scanSlackTasks が実行中のため、本実行を終了します。');
    return;
  }

  var stats = createRunStats_();
  logRun_('INFO', 'Slack タスクスキャン開始', { lookbackHours: CONFIG.LOOKBACK_HOURS });

  try {
    var sheet = getTaskSheet_();
    ensureSheetStructure_(sheet);
    validateSlackIdentity_();

    var existing = loadExistingTasks_(sheet);
    var hits = searchSlackCandidates_(stats).concat(collectTrackedSlackHits_(sheet, stats));
    var candidates = buildUniqueCandidates_(hits);

    Object.keys(candidates).forEach(function(key) {
      var hit = candidates[key];
      try {
        processSlackCandidate_(sheet, existing, hit, stats);
      } catch (error) {
        stats.errors += 1;
        logRun_('ERROR', 'Slack メッセージの処理に失敗しました。処理を継続します。', {
          channelId: hit.channelId,
          messageTs: hit.messageTs,
          error: errorToString_(error)
        });
      }
    });
  } catch (error) {
    stats.errors += 1;
    logRun_('ERROR', 'スキャンを継続できないエラーが発生しました。', {
      error: errorToString_(error)
    });
    throw error;
  } finally {
    stats.finishedOn = formatTokyoDate_(new Date());
    logRun_('INFO', 'Slack タスクスキャン終了', stats);
    lock.releaseLock();
  }
}

/**
 * Pulls Slack Events API notifications from the signed event bridge.
 * This discovers replies posted to old threads without exposing the Dashboard.
 */
function processSlackEventQueue() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    logRun_('WARN', '別の Slack 処理が実行中のため、イベント処理を終了します。');
    return;
  }

  var stats = createEventRunStats_();
  var acknowledgedEventIds = [];
  try {
    var events = fetchSlackEventQueue_();
    stats.received = events.length;
    if (!events.length) return;

    var sheet = getTaskSheet_();
    ensureSheetStructure_(sheet);
    validateSlackIdentity_();
    var existing = loadExistingTasks_(sheet);
    var groups = {};
    var threadCache = {};

    events.forEach(function(event) {
      try {
        var hit = makeSlackEventHit_(event, existing, threadCache, stats);
        if (!hit) {
          stats.ignored += 1;
          acknowledgedEventIds.push(event.eventId);
          return;
        }
        stats.relevant += 1;
        var key = buildSlackKey_(hit.channelId, hit.threadTs || hit.messageTs);
        if (!groups[key]) groups[key] = { hit: hit, eventIds: [] };
        if (shouldReplaceCandidate_(groups[key].hit, hit)) groups[key].hit = hit;
        groups[key].eventIds.push(event.eventId);
      } catch (error) {
        stats.errors += 1;
        logRun_('ERROR', 'Slack event の候補化に失敗しました。再試行のためキューに残します。', {
          eventId: event.eventId,
          channelId: event.channelId,
          error: errorToString_(error)
        });
      }
    });

    Object.keys(groups).forEach(function(key) {
      var group = groups[key];
      try {
        processSlackCandidate_(sheet, existing, group.hit, stats);
        stats.processed += 1;
        acknowledgedEventIds = acknowledgedEventIds.concat(group.eventIds);
      } catch (error) {
        stats.errors += 1;
        logRun_('ERROR', 'Slack event thread の処理に失敗しました。再試行のためキューに残します。', {
          channelId: group.hit.channelId,
          threadTs: group.hit.threadTs,
          eventIds: group.eventIds,
          error: errorToString_(error)
        });
      }
    });
  } finally {
    if (acknowledgedEventIds.length) {
      acknowledgeSlackEvents_(acknowledgedEventIds);
      stats.acknowledged = acknowledgedEventIds.length;
    }
    logRun_('INFO', 'Slack event queue processing completed', stats);
    lock.releaseLock();
  }
}

/**
 * One-time setup helper. It validates the token and spreadsheet, adds only K:R
 * headers/check boxes, then creates the two-hour trigger.
 */
function setupProject() {
  var sheet = getTaskSheet_();
  ensureSheetStructure_(sheet);
  validateSlackIdentity_();
  setupTrigger();
  setupEventTrigger();
  logRun_('INFO', '初期設定が完了しました。');
}

function refreshSlackInboxTitles() {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  var refreshed = 0;
  try {
    var sheet = getTaskSheet_();
    ensureSheetStructure_(sheet);
    validateSlackIdentity_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    var rows = sheet.getRange(2, 1, lastRow - 1, CONFIG.SHEET_HEADERS.length).getValues();

    rows.forEach(function(row, index) {
      if (String(row[CONFIG.COL.PROCESSING_STAGE - 1] || '').trim() !== '待整理') return;
      try {
        var channelId = String(row[CONFIG.COL.CHANNEL_ID - 1] || '').trim();
        var permalink = String(row[CONFIG.COL.SLACK_URL - 1] || '').trim();
        var messageTs = extractMessageTsFromUrl_(permalink) ||
          String(row[CONFIG.COL.MESSAGE_TS - 1] || '').trim();
        var threadTs = extractThreadTsFromUrl_(permalink) || messageTs ||
          String(row[CONFIG.COL.THREAD_TS - 1] || '').trim();
        if (!channelId || !messageTs || !threadTs) return;

        var hit = {
          channelId: channelId,
          channelName: '',
          messageTs: messageTs,
          threadTs: threadTs,
          requesterId: String(row[CONFIG.COL.REQUESTER_ID - 1] || '').trim(),
          requesterName: '',
          text: '',
          permalink: permalink,
          slackType: String(row[CONFIG.COL.SLACK_TYPE - 1] || '个人提及').trim()
        };
        var thread = fetchThread_(channelId, threadTs);
        var channel = getSlackChannel_(channelId, '');
        var requester = getSlackUser_(hit.requesterId, '');
        var normalized = normalizeSlackMessage_(hit, thread, channel, requester, permalink);
        var task = classifyTask_(normalized);
        upsertTask_(sheet, { rowNumber: index + 2 }, normalized, task);
        refreshed += 1;
      } catch (error) {
        logRun_('WARN', 'Slack 待整理タイトルの更新をスキップしました。', {
          rowNumber: index + 2,
          error: errorToString_(error)
        });
      }
    });

    logRun_('INFO', 'Slack 待整理タイトルを更新しました。', { refreshed: refreshed });
  } finally {
    lock.releaseLock();
  }
}

function setupTrigger() {
  var handler = 'scanSlackTasks';
  var exists = ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === handler;
  });

  if (exists) {
    logRun_('INFO', 'scanSlackTasks のトリガーは既に存在します。追加しません。');
    return;
  }

  ScriptApp.newTrigger(handler)
    .timeBased()
    .everyHours(CONFIG.TRIGGER_EVERY_HOURS)
    .create();
  logRun_('INFO', 'scanSlackTasks の2時間トリガーを作成しました。');
}

function setupEventTrigger() {
  getSlackEventBridgeConfig_();
  var handler = 'processSlackEventQueue';
  var exists = ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === handler;
  });
  if (exists) {
    logRun_('INFO', 'processSlackEventQueue のトリガーは既に存在します。追加しません。');
    return;
  }
  ScriptApp.newTrigger(handler)
    .timeBased()
    .everyMinutes(CONFIG.EVENT_TRIGGER_EVERY_MINUTES)
    .create();
  logRun_('INFO', 'processSlackEventQueue の1分トリガーを作成しました。');
}

function removeTriggers() {
  var handlers = ['scanSlackTasks', 'processSlackEventQueue'];
  var removed = 0;

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
      removed += 1;
    }
  });

  logRun_('INFO', 'Slack scanner のトリガーを削除しました。', { removed: removed });
}

function processSlackCandidate_(sheet, existing, hit, stats) {
  if (isExcludedSlackChannel_(hit.channelId)) {
    stats.ignored += 1;
    return;
  }
  var preliminaryKey = buildSlackKey_(hit.channelId, hit.threadTs || hit.messageTs);
  var preliminaryExisting = existing.byKey[preliminaryKey] ||
    (hit.permalink ? existing.byUrl[hit.permalink] : null) ||
    null;

  if (preliminaryExisting && preliminaryExisting.ignored) {
    stats.ignored += 1;
    return;
  }

  var thread = hit.prefetchedThread || fetchThread_(hit.channelId, hit.threadTs);
  hit = prepareParticipationHit_(hit, thread);
  var channel = getSlackChannel_(hit.channelId, hit.channelName);
  var requester = getSlackUser_(hit.requesterId, hit.requesterName);
  var permalink = buildSlackPermalink_(hit.channelId, hit.messageTs, hit.permalink);
  var normalized = normalizeSlackMessage_(hit, thread, channel, requester, permalink);
  var task = classifyTask_(normalized);
  var existingTask = findExistingTask_(existing, normalized);

  if (existingTask && existingTask.ignored) {
    stats.ignored += 1;
    return;
  }

  var result = upsertTask_(sheet, existingTask, normalized, task);
  if (result === 'created') {
    stats.created += 1;
    existing.byKey[normalized.uniqueKey] = loadTaskRow_(sheet, sheet.getLastRow());
  } else {
    stats.updated += 1;
  }
}

function collectTrackedSlackHits_(sheet, stats) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var rows = sheet.getRange(2, 1, lastRow - 1, CONFIG.SHEET_HEADERS.length).getValues();
  var hits = [];
  rows.forEach(function(row) {
    var stage = String(row[CONFIG.COL.PROCESSING_STAGE - 1] || '').trim();
    var confirmed = row[CONFIG.COL.CONFIRMED - 1] === true ||
      String(row[CONFIG.COL.CONFIRMED - 1]).toUpperCase() === 'TRUE';
    var status = String(row[CONFIG.COL.STATUS - 1] || '').trim();
    var channelId = String(row[CONFIG.COL.CHANNEL_ID - 1] || '').trim();
    if (['待整理', '关联', '任务'].indexOf(stage) === -1 ||
        (stage === '待整理' && confirmed) ||
        status === '已完成' || status === '完了' || !channelId ||
        isExcludedSlackChannel_(channelId)) return;
    var permalink = String(row[CONFIG.COL.SLACK_URL - 1] || '').trim();
    var messageTs = extractMessageTsFromUrl_(permalink) ||
      String(row[CONFIG.COL.MESSAGE_TS - 1] || '').trim();
    var threadTs = extractThreadTsFromUrl_(permalink) || messageTs ||
      String(row[CONFIG.COL.THREAD_TS - 1] || '').trim();
    if (!messageTs || !threadTs) return;
    hits.push({
      channelId: channelId,
      channelName: '',
      messageTs: messageTs,
      threadTs: threadTs,
      requesterId: String(row[CONFIG.COL.REQUESTER_ID - 1] || '').trim(),
      requesterName: '',
      text: '',
      permalink: permalink,
      slackType: String(row[CONFIG.COL.SLACK_TYPE - 1] || '我参与的主题').trim()
    });
  });
  stats.trackedThreads = hits.length;
  return hits;
}

function buildUniqueCandidates_(hits) {
  var candidates = {};

  hits.forEach(function(hit) {
    var key = buildSlackKey_(hit.channelId, hit.threadTs || hit.messageTs);
    var current = candidates[key];

    if (!current || shouldReplaceCandidate_(current, hit)) {
      candidates[key] = hit;
    }
  });

  return candidates;
}

function shouldReplaceCandidate_(current, incoming) {
  if (current.slackType !== '个人提及' && incoming.slackType === '个人提及') {
    return true;
  }
  if (current.slackType === '个人提及' && incoming.slackType !== '个人提及') {
    return false;
  }
  return Number(incoming.messageTs) > Number(current.messageTs);
}

function createRunStats_() {
  return {
    startedOn: formatTokyoDate_(new Date()),
    fullScanMessages: 0,
    fullScanThreads: 0,
    scannedChannels: 0,
    channelMessagesScanned: 0,
    channelMentionHits: 0,
    channelScanErrors: 0,
    directMentions: 0,
    csMentions: 0,
    participatedThreads: 0,
    trackedThreads: 0,
    created: 0,
    updated: 0,
    ignored: 0,
    errors: 0
  };
}

function createEventRunStats_() {
  return {
    received: 0,
    relevant: 0,
    processed: 0,
    ignored: 0,
    acknowledged: 0,
    created: 0,
    updated: 0,
    errors: 0,
    ignoredReasons: {}
  };
}

function logRun_(level, message, details) {
  var payload = {
    level: level,
    date: formatTokyoDate_(new Date()),
    message: message
  };
  if (details !== undefined) {
    payload.details = details;
  }
  console.log(JSON.stringify(payload));
}

function formatTokyoDate_(date) {
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, CONFIG.DATE_FORMAT);
}

function formatTokyoDateTime_(date) {
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, CONFIG.DATE_TIME_FORMAT);
}

function errorToString_(error) {
  if (!error) return 'Unknown error';
  return error.stack || error.message || String(error);
}
