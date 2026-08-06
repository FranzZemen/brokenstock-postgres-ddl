/*
Created by Franz Zemen 2026-08-06
License Type: UNLICENSED

The three monthly economy tables + their feed registrations
(projects/doc/prd/economy-indicators.prd.md E3, E4, E5).

  economy_inflation                — CPI, PCE, nominal consumer spending
  economy_inflation_expectations   — market-implied and Cleveland Fed model
  economy_labor_market             — unemployment, participation, earnings, openings

ONE MIGRATION FOR THREE TABLES, unlike E1 which shipped alone. E1 was on the
critical path for deriving implied volatility and had a reason to go early and
by itself. These three are the same shape, the same job pattern and the same
constraint edit on `vendor_sync_jobs`, and splitting them would mean three
consecutive rewrites of the same CHECK — each of which has to restate the full
feed list, and each of which is a chance to drop one.

**READ THIS BEFORE USING ANY COLUMN BELOW: THE UNITS ARE NOT UNIFORM, AND TWO
OF THESE TABLES MIX UNITS WITHIN A SINGLE ROW.** Measured against the live
vendor on 2026-08-06, not taken from documentation:

  economy_inflation
    cpi, cpi_core           INDEX LEVEL, 1982-84 = 100   (June 2026: 332.568)
    pce, pce_core           INDEX LEVEL, 2017 = 100      (June 2026: 131.392)
    pce_spending            BILLIONS OF DOLLARS, annual  (June 2026: 22184.1)

  economy_inflation_expectations
    every column            PERCENT                      (July 2026: 2.26)

  economy_labor_market
    unemployment_rate       PERCENT                      (June 2026: 4.2)
    labor_force_participation_rate  PERCENT               (June 2026: 61.5)
    avg_hourly_earnings     DOLLARS PER HOUR             (June 2026: 37.64)
    job_openings            THOUSANDS OF OPENINGS        (June 2026: 7359)

`cpi` and `pce` are indexes on DIFFERENT BASE YEARS. Subtracting one from the
other, or reading either as a rate of inflation, produces a number with no
meaning — and a plausible-looking one. This database has already shipped a
hundredfold display error from exactly this shape of mistake (volatility stored
as a percent in one table and a decimal in another, then subtracted). The rule
the `risk_free_rate_pct` comment states — one unit for one quantity — cannot be
applied here because the vendor's row genuinely carries three; so instead every
column carries its unit in a COMMENT ON COLUMN, which is the next best thing.

NO cpi_year_over_year COLUMN. It is the number most people mean by "inflation",
it is documented by Massive, and it appears on no row. It is DERIVED ON READ
from `cpi` twelve months earlier (PRD D14) rather than stored, because CPI is
revised after publication and every run re-upserts all of history — a stored
year-over-year figure would survive a revision to its own inputs and silently
disagree with them.

EVERY COLUMN IS NULLABLE, and a NULL means NOT PUBLISHED — never zero (PRD D15).
`job_openings` is the live case: it comes from a survey that publishes later than
its siblings, so the newest labor row lacks it for part of every month. Rendered
as zero that reads as the economy having stopped hiring. Readers return absent;
charts break the line.

DATES ARE STAMPED ON THE FIRST OF THE MONTH they describe, which is the vendor's
convention, not a truncation of ours. `2026-06-01` is the June figure, published
some weeks into July.

THE FEEDS PULL EVERYTHING, EVERY RUN, DAILY. The largest of the three is 954 rows
for eighty years of history in one unpaged call, so each handler re-fetches all
of it and upserts (PRD D2). Daily rather than monthly (PRD D3) because these
figures land on irregular dates and `job_openings` demonstrably lags its own
siblings — a daily run stores each figure the day it appears and we never model a
publish calendar. Consequence worth stating: all three are self-repairing. A run
that dies halfway, a worker down for a week, a deploy mid-job — all fixed by the
next run with nobody doing anything. That is the OPPOSITE of
`security-iv-snapshot`, where a missed session is permanent damage.

CRON TIMES ARE STAGGERED at 06:10, 06:20 and 06:30 UTC, after treasury yields at
06:00. Not because anything depends on anything — these four feeds are wholly
independent (PRD D18) — but because four vendor pulls firing in the same minute
would share a rate limit for no benefit, and a staggered failure is easier to
read in the run history than a simultaneous one.

feed_type values are admitted by the CHECK but NOT added to the exported
`VendorSyncFeedType` union — the convention for every feed since
`price-rebase-sweep`; the worker casts at the handler boundary to avoid a
Kysely-invariance rebuild of the whole package closure.

MIN_SCHEMA_VERSION = 2026-08-06T140000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';
import {scheduleVendorSyncCron, unscheduleVendorSyncCron} from '../vendor-sync-cron.js';

const INFLATION = 'economy-inflation';
const EXPECTATIONS = 'economy-inflation-expectations';
const LABOR = 'economy-labor-market';

/** Staggered after treasury yields at 06:00 — see the header. */
const SCHEDULES: ReadonlyArray<readonly [string, string]> = [
  [INFLATION, '10 6 * * *'],
  [EXPECTATIONS, '20 6 * * *'],
  [LABOR, '30 6 * * *'],
];

