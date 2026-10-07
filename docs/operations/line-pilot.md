# LINE Pilot (new platform)

The new platform uses a **separate** LINE Official Account and Messaging API channel. Do not reuse or modify the existing LINE bot's webhook, channel secret, access token, or LIFF app.

## Configuration and learner flow

Configure one LIFF app in a LINE Login channel linked to the new Official Account. Set its endpoint URL to `https://checkin.baiyinqigong.org/line/` and enable the `openid` scope (ID token required). `LINE_LOGIN_CHANNEL_ID` is the Login channel ID, not the distinct Messaging API channel ID. The Messaging API webhook URL is `https://checkin.baiyinqigong.org/line/webhook`.

Keep webhook delivery disabled until the matching API/worker build, migrations, credentials and real-account acceptance checks are ready. `/line/` serves an SDK-initializing check-in entry; `/line/apply` and `/line/checkin` are child pages. The server does not redirect arbitrary `liff.state` input. The SDK's primary/secondary redirects must be verified on real devices with the configured endpoint. Application pages capture the link fragment and login redirect URL before SDK initialization, and clear the URL only after obtaining an ID token.

Store `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_LOGIN_CHANNEL_ID`, and `LINE_LIFF_ID` privately in `/etc/qigong-platform/api.env`, restricted to the API service account. All four are required to enable LINE routes; partial configuration fails startup. Store `LINE_CHANNEL_ACCESS_TOKEN` separately in `/etc/qigong-platform/notification-worker.env`, restricted to the worker. Never put real credentials in repository files or logs. Resume the API and notification timer only after the reviewed transition below; the worker is `Type=oneshot`, and stopping its timer does not stop an already active worker.

Learners message「加入」to obtain a 30-minute application link and provide name, website email, international phone and region for review.「打卡」opens the LIFF check-in page. The API verifies the LIFF ID token with LINE; the webhook verifies the raw-body signature.

**Policy A is selected:** approval creates an independent learner and a LINE primary channel, even when personal details match another platform's or region's learner. Personal details never authorize automatic association. Existing learners' identities, assignments and channels remain unchanged. Merging, ownership-verified linking and channel switching are not implemented here; see [ADR 0002](../adr/0002-identity-and-primary-channel.md).

The database enforces one check-in per **person record** and practice date. The same real person can have separate platform records under A, so this is not cross-record real-human deduplication. Do not present a second application as a channel-transfer or history-sharing feature. Existing multi-identity records remain intact and can check in only through their active primary identity.

## Local verification without LINE credentials

Use Node.js 24, pnpm 10 and a disposable PostgreSQL 16 database. `TEST_DATABASE_URL` must point only to an isolated local database with `test` in its name; suites create/drop databases and roles. Never use production. Run `pnpm verify` with this variable set; absent it, database tests skip and do not establish integration readiness.

- `apps/public-api/tests/line-security.test.ts`: entry/child routes, privacy headers, raw-body signatures, empty Console events, malformed events, Origin rejection, invalid/expired/wrong-audience ID tokens and upstream verification failures. External requests are mocked.
- `apps/public-api/tests/line-onboarding.test.ts`: restricted-role onboarding/check-in, expired/stolen/consumed links, replayed joins, pending denial, deadline/method validation, separate people for matching details, cross-region isolation, both concurrent review orders and duplicate-review prevention.
- `apps/public-api/tests/learner-pages.test.ts`: generated scripts with stubbed DOM/LIFF, initialization gating, login fragment retention, failures, LINE payloads and Telegram regression. These are not browser/real-SDK tests.
- `packages/database/tests/repository-migrations.test.ts`: complete migration chain/idempotency and `0013` to `0014` upgrade preserving existing associated records and historical checksums. This is **not** a production backup/restore rehearsal.

Replay tests prove application/link consistency, **not durable webhook deduplication**. Redelivery may reply again or refresh an unconsumed join link's expiry. Do not claim exactly-once delivery.

## Pre-deployment gates — separate approval still required

This preparation checklist is not a tested automated deployment/restore procedure. **No-go until every gate has an owner and evidence.** Policy selection alone does not approve production deployment.

