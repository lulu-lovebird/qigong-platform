# Receipt progress monitoring deployment —362c4ef / schema37

## Release and approval

The user approved commit, push and deployment after reviewing the local results and unresolved test-clock evidence. Production is **`362c4efad8514ae52a9c7e0106ca6bc0f2932511`**, exact-SHA CI **38990247558** successful: **819 tests** (API625 / database186 / config2 / identity6), formatting, lint, source typecheck and build. Extra all-test TypeScript and standalone strict-JS CLI checks passed both locally and on the Linux release artifact.

This is a **same-schema37** release from `bcd9c60`: `0037_learner_author_names.sql`, `phase-22-learner-author-names`, existing API/minute/realtime gates unchanged. No migration runner, DDL, DB grants, provider Console, preference/binding/consent backfill or dependency/lockfile changes ran. Learner/admin functionality is unchanged; the worker now exposes safe per-lane progress, and the operator-only tool can evaluate health and alert transitions.

**No scheduled monitor or alert delivery was installed/enabled.** No notification recipient, external sink or learner/reviewer subscription was added. The existing realtime receipt service, minute fallback, reminder/reviewer flags and individual choices remain as before. WhatsApp remains unconfigured; privacy policy remains draft.

Controlled maintenance/API pause: **2026-10-17 01:27:15–01:27:36 UTC (21 seconds)**. Paused minute timer, drained/stopped realtime and minute workers, stopped API, took final recovery material, restored/verified it, switched matching code/override, verified readiness, then resumed realtime and minute fallback. New normal traffic was not overwritten with an old snapshot.

## Frozen artifact, preservation and recovery

- Frozen exact-SHA Git archive excludes environment/Apple sidecars/unrelated untracked material. Frozen-lockfile install/build, archive and compiled/migration manifest hashes checked before switching. Manifest also checks the new operator CLI and its runtime TS source. Historical0001–0037 and dependency metadata stay unchanged.
- Separate PostgreSQL16 clone `/var/lib/postgresql/qigong-rehearsal-362c4ef`, Unix socket55480, restored production roles/data. Prior bcd9c60 and candidate both accept exact37; contract validation is SELECT-only and reports zero migrations.
- Fresh final DB dump, roles and API/worker/systemd configuration taken after all writers/workers were quiescent. All three were streamed off-host through authenticated AES-256-GCM encryption with a separately held key, then actually decrypted/hash-verified.
- Decrypted final roles/settings and final DB were actually restored into the guarded clone. Before candidate traffic, exact fingerprints matched for **76 application tables / 18 people / 30 check-ins**, including metadata, verified profile caches, aliases, publications/snapshots/source hashes, permissions, audit and consents. Existing security-definer attributes and forced-RLS/ACL metadata match. No schema/data exception was needed beyond equivalent postgres-owner default ACL representation on restoration.
- Rechecked the same-schema contract and exact production fingerprints before the binary switch. No DB migration or restoration to production occurred.
- Protected API/worker env byte hashes, owner/group and mode640 preserved. Existing API/minute/realtime service units byte-identical; only the API release override SHA and current symlink changed. Current realtime ExecStart has no mock preload. Existing realtime/reminder/reviewer flags all true, individual opt-ins/bindings unchanged.
- A separate post-release runtime/config archive was also encrypted off-host and decrypt/hash-verified.

Same37 rollback: stop/drain realtime and minute worker/timer plus API, switch matching **bcd9c60 API and both workers** with saved release override, retain current env and durable queues, then verify exact37 readiness and resume. **No DB restore and no discarded post-release writes.** A guarded rollback script was prepared for a failed maintenance activation; it was not needed. Do not use a37→36 binary-only downgrade.

## Rehearsal and public checks

Guarded compiled clone regressions passed: scoped admin/grants/Authgear, private notes/source conflicts/external withdrawal, community old-private/manual-withdrawal/idempotency, three-language reports/catalog/tag snapshots, reviewer settings, LINE invitation/friendship/continuation/quota/native handoff, cross-reader verified author names and unchanged staff/partner exports. Includes24 reports,30 learner HTML checks,49 badges and the matching minute worker. All fixture identities/writes/credentials/transports were clone-only, with no real provider test sends.

