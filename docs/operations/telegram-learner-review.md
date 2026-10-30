# Telegram learner review — unreleased schema59, default OFF

This is a local implementation/runbook, **not a deployment record**. No production migration, environment change, Bot request or human delivery acceptance is claimed. Existing [count-only notifications](review-notifications.md) and WebAdmin permissions remain unchanged.

## Eligibility and data

Detailed notices and two-step chat decisions require all of:

- A currently **active global `super_admin`** under the exact `0019 admin.is_super_admin()` role-code/scope/grant-time semantics. Regional/master/other reviewer permissions alone are insufficient. No hardcoded person or identity inference.
- The administrator's two-sided confirmed private Telegram binding, learner count subscription, and separate explicit `telegram-learner-review-v1` opt-in for the current preference revision.
- A complete pending application with its own exact `telegram_review_notice_version='telegram-learner-review-v1'`, recorded by the verified LINE/Telegram/WhatsApp submission wrapper. Historical/undisclosed applications are never backfilled into this lane.
- Current application snapshot, binding/revision, original bot/private message, hashed unpredictable token, stage and expiry checks. Tokens last at most 24 hours, rotate between stages and contain no applicant data; callback data stays under Telegram's 64-byte limit.

Every claim/payload/action/reason/prompt eligibility check rechecks the current super role. The final action rechecks it immediately before the unchanged `identity.decide_application`; ordinary preference/review/application locks protect business decision/idempotence. There are **no new permission catalog table locks, epochs, mutation triggers or advisory protocols**, and no promise of permission-clock atomicity during concurrent role changes/network delivery.

Removing the role or suspending the principal denies actions while off/inactive. **An old unexpired, unused token may work again after a real role regrant/reactivation**, if the same binding, preference revision, pending application and all other state remain intact. This is intentional current-super behavior, not permanent revocation. Preference opt-out, disconnect/rebind or saving a new revision invalidates old actions independently.

Notices label the name/phone/email as self-reported; provider nickname is not captured/available. Source IDs identify the verified source channel, not a chosen LINE handle, legal name or another platform account. Telegram cloud chats are not Secret Chats/end-to-end encrypted. Already delivered/forwarded data cannot be recalled. Never log reply text, payloads, credentials, raw tokens or callback data.

The application notice ACK is a protocol acknowledgement, **not proof of reading or legal consent**. Canonical privacy v1/hash/publication and acceptance records are unchanged. Legal/localization review remains required before release.

## Two independent flags

| Setting                           | Default | Effect                                                                                                                  |
| --------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `REVIEW_NOTIFICATIONS_ENABLED`    | `false` | Existing worker count/admin/test lane; when false, the whole reviewer delivery job is absent.                           |
| `TELEGRAM_LEARNER_REVIEW_ENABLED` | `false` | New direct lane plus API opt-in/callback/reason gates. Direct worker delivery also requires the existing reviewer flag. |

Both accept **only** literal `true`/`false`; invalid strings fail startup configuration. API startup parses the supplied environment once and passes the boolean through app/admin/webhook wiring. The worker parses its explicit source separately; handlers do not consult hidden `process.env` fallbacks. Operator changes must keep all API replicas and the matching worker consistent.

When direct review is OFF:

- New direct opt-ins receive API403; non-super opt-ins also fail API403 and DB42501 independently when enabled. Existing ordinary count preferences can still be saved.
- Direct callbacks are safely acknowledged unavailable without action SQL, PII edits or decisions.
- Only authentic private replies to this bot are considered. A narrow `platform.telegram_learner_review_owned_prompt(subject,message_id)` boolean lookup identifies exact owned prompts; it receives **no reply text**. Ownership tombstones survive closure, expiry, reset and repeated replies. Owned replies are consumed without reason/journal/onboarding capture. Unrelated replies/conversations and slash/help/privacy commands retain existing routing. Lookup errors fail the webhook closed rather than capturing text.
- The actual worker does not claim, obtain direct payloads or send direct notices. Existing direct-enabled preferences need not be silently cleared to preserve unsent legacy counts.

### Count routing proof and limits

