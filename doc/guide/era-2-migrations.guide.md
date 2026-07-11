---
title: Era 2 — Reference Data Migrations (guide)
type: guide
version: 0.1.0
created: 2026-06-01
---

# Era 2 — Reference Data Migrations (guide)

Operator-facing guide for applying, verifying, and (if necessary) rolling back the nine Era 2 migration files shipped in `@franzzemen/brokenstock-postgres-ddl@0.4.0+`.

## Migration files (apply order)

The 9 files run in timestamp order automatically:

| Order | Timestamp | Migration |
|---|---|---|
| 1 | `2026-06-01T120000Z` | `era_2_securities` |
| 2 | `2026-06-01T120030Z` | `era_2_security_aliases` |
| 3 | `2026-06-01T120100Z` | `era_2_stock_splits` |
| 4 | `2026-06-01T120130Z` | `era_2_stock_splits_coverage` |
| 5 | `2026-06-01T120200Z` | `era_2_market_calendar` |
| 6 | `2026-06-01T120230Z` | `era_2_market_calendar_holidays` |
| 7 | `2026-06-01T120300Z` | `era_2_prices_equity` |
| 8 | `2026-06-01T120330Z` | `era_2_prices_options` |
| 9 | `2026-06-01T120400Z` | `era_2_notify_triggers` |

The 9th file's timestamp is the `MIN_SCHEMA_VERSION` consumer packages pin to.

## Applying

### Prerequisites

- `AWS_PROFILE=brokenstock-admin` (or equivalent profile with SSM `SendCommand` + S3 read on `brokenstock-<env>-deploys`).
- Worker host running and reachable via SSM (`i-0302bb5c17ad3aa1d` for nonprod as of 2026-06-01).
- Published DDL package: `npx bs.minor` (or `bs.patch`) + `abs.ddl-publish <env>` uploads the tarball to `s3://brokenstock-<env>-deploys/@franzzemen/brokenstock-postgres-ddl/<version>/`.

### Commands

```bash
# Publish source-of-truth tarball to S3 for the env
AWS_PROFILE=brokenstock-admin \
  npx -y -p @franzzemen/aws-build-system abs.ddl-publish nonprod

# Apply to a database
AWS_PROFILE=brokenstock-admin \
  npx -y -p @franzzemen/aws-build-system abs.migrate nonprod <db> <ver> --ddl-version <ver>
```

Where:
- `<db>` is the database target (`dev_franz`, `scratch`, `integration`, `prod_blue`, `prod_green`).
- `<ver>` is the published version of `brokenstock-postgres-ddl` (e.g. `0.4.0`).

Per [Era 2 C1 D14](../../../../projects/doc/prd/era-2-c01-postgres-schema-and-extensions.prd.md): C1 applies to `dev_franz` + `scratch` at C1 close; `prod_blue` is held until C5 cutover time.

## Verification

After applying, run the smoke verification SQL (mirrors Era 2 C1 E11). The full script is in `~/dev/brokenstock-postgres-ddl/doc/usage/era-2-c1-smoke.sh` (or recreated from Era 2 C1's E11 verification record); the highlights:

1. **All 8 Era 2 tables present.**
   ```sql
   SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN
     ('securities','security_aliases','stock_splits','stock_splits_coverage',
      'market_calendar','market_calendar_holidays','prices_equity','prices_options')
   ORDER BY tablename;
   ```
   Expect 8 rows.

2. **6 NOTIFY trigger functions present.**
   ```sql
   SELECT proname FROM pg_proc WHERE proname LIKE 'notify_%changed' ORDER BY proname;
   ```
   Expect: `notify_equity_price_changed`, `notify_market_calendar_holiday_changed`, `notify_option_price_changed`, `notify_security_alias_changed`, `notify_security_changed`, `notify_stock_split_changed`.

3. **6 NOTIFY triggers attached.**
   ```sql
   SELECT tgname, tgrelid::regclass AS table FROM pg_trigger
   WHERE NOT tgisinternal AND tgname LIKE '%_notify' ORDER BY tgname;
   ```
   Triggers are on the 6 data-bearing tables only (not on `stock_splits_coverage` or `market_calendar` metadata).

4. **5 secondary indexes on `securities`.**
   ```sql
   SELECT indexname FROM pg_indexes WHERE tablename='securities' AND indexname LIKE 'securities_%_idx'
   ORDER BY indexname;
   ```
   Expect: `securities_asset_class_idx`, `securities_country_code_idx`, `securities_currency_idx`, `securities_mic_idx`, `securities_ticker_idx`.

5. **UNIQUE cid index on `prices_options`.**
   ```sql
   SELECT indexname FROM pg_indexes WHERE tablename='prices_options' AND indexname='prices_options_cid_uidx';
   ```
   Expect one row.

6. **FK CASCADE smoke.** Insert a security + child price; delete the security; confirm the price row is gone.

7. **FK RESTRICT smoke.** Insert a security + alias; attempt to delete the security; expect `violates foreign key constraint`.

8. **UNIQUE cid smoke.** Insert two `prices_options` rows with the same `cid`; expect `duplicate key value violates unique constraint`.

9. **CHECK constraint smoke.** Insert a security with a malformed `key`; expect `violates check constraint`.

## Rollback

`abs.migrate` supports `--direction down --count N` to roll back the most recent N migrations:

```bash
AWS_PROFILE=brokenstock-admin \
  npx -y -p @franzzemen/aws-build-system abs.migrate nonprod dev_franz 0.4.0 \
    --ddl-version 0.4.0 --direction down --count 9
```

Rolls back all 9 Era 2 migrations against `dev_franz`. Use the same `<db>` you applied to. The migrations' `down` functions drop triggers, indexes, and tables in reverse order; FK CASCADE means dropping `securities` last (after its children's tables are gone) is safe.

