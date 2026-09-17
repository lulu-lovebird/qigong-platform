# ADR 0001: Modular Monolith With Separate Process Roles

## Status

Accepted

## Decision

Build one authoritative codebase with clear domain and platform boundaries. Deploy it as separate process roles for public HTTP, admin HTTP, webhook workers, delivery workers, and scheduling.

Do not begin with independently deployed microservices. Domain modules must not depend on provider SDKs; platform adapters translate provider events and messages at the boundary.

## Consequences

- One migration chain and one shared domain implementation.
- Webhook and scheduled work can scale independently from public APIs.
- Process roles need explicit PostgreSQL pool limits and health checks.
- Modules must communicate through typed contracts rather than importing provider-specific internals.