The matching schema59 worker calls `ops.queue_review_notifications_for_mode(limit,direct)` and sets transaction-local `qigong.telegram_learner_review_enabled` for **every** count claim/payload/finish query. Absence is not TRUE. This is routing only, not an authorization capability: `review_delivery_eligible_58` and all existing count permission checks remain authoritative.

Enabled mode suppresses only receipted direct-eligible super-admin learner applications. Paused mode recovers eligible unsent direct-suppressed `cancelled` count rows at the same preference revision, without resetting retry budgets, changing preferences or broadening legacy permissions. A successfully acknowledged direct notice for that same event/reviewer/revision remains excluded to avoid a second count notice. Undisclosed applications and non-super subscribers retain counts. Original legacy queue/claim/payload/finish definitions, owners and ACLs are preserved.

Real isolated PG17 nonowner API/worker tests cover pre-existing direct consent plus receipted pending applications, previously suppressed count rows, no direct SQL/state changes while paused, one recovered count, no duplicate for a sent direct notice, and retry without another count. Delivery is still not exactly-once: ambiguous network acceptance/acknowledgement loss and in-flight sends cannot be recalled.

## Pause and off → on procedure (requires separate operational approval)

1. Keep the matching schema59 code/database. Set `TELEGRAM_LEARNER_REVIEW_ENABLED=false` consistently on all API replicas and the worker. Keep `REVIEW_NOTIFICATIONS_ENABLED=true` if normal counts should continue. Do not overwrite unrelated environment settings.
2. Stop/drain old enabled processes and in-flight jobs before calling the pause complete. A previously started process keeps its startup config, and an already accepted Telegram send cannot be recalled. Verify readiness, flag propagation, count-only delivery and callback/reason refusal with synthetic data in an isolated environment first.
3. A pause is **not token deletion or permanent revocation**. Before re-enabling, as the actual migration/object owner only, explicitly run in an approved transaction:

   ```sql
   BEGIN;
   SELECT ops.invalidate_telegram_learner_reviews();
   COMMIT;
   ```

   This cancels open attempts, clears their token/reason/lease/prompt state, disables detailed consent and increments each previously opted-in preference revision. Ownership tombstones intentionally remain. Neither API nor worker runtime has EXECUTE on this maintenance function. Local owner/ACL tests do not attest production owners; inspect actual root owners/role membership/search paths before any authorized operation. Never grant maintenance access to runtimes.

4. Verify no open usable old attempts or detailed opt-ins remain, then enable the same flag consistently and require each current super admin to opt in again. No automatic re-consent, role grants, source identity linking or historical receipt backfill. Fresh opt-in/revision can requeue still-pending eligible events under existing semantics; inspect counts/leases and reconcile prior delivered notices before resuming.
5. Without the explicit reset, simply re-enabling can revive still-valid delivered tokens. The application does not enforce that this manual owner procedure occurred; do not call an environment toggle permanent revocation.

The primitive was exercised on synthetic isolated schema59 data, not production. No irreversible database rollback or deployment automation is supplied.

## Compatibility and remaining release checks

- `0059_telegram_learner_review.sql` is unreleased and must precede this new application form/protocol. Migrations0001–0058 remain byte-for-byte unchanged. Old submit signatures remain available but never mint the new app receipt.
- Use the **matching schema59 direct-OFF build** as the feature pause path. A schema58 binary is not a valid schema59 fallback; do not down-migrate, remove receipt columns or restore an old binary onto this database. Schema58 legacy capability detection in the worker is not a schema59 rollback claim.
- The API/worker compiled default-off path and same59 readiness are tested locally; no deployed artifact, production owner verification, PG16 CI or live Telegram physical acceptance is claimed.
- Existing business decisions/audit/applicant-result outbox remain authoritative. Concurrent reviewers/WebAdmin produce one business decision; post-commit Telegram edit/answer failure never rolls back or redecides it.
- Before release: parent integration/full verification, standalone different-family final actual-diff security review, PG16 CI, privacy/legal/localization approval, and human private Telegram approve/deny/cancel/custom-reason/replay/expiry UAT.
- Live Bot `allowed_updates` and current webhook settings have **not** been inspected. A future separately approved `setWebhook` must preserve every actual setting/update class and include required `message`/`callback_query` handling; never replace the live list with an assumed initial `[message]` configuration.

Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
