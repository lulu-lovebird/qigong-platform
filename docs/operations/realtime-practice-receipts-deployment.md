# Near-real-time practice receipt deployment —6a2ae3f / schema36

## Approval and release

The user authorized commit, push, deployment **and activation of the dedicated service** after the implementation report explicitly asked about enabling it. Production code is **`6a2ae3fc526ee67feed33f1a9f0d52c22b0bf61b`**, exact-SHA CI **38836351039** successful. Full verification: **766 tests** (API575 / database183 / config2 / identity6), formatting, lint, source typecheck and build passed.

This is a same-schema36 release from `a952176`: exact `0036_feeling_tag_simplified_labels.sql`, `phase-21-feeling-tag-locales`, existing restricted receipt claims/leases and schema gate. Historical0001–0036, dependencies, API save transactions, old notification-worker code and one-minute timer are unchanged. No migration applier, DDL, consent, binding or preference backfill ran.

Maintenance: **2026-10-16 01:52:10–01:52:32 UTC (22 seconds)**. The old worker timer was paused and worker drained before API stop/final backup. It was resumed after API readiness **before** new-service activation, preserving fallback if activation failed.

## Frozen artifact and actual recovery rehearsal

- Frozen exact-SHA archive excludes environment files, Apple sidecars and unrelated permissions-review material. Frozen-lockfile installation/build, checksummed migrations/compiled packages and the new service template; manifest and archive rechecked before switching.
- Separate PostgreSQL16 clone restored actual production36 roles/data, prior API ready and candidate same36 contract/readiness passed. Contract validation is SELECT-only and applies zero migrations.
- Final maintenance took a fresh DB dump, roles and runtime/systemd configuration. All three were streamed through authenticated AES-256-GCM encryption to restricted off-host storage, with a separately protected key; decrypted/hash-verified, restored role settings and **actually restored the final decrypted DB** into the clone.
- Old/new API readiness and complete fingerprints matched again before production switching: **75 application tables / 18 people / 27 check-ins**, all metadata, tag translations, source/publication/selection snapshots, grants, audit and consent retained. Derived source hashes for every existing check-in matched. Equivalent postgres-owner default ACL NULL normalization on restore is canonicalized, without permission change.
- API/old-worker target and version override moved to the matching immutable release. Before the new dispatcher started, the final production comparison was exact. Subsequent legitimate receipt state changes are normal dispatch, not a migration/backfill.

## Actual Linux systemd rehearsal

The new unit passed `systemd-analyze verify`. A temporary rehearsal unit used the **same** restricted notifier identity, CPU/memory/task hardening, compiled continuous entry and graceful shutdown, but explicit clone DB/activation env and a guarded outbound mock preload. It could not send real provider messages.

After the daemon was already idle, a single transaction inserted7 synthetic LINE and7 Telegram receipts. All14 were delivered with one attempt; mock-provider enqueue-to-recorded-delivery seconds:

| Channel  | Count | Minimum | Median | Maximum |
| -------- | ----: | ------: | -----: | ------: |
| LINE     |     7 |   0.716 |  1.091 |   1.383 |
| Telegram |     7 |   0.672 |  1.065 |   1.358 |

SIGTERM stopped cleanly: exit0, restart0, all14 mock acceptances and no private-payload/error/schema-mismatch logs. These figures are **not live provider or phone delivery benchmarks**.

The first rehearsal also drained13 pre-existing jobs left by other clone regressions, so a test incorrectly expecting only14 total transport calls saw27. All14 target rows still had one attempt. The verification was rerun with a clean fixture queue/invocation-scoped journal and the strict14-call assertion passed; no production data or delivery assertion was weakened. The temporary unit was stopped and removed.

Existing compiled clone workflows also passed: admin scopes/grants/Authgear metadata, private notes/sourceHash/external withdrawal, invitations/friendship/subject-bound continuation/quota/native fallback, community sharing/manual withdrawal, three-language editor/reviewer saves,24 reports/30 learner HTML checks/49 badges and matching legacy worker transports. All identities/writes/sends in these scenarios were isolated/synthetic/mocked.

