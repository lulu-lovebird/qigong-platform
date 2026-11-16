# Historical WhatsApp venue SQL candidates

These files preserve the read-only Session and writer candidates used during staged local security review. They are **not deployment entry points** and must not be manually reapplied to a migrated database.

The current executable authority is `migrations/0065_whatsapp_venue_authority.sql`. It incorporates the candidate bodies and adds own-history authority. Its checksum and the normal migration ledger govern application. Tests now exercise the full migration chain rather than replay these files.

Use the normal migration runner only after the documented release gates are approved. Do not replace or alter a published migration, bypass role-collision checks, drop existing roles, or apply candidates to production. See `docs/operations/whatsapp-venue-release-readiness.md`.
