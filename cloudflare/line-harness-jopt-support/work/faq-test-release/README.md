# FAQ test candidate

Current simple-editor getAll snapshot: 75 nodes (11 menus, 64 leaf FAQs), 8 channels, 13 handoff types, 12 variables, 8 shared messages, 2 events. `source.json` excludes the logged-in user's identity. The legacy admin export is not the source.

## State

This is an offline test candidate, NOT an imported, activated, deployed or LINE-tested Harness release. Existing Harness and customer chats were not modified. Review flags and placeholder text are preserved. The source includes test event data; production release is blocked.

## Files and use

- `node build.mjs`: generate `release.json` and `validation.json` from the saved snapshot.
- `node test.mjs`: run the compiler checks; write `test-results.json`.
- `node server.mjs`: open http://127.0.0.1:8791 to inspect the converted Flex menu data. This server is read-only and loopback-only.
- `release.json`: wrapper package; NOT accepted directly by the existing automation Actions JSON field. `rules` holds candidate payloads matching the auto-reply fields, with extra source metadata.

## Before any Harness import

1. Select an actual test LINE account/audience and map its Harness account ID. Null account ID must NEVER be submitted because it means a global rule in Harness.
2. Implement or use a batch loader with staging/rollback. Existing POST auto-reply creates active rules immediately. Do not submit this entire package to that endpoint.
3. Register the resolved/handoff Postback handlers and chat-state updates. These are declared controls, not working automation actions. Never replace state updates with tags only.
4. Adapt event-specific values, message expansion, human intake fields and external-redirect branches. The preview intentionally leaves unresolved values visible.
5. Validate LINE message bodies and test on a real test account before any production activation.

The automation event selector can use `postback_received`; it does not import the FAQ. Its Actions field takes supported action arrays such as `add_tag` or `send_message`. The checked implementation lacks a built-in chat-status action.

Text source: user-provided Google App data; no FAQ wording has been rewritten. This preview uses source button labels and confirmation labels already present in the supplied app.
