# CI type gates and Telegram fixture isolation —0ec97d5 / schema37

## Release

The user approved commit, push and deployment. Production is **`0ec97d50216a6797cb55ccf78520ee89a30496c5`**, exact-SHA CI **38995975957** successful on the first run, including both new named steps:

- `Typecheck all TypeScript source and tests`
- `Strictly typecheck receipt health CLI`

Full CI verify passed **819 tests** (API625 / database186 / config2 / identity6), formatting, lint, source typecheck and build. No manual CI retry, skipped gate or relaxed assertion was used. The earlier local817-pass/2-fail run and local clock evidence remain retained; a passing new commit does not establish that the intermittent clock/history issue is fixed.

Scope: reuse `tsconfig.eslint.json` for all current TypeScript source/tests; add `tsconfig.receipt-health.json` with strict JS/TS-import checking and skipLibCheck=false; keep job name/permissions/Node24/PostgreSQL/frozen-lockfile settings. The Telegram test now owns its timezone reviewer and foreign check-in fixture and projects safe, explicitly **post-response/read-only** diagnostics. It does not alter existing time origins, authorization predicates, deadlines or production SQL. Local isolated negative type checks and separate Telegram cases/4-test-file checks passed before this release.

**No application/runtime behavior changed.** All **240 compiled runtime files** in the new artifact are byte-identical to production362c4ef. The release SHA/current symlink/API version override advance, while source business code, API/minute/realtime schema gates, migrations0001–0037, dependencies and lockfiles remain unchanged.

## Coordinated deployment and actual recovery verification

Same exact37 / `0037_learner_author_names.sql` / phase22. No migration runner, DDL, DB grant, learner/consent/binding/profile/alias/history backfill or provider Console action ran.

Maintenance/API pause **2026-10-17 02:48:36–02:48:56 UTC (20 seconds)**. Paused minute timer, stopped/drained realtime and minute workers, then stopped API. Took fresh DB/roles/runtime backups, streamed off-host AES-256-GCM encryption with a separate key, decrypted/hash-verified all three, and **actually restored the final decrypted roles/settings and DB** into a guarded PostgreSQL16 clone on Unix socket55481.

Before opening traffic, old362c4ef and candidate both accepted37; SELECT-only contract checks applied zero migrations. Exact fingerprints matched for **76 application tables / 18 people / 30 check-ins**, including metadata, caches, publications/source hashes, grants, consents, audit and security/RLS/ACL attributes. Equivalent postgres-owner default ACL representation was canonicalized, without changing privileges. Production DB was not restored or migrated. No old preparation snapshot replaced live writes.

Matching API and both workers switched/resumed after manifest/archive/readiness checks. API/worker env byte-identical, owner/group/mode640 preserved; existing API/minute/realtime units byte-identical. Only release symlink/API version override changed. Existing realtime/reminder/reviewer flags and service enablement remain true; individual subscriptions/bindings unchanged. WhatsApp remains unconfigured and privacy policy draft. A post-release runtime/config archive was also encrypted off-host and decrypt/hash-verified.

## Rehearsal and production checks

- Compiled clone regressions passed: scoped admin/grants/Authgear, private notes/source conflicts/external withdrawal, community old-private/manual control, trilingual tags/reviewer settings/24 reports/30 learner HTML checks/49 badges, LINE invite/friendship/continuation/quota/native handoff, cross-reader verified nicknames and unchanged staff/partner exports, plus matching minute worker. All identities/writes/sends were isolated/synthetic/mocked.
- Linux transient systemd rehearsal used the actual compiled entry, restricted notifier and normal hardening/resources/stop policy, with a guarded clone-only provider mock. Cleaned only pending clone jobs to isolate the14-job test; LINE7/TG7 all delivered at attempt1. Mock queue-to-recorded-delivery median **1.013s/0.999s**, maximum **1.318s/1.303s**. Both heartbeat lanes fresh, errors0, successful-idle log lines0, graceful SIGTERM. These are not real provider/phone timing measurements.
- Public HTTPS smoke passed **195 checks**, exact release/readiness/schema and existing auth/Origin/signature/learner regressions. No production learner, check-in, reflection, profile, invitation redemption, reviewer binding or external client was fabricated. Valid webhook proof used empty events; no real provider test messages were sent. Anonymous OAuth challenge requests are not real admin sessions.
- API active/restart0/exit0, started **02:48:52 UTC**; realtime remains enabled/active/restart0/exit0, started **02:48:54 UTC**. Minute worker succeeded after the new API start, timer active.
- One-shot operator health check: healthy, both lane success/completion ages333ms with no errors/schema mismatch, LINE/TG pending0/sending0/failed0/expiredLease0. Post-release delivery samples0, p95 null: this verifies liveness/backlog, not fresh real-device delivery latency.
- **No scheduled monitor, notification recipient, external sink or alert delivery activation.** One-shot state/output is private under the deployment evidence directory. Production installed ExecStart has no mock preload; transient rehearsal unit and clone credentials were removed, clone stopped.

## Open issues and recovery

The earlier intermittent403/empty-feed and non-monotonic local Docker/PostgreSQL time remain open. The deterministic cross-test dependency was removed, but no original-failure timing snapshot proves a unique cause. New diagnostics are a later administrative read-only observation, not the original request transaction. This release does not modify NTP/clocksource/host time or claim production has the same problem. See [implementation and failed-run evidence](receipt-health-and-test-stability.md).

Same37 rollback: drain/stop API and both workers/timer, switch matching **362c4ef** binaries and saved API override, retain current protected env/durable queues, verify37 readiness and resume. **No DB restore or discarded post-release writes.** Guarded rollback prepared but not triggered. No binary-only37→36 downgrade.

## Evidence

- `/root/qigong-deploy-0ec97d5`: final restore/fingerprint/readiness evidence, protected-env hashes, old override, rehearsal journal, one-shot health and deployment/rollback scripts.
- `/opt/qigong-platform/deployment-tools/0ec97d5/`; stopped clone `/var/lib/postgresql/qigong-rehearsal-0ec97d5`, socket55481. Clone worker.env/community/realtime credential fixtures removed.
- Restricted off-host ciphertext `~/.local/share/qigong-platform/backups/deployment-0ec97d5`, separately protected key under `backup-keys/`; durable crypto helper retained in deployment-269555c tools.
- `/tmp/qigong-ci-type-gates-release-{prepare,regression,realtime,activate,public}.log` and `/tmp/qigong-ci-type-gates-release-0ec97d5/`. Earlier negative-gate, failed whole-run and isolated-test evidence remain separate and are not overwritten by the CI result.

Unrelated `docs/operations/web-admin-permissions-review.md` and legacy repositories remain untouched.
