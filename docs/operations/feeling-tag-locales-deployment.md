# Editable Simplified quick-tag labels — deployment2f5a4eb / schema36

## Release

The user separately approved commit, push and deployment. Production code is **`2f5a4ebeba66c2dbad17406a3d99bf14aa254245`**, exact-SHA CI **38771867155** successful. Full verification passed **729 tests** (API538 / database183 / config2 / identity6), formatting, lint, source typecheck and build. The extra all-test TypeScript command still has10 documented pre-existing errors; previous timestamp intermittency is not claimed fixed.

Production moved from `2ec42e2` / schema35 to matching exact36 API/worker, architecture `phase-21-feeling-tag-locales`, worker gate `ops.feeling_tag_locales_schema_ready()`.

Maintenance: **2026-10-15 16:53:43–16:54:01 UTC (18 seconds)**. Worker timer paused and worker drained; API stopped and active/in-transaction writer count checked. This was the explicitly approved coordinated-maintenance release, not an expand-compatible rolling deployment.

The admin quick-tag editor now has three editable name fields. Simplified is optional; blank uses the original Traditional label. Existing catalog labels were **not** auto-filled or converted. Changes require the normal authorized save. New selections capture the current translation; existing selected labels and publication snapshots retain their original values.

## Artifact and recovery verification

- Frozen archive and source SHA, environment/Apple-sidecar exclusion, frozen-lockfile install/build and checksummed compiled packages/migrations. Manifest and source archive rechecked before activation. Dependency manifests, lockfiles and deployed0001–0035 unchanged;36 is now deployed and immutable.
- Separate PostgreSQL16 clone restored with production roles and data. Old35 binary readiness verified,36 apply1/repeat0 and preservation tested before any production schema change.
- Final maintenance captured a **fresh** database dump, roles and runtime/systemd configuration. All three were streamed through authenticated AES-256-GCM encryption to restricted workstation storage with a separate key, then decrypted and hash-verified.
- Actually reapplied decrypted role settings and restored the final decrypted database into the isolated cluster. Exact35 data/metadata restoration and old binary readiness passed. Applied36 again to the **final restored snapshot** and checked preservation before production migration.
- Production apply1/repeat0; final before-traffic fingerprints preserve all **75 existing application tables / 17 people / 24 check-ins**, except the intended architecture metadata/timestamp and the two newly nullable `name_zh_cn` columns. Existing tag values, catalog version, preferences, grants, consent, audit, selected labels, publications and badge data remain included in the comparison.
- Derived `journal_source` hashes for **every existing check-in** also match before/after, not merely the stored rows. No extra NULL JSON keys invalidate old source hashes.
- Table ownership, forced-RLS/effective ACL and existing function owner/ACL/security-definer/search-path/volatility metadata retained. Equivalent postgres-owner default ACL NULL normalization on restoration is canonicalized, not permission relaxation. The one new worker-gate function has zero PUBLIC execute grants.

## Compiled workflow verification

All authenticated mutation tests ran only in the guarded clone, using independent synthetic principals/learners and mocked provider transports:

- **Actual complete tag-editor HTML scripts in all three locales**, backed by real clone APIs: three editable labels, cancelled drafts, literal Simplified save, reload/catalog persistence, CSRF and version rejection, old-client omitted-field preservation.
- A new LINE selection captures the translation, then explicit publication makes that snapshot visible in the cursor stream. Catalog rename changes live options but preserves selected historical labels, publication JSON and sourceHash; explicit NULL clearing restores Traditional fallback.
- Scoped admin reports/grants, self-protection, verified Authgear metadata refresh, private-note round trips, journal source conflict, withdrawal and external credential revocation.
- LINE invitation new/pending confirmation, signed follow, subject-bound continuation, quota exactly2, revoked-invite approved revisit, native/manual chat fallback, no repeated approval/auto-close/send.
- LINE/TG community notes across regions/channels, blank saves, idempotent retries, old-private preservation and manual withdrawal non-resurrection. Three-language reviewer HTML/preferences;24 learner reports +30 HTML checks and49 badge definitions; unchanged legal identity/hash and disabled WhatsApp routes.
- Matching compiled worker with existing operational flags enabled and transport mocks: zero real provider sends. No individual opt-in/subscription was created in production.

Public HTTPS smoke passed **189 checks**: exact release/readiness, three-language learner pages, auth/Origin/schema guards, protected admin routes, empty signed LINE webhook, existing invitation/chat/community/icon markers and public logo. It created no production enrollment, admin session, invitation, reflection, translation or external-client record. A read-only log-verifier quoting error was corrected; the synthetic request-URL redaction assertions then passed without exposing raw logs or changing product code.

Post-release: API active / `NRestarts=0` / exit0; timer active; worker successful / exit0 at **16:54:40 UTC**, after maintenance ended. Protected env byte hashes and mode640 unchanged; Telegram reminders and reviewer notifications remain operationally enabled, WhatsApp unconfigured and privacy policy draft. New gate true / old35 gate false. Clone worker env and synthetic credential fixture removed, rehearsal stopped. No Console or legacy-repository change; unrelated permissions review remains excluded.

Local positive mock-browser acceptance from implementation:390/1280 ×3 locales =6 layouts, real DOM edit/cancel/save/reload, no overflow/runtime exception. This and the clone smokes are **not** authenticated production-user, provider-delivery or real-device acceptance.

## Evidence and rollback boundary

- Server: `/root/qigong-deploy-2f5a4eb`, including final encrypted-backup restoration/preservation evidence and preparation/activation scripts.
- Guarded tools: `/opt/qigong-platform/deployment-tools/2f5a4eb/` (`ops`, legacy/community/invitation/reviewer/locale/tag/public smokes).
- Stopped isolated cluster: `/var/lib/postgresql/qigong-rehearsal-2f5a4eb`, Unix socket port55445.
- Restricted off-host ciphertext: `~/.local/share/qigong-platform/backups/deployment-2f5a4eb`; separate key under `backup-keys/`. Durable crypto tool retained in deployment-269555c backup tools.
- Workstation: `/tmp/qigong-tag-locales-release-{prepare,smoke,activate,public}.log`, local verification/browser evidence documented in [implementation](feeling-tag-locales.md).

**Do not binary-only roll36 back to35.** Any downgrade needs matching database/API/worker and approved reconciliation of post-release translations, selections, publications, check-ins, consents and notifications. Never replace live writes with an older preparation/pre-release snapshot or silently discard Simplified labels. Keep the final artifact and recovery materials immutable.
