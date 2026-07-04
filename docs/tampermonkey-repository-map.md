# Tampermonkey Repository Map

This repo keeps the shared/current Tampermonkey scripts in `tampermonkey/`.
Scripts under `legacy/`, `private/`, `experimental/`, and `test-scripts/` are not listed on the installer page.

## Current shared scripts

| File | Display name | Role | Notes |
| --- | --- | --- | --- |
| `pw-tournament-create-auto.user.js` | PW Tournament Create Auto | New tournament create flow | API-first create, USDT, items, and Ticket Link. |
| `pw-tournament-blind-manual.user.js` | PW Tournament Blind Manual | Existing tournament blind setup | Usable, pending safer template/preview upgrade. Rules are currently hardcoded. |
| `pw-ticket-link-semi-auto.user.js` | PW Ticket Link Semi Auto | Existing tournament Ticket Link | Confirmed URL flow, background fetch, then POST Ticket Link. |
| `pw-prize-batch-manual.user.js` | PW Prize Plan Semi Auto | Prize Plan check/write | File name kept for the recently shared install URL. |
| `pw-national-ticket-batch.user.js` | PW National Ticket Batch | National ticket issue flow | Batch issue by Game ID and ticket name. |
| `pw-receipt-full-auto.user.js` | PW Receipt Full Auto | Receipt full-auto flow | Current V7 line; old V6 is in `legacy/`. |
| `pw-receipt-manual-check.user.js` | PW Receipt Manual Check | Receipt manual/additional flow | Game ID + keyword search, URL confirmation, and payment TSV output. |
| `pw-tournament-double-check.user.js` | PW Tournament Double Check | Read-only tournament check | Checks Start, EN, RE, TE, Chips, Ticket Link, and USDT. |
| `pw-url-cache-manager.user.js` | PW URL Cache Manager | Shared URL cache maintenance | Search, collect, audit, repair, and TSV export. |
| `pw-main-event-ticket-check.user.js` | PW Main Event Ticket Check | Read-only ticket holder check | Single Game ID Main Event ticket status. |
| `pw-cashier-ticket-check.user.js` | PW Cashier Ticket Check | Read-only cashier-page check | Lightweight Main Event ticket check from cashier page. |

## Other folders

| Folder | Meaning |
| --- | --- |
| `tampermonkey/legacy/` | Old working scripts kept for fallback or reference. Do not install by default. |
| `tampermonkey/private/` | Personal or dangerous self-use tools. Do not share by default. |
| `tampermonkey/experimental/` | Experimental product ideas or prototypes. |
| `tampermonkey/test-scripts/` | POC and test artifacts. |

## Naming rule

Current shared files use stable function names and do not include version numbers.
Versions belong in `// @version`.
When a current script is replaced, move the old file into `legacy/` with its version in the filename, then let the new script keep the stable current filename.

The installer page reads `tampermonkey/scripts.json`, which is generated only from root-level `tampermonkey/*.user.js`.