**WARNING:** Rollback is for the schema-only window before C3 domain packages or C4 vendor-sync-worker have written data. Once data lands, rollback drops live state — coordinate with C5 cutover validation.

## DDB-side state during the migration window (historical)

> **Superseded by the Era-5 DDB→Postgres + Lambda→worker migration, 2026-06-10 — system is LIVE.** DynamoDB is fully decommissioned (zero tables/backups); all reference data lives in Aurora Postgres (`prod_blue`). The retention/cutover mechanics below describe the now-closed migration window and are retained for history only.

Per `[[project-ddb-retention-policy]]`: DDB tables for migrated domains were dropped in the same Era 2 child PRD as the corresponding Lambda decommission (C6). They remained populated and queryable until C6 closed; this let C5 backfill and verify against them without time pressure.

## Post-Era-2 reference/sentiment tables

Later feeds add `security_key`-keyed tables migrated the same way (each in its own dated migration; `schema-types/index.ts` carries the interfaces + JSDoc):

- `security_reference` (+ `free_float`/`free_float_percent`/`float_effective_date` columns), `security_related_companies`, `security_transitions`, `security_branding_assets` — Era-6 reference enrichment + Security Free-Float Feed.
- `security_short_interest` `(security_key, settlement_date)` and `security_short_volume` `(security_key, trade_date)` — Short Interest & Short Volume Feeds (dated history; `prices_equity` template minus split-rebase). Migration `2026-07-10T140000Z_short_interest_and_volume.ts` also admits the `security-short-interest` / `security-short-volume` / `security-short-volume-plan` feed_types and schedules their `pg_cron` jobs.
- `ipo_events` `(ipo_key)` and `ipo_status_transitions` `(ipo_key, observed_at)` — IPO Feed. **NOT `security_key`-keyed** (rumor/pending IPOs have no security): `ipo_key = us_code ?? isin ?? ticker` synthesized at write, nullable best-effort `security_key` with **no FK**, upserted in place; the status lifecycle is preserved in the transition log. Migration `2026-07-10T150000Z_ipo_feed.ts` admits the `ipo-refresh` feed_type and schedules its daily `pg_cron`.

## Cross-references

- Parent PRD: [`era-2-c01-postgres-schema-and-extensions.prd.md`](../../../../projects/doc/prd/era-2-c01-postgres-schema-and-extensions.prd.md)
- Era 2 super PRD: [`era-2-reference-data.prd.md`](../../../../projects/doc/prd/era-2-reference-data.prd.md)
- Intent: [`era-2-schema.intent.md`](../intent/era-2-schema.intent.md)
- Schema-types subpath: `~/dev/brokenstock-postgres-ddl/src/project/schema-types/index.ts`
- Memories: `[[project-postgres-ddl-discipline]]`, `[[project-ddl-worker-decoupling]]`, `[[feedback-preserve-ddb-access-patterns]]`, `[[project-ddb-retention-policy]]`
