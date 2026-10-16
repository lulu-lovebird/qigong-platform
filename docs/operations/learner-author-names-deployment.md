# Learner author nicknames deployment — bcd9c60 / schema37

## Release and coordination

The user separately approved commit, push and deployment. Production code is **`bcd9c60da56085ef1979b4a29db52cc46ff40851`**, exact-SHA CI **38915728260** successful. Full verification: **790 tests** (API598 / database184 / config2 / identity6), formatting, lint, source typecheck and build passed. Extra all-test TypeScript still has10 pre-existing errors; earlier timestamp intermittency is not claimed fixed.

Release moved from6a2ae3f/36 to matching exact37 / `phase-22-learner-author-names`. **API, minute worker and continuous receipt runtime** now use the matching37 contract/gate `ops.learner_author_names_schema_ready()`.

Maintenance: **2026-10-16 14:35:59–14:36:21 UTC (22 seconds)**. The minute timer was paused, continuous receipt service stopped/drained and the minute worker drained before API stop/final backup. No36 receipt process was allowed to continue polling through the schema change. API/new receipt runtime and minute timer resumed together after readiness.

## Artifact, final backup and actual restoration

- Frozen exact Git archive excludes environment/Apple sidecars/unrelated untracked material; frozen-lockfile install/build and manifest checksums, including the receipt service template. Archive/compiled/migration hashes rechecked before switch. Dependency metadata and deployed0001–0036 unchanged;37 is now deployed and immutable.
- Separate PostgreSQL16 cluster restored actual production roles/data. Old6a2ae3f API ready on36,37 apply1/repeat0 and full preservation passed before production schema changes.
- Final maintenance captured a **fresh** DB dump, roles, API/worker env, API override, minute service/timer and continuous service/enabling configuration. All three archives were streamed through authenticated AES-256-GCM off-host encryption with a separately held key and decrypted/hash-verified.
- Actually restored final decrypted roles/settings and DB into the guarded clone; exact36 fingerprints and old binary readiness passed. Applied37 to the **final restored snapshot** and rechecked preservation before production migration.
- Production apply1/repeat0. All **75 old application tables / 18 people / 30 check-ins**, existing LINE cache, aliases, translations, publications/selections, source hashes, permissions, audit and consents retained their fingerprints. Only architecture metadata/time changed. All existing function security metadata remained identical;4 new functions and one new empty forced-RLS table were added.
- Before reopening traffic the Telegram cache was empty: no registration-name/profile backfill or account linking. Post-check confirmed four new functions with **zero PUBLIC execute grants**, private-helper/raw-cache access restricted, and new gate true / old36 gate false.

Both protected env files remained byte-identical and mode640. Existing realtime receipt/reminder/reviewer flags all remain true; individual opt-ins/bindings unchanged, WhatsApp unconfigured and privacy policy draft. No service-unit/credential/Console change was required.

## Verified behavior

Only learner-facing wrappers overlay author names: LINE posts use the verified LINE nickname; TG posts use a server-verified Telegram nickname, otherwise retain the existing safe alias. Staff/partner/general source aliases and publication data remain original. Names do not identify, link or authorize accounts. Reader/author eligibility and applicable privacy remain checked.

Guarded compiled-API clone tests passed:

- Both learner channels ×3 locales show the same author's own platform nickname, including literal Traditional/emoji/markup test values without UI conversion or HTML interpretation.
- TG native HMAC and private signed webhook metadata, old webhook not overriding newer native proof, invalid secret rejection, and unchanged original editor alias/publication version/sourceHash.
- Real staff and partner HTTP exports retain original aliases, not platform names. Synthetic partner credential was explicitly revoked after testing. All identities/data/credentials were clone-only; no personal names were output in deployment logs.
- Existing scoped admin/grant/Authgear/private/sourceHash/external withdrawal, invitation/friendship/resume/quota/native/manual, community legacy-private/manual-withdrawal, three-language tag/reviewer saves,24 reports/30 learner HTML checks/49 badges and matching minute worker regression passed.

The continuous receipt entry also ran under real Linux systemd hardening against37 with guarded mock transports. After idle, one committed transaction queued LINE7/TG7; all14 completed at attempt1. Mock queue-to-recorded-delivery median1.069s/1.044s, maximum1.373s/1.343s. Clean SIGTERM exit0/restart0, no schema error, failure signal or private-content log. Regression-clone pending jobs were explicitly cancelled only in that clone before this isolated14-job test; no production job was changed. The temporary rehearsal unit was removed.

Pre-release compiled/restricted synthetic browser acceptance: **12 layouts**, LINE/TG ×3 locales ×390/1280, both verified names, missing-cache fallback, literal markup, unchanged own-sharing alias and cross-provider notice; no overflow/runtime/API failure. Provider identity was mocked and native HMAC actually verified. This is not real provider/user acceptance.

Public HTTPS smoke passed **195 checks**, including exact37/SHA, auth/Origin/signature boundaries, existing learner regressions and both-provider author notice in both channels/all three locales. No production session/application/invitation/check-in/profile or external-client record was fabricated by the smoke. Synthetic request-URL redaction probe passed without printing raw logs.

## Post-release checkpoint and acceptance

API active/restart0/exit0. Continuous service remains enabled/active/restart0, started **14:36:19 UTC**, three initial heartbeats and no schema/database/batch failure signals. Minute timer active and matching worker succeeded/exit0 at **14:37:24 UTC**, after maintenance.

Read-only aggregate checkpoint (no names exported):2 active LINE posts both have the learner nickname overlay;4 TG posts remain on their original aliases because the new TG cache still has0 rows. **Each existing Telegram author must next open their native Mini App or privately interact with the Bot to capture their own verified nickname.** Opening another person's feed does not retrieve all other authors' profiles, scan getChat, copy enrollment names or infer LINE identity links. Then subsequent learner reads use the cached name for that author's existing posts without rewriting those posts.

The user previously accepted realtime receipt delivery. The new nickname behavior still needs ordinary user/device acceptance after reloading/reopening the journal; this deployment does not claim that acceptance yet.

## Recovery and evidence

- `/root/qigong-deploy-bcd9c60`: final backup/restore/preservation evidence and saved prior API override; preparation/activation scripts retained.
- `/opt/qigong-platform/deployment-tools/bcd9c60/`: guarded ops and regression/author/realtime/public smokes. The realtime mock asserts clone socket/port and is not in the installed production ExecStart.
- Stopped clone `/var/lib/postgresql/qigong-rehearsal-bcd9c60`, Unix socket port55449. Clone worker env and community/realtime credential fixture files removed; temporary rehearsal service removed.
- Restricted off-host ciphertext `~/.local/share/qigong-platform/backups/deployment-bcd9c60`, separate key under `backup-keys/`; durable crypto helper retained in deployment-269555c tools.
- `/tmp/qigong-author-names-release-{prepare,regression,realtime-rehearsal,activate,public}.log`, author smoke result and local12-screen evidence in [implementation](learner-author-names.md).

**No binary-only37→36 rollback.** Stop/drain API and both workers, use matching DB/API/minute/realtime artifacts and obtain review of post-traffic profile/cache/queue/check-in/consent reconciliation. Never overwrite new writes with the older preparation/final pre-release snapshot. Existing operational flags and realtime service enablement must survive the reviewed recovery. Unrelated permissions-review file and legacy repositories remain untouched.