const FEED_TYPES_BEFORE = [
  'equity-prices', 'options-prices', 'stock-splits-fetch', 'market-calendar',
  'ticker-info', 'ticker-ratios', 'equity-price-repair',
  'security-reference-populate', 'security-reference-refresh', 'branding-images',
  'equity-prices-plan', 'options-prices-plan', 'price-rebase-sweep',
  'security-float-refresh',
  'security-short-interest', 'security-short-volume', 'security-short-volume-plan',
  'ipo-refresh', 'daily-indicators', 'price-discontinuity-audit',
  'security-iv-snapshot', 'economy-treasury-yields', 'security-iv-backfill',
];
const FEED_TYPES_AFTER = [...FEED_TYPES_BEFORE, INFLATION, EXPECTATIONS, LABOR];

const checkSql = (feeds: string[]): string =>
  `feed_type IN (${feeds.map((f) => `'${f}'`).join(', ')})`;

/**
 * The owner-format CHECKs and the timestamp columns every table in this schema
 * carries. Written once here rather than three times below — three copies of a
 * regex is three chances for one of them to be subtly different.
 */
const auditColumns = (table: string): string => `
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by       TEXT NOT NULL,
      updated_by       TEXT NOT NULL,
      CONSTRAINT ${table}_created_by_format_chk
        CHECK (created_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$'),
      CONSTRAINT ${table}_updated_by_format_chk
        CHECK (updated_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$')`;

const TABLES = ['economy_inflation', 'economy_inflation_expectations', 'economy_labor_market'];

