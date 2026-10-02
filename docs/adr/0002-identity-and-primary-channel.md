# ADR 0002: Identity and Primary Interaction Channel

## Status

Accepted

## Decision

`people` represents learners. A verified LINE, Telegram, or WhatsApp identity can apply without a website account. An application remains pending until an authorized administrator in the requested operational region approves it. Rejection requires a reason. Approval creates the learner, region assignment, verified platform identity, and first active channel atomically; pending and rejected applicants cannot check in. Unassigned applications require explicit routing before approval.

Website OIDC issuer and subject are optional together until the learner later links a verified website identity. Messaging identities remain in `platform_identities`; linking never relies on name, phone, or email matching.

A learner may verify multiple identities but has exactly one active primary interaction channel at a time. The active channel is temporal history, not an overwriteable column.

Only the active channel may create or modify check-ins. Switching requires website authentication, verification of the new platform identity, an atomic transition, audit logging, and notifications to old and new channels.

Reminder consent is channel-specific and does not transfer automatically.

## Constraints

- `UNIQUE(platform, external_subject_id)`.
- At most one open-ended interaction-channel record per person.
- The selected platform identity must belong to the same person.
- `valid_to` must be greater than `valid_from`.
- A PostgreSQL exclusion constraint prevents interaction-channel effective ranges for one person from overlapping.
- Switching locks the person and closes/opens channel periods in one transaction.
- No automatic linking by name, phone-like text, email, or locale.
- Administrative override requires a dedicated permission and audit reason.
