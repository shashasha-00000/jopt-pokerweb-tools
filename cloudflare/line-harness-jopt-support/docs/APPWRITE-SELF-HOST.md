# JOPT LINE Harness: free storage deployment

This installation is based on upstream v0.24.2 with a local Appwrite storage adapter. It is a source deployment, not an unmodified official release bundle. Do not run the upstream setup/update installer against it: a vanilla bundle would remove the adapter and restore the R2 requirement.

## Services and ownership

- Cloudflare account: `xhpc007@gmail.com`, account ID `4d9c9e5363f3e4e66214398c88afd9f4`. Existing Workers Free account; this install did not activate R2 or upgrade Workers.
- Worker: `line-harness-jopt-support`.
- D1: `line-harness-jopt-support`, ID `e66caeb0-aa14-4f4a-80f0-b18bf87229e9`.
- Admin: https://line-harness-jopt-support.japanopenpoker.workers.dev/console/
- Appwrite email/password account: `xiao.h@japanopenpoker.com`; company email verified. No Google SSO used.
- Appwrite Free project: `JOPT LINE Harness`, ID `6ad33813000dd5ab3dca`, region `fra`.
- Private bucket: `line-harness-files`, ID `6ad338b3002987cffde2`.
- Endpoint: https://fra.cloud.appwrite.io/v1
- API key scopes: `files.read`, `files.write`. No expiration, as approved. No bucket/user/billing administration scope.
- Bucket file encryption was disabled with explicit user approval because Appwrite's S3 interface requires encryption and compression disabled. Compression is None. Bucket has no public roles. The Worker signs HTTPS storage requests.

The Appwrite free plan restricts service at its limits rather than selling overages. Workers/D1 remain on their free plan. This is about this installation; it is not a statement about unrelated services on the existing Cloudflare account.

## Credentials

Runtime secrets are in `apps/worker/.dev.vars`, which Git ignores. Its file ACL is restricted to the current Windows user. Cloudflare Worker secrets hold the deployed credentials. Do not copy credential values into this document, source code, browser bundles, or handoff screenshots.

`API_KEY` is the Harness administrator login key. `APPWRITE_API_KEY` is the file-service key. `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN` belong only to formal Channel `2011834690` (`JOPTお客様対応窓口`, `@575jlowz`).

The 30-day LINE token was issued through LINE's documented client_credentials API and the bot profile matched the formal account. The database tracks its expiry; upstream `services/token-refresh.ts` renews it before expiry. Do not repeatedly issue tokens for each request.

Vite copies `.dev.vars` into its server build directory. Keep this copy private too. It is outside `dist/client`, the only public asset directory. The deployed public assets were scanned and contained none of the four runtime secrets.

## Current cutover state (2026-10-17 JST)

The new Harness is deployed; login, formal-account profile, Appwrite-backed image upload/download/delete, and LINE's test event to the new `/webhook` endpoint succeeded.

At **2026-10-17 19:00 JST**, the user explicitly authorized replacing the existing FAQ receiver with Harness. The live LINE Webhook was changed from **https://jopt-line-faq.sawaki-k.workers.dev/webhook** to **https://line-harness-jopt-support.japanopenpoker.workers.dev/webhook**. API readback confirmed the new endpoint and `active: true`; LINE's test against the configured endpoint returned `success: true` and statusCode 200. A refreshed Official Account Manager page also displayed the new URL. The old FAQ deployment itself was not deleted.

The built-in `builtin-mileage-wallet-keyword` auto-reply (keyword `マイル`) was disabled before cutover and read back as inactive. Other configured automation/scenario/outgoing-webhook lists were empty. FAQ/Dify logic is not connected. Real inbound-message and manual-reply acceptance testing remains pending.

The non-secret before/after record is saved at `C:\Users\41512\Documents\Codex\2026-10-17\ok\outputs\LINE-Harness-入口切换记录.json`. Keep the previous URL in the record for rollback. The previously observed temporary trycloudflare URL came from a stale browser page and was not the live endpoint at cutover.

New tested endpoint: https://line-harness-jopt-support.japanopenpoker.workers.dev/webhook

