# Permission Model

## Roles

| Role              | Default Scope           | Purpose                                                  |
| ----------------- | ----------------------- | -------------------------------------------------------- |
| `super_admin`     | Global                  | Full platform administration and emergency access        |
| `global_viewer`   | Global                  | Read-only global reporting without private-note access   |
| `country_admin`   | Country descendants     | Country operations and region transfer approval          |
| `regional_admin`  | Operational Region      | Learner operations for the effective region period       |
| `regional_viewer` | Operational Region      | Read-only non-sensitive operational data                 |
| `coach`           | Cohort                  | Assigned learners and explicitly permitted private notes |
| `content_admin`   | Global or content scope | Methods, tags, campaigns, badge content                  |
| `broadcast_admin` | Region/platform scope   | Draft provider messages and campaigns                    |
| `privacy_admin`   | Explicit case scope     | Export, deletion, anonymization requests                 |
| `auditor`         | Global or region scope  | Read-only audit access                                   |

## Actions

```text
learner.read
learner.manage_profile
learner.assign_region
learner.transfer_request
learner.transfer_accept
learner.transfer_override
identity.link
identity.link_override
identity.revoke
interaction_channel.switch
checkin.read
checkin.read_private_note
checkin.correct
stats.read
stats.export
taxonomy.manage
badge.manage
campaign.manage
broadcast.create
broadcast.approve
privacy.export
privacy.delete
audit.read
```

## Historical Visibility

- A region grant exposes only check-ins whose `region_assignment_id` belongs to that region during the record period.
- Destination regions do not inherit pre-transfer records.
- Source regions do not see post-transfer records.
- Country grants inherit descendant operational regions.
- Coach grants depend on dated cohort membership and explicit private-note permission.
- The learner sees all personal history regardless of region changes.

## Private Notes

`checkin.read` does not include note content. Access to private notes requires `checkin.read_private_note` and a matching region/cohort scope. Every private-note detail view is audited.

## Aggregate Privacy

- Region/cohort aggregates are suppressed below a configurable learner threshold; initial recommendation is five.
- Exports require `stats.export` and are audited.
- Combined filters cannot bypass the minimum cohort threshold.
- Supported dimensions and combinations are allowlisted; arbitrary drill-down is not exposed.
- Complementary groups, adjacent time slices, and repeated near-identical queries are subject to anti-differencing controls.
- Sensitive reporting may use rounding, bucketing, and per-principal query budgets.
- Exports enforce the same minimum-group and anti-differencing rules as interactive reports.
- Materialized views and caches carry the same scope and suppression rules as source queries.

## Enforcement Layers

1. OIDC session and CSRF validation.
2. API action and scope authorization.
3. Repository/query scope.
4. PostgreSQL RLS with `FORCE ROW LEVEL SECURITY`.
5. Integration tests for horizontal and temporal access.
6. Audit and alerting.

Admin requests use database transactions and `SET LOCAL` request context. Runtime roles do not own protected tables and do not have `BYPASSRLS`.

## RLS Connection-Pool Contract

- Missing principal or scope context denies access; it never grants global access.
- Every protected query runs inside an explicit transaction.
- `SET LOCAL` values come only from the authenticated server session, never client-supplied principal or scope IDs.
- Pool tests prove that context does not survive commit, rollback, timeout, or error.
- Background workers use separate least-privilege roles and explicit job scope.
- Security-definer functions and materialized views require dedicated security review and tests.