## Controlled production activation

- Preflight confirmed the existing worker configuration had both provider credentials and existing Telegram reminder/reviewer flags, with no new receipt flag or installed receipt unit. No credential was printed.
- Installed the manifest-checked unit as `qigong-practice-receipts.service` with `User/Group=qigong-notifier`, continuous entry, restart policy,90s stop allowance,192MiB memory and50% CPU limits, existing hardening and a pool capped at4 by the entry.
- Atomically appended **only** `PRACTICE_RECEIPTS_REALTIME_ENABLED=true` to the existing protected worker env. Compared every prior parsed key/value unchanged; API env stayed byte-identical, worker owner/group/mode640 retained. Before/after hashes and a restricted original copy are preserved.
- Explicitly enabled/started the new service. LINE/TG lanes idle-poll1000ms, batch3 each, bounded backlog drain; old minute timer remains active as fallback. Existing reminder/reviewer flags stay true, WhatsApp remains unconfigured and privacy policy draft. No user opt-in or subscription was fabricated.
- The service entered at **01:52:30 UTC**, enabled/active, `NRestarts=0`, exit0. Initial post-check had two heartbeats, no worker/schema/database errors, roughly28MiB current memory, both lanes configured and zero pending/sending receipts. No new live receipt had arrived at that first check, so production delivery timing still requires ordinary user acceptance.
- The old worker also succeeded at **01:53:34 UTC**, after maintenance, with its timer active; API active/restart0/exit0 and public readiness/version correct.
- Public smoke passed **189 HTTPS checks**, including protected admin routes, signatures/Origin/schema boundaries and learner regressions. It created no production enrollment, admin session, practice/reflection, receipt or external client. Request-URL redaction probe passed without exposing raw logs.

The installed production ExecStart has **no mock preload**. Production will normally send eligible queued receipts through real providers. Tests generated no real provider messages. The long-lived heartbeat is liveness, not a delivery SLA; existing retry/backoff,10-minute forced-kill lease recovery and provider/network uncertainty remain. No exactly-once or strict recipient-wide arrival-order guarantee is introduced.

## Recovery and evidence

- Server: `/root/qigong-deploy-6a2ae3f`, final restore/fingerprint evidence, original worker env, before/after hashes and preparation/activation scripts.
- Guarded tools: `/opt/qigong-platform/deployment-tools/6a2ae3f/`, including the clone-only mock preload and realtime fixture verifier. The mock preload asserts clone socket/port and is never installed in the production service.
- Stopped clone: `/var/lib/postgresql/qigong-rehearsal-6a2ae3f`, Unix socket port55448. Temporary clone env/credential/receipt-fixture files removed.
- Off-host ciphertext: `~/.local/share/qigong-platform/backups/deployment-6a2ae3f`; separate key under `backup-keys/`. Original final DB/roles/runtime archives and a **post-activation runtime/unit configuration archive** were encrypted and decrypt/hash verified. Durable crypto helper remains in deployment-269555c tools.
- Workstation: `/tmp/qigong-receipt-realtime-release-{prepare,regression,systemd-rehearsal-final,activate,public}.log`; local verification and implementation evidence in [design](realtime-practice-receipts.md).

Rollback: **stop and disable the realtime service before reverting to an older binary that lacks its entry**. Allow in-flight work to finish; any forced kill retains the existing lease/backoff rules. Keep the old minute timer/fallback and durable queue. Review/removal of the new flag must preserve other current env changes; do not blindly replace env from a stale snapshot. For this same36 rollback, switch matching old API/worker and saved release override only—**no DB restore or discarded post-release check-ins/receipt state**. Leaving an env file edited does not hot-disable a running process.

Extra all-test TypeScript retains10 pre-existing errors; earlier timestamp intermittency is not claimed fixed. Real LINE/TG mobile acceptance and observed production latency remain pending the user's next normal check-in.
