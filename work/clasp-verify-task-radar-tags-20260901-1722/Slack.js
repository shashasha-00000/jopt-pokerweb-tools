var SLACK_CACHE_ = {
  users: {},
  channels: {},
  auth: null,
  allUsers: null
};

function searchSlackCandidates_(stats) {
  var nowSeconds = Date.now() / 1000;
  var oldestSeconds = nowSeconds - CONFIG.LOOKBACK_HOURS * 60 * 60;
  var searchDate = Utilities.formatDate(
    new Date((oldestSeconds - 24 * 60 * 60) * 1000),
    CONFIG.TIME_ZONE,
    'yyyy-MM-dd'
  );

  var direct = convertSearchMatches_(
    searchSlackQuery_(getDirectMentionSearchTerm_() + ' after:' + searchDate, oldestSeconds),
    SLACK_MARKERS.DIRECT,
    '个人提及'
  );

  var fullScan = collectFullScanChannelHits_(stats);
  var channelMentions = collectAccessibleChannelMentionHits_(stats);

  var properties = PropertiesService.getScriptProperties();
  var bootstrapped = properties.getProperty(CONFIG.PARTICIPATION_BOOTSTRAP_PROPERTY) === 'TRUE';
  var participationOldestSeconds = bootstrapped
    ? oldestSeconds
    : nowSeconds - CONFIG.PARTICIPATION_BOOTSTRAP_DAYS * 24 * 60 * 60;
  var participationDate = Utilities.formatDate(
    new Date((participationOldestSeconds - 24 * 60 * 60) * 1000),
    CONFIG.TIME_ZONE,
    'yyyy-MM-dd'
  );
  var participated = convertParticipationMatches_(
    searchSlackQuery_(
      'from:<@' + CONFIG.MY_SLACK_USER_ID + '> is:thread after:' + participationDate,
      participationOldestSeconds
    )
  );
  if (!bootstrapped) {
    properties.setProperty(CONFIG.PARTICIPATION_BOOTSTRAP_PROPERTY, 'TRUE');
  }

  stats.directMentions = direct.length;
  stats.participatedThreads = participated.length;
  logRun_('INFO', 'Slack candidate collection completed', {
    directMentions: direct.length,
    channelMentionHits: channelMentions.length,
    csMentions: stats.csMentions,
    participatedThreads: participated.length,
    participationBootstrap: !bootstrapped
  });

  return fullScan.concat(channelMentions, direct, participated);
}

function searchSlackMentions_(stats) {
  return searchSlackCandidates_(stats);
}

function convertSearchMatches_(matches, requiredMarker, slackType) {
  var converted = [];

  matches.forEach(function(match) {
    if (getSlackMessageText_(match).indexOf(requiredMarker) === -1) return;
    if (match.user === CONFIG.MY_SLACK_USER_ID) return;
    if (isExcludedSlackChannel_(match.channel && match.channel.id)) return;
    try {
      converted.push(makeSearchHit_(match, slackType));
    } catch (error) {
      logRun_('ERROR', '不正な Slack 検索結果を1件無視します。', {
        slackType: slackType,
        error: errorToString_(error)
      });
    }
  });

  return converted;
}

function convertParticipationMatches_(matches) {
  var converted = [];
  matches.forEach(function(match) {
    if (match.user !== CONFIG.MY_SLACK_USER_ID) return;
    if (isExcludedSlackChannel_(match.channel && match.channel.id)) return;
    try {
      converted.push(makeSearchHit_(match, '我参与的主题'));
    } catch (error) {
      logRun_('ERROR', '自分が参加した Slack thread の検索結果を1件無視します。', {
        error: errorToString_(error)
      });
    }
  });
  return converted;
}

function isExcludedSlackChannel_(channelId) {
  return CONFIG.EXCLUDED_CHANNEL_IDS.indexOf(String(channelId || '').trim()) !== -1;
}

function isFullScanSlackChannel_(channelId) {
  return CONFIG.CS_FULL_SCAN_CHANNEL_IDS.indexOf(String(channelId || '').trim()) !== -1;
}

