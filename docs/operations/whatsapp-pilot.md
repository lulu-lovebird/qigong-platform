# WhatsApp Cloud API pilot — new platform only

## Status and boundaries

The local adapter uses **Meta WhatsApp Cloud API**, not a third-party provider or WhatsApp Web automation. Application/review/check-in/history/makeup/correction and Traditional Chinese/English interfaces have mock-provider and isolated PostgreSQL 16 coverage. It is **not deployed or real-account verified**. No real credentials, business account, phone number or approved template have been provisioned by this work.

Use a dedicated new WhatsApp Business Account, phone number and preferably separate Meta app. Never reuse/change the legacy bot's phone, subscriptions, secrets or webhook. Approval follows [policy A](../adr/0002-identity-and-primary-channel.md): creates a new learner, never associates by name/email/phone. One real person may consequently have distinct platform records; no merging/channel-transfer flow is implemented.

## Private configuration

Configure these names in the restricted API environment, never in Git, chat, shell history or logs:

| Name                           | Purpose                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `WHATSAPP_PHONE_NUMBER_ID`     | New Cloud API phone-number ID, not the phone's literal number.                                                 |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | New WABA ID; incoming signed payloads must match this and the phone-number ID.                                 |
| `WHATSAPP_ACCESS_TOKEN`        | Appropriate Meta system-user/access token with the required permissions and account assignment.                |
| `WHATSAPP_GRAPH_VERSION`       | Explicit supported Graph API version, such as the version selected in the Meta app; no assumed latest version. |
| `WHATSAPP_APP_SECRET`          | New Meta app secret for raw-body `x-hub-signature-256` verification.                                           |
| `WHATSAPP_VERIFY_TOKEN`        | Operator-generated callback-verification secret, separate from the access token/app secret.                    |

All six are required together; absent all, WhatsApp routes stay disabled. Partial configuration fails startup. The current API's migration range is **`0017` only** (the subsequent [admin dashboard](admin-dashboard.md) adds read-only reporting), regardless of which adapters are enabled.

The restricted worker environment needs `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_GRAPH_VERSION`, plus:

- `WHATSAPP_APPROVED_TEMPLATE`: approved template name for approval.
- `WHATSAPP_REJECTED_TEMPLATE`: approved template name for rejection.
- `WHATSAPP_TEMPLATE_LANGUAGE_EN`: the exact approved English template locale (`en`, `en_US`, etc.). Chinese locale is `zh_TW` and also requires an approved variant.

The two template names must have both language variants and **no required body/header/button parameters**, matching the implemented payload. Their content should identify the platform/operator, explain the result, and invite the learner to reply `checkin` or contact the regional administrator. Do not include sensitive personal details. Meta approval, account verification/registration, supported API version, sending limits and pricing must be checked in the current Meta console before rollout. The worker currently still requires its existing Telegram token; it is not a standalone WhatsApp-only worker.

## Endpoints and commands

- Callback verification and message delivery: `https://checkin.baiyinqigong.org/whatsapp/webhook` (GET challenge / POST signed raw JSON).
- Browser pages: `/whatsapp/apply`, `/whatsapp/checkin`; API POST endpoints under `/whatsapp/onboarding/apply`, `/whatsapp/checkin/{methods,history,submit,correct}`, `/whatsapp/preferences/language`.
- Subscribe the new app to the new WABA's `messages` events only after approved deployment/configuration checks. Verification GET logging is suppressed because Meta puts the verification secret in the URL; ensure upstream proxy/access logs also redact or omit this query string.
- `join`, `start`, `加入`, `申請`: application/status. `checkin`, `打卡`: practice link. `language en` / `language zh_TW`: saved language. `STOP` / `停止通知`: withdraw decision-notification consent.

Only signed/configured-account messages determine the WhatsApp subject. Applications use 30-minute links; practice links last 15 minutes. Tokens are stored hashed, delivered privately and carried as browser fragments, not literal phone numbers/identity claims. Browser requests enforce same-origin JSON and resolve the subject from the token. Application links are single-use; practice operations revalidate approval, person/identity status, primary channel, practice date and methods in the database.

