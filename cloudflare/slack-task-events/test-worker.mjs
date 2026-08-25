import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import worker from './src/index.mjs';

class MemoryKv {
  constructor() { this.values = new Map(); }
  async put(key, value) { this.values.set(key, value); }
  async get(key, type) {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return type === 'json' ? JSON.parse(value) : value;
  }
  async delete(key) { this.values.delete(key); }
  async list({ prefix, limit }) {
    return {
      keys: [...this.values.keys()]
        .filter((key) => key.startsWith(prefix))
        .slice(0, limit)
        .map((name) => ({ name }))
    };
  }
}

const signingSecret = 'test-signing-secret';
const pullSecret = 'test-pull-secret';
const env = {
  SLACK_SIGNING_SECRET: signingSecret,
  GAS_PULL_SECRET: pullSecret,
  SLACK_TEAM_ID: 'T089X4N982U',
  SLACK_APP_ID: 'A0BSKB5SZB2',
  EVENT_QUEUE: new MemoryKv()
};

function signedRequest(path, payload) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = 'v0=' + crypto
    .createHmac('sha256', signingSecret)
    .update(`v0:${timestamp}:${body}`)
    .digest('hex');
  return new Request(`https://worker.example${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': signature
    },
    body
  });
}

let response = await worker.fetch(signedRequest('/slack/events', {
  type: 'url_verification',
  challenge: 'challenge-value'
}), env);
assert.equal(response.status, 200);
assert.equal((await response.json()).challenge, 'challenge-value');

const eventPayload = {
  type: 'event_callback',
  event_id: 'Ev-test-1',
  event_time: Math.floor(Date.now() / 1000),
  team_id: env.SLACK_TEAM_ID,
  api_app_id: env.SLACK_APP_ID,
  event: {
    type: 'message',
    channel: 'COTHER',
    channel_type: 'channel',
    ts: '1787545807.258779',
    thread_ts: '1500000000.000001',
    user: 'UOTHER',
    text: '<!subteam^S092SRF3JG0> 確認お願いします'
  }
};
response = await worker.fetch(signedRequest('/slack/events', eventPayload), env);
assert.equal(response.status, 200);
assert.equal(env.EVENT_QUEUE.values.size, 1);

response = await worker.fetch(new Request('https://worker.example/queue?limit=10', {
  headers: { authorization: `Bearer ${pullSecret}` }
}), env);
const queued = await response.json();
assert.equal(queued.events.length, 1);
assert.equal(queued.events[0].threadTs, '1500000000.000001');

response = await worker.fetch(new Request('https://worker.example/ack', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${pullSecret}`,
    'content-type': 'application/json'
  },
  body: JSON.stringify({ eventIds: ['Ev-test-1'] })
}), env);
assert.equal(response.status, 200);
assert.equal(env.EVENT_QUEUE.values.size, 0);

response = await worker.fetch(new Request('https://worker.example/slack/events', {
  method: 'POST',
  headers: {
    'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)),
    'x-slack-signature': 'v0=invalid'
  },
  body: JSON.stringify(eventPayload)
}), env);
assert.equal(response.status, 401);

console.log('Slack event bridge validation passed.');
