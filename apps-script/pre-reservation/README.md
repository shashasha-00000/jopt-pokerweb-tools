# Pre-reservation Scripts

This directory groups the Apps Script files used for pre-reservation sheet setup and mail handling.

## Current

Use the files in [`current`](D:\GitHub\jopt-pokerweb-tools\apps-script\pre-reservation\current) for the current workflow:

- `PreReservationMenus.gs`
- `PreReservationTemplateExtractor.gs`
- `PreReservationTemplateDrivenMailer.gs`
- `PreReservationColorRules.gs`

These cover:

- extracting mail templates from existing Gmail hyperlinks
- building `REPORT_PRE_RES_MAIL`
- creating drafts / sending approved rows
- applying color rules
- marking older duplicate applications by email or Game ID
- syncing LivePocket payment confirmations from a pasted full Game ID list

## Duplicate And LivePocket Payment Flow

1. Run `重複申請を整理（最新を残す）`.
   - Matching email OR matching Game ID is treated as the same application group.
   - The latest timestamp wins; the later source row wins when timestamps are equal.
   - Older rows receive `重複` in the manual-action column.
   - Rows already marked `重複` manually are excluded from the judgment.
2. Open `LIVEPOCKET_GAME_ID`.
   - Paste the complete current list of paid LivePocket Game IDs into column A.
   - Keep the header in row 1 and paste IDs from A2 downward.
3. Run `LivePocket決済確認を反映`.
   - Existing confirmations stay checked.
   - Only newly matched current applications are checked.
   - Columns B-D show whether each ID is newly confirmed, already confirmed, unmatched, or an old duplicate requiring review.

## Deployment Rule

For any future pre-reservation script that sends mail, keep `appsscript.json` as part of the deployment payload.

Recommended manifest settings:

- `timeZone: "Asia/Tokyo"`
- `runtimeVersion: "V8"`
- `exceptionLogging: "STACKDRIVER"`
- explicit `oauthScopes` for:
  - spreadsheets
  - drive
  - gmail
  - userinfo.email

Reason:

- shared projects can fail to prompt cleanly for first-time users
- copied projects and clasp-synced projects are more stable with explicit scopes
- mail-related scripts should be deployed with the manifest intentionally, not left to scope auto-detection

## First-time Authorization

For shared use, add this instruction whenever handing the sheet/project to another staff member:

`初回利用時は、Apps Scriptを開き、対象の実行関数を一度手動実行して権限を許可してください。`

This should be treated as the default first-use step for mail-related scripts.

## Legacy Builder

The files in [`legacy-builder`](D:\GitHub\jopt-pokerweb-tools\apps-script\pre-reservation\legacy-builder) are older control-panel style sheet builders.

- Keep them for reference and possible reuse.
- They are still useful as a rough table-building approach.
- They are not the recommended long-term mail-sending stack.

Current understanding:

- the builder approach is still usable, but clunky
- a future cleaner setup flow should likely be:
  1. copy the top 6 layout rows
  2. move / adjust the title manually
  3. paste or refresh form links
  4. paste or refresh mail hyperlinks only if the colleague has not already set them
  5. if links are missing but mail body text exists, scan the body source and rebuild the hyperlink automatically

## Legacy Reports

The files in [`legacy-reports`](D:\GitHub\jopt-pokerweb-tools\apps-script\pre-reservation\legacy-reports) are the older report-based reservation mail tools.

- `ReservationMailReports.gs`
- `ReservationMailReports3on3.gs`
- `PloReservationMailReports.gs`

They contain stronger older report logic and are useful reference when reintroducing stricter duplicate handling.

## Cleanup Rule

Going forward, pre-reservation scripts should be added here instead of back into the `apps-script` root.
