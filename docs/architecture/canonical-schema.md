# Canonical Schema Contract

This is a logical contract, not an executable migration. Physical types, enum strategy, indexes, RLS functions, partitioning, and schema names are finalized in the next implementation phase.

## Identity

### `people`

```text
id UUID PK
website_subject TEXT UNIQUE NOT NULL
membership_id TEXT UNIQUE NULL
legal_name TEXT NOT NULL
preferred_name TEXT NULL
public_nickname TEXT NULL
preferred_locale TEXT NOT NULL
practice_timezone TEXT NOT NULL
reminder_timezone TEXT NOT NULL
membership_status TEXT NOT NULL
status TEXT NOT NULL
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
anonymized_at TIMESTAMPTZ NULL
```

`website_subject` is the immutable OIDC `sub`. Email is mutable metadata and is not an identity key.

### `platform_identities`

```text
id UUID PK
person_id UUID FK people NOT NULL
platform TEXT NOT NULL
external_subject_id TEXT NOT NULL
display_name TEXT NULL
username TEXT NULL
provider_locale TEXT NULL
verified_at TIMESTAMPTZ NOT NULL
revoked_at TIMESTAMPTZ NULL
last_inbound_at TIMESTAMPTZ NULL
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL

UNIQUE(platform, external_subject_id)
```

### `person_interaction_channels`

```text
id UUID PK
person_id UUID FK people NOT NULL
platform_identity_id UUID FK platform_identities NOT NULL
valid_from TIMESTAMPTZ NOT NULL
valid_to TIMESTAMPTZ NULL
activation_source TEXT NOT NULL
activated_by_principal_id UUID NULL
created_at TIMESTAMPTZ NOT NULL
```

Constraints:

- Composite ownership FK ensures `(platform_identity_id, person_id)` references an identity belonging to that person.
- `valid_to IS NULL OR valid_to > valid_from`.
- Exclusion constraint prevents overlapping half-open effective ranges for one person.
- Partial unique constraint permits only one open-ended row per person.

## Geography and Cohorts

### `regions`

```text
id UUID PK
parent_region_id UUID FK regions NULL
code TEXT UNIQUE NOT NULL
region_type TEXT NOT NULL -- global, country, operational
name_zh_tw TEXT NOT NULL
name_zh_cn TEXT NULL
name_en TEXT NOT NULL
default_timezone TEXT NULL
active BOOLEAN NOT NULL
```

### `person_region_assignments`

```text
id UUID PK
person_id UUID FK people NOT NULL
region_id UUID FK regions NOT NULL
assignment_type TEXT NOT NULL -- primary, secondary, program
valid_from DATE NOT NULL
valid_to DATE NULL
assigned_by_principal_id UUID NULL
transfer_request_id UUID NULL
created_at TIMESTAMPTZ NOT NULL
```

The database must prevent overlapping primary operational assignments for one person. Effective date ranges are half-open and validated.

### `cohorts` and `cohort_memberships`

Cohorts are explicit instructional groups. Coach access is granted to cohorts and does not imply region-wide access.

## Practice Taxonomy

### `practice_methods`

```text
id UUID PK
code TEXT UNIQUE NOT NULL
parent_id UUID FK practice_methods NULL
method_type TEXT NOT NULL -- group, leaf
name_zh_tw TEXT NOT NULL
name_zh_cn TEXT NULL
name_en TEXT NOT NULL
sort_order INTEGER NOT NULL
active BOOLEAN NOT NULL
effective_from DATE NULL
effective_to DATE NULL
```

### `practice_method_platforms`

```text
practice_method_id UUID FK practice_methods
platform TEXT
available BOOLEAN NOT NULL
PRIMARY KEY(practice_method_id, platform)
```

New check-ins store active leaf methods only. Inactive methods remain available to historical reads.

## Check-Ins

### `checkins`

```text
id UUID PK
person_id UUID FK people NOT NULL
submitted_via_identity_id UUID FK platform_identities NOT NULL
practice_date DATE NOT NULL
practice_timezone TEXT NOT NULL
timezone_inferred BOOLEAN NOT NULL
entry_kind TEXT NOT NULL -- regular, makeup, admin_correction
source_platform TEXT NOT NULL
practice_note TEXT NULL
sharing_visibility TEXT NOT NULL -- private, all_learners
display_name_mode TEXT NOT NULL -- real_name, nickname
region_assignment_id UUID FK person_region_assignments NOT NULL
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL

UNIQUE(person_id, practice_date)
```

