# Schema Compatibility Release Contract

Current production is **71b2a8b / exact39**. Retain39 and all new writes; this UI release can only binary-roll back to its verified same39 afd90b5 matching artifacts, without DB/env snapshot restore. Earlier sections preserve historical boundaries, not permission to downgrade the current schema. See [same39 UI deployment evidence](../operations/collapsible-navigation-deployment.md).

Every deployable application version declares:

```text
minimum compatible migration
maximum compatible migration
```

The pre-production `0001` to `0002` transition is exempt because no application instance serves production traffic. The expand release sequence is mandatory after the first production deployment.

## Expand Release

1. Release application `A` whose maximum range includes the planned expand migration.
2. Confirm all running `A` instances are ready.
3. Apply the expand migration. It may add nullable columns, tables, indexes, or backward-compatible behavior only.
4. Verify old `A` and new application `B` are both ready on the expanded schema.
5. Start `B`, run smoke tests, then switch traffic.

## Backfill Release

Backfills are resumable and do not remove compatibility with `A` or `B`. Read paths remain tolerant until validation is complete.

## Contract Release

1. Confirm all old `A` instances are drained and cannot restart.
2. Close the rollback window explicitly.
3. Deploy application `C` whose minimum version requires the completed backfill.
4. Apply contract migrations only after `C` is healthy and no rollback to `A` is permitted.

## Three-language exact-version release

The initial three-language release `2ec42e2` declared exact `0035_simplified_chinese_locale.sql` and worker `ops.locale_schema_ready()` / `phase-20-simplified-chinese`. The previous34 build rejects35; it must not be described as an expand-compatible rolling release or run against35 after migration.

The user separately approved commit/push/deployment with coordinated maintenance/drain and matching API/worker. Final encrypted backups were actually restored, old34 readiness checked, final-clone35 preservation verified and only then production migrated. See [release evidence](../operations/trilingual-locales-deployment.md). Future rolling releases still need the expand-compatible A release described above; local implementation approval is not deployment approval. A35→34 downgrade requires matching database/API/worker plus approved reconciliation of all post-release writes, including newly selected locales that34 cannot represent; binary-only rollback or silent language substitution is unsafe. See [implementation boundaries](../operations/trilingual-locales.md).

## Quick-tag translation exact-version release

Quick-tag release `2f5a4eb` requires exact `0036_feeling_tag_simplified_labels.sql`, `ops.feeling_tag_locales_schema_ready()` / `phase-21-feeling-tag-locales`. The user separately authorized commit/push/deploy; final35 backups were actually restored and36 validated before production migration. See [deployment evidence](../operations/feeling-tag-locales-deployment.md). Local implementation approval alone is not publishing approval. Nullable catalog/selection translation columns preserve existing rows, source hashes and publication snapshots; omitted legacy inputs preserve existing translations. The35 binary rejects36; this release used explicitly approved coordinated maintenance and final actual-restore/preservation checks, not an unreviewed rolling upgrade. Any downgrade needs matching database/API/worker and post-release reconciliation without silently discarding translations. See [implementation and verification](../operations/feeling-tag-locales.md).

## Compact UI same-schema release

Compact UI release `a952176` retains exact36 / `ops.feeling_tag_locales_schema_ready()` / phase21. No migration applier or DDL ran. Both old2f5a4eb and new API readiness passed on the final restored36 snapshot; all data and metadata fingerprints were identical before switching. The user separately approved publication. See [deployment evidence](../operations/admin-compact-ui-deployment.md). A reviewed same-schema rollback switches matching API/worker and the saved systemd release override only; it must not restore an older DB/env or overwrite post-release writes.

## Continuous receipt service same-schema release

Initial continuous receipt release `6a2ae3f` retains exact36/phase21 with a separately approved continuous receipt service and `PRACTICE_RECEIPTS_REALTIME_ENABLED=true`. No migration or table privilege change ran; final actual restoration preserved every data/metadata/source fingerprint before activation. The one-minute worker remains fallback. See [activation/recovery evidence](../operations/realtime-practice-receipts-deployment.md). Before rollback to a binary without the new entry, stop/disable the continuous service and review only the new flag while preserving other env changes, in-flight leases, queue and current database writes.

