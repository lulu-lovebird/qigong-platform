# ADR 0002: Identity and Primary Interaction Channel

## Status

Accepted. The owner selected **Option A — no implicit association** during the LINE pre-release review. The local implementation enforces it with `0014_no_implicit_identity_linking.sql`; this is not a production deployment approval.

## Decision

`people` represents learners. A verified LINE, Telegram, or WhatsApp identity can apply without a website account. An application remains pending until an authorized administrator in the requested operational region approves it. Rejection requires a reason. Approval creates a **new** learner, region assignment, verified platform identity, and first active channel atomically; pending and rejected applicants cannot check in. Unassigned applications require explicit routing before approval.

Website OIDC issuer and subject are optional together until the learner later links a verified website identity. Messaging identities remain in `platform_identities`; linking never relies on name, phone, or email matching. Equal personal details, another region's existing learner, ambiguity, or approval order do not authorize association. No candidate-selection, merging or channel-switching workflow is implemented by this change.

A learner may verify multiple identities through a future, explicitly reviewed ownership-verification flow, but has exactly one active primary interaction channel at a time. The active channel is temporal history, not an overwriteable column.

Only the active channel may create or modify check-ins. Switching requires website authentication, verification of the new platform identity, an atomic transition, audit logging, and notifications to old and new channels. This ADR defines those requirements; it does not claim the switching flow is implemented.

Reminder consent is channel-specific and does not transfer automatically.

## Constraints

- `UNIQUE(platform, external_subject_id)`.
- At most one open-ended interaction-channel record per person.
- The selected platform identity must belong to the same person.
- `valid_to` must be greater than `valid_from`.
- A PostgreSQL exclusion constraint prevents interaction-channel effective ranges for one person from overlapping.
- Future switching must lock the person and close/open channel periods in one transaction.
- No automatic linking by name, phone-like text, email, or locale.
- Administrative override requires a dedicated permission and audit reason; it is not part of ordinary onboarding approval.
- Same-application approval locks that application row: concurrent reviewers cannot create multiple people or notifications for it.

## Consequences and limits

- One real learner applying through multiple platforms can have multiple person records. Each approval establishes that record's own primary channel. The one-check-in-per-person/date constraint is **not a real-world-human deduplication guarantee** across those records.
- Administrators must explain this pilot limitation; do not offer a second application as a way to transfer or share an existing learner's history. Resolving duplicates requires a separately designed, ownership-verified process. Neither a manual personal-data match nor this ADR authorizes database merging.
- Name, email and phone remain useful for regional application review but are self-reported; a LINE ID token proves control of that LINE identity, not ownership of the website account, email, phone or another person record.
- Existing associated records created before `0014` are preserved. `0014` changes future approval behavior only and does not split people, rewrite identities/history/channels, or restore the old `person_id` uniqueness constraint, which could reject existing associations.

## Historical LINE review (superseded behavior)

The local `0013_line_onboarding.sql` previously performed implicit association from normalized name, email and phone. It remains unchanged for migration checksum integrity, but its approval function is replaced by `0014`. Do not enable the new API at the intermediate `0013` version.

Review findings explaining the choice of A:

- A unique matching candidate could be associated across region boundaries after checking permission only for the new application's requested region. RLS row-read denial did not establish authority for this association.
- Multiple candidates or a same-platform conflict created a new person rather than resolving duplicate records.
- Matching was asymmetric: Telegram-first then LINE shared one person, but LINE-first then Telegram created two. Advisory locking did not make the result independent of commit order.
- The fields were not ownership evidence, and there was no association-specific confirmation, permission or evidence audit.

Option B (candidate suggestions plus explicit ownership, permission, reason and audit) remains a possible future design, not the selected pilot scope. Option C (accepting the previous implicit matching) was not adopted.

## Verification and release boundary

- `apps/public-api/tests/line-onboarding.test.ts` tests separate people for matching normalized details, ambiguity, same-platform and cross-region cases, both overlapping review orders, preservation of other learners' identities/regions/channels, and one successful concurrent review per application.
- `packages/database/tests/repository-migrations.test.ts` tests the full chain and an actual `0013` upgrade through the current `0017` chain (policy A is introduced by `0014`): existing linked identities/channels and historical checksums remain intact; subsequent approvals do not associate implicitly.
- The current API declares minimum and maximum migration `0017_admin_reporting.sql`; `0015` adds per-channel language preferences, `0016` adds WhatsApp functions, and `0017` adds read-only admin reporting. Full deployment must include the complete `0001`–`0017` chain, matching API/worker artifacts and privately configured LINE credentials. Production transition, compatibility strategy and restoration rehearsal require separate approval; see [LINE pilot](../operations/line-pilot.md).

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。

Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
