# ADR 0002: Identity and Primary Interaction Channel

## Status

Accepted

## Decision

`people` represents learners. LINE, Telegram, WhatsApp, and website identities are separate `platform_identities` linked only through explicit verification.

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
