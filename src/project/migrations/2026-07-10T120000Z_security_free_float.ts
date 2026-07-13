/*
Created by Franz Zemen
License Type: UNLICENSED

Security Free-Float Feed (PRD: projects/doc/prd/security-free-float-feed.prd.md, E1).

Massive's free float (`GET /stocks/vX/float`) is a company fact — the tradable-supply
sibling of shares_outstanding — so it lands on the existing security_reference table
rather than a new table.

Changes:
  1. Add three nullable columns to security_reference:
       free_float             DOUBLE PRECISION  (Massive results[].free_float)
       free_float_percent     DOUBLE PRECISION  (Massive results[].free_float_percent)
       float_effective_date   DATE              (Massive results[].effective_date)
     Placed after weighted_shares_outstanding (fundamentals block). DOUBLE (not INT)
     for free_float — values like 15e9 overflow int4; mirrors shares_outstanding.
  2. Extend the vendor_sync_jobs.feed_type CHECK to admit 'security-float-refresh'.
  3. pg_cron: schedule the weekly float feed at Sun 16:00 UTC — after
     security-reference-populate (Sun 12:00 UTC) so newly-added securities already
     have a row for float to attach to (PRD D7, D13).

NOTE (schema-types): 'security-float-refresh' is NOT added to the exported
VendorSyncFeedType union — same convention as security-reference-* / branding-images /
price-rebase-sweep. The worker casts the literal at the handler boundary; this avoids a
full Kysely-invariance closure rebuild for one enum value.

Bumps MIN_SCHEMA_VERSION = 2026-07-10T120000Z: the worker's security-float-refresh
handler requires the new feed_type value to be valid and the three columns to exist.
*/

import type {MigrationBuilder} from 'node-pg-migrate';
import {scheduleVendorSyncCron, unscheduleVendorSyncCron} from '../vendor-sync-cron.js';

const SYSTEM_OWNER = '00000000-0000-0000-0000-000000000000.user';

const FLOAT_FEED = 'security-float-refresh';
const FLOAT_SCHEDULE = '0 16 * * 0'; // Sunday 16:00 UTC, weekly — after the reference feeds.

const FEED_TYPES_BEFORE = [
  'equity-prices', 'options-prices', 'stock-splits-fetch', 'market-calendar',
  'ticker-info', 'ticker-ratios', 'equity-price-repair',
  'security-reference-populate', 'security-reference-refresh', 'branding-images',
  'equity-prices-plan', 'options-prices-plan', 'price-rebase-sweep',
];
const FEED_TYPES_AFTER = [...FEED_TYPES_BEFORE, FLOAT_FEED];

const checkSql = (feeds: string[]): string =>
  `feed_type IN (${feeds.map((f) => `'${f}'`).join(', ')})`;

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE security_reference
      ADD COLUMN IF NOT EXISTS free_float           DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS free_float_percent   DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS float_effective_date DATE;
  `);

  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_AFTER)});`);

  scheduleVendorSyncCron(pgm, FLOAT_FEED, FLOAT_SCHEDULE);
};

export const down = (pgm: MigrationBuilder): void => {
  unscheduleVendorSyncCron(pgm, FLOAT_FEED);

  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_BEFORE)});`);

  pgm.sql(`
    ALTER TABLE security_reference
      DROP COLUMN IF EXISTS free_float,
      DROP COLUMN IF EXISTS free_float_percent,
      DROP COLUMN IF EXISTS float_effective_date;
  `);
};
