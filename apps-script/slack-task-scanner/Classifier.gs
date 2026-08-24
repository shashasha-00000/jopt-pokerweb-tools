function normalizeSlackMessage_(hit, thread, channel, requester, permalink) {
  var mentionMessage = thread.filter(function(message) {
    return String(message.ts) === String(hit.messageTs);
  })[0];
  var sourceText = mentionMessage ? getSlackMessageText_(mentionMessage) : hit.text;
  var rootMessage = thread.length ? thread[0] : null;
  var threadRootText = rootMessage ? getSlackMessageText_(rootMessage) : sourceText;
  var threadTs = hit.threadTs || hit.messageTs;

  return {
    uniqueKey: buildSlackKey_(hit.channelId, threadTs),
    channelId: hit.channelId,
    channelName: channel.name || hit.channelName || hit.channelId,
    messageTs: hit.messageTs,
    threadTs: threadTs,
    requesterId: hit.requesterId,
    requesterName: requester.name || hit.requesterName || hit.requesterId || '不明',
    sourceText: sourceText,
    cleanSourceText: cleanSlackText_(sourceText),
    threadRootText: threadRootText,
    cleanThreadRootText: cleanSlackText_(threadRootText),
    thread: thread,
    permalink: permalink,
    slackType: hit.slackType
  };
}

function classifyTask_(item) {
  var messagesAfterMention = item.thread.filter(function(message) {
    return Number(message.ts) >= Number(item.messageTs);
  });
  var myReplies = messagesAfterMention.filter(function(message) {
    return message.user === CONFIG.MY_SLACK_USER_ID && Number(message.ts) > Number(item.messageTs);
  });
  var latestMessage = messagesAfterMention.length
    ? messagesAfterMention[messagesAfterMention.length - 1]
    : null;
  var latestText = cleanSlackText_(getSlackMessageText_(latestMessage || {}));
  var slackState = classifySlackState_(item, myReplies, latestMessage, latestText);
  var requesterName = item.requesterName;

  return {
    sheetStatus: slackState === '处理中' ? '进行中' : '待确认',
    slackState: slackState,
    title: buildTaskTitle_(extractSlackThreadTitle_(item.cleanThreadRootText, item.cleanSourceText)),
    category: item.slackType === '@cs' ? '客户支持' : inferCategory_(item.cleanSourceText),
    priority: inferPriority_(item.cleanSourceText),
    nextAction: buildNextAction_(item.cleanSourceText, requesterName, slackState),
    completion: buildCompletionCondition_(item.cleanSourceText, requesterName),
    waitingFor: inferWaitingFor_(requesterName, slackState, latestMessage),
    memo: buildTaskMemo_(item, slackState)
  };
}

function extractSlackThreadTitle_(rootText, mentionText) {
  var rootParts = splitMeaningfulParts_(rootText);
  var bracketed = rootParts.filter(function(part) {
    return /【[^】]{1,40}】/u.test(part);
  })[0];
  if (bracketed) return bracketed;

  var rootCandidate = rootParts.filter(function(part) {
    return !/^(cc|ショウカン|お疲れさまです|お疲れ様です)$/iu.test(part);
  })[0];
  return rootCandidate || mentionText || rootText;
}

function classifySlackState_(item, myReplies, latestMessage, latestText) {
  if (item.slackType === '@cs') return '待确认';
  if (myReplies.length === 0) return '未回复';

  if (hasCompletionSignal_(latestText)) {
    return '完成候选';
  }

  var latestIsOther = latestMessage && latestMessage.user !== CONFIG.MY_SLACK_USER_ID;
  if (latestIsOther && hasRequestSignal_(latestText)) {
    return '处理中';
  }

  return '待确认';
}

function buildTaskTitle_(text) {
  var cleaned = normalizeWhitespace_(text)
    .replace(/^(お疲れさまです|お疲れ様です|お世話になっております)[、。\s]*/u, '')
    .replace(/^(確認|ご確認|対応|ご対応)を?お願いいたします[。\s]*/u, '');
  var first = splitMeaningfulParts_(cleaned)[0] || cleaned || 'Slack依頼の確認';

  first = first
    .replace(/について[、,].*$/u, '')
    .replace(/[。！？?].*$/u, '')
    .replace(/について$/u, '')
    .trim();

  return truncateText_(first || 'Slack依頼の確認', CONFIG.TITLE_MAX_LENGTH);
}

