# WhatsApp venue: default-off merge approval

## Scope and result

- Reviewed application commit: `e6a0ca84b038c63c8718e5dfd95441af4bbb92d2`, based on `ab27ee4`.
- Reviewer: `wa-merge-review-4`, a fresh standalone session using `cliproxyapi/gemini-3.8-flash`, distinct from the GPT authoring family according to the configured model IDs.
- **Default-off merge to main: APPROVE.**
- **Production migration, deployment and flag activation: BLOCK.**
- This record adds documentation only; it does not change the reviewed application code. The reviewer performed static inspection, not independent execution of the reported tests.
- Earlier GPT reviews were same-family, context-isolated supplements; failed Gemini requests yielded no review conclusion. They are not counted as additional completed independent reviews.

## Basis reported by the reviewer

The reviewer inspected the Session/CSRF authority, isolated function owners and credential-scoped RLS, lock-only UPDATE(id) grants with restrictive WITH CHECK(FALSE), writer/consent/revocation handling, formal replay and own-history, private fragment return, client text rendering and identity pinning, and server-side default-off/readiness/dispatch boundaries. No merge-blocking exploitable finding was reported for the default-off scope.

Important limits retained by the coordinator:

- Successful facade calls clear the credential hash settings. Errors roll back transaction/savepoint changes and may restore prior caller settings; this is not a guarantee that every exception leaves an empty GUC. Every new facade call overwrites and revalidates its arguments.
- Capability probes check the declared catalog contract; they are not a universal proof against arbitrary privileged database administrator changes.
- Replay is per person/venue/stored venue-local date, not an unconditional cross-midnight deduplication promise. Database behavior, rather than the review prose, is authoritative.
- Neither this static review nor the configured model label establishes unreported runtime tests or production observations.

## Validation evidence

- Node24 all-source/all-test typecheck: `tsc -p tsconfig.eslint.json --noEmit`, passed.
- Node24 `pnpm verify` with a dedicated local PostgreSQL16 cluster and explicit ephemeral-role teardown opt-in, passed: database 801 tests, public-api 4484 tests, config 2 tests, identity 6 tests.
- 27 database and 62 public-api dedicated-runner scenarios were skipped; they are not counted as passed.
- Exact application commit CI: [43867849265](https://github.com/lulu-lovebird/qigong-platform/actions/runs/43867849265), success.
- The pull request's own checks must pass before merge; the application commit CI does not substitute for a later changed head.

## Release gates are unchanged

1. Keep `WHATSAPP_VENUE_CHECKIN_ENABLED` absent/false until separately approved activation. This merge does not modify the production environment, run migrations, or restart services.
2. Confirm the actual production schema before release. Install a validated build compatible with both schema64 and65, with the new feature off, and retain a65-compatible fallback before applying migration65. Do not fall back to an old max64 binary after65 or restore a DB over accepted learner writes.
3. Obtain and verify the operator-approved public business phone for `WHATSAPP_VENUE_PUBLIC_PHONE`. This task has not read or changed production credentials/configuration and does not establish whether such a value already exists.
4. Country-to-channel automatic admin/NFC/QR configuration is unfinished. The TW/MY/SG/HK pure mapping contract and explicit `channel` dispatch do not constitute a persisted authoritative country mapping. Do not infer country from IP, UI language or venue code.
5. Complete the outstanding dedicated-runner/phone/provider acceptance and operational verification required for activation; use isolated learners and venues, not production learner mutations.
6. See [release readiness](whatsapp-venue-release-readiness.md) for the staged evidence and remaining gates.

The repository currently declares only the verification CI workflow; this approval is not permission to add or trigger deployment automation.
