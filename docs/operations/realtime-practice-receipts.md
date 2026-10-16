# Near-real-time LINE / Telegram practice receipts

## Status and diagnosed cause

Deployed and explicitly enabled after separate user approval: **`6a2ae3f` / same schema36**. See [deployment, Linux rehearsal and recovery evidence](realtime-practice-receipts-deployment.md). The existing one-minute worker remains active as fallback. This work adds a separate continuous receipt process, not an API-side provider send.

Pre-implementation read-only production observations:

- Timer `OnUnitActiveSec=1m`, `AccuracyUSec=1min`; observed24h worker interval median70s, maximum110s (including service/release scheduling effects).
- Existing fallback handles LINE1 / Telegram2 receipts per run when LINE is configured.
- Over48h: LINE17 delivered receipts had median48.42s / maximum135.21s enqueue-to-recorded-delivery; Telegram5 had median53.85s / maximum57.83s. All22 used one attempt and none were pending at inspection.
- For the subset matched to24h worker starts, start-to-recorded-delivery median was roughly0.82s LINE /1.31s Telegram. This points to queue scheduling, not solely provider transport.
- Successful POST requests across **all routes**, not save-only, had median0.158s /p900.333s /maximum1.583s. URLs remain redacted and `pg_stat_statements` was not installed; these are not separate save-SQL/identity-verification measurements.

`delivered_at` records server/provider acceptance handling, **not actual phone display/read time**. The implementation targets idle queue pickup within roughly one polling interval plus DB/provider time; it does not promise a fixed end-to-end delivery SLA.

## Design

New files: `practice-receipt-dispatcher.ts`, `practice-receipt-runtime.ts`, `practice-receipt-worker.ts` and the optional `qigong-practice-receipts.service` template.

- Explicit flag **`PRACTICE_RECEIPTS_REALTIME_ENABLED=true`** required. Undefined/false exits cleanly without requiring credentials or creating a pool. Loose truthy values/incomplete enabled configuration fail closed.
- Uses the existing restricted notifier account and `qigong_worker_runtime`; a dedicated pool is capped at4 connections. No new table privileges, migration or public endpoint.
- Starts checking immediately. Independent LINE/TG lanes idle-poll every1000ms; one in-flight batch per lane, maximum3 claimed rows, existing sequential delivery within each batch. A slow LINE request does not block Telegram.
- Full batches continue after25ms, with a1000ms pause after at most10 full batches. Lane/query/failure signals back off1–30s to prevent a busy failure loop. Existing per-receipt available-at retry/backoff and8-attempt limit remain unchanged.
- Each batch checks the existing exact36 architecture gate before claiming. Schema mismatch stops new work and drains the other lane; it cannot recall an already in-flight accepted send. Query failures retry without logging SQL values.
- Claim, pre-send eligibility/consent/identity/lease checks and finish use the existing restricted functions. LINE retains the same receipt UUID retry key. WhatsApp receipts are never dispatched by this runtime.
- The save API and its transaction are unchanged. It commits practice data plus the existing outbox atomically; the next poll sees only committed rows. A rolled-back enqueue cannot send, and provider latency is not added to the learner HTTP request.
- The old one-minute worker is **unchanged** and remains a fallback. Atomic lease claims coordinate the two consumers without re-claiming the same live lease. The continuous process is the primary low-latency path; normal notices/reminders/badges remain in the operational worker.

No reminder/reviewer preferences, region, identity association, privacy publication, translations or old check-ins are backfilled. Activation drains already queued eligible work, not newly fabricated historical receipts.

## Failure, privacy and shutdown boundaries

Database retry/lease state is durable across restarts. Provider/network uncertainty still prevents an exactly-once guarantee, particularly Telegram acceptance followed by a lost finish acknowledgement. The LINE retry key reduces a class of duplicate requests, not every possible delivery ambiguity. Concurrent consumers can process different rows; strict recipient-wide arrival order is not newly guaranteed.

Existing10-minute sending leases remain unchanged: a forced kill may leave an in-flight lease until expiry. This implementation does not silently shorten leases or steal live work. SIGTERM/SIGINT stop new claims and cancel idle sleeps immediately; the current claimed batch is drained and both lanes finish before pool close. The service allows90s to stop, then standard systemd kill/restart behavior and lease recovery apply. Provider timeouts/backoff, backlog, DB/network failures or client push delays can exceed the idle polling interval.

Summary content remains the existing allowlist: date/action/methods/streak/total only, never reflection or feeling text. Logs contain channel, counts, bounded timings, schema/failure events and a30s process heartbeat; never recipients, bearer tokens, raw payloads or provider diagnostics. Failure counts are failure signals (including finish/lease failures), not necessarily distinct recipients. A heartbeat is process liveness, not proof of successful delivery; monitor batch errors and outbox age too.

## Local verification

Full dedicated PostgreSQL16 `pnpm verify`: **766 tests** (API575 / database183 / config2 / identity6), format/lint/source typecheck/build passed. Extra all-test TypeScript retains the10 pre-existing errors; prior timestamp intermittency is not claimed fixed.

New coverage: explicit disabled entry/no credentials, flag validation, immediate/one-second idle pickup, bounded burst/backoff, sanitized errors, independent lanes, cancellation, in-flight shutdown, committed/rolled-back outbox visibility,14-receipt backlog, concurrent legacy/realtime lease claims, persisted retry/same retry key, current-eligibility recheck, initial/between-batch schema mismatch, raw-table denial and service-hardening directives.

The actual one-second idle-poll integration completed with a mocked provider at about1.1s in the local run; this is not a production/provider benchmark. The compiled entry ran through a symlink with outbound fetch blocked and shut down cleanly via SIGTERM, proving the entry-path handling used by a current-release symlink. A revocation fixture was corrected to close its active interaction channel before revoking identity; the original DB protection and strict one-send assertion were retained.

Evidence: `/tmp/qigong-receipt-realtime-{integration,verify,all-types,build}.log`. Local implementation tests made no production changes, service start, provider test message or real-credential fixture. The later deployment passed Linux `systemd-analyze verify`, real hardened-service mock rehearsal and explicit production activation as documented above. Real-user/provider/mobile delivery timing remains an acceptance gate.

## Rollout/recovery procedure — separately approved for this release

1. Review exact-SHA CI, same36 compatibility and backups/actual restore; historical0001–0036 and API/worker contracts remain unchanged.
2. Preserve the original worker env and notification flags. Install the matching binary and review the new service hardening on Linux. Verify the notifier has both intended provider configurations without printing secrets.
3. Explicitly approve adding only the new activation flag and starting/enabling the new service. Keep the existing minute timer as fallback; no bulk opt-in or service-policy publication.
4. Measure aggregate commit/queue/provider-acceptance latency and backlog with no personal-content logging; obtain actual LINE/TG device acceptance.
5. Rollback: stop/disable the realtime service before switching to a prior binary that lacks this entry, retain the existing minute fallback and durable queue, and review only the new flag/config change. Do not restore an old DB or discard new check-ins/receipt state. Editing an env file alone does not hot-disable a running process; stop/restart explicitly.

The initial implementation approval did not authorize publication; the subsequent commit/push/deploy and operational activation were separately approved. Future operational changes still require their own review. Preserve and exclude unrelated `docs/operations/web-admin-permissions-review.md`.
