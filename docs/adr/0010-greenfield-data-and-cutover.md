# ADR 0010: Greenfield Production Data and Cutover

## Status

Accepted

## Decision

The unified global platform starts with new production users and records. Existing three-bot databases are testing systems and are not imported into the authoritative database.

Existing bots remain available during implementation and pilot. New learners onboard directly to the unified platform. Legacy systems are later placed in maintenance/read-only mode and archived.

## Consequences

- No legacy person deduplication, check-in merge, or badge migration is required.
- Migration work focuses on routing, platform identity verification, and operational cutover rather than historical backfill.
- Legacy test data must never be accidentally connected to production identities or reports.
