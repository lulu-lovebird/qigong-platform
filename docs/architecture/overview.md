# Architecture Overview

## Goals

- One global domain model for LINE, Telegram, WhatsApp, and the Baiyan website.
- One authoritative PostgreSQL database for new production data.
- Stable existing public platform paths during gradual cutover.
- Reliable webhook ingestion and outbound delivery.
- Region-scoped administration with historical boundaries.
- Privacy-aware authenticated learner sharing.

## Non-Goals for the First Release

- Importing legacy test users, check-ins, or badges.
- Automatic cross-platform account matching.
- Temporary travel time-zone mode.
- Public internet indexing of learner notes.
- Initial multi-region data residency or active-active databases.
- Full microservice decomposition.

## Runtime Roles

| Role | Responsibility |
| --- | --- |
| `public-api` | Website/API sessions, WebApps, provider callback ingress |
| `admin` | OIDC login, scoped administration, reporting requests |
| `webhook-worker` | Claims verified provider events and executes domain commands |
| `delivery-worker` | Sends provider messages with retry and rate limits |
| `scheduler` | Expands reminders, campaigns, reconciliation, and maintenance jobs |

All roles share domain and database packages but have separate process health, pools, and scaling limits.

## Boundary Rule

Provider SDK types stop at platform adapters. Domain services receive normalized identities, commands, and capabilities.

```text
Provider request
  -> platform verification
  -> durable inbox
  -> normalized command
  -> domain transaction
  -> outbound operation
  -> provider delivery adapter
```

## Public Routing

Keep the current path families:

```text
/line/*
/telegram/*
/whatsapp/*
```

Caddy routes paths to the current bot or the unified service by feature flag and environment. Admin, metrics, detailed readiness, audit, and dead-letter interfaces are not exposed through public Funnel routes.

## Source of Truth

- Check-ins are the source of truth for attendance and streaks.
- Materialized summaries are rebuildable caches.
- Badge awards reference immutable rule versions and triggering check-ins.
- Region access uses the check-in's effective assignment, not the learner's current region.
- Platform notification capabilities never define learner identity.
