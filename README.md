# Finance

Static personal ledger using Supabase Auth and owner-scoped RLS. Current version: 2026.10.12.1.

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

## Personal and business annual budgets

- Apply `finance-budget-scope.sql` after the two safety setup scripts and before deploying version 2026.10.12.1. It adds a nullable `expenses.budget_scope` constrained to `personal` / `business`, updates the existing atomic import RPC, and does not rewrite historical expenses or change RLS policies.
- Category JSON may specify `budgetScope`. Existing category IDs 3 (company accounting) and 22 (business purchases) default to business; all other categories default to personal. Category budgets and identifiers remain unchanged.
- A null expense scope follows its category default. An explicit scope overrides that default for this entry only. Changing an entry's scope moves recorded spending between annual groups without moving any budget, changing category, or changing amount.
- Dashboard and budget pages show both annual limits separately and their combined recorded outflow. Monthly figures are references only; group budgets do not automatically offset each other. Income remains combined and is not presented as a verified available-cash balance.
- The selected year's records are compared to current category budgets; the UI explicitly labels historical years as using current settings, since the app does not store annual budget versions.
- Normal/quick entry, editing, cloud hydration, local/portable/cloud backups and atomic import carry the scope. Legacy imports lacking the field preserve the scope of a matching existing ID; explicit null resets to category default.
- Scope edits update one row atomically with ownership and original-field checks. Failed or stale writes leave local data untouched. Database tests run in a rolled-back transaction with a temporary QA profile; browser QA uses a mocked database with Supabase requests blocked.

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

### Annual review upgrade (2026.10.12.2)

Apply `finance-review-upgrade.sql` after `finance-budget-scope.sql`, then publish
`index.html`, `review.js`, and `review.css` together. The setup adds only
`user_configs.review_data`; original expense rows, category IDs and budget amounts
are not migrated or inferred. RLS and authenticated ownership stay unchanged.
Old import payloads that omit `review_data` preserve the existing review state.

- Annual personal/business budgets use **net payments** (original expenses minus
  explicitly registered fund returns), including cash occupied by deposits and
  top-ups. Consumption is shown separately. These are not bank balances.
- Budget versions retain original/current categories and a reasoned change log.
  Historical years without saved budgets are unknown, never assigned today's budget.
- Monthly, quarterly and annual reports cap the current period at today. Comparisons
  use the same dates last year (Feb 29 clamps to Feb 28). Percentage changes require
  both periods' months to be explicitly reconciled; missing data is not zero.
- Reconciliation fingerprints include rows, income, fund settlements and pending
  items. Later edits invalidate the prior acknowledgement. Current months cannot
  be marked complete. Unknown amounts are pending items, never fabricated expenses.
- Deposits/prepayments require manual classification of an existing payment.
  Noncash consumption and returns are separately registered with dated evidence;
  totals cannot exceed principal. Operators must confirm that settlements were not
  already entered elsewhere; same-day matching amounts are rejected for review.
  Classified source payments cannot be edited/deleted until classification is
  cleared. Balances are not automatically added to asset totals.
- Full JSON/cloud/IndexedDB backups include review state. Conflicting review state
  is not silently merged in append imports. Full restore is explicitly previewed.
- Subscription/treating suggestions are candidates for reflection, not automatic
  labels of waste or financial-health scores. Original manually overridden month
  totals remain preserved, while these new reports use auditable transaction rows.

Validation: `node --test regression-tests.cjs`; database changes should additionally
be exercised under the authenticated role in a transaction that ends in ROLLBACK.