No customer message or broadcast was sent. Existing follower/history import was not run. LINE Login and LIFF IDs are not configured, so customer-facing LIFF forms/login are not ready. Do not distribute the dashboard's generated friend-add link as a verified working LIFF flow.

## Build and deploy

Run from the source repository root. Node 20+ and pnpm 9.15.4 are expected. Use the installed pinned pnpm version to avoid virtual-store setting mismatches.

```powershell
npx.cmd --yes pnpm@9.15.4 --filter @line-crm/shared --filter @line-crm/line-sdk --filter @line-harness/update-engine build
$env:NEXT_BASE_PATH='/console'
$env:NEXT_PUBLIC_API_MODE='same-origin'
$env:NEXT_PUBLIC_API_URL='https://line-harness-jopt-support.japanopenpoker.workers.dev'
$env:NEXT_TELEMETRY_DISABLED='1'
npx.cmd --yes pnpm@9.15.4 --filter web build
if ($LASTEXITCODE -ne 0) { throw 'Admin build failed' }
Push-Location apps/worker
try {
  $env:HARNESS_WRANGLER_CONFIG='wrangler.appwrite.toml'
  $env:VITE_BOT_BASIC_ID='@575jlowz'
  npx.cmd vite build
  if ($LASTEXITCODE -ne 0) { throw 'Worker build failed' }
  node -e "require('node:fs').cpSync('../web/out','dist/client/console',{recursive:true})"
  if ($LASTEXITCODE -ne 0) { throw 'Admin asset copy failed' }
  $secretCopy = Join-Path (Get-Location) 'dist/line_harness_jopt_support/.dev.vars'
  $secretAcl = Get-Acl -LiteralPath $secretCopy
  $secretAcl.SetAccessRuleProtection($true, $false)
  $currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $secretAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($currentIdentity,'FullControl','Allow')))
  Set-Acl -LiteralPath $secretCopy -AclObject $secretAcl
  npx.cmd wrangler deploy --config dist/line_harness_jopt_support/wrangler.json
  if ($LASTEXITCODE -ne 0) { throw 'Deploy failed' }
} finally {
  Pop-Location
}
```

Do not deploy the upstream default `wrangler.toml`, which still demonstrates R2 configuration. Vite rebuilds `dist/client`, so copy admin assets after every Worker build. Do not use a wildcard copy into a nonexistent destination: use the directory copy above.

The Worker has no Cloudflare self-update API token. Keep it that way until a fork-aware update workflow exists. Source changes were not committed or pushed.

## Verification evidence

- Eight storage adapter tests cover request signing, byte ranges within buffers, nested keys, MIME/etag, quota/auth failures, XML pagination, rejected redirects, and fallback to native R2.
- Existing image, incoming-image, rich-menu, log-retention, webinar, upload, and CORS tests passed alongside the adapter tests (152 tests total after the redirect fix).
- Worker type check, Worker build, and admin static export passed.
- Actual Appwrite S3 upload/download/list/delete, a 6 MiB payload hash comparison, same-key overwrite, and unauthenticated-access denial (403) passed. Synthetic test objects were deleted.
- Actual deployed `/api/images` upload returned 201; image GET returned 200 and matching bytes; authenticated delete returned 200.
- Public health returned 200. Unauthenticated admin API returned 401. Browser login displayed the formal account.
- LINE's endpoint test returned `success: true`, statusCode 200. This was a verification event with an empty events array, not a customer send or full chat acceptance test.

## Previous deployment cleanup

Old LINE Harness Worker, Pages project and D1 were deleted and absence verified. The old `.mcp.json` LINE Harness entry was removed. The old local `C:\Users\41512\.line-harness` directory remains because the recursive deletion was blocked by execution policy; no bypass was attempted. Old R2 bucket absence cannot be verified while the R2 subscription is cancelled; do not reactivate billing merely to inspect it without the user's approval.

The separate `sha-slack-task-events` Worker remains stored but its workers.dev and preview entry points were disabled and tested unreachable. Its KV namespace was retained. This is separate from the formal LINE FAQ endpoint above.

## Official references

- https://appwrite.io/docs/products/storage/s3
- https://appwrite.io/docs/advanced/billing/free
- https://developers.line.biz/en/docs/basics/channel-access-token/
- https://developers.line.biz/en/reference/messaging-api/nojs/
