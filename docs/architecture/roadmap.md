# Delivery Roadmap

## Phase 0: Product and Governance Contracts

- Finalize primary IM capability matrix.
- Finalize website OIDC claim contract.
- Finalize region transfer workflow and historical visibility.
- Approve private-note and learner-sharing consent text.
- Approve retention, deletion, and anonymization policy.
- Confirm official seasonal campaign definitions.

## Phase 1: Engineering Foundation

- TypeScript workspace and project structure.
- CI, formatting, type checks, unit and integration tests.
- PostgreSQL migration runner with version, checksum, and advisory lock.
- Structured logging, request IDs, health/readiness, and configuration validation.
- ADR enforcement and architecture tests.

## Phase 2: OIDC, Identity, Region, and Authorization

- Website OIDC Authorization Code + PKCE integration.
- People, platform identities, active interaction-channel history.
- Regions, dated assignments, cohorts, and memberships.
- Admin principals, action permissions, scoped grants, RLS, and audit.
- Primary IM linking, switching, recovery, and notification flows.

## Phase 3: Unified Check-In Domain

- Taxonomy and platform availability.
- Practice/reminder timezone separation.
- Device-timezone difference prompt and manual permanent change.
- Check-in uniqueness and method replacement.
- Noon make-up policy across all platforms.
- Rebuildable streak/stat summaries.
- Versioned campaigns and deterministic badges.
- Private note and sharing preference contract.

## Phase 4: Reliable Platform Operations

- Provider verification adapters.
- Durable webhook inbox and normalized event workers.
- Outbound operation and delivery ledger.
- Retry, dead-letter, replay, rate limits, and ambiguous-delivery state.
- Reminder preferences, channel consent, capability matrix, and scheduler.

## Phase 5: Authorization and Privacy Pilot

- Exercise country, region, coach, viewer, privacy, and content roles with synthetic users.
- Verify temporal region boundaries and transfer workflow.
- Verify private-note audit, aggregate suppression, anti-differencing, and export controls.
- No real learner check-ins are accepted until this phase passes Gate 2.

## Phase 6: Telegram Learner Pilot

- New website-authenticated learners only.
- Telegram primary interaction channel.
- One small operational region.
- End-to-end check-in, reminder, badge, history, and admin workflows.
- No legacy data import.

## Phase 7: LINE and WhatsApp Onboarding

- Allow new learners to choose a primary platform.
- Expose capability and cost/consent differences before confirmation.
- Apply the common check-in and make-up policy.
- Keep old test systems in maintenance mode.

## Phase 8: Website Self-Service Channel Management

- Link additional platform identities.
- Switch active channel atomically.
- Revoke lost identities.
- Reset platform-specific reminder consent.
- Notify old and new channels and retain audit history.

## Phase 9: Authenticated Learner Sharing

- Separate published posts from private check-in notes.
- Real-name default and nickname option.
- Share opt-out, unpublish, report, moderation, and deletion propagation.
- `noindex`, authenticated access, and private cache behavior.

## Phase 10: Formal Cutover and Legacy Retirement

- Route new platform traffic through unified adapters.
- Stop legacy onboarding and writes.
- Archive test databases without importing them into production.
- Complete restore drills, operational handover, and incident runbooks.

## Phase 11: HA and Analytics

- Managed PostgreSQL or tested primary/standby with PITR.
- Read replicas where useful.
- Materialized reporting with scope-aware refresh.
- Async exports and optional warehouse after privacy review.