function collectFullScanChannelHits_(stats) {
  var oldestSeconds = Date.now() / 1000 - CONFIG.CS_FULL_SCAN_LOOKBACK_HOURS * 60 * 60;
  var hits = [];

  CONFIG.CS_FULL_SCAN_CHANNEL_IDS.forEach(function(channelId) {
    hits = hits.concat(fetchChannelHistoryHits_(channelId, oldestSeconds));
  });

  var threadKeys = {};
  hits.forEach(function(hit) {
    threadKeys[buildSlackKey_(hit.channelId, hit.threadTs || hit.messageTs)] = true;
  });
  stats.fullScanMessages = hits.length;
  stats.fullScanThreads = Object.keys(threadKeys).length;
  logRun_('INFO', 'Slack CS channel full scan completed', {
    channelIds: CONFIG.CS_FULL_SCAN_CHANNEL_IDS,
    lookbackHours: CONFIG.CS_FULL_SCAN_LOOKBACK_HOURS,
    messages: hits.length,
    threads: stats.fullScanThreads
  });
  return hits;
}

function collectAccessibleChannelMentionHits_(stats) {
  var oldestSeconds = Date.now() / 1000 -
    CONFIG.CHANNEL_MENTION_SCAN_LOOKBACK_HOURS * 60 * 60;
  var channels = listAccessibleSlackChannels_();
  var hits = [];

  channels.forEach(function(channel) {
    var channelId = String(channel.id || '');
    if (!channelId || isExcludedSlackChannel_(channelId) ||
        isFullScanSlackChannel_(channelId)) return;
    try {
      var messages = fetchChannelHistoryMessages_(channelId, oldestSeconds);
      stats.scannedChannels += 1;
      stats.channelMessagesScanned += messages.length;
      hits = hits.concat(convertRecentChannelMessagesToMentionHits_(
        channelId,
        channel.name || '',
        messages,
        oldestSeconds
      ));
    } catch (error) {
      stats.channelScanErrors += 1;
      logRun_('WARN', 'Slack channel scan failed; continuing with other channels', {
        channelId: channelId,
        channelName: channel.name || '',
        error: errorToString_(error)
      });
    }
  });

  stats.channelMentionHits = hits.length;
  stats.csMentions = hits.filter(function(hit) {
    return hit.slackType === '@cs';
  }).length;
  logRun_('INFO', 'Slack accessible channel mention scan completed', {
    listedChannels: channels.length,
    scannedChannels: stats.scannedChannels,
    messages: stats.channelMessagesScanned,
    mentionHits: hits.length,
    csMentions: stats.csMentions,
    errors: stats.channelScanErrors
  });
  return hits;
}

function listAccessibleSlackChannels_() {
  var channels = [];
  var cursor = '';
  var page = 0;

  do {
    page += 1;
    var params = {
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: CONFIG.CONVERSATION_LIST_PAGE_SIZE
    };
    if (cursor) params.cursor = cursor;
    var response = slackApi_('conversations.list', params);
    (response.channels || []).forEach(function(channel) {
      channels.push(channel);
    });
    cursor = response.response_metadata && response.response_metadata.next_cursor
      ? response.response_metadata.next_cursor
      : '';
  } while (cursor && page < CONFIG.MAX_CONVERSATION_LIST_PAGES);

  if (cursor) {
    logRun_('WARN', 'Slack conversation list reached the maximum page count', {
      maxPages: CONFIG.MAX_CONVERSATION_LIST_PAGES
    });
  }
  return channels;
}

function convertRecentChannelMessagesToMentionHits_(channelId, channelName, messages, oldestSeconds) {
  var hits = [];

  messages.forEach(function(message) {
    var rootHit = makeRawMentionHit_(channelId, channelName, message, null);
    if (rootHit) hits.push(rootHit);

    if (!message.reply_count || Number(message.latest_reply || 0) < oldestSeconds) return;
    var thread;
    try {
      thread = fetchThread_(channelId, String(message.ts));
    } catch (error) {
      logRun_('WARN', 'Slack thread scan failed; continuing with other messages', {
        channelId: channelId,
        threadTs: String(message.ts),
        error: errorToString_(error)
      });
      return;
    }
    thread.forEach(function(reply) {
      if (String(reply.ts) === String(message.ts) || Number(reply.ts) < oldestSeconds) return;
      var replyHit = makeRawMentionHit_(channelId, channelName, reply, thread);
      if (replyHit) hits.push(replyHit);
    });
  });
  return hits;
}

