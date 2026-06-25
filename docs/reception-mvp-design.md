# JOPT Reception MVP

## Scope

This MVP creates a Google Apps Script HTML app that writes reception orders to a Google Sheet and generates a direct Tampermonkey QR payload:

```text
JOPT-RCP:v1:<base64url-json>
```

The QR contains the execution data needed by Tampermonkey. Sheet logging is for record keeping and later reconciliation, not a blocking runtime dependency for PokerWeb reception.

## Sheets

- `Orders`: one row per reception order.
- `OrderPayments`: one row per non-zero payment split.
- `TicketRules`: MVP ticket/voucher matching rules.
- `受付設定`: human-maintained reception settings. The app only shows rows where `受付ON` is true, `PW大会ID` is set, and the current time is inside `受付開始` / `受付終了` when those fields are set.
- `Settings`: system settings.
- `Logs`: app and future Tampermonkey logs.

## MVP Seed Data

Tournament `4905`:

- `大会名`: `test10086`
- `PW大会ID`: `4905`
- `EN金額`: `31000`
- `RE金額`: `30000`
- `TE金額`: `-12000`
- `受付開始` / `受付終了`: blank in the seed row, meaning no time filtering for the MVP test row.
- `main_ticket_required`: `1`
- `main_ticket_name_exact`: `JOPT 2026 Grand Final / Main Event / -2027.03.31`

Ticket rules:

- Main Event Ticket: `JOPT 2026 Grand Final / Main Event / -2027.03.31`
- Voucher: `【JOPT 2026 Grand Final】10,000 Voucher / -2026.07.31`

## Next Integration

Tampermonkey currently accepts a fixed test QR. The next step is to add parsing for `JOPT-RCP:v1:<base64url-json>` and map the payload to the existing working order object.
