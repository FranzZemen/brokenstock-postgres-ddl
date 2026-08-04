/*
Created by Franz Zemen 2026-08-04
License Type: UNLICENSED

`economy_treasury_yields` table + `economy-treasury-yields` feed registration
(projects/doc/prd/economy-indicators.prd.md E1).

WHY THIS EXISTS. `reference-options-chart.prd.md` E14 derives implied volatility
itself, because the vendor sells implied volatility for the current moment only
and returns 0 for any past date. Working backwards from an option's price to a
volatility needs a risk-free rate, and this platform stores none. The 1-month
Treasury constant-maturity yield is that rate.

WHY EVERY MATURITY IS NULLABLE. Massive OMITS a maturity it has no value for
rather than sending null, and the short end has not always existed: `yield_1_month`
begins 2001-07-31 (6,252 of 16,130 rows carry it), and before that `yield_3_month`
is the shortest published. A NOT NULL here would reject two thirds of history.

WHY ONLY SEVEN COLUMNS. Massive's published response table documents eleven
maturities. Four of them — 6-month, 3-year, 7-year and 20-year — appear on NO row
across the entire 1962→2026 history (probed 2026-08-04, `financial-api/tools/
economy-probe.mjs`). Columns for those would be permanently null and read as a
feed defect to whoever found them later, so they are deliberately absent (PRD
D13). If the vendor starts sending them, a migration adds them then.

VALUES ARE PERCENT, NOT FRACTIONS. `3.78` means 3.78%. This matches the vendor
byte for byte on purpose (PRD D6): the stored table stays directly checkable
against the source, which is the only leverage available when a number looks
wrong. The single conversion to a fraction lives with the pricing math. Fed
straight into an option model this does not fail loudly — it produces implied
volatilities that look entirely plausible.

WHY NO SECURITY KEY, NO OWNER SCOPE. This is macroeconomic data. It is the same
for every user and belongs to no security, which is why the primary key is the
observation date alone.

THE FEED PULLS EVERYTHING, EVERY RUN. The whole series returns in ONE unpaged
response (measured: 16,130 rows), so the handler re-fetches all of it and upserts
rather than tracking a watermark (PRD D2). The consequence worth stating: this
feed is self-repairing. A run that dies halfway, a worker that is down for a week,
a deploy mid-job — all are fixed by the next run with no operator action. That is
the OPPOSITE of `security-iv-snapshot`, where a missed session is permanent, and
the two must not be reasoned about the same way.

CRON AT 06:00 UTC. The vendor updates daily and the newest row is the prior
completed session, so there is no market-close dependency at all. 06:00 UTC sits
clear of the 01:15 UTC equity plan and the 03:00 UTC indicator run, so a slow day
upstream cannot delay it — and because the job is idempotent and re-fetches
everything, the exact time carries none of the significance it does for a
capture feed.

feed_type is admitted by the CHECK but NOT added to the exported
`VendorSyncFeedType` union — same convention as every feed since
`price-rebase-sweep`; the worker casts at the handler boundary to avoid a
Kysely-invariance rebuild of the whole package closure.

MIN_SCHEMA_VERSION = 2026-08-04T120000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';
import {scheduleVendorSyncCron, unscheduleVendorSyncCron} from '../vendor-sync-cron.js';

const TREASURY_YIELDS = 'economy-treasury-yields';

/** 06:00 UTC daily — clear of the 01:15 equity plan and the 03:00 indicator run. */
const SCHEDULE = '0 6 * * *';

const FEED_TYPES_BEFORE = [
  'equity-prices', 'options-prices', 'stock-splits-fetch', 'market-calendar',
  'ticker-info', 'ticker-ratios', 'equity-price-repair',
  'security-reference-populate', 'security-reference-refresh', 'branding-images',
  'equity-prices-plan', 'options-prices-plan', 'price-rebase-sweep',
  'security-float-refresh',
  'security-short-interest', 'security-short-volume', 'security-short-volume-plan',
  'ipo-refresh', 'daily-indicators', 'price-discontinuity-audit',
  'security-iv-snapshot',
];
const FEED_TYPES_AFTER = [...FEED_TYPES_BEFORE, TREASURY_YIELDS];

const checkSql = (feeds: string[]): string =>
  `feed_type IN (${feeds.map((f) => `'${f}'`).join(', ')})`;

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE economy_treasury_yields (
      -- The observation date IS the identity. Macro data belongs to no security
      -- and to no user.
      observation_date DATE NOT NULL PRIMARY KEY,
      -- ALL VALUES ARE PERCENT: 3.78 means 3.78%. Option pricing needs 0.0378
      -- and must divide by 100 at the point of use. Every maturity is nullable
      -- because the vendor omits what it has no value for.
      --
      -- The maturity that matters operationally: 1-month is the discount horizon
      -- for the 30-day constant-maturity implied-volatility capture. Using the
      -- 10-year here because it is the familiar headline number would price a
      -- 30-day option against a 10-year rate.
      yield_1_month    DOUBLE PRECISION,
      yield_3_month    DOUBLE PRECISION,
      yield_1_year     DOUBLE PRECISION,
      yield_2_year     DOUBLE PRECISION,
      yield_5_year     DOUBLE PRECISION,
      yield_10_year    DOUBLE PRECISION,
      yield_30_year    DOUBLE PRECISION,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by       TEXT NOT NULL,
      updated_by       TEXT NOT NULL,
      CONSTRAINT economy_treasury_yields_created_by_format_chk
        CHECK (created_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$'),
      CONSTRAINT economy_treasury_yields_updated_by_format_chk
        CHECK (updated_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$')
    );
  `);

  pgm.sql(`
    COMMENT ON TABLE economy_treasury_yields IS
      'US Treasury constant-maturity yields by observation date (Massive /fed/v1/treasury-yields). '
      'ALL YIELD COLUMNS ARE PERCENT, NOT FRACTIONS: 3.78 means 3.78%. '
      'Rewritten in full on every feed run; a missing date is a date the vendor never published.';
  `);
  pgm.sql(`
    COMMENT ON COLUMN economy_treasury_yields.yield_1_month IS
      'Percent. The risk-free rate for 30-day option pricing. Begins 2001-07-31; NULL on every earlier row.';
  `);

  pgm.sql(`
    CREATE TRIGGER economy_treasury_yields_set_updated_at
      BEFORE UPDATE ON economy_treasury_yields
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_AFTER)});`);
  scheduleVendorSyncCron(pgm, TREASURY_YIELDS, SCHEDULE);
};

export const down = (pgm: MigrationBuilder): void => {
  unscheduleVendorSyncCron(pgm, TREASURY_YIELDS);
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_BEFORE)});`);
  pgm.sql(`DROP TRIGGER IF EXISTS economy_treasury_yields_set_updated_at ON economy_treasury_yields;`);
  pgm.dropTable('economy_treasury_yields');
};