Writes verify that `submitted_via_identity_id` is the person's active interaction channel unless the actor is an authorized administrator performing a correction.

`region_assignment_id` must belong to the same person and cover `practice_date`. A make-up never silently uses the learner's current region when the missed date belongs to a prior assignment.

### `checkin_method_selections`

```text
checkin_id UUID FK checkins ON DELETE CASCADE
practice_method_id UUID FK practice_methods
PRIMARY KEY(checkin_id, practice_method_id)
```

An edit atomically replaces selections.

## Learner Sharing

### `practice_posts`

```text
id UUID PK
source_checkin_id UUID FK checkins NOT NULL
person_id UUID FK people NOT NULL
content TEXT NOT NULL
visibility TEXT NOT NULL -- authenticated_learners
display_name_mode TEXT NOT NULL
display_name_snapshot TEXT NOT NULL
consent_version TEXT NOT NULL
consent_at TIMESTAMPTZ NOT NULL
moderation_status TEXT NOT NULL
published_at TIMESTAMPTZ NOT NULL
unpublished_at TIMESTAMPTZ NULL
updated_at TIMESTAMPTZ NOT NULL
```

The post person must equal the source check-in person. Only authenticated people with current active membership can read posts, and only records with active publication and approved moderation state are visible. No anonymous public route returns post content. Unpublishing removes the item from feeds, search indexes, and caches without deleting the private check-in.

## Badge and Campaign Rules

### `campaigns`

Stores immutable campaign versions, `Asia/Taipei` official calendar dates, and rule metadata.

### `badge_definitions`, `badge_rule_versions`, `person_badges`

```text
person_badges
- person_id
- badge_definition_id
- rule_version_id
- earned_year
- trigger_checkin_id
- unlocked_at

UNIQUE(person_id, badge_definition_id, rule_version_id, earned_year)
```

Badge criteria snapshot required method codes. Taxonomy changes do not mutate existing rule versions.

## Reminder and Delivery

### `reminder_preferences`

Person-level desired schedule and timezone.

### `channel_notification_subscriptions`

Platform-specific consent, eligibility, template requirements, disabled reason, and capability state.

### `reminder_deliveries`

Durable daily delivery records with attempts, provider ID, retry time, and status.

## Operations

### `webhook_events`

Provider-scoped dedupe key, immutable payload, claim lease, attempts, retry time, processing and dead-letter timestamps.

### `outbound_operations` and `outbound_deliveries`

Application idempotency keys are separate from provider delivery IDs and statuses.

## Administration and Audit

### `admin_principals`

OIDC identity, status, last login, and break-glass metadata.

### `roles`, `permissions`, `admin_role_grants`

Grants include scope type, scope ID, valid period, grantor, and reason.

### `audit_events`

```text
id UUID PK
occurred_at TIMESTAMPTZ NOT NULL
request_id TEXT NOT NULL
actor_principal_id UUID NULL
actor_person_id UUID NULL
action TEXT NOT NULL
target_type TEXT NOT NULL
target_id TEXT NULL
scope_type TEXT NULL
scope_id UUID NULL
reason TEXT NULL
before_data JSONB NULL
after_data JSONB NULL
outcome TEXT NOT NULL
metadata JSONB NOT NULL
```

Audit records minimize copied sensitive data. Action-specific allowlists prevent private notes, provider tokens, raw webhook payloads, and unnecessary direct identifiers from being copied into `before_data`, `after_data`, or metadata. Sensitive values are masked or represented by irreversible references. Audit retention is managed separately from domain-data retention.

## Anonymization and Re-Registration

An anonymized person cannot retain plain OIDC `sub`, membership ID, legal name, email, or provider IDs. Before executable migrations are approved, product and privacy owners must choose one policy:

- allow re-registration by removing active identity mappings and retaining only a non-identifying deletion tombstone; or
- block re-registration only when legally justified, using a separately protected keyed token with documented purpose, access, and retention.
