# Editable Simplified Chinese quick-tag labels

## Status

Deployed after separate user approval: **`2f5a4eb` / schema36**. See [deployment and actual-restoration evidence](feeling-tag-locales-deployment.md). This is an editable catalog translation, not an automatic conversion of learner content.

## Administration

`/admin/practice-feeling-tags` now edits Traditional Chinese, Simplified Chinese and English side by side, with the existing active/order controls. Simplified is optional, up to40 Unicode code points; Traditional and English remain required. Empty/NULL Simplified means display the Traditional label, not an automatically generated translation.

The nullable `name_zh_cn` is included in the catalog response and optional in the strict save schema. UI payloads explicitly clear it with NULL; older clients that omit it retain the saved value. The entire-catalog version, maximum30 tags, duplicate-ID/name rules, no-omission rule, taxonomy permission and post-lock grant checks, CSRF/session and transactional audit remain authoritative. Duplicate validation includes retained Simplified labels when an older client omits that field. Identical translations within one tag remain allowed, but different tags cannot collide across the three label fields.

Changing only Simplified participates in dirty tracking, discard confirmation, reload/reset and failed-save preservation. Inputs and snapshots are rendered as literal text. Typed Simplified values are **not** run through the UI phrase converter, even if they happen to equal a known Traditional UI phrase.

## Learners and historical integrity

- Active catalog options select the stored locale-specific label; missing Simplified uses the original Traditional label.
- A newly selected feeling tag snapshots its current Simplified value with its existing Traditional/English labels. Existing selections retain their first captured labels, even when resubmitted unchanged after a catalog rename; explicit removal/reselection creates a fresh selection snapshot.
- Old rows gain a NULL column only. There is no label, note, selection or publication backfill. Catalog changes never rewrite selected or published labels.
- `journal_source` adds a `zh_CN` JSON key **only when a selection actually captured a translation**. Old NULL translations do not introduce extra JSON keys or invalidate existing source hashes.
- New publication snapshots can carry that captured translation. Existing published JSON stays byte-identical; a missing locale key displays the original Traditional snapshot rather than NULL. Private notes, identity names, reasons, method codes and privacy documents are not converted.
- Workspace, legacy note and scoped journal readers keep their existing authority, privacy and cursor boundaries. The source-owned DTO converter no longer converts feeling labels; the database's explicit translation/fallback is authoritative.

## Migration and compatibility

Only new `0036_feeling_tag_simplified_labels.sql` is added. Deployed0001–0035 and dependency metadata/lockfiles stay untouched. Existing save/read function definitions keep their grants/ownership and access/locking semantics; the private save implementation captures the extra column without replacing its consent wrapper or changing omission behavior.

Deployed API min/max are exact36; worker gate is `ops.feeling_tag_locales_schema_ready()` / `phase-21-feeling-tag-locales`. The previous35 build rejects36. The separately approved coordinated maintenance, final encrypted backups, actual restoration and matching API/worker checks are recorded in the deployment evidence. Future incompatible releases require the same explicit review. Do not binary-only roll back36 to35 or discard translations/post-release writes; any downgrade needs a matching database and approved reconciliation.

## Verification

- Dedicated local PostgreSQL16, full `pnpm verify`: **729 tests** (API538 / database183 / config2 / identity6), formatting, lint, source typecheck and build passing.
- New35→36/repeat0 rehearsal fingerprints all existing application-table rows, including old selections and publication JSON, excluding only intended metadata fields and the two new nullable columns. Old source JSON/hash and table owner/ACL/forced-RLS are preserved. Readiness boundary is tested; no preference/consent changes.
- DB and real HTTP tests verify independent literal translations, old-client omission, explicit clearing, fallback, Unicode limits, duplicate/version/permission failure, snapshot stability, unchanged publication JSON and exact Simplified values through the presentation boundary.
- Actual generated editor scripts run in all three UI locales: three editable labels, cancelled/failed drafts retained, CSRF/version save, clearing and clean baseline after success.
- Chrome390/1280 ×3 locales: **6 layouts**, positive synthetic catalog API, real DOM edit/cancel/save/reload, no overflow or runtime exceptions. Preview transports are mocks, not authenticated production/provider or real-device acceptance.
- Test-only fixtures were corrected to project the writable schema (rather than posting catalog metadata) and include the existing required region assignment. No product validation was weakened.
- Extra all-test TypeScript still has the10 pre-existing errors; older timestamp-constraint intermittency is not claimed fixed.

Evidence: `/tmp/qigong-tag-locales-{verify,all-types,cdp}.log`, preview/CDP scripts and six screenshots. Local/clone validation made no production writes; the separately approved deployment is recorded above. No Console/notification flag or policy-publication changes. Preserve and exclude unrelated `docs/operations/web-admin-permissions-review.md` from any later commit.