function makeRawMentionHit_(channelId, channelName, message, prefetchedThread) {
  if (!message || message.user === CONFIG.MY_SLACK_USER_ID) return null;
  var text = getSlackMessageText_(message);
  var slackType = text.indexOf(SLACK_MARKERS.DIRECT) !== -1
    ? '个人提及'
    : (text.indexOf(SLACK_MARKERS.CS) !== -1 ? '@cs' : '');
  if (!slackType) return null;
  var hit = makeHistoryHit_(channelId, message, slackType);
  hit.channelName = channelName || '';
  if (prefetchedThread) hit.prefetchedThread = prefetchedThread;
  return hit;
}

function makeSlackEventHit_(event, existing, threadCache, stats) {
  if (!event || !event.eventId || !event.channelId || !event.messageTs) {
    return ignoreSlackEvent_(stats, 'invalid_event');
  }
  if (isExcludedSlackChannel_(event.channelId)) {
    return ignoreSlackEvent_(stats, 'excluded_channel');
  }

  var message = {
    ts: String(event.messageTs),
    thread_ts: String(event.threadTs || event.messageTs),
    user: String(event.userId || ''),
    bot_id: String(event.botId || ''),
    text: String(event.text || '')
  };
  var threadTs = String(message.thread_ts || message.ts);
  var key = buildSlackKey_(event.channelId, threadTs);
  var existingTask = existing.byKey[key] || null;
  if (existingTask && existingTask.ignored) {
    return ignoreSlackEvent_(stats, 'already_ignored');
  }

  if (isFullScanSlackChannel_(event.channelId)) {
    return makeHistoryHit_(event.channelId, message, '客服频道全量');
  }

  if (message.user !== CONFIG.MY_SLACK_USER_ID) {
    var mentionHit = makeRawMentionHit_(event.channelId, '', message, null);
    if (mentionHit) return mentionHit;
  }

  if (existingTask) {
    return makeHistoryHit_(event.channelId, message, '我参与的主题');
  }

  if (!message.user) return ignoreSlackEvent_(stats, 'missing_user');
  if (message.user === CONFIG.MY_SLACK_USER_ID) {
    return ignoreSlackEvent_(stats, 'own_message');
  }
  if (message.bot_id) return ignoreSlackEvent_(stats, 'bot_message');
  var cachedThread = threadCache[key];
  if (!cachedThread) {
    cachedThread = fetchThread_(event.channelId, threadTs);
    threadCache[key] = cachedThread;
  }

  var historicalMentionType = getThreadMentionType_(cachedThread);
  if (historicalMentionType) {
    var historicalMentionHit = makeHistoryHit_(
      event.channelId,
      message,
      historicalMentionType
    );
    historicalMentionHit.prefetchedThread = cachedThread;
    return historicalMentionHit;
  }

  var participated = cachedThread.some(function(item) {
    return item.user === CONFIG.MY_SLACK_USER_ID;
  });
  if (!participated) return ignoreSlackEvent_(stats, 'unrelated_thread');

  var hit = makeHistoryHit_(event.channelId, message, '我参与的主题');
  hit.prefetchedThread = cachedThread;
  return hit;
}

function getThreadMentionType_(thread) {
  var hasCsMention = false;
  var hasDirectMention = (thread || []).some(function(message) {
    var text = getSlackMessageText_(message);
    if (text.indexOf(SLACK_MARKERS.DIRECT) !== -1) return true;
    if (text.indexOf(SLACK_MARKERS.CS) !== -1) hasCsMention = true;
    return false;
  });
  if (hasDirectMention) return '个人提及';
  return hasCsMention ? '@cs' : '';
}

function ignoreSlackEvent_(stats, reason) {
  if (stats) {
    if (!stats.ignoredReasons) stats.ignoredReasons = {};
    stats.ignoredReasons[reason] = Number(stats.ignoredReasons[reason] || 0) + 1;
  }
  return null;
}

function fetchSlackEventQueue_() {
  var config = getSlackEventBridgeConfig_();
  var response = slackEventBridgeRequest_(
    config.url + '/queue?limit=' + encodeURIComponent(CONFIG.EVENT_BATCH_SIZE),
    'get',
    config.secret,
    null
  );
  return Array.isArray(response.events) ? response.events : [];
}

function acknowledgeSlackEvents_(eventIds) {
  if (!eventIds || !eventIds.length) return;
  var config = getSlackEventBridgeConfig_();
  slackEventBridgeRequest_(config.url + '/ack', 'post', config.secret, {
    eventIds: eventIds
  });
}