## Learner-author-name exact37 release

Production `bcd9c60` adds only new `0037_learner_author_names.sql`: an empty forced-RLS verified Telegram display cache and learner-only feed decorators, without rewriting registration, publication, source hashes or identity links. API is exact37 / `phase-22-learner-author-names`; both minute worker and realtime receipt runtime use `ops.learner_author_names_schema_ready()`. The user separately approved publishing. API **and both workers** were stopped/drained; final encrypted backups were actually restored and all old data/source/function-security fingerprints checked before coordinated37 activation. Realtime enablement and all flags remain unchanged. See [deployment evidence](../operations/learner-author-names-deployment.md). A37→36 rollback needs matching DB/API/both-worker artifacts and approved post-traffic/cache/queue reconciliation, not binary-only rollback. See [local design and verification](../operations/learner-author-names.md).

## Administrator achievements exact38 maintenance release

The published read-only achievement release `a9f6f50` adds `0038_admin_achievements.sql`, exact38 / `phase-23-admin-achievements`, with API min/max38 and matching minute/realtime gates `ops.admin_achievements_schema_ready()`. It adds four restricted functions, no tables or raw API table grants, and changes only architecture metadata/ledger, not stored awards, definitions, seasons, personal history, jobs or audit. The37→38 preservation test verifies all existing table/source/security fingerprints, excluding only the intended metadata version/time.

At the schema38 release checkpoint, production was **a9f6f50 / exact38**, after exact-SHA CI39001849304 succeeded. The user explicitly approved a **方案A coordinated-maintenance exception**, not a rolling expand-compatible release:37 binaries reject38. A checkin-only Caddy fence closed ingress, API **and both workers** were drained/stopped, final encrypted DB/roles/runtime were actually restored and clone38 preservation passed before formal migration. Private readiness and exact data checks preceded the resume-boundary marker; workers then resumed and ingress reopened. A deployment-helper EACCES halted before formal migration, was repaired without privilege broadening, and37 data was reverified unchanged before forward resume. Maintenance219seconds and all evidence are in the [deployment record](../operations/admin-achievements-deployment.md).

**After the resume boundary, retain38: no37 binary and no old-snapshot DB restore.** Use the validated achievement-only ingress hold, or full checkin maintenance for a broader fault, and fix forward with a reviewed38 build while preserving all new writes/queues/consents/audit. There is no assumed38-compatible old-functionality emergency binary. The ingress helper refuses unrelated later config drift; do not overwrite other sites with saved stale config. This case-specific exception does not waive the default expand contract for future rolling releases. All0001–0038 artifacts are now immutable. See [design/security](../operations/admin-achievements.md).

## Personal achievement export exact39 coordinated-maintenance release

The locally authorized personal CSV export adds `0039_achievement_personal_export.sql`, one empty forced-RLS cooldown table, six restricted functions, and `achievement.export_personal` for `super_admin`/`master_admin` only. Existing0001–0038 remain unchanged; the38→39 preservation test excludes only the intended architecture version/time and exact added permission/mappings, with new-table security checked separately. Historical37→38 tests stay pinned to38.

The candidate declares API min/max39 and matching minute/realtime `ops.achievement_export_schema_ready()` / `phase-24-achievement-personal-export`. **At the original CSV39 release checkpoint, production was afd90b57febd03e05a7c59d0c5e1b81ac6c25bc6/exact39 after exact-SHA CI39123945084 (891 tests).** Coordinated maintenance on2026-10-18 12:07:44–12:08:47 UTC lasted63.232monotonic seconds; final encrypted roles/DB/runtime were actually restored, all old data/source/security fingerprints preserved, matching API/both workers verified, then normal ingress restored. See [actual deployment evidence](../operations/achievement-personal-export-deployment.md). On2026-10-18 the user separately and explicitly authorized this candidate’s commit/push, exact-SHA CI, rehearsal and coordinated-maintenance exception, including ingress fencing, API/both-worker stop, final encrypted backups and actual restore/preservation verification before migration. The38 binary rejects39, and the candidate rejects38. This is not an expand-compatible rolling release; the previous38 exception was not automatically reused. Do not run the migration online under38 services. Authorization does not include formal personal-data exports, unrelated role grants or operational flag changes.

