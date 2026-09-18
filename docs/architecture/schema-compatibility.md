# Schema Compatibility Release Contract

Every deployable application version declares:

```text
minimum compatible migration
maximum compatible migration
```

The pre-production `0001` to `0002` transition is exempt because no application instance serves production traffic. The expand release sequence is mandatory after the first production deployment.

## Expand Release

1. Release application `A` whose maximum range includes the planned expand migration.
2. Confirm all running `A` instances are ready.
3. Apply the expand migration. It may add nullable columns, tables, indexes, or backward-compatible behavior only.
4. Verify old `A` and new application `B` are both ready on the expanded schema.
5. Start `B`, run smoke tests, then switch traffic.

## Backfill Release

Backfills are resumable and do not remove compatibility with `A` or `B`. Read paths remain tolerant until validation is complete.

## Contract Release

1. Confirm all old `A` instances are drained and cannot restart.
2. Close the rollback window explicitly.
3. Deploy application `C` whose minimum version requires the completed backfill.
4. Apply contract migrations only after `C` is healthy and no rollback to `A` is permitted.

## Required Controls

- CI tests the old and new application compatibility ranges against the same expand schema.
- Readiness fails outside the declared range.
- Migration artifacts contain every applied migration; missing historical files fail closed.
- Historical migration files are immutable and checksum-verified.
- Deployment records store application version, compatibility range, and migration version.
