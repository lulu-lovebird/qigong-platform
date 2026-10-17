# Read-only admin achievements deployment —a9f6f50 / schema38

## Release and explicit maintenance exception

The user first approved commit/push only, then explicitly approved **方案A**: a short coordinated maintenance window, a checkin-site-only ingress fence, final encrypted backup actually restored, matching API/minute/realtime38 activation, and **no37 binary or old-snapshot restoration after writes or worker processing resume**. Other env/flags/time settings and scheduled alert activation were excluded.

Production is **`a9f6f50c6bef40e77353db61cd152c6eccbc3d49`**, exact-SHA CI **39001849304** successful: both strict typecheck steps and full **851 tests** (API649 / database194 / config2 / identity6), formatting/lint/build. No manual CI retry was used. The earlier817/2 failure and local non-monotonic-clock evidence remain open; this release does not establish their root cause is fixed.

This is an explicitly reviewed **exact37→exact38 maintenance exception, not a rolling expand release**. Only new `0038_admin_achievements.sql` applied: four restricted functions and architecture/ledger updates, no new tables or award/rule/season/person/history/job/audit backfill. API exact38 / `phase-23-admin-achievements`; both workers use `ops.admin_achievements_schema_ready()`. Historical0001–0037, dependencies and lockfiles remain unchanged.38 is now deployed and immutable.

## Site-isolated ingress and emergency preparation

Read-only preflight identified `/etc/caddy/Caddyfile`, root-owned mode644, one standalone checkin host block, no imports/env interpolation/relative-file directives. All Caddy port3100 upstream routing belonged to that host. The live JSON matched adapted source.

Prepared normal, full-maintenance and achievement-only-hold variants under the private deployment directory. Only the checkin host route changed; every other adapted route/config component compared equal. Each variant passed Caddy adaptation/validation and a separate admin-disabled, automatic-HTTPS-disabled **loopback-only55487** Caddy probe. These tests did not change production ingress or send provider messages.

The maintenance response was503 with no-store/Retry-After60. The hold variant blocks only `/admin/achievements` and `/admin/api/achievements` including subpaths/capabilities, leaving38 and other app functions/workers intact; the nav hides on the next capability reload. This is **feature isolation, not an old-functionality emergency binary** and does not recall already-viewed content. The hold variant was tested but not activated publicly.

Atomic source replacement preserved owner/group/mode, checked known source hashes and live/adapted JSON, and used graceful Caddy reload. After release, the **entire original Caddyfile is byte-identical again**, with other-site configuration unchanged. The helper refuses to overwrite unrelated later edits or a different live config; do not bypass that check by copying stale saved files.

## Maintenance, interruption and forward-only resume

Full ingress maintenance: **2026-10-17 04:53:41–04:57:20 UTC =219 seconds (3m39s)**. API paused **04:53:42 UTC**. This includes an interruption and its repair, not an uninterrupted20-second switch.

After proving the origin/public fence503, the minute timer and both workers were stopped/drained, then API stopped and active/in-transaction DB activity verified absent. Final backups were taken only after quiescence.

The first production contract attempt halted **before migration** with EACCES: the OS postgres runner could not read root-private deployment markers. The fence stayed closed; a direct ledger check confirmed production still37 and all three services/timer quiescent, with no resume marker. **No file/DB permission was broadened and no automatic downgrade/restore occurred.** Root-only marker/commit-boundary checks remained in the root controller; the postgres migration helper retained its own inactive-service and actual maintenance-config hash checks, receiving only the nonsecret expected hash.

Before resuming, production37 fingerprints were compared again to the final baseline and remained exactly equal; the final migrated clone was rechecked. Production then applied38 **once**, repeat0, with full preservation. Matching symlink/API override switched, new API readiness and unauthenticated readonly routes checked while ingress remained closed and both workers remained stopped. A second exact38 fingerprint comparison proved the private readiness phase did not write application data.

The **resume-boundary marker was written at04:56:44 UTC before starting either worker**. API started **04:56:42**, realtime **04:56:44 UTC**. Normal minute processing and first realtime heartbeat/one-shot health passed before opening ingress. From that marker onward, even without new HTTP traffic, queue processing/external delivery may have occurred: **no old DB snapshot or37 binary may be restored**. No such restoration was performed.

## Final backup and actual restoration

- Frozen exact Git archive, frozen-lockfile Linux build and manifest/archive/migration/compiled hashes rechecked before switching. Unrelated untracked review files, env and Apple sidecars excluded.
- Final DB dump, roles and runtime/systemd/ingress configuration streamed off-host via authenticated AES-256-GCM with a separately protected key; all decrypted/hash-verified.
- Final decrypted runtime archive actually extracted into a private isolated directory, env byte/mode checks passed, and both saved normal/active-maintenance Caddy hashes validated. Nothing was extracted over live configuration.
- Final decrypted roles/settings and DB actually restored into guarded PostgreSQL16 clone socket55486. Old0ec37 readiness passed; candidate38 correctly rejected37. Clone38 apply/repeat and preservation passed before formal migration.
- **76 existing application tables / 19 people / 35 check-ins**, stored awards/versions, definitions, seasons, profiles, publications/source hashes, grants, consent, jobs and audit retained fingerprints. Only architecture version/time and migration ledger/new functions changed. Old table RLS/ACL and function-security attributes remained equal; only equivalent postgres-owner default ACL formatting was canonicalized on restoration.
- A separate post-release runtime/normal-ingress/emergency-tool archive was also encrypted off-host and decrypt/hash-verified.

