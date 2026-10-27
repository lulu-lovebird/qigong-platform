# Venue history/admin: PG16 isolation-tool recovery protocol

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。
Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

## Scope and root cause

This is an operator-only **prepare** protocol, not deployment authorization. The prior attempt and its failures remain recorded in `/tmp/venue-history-PG16-prepare-record.md` and the server-private evidence directory `/root/qigong-venue-history-prepare-3fc4a5e-20261027T0245Z`.

The previous extra version-gate copy failed SQLSTATE55006: its owner pool issued `CREATE DATABASE ... TEMPLATE qigong_platform` while connected to that same template, and its runtime pool also remained open. Closing only runtime would therefore be insufficient.

The resumed run must use an exact Git SHA archive, an online consistent exported snapshot taken **in this run**, a newly owned0700 Unix-socket-only PG16 cluster and separate disposable test databases. Previous dumps remain recovery evidence; they are not substituted for a current snapshot. All true learner data and credential-bearing backups remain server-private. No existing production database/session may be terminated, dropped or changed.

## Correct owned-connection lifecycle

1. Await completion/closure of every injected app and query using the restore template.
2. Await `pool.end()` for **both** owned owner/runtime pools; remove those references so final cleanup cannot end the same pool twice.
3. Create an independent admin pool connected to the clone's `postgres` database. Verify the exact recorded clone data directory, database and empty `listen_addresses`.
4. Assert the template has **zero** client sessions before ordinary `CREATE DATABASE ... TEMPLATE ...`. A nonzero result is a failure, not permission to terminate clients. Never use FORCE, `pg_terminate_backend` or production session cleanup.
5. Run unknown/future/transition ledger mutations only in the disposable version-gate copy. Require both startup schema-mismatch rejection and HTTP readiness503; default-off must not admit an unknown filename.
6. End all version-gate pools before ordinary `DROP DATABASE`, then end the admin pool. Reopen an owner pool on the untouched restore template only for final fingerprints.
7. Worker copies likewise use an admin connection to `postgres`, zero template clients and ordinary create/drop. Every observer/runtime connection closes before its copy is dropped.

## Readonly worker acceptance is not delivery success

Run baseline5628420 and the exact candidate minute/realtime entrypoints only with a clean allowlisted environment, synthetic tokens, blocked fetch, private network and a clone-only URL. Require database and connection `transaction_read_only=on`, a successful schema54 worker gate and a controlled SQLSTATE25006 write denial. No real LINE/OIDC/provider credential is injected.

A minute worker can exit1 because readonly mode intentionally prevents queue claims/reconciliation; that is **not** processing success. Its accepted outcome must include a passed schema gate, expected lane rejection, zero provider attempts and unchanged copied-table fingerprints. Realtime must start and stop gracefully while writes remain blocked. Record all four binaries' exact exits/signals and do not claim normal notification delivery or a provider test.

## Boundaries, evidence and outstanding gates

The resume has a new three-repair budget. Each failed run retains diagnostics and stops/removes only its recorded owned clone; no guard, published migration, RLS policy, dependency or CI gate is relaxed. Use sequential CPU45%/memory750MiB/tasks100/nice15 resource limits. At this quota the previous1000/1001 people export case needed a rehearsal-only30s CLI timeout; preserve that qualification and all assertions rather than silently changing CI.

The server-only orchestration is outside the product artifact. Record its own hashes separately from the candidate Git SHA; do not describe a remote-script-only change as a product-code fix. Reviewed resume helper hashes at protocol commit time:

| Helper        | SHA256                                                             |
| ------------- | ------------------------------------------------------------------ |
| rehearsal.mjs | `eddcbd00bb082756224f03cc76640ab7db63ff66e7f9c6795b6dfc2401067e1b` |
| workers.mjs   | `e2b1f0ba266800e482417e34872ae215a2684fb5070c3718c7aa6c9562f76a3d` |
| backup.py     | `fba8d700f65117330f8d5cc40854163b94cbeae272ad5e5e53e3dfd331465821` |
| controller.py | `d21bb7107f575bb0b8d5ad575228b58684dd8e841c0f60783e4f1eec996bb2c7` |

New evidence directory: `/root/qigong-venue-history-resume-20261027T0314Z`, root0700/files0600. Execution outcomes and any later helper hashes belong in its sealed handoff and a safe PR evidence comment, **not a claim of success in this protocol**. The exact candidate is the commit containing this document; determine it with `git rev-parse HEAD`, without a self-referential SHA.

Require a fresh51 restore/all-table hash comparison,51→54 apply3/repeat0, original-column data and old security preservation, exact readiness/default-off/unknown rejection,27-page regression, both readonly worker versions, and independent synthetic history17/settings12/people11/QR10. Full workspace checks and source/test-inclusive TypeScript gates must be separately recorded with exact skips.

Parent reviews local commits/artifacts and owns any push/CI rerun; this resume performs neither push nor merge nor deployment. Exact-candidate CI, required independent review, mobile/LIFF acceptance and formal maintenance authorization remain separate gates. Future deployment needs a new stopped-writer final backup and actual restore, not this online preparation snapshot.

After any54 upgrade retain schema54 and every new write. Use a reviewed54-compatible feature-off/fix-forward artifact; baseline5628420 rejects54 and is not a rollback target. A symlink switch or restoring the old51 snapshot is not a valid rollback.
