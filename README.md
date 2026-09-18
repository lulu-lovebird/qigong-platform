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
- Website membership and authentication will integrate through OpenID Connect / OAuth 2.0. Passwords are not copied into this platform.
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

Phase 2: OIDC, identity, region, and authorization foundation. No production traffic is routed to this repository yet.

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

Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
