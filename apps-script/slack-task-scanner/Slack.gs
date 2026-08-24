var SLACK_CACHE_ = {
  users: {},
  channels: {},
  auth: null
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

  var cs = convertSearchMatches_(
    searchSlackQuery_(CONFIG.CS_SEARCH_TERM + ' after:' + searchDate, oldestSeconds),
    SLACK_MARKERS.CS,
    '@cs'
  );

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
  stats.csMentions = cs.length;
  stats.participatedThreads = participated.length;
  logRun_('INFO', 'Slack mention 検索完了', {
    directMentions: direct.length,
    csMentions: cs.length,
    participatedThreads: participated.length,
    participationBootstrap: !bootstrapped
  });

  return direct.concat(cs, participated);
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
