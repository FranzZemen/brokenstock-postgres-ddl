/*
Created by Franz Zemen
License Type: UNLICENSED

At-the-money implied volatility history + its nightly feed
(broken-stock/doc/prd/reference-options-chart.prd.md, E12 / D19).

WHY THIS TABLE EXISTS AT ALL, WHEN THE SAME PRD REFUSED TO STORE OPTION BARS.

Per-contract implied-volatility history cannot be obtained at any price: the
daily OPRA flat file carries OHLC and volume only, the historical-quote endpoint
hardcodes implied volatility to 0, and greeks come solely from snapshot
endpoints, which are current-moment. So volatility for a contract can only ever
be captured going FORWARD, and only for the underlyings we choose to sample.

That makes this the only volatility context the product can ever have. Without
it a falling premium is unexplainable — ordinary time decay, a post-earnings
volatility collapse and the underlying drifting all look identical on a price
chart, and they call for three different actions.

The cost is three orders of magnitude below the option-bar table that was
rejected: ~5,200 optionable underlyings × 252 sessions ≈ 1.3M rows/year, against
83M/year for storing every traded contract.

ONE ROW PER UNDERLYING PER SESSION, not per contract. Rank is a property of the
underlying's own volatility over time; a per-contract series would be both
unobtainable and the wrong shape.

NULLABLE `atm_iv`. A session where the vendor returned no usable at-the-money
implied volatility is recorded with NULL rather than skipped, so a later reader
can tell "we looked and there was nothing" from "we never looked". Rank
computation must exclude NULLs rather than treat them as zero — a zero would be
the lowest possible volatility and would drag every percentile.

MIN_SCHEMA_VERSION = 2026-08-01T220000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';
import {scheduleVendorSyncCron, unscheduleVendorSyncCron} from '../vendor-sync-cron.js';

const IV_SNAPSHOT = 'security-iv-snapshot';

/**
 * 22:10 UTC weekdays — after the 21:35 UTC options-prices run, and late enough
 * that the US session has closed and the chain snapshot reflects a settled book.
 */
const SCHEDULE = '10 22 * * 1-5';

const FEED_TYPES_BEFORE = [
  'equity-prices', 'options-prices', 'stock-splits-fetch', 'market-calendar',
  'ticker-info', 'ticker-ratios', 'equity-price-repair',
  'security-reference-populate', 'security-reference-refresh', 'branding-images',
  'equity-prices-plan', 'options-prices-plan', 'price-rebase-sweep',
  'security-float-refresh',
  'security-short-interest', 'security-short-volume', 'security-short-volume-plan',
  'ipo-refresh', 'daily-indicators', 'price-discontinuity-audit',
];
const FEED_TYPES_AFTER = [...FEED_TYPES_BEFORE, IV_SNAPSHOT];

const checkSql = (feeds: string[]): string =>
  `feed_type IN (${feeds.map((f) => `'${f}'`).join(', ')})`;

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE security_implied_volatility (
      security_key    TEXT NOT NULL REFERENCES securities(key) ON DELETE CASCADE,
      closing_date    DATE NOT NULL,
      -- At-the-money implied volatility as a decimal (0.24 = 24%). NULL means
      -- we sampled and the vendor had nothing usable — NOT that volatility was
      -- zero. Readers must exclude NULLs from percentile arithmetic.
      atm_iv          DOUBLE PRECISION,
      -- The expiration the at-the-money contract came from, so a later reader
      -- can tell a 7-day sample from a 45-day one; term structure means the two
      -- are not comparable.
      expiration_date DATE,
      -- Days to that expiration at capture. Kept alongside expiration_date
      -- because it is what makes samples comparable without recomputing.
      days_to_expiry  INTEGER,
      -- Underlying price at capture, so an at-the-money selection can be audited
      -- after the fact.
      underlying_price DOUBLE PRECISION,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by      TEXT NOT NULL,
      updated_by      TEXT NOT NULL,
      PRIMARY KEY (security_key, closing_date),
      CONSTRAINT security_implied_volatility_created_by_format_chk
        CHECK (created_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$'),
      CONSTRAINT security_implied_volatility_updated_by_format_chk
        CHECK (updated_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$')
    );
  `);
  // Rank reads a single security's trailing year, so the PK's leading column
  // already serves them. This index serves the other direction: "every
  // security's volatility for one session", which is what a scanner would ask.
  pgm.sql(`
    CREATE INDEX security_implied_volatility_date_idx
      ON security_implied_volatility (closing_date);
  `);
  pgm.sql(`
    CREATE TRIGGER security_implied_volatility_set_updated_at
      BEFORE UPDATE ON security_implied_volatility
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_AFTER)});`);
  scheduleVendorSyncCron(pgm, IV_SNAPSHOT, SCHEDULE);
};

export const down = (pgm: MigrationBuilder): void => {
  unscheduleVendorSyncCron(pgm, IV_SNAPSHOT);
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_BEFORE)});`);
  pgm.sql(`DROP TRIGGER IF EXISTS security_implied_volatility_set_updated_at ON security_implied_volatility;`);
  pgm.dropTable('security_implied_volatility');
};