function getSlackEventBridgeConfig_() {
  var properties = PropertiesService.getScriptProperties();
  var url = String(properties.getProperty(CONFIG.SLACK_EVENT_BRIDGE_URL_PROPERTY) || '')
    .replace(/\/+$/, '');
  var secret = String(properties.getProperty(CONFIG.SLACK_EVENT_BRIDGE_SECRET_PROPERTY) || '');
  if (!/^https:\/\//.test(url) || !secret) {
    throw new Error(
      'Script Properties に ' + CONFIG.SLACK_EVENT_BRIDGE_URL_PROPERTY +
      ' と ' + CONFIG.SLACK_EVENT_BRIDGE_SECRET_PROPERTY + ' を設定してください。'
    );
  }
  return { url: url, secret: secret };
}

function slackEventBridgeRequest_(url, method, secret, payload) {
  var options = {
    method: method,
    headers: { Authorization: 'Bearer ' + secret },
    muteHttpExceptions: true
  };
  if (payload !== null) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }
  var response = UrlFetchApp.fetch(url, options);
  var status = response.getResponseCode();
  var body = response.getContentText();
  var data;
  try {
    data = JSON.parse(body);
  } catch (error) {
    throw new Error('Slack event bridge が JSON 以外を返しました: HTTP ' + status);
  }
  if (status < 200 || status >= 300 || !data.ok) {
    throw new Error(
      'Slack event bridge error: HTTP ' + status + ' ' + (data.error || body)
    );
  }
  return data;
}

function fetchChannelHistoryHits_(channelId, oldestSeconds) {
  return fetchChannelHistoryMessages_(channelId, oldestSeconds).map(function(message) {
    return makeHistoryHit_(channelId, message, '客服频道全量');
  });
}

function fetchChannelHistoryMessages_(channelId, oldestSeconds) {
  var messages = [];
  var cursor = '';
  var page = 0;

  do {
    page += 1;
    var params = {
      channel: channelId,
      oldest: String(oldestSeconds),
      inclusive: true,
      limit: CONFIG.HISTORY_PAGE_SIZE
    };
    if (cursor) params.cursor = cursor;

    var response = slackApi_('conversations.history', params);
    (response.messages || []).forEach(function(message) {
      if (!message.ts || Number(message.ts) < oldestSeconds) return;
      messages.push(message);
    });
    cursor = response.response_metadata && response.response_metadata.next_cursor
      ? response.response_metadata.next_cursor
      : '';
  } while (cursor && page < CONFIG.MAX_HISTORY_PAGES);

  if (cursor) {
    logRun_('WARN', 'Slack channel history reached the maximum page count', {
      channelId: channelId,
      maxPages: CONFIG.MAX_HISTORY_PAGES
    });
  }
  return messages;
}

function makeHistoryHit_(channelId, message, slackType) {
  var messageTs = String(message.ts || '');
  var threadTs = String(message.thread_ts || messageTs);
  return {
    channelId: channelId,
    channelName: '',
    messageTs: messageTs,
    threadTs: threadTs,
    requesterId: message.user || message.bot_id || '',
    requesterName: message.username || '',
    text: getSlackMessageText_(message),
    permalink: '',
    slackType: slackType || '客服频道全量'
  };
}

function prepareParticipationHit_(hit, thread) {
  if (hit.slackType !== '我参与的主题') return hit;

  var lastMine = null;
  thread.forEach(function(message) {
    if (message.user === CONFIG.MY_SLACK_USER_ID) lastMine = message;
  });
  var newerOtherMessages = thread.filter(function(message) {
    return message.user &&
      message.user !== CONFIG.MY_SLACK_USER_ID &&
      (!lastMine || Number(message.ts) > Number(lastMine.ts));
  });
  var sourceMessages = newerOtherMessages.length
    ? newerOtherMessages.slice(-3)
    : (lastMine ? [lastMine] : []);
  if (!sourceMessages.length) return hit;

  var prepared = {};
  Object.keys(hit).forEach(function(key) { prepared[key] = hit[key]; });
  prepared.text = sourceMessages.map(getSlackMessageText_).filter(Boolean).join('\n');
  if (newerOtherMessages.length) {
    var latestOther = newerOtherMessages[newerOtherMessages.length - 1];
    prepared.requesterId = latestOther.user || prepared.requesterId;
    prepared.messageTs = String(sourceMessages[0].ts || prepared.messageTs);
  }
  return prepared;
}

