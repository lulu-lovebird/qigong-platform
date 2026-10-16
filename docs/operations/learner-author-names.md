# Unified learner-feed author nicknames — local candidate37

## Status and diagnosis

Local repair approved; **not committed, pushed or deployed**. Production remains `6a2ae3f` / schema36 with its active realtime receipt service. The user has now confirmed that release's normal check-in receives its receipt immediately; that acceptance does not cover this new nickname candidate.

Read-only investigation found6 active publications:2 LINE publications with verified LINE cache rows,4 Telegram publications using generated aliases and no LINE identity link. The LINE cursor decorated LINE authors only; Telegram/general learner feed still returned stored publication aliases. No real names or reflection contents were printed and no accounts were matched by name/Email/phone.

## Learner-only presentation

Both LINE cursor variants and learner `journal_feed` / LINE-TG `community_feed` now use private naming helpers:

- LINE authors: the existing server-verified LINE profile nickname; unavailable/required-consent metadata uses the existing localized anonymous fallback.
- Telegram authors: a new verified Telegram profile nickname; until captured, retain the existing sharing alias/safe pseudonym. No registration-name fallback.
- Other author channels retain their sharing alias. WhatsApp's reader facade is unchanged.
- Reader authentication and author active/person/identity/channel/approved/privacy checks remain authoritative. Cached names alone do not grant access. Invalidated authors are not newly exposed; required-consent author metadata does not disclose the cached nickname.
- Ordering, cursor boundaries, pagination and reflection/tag/method snapshots are retained. Published aliases, source hashes, dates and text are not rewritten. The editor keeps the custom sharing alias, not the displayed platform nickname.
- Staff/general partner feeds keep their original publication aliases. The private decorator is **not** added to `core.journal_audience_feed`, external endpoints or staff endpoints. No direct public/API lookup of the helper/cache is granted.

Three-language notice explicitly explains verified LINE/TG author names and the fallback. The channel renderer protects this cross-provider notice, including its serialized dictionary value, from its older channel-label substitution; it must not turn “LINE / Telegram” into “LINE / LINE”. Names are emitted as literal data/text, never UI-converted or interpreted as HTML.

## Telegram metadata source and freshness

`telegram-profile.ts` normalizes only names from a caller's **already verified provider proof**. Display uses provider first/last name, or its username if first name is absent. Control characters, bots, wrong types and oversized combined values are omitted without making display metadata identity authority. Browser `displayName`, enrollment name, Email and phone are never sources.

- Private webhook: secret verified first, chat must be private and match `from.id`, non-bot. Cache only when the provider message has a valid recent date; groups/mismatches/unsigned requests do not write metadata. Production Telegram messages carry this date; older date-less test/client events remain compatible but cannot refresh the cache.
- Native Mini App: server verifies the existing HMAC, exact bot binding, signed subject, uniqueness and auth_date freshness before extracting profile metadata. The legacy subject-only verifier return contract is retained. Extra browser profile fields remain rejected by the strict endpoint.
- Refresh is a separate nonfatal metadata transaction, as with LINE, so a display-cache failure does not grant eligibility or replace/bypass the session/consent transaction. Warnings contain no raw user data.
- New forced-RLS cache keys by existing Telegram **platform identity**, never name. Unknown subjects create no orphan/person/cache. SQL freshness checks use proof time and monotonic webhook update IDs; late/replayed webhook and Mini App proofs cannot overwrite newer data. Nameless valid proofs retain the known nickname. Audits store a change flag/identity reference, not the nickname.

**Existing Telegram authors require a subsequent valid native launch or private Bot interaction to populate their own cache.** Opening a viewer's feed does not retrieve every other author's profile or infer their LINE account. No provider `getChat` scan, registration-name backfill or cross-channel identity merge is performed. Provider renames appear after the next sufficiently fresh verified interaction; cached names are last-verified metadata, not a guarantee of live provider freshness.

## Schema and release boundary

Only new `0037_learner_author_names.sql` is added. Existing0001–0036/dependency metadata/lockfiles remain immutable. It adds the empty Telegram profile cache, restricted refresh/private presentation helpers and the new architecture gate; existing feed function ownership/ACL/security attributes are preserved.

Candidate API requires exact37 / `phase-22-learner-author-names`. **Both** the minute notification worker and continuous receipt runtime now check `ops.learner_author_names_schema_ready()`. The existing production36 binaries/gates reject37. A future publication requires separate commit/push/deploy approval, final encrypted backups plus actual restore/preservation tests, and coordinated drain/stop/restart of **API, minute worker and realtime receipt service**. Preserve all existing operational flags and subscriptions. No live service was stopped or reconfigured during local repair.

A37→36 downgrade needs matching DB/API/both-worker code and approved reconciliation of post-release data/cache/queue updates. Binary-only schema rollback or replacing live writes with an old preparation dump is unsafe. This candidate itself neither emits extra chat messages nor changes realtime polling/batch behavior.

## Verification

Full dedicated PostgreSQL16 `pnpm verify`: **790 tests** (API598 / database184 / config2 / identity6), formatting, lint, source typecheck/build passed. Extra all-test TypeScript retains10 pre-existing errors; older timestamp intermittency is not claimed fixed.

- Both genuine learner HTTP paths in all three locales show the LINE author's LINE nickname and TG author's TG nickname, with literal Traditional/emoji/markup values. Publication rows, people and identity rows stay identical; staff/partner alias results remain the original aliases.
- Signed webhook/native refresh, cross-source stale/replay prevention, nameless proof preservation, name-free audits, wrong secrets, tampered HMAC/user, groups, bots, chat-ID mismatch, unknown subjects and body-profile forgeries covered.
- Private-table/helper/worker execution denial, inactive/revoked authors, required-consent metadata, fallback and missing-profile behavior covered. Historical LINE-only test expectations were updated to the approved learner-only cross-channel display contract, not removed.
  -36→37→repeat0 rehearsal fingerprints every existing application table (only intentional architecture/time fields excluded), old source JSON/hash and old function security metadata. New cache is empty/forced RLS, exactly4 restricted/private/gate functions added and readiness boundary tested. Historical35→36 upgrade is pinned to36.
- Actual compiled API + independent restricted synthetic PostgreSQL browser preview: **12 layouts**, LINE/TG ×3 locales ×390/1280. Both names render literally, missing author stays on safe alias, no registration-name leakage/HTML injection, cross-provider notice intact, original sharing-editor alias retained, no overflow/runtime/API failure. Provider identity was mocked; the native profile proof itself was HMAC-verified by the real endpoint.
- Harness fixture added its missing note row so the existing own-journal visibility rules could include it; no product visibility check was weakened. A DDL CASE expression was parenthesized during initial parsing validation; whole generated-HTML tests exposed and corrected the older broad channel-name substitution.

Evidence: `/tmp/qigong-author-names-{verify,all-types,profile-integration,cdp}.log`, preview/CDP scripts and12 screenshots. Local test and browser clusters are independent. No production/provider/Console changes, profile-name export or real test messages. Preserve unrelated `docs/operations/web-admin-permissions-review.md` outside later commits.