At that original39 checkpoint, resumed traffic/workers required retaining39 and fixing forward while preserving all new writes, queues, audit and export cooldowns; do not binary-downgrade to38 or restore an old snapshot over new writes. No39-compatible old-functionality emergency build currently exists. See [local personal-export design and verification](../operations/achievement-personal-export.md). Formal personal-data export, legal publication and operational activation are separate decisions.

## Collapsible navigation and method UI same39 release

Release `71b2a8b52b563f3ec28ece56cc68e04318280a59` keeps exact39/phase24 and both worker gates unchanged. The user separately approved commit/push/deploy; exact-SHA CI39184093510 passed911tests. No migration applier or DDL ran. Final encrypted DB/roles/runtime were actually restored to isolated PG16; both old afd90b5 and new API were39-ready, and all77 tables/metadata/source/security/role fingerprints were exact before switching matching API/both workers. Maintenance2026-10-19 01:24:43–01:25:48 UTC lasted65.163monotonic seconds;215public HTTPS checks passed. Only three frontend JS files and their source maps changed among255compiled artifacts;249were byte-identical, including backend/worker code.

This same39 UI rollback was available only while the DB remained39; the current published40 section below supersedes it and forbids39 binaries. At that earlier checkpoint, a controlled UI rollback could switch matching same39 afd90b5 artifacts and saved release override only after stop/drain and readiness checks, while preserving current DB/env and every new queue/audit/write. It must not restore a DB snapshot or use38 binaries. See [actual restore, preservation and acceptance evidence](../operations/collapsible-navigation-deployment.md).

## Activity/achievement draft workspace exact40 published release

The authorized and deployed first phase adds only `0040_achievement_management_drafts.sql`: two empty forced-RLS private metadata tables, restricted configuration/aggregate-preview facades, one new permission/two role mappings, and phase25. Existing0001–0039 were unchanged; now0001–0040 are deployed and immutable. It does not update live definitions, seasons, awards, checkins, jobs, privacy or identity data, and has no publication/activation/recalculation endpoint. Both global master/super manage drafts; both are intended publishers only in a separately reviewed phase2.

Published8a46c07c9dfecaec7b86a3dcbdcf1e526e66926e API min/max40 and both workers use `ops.achievement_management_schema_ready()` / `phase-25-achievement-management-drafts`. **The user separately authorized this feature’s commit/push/deploy and explicitly approved this39→40 coordinated-maintenance exception, completed after exact-SHA CI39229829965 first-pass999tests and rehearsal.** Previous39 rejects40 and published40 rejects39. Maintenance2026-10-19 09:41:20–09:42:21 UTC lasted61.307monotonic seconds: the checkin-only fence was closed and API/both workers stopped/drained; final encrypted DB/roles/runtime backups were actually restored to fresh PG16 with77old-table/19people/51checkin preservation before applying40 and switching matching artifacts. Production applied1/repeat0;79tables were exact before/after private API startup, resume marker09:41:45 preceded workers, then normal ingress returned.229Node HTTPS and receipt health passed, protected env/flags/units and full normal Caddy bytes matched, post-runtime backup was encrypted offhost and actually extracted/verified. See [release/actual restore/recovery evidence](../operations/achievement-management-deployment.md). This is not rolling expand and does not reuse the CSV39 exception; do not migrate under running39 services. After resuming writes/workers retain40 and fix forward, without39 binary downgrade or old-snapshot restore. Publication/awarding/recalculation and unrelated operational flags remain disabled/unchanged. The39→40 upgrade test preserves all77 old tables/source/security/function definitions except the intended permission/mapping and metadata version/time additions; the historical38→39 test remains pinned to39.

The first phase cannot apply draft rules; future publication requires immutable effective versions, preserved historical readers/CSV, progress-from-effective-date and every evaluator enforcing the global latest makeup cutoff UTC plus exactly24hours. See [phase1 scope and evidence](../operations/achievement-management-drafts.md).

## Required Controls

- CI tests the old and new application compatibility ranges against the same expand schema.
- Readiness fails outside the declared range.
- Migration artifacts contain every applied migration; missing historical files fail closed.
- Historical migration files are immutable and checksum-verified.
- Deployment records store application version, compatibility range, and migration version.