function searchSlackQuery_(query, oldestSeconds) {
  var matches = [];
  var page = 1;

  while (page <= CONFIG.MAX_SEARCH_PAGES) {
    var response = slackApi_('search.messages', {
      query: query,
      count: CONFIG.SEARCH_PAGE_SIZE,
      page: page,
      sort: 'timestamp',
      sort_dir: 'desc',
      highlight: false
    });

    var pageMatches = response.messages && response.messages.matches
      ? response.messages.matches
      : [];

    pageMatches.forEach(function(match) {
      if (Number(match.ts) >= oldestSeconds) {
        matches.push(match);
      }
    });

    var paging = response.messages && response.messages.paging
      ? response.messages.paging
      : {};
    var pagination = response.messages && response.messages.pagination
      ? response.messages.pagination
      : {};
    var reachedOldest = pageMatches.some(function(match) {
      return Number(match.ts) < oldestSeconds;
    });
    var totalPages = Number(paging.pages || pagination.page_count || 1);

    if (pageMatches.length === 0 || reachedOldest || page >= totalPages) {
      break;
    }
    page += 1;
  }

  if (page > CONFIG.MAX_SEARCH_PAGES) {
    logRun_('WARN', 'Slack 検索が最大ページ数に達しました。', { query: query });
  }

  return matches;
}

function makeSearchHit_(match, slackType) {
  var channel = match.channel || {};
  var messageTs = String(match.ts || '');
  var threadTs = String(match.thread_ts || extractThreadTsFromUrl_(match.permalink) || messageTs);

  if (!channel.id || !messageTs) {
    throw new Error('Slack search result に channel ID または message ts がありません。');
  }

  return {
    channelId: channel.id,
    channelName: channel.name || '',
    messageTs: messageTs,
    threadTs: threadTs,
    requesterId: match.user || match.bot_id || '',
    requesterName: match.username || '',
    text: getSlackMessageText_(match),
    permalink: match.permalink || '',
    slackType: slackType
  };
}

function fetchThread_(channelId, threadTs) {
  var messages = [];
  var cursor = '';

  do {
    var params = {
      channel: channelId,
      ts: threadTs,
      limit: CONFIG.THREAD_PAGE_SIZE
    };
    if (cursor) params.cursor = cursor;

    var response = slackApi_('conversations.replies', params);
    (response.messages || []).forEach(function(message) {
      messages.push(message);
    });
    cursor = response.response_metadata && response.response_metadata.next_cursor
      ? response.response_metadata.next_cursor
      : '';
  } while (cursor);

  messages.sort(function(a, b) {
    return Number(a.ts) - Number(b.ts);
  });
  return messages;
}

function getSlackChannel_(channelId, fallbackName) {
  if (SLACK_CACHE_.channels[channelId]) {
    return SLACK_CACHE_.channels[channelId];
  }

  try {
    var response = slackApi_('conversations.info', { channel: channelId });
    SLACK_CACHE_.channels[channelId] = response.channel || { id: channelId, name: fallbackName };
  } catch (error) {
    logRun_('WARN', 'チャンネル情報を取得できないため検索結果の名前を使用します。', {
      channelId: channelId,
      error: errorToString_(error)
    });
    SLACK_CACHE_.channels[channelId] = { id: channelId, name: fallbackName || channelId };
  }

  return SLACK_CACHE_.channels[channelId];
}

function getSlackUser_(userId, fallbackName) {
  if (!userId) {
    return { id: '', name: fallbackName || '不明' };
  }
  if (SLACK_CACHE_.users[userId]) {
    return SLACK_CACHE_.users[userId];
  }

  try {
    var response = slackApi_('users.info', { user: userId });
    var user = response.user || {};
    var profile = user.profile || {};
    SLACK_CACHE_.users[userId] = {
      id: userId,
      name: profile.display_name || profile.real_name || user.real_name || user.name || fallbackName || userId,
      handle: user.name || ''
    };
  } catch (error) {
    logRun_('WARN', 'ユーザー情報を取得できないため検索結果の名前を使用します。', {
      userId: userId,
      error: errorToString_(error)
    });
    SLACK_CACHE_.users[userId] = { id: userId, name: fallbackName || userId };
  }

  return SLACK_CACHE_.users[userId];
}

