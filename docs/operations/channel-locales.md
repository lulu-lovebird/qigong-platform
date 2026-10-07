# Learner channel languages

## Implemented locally, not deployed

Telegram and the new WhatsApp adapter support `zh_TW` (default, Traditional Chinese) and `en`. LINE remains Traditional Chinese. Language is an interface preference, not authentication, identity association, practice time zone, or authorization.

`0015_channel_locales.sql` stores preferences per `(platform, external_subject_id)` in a forced-RLS table. They can exist before an application/person is created. The person's existing `preferred_locale` column is not used to silently change another channel's preference. Raw-subject setters are callable only by the restricted API role and must be reached through verified private-message adapters; the browser endpoints resolve subjects from valid short-lived link tokens instead.

## Learner controls

- Telegram: `/language en` or `/language zh_TW` in the new bot's private chat. Group/bot/unauthenticated updates cannot change preferences. Retried/older language update IDs do not overwrite a newer setting or a subsequent page change.
- WhatsApp: `language en` or `language zh_TW` (a leading slash is also accepted). Only app-signature-verified messages for the configured new business account/phone are processed.
- Application/check-in pages: `English` / `繁體中文` button saves the channel preference through a token-authorized same-origin POST, then reloads with the same token in a fragment, never a query parameter. Forms/selections are not preserved across this reload. An invalid/expired token prevents saving/navigation.
- Bot links include `?lang=en` for English. Direct page queries are presentation only; unsupported language values fall back to Traditional Chinese and never become SQL identifiers or translation keys.
- Approval/rejection notifications use the recipient channel's saved language when the worker sends them. LINE notifications are unchanged. WhatsApp uses approved localized Meta templates, not translated free text outside its service window.

Common application labels, practice/history/deadline controls, feedback and Telegram replies are translated by the typed `learner-locale.ts` dictionaries. English catalogs and history use `core.practice_methods.name_en` and parent English names; method codes, selections, region codes and database deadline rules remain unchanged. Course-name transliterations should be reviewed by the product owner before broader rollout. Administrator UI and administrator-written rejection reasons are not translated by this feature.

## Verification and release

Local tests cover dictionary completeness/fallback, generated-script execution, identity-bound page switching, signed/private language commands and replay safety, English catalog/history, notification language, and Telegram/LINE regression. These are not real-device or provider-account acceptance tests.

The current API requires the **complete chain through `0017_admin_reporting.sql`** (`0016` adds WhatsApp; `0017` adds read-only admin reporting); `0015` or `0016` alone is not enough for the current build. Align the API, worker and migrations before deployment. Keep old bots unchanged and follow the separate release/restore gates in [LINE pilot](line-pilot.md) and [WhatsApp pilot](whatsapp-pilot.md). Do not modify historical migration checksums.

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。

Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
