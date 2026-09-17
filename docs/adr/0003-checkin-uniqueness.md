# ADR 0003: Canonical Check-In Uniqueness

## Status

Accepted

## Decision

The new global platform enforces one canonical check-in per person and practice date:

```text
UNIQUE(person_id, practice_date)
```

Every check-in records the submitting platform identity and source platform for provenance. Editing replaces the structured method set while preserving original creation time, entry kind, and time-zone snapshot.

## Consequences

- Non-primary identities cannot create a second same-day check-in.
- Switching platforms does not create a new learner history.
- `created_at` is a UTC recording instant and never substitutes for `practice_date`.
