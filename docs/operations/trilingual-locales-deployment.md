# Three-language deployment — 2ec42e2 / schema35

## Release and approval

The user authorized commit, push and deployment. Final production code is **`2ec42e2acfcbf2ccd34662ff7b5a17a3ab514d67`**, CI **38764759639**, successful. Initial feature commit `37148e0` also passed CI but was **not deployed**: isolated compiled-API testing exposed the archived LINE SQL facade still forcing Traditional Chinese. The final commit removes only that override in new migration35 and strengthens the three-language LINE catalog regression. Historical0001–0034 remain unchanged;35 is now deployed and immutable.

Local full `pnpm verify` after the fix passed **721 tests** (API533 / database180 / config2 / identity6), formatting, lint, source typecheck and build. The extra all-test TypeScript command still has the10 previously documented errors. The earlier local timestamp-constraint intermittency is not claimed fixed.

Production moved from `d8d4e6679993a018819b790fe608197934045f46` / exact34 to the matching exact35 API/worker, architecture `phase-20-simplified-chinese`, worker gate `ops.locale_schema_ready()`.

Maintenance: **2026-10-15 16:02:58–16:03:18 UTC (20 seconds)**. Worker timer was paused and the running worker drained before API stop. Active/in-transaction writers were checked before the final backup and migration. No rolling coexistence with the34 binary was attempted; this was the explicitly approved coordinated maintenance release.

## Artifact, backup and actual restoration

- Frozen Git archive for the final SHA, excluding environment files, Apple sidecars and unrelated untracked material. Frozen-lockfile installation/build, manifest checksums for all migrations and compiled packages; exact archive/manifest rechecked before activation.
- Prepared a separate PostgreSQL16 cluster, roles and actual production dump. Rehearsed old34 readiness,35 application/reapplication, matching runtime and full workflows before touching production schema.
- During final maintenance, captured a **fresh** database dump, roles and runtime/systemd configuration, not the older preparation snapshot. Sent each through authenticated AES-256-GCM encryption to restricted workstation storage; key held separately. Decrypted and hash-verified all three, reapplied restored role settings and actually restored the decrypted final database into the isolated cluster.
- Restored34 application data/metadata fingerprints matched; old production binary was ready. Applied35 to this final restored clone and checked preservation again **before** applying35 to production.
- Production35 apply1 / repeat0. Before API traffic resumed, all **75 existing application tables / 17 people / 24 check-ins** retained their data fingerprints, except the intended platform metadata version/timestamp and the new nullable binding-challenge column. Existing preference locale values are included in the preservation comparison, not ignored. No identity, consent, subscription, journal publication, badge award or language backfill.
- Table ownership, forced-RLS flags and effective ACLs, plus old function ownership/ACL/security-definer/search-path/volatility attributes, retained. `pg_restore` normalizes explicit owner-default ACLs to NULL; the comparison canonicalizes **only** that equivalent postgres-owner representation, without adding or dropping permissions. All four new functions have no PUBLIC execute grant.

The API symlink and systemd release override were switched together with the matching worker target. Protected environment files remained byte-identical and mode640. Telegram learner reminders and reviewer notifications retain their already-enabled operational flags; individual opt-ins remain unchanged. WhatsApp remains unconfigured; privacy policy remains draft with original version/hash/acceptances unchanged.

## Workflow verification

All authenticated/write scenarios below ran only in the guarded isolated clone with synthetic identities and transport mocks:

- Scoped admin reports and grant management, self/master/super protections, verified Authgear metadata without identity/grant changes, version/idempotency and private-note round trips.
- Shared journal sourceHash conflict, withdrawal, external opt-in and credential revocation; disclosed LINE/TG sharing across channels/regions, blank/reflection retry, legacy-private preservation and manual-withdrawal non-resurrection.
- Actual complete invitation HTML/API: new and pending explicit reconfirmation, signed follow, subject-bound continuation, friendship, quota exactly2, already-approved revoked-invite revisit, native/manual chat fallbacks, no direct check-in/auto-close/send or repeated approval.
- Actual admin notification HTML scripts with real clone APIs save both preferences in all **three** languages, with page-local locale and existing scoped checkbox layout.
- Compiled learner locale smoke: **24 reports +30 HTML checks**, all three languages, verified subject preferences, genuine SQL/catalog names including English LINE,49 badge definitions and unchanged legal hash. WhatsApp compiled three-language presentation tested while its operational routes remain disabled.
- Matching compiled worker, both notification flags on, all outbound transports mocked. No provider delivery or real-device acceptance is inferred.

The old generic smoke had borrowed an existing Telegram check-in and assumed it was unpublished. The newer real snapshot contained a legitimate publication, so that fixture assumption failed. The smoke now seeds/selects an independent synthetic learner; product privacy assertions and sharing controls were not weakened. An initial locale-only harness also omitted Telegram adapter configuration; configuring the mock adapter corrected that404. Neither was treated as a production defect.

Public HTTPS verification passed **189 checks**, including all three learner HTML locales, authentication/Origin/schema guards, empty signed LINE webhook, invitation/chat markers, community disclosure, icons, privacy and public logo. No production enrollment, invitation, admin session, reflection or external-client record was created by the smoke. A synthetic SDK-query probe confirmed request URLs are redacted in API logs, without printing raw journal contents.

Post-release checks: API active / `NRestarts=0` / exit0, worker timer active, matching worker successful / exit0 at16:04:04 UTC, after maintenance ended. Public live reports the final SHA; ready reports exact35 and restricted `qigong-api`; new worker gate true / old34 gate false. Temporary clone worker env and synthetic fixture credential file were removed, rehearsal cluster stopped. The unrelated permissions-review file stays excluded; legacy repositories were not changed.

## Recovery and evidence

- Server evidence: `/root/qigong-deploy-2ec42e2`.
- Guarded tools: `/opt/qigong-platform/deployment-tools/2ec42e2/` (`ops`, legacy/community/invitation/UI/locale/public smokes); preparation/activation scripts retained in the restricted server evidence directory.
- Isolated stopped cluster: `/var/lib/postgresql/qigong-rehearsal-2ec42e2`, socket port55444. Superseded37148e0 rehearsal also stopped; it was never production.
- Restricted off-host ciphertext: `~/.local/share/qigong-platform/backups/deployment-2ec42e2`; separately restricted key under `backup-keys/`. Durable crypto helper remains in the earlier deployment-269555c backup tools.
- Workstation evidence: `/tmp/qigong-locale-release-2ec42e2-*`, `/tmp/qigong-locale-line-fix-verify.log`; prior local180-layout evidence is documented in [implementation](trilingual-locales.md).

**Do not binary-only roll35 back to d8d4e66/34.** Restore/redeploy requires matching database/API/worker and explicit post-traffic reconciliation, including newly saved locales, binding challenges, check-ins, reflections, withdrawals, consent and notification state. Never overwrite live writes with the older preparation or pre-release snapshot. The superseded37148e0 artifact has a different unpublished35 checksum and is not a validated fallback. Keep the final artifact and backups immutable and request review before any downgrade.

The previous LINE invite→helper chat→check-in→close→same-chat receipt flow had user acceptance before this release. The newly deployed three-language choices still require ordinary real-device/user acceptance; local browsers, signed mocks and public checks are not that evidence.
