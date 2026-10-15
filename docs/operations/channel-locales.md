# Learner channel languages

## Current deployment

LINE, Telegram and WhatsApp learner interfaces support `zh_TW` (Traditional Chinese), `zh_CN` (Simplified Chinese) and `en`. The management backend and system notifications support the same choices. Deployed as `2ec42e2` / schema35 after user approval. See [three-language implementation and boundaries](trilingual-locales.md) and [deployment/recovery evidence](trilingual-locales-deployment.md).

Language is an interface/recipient preference, not authentication, identity association, enrollment region, practice time zone or authorization. Singapore/Malaysia do not force Simplified Chinese. Existing choices remain intact; no preference or user-content backfill occurs.

## Learner controls

- Telegram private `/language zh_TW`, `/language zh_CN`, `/language en`; signed, private, deduplicated updates only. Older update IDs cannot overwrite newer choices or subsequent page changes.
- WhatsApp private `language <locale>` (optional leading slash); configured app-signature, business-account/phone and replay checks remain required. WhatsApp is not operationally configured by this change.
- LINE choices save only through a server-verified ID-token subject and same-origin POST. No browser subject/name/Email is accepted as identity authority.
- Pages expose all three language choices. Switching warns about unsent details/drafts, saves through the applicable verified credential and keeps private short-lived tokens in fragments, never language-query values. Cancellation retains unsent content. Expired/invalid credentials prevent saving/navigation.
- Supported page queries and the presentation cookie select UI language without silently rewriting another channel's saved recipient preference. Default/fallback remains Traditional Chinese; region never selects language.
- Bot links, practice receipts, newly queued Telegram reminders and individual reviewer alerts use the applicable saved language. Reminder/reviewer subscriptions stay opt-in. Existing queued payloads are not rewritten.

## Content and release

Typed dictionaries translate source-owned UI and current built-in catalog display labels. English catalogs retain `name_en`; Simplified presentation has explicit mappings and unknown/custom names fall back to the original. Method/region codes, counts, deadlines, learner names/reflections/reasons and historical publication snapshots are not converted. Rejection reasons remain administrator-authored content.

Privacy UI is translated, but the approved document language/version/hash and acceptance identity are not fabricated. Formal Simplified legal text requires review. WhatsApp Simplified decision delivery requires an explicitly configured, approved `zh_CN` template variation; it never silently substitutes Traditional Chinese.

The matching release requires the complete immutable migration chain through new **`0035_simplified_chinese_locale.sql`**, exact35 API/worker and `ops.locale_schema_ready()`. Historical0001–0034 must not be edited. Publishing/deployment and a coordinated recovery/reconciliation plan require separate approval. Browser mocks and local tests are not provider/device acceptance. Preserve all legacy bots and unrelated local files.

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。

Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
