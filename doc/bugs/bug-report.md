# Bug Report Tracker

This file is a lightweight tracker of bugs reported against this repo.

**It is not maintained beyond the moment a bug is being worked on.** Rows are
added when a bug is reported and updated when it is resolved. After that,
rows are left alone — they do not get re-synced with the current state of
the code. Old entries may reference files, functions, or behaviors that no
longer exist. For ground truth on any fix, use `git log --grep=BUG-NNN`.

Status values: `open`, `investigating`, `fixed`, `wontfix`, `duplicate`, `not-reproducible`.

Index columns hold dates for readability. Per-bug sections hold full ISO 8601
timestamps (with timezone offset) so resolution efficiency can be computed
later: `time-to-start = fix_started - reported`, `fix duration = fixed - fix_started`,
`total cycle = fixed - reported`.

## Index

| ID | Title | Reported | Fix Started | Resolved | Status | Owner repo |
|----|-------|----------|-------------|----------|--------|------------|
| BUG-001 | IBKR import dies + silently reverts on CAD transaction (currency CHECK too narrow) | 2026-07-11 | 2026-07-11 | 2026-07-11 | fixed | brokenstock-postgres-ddl |

## BUG-001: IBKR import dies + silently reverts on CAD transaction (currency CHECK too narrow)

**Reported:**    2026-07-11T09:51:34-04:00
**Fix started:** 2026-07-11T13:00:14-04:00
**Fixed:**       2026-07-11T13:13:19-04:00
**Status:** fixed

### Report
A freshly-downloaded full-year IBKR Flex Query XML (`2024_YEAR_U15843096_Transactions.xml`)
was imported via the manual upload path into a new brokerage account
("IBKR Ultra Ultra Mega Caps", account U15843096) on prod_blue. The import began
parsing but the `brokerage_file_imports` status reverted from parsing back to
"Ready for parsing" — which indicates the `import.parse` job threw rather than
advancing. Suspected IBKR Flex-schema drift (parser had ~10 months without
functional maintenance).

### Findings
Two independent defects, one masking the other:

1. **Root cause (this repo).** The parser is NOT at fault — CloudWatch shows it
   parsed the XML fine every attempt (`parser-parse: records=40`). The failure is
   a DB check-constraint violation on the transaction insert:
   `new row for relation "transactions" violates check constraint "transactions_currency_chk"`.
   The constraint (`.../migrations/2026-06-05T120000Z_era_3_transactions.ts:98`)
   allowed only `currency IN ('USD','EUR')`. The file contains 8 CAD rows —
   Alimentation Couche-Tard (`symbol="ATD"`, `listingExchange="TSE"`,
   ISIN `CA01626P1484`, `currency="CAD"`) plus `USD.CAD` forex CASH rows (the
   latter filtered by the parser). The IBKR parser correctly passes the native
   currency through (`brokerage-parsers/.../ibkr-json-history-parser.ts:118`), so
   the ONE CAD transaction aborts the whole batch insert. Job `31832` retried 5×
   then went dead (`pg-chunked-jobs resume 31832`).

2. **Masking defect (brokenstock-orchestrator).** When the insert aborts the
   Postgres transaction, `parseStage`'s error path
   (`file-import-action-orchestrator.api.ts:2246-2252`) calls
   `brokerageFileImportsApi.put(fileImport)` to persist `'failed'` status **through
   the same db handle whose transaction is already aborted** → Postgres `25P02`
   "current transaction is aborted, commands ignored until end of transaction block".
   So the failure could not be recorded, and the import silently reverted to
   "Ready for parsing" instead of showing "failed" — which is why the error was
   invisible and had to be inferred.

Corollary (not a bug, accepted): Massive covers US equities only (no TSX/XTSE),
so CAD/TSX securities resolve to the `XXXX` (Unknown) MIC placeholder and land
unlisted/unpriced. Widening the constraint admits them for import; pricing is a
separate, deferred concern (Franz 2026-07-11).

### Fix
Fix 1 (this repo, SHIPPED): migration `2026-07-11T120000Z_transactions_currency_widen.ts`
widens the constraint to `('USD','EUR','CAD','GBP')` (superset — validates
existing rows cleanly; bumps MIN_SCHEMA_VERSION to 2026-07-11T120000Z; no worker
redeploy needed). Published as DDL `0.26.1` via `abs.ddl-publish nonprod`; applied
via `abs.migrate` to dev_franz (test gate) then prod_blue — both `MIGRATE_SUCCESS`.
Verified by re-driving the import: `finalizeReconcileStage-persist kept=20 deleted=0`
(all 20 transactions incl. the CAD ATD rows persisted), import reached
"manual instrument identification" (Pending Instrument Identification) as expected.

Follow-ups tracked separately (NOT part of this entry's resolution):
- Fix 2 (brokenstock-orchestrator): persist `'failed'` status on a fresh connection
  so parse failures are visible instead of silently reverting to "Ready for parsing"
  (the 25P02 masking defect). Pending.
- Observation: IBKR "transferred cash in/out" (deposit/withdrawal) transactions are
  keyed `XXXX:{account}` (account number used as security symbol), so they spuriously
  land in Pending Instrument Identification. Separate IBKR-parser issue. Pending triage.
