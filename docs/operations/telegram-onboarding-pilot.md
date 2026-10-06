# Separate Telegram Onboarding Pilot

The new platform accepts `/start` or `/apply` in a **private conversation** with `@qigong_checkin_bot`, a separate Telegram bot. It does not reuse or change the existing Telegram bot or its webhook; the existing LINE and WhatsApp integrations are also unaffected.

## Setup

1. Create a **new** bot in BotFather. Store its token only in `/etc/qigong-platform/api.env` as `TELEGRAM_ONBOARDING_BOT_TOKEN`. Generate a separate random secret (32–256 characters using letters, numbers, `_` or `-`) for `TELEGRAM_ONBOARDING_WEBHOOK_SECRET`. Set `TELEGRAM_ONBOARDING_REGION_CODE=tw-general` for this Taiwan pilot.
2. Apply migration `0007_telegram_onboarding.sql`, deploy the matching API build and verify `/health/ready` before enabling the new bot's webhook. The route is registered only when both token and secret are configured. Never supply the old bot's credentials.
3. Configure the **new** bot's webhook URL as `https://checkin.baiyinqigong.org/telegram/onboarding/webhook` with `secret_token` equal to `TELEGRAM_ONBOARDING_WEBHOOK_SECRET` and `allowed_updates=["message"]`. Use the Telegram API for this step; do not modify the old bot's webhook.
4. Send `/start` in private. The new bot sends a 30-minute, single-use HTTPS form link. Complete the form with learner name, website registration email, international-format phone number (e.g. `+886912345678`) and one of Taiwan, Malaysia, Singapore, Hong Kong, or Other. Only then is the pending application visible in `/admin/` for its chosen region. A repeated `/start` while the link remains valid asks the applicant to reuse the prior link; after expiry they can request a new one.

Applications submitted before migration `0008_verified_onboarding_details.sql` remain pending but cannot be approved without the required details. Those applicants can send `/start` again to obtain the form and complete the existing application.

The webhook checks Telegram's secret header and uses `message.from.id` as the platform subject. An HMAC-derived, single-use link binds the form to the private chat without asking the applicant to enter a Telegram ID; the fragment is removed from browser history and must not be shared. The admin reviews the self-reported name, email and phone against the Baiyan learner database before approval. The secret must remain private. Approval does **not** enable check-ins yet: the unified check-in domain and user-facing flow are later phases. Do not expose the bot token in logs or Git.
