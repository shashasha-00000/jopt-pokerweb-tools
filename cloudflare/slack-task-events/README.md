# SHA Task Radar Slack event bridge

Slack Events API の署名を Cloudflare Worker で検証し、短期間 KV に保存します。
既存の Apps Script は認証付きでキューを取得するため、Task Radar の Web App を公開する必要はありません。

## セキュリティ

- Slack の `X-Slack-Signature` と timestamp を検証
- Slack Team ID / App ID を固定検証
- GAS からのキュー取得・ACK は bearer secret で保護
- イベントは KV で7日後に自動削除
- Slack への書き込み権限は不要

## Cloudflare 側の設定

1. `npx wrangler login`
2. KV namespace を作成し、`wrangler.jsonc` の `EVENT_QUEUE.id` を更新
3. Worker secret `SLACK_SIGNING_SECRET` を設定
4. Worker secret `GAS_PULL_SECRET` を設定
5. `npx wrangler deploy`

Slack の Request URL は次の形式です。

`https://sha-slack-task-events.<account>.workers.dev/slack/events`

GAS Script Properties には次を設定します。

- `SLACK_EVENT_BRIDGE_URL`: Worker のベース URL
- `SLACK_EVENT_BRIDGE_SECRET`: `GAS_PULL_SECRET` と同じ値
