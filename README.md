# Finance

Personal ledger with Supabase Auth, owner-scoped RLS and annual budgets. Version **2026.10.12.4**.

## Product structure

Restored the original purple/blue design, card layouts and five primary tabs: overview, entry, analysis, wealth and settings. Analysis contains reviews, charts, calendar and annual statistics; wealth contains assets, income, annual budgets, budget checks and goals. Existing financial records and annual budget versions are not reverted.

Detail repairs retain guarded writes, exact hover/tap values, calendar-based trend ranges and numeric chart tables. Direct links correctly activate the parent navigation. Asset allocation excludes liabilities from the gross-assets donut; the million-goal fill and headline use the same target. Category charts use non-overlapping legends and retain missing values as unknown. Quick-entry presets only fill the form and require Save. Annual summaries and income comparisons never invent zero expenses for missing historical months.

- Personal and business budgets are separate. Category IDs 3 and 22 default to business; individual expenses may override their default. Budgets are annual; monthly averages are references, not monthly limits.
- `review_data.budgetYears` preserves original and current budgets plus adjustment reasons. Absent historical budgets remain unknown. Changes to category structure preserve original annual versions; new categories start at zero pending an explicit budget decision.
- Reviews use the same cutoff date for prior-year comparisons. Missing expenses are not zero. Percentage changes require both periods to be reconciled. Current months cannot be closed. Editing source records invalidates prior reconciliation fingerprints.
- Deposits/prepayments and use/return events remain explicitly linked to the original expense. Amounts are not inferred from descriptions, and events cannot exceed the principal. Unknown amounts stay pending, outside totals.
- A ledger may explicitly set `review_data.recordingPolicy.noIncomeEntryMeansZero` and `assetsCarryForward`. No-income periods then show zero; unchanged asset balances carry forward without fabricating income or snapshots. The last registration dates remain visible.
- Net worth is gross assets minus absolute debt. Receivables count toward net worth, not available cash. Historical snapshots are preserved independently from current balances. The trend uses actual calendar windows and proportional dates, displays exact hover/tap values, and offers a numeric table. Recorded net-worth changes are not investment returns.

## Storage and safety

Expenses live in `public.expenses`; income and goals are canonical JSON in `user_configs.incomes_data` and `goals_data`. Legacy tables are fallback only when JSON columns are absent/null. Empty arrays mean intentionally empty collections. Assets, history, categories, budget overrides, grouping and review state also live in `user_configs`.

Hydration is read-only. Server-maintained revision checks reject stale configuration saves. Failed config payloads remain in the local export's `pendingConfig` for manual recovery; visible asset, income, goal and category edits roll back on failed saves. New expense UUIDs survive retries; repeated clicks are guarded. Asset form blanks are not converted to zero, historical gaps stay blank, and unsaved asset-type drafts never enter the authoritative configuration.

JSON append, full replacement and snapshot restore use `finance_import_atomic`. A server token covers both configuration and expense rows. Concurrent changes reject the import. Validation runs before writes; all financial writes and the pre-import backup roll back together on error. Check the cloud result before retrying an ambiguous network response.

`finance_backups` stores checkpoints before imports and the first actual daily modification (Asia/Shanghai). `finance_changes` stores before/after values from the safety upgrade onward. Clients cannot update/delete protected history or insert audit events. Internal append-only audit triggers use SECURITY DEFINER with an empty search path and owner checks; public RPCs use SECURITY INVOKER and owner-scoped RLS.

Backups within the same Supabase project do not protect against loss of that project. Download an independent complete backup using the header’s cloud backup action. Local IndexedDB snapshots are owner/profile-scoped; legacy snapshots without ownership metadata are not auto-assigned.

**Never commit financial backups, credentials or real user fixtures to this public repository.**

## Existing database setup

Apply these additive setup scripts in order on an existing project: `finance-data-integrity.sql`, `finance-safety-upgrade.sql`, `finance-budget-scope.sql`, `finance-review-upgrade.sql`. They are not Supabase CLI migration-history entries. Version 2026.10.12.4 requires no new schema changes and does not rewrite existing financial rows.

## Verification

```sh
node --test regression-tests.cjs
```

Regression coverage includes read-only hydration, preserved histories, concurrent revision conflicts, failed writes, scope overrides, annual versions, backup/import validation, fund accounting, calendar trend ranges, monthly review boundaries, blank asset inputs, duplicate save protection and the explicit recording policy. Browser tests use isolated fixtures with Supabase network requests blocked; they must never insert test transactions into the real ledger.
