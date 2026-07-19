---
title: Era 2 — Reference Data Schema (intent)
type: intent
version: 0.1.0
created: 2026-06-01
parent: ../../../../projects/doc/prd/era-2-c01-postgres-schema-and-extensions.prd.md
---

# Era 2 — Reference Data Schema (intent)

## Why this schema exists

Era 2 migrates Brokenstock's reference-data substrate (securities, security aliases, stock splits, market calendar, equity prices, options prices) from DynamoDB to PostgreSQL. The C1 child PRD owns the DDL; this document captures the design rationale separately so it survives the migration files and outlives any single PRD's lifecycle.

Six logical entities map to **eight physical tables** after two structural deviations (A + B below). Schema design follows the rule from `[[feedback-preserve-ddb-access-patterns]]`: preserve DDB primary/sort/GSI capability by default; document deviations with their justification.

## Four approved deviations from strict DDB-shape preservation

Each deviation is justified by "the DDB pattern was DDB-imposed, not access-pattern-imposed":

### A. `stock_splits` → two tables

DDB stored per-security split metadata in a sentinel row (`sortKey = "~coverage"`) inside the same `STOCK_SPLITS` table as real split events. Postgres prefers separate tables for separate concerns. Era 2 splits this into:

- `stock_splits` — real split events, PK `(security_key, effective_date)`.
- `stock_splits_coverage` — per-security refresh/apply metadata, PK `security_key`.

Both have `FK ON DELETE CASCADE` to `securities`. Same access patterns preserved; cleaner relational shape; no sentinel-sort-key gymnastics in queries.

### B. `market_calendar` → normalized per-holiday rows

DDB stored holidays as a `holidays[]` array on a single per-`(MIC, year)` row, refreshed via whole-row merge-upsert (read → union arrays → write back). The merge pattern was forced by DDB's coarse update granularity; Postgres can insert/update per-holiday naturally. Era 2 normalizes to:

- `market_calendar` — per-`(MIC, year)` refresh metadata, PK `(mic, year)`.
- `market_calendar_holidays` — one row per holiday, PK `(mic, holiday_date)`.

No FK between them (holidays reference `(mic, year)` by implicit composite). Refresh path is transactional: `DELETE FROM market_calendar_holidays WHERE mic=$1 AND date_part('year', holiday_date)=$2`; `INSERT INTO market_calendar_holidays ...`; `UPSERT market_calendar`.

Per-holiday rows enable direct `is 2024-03-15 a trading day for XNYS?` queries without JSON unpacking.

### C. `prices_equity` → full field names

DDB used abbreviated column names (`h`, `l`, `o`, `c`, `v`) to minimize per-row attribute-name storage overhead. Postgres has TOAST + page compression; the storage motivation evaporates. Era 2 uses full names: `high`, `low`, `open`, `close`, `volume`. Readability wins; no consumer churn beyond mechanical renames in `@franzzemen/financial-data`.

### D. `prices_options` → decomposed composite SK + full field names

DDB stored options chains with a composite sort key (`sk = "{expiration}#{strike}#{callPut}#{closingDate}"`) parsed app-side via `parseOptionsSortKey()`. The composite-string-as-sort-key was a DDB workaround for missing multi-column sort. Era 2 decomposes:

```
PK (security_key, expiration_date, strike, call_put, closing_date)
```

The `parseOptionsSortKey()` function dies; range queries by expiration/strike inside a security become native B-tree scans. Greek field names expand: `delta`/`gamma`/`theta`/`vega`/`rho` instead of `d`/`g`/`t`/`ve`/`r`. The OCC contract identifier (`cid`, e.g. `AAPL240419C00150000`) is retained as a regular column with `UNIQUE INDEX` — persists the vendor-facing canonical identifier and guards against decompose-vs-cid drift.

## FK promotion preview

Era 2 produces **4 new real FKs**, replacing hand-managed cross-references:

| Relationship | Direction | Behavior |
|---|---|---|
| `security_aliases.security_key → securities.key` | parent → child | `ON DELETE RESTRICT` — aliases are hand-curated; orphan check forces investigation |
| `stock_splits.security_key → securities.key` | parent → child | `ON DELETE CASCADE` — splits are derived data; auto-delete with security |
| `equity_prices.security_key → securities.key` | parent → child | `ON DELETE CASCADE` — prices delete with security |
| `options_prices.security_key → securities.key` | parent → child | `ON DELETE CASCADE` — options data deletes with underlying |

`stock_splits_coverage.security_key → securities.key` is also `ON DELETE CASCADE` (symmetric with `stock_splits`) but is a sibling of the main splits FK, not an additional promotion.

The `market_calendar` and `market_calendar_holidays` tables have no FKs (MIC is not its own normalized table). This is preserved DDB shape.

## Cross-cutting conventions

