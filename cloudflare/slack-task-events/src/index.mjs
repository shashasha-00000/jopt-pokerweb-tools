const EVENT_PREFIX = 'event:';
const EVENT_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_BATCH_SIZE = 100;
const ALLOWED_MESSAGE_SUBTYPES = new Set(['', 'thread_broadcast']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResponse_({ ok: true });
    }

    if (request.method === 'POST' && url.pathname === '/slack/events') {
      return receiveSlackEvent_(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/queue') {
      return readQueue_(request, env, url);
    }

    if (request.method === 'POST' && url.pathname === '/ack') {
      return acknowledgeEvents_(request, env);
    }

    return jsonResponse_({ ok: false, error: 'not_found' }, 404);
  }
};

async function receiveSlackEvent_(request, env) {
  const rawBody = await request.text();
  const verified = await verifySlackRequest_(request.headers, rawBody, env.SLACK_SIGNING_SECRET);
  if (!verified) {
    return jsonResponse_({ ok: false, error: 'invalid_signature' }, 401);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    return jsonResponse_({ ok: false, error: 'invalid_json' }, 400);
  }

  if (payload.type === 'url_verification') {
    return jsonResponse_({ challenge: payload.challenge });
  }

  if (payload.team_id !== env.SLACK_TEAM_ID || payload.api_app_id !== env.SLACK_APP_ID) {
    return jsonResponse_({ ok: false, error: 'wrong_slack_app' }, 403);
  }

  if (payload.type !== 'event_callback' || !payload.event_id) {
    return jsonResponse_({ ok: true, ignored: true });
  }

  const event = payload.event || {};
  const subtype = String(event.subtype || '');
  if (event.type !== 'message' || !event.channel || !event.ts ||
      !ALLOWED_MESSAGE_SUBTYPES.has(subtype)) {
    return jsonResponse_({ ok: true, ignored: true });
  }

  const queued = {
    eventId: String(payload.event_id),
    eventTime: Number(payload.event_time || 0),
    teamId: String(payload.team_id || ''),
    channelId: String(event.channel),
    channelType: String(event.channel_type || ''),
    messageTs: String(event.ts),
    threadTs: String(event.thread_ts || event.ts),
    userId: String(event.user || ''),
    botId: String(event.bot_id || ''),
    subtype: subtype,
    text: String(event.text || '')
  };

  await env.EVENT_QUEUE.put(EVENT_PREFIX + queued.eventId, JSON.stringify(queued), {
    expirationTtl: EVENT_TTL_SECONDS
  });

  return jsonResponse_({ ok: true });
}

async function readQueue_(request, env, url) {
  if (!isBridgeAuthorized_(request, env)) {
    return jsonResponse_({ ok: false, error: 'unauthorized' }, 401);
  }

  const requestedLimit = Number(url.searchParams.get('limit') || MAX_BATCH_SIZE);
  const limit = Math.max(1, Math.min(MAX_BATCH_SIZE, requestedLimit || MAX_BATCH_SIZE));
  const listed = await env.EVENT_QUEUE.list({ prefix: EVENT_PREFIX, limit: limit });
  const events = [];

  for (const key of listed.keys || []) {
    const value = await env.EVENT_QUEUE.get(key.name, 'json');
    if (value) events.push(value);
  }

  events.sort((a, b) => Number(a.eventTime || 0) - Number(b.eventTime || 0));
  return jsonResponse_({ ok: true, events: events });
}

async function acknowledgeEvents_(request, env) {
  if (!isBridgeAuthorized_(request, env)) {
    return jsonResponse_({ ok: false, error: 'unauthorized' }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (error) {
    return jsonResponse_({ ok: false, error: 'invalid_json' }, 400);
  }

  const ids = Array.isArray(payload.eventIds) ? payload.eventIds.slice(0, MAX_BATCH_SIZE) : [];
  await Promise.all(ids.map((id) => env.EVENT_QUEUE.delete(EVENT_PREFIX + String(id))));
  return jsonResponse_({ ok: true, acknowledged: ids.length });
}

export async function verifySlackRequest_(headers, rawBody, signingSecret, nowMs = Date.now()) {
  if (!signingSecret) return false;
  const timestamp = String(headers.get('x-slack-request-timestamp') || '');
  const receivedSignature = String(headers.get('x-slack-signature') || '');
  const timestampSeconds = Number(timestamp);
  if (!timestampSeconds || Math.abs(nowMs / 1000 - timestampSeconds) > 300) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode('v0:' + timestamp + ':' + rawBody)
  );
  const calculatedSignature = 'v0=' + Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return constantTimeEqual_(calculatedSignature, receivedSignature);
}

function isBridgeAuthorized_(request, env) {
  const authorization = String(request.headers.get('authorization') || '');
  const expected = 'Bearer ' + String(env.GAS_PULL_SECRET || '');
  return Boolean(env.GAS_PULL_SECRET) && constantTimeEqual_(authorization, expected);
}

function constantTimeEqual_(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function jsonResponse_(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status: status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}