A transient Linux systemd unit ran the actual new compiled continuous entry as restricted `qigong-notifier` with the normal hardening/resource/stop settings and a guarded clone-only transport mock. Before starting, unrelated pending clone jobs were cancelled only in that clone to isolate the14-job test. After idle, one transaction queued LINE7/TG7; all14 completed at attempt1:

| Mock channel | Count | Minimum | Median | Maximum |
| ------------ | ----: | ------: | -----: | ------: |
| LINE         |     7 |  0.631s | 0.972s |  1.269s |
| Telegram     |     7 |  0.606s | 0.950s |  1.241s |

At the next heartbeat, both lanes had fresh completed/successful polling ages, zero errors/schema mismatch and **zero per-second successful-idle log lines**. SIGTERM produced one clean stopped event. These are **mock queue-to-recorded-delivery measurements, not real provider/phone timing**. The transient unit is inactive/removed; clone env/community/realtime credential fixture files were removed and the clone stopped.

Rehearsal harness corrections were not product changes: the inherited old-version readiness assertion was adapted to require both old/new exact37 binaries ready, and the private synthetic fixture was made group-readable only to its restricted API test identity. Initial public smoke was invoked without its required signing environment and stopped; the authoritative run used the existing protected server env, without exporting credentials. No product permission/content assertion was relaxed.

Public HTTPS smoke passed **195 checks**, including actual SHA/schema/runtime readiness, Origin/auth/signature boundaries, learner pages/locales/invitation/badges and both-provider author notice. It created no production learner, check-in, reflection, invitation redemption, profile refresh, reviewer binding or external client; valid webhook checks used empty events and sent no provider messages. Anonymous OAuth challenge requests are not real admin sessions. Request-URL redaction passed without dumping raw logs.

## Production checkpoint

- API active, restart0/exit0, started **01:27:30 UTC**, exact release SHA and37 ready.
- Realtime service remains enabled/active, restart0/exit0, started **01:27:34 UTC**, normal installed entry/no mock.
- Minute worker completed successfully after the API restart; timer remains active.
- One-shot operator tool executed against the current local service/DB, with its private state/output under the protected deployment directory, **not a scheduled monitor**. Status healthy, both lane success/completion ages842ms, no lane errors/schema mismatch; LINE/TG pending0, sending0, failed0, expired leases0. At that checkpoint there were **zero post-release delivery samples**, so p95 remained null; this is liveness/backlog acceptance, not new real-device latency acceptance. No alert notification was sent.
- Existing env/services/flags were rechecked unchanged; no new scheduled monitoring unit exists.

## Unresolved test clock and acceptance boundaries

The independent local Docker/PostgreSQL test environment previously showed17,054 clock samples with5 cross-transaction negative steps,1 within-transaction negative sample and maximum116.11104ms, plus an intermittent empty-feed test. This release does **not** claim to fix host/VM/NTP/clocksource or establish that production has the same issue. Fixture clarification and safe diagnostic assertions do not weaken production temporal/authorization constraints or erase the failed-run evidence. See [implementation and remaining investigation](receipt-health-and-test-stability.md).

Existing user acceptance of prompt receipts predates this release. No real-provider/device test was fabricated for the new heartbeat/tool. Alert scheduling, destination, maintenance silencing and delivery activation remain separate approval items.

## Evidence

- Server `/root/qigong-deploy-362c4ef`: final backup/restore/fingerprint evidence, manifest/readiness, saved old override, one-shot health output/state, rehearsal journal and deployment/rollback scripts.
- Guarded tools `/opt/qigong-platform/deployment-tools/362c4ef/`; stopped clone socket55480. Production ExecStart does not reference rehearsal tools.
- Restricted off-host ciphertext `~/.local/share/qigong-platform/backups/deployment-362c4ef`, separate key under `backup-keys/`; durable crypto helper remains in deployment-269555c.
- Workstation `/tmp/qigong-receipt-health-release-{prepare,legacy,regression,realtime,activate,public}.log` and scripts directory `/tmp/qigong-receipt-health-release-362c4ef/`. Original test-clock/failure evidence remains documented in the implementation record.

Unrelated `docs/operations/web-admin-permissions-review.md` and all legacy repositories remain untouched.