The preparation snapshot had33 check-ins; **it was not substituted for the fresh35-check-in final snapshot**. No production DB restore, old-data overwrite, migration/backfill or manual historical badge recalculation was invoked. Only existing normal worker processing resumed; it may legitimately reconcile pending badges after the boundary, distinct from migration/read-side changes.

## Rehearsal and verification

Compiled restricted clone regressions passed scoped admin/grants/Authgear, private/source-conflict/external withdrawal, community legacy/manual protections, three-language labels/tags/reviewer settings,24 reports/30 learner HTML checks/49 badges, LINE invite/friendship/continuation/quota/native handoff and both-provider author names with original staff/partner exports, plus the matching minute worker. All transports were mocked.

New achievement clone checks used only synthetic scoped country/regional/content principals and learners: six role×locale cases,49 badges, identical scoped distinct counts/people, literal markup/emoji names, year periods/pagination, forged-region rejection and insufficient-role denial. Full award/job/audit row fingerprints were unchanged by reads. Production post-check confirmed **PUBLIC execute0, raw API badge SELECT false,38 gate true/37 gate false**. One synthetic fixture initially tried creating a second global root and hit23505; it was corrected to reuse the existing root and create a fresh synthetic country. That was clone setup, not a product migration change; assertions/permissions were not relaxed.

Actual Linux hardened realtime entry:14 clean synthetic LINE/TG jobs all attempt1; mock queue-to-recorded-delivery median **1.219s/1.200s**, maxima **1.515s/1.497s**, fresh per-lane heartbeat/error0, successful-idle log0, graceful SIGTERM. These are not real provider/phone measurements. Only unrelated pending clone jobs were cancelled to isolate the test. No real provider test message or production synthetic learner/reflection/award was created.

Public HTTPS smoke passed **201 checks**, updated from the old achievement404 expectation to guest HTML302/API401, with no new write action. Existing Origin/auth/signature/locale regressions passed. Valid webhook probes used empty events; anonymous OAuth challenges are not real admin sessions. A synthetic unauthorized achievement-query probe verified actual req.url redaction without printing raw logs, query markers or credentials.

At the pre-open checkpoint: health healthy, LINE/TG pending0/sending0/failed0/expired leases0, **delivery samples0 and p95 null**. This proves process/queue readiness, not new phone delivery latency. API/realtime active/restart0/exit0, realtime still enabled, minute worker success/exit0 after activation and timer active.

API/worker env byte-identical and mode640, existing service units byte-identical, normal production realtime entry has no mock preload. Existing realtime/reminder/reviewer flags and individual choices preserved. WhatsApp still unconfigured, privacy policy draft, **no scheduled alert monitor/sink/recipient activation**, no NTP/clocksource changes. Local12-layout/24-screenshot synthetic browser evidence predates deployment; real admin/IdP/device acceptance is still separate.

## Recovery boundary and evidence

**No binary-only38→37 rollback, no ledger rewriting and no post-resume old-snapshot restore.** For an achievement-only fault, the validated hold variant can isolate that feature while retaining38; for a wider fault, retain full checkin maintenance and fix forward with a reviewed38 build. Recheck current ingress hashes before any operation, preserve all current writes/queues/consents/audit and never invoke an older same37 rollback script on38.

- Server `/root/qigong-deploy-a9f6f50`: original/maintenance/hold ingress source+JSON/hash metadata, final backup/restoration/preservation evidence, original failed activation and guarded resume scripts/logs, saved old override, resume marker, preopen health and rehearsal journal.
- Guarded tools `/opt/qigong-platform/deployment-tools/a9f6f50/`; stopped PostgreSQL clone `/var/lib/postgresql/qigong-rehearsal-a9f6f50`, Unix socket55486. Clone worker/community/realtime/achievement credential fixtures removed. No persistent probe/rehearsal unit remains.
- Off-host ciphertext `~/.local/share/qigong-platform/backups/deployment-a9f6f50`, key separately under `backup-keys/`; durable crypto helper retained in deployment-269555c. Runtime archives include saved ingress variants/original and guard metadata, not public source files.
- Workstation `/tmp/qigong-admin-achievements-release-{prepare,regression,realtime,activate,resume,public}.log` and `/tmp/qigong-admin-achievements-release-a9f6f50/`; original local failed runs and clock evidence retained separately.

Unrelated permissions-review and legacy repositories remain untouched. Real-user acceptance should verify the scoped readonly page without changing rules or forcing award recalculation.