function buildNextAction_(text, requesterName, slackState) {
  var parts = splitMeaningfulParts_(text).filter(function(part) {
    return hasRequestSignal_(part) || /進捗|予定|フロー|日程|テスト/u.test(part);
  }).slice(0, 2);
  var subject = parts.length
    ? truncateText_(parts.map(normalizeRequestSubject_).join('／'), 140)
    : truncateText_(normalizeRequestSubject_(normalizeWhitespace_(text)), 100);

  if (slackState === '完成候选') {
    return '确认 Slack 主题是否可以结束';
  }
  if (slackState === '处理中') {
    return subject + 'への後続対応を行う';
  }
  return buildConfirmAndReplyAction_(subject, requesterName);
}

function buildCompletionCondition_(text, requesterName) {
  var parts = splitMeaningfulParts_(text).filter(function(part) {
    return hasRequestSignal_(part) || /進捗|予定|フロー|日程|テスト/u.test(part);
  }).slice(0, 2);

  if (!parts.length) return '';
  var subject = truncateText_(parts.map(normalizeRequestSubject_).join('／'), 120);
  if (/(確認|精査|調査|検討|対応)$/u.test(subject)) {
    return subject + 'し、' + requesterName + 'へ回答';
  }
  return subject + 'について' + requesterName + 'へ回答';
}

function normalizeRequestSubject_(text) {
  return normalizeWhitespace_(text)
    .replace(/[、,]?\s*(ご)?確認(を)?(お願い(いた)?します|してください|いただけますか).*$/u, '確認')
    .replace(/[、,]?\s*(ご)?対応(を)?(お願い(いた)?します|してください|いただけますか).*$/u, '対応')
    .replace(/[、,]?\s*お願いします.*$/u, '')
    .replace(/[。！？?]+$/u, '')
    .trim();
}

function buildConfirmAndReplyAction_(subject, requesterName) {
  if (/(確認|精査|調査|検討|対応)$/u.test(subject)) {
    return subject + 'し、' + requesterName + 'へ回答';
  }
  return subject + 'を確認し、' + requesterName + 'へ回答';
}

function inferWaitingFor_(requesterName, slackState, latestMessage) {
  if (slackState === '完成候选') return '';
  if (slackState === '处理中' && latestMessage && latestMessage.user === CONFIG.MY_SLACK_USER_ID) {
    return requesterName;
  }
  return requesterName;
}

function inferCategory_(text) {
  return /カスタマー|顧客|お客様|プライズ|付与|問い合わせ|問合せ/u.test(text)
    ? '客户支持'
    : '';
}

function inferPriority_(text) {
  return /至急|急ぎ|緊急|今日中|本日中|ASAP/u.test(text) ? '高' : '中';
}

function buildTaskMemo_(item, slackState) {
  var summary = truncateText_(normalizeWhitespace_(item.cleanSourceText), 260);
  var threadTitle = buildTaskTitle_(extractSlackThreadTitle_(item.cleanThreadRootText, item.cleanSourceText));
  return truncateText_(
    'Slack 状态: ' + slackState + '\n' +
    '频道: ' + item.channelName + '\n' +
    '发起人: ' + item.requesterName + '\n' +
    '主题: ' + threadTitle + '\n' +
    '摘要: ' + summary,
    CONFIG.MEMO_MAX_LENGTH
  );
}

function hasRequestSignal_(text) {
  return /確認|対応|お願い|回答|返信|共有|修正|調整|教えて|できますか|いただけ|必要|進捗|予定|テスト/u.test(text || '');
}

function hasCompletionSignal_(text) {
  return /対応完了|対応済み|解決しました|完了しました|クローズします|問題ありません/u.test(text || '');
}

function cleanSlackText_(text) {
  return normalizeWhitespace_(String(text || '')
    .replace(/<!subteam\^[A-Z0-9]+(?:\|[^>]+)?>/g, '')
    .replace(/<@[A-Z0-9]+>/g, '')
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<([^>]+)>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>'));
}

function splitMeaningfulParts_(text) {
  return String(text || '')
    .split(/[\n。！？?]+/u)
    .map(function(part) { return normalizeWhitespace_(part); })
    .filter(function(part) { return part.length >= 4; });
}

function normalizeWhitespace_(text) {
  return String(text || '').replace(/[\t\r ]+/g, ' ').replace(/\n+/g, '\n').trim();
}

function truncateText_(text, maxLength) {
  var value = String(text || '');
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 1)).trim() + '…';
}
