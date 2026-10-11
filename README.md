# Finance

A static personal ledger using Supabase Auth and owner-scoped row-level security.

## Data ownership

- Expenses are stored in `public.expenses`.
- The canonical income and goal collections are `user_configs.incomes_data` and `user_configs.goals_data`. The legacy tables are read only when their corresponding JSON column is absent/null; an empty JSON array is an intentional empty collection.
- Assets, asset history, categories, overrides and asset grouping are in `user_configs`.
- Cloud hydration is read-only. Empty cloud arrays take precedence over older local caches.
- Configuration updates use a server-maintained `updated_at` revision to reject stale writes. Failed payloads are retained locally and included as `pendingConfig` in JSON exports. Review those payloads before merging; they are not silently replayed.
- Do not store backup exports or credentials in this public repository.

## Database setup

Apply `finance-data-integrity.sql` once to an existing project before deploying this version. It adds `bucket_map` and an update revision trigger, without changing financial records. Existing owner-based RLS policies remain in place.

## Verification

Requires Node.js 22 or newer:

```sh
node --test regression-tests.cjs
```

The tests use an in-memory database; they do not contact Supabase or contain personal records. Browser smoke tests should likewise use a separate fixture/mock database. Never insert fake transactions into the real ledger.

`index1.html` redirects old bookmarks to the supported authenticated application.

## Remaining engineering work

- Transactional, resumable expense import/replacement and idempotent offline inserts.
- Owner-scoped local caches and per-owner IndexedDB backups for shared devices.
- Consistent financial metric definitions (cash vs receivables, observation periods, stale-data handling).
- A complete transaction edit audit log, automatic off-device backups and recovery drills.
- Split the monolithic HTML into modules, add CI, and expand browser coverage.
- Category reset/import and destructive actions still require careful review; current safeguards do not replace an immutable audit trail.