The application requires an **unchecked-by-default** explicit checkbox consenting to WhatsApp decision messages. Consent and language are recorded transactionally when a valid application is submitted. STOP records withdrawal. The worker checks consent before calling the template sender; without it the queue item follows the existing failed-send retry/capped-failure path and no template is sent. Sending a new `join` does not silently re-enable consent. Re-consent for an already submitted application is not implemented; learners can query status without proactive notifications. Consent withdrawal cannot retract messages already accepted by Meta, and a send/withdrawal race may leave an in-flight message.

## Delivery semantics and known limitations

- Signature-verified message IDs, subject and canonical message hash are stored in a forced-RLS inbox. Matching replays, including concurrent deliveries and process restarts, do not repeat committed domain operations/replies. Reusing an ID for a different subject/body fails closed and requires operator review.
- Inbox marker, domain changes and the synchronous bot reply share one transaction. A send failure rolls back so Meta can retry. **Not exactly-once:** a provider acceptance followed by a timeout/commit failure can result in a duplicate reply. Outbound I/O holds a database transaction; production latency/load behavior is not benchmarked. There is no durable asynchronous bot-reply outbox yet.
- Free-text replies are limited to inbound messages younger than 24 hours (with a small future-clock tolerance). Delayed/stale messages are acknowledged without a free-text reply; the learner may need to send a new command. Decisions always use approved templates, including after the service window closes.
- HTTP success is accepted only with a provider message ID. Existing notification status `delivered` means **API accepted**, not confirmed device delivery/read. Status callbacks are currently acknowledged but not persisted for reconciliation; do not claim receipt tracking.
- Non-text messages/unsupported commands are acknowledged without interaction. Supported-phone/browser behavior, throughput, rate limiting and provider retry characteristics need real pilot verification.
- Inbox IDs/subjects and consent timestamps need a reviewed retention/erasure policy before wider use; cleanup jobs are not implemented. Do not remove dedup markers casually within a possible redelivery window.

## Verification and release gates

Run `pnpm verify` under Node 24/pnpm 10 with an isolated PostgreSQL 16 `TEST_DATABASE_URL` whose database name contains `test`. `whatsapp-onboarding.test.ts`, `whatsapp-client.test.ts`, learner-page tests and the shared migration suite cover mocked signature/configuration, account isolation, English preference, consent/withdrawal, transactional retries/dedup, policy A, deadlines, expiry and localized templates. Passing these does not authorize production deployment or prove real Meta delivery.

Before deployment:

1. Review/commit the complete artifact, preserved historical migrations and full `0001`–`0017` chain; record API/worker version and checksums. Do not stop at `0013`, `0014`, `0015` or `0016` with the current API.
2. Rehearse upgrade/restore and Telegram/LINE regression in isolation, including protected configuration, roles and notification queue. Obtain approval for a tested compatibility release or maintenance-window exception; the reported old `0012` API and new `0017` API have no compatibility overlap.
3. During an approved transition, pause writes/reviews, the notification timer and any active oneshot worker; preserve a verified backup. Migrations commit per file, so failures can leave an intermediate version. Keep services in maintenance until the exact `0017` ledger/readiness is verified; do not simply switch an incompatible old binary back. See [LINE release failure boundaries](line-pilot.md).
4. Provision the new Meta account/phone/app and both approved template languages privately. Check callback challenge/signature/account matching and proxy-log redaction. Keep legacy subscriptions unchanged.
5. Run controlled real-account/device acceptance in both languages: join, consent, pending denial, approval/rejection, templates outside the service window, STOP, check-in/history, duplicates/deadlines/corrections, expired links and webhook retries. Verify API acceptance against actual provider delivery separately.
6. Confirm Telegram English/Chinese and LINE Traditional Chinese still work. Stop the new pilot on failed acceptance; any schema/data restoration and lost-write/message reconciliation require separate approval.

本專案由 **Bean, Bird & Badminton Tech Consulting** 開發並維護。

Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
