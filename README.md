# Finance

Static personal ledger using Supabase Auth and owner-scoped RLS. Current version: 2026.10.11.2.

## Storage and safety

- Expenses live in `public.expenses`. Income and goals are canonical in `user_configs.incomes_data` / `goals_data`; legacy tables are only fallback for absent/null JSON columns. Empty arrays mean intentionally empty collections.
- Assets, history, categories, overrides and grouping live in `user_configs`. Hydration is read-only. Server-maintained revisions reject stale configuration saves. Failed config payloads stay in the local export's `pendingConfig` field; manual reconciliation is required.
- Expense inserts retain a client UUID across retries. Duplicate retries do not create another expense.
- JSON append, complete replacement and snapshot restore use one `finance_import_atomic` transaction. A server token covers both config and expenses. Concurrent changes reject the import. Validation runs before writes; all financial writes and the pre-import backup roll back together on error. An ambiguous network response must be checked by refreshing before retrying.
- `finance_backups` stores a checkpoint before each import and before the first actual daily modification (Asia/Shanghai). `finance_changes` stores before/after values from the upgrade onward. The browser cannot update/delete either collection or insert audit events.
- The internal audit trigger uses SECURITY DEFINER solely to append protected history and backups. It lives in a non-exposed private schema, has an empty search path, checks the acting owner and has all client execution privileges revoked. Public RPCs are SECURITY INVOKER and executable only by authenticated users; RLS still applies.
- The UI lists the latest 30 backups and 50 changes. Older rows remain stored. Backups in the same Supabase project do not protect against loss of the project itself. Use **云端备份下载** to save independent JSON files. **导出** also includes local pending changes.
- Local IndexedDB snapshots now have owner + profile scope. Legacy snapshots lacking an owner remain stored but are not auto-assigned to an account.
- Never commit financial backups, credentials, or real user fixtures to this public repository.

## Database setup

On an existing project, apply `finance-data-integrity.sql`, then `finance-safety-upgrade.sql` **once**, before deploying the new UI. Both are additive setup scripts, not Supabase CLI migration history entries. They do not replace existing financial rows. The second script expects the first revision trigger and existing owner-based RLS policies.

## Metrics

- Net worth = gross assets minus absolute debt. Receivables/other assets count toward net worth but not available cash. Explicit user grouping overrides defaults.
- Runway and health calculations use the same six completed calendar months. Months missing income or expense records are unknown; they are not assumed to be zero. This is an observation check, not proof that a month is fully reconciled.
- Health scoring is withheld when that window is incomplete or any dated asset is older than 45 days. Missing financial statements must be supplied by the user, never inferred.

## Verification

```sh
node --test regression-tests.cjs
```

Node 22+. Tests use an in-memory database without credentials or personal records. Browser QA uses an isolated fixture and blocks Supabase network access. Database QA uses an authenticated-role transaction that is always rolled back: success, mid-write failure, stale tokens, RLS isolation and immutable audit permissions. Never commit fake transactions to the real ledger.

`index1.html` redirects old bookmarks to the authenticated app.

## Remaining work

- Scope all legacy localStorage cache keys by owner as well as profile for shared devices.
- Add scheduled external backups with retention and a separately administered recovery destination; no such service is configured.
- Split the monolithic HTML, add CI and broader visual/mobile coverage.
- Reconcile missing statements and asset valuations. The application cannot prove historical completeness without those sources.
