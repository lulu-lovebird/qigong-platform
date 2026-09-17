# ADR 0004: Temporal Region Scope

## Status

Accepted

## Decision

Regions form `Global -> Country -> Operational Region`. Learner membership is represented by dated assignments. Check-ins reference the region assignment effective on `practice_date`, not the current assignment or assignment at submission time.

A make-up submitted after a transfer remains scoped to the region that owned the learner on the missed practice date. If no assignment covers that date, the write is rejected or requires an audited administrative correction.

After transfer, a destination region administrator cannot view pre-transfer check-ins by default. The source region may view records created during its assignment period. Country and global grants inherit descendant operational regions.

Region transfer requires a request/accept workflow or an authorized override. It never rewrites historical check-in scope.

## Consequences

- Authorization uses temporal assignment, not the learner's current region alone.
- Aggregate, export, cache, and materialized-view access must apply the same scope.
- Travel time-zone changes never alter region membership.