export const up = (pgm: MigrationBuilder): void => {

  // ── economy_inflation ────────────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE economy_inflation (
      -- The observation month IS the identity, stamped on the first.
      observation_date DATE NOT NULL PRIMARY KEY,
      -- INDEX LEVELS on a 1982-84 = 100 base. NOT a rate of inflation.
      cpi              DOUBLE PRECISION,
      cpi_core         DOUBLE PRECISION,
      -- INDEX LEVELS on a 2017 = 100 base. NOT comparable with cpi above.
      pce              DOUBLE PRECISION,
      pce_core         DOUBLE PRECISION,
      -- BILLIONS OF DOLLARS, annualised.
      pce_spending     DOUBLE PRECISION,
      ${auditColumns('economy_inflation')}
    );
  `);

  pgm.sql(`
    COMMENT ON TABLE economy_inflation IS
      'Monthly CPI/PCE price indexes and nominal consumer spending (Massive /fed/v1/inflation). '
      'THREE UNITS IN ONE ROW: cpi/cpi_core are index levels on a 1982-84=100 base, pce/pce_core '
      'are index levels on a 2017=100 base, pce_spending is billions of dollars. NONE is a percent, '
      'and the two index families are NOT comparable with each other. '
      'The rate of inflation is DERIVED ON READ from cpi twelve months earlier and never stored, '
      'because CPI is revised and every run re-upserts all of history. '
      'Rewritten in full on every feed run; a missing month is a month the vendor never published.';
  `);
  pgm.sql(`COMMENT ON COLUMN economy_inflation.observation_date IS 'The month described, stamped on the first. 2026-06-01 is the June figure, published weeks into July.';`);
  pgm.sql(`COMMENT ON COLUMN economy_inflation.cpi IS 'Index level, 1982-84 = 100. NOT a percent. June 2026 read 332.568.';`);
  pgm.sql(`COMMENT ON COLUMN economy_inflation.cpi_core IS 'Index level, 1982-84 = 100, excluding food and energy.';`);
  pgm.sql(`COMMENT ON COLUMN economy_inflation.pce IS 'Index level, 2017 = 100. A DIFFERENT base from cpi — do not compare the two directly. June 2026 read 131.392.';`);
  pgm.sql(`COMMENT ON COLUMN economy_inflation.pce_core IS 'Index level, 2017 = 100, excluding food and energy.';`);
  pgm.sql(`COMMENT ON COLUMN economy_inflation.pce_spending IS 'Billions of dollars, annualised. June 2026 read 22184.1 — that is $22.18 trillion.';`);

  // ── economy_inflation_expectations ───────────────────────────────────────
  pgm.sql(`
    CREATE TABLE economy_inflation_expectations (
      observation_date      DATE NOT NULL PRIMARY KEY,
      -- ALL PERCENT: 2.26 means 2.26% a year. The one uniform table of the three.
      -- market_* is backed out of what traders pay for inflation protection;
      -- model_* is the Cleveland Fed's estimate. They disagree, and neither is a
      -- correction of the other.
      market_5_year         DOUBLE PRECISION,
      market_10_year        DOUBLE PRECISION,
      forward_years_5_to_10 DOUBLE PRECISION,
      model_1_year          DOUBLE PRECISION,
      model_5_year          DOUBLE PRECISION,
      model_10_year         DOUBLE PRECISION,
      model_30_year         DOUBLE PRECISION,
      ${auditColumns('economy_inflation_expectations')}
    );
  `);

  pgm.sql(`
    COMMENT ON TABLE economy_inflation_expectations IS
      'Monthly market-implied and Cleveland Fed model inflation expectations '
      '(Massive /fed/v1/inflation-expectations). ALL COLUMNS ARE PERCENT: 2.26 means 2.26% a year. '
      'The only one of the four economy feeds whose vendor documentation matches what it sends. '
      'Rewritten in full on every feed run.';
  `);
  pgm.sql(`COMMENT ON COLUMN economy_inflation_expectations.forward_years_5_to_10 IS 'Percent. Expected inflation for the five years BEGINNING five years from now — not the next ten.';`);
  pgm.sql(`COMMENT ON COLUMN economy_inflation_expectations.model_1_year IS 'Percent. Cleveland Fed model. Publishes to seven decimals where the market series publish to two; the precision is the vendor''s, not noise we added.';`);

  // ── economy_labor_market ─────────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE economy_labor_market (
      observation_date               DATE NOT NULL PRIMARY KEY,
      -- PERCENT.
      unemployment_rate              DOUBLE PRECISION,
      labor_force_participation_rate DOUBLE PRECISION,
      -- DOLLARS PER HOUR.
      avg_hourly_earnings            DOUBLE PRECISION,
      -- THOUSANDS OF OPENINGS. 7359 means 7.36 million.
      job_openings                   DOUBLE PRECISION,
      ${auditColumns('economy_labor_market')}
    );
  `);

  pgm.sql(`
    COMMENT ON TABLE economy_labor_market IS
      'Monthly US labour-market series (Massive /fed/v1/labor-market). '
      'THREE UNITS IN ONE ROW: unemployment_rate and labor_force_participation_rate are percent, '
      'avg_hourly_earnings is dollars per hour, job_openings is THOUSANDS of openings. '
      'Rewritten in full on every feed run.';
  `);
  pgm.sql(`COMMENT ON COLUMN economy_labor_market.job_openings IS 'THOUSANDS of openings — 7359 means 7.36 million. Published by a later survey than its siblings, so it is NULL on the newest row for part of every month. NULL means not yet published; zero would mean the economy stopped hiring.';`);
  pgm.sql(`COMMENT ON COLUMN economy_labor_market.avg_hourly_earnings IS 'Dollars per hour, nominal. Not adjusted for inflation — pair it with economy_inflation to say anything about real wages.';`);

  for (const table of TABLES) {
    pgm.sql(`
      CREATE TRIGGER ${table}_set_updated_at
        BEFORE UPDATE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);
  }

  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_AFTER)});`);
  for (const [feed, schedule] of SCHEDULES) scheduleVendorSyncCron(pgm, feed, schedule);
};

export const down = (pgm: MigrationBuilder): void => {
  for (const [feed] of SCHEDULES) unscheduleVendorSyncCron(pgm, feed);
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_BEFORE)});`);
  for (const table of TABLES) {
    pgm.sql(`DROP TRIGGER IF EXISTS ${table}_set_updated_at ON ${table};`);
    pgm.dropTable(table);
  }
};
