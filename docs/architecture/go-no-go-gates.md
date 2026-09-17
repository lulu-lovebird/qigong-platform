# Go/No-Go Gates

## Gate 1: Begin Implementation

- OIDC issuer and claim contract agreed.
- Primary IM switching and recovery agreed.
- Region transfer and historical visibility agreed.
- Sharing consent and private-note roles agreed.
- Retention/deletion policy owner assigned.
- Anonymization and re-registration policy approved, including audit retention.
- Seasonal campaign policy approved.

## Gate 2: Start Admin Pilot

- OIDC, MFA policy, CSRF, and session controls tested.
- RLS enabled and forced for runtime admin role.
- Horizontal and temporal authorization tests pass.
- Private-note access audit passes.
- Aggregate suppression and export controls pass.
- Break-glass process documented and tested.

## Gate 3: Start Learner Pilot

- Canonical check-in and one-per-date constraint tested.
- Active primary channel enforced server-side.
- Timezone, noon make-up, DST, and midnight tests pass.
- Badge reconciliation and summary rebuild pass.
- Inbox/outbox retry and dead-letter tests pass.
- Backup and restore drill completed.
- Privacy policy and terms available in the product.

## Gate 4: Add a New Platform

- Provider signature/token verification independently tested.
- Capability differences are disclosed during onboarding.
- Reminder consent and cost policy configured.
- Rate limiting and provider failure classification tested.
- Existing platform pilot error budget remains within threshold.

## Gate 5: Enable Learner Sharing

- Sharing is authenticated-only and not indexed.
- Consent text and versioning approved.
- Real-name and nickname behavior tested.
- Opt-out and unpublish propagation tested.
- Moderation and reporting staffed.
- Sensitive-data warning and private-note access policy are visible.

## Gate 6: Formal Cutover

- External probes and internal readiness are healthy.
- Queue age and dead-letter thresholds are within limits.
- Regional authorization audit has no unresolved violations.
- Canonical counts and summary reconciliation pass.
- Rollback rehearsal passes.
- Legacy systems can be made read-only without losing production data.

## Gate 7: Legacy Retirement

- Unified production restore drill passes.
- Legacy systems have been read-only for the agreed observation period.
- No unresolved provider callbacks target old handlers.
- Privacy export/deletion workflows operate entirely on the unified system.
- Operations, security, and product owners sign off.