- **PK shape on `securities`.** TEXT PK `key` preserving today's `mic:ticker` composite string (e.g. `XNAS:AAPL`). CHECK constraint enforces the shape via regex `^[A-Z0-9]+:[A-Z0-9.\-]+$`. Preserves the soft-pointer pattern used by every downstream table (transactions, trades, BrokerageRecord, etc.) that references `<securityKey>` as a string.
- **Audit columns.** Every table carries `created_at`/`updated_at` TIMESTAMPTZ DEFAULT now() + `created_by`/`updated_by` TEXT with CHECK on the `<uuid>.user` postfix. The shared `set_updated_at()` trigger function (reused from Era 1 C1) fires `BEFORE UPDATE` on every table.
- **System-write UUID.** Vendor-written rows (price refreshes, calendar refreshes, splits fetches) populate `created_by`/`updated_by` with the bootstrap-system-user sentinel `00000000-0000-0000-0000-000000000000.user`. No new identity is introduced; the CHECK constraint passes.
- **Numeric precision on prices.** All OHLCV columns and options greeks are `DOUBLE PRECISION`, matching vendor JS-number source fidelity. `NUMERIC(p, s)` would be appropriate for an internal pricing engine doing arithmetic; Brokenstock's yield/gain compute math runs on its own working types elsewhere, so the source fidelity choice is the cheap one.
- **Indexes.** `securities` carries 5 secondary indexes (`ticker`, `mic`, `asset_class`, `currency`, `country_code`) mirroring DDB's 5 GSIs. `security_aliases` carries one secondary index `(security_key, alias_type)` mirroring the `key-index` GSI. `prices_options` carries `UNIQUE INDEX (cid)`. All other tables are PK-only; secondary indexes can be added later when a real query pattern justifies one. Per `[[feedback-preserve-ddb-access-patterns]]`.

## NOTIFY plumbing — the cache-coherence substrate ⚠️ RETIRED 2026-07-19

> 🔴 **ALL SIX TRIGGERS BELOW HAVE BEEN DROPPED.** They are documented here as the
> historical record of Era 2; **none of this describes the running schema.**
>
> The L5 domain cache services that were to subscribe were built (Era 2 C3) but **never
> started in any process**, so these six channels published into the void from 2026-06-01
> to 2026-07-19. Dropped by `2026-07-19T120000Z_retire_l5_notify_triggers.ts`, which also
> drops the six `notify_*` functions and carries a `down` restoring the exact
> pre-retirement state (including the Era-5 GUC-guarded equity variant).
>
> Re-evaluated per domain, **none wanted invalidation-based caching**: aliases' hot read is
> `consistentRead=true` (a cache there is a correctness regression), the market calendar is
> already cached in-process by `TradingCalendar`, splits want a batch read, equity prices
> moved to a consumer-sited short-TTL burst cache, options had no reader at all.
>
> **Cost was not the reason.** `pg_notify` into a channel with no listener is an in-memory
> append to the transaction's pending-notify list. The ~0.85 ms/row figure asserted in
> `2026-06-12T160000Z_era_5_equity_price_notify_suppress_guard.ts` was an **attribution,
> not a measurement** — and the nightly equity feed had been pushing the full
> ~12,000-security universe through the same unguarded trigger every night without
> complaint.
>
> **Still live, unaffected:** `vendor-sync-job-enqueued` (`vendor_sync_jobs` INSERT),
> `chunk_ready:<job_type>` (pg-queue / pg-chunked-jobs). Those have real subscribers.
>
> See `projects/doc/prd/l5-cache-tier-retirement.prd.md`.

Era 2 shipped the **Postgres LISTEN/NOTIFY** half of the L4/L5 cache architecture (intent doc 0.5.0, Front 3). The L5 domain cache services (Era 2 C3) were to subscribe to per-entity channels and evict cached entries when the writer commits. They never did.

Six per-entity NOTIFY trigger functions, each firing `AFTER INSERT OR UPDATE OR DELETE` on its data-bearing table, with pipe-joined composite-key payloads:

| Channel | Source table | Payload format | Example |
|---|---|---|---|
| `security-changed` | `securities` | `key` | `XNAS:AAPL` |
| `security-alias-changed` | `security_aliases` | `alias_type\|alias` | `ISIN\|US0378331005` |
| `stock-split-changed` | `stock_splits` | `security_key\|effective_date` | `XNAS:AAPL\|2024-06-10` |
| `market-calendar-holiday-changed` | `market_calendar_holidays` | `mic\|holiday_date` | `XNYS\|2024-12-25` |
| `equity-price-changed` | `prices_equity` | `security_key\|closing_date` | `XNAS:AAPL\|2024-03-15` |
| `option-price-changed` | `prices_options` | `security_key\|expiration_date\|strike\|call_put\|closing_date` | `XNAS:AAPL\|2024-04-19\|150\|call\|2024-03-31` |

`stock_splits_coverage` and `market_calendar` (metadata) do NOT emit NOTIFY — they hold operational state that no L5 cache consumes.

Payloads stayed well under Postgres' 8KB NOTIFY cap. Consumers were to parse on receipt and call their L4 LRU's `.invalidate(payload)` — no consumer was ever wired.

## MIN_SCHEMA_VERSION

The last migration in this Era 2 C1 batch is `2026-06-01T120400Z_era_2_notify_triggers.ts`. Consumer packages (Era 2 C3 domain packages — `securities`, `security-aliases`, `stock-splits`, `market-calendar`, `financial-data`) pin to this timestamp:

```ts
export const MIN_SCHEMA_VERSION = '2026-06-01T120400Z';
```

Worker startup queries the `pgmigrations` table; if the timestamp isn't applied, the worker refuses to start with a clear message. Same expand-contract discipline as Era 1.
