# Schema Compatibility Release Contract

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

Production is **a9f6f50 / exact38**, after exact-SHA CI39001849304 succeeded. The user explicitly approved a **方案A coordinated-maintenance exception**, not a rolling expand-compatible release:37 binaries reject38. A checkin-only Caddy fence closed ingress, API **and both workers** were drained/stopped, final encrypted DB/roles/runtime were actually restored and clone38 preservation passed before formal migration. Private readiness and exact data checks preceded the resume-boundary marker; workers then resumed and ingress reopened. A deployment-helper EACCES halted before formal migration, was repaired without privilege broadening, and37 data was reverified unchanged before forward resume. Maintenance219seconds and all evidence are in the [deployment record](../operations/admin-achievements-deployment.md).

**After the resume boundary, retain38: no37 binary and no old-snapshot DB restore.** Use the validated achievement-only ingress hold, or full checkin maintenance for a broader fault, and fix forward with a reviewed38 build while preserving all new writes/queues/consents/audit. There is no assumed38-compatible old-functionality emergency binary. The ingress helper refuses unrelated later config drift; do not overwrite other sites with saved stale config. This case-specific exception does not waive the default expand contract for future rolling releases. All0001–0038 artifacts are now immutable. See [design/security](../operations/admin-achievements.md).

## Required Controls

- CI tests the old and new application compatibility ranges against the same expand schema.
- Readiness fails outside the declared range.
- Migration artifacts contain every applied migration; missing historical files fail closed.
- Historical migration files are immutable and checksum-verified.
- Deployment records store application version, compatibility range, and migration version.