- Ensure the approved A implementation and tests are present. The current final migration is `0017_admin_reporting.sql` (`0014` enforces A; `0015` adds languages; `0016` adds WhatsApp). Preserve the complete chain and never serve the current pilot API at an intermediate version. See [admin dashboard](admin-dashboard.md), [channel languages](channel-locales.md) and [WhatsApp pilot](whatsapp-pilot.md).
- Record a reviewed release identifier, complete artifacts/checksums, Node version, API range (`0017` only), worker version, operator, maintenance window and acceptance criteria. Preserve the previous artifact and protected configuration without logging/copying secrets into the repository.
- Verify private LINE configuration and the matching worker sender before accepting approvals.
- Inspect the actual ledger, historical checksums and running versions without printing secrets. The handoff reports production at `0012`; this work has not rechecked production.
- Rehearse the transition and restoration on an isolated PostgreSQL 16 copy, including roles/grants, notification queue and Telegram regression. Record restoration duration, operator and permitted data-loss window; local tests do not satisfy this gate.
- Choose a strategy consistent with the [schema compatibility contract](../architecture/schema-compatibility.md). Old `0012` and new `0017` API ranges do not overlap. `0013` removes a uniqueness constraint and changes approval behavior; `0014` replaces that behavior. Backwards compatibility is not established. Either implement/test a compatibility release first or approve an explicit rehearsed maintenance-window exception. No rolling/no-downtime release is currently demonstrated.

### Proposed maintenance-window sequence (approval/rehearsal required)

1. Keep the new LINE webhook disabled. Put the new platform's public API, administrator reviews and learner writes into reviewed maintenance mode. Pause the notification timer and drain/stop any active oneshot worker. Do not alter legacy bots; account for new-platform Telegram webhook retries.
2. Once writers/workers are quiescent, take a fresh restricted backup and record timestamp/checksum. Preserve cluster roles and protected systemd/Caddy/environment configuration separately; `pg_dump` does not include them. Validate by isolated restoration before proceeding.
3. Stage the complete matching API/worker artifact and private configuration while the old API is stopped. Apply the complete chain through **`0013`–`0017`** using the existing migration runner and proper migration role. It uses a transaction per migration, not a single transaction for the entire chain. Inspect the ledger on failure: an earlier migration can be committed even if a later file fails. Never start the current pilot API before `0017`.
4. Start the new API without general traffic/reviews. Check readiness at `0017`, runtime-role preflight and smoke tests. Keep the timer paused until the schema, artifact and sender are verified. Record only non-sensitive results.
5. Conduct controlled real-account acceptance below, then resume regular traffic/reviews and the timer according to the approved window. Check pending notifications and Telegram operation. The legacy LINE bot remains untouched.

### Failure boundaries

| State                                         | Next step                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Before `0013` commits                         | Keep writes paused; inspect the ledger and verify rollback. Return to the old artifact/configuration only if the database is still compatible with `0012`.                                                                                                                                       |
| Any of `0013`–`0016` committed, before `0017` | Neither the old `0012` nor current `0017` API is compatible. Stay in maintenance; forward-fix to complete the chain or use a separately approved pre-upgrade restoration.                                                                                                                        |
| `0017` committed, before new writes           | Prefer a reviewed forward fix. Otherwise use the separately approved pre-upgrade restoration procedure. Switching only the API binary back fails readiness.                                                                                                                                      |
| Traffic/reviews/notifications resumed         | Stop new writes/workers and preserve the failed state/logs securely. Prefer forward repair. Restoration can lose check-ins, approvals and queue changes; already delivered messages cannot be undone and may be redelivered. Obtain explicit reconciliation/data-loss approval before restoring. |
| Ledger or backup state uncertain              | Stay in maintenance and escalate. Do not delete ledger rows, edit checksums or invent a down-migration.                                                                                                                                                                                          |

`0014` does not split previously associated people or reintroduce the removed `person_id` uniqueness constraint. Remediation of existing associations, if any, requires an independent ownership/data review rather than destructive automated splitting.

## Real-account acceptance (still pending)

1. Confirm the new Official Account and linked Messaging/Login channels are under the appropriate provider, with correct `openid` scope and LIFF endpoint. Leave the old bot unchanged.
2. Complete the approved/rehearsed transition above. Verify `/health/ready` at `0017` and the matching worker/configuration before acceptance.
3. Use Console Verify for signed empty events. Enable the new webhook only during the controlled pilot after deployment checks pass.
4. Test `/line/`, direct apply/check-in links, primary/secondary redirects, external-browser login and LINE in-app browsers on supported phones. Confirm application fragments survive login and are cleared after authentication; never log tokens or personal details.
5. Exercise join, pending denial, approval/rejection, notifications, check-in/history, duplicate-date rejection and makeup/correction deadlines. Matching another learner's personal details must create a separate record, not attach to that learner.
6. Confirm existing records and Telegram behavior remain intact. For any existing multi-identity record, only its active primary identity may check in; do not simulate switching by a new application. If acceptance fails, disable the new webhook and stop the pilot. Restoring schema/data needs the separately approved procedure above, not just the old binary.

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。

Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
