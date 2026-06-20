# AGENTS.md

## Repository Rule

All PokerWeb / Tampermonkey / Apps Script related code changes must use this local repository:

`C:\Users\41512\Documents\GitHub\jopt-pokerweb-tools`

If the current environment is not this directory, inspect and use this path first. Do not use a temporary Codex directory as the official source of code.

## Customer-Facing Copy Safety

When working with customer-facing text such as emails, announcements, contracts, customer notices, support replies, or any content that may be sent outside the team:

1. Use user-provided original text exactly as the source of truth. Do not silently rewrite, summarize, polish, or supplement it.
2. Do not silently invent customer-facing copy.
3. If any customer-facing text is AI-written, explicitly label it before implementation and in the final response:
   `AI作成草案・原文未確認。使用前に確認してください。`
4. If a complete original text has not been provided for a message type, do not present it as a confirmed template.
5. For generated tools that create drafts, send emails, or prepare customer notifications, default to allowing only user-provided original text.
6. If AI-written draft text must be used, get explicit user confirmation first.
7. In the final response for customer-facing copy work, list each message/template source as one of:
   - `ユーザー提供原文`
   - `AI作成草案`
   - `原文未提供`

