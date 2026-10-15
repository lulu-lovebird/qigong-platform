# Compact Web Admin deployment — a952176 / same schema36

## Release

The user separately authorized commit, push and deployment. Production code: **`a95217611373dd26814ab04b1f08dfdc69685e6f`**, exact-SHA CI **38823188338** successful. Full local verification passed **738 tests** (API547 / database183 / config2 / identity6), formatting, lint, source typecheck and build.

This is an **admin UI-only, same-schema36** release from `2f5a4eb`. API/worker compatibility remains exact `0036_feeling_tag_simplified_labels.sql`, architecture `phase-21-feeling-tag-locales`, worker gate `ops.feeling_tag_locales_schema_ready()`. Both old and new API readiness passed on the same restored36 database. The deployment contract performs SELECT checks only; **no migration applier, DDL or data backfill ran**.

Maintenance: **2026-10-15 23:28:41–23:29:00 UTC (19 seconds)**. Worker timer paused and worker drained, API stopped and active/in-transaction writers checked before the final backup. Matching API/worker target and systemd release override were switched together.

## What changed

- Compact shared admin density,34px desktop rows/controls, smaller card/table spacing and sensible field widths.
- Four three-language menu groups: reports/analysis, learner management, reflections/tags, system/preferences. Original link authorization and routes retained; empty capability-dependent groups remain hidden.
- Native collapsible phone navigation and readable current-page label; desktop sidebar scrolls independently in short windows. Phone/coarse-pointer controls retain44px targets and16px inputs, including wide touch tablets.
- Draft/navigation/language/logout safeguards, focus labels, destructive-action separation and policy reading typography retained. Learner pages, legal documents, API authority and notification configuration did not change.

## Frozen artifact, backup and actual restore

- Exact Git archive excludes environment files, Apple sidecars and unrelated untracked material. Frozen-lockfile install/build and manifest checksum all migrations, package metadata and compiled outputs; manifest/archive rechecked before activation.
- Preparation restored an actual production36 dump and roles into a separate guarded PostgreSQL16 cluster. Old2f5a4eb and candidate API both ready; repeat contract checks applied zero migrations and left exact data/metadata fingerprints unchanged.
- Final maintenance took a **fresh** DB dump, roles and runtime/systemd configuration. All three were streamed through authenticated AES-256-GCM encryption to restricted off-host storage with a separate key; decrypt/hash checks passed.
- Actually reapplied restored role settings and restored the **final decrypted DB** into the clone. Exact fingerprints and prior API readiness passed again before activation. Candidate contract/readiness and final production comparison passed, still with zero migrations.
- All **75 application tables / 17 people / 26 check-ins**, including all metadata, saved translations, publication/selection snapshots, permissions, audit and consent records, retained their complete fingerprints. Derived `journal_source` hashes for all existing check-ins matched. No old-column normalization exemptions were used in the exact data comparison.
- Table/function security metadata retained. The known equivalent postgres-owner default ACL NULL representation after `pg_restore` is canonicalized, not treated as a permission grant/removal. Protected environment files remain byte-identical and mode640.

## Verification and service status

Authenticated scenarios ran only in the guarded clone, with synthetic identities and disabled/mocked external transports:

- Scoped admin reports/grant management, protected/self accounts, verified Authgear metadata without privilege changes, private notes, sourceHash conflict and external withdrawal/revocation.
- Actual compact tag-editor HTML in three languages, group/density/disclosure markers and real API saves. Optional/literal Simplified labels, cancelled drafts, omitted legacy fields, explicit clearing, historical/sourceHash/publication preservation and LINE cursor output passed.
- Three-language reviewer HTML/preferences; LINE invitation/friendship/subject-bound continuation, pending confirmation, quota exactly2 and native/manual chat fallback; disclosed LINE/TG notes and manual withdrawal controls;24 reports/30 learner HTML checks/49 badges.
- Matching compiled worker passed with6 mocked outbound transports, **zero real provider sends by tests**. Operational flags are preserved, not bulk subscription/binding commands.

Pre-release browser evidence: **126 layouts** using the actual compiled app/restricted API and an independent synthetic PostgreSQL16 database:13 pages ×3 locales ×390/820/1280,3 wide-touch views and6 edge cases. Loaded logo, group order, keyboard disclosure/focus, draft cancellation,320px phones,540px sidebar scroll, coarse-pointer tablets, resizing and no overflow/runtime/API failure were verified. OIDC/provider identity was mocked; this is not live Authgear or real-device acceptance.

Public smoke: **189 HTTPS checks** passed, including exact version/ready, protected admin routes, three-language learner regressions, signatures/Origin/schema guards and public logo. No production admin session, application, translation, journal record or external client was created by the smoke. Synthetic SDK-query probe confirms request URL redaction without printing raw logs.

Post-release: API active / `NRestarts=0` / exit0; timer active; matching worker successful / exit0 at **23:29:14 UTC**, after maintenance. Telegram reminders and reviewer operational flags remain true, WhatsApp unconfigured and privacy policy draft. Clone worker env/synthetic credential fixture removed and rehearsal stopped. Unrelated permissions-review file excluded; no legacy-repository or Console change.

## Recovery and evidence

- Server: `/root/qigong-deploy-a952176`, including final restore/fingerprint evidence, prior systemd release override and preparation/activation scripts.
- Guarded tools: `/opt/qigong-platform/deployment-tools/a952176/`; stopped clone `/var/lib/postgresql/qigong-rehearsal-a952176`, Unix socket port55446.
- Restricted off-host ciphertext: `~/.local/share/qigong-platform/backups/deployment-a952176`; key separately under `backup-keys/`. Durable crypto helper remains in deployment-269555c backup tools.
- Workstation: `/tmp/qigong-admin-compact-release-{prepare,smoke,activate,public,ci}.log`;48 local screenshots and measurement/browser evidence in [implementation](admin-compact-ui.md).

**Same-schema rollback:** after review, drain worker/stop API, restore matching prior2f5a4eb API/worker symlink and saved release override, reload/start services and verify exact36 readiness/protected settings. **Do not restore an older DB/env snapshot or overwrite post-release writes for this UI rollback.** Database corruption recovery or any downgrade is a different, separately reviewed operation.

Extra all-test TypeScript still has the10 pre-existing errors; previous timestamp intermittency is not claimed fixed. New compact layout remains pending ordinary real-user acceptance after reloading the admin page.
