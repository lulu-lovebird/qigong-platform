# ADR 0008: Reminder Capabilities

## Status

Accepted

## Decision

Store learner reminder preference independently from platform delivery capability and platform-specific consent.

Telegram may provide proactive reminders when the bot remains reachable. LINE reminders depend on plan and quota. WhatsApp reminders require opt-in, approved templates, and may incur cost. Onboarding must disclose these differences.

Switching the primary interaction channel disables the previous channel's reminder delivery but does not automatically enable reminders on the new channel.

## Consequences

- Consent and delivery state are stored per channel identity.
- Reminder delivery uses a durable ledger and idempotent daily key.
- Product UI does not promise identical capabilities across platforms.