function buildSlackPermalink_(channelId, messageTs, fallbackUrl) {
  try {
    var response = slackApi_('chat.getPermalink', {
      channel: channelId,
      message_ts: messageTs
    });
    return response.permalink || fallbackUrl || '';
  } catch (error) {
    if (fallbackUrl) {
      logRun_('WARN', 'Permalink API が失敗したため検索結果の URL を使用します。', {
        channelId: channelId,
        messageTs: messageTs,
        error: errorToString_(error)
      });
      return fallbackUrl;
    }
    throw error;
  }
}

function validateSlackIdentity_() {
  var response = slackApi_('auth.test', {});
  if (response.user_id !== CONFIG.MY_SLACK_USER_ID) {
    throw new Error(
      'SLACK_USER_TOKEN の user_id (' + response.user_id +
      ') が CONFIG.MY_SLACK_USER_ID (' + CONFIG.MY_SLACK_USER_ID + ') と一致しません。'
    );
  }
  SLACK_CACHE_.auth = response;
}

function getDirectMentionSearchTerm_() {
  if (!SLACK_CACHE_.auth) {
    validateSlackIdentity_();
  }
  var handle = SLACK_CACHE_.auth.user;
  if (!handle) {
    throw new Error('auth.test から Slack user handle を取得できません。');
  }
  return '@' + handle;
}

function syncPersonalSlackDmForRow_(sheet, rowNumber, task) {
  var recordsCell = cleanDashboardValue_(
    sheet.getRange(rowNumber, CONFIG.COL.SLACK_DM_SCHEDULE_RECORDS).getValue()
  );
  var oldRecords = parseSlackDmScheduleRecords_(recordsCell);
  if (!task.slackDmEnabled) {
    cancelSlackDmScheduleRecords_(oldRecords);
    clearSlackDmScheduleFields_(sheet, rowNumber, true);
    return;
  }

  var recipients = resolveSlackUsersByFormalNames_(task.slackDmRecipientNames);
  var recipientIds = recipients.map(function(user) { return user.id; }).join(',');
  var sendAt = parseTokyoDateTimeInput_(task.slackDmSendAt);
  validateSlackDmScheduleTime_(sendAt, new Date());
  var existingIds = cleanDashboardValue_(
    sheet.getRange(rowNumber, CONFIG.COL.SLACK_DM_RECIPIENT_IDS).getValue()
  );
  var existingSendAt = formatTokyoDateTimeInput_(
    sheet.getRange(rowNumber, CONFIG.COL.SLACK_DM_SEND_AT).getValue()
  );
  var existingText = cleanDashboardValue_(
    sheet.getRange(rowNumber, CONFIG.COL.SLACK_DM_TEXT).getValue()
  );
  if (
    oldRecords.length === recipients.length &&
    existingIds === recipientIds &&
    existingSendAt === task.slackDmSendAt &&
    existingText === task.slackDmText
  ) {
    sheet.getRange(rowNumber, CONFIG.COL.SLACK_DM_ENABLED).setValue(true);
    sheet.getRange(rowNumber, CONFIG.COL.SLACK_DM_RECIPIENT_NAMES)
      .setValue(task.slackDmRecipientNames);
    return;
  }

  cancelSlackDmScheduleRecords_(oldRecords);
  var newRecords = [];
  try {
    recipients.forEach(function(user) {
      var response = slackApiPost_('chat.scheduleMessage', {
        channel: user.id,
        text: task.slackDmText,
        post_at: Math.floor(sendAt.getTime() / 1000)
      });
      if (!response.scheduled_message_id) {
        throw new Error('Slack が scheduled_message_id を返しませんでした：' + user.id);
      }
      newRecords.push({
        userId: user.id,
        channel: response.channel || user.id,
        scheduledMessageId: response.scheduled_message_id
      });
    });
  } catch (error) {
    cancelSlackDmScheduleRecords_(newRecords);
    clearSlackDmScheduleFields_(sheet, rowNumber, false);
    throw error;
  }

  sheet.getRange(rowNumber, CONFIG.COL.SLACK_DM_ENABLED).setValue(true);
  sheet.getRange(rowNumber, CONFIG.COL.SLACK_DM_RECIPIENT_NAMES)
    .setValue(task.slackDmRecipientNames);
  sheet.getRange(rowNumber, CONFIG.COL.SLACK_DM_RECIPIENT_IDS).setValue(recipientIds);
  sheet.getRange(rowNumber, CONFIG.COL.SLACK_DM_SEND_AT).setValue(sendAt);
  sheet.getRange(rowNumber, CONFIG.COL.SLACK_DM_TEXT).setValue(task.slackDmText);
  sheet.getRange(rowNumber, CONFIG.COL.SLACK_DM_SCHEDULE_RECORDS)
    .setValue(JSON.stringify(newRecords));
}

