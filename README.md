# Qigong Platform

Unified global platform for qigong check-ins across LINE, Telegram, and WhatsApp.

This repository is the future authoritative home for the shared domain, database schema, platform adapters, workers, and region-scoped administration. The existing platform-specific repositories remain production systems until explicit cutover gates are met.

## Confirmed Product Decisions

- The global platform starts with new production data. Existing LINE, Telegram, and WhatsApp test data is not imported.
- A learner may verify multiple messaging identities, but exactly one active primary interaction channel accepts check-ins at a time.
- Canonical check-ins are unique per learner and practice date.
- Practice and reminder time zones are separate settings.
- Yesterday can be made up before 12:00 in the learner's practice time zone on every supported platform.
- Regions follow `Global -> Country -> Operational Region`.
- A destination region administrator cannot see a learner's pre-transfer history by default.
- Sanfu and Sanjiu campaigns use the official Asia/Taipei calendar.
- Practice notes may be shared with authenticated Baiyan Qigong learners. Learners can opt out of sharing; coaches and specifically authorized administrators can still access private notes.
- Shared notes default to the learner's real name, with an option to use a public nickname.
- Learners joining through LINE, Telegram, or WhatsApp enter a regional pending-review queue. Only approved learners can check in; rejection requires a reason.
- Approved messaging learners initially see every active method available on their platform. Regional administrators can record course enrollments and adjust individual method visibility; visibility is not proof of course completion or permission for AI to recommend a method.
- Administrator login will use Authgear Cloud via OpenID Connect; this platform alone controls administrator provisioning, scoped roles, and learner approval. The Baiyan membership database contains learner accounts and course history, not administrator accounts. Learner membership integration details remain open; passwords are not copied into this platform.
- Initial travel behavior only detects a time-zone difference and offers a manual permanent change. Temporary travel mode is deferred.

## Documents

- [Architecture Overview](docs/architecture/overview.md)
- [Canonical Schema](docs/architecture/canonical-schema.md)
- [Permission Model](docs/architecture/permission-model.md)
- [Delivery Roadmap](docs/architecture/roadmap.md)
- [Go/No-Go Gates](docs/architecture/go-no-go-gates.md)
- [Schema Compatibility Contract](docs/architecture/schema-compatibility.md)
- [Architecture Decision Records](docs/adr/README.md)

## Current Phase

Phase 2: identity, region, authorization, and messaging onboarding foundation. Authgear administrator OIDC login, database-backed sessions, and regional application-review APIs are implemented. The admin UI, account-provisioning workflow, provider adapters, and learner check-in flow are pending. No production traffic is routed to this repository yet.

## Development Baseline

- Node.js 24 LTS
- pnpm 10 workspaces
- TypeScript with strict checking
- Fastify 5
- PostgreSQL 16
- Vitest, ESLint, and Prettier

```bash
pnpm install
cp .env.example .env
pnpm --filter @qigong/database migrate
pnpm verify
pnpm dev
```

Health endpoints:

```text
GET /health/live
GET /health/ready
```

Readiness fails when PostgreSQL is unavailable or the migration ledger is not at the expected version.

## 專案署名

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。

Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
