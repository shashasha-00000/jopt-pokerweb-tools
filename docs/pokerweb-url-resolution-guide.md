# PokerWeb URL Resolution Guide

This note is the durable rulebook for PokerWeb Tampermonkey tools that need tournament URLs.

## Core Rule

Do not make every business script invent its own URL search.

Use one of these sources, in this order:

1. Explicit `TournamentId` or `URL` pasted by the user.
2. Shared URL Cache maintained by `PW URL Cache Manager`.
3. URL pool collected by Event Prefix, then matched locally.
4. Per-name DataTable search only as a fallback, not the main path.

## Preferred URL Pool Flow

Use this model when a tool needs URLs for many tournaments:

```text
Event Prefix
  -> scan OPEN/CLOSED tournament lists once
  -> collect URL pool: TournamentId / URL / Actual_Name
  -> match input tournament names locally
  -> Preview
  -> execute only unique matches
```

This is faster and safer than searching the PokerWeb DataTable once per tournament name.

## Safe Matching Rules

Auto-resolve only when the match is safe:

- `TournamentId` or `URL` exists: use it directly.
- Exact name match is OK.
- Compact exact name match is OK.
- Event Prefix plus tournament number can be used only when it still resolves to one candidate.
- Do not use broad `includes` matching for write operations.
- If there are multiple candidates, return `AMBIGUOUS`.
- If no candidate exists, return `NOT_FOUND`.

For Day1/store variants or duplicate names, require URL/TournamentId or manual confirmation.

## Shared URL Cache

Shared cache key:

```text
PW_SHARED_TOURNAMENT_URL_CACHE_V1
```

Recommended cache TSV columns:

```text
Name    TournamentId    URL    Actual_Name
```

Optional diagnostic columns:

```text
Source    SavedAt    Matched_Row
```

Business scripts should usually read the cache instead of scanning pages.

## Business Script Pattern

For Ticket Link, Prize, Fee Patch, Check, and existing tournament update tools:

```text
Input rows
  -> if URL/TournamentId present, use it
  -> else lookup Shared URL Cache
  -> if exactly one match, use it
  -> else report AMBIGUOUS or NOT_FOUND
  -> provide Copy Missing Names
```

Avoid making each tool open OPEN/CLOSED windows and search every name individually.

## Proven Logic To Reuse

When implementing a new URL resolver, first inspect working code before writing new logic.

Useful references:

- `tampermonkey/pw-url-cache-manager.user.js`
  - Shared URL Cache maintenance.
  - Event Prefix collection.
  - Google Sheet TSV export/import and full-cache replace.
- `tampermonkey/pw-prize-batch-manual.user.js`
  - Proven Event Prefix URL pool scan model.
  - Collects URLs in bulk, then matches locally.
- `tampermonkey/pw-ticket-link-semi-auto.user.js`
  - Shared cache consumption and candidate preview.

## Anti-Patterns

Avoid these unless there is a strong reason:

- Searching DataTable once per tournament name as the main workflow.
- Auto-accepting `includes` matches for write operations.
- Rebuilding the same URL scan logic separately in each script.
- Treating tournament name as a unique key when duplicate Day1/store variants exist.
- Silently choosing one candidate when several candidates match.

## Maintenance Rule

If an old A logic and old B logic have already worked, do not rewrite both from scratch.

First:

1. Locate the working implementation.
2. Identify the stable helper behavior.
3. Reuse or port that behavior narrowly.
4. Preserve the existing successful flow unless the user explicitly asks to redesign it.