function removePersonalSlackDmForRow_(sheet, rowNumber) {
  var records = parseSlackDmScheduleRecords_(cleanDashboardValue_(
    sheet.getRange(rowNumber, CONFIG.COL.SLACK_DM_SCHEDULE_RECORDS).getValue()
  ));
  cancelSlackDmScheduleRecords_(records);
  sheet.getRange(rowNumber, CONFIG.COL.SLACK_DM_ENABLED).setValue(false);
  sheet.getRange(rowNumber, CONFIG.COL.SLACK_DM_SCHEDULE_RECORDS).clearContent();
}

function clearSlackDmScheduleFields_(sheet, rowNumber, clearInputs) {
  sheet.getRange(rowNumber, CONFIG.COL.SLACK_DM_ENABLED).setValue(false);
  sheet.getRange(rowNumber, CONFIG.COL.SLACK_DM_RECIPIENT_IDS).clearContent();
  sheet.getRange(rowNumber, CONFIG.COL.SLACK_DM_SCHEDULE_RECORDS).clearContent();
  if (!clearInputs) return;
  sheet.getRange(rowNumber, CONFIG.COL.SLACK_DM_RECIPIENT_NAMES).clearContent();
  sheet.getRange(rowNumber, CONFIG.COL.SLACK_DM_SEND_AT).clearContent();
  sheet.getRange(rowNumber, CONFIG.COL.SLACK_DM_TEXT).clearContent();
}

function parseSlackDmScheduleRecords_(value) {
  if (!value) return [];
  try {
    var records = JSON.parse(value);
    if (!Array.isArray(records)) throw new Error('not an array');
    return records;
  } catch (error) {
    throw new Error('Slack Scheduled Message Records が壊れています。手動確認してください。');
  }
}

function cancelSlackDmScheduleRecords_(records) {
  (records || []).forEach(function(record) {
    if (!record || !record.channel || !record.scheduledMessageId) return;
    try {
      slackApiPost_('chat.deleteScheduledMessage', {
        channel: record.channel,
        scheduled_message_id: record.scheduledMessageId
      });
    } catch (error) {
      if (!/invalid_scheduled_message_id|scheduled_message_not_found|message_not_found/i.test(String(error && error.message || error))) {
        throw error;
      }
    }
  });
}

function resolveSlackUsersByFormalNames_(formalNames) {
  var requested = String(formalNames || '').split(' / ').filter(Boolean);
  var users = listActiveSlackUsers_();
  return requested.map(function(name) {
    var key = normalizeSlackFormalNameKey_(name);
    var matches = users.filter(function(user) {
      return slackUserFormalNameKeys_(user).indexOf(key) !== -1;
    });
    if (!matches.length) {
      throw new Error('Slack 正式全名找不到：' + name);
    }
    if (matches.length > 1) {
      throw new Error('Slack 正式全名重复，无法安全发送：' + name);
    }
    return matches[0];
  });
}

function listActiveSlackUsers_() {
  if (SLACK_CACHE_.allUsers) return SLACK_CACHE_.allUsers;
  var users = [];
  var cursor = '';
  do {
    var params = { limit: 200 };
    if (cursor) params.cursor = cursor;
    var response = slackApi_('users.list', params);
    (response.members || []).forEach(function(user) {
      if (!user.id || user.deleted || user.is_bot || user.is_app_user) return;
      users.push(user);
    });
    cursor = response.response_metadata && response.response_metadata.next_cursor
      ? response.response_metadata.next_cursor
      : '';
  } while (cursor);
  SLACK_CACHE_.allUsers = users;
  return users;
}

function slackUserFormalNameKeys_(user) {
  var profile = user.profile || {};
  var values = [profile.real_name, user.real_name, profile.display_name];
  var unique = {};
  return values.map(normalizeSlackFormalNameKey_).filter(function(value) {
    if (!value || unique[value]) return false;
    unique[value] = true;
    return true;
  });
}

function slackApiPost_(method, payload) {
  var token = getSlackToken_();
  var url = 'https://slack.com/api/' + method;
  var attempt = 0;
  while (attempt <= CONFIG.MAX_API_RETRIES) {
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify(payload || {}),
      muteHttpExceptions: true
    });
    var status = response.getResponseCode();
    if (status === 429) {
      var headers = response.getAllHeaders();
      var retryAfter = Number(headers['Retry-After'] || headers['retry-after'] || 0);
      if (
        attempt < CONFIG.MAX_API_RETRIES && retryAfter > 0 &&
        retryAfter <= CONFIG.MAX_RATE_LIMIT_WAIT_SECONDS
      ) {
        Utilities.sleep(retryAfter * 1000);
        attempt += 1;
        continue;
      }
      throw new Error('Slack API rate limit: ' + method + ' Retry-After=' + retryAfter);
    }
    var body = response.getContentText();
    var data;
    try {
      data = JSON.parse(body);
    } catch (error) {
      throw new Error('Slack API が JSON 以外を返しました: ' + method + ' HTTP ' + status);
    }
    if (status < 200 || status >= 300) {
      throw new Error('Slack API HTTP error: ' + method + ' HTTP ' + status + ' ' + body);
    }
    if (!data.ok) {
      throw new Error('Slack API error: ' + method + ' ' + (data.error || 'ok:false'));
    }
    return data;
  }
  throw new Error('Slack API retry exhausted: ' + method);
}

function slackApi_(method, params) {
  var token = getSlackToken_();
  var query = Object.keys(params || {}).map(function(key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(String(params[key]));
  }).join('&');
  var url = 'https://slack.com/api/' + method + (query ? '?' + query : '');
  var attempt = 0;

  while (attempt <= CONFIG.MAX_API_RETRIES) {
    var response;
    try {
      response = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: { Authorization: 'Bearer ' + token },
        muteHttpExceptions: true
      });
    } catch (error) {
      logRun_('ERROR', 'Slack API の HTTP 呼び出しに失敗しました。', {
        method: method,
        error: errorToString_(error)
      });
      throw error;
    }

    var status = response.getResponseCode();
    if (status === 429) {
      var headers = response.getAllHeaders();
      var retryAfter = Number(headers['Retry-After'] || headers['retry-after'] || 0);
      logRun_('WARN', 'Slack API rate limit', {
        method: method,
        retryAfterSeconds: retryAfter,
        attempt: attempt + 1
      });

      if (
        attempt < CONFIG.MAX_API_RETRIES &&
        retryAfter > 0 &&
        retryAfter <= CONFIG.MAX_RATE_LIMIT_WAIT_SECONDS
      ) {
        Utilities.sleep(retryAfter * 1000);
        attempt += 1;
        continue;
      }
      throw new Error('Slack API rate limit: ' + method + ' Retry-After=' + retryAfter);
    }

    var body = response.getContentText();
    var data;
    try {
      data = JSON.parse(body);
    } catch (error) {
      throw new Error('Slack API が JSON 以外を返しました: ' + method + ' HTTP ' + status);
    }

    if (status < 200 || status >= 300) {
      throw new Error('Slack API HTTP error: ' + method + ' HTTP ' + status + ' ' + body);
    }
    if (!data.ok) {
      throw new Error('Slack API error: ' + method + ' ' + (data.error || 'ok:false'));
    }
    return data;
  }

  throw new Error('Slack API retry exhausted: ' + method);
}

function getSlackToken_() {
  var token = PropertiesService.getScriptProperties().getProperty(CONFIG.SLACK_TOKEN_PROPERTY);
  if (!token) {
    throw new Error(
      'Script Properties に ' + CONFIG.SLACK_TOKEN_PROPERTY + ' が設定されていません。'
    );
  }
  return token;
}

function getSlackMessageText_(message) {
  if (message && message.text) return String(message.text);
  var parts = [];

  function collect(value) {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (typeof value !== 'object') return;
    if (typeof value.text === 'string') parts.push(value.text);
    Object.keys(value).forEach(function(key) {
      if (key !== 'text') collect(value[key]);
    });
  }

  collect(message && message.blocks);
  return parts.join(' ');
}

function extractThreadTsFromUrl_(url) {
  if (!url) return '';
  var match = String(url).match(/[?&]thread_ts=([0-9.]+)/);
  return match ? match[1] : '';
}

function extractMessageTsFromUrl_(url) {
  var match = String(url || '').match(/\/p(\d{10})(\d{6})(?:[/?#]|$)/);
  return match ? match[1] + '.' + match[2] : '';
}
