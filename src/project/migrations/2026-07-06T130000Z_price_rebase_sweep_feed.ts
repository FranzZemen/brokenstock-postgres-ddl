/*
Created by Franz Zemen 2026-07-06
License Type: UNLICENSED

Equity Price Feed Reliability + Ad-Hoc Refresh (equity-price-feed-reliability-and-
adhoc-refresh.prd.md — E4/D7).

Adds the `price-rebase-sweep` vendor-sync feed — the PERIODIC global split-rebase
safety-net. The equity-prices handler used to run a full `prices_equity × stock_splits`
reconciliation at the tail of EVERY load; that moves to a scoped per-backfill rebase in
the handler, and this weekly sweep becomes the net for under-watermark bars written by
OTHER writers (the on-demand REST `putAdjustedBars` path — the DD/cross-writer class).

Changes:
  1. Extend the vendor_sync_jobs.feed_type CHECK to admit 'price-rebase-sweep'.
  2. pg_cron: schedule the sweep weekly (Sat 08:00 UTC — off the Sun 11:00 splits fetch
     and the nightly ~01:15/05:00 price plans). Uses the predicate-qualified ON CONFLICT
     required by the partial dedupe index.

NOTE (schema-types): 'price-rebase-sweep' is NOT added to the exported VendorSyncFeedType
union — mirrors the branding-images / plan-feed NOTE (cast at the worker boundary; the
CHECK enforces it; no npmu cascade).

Bumps MIN_SCHEMA_VERSION = 2026-07-06T130000Z: the worker's price-rebase-sweep handler
enqueues/claims this feed_type, which older schemas reject.
*/

import type {MigrationBuilder} from 'node-pg-migrate';
import {scheduleVendorSyncCron, unscheduleVendorSyncCron} from '../vendor-sync-cron.js';

const SYSTEM_OWNER = '00000000-0000-0000-0000-000000000000.user';

const SWEEP_FEED = 'price-rebase-sweep';
const SWEEP_SCHEDULE = '0 8 * * 6'; // Saturday 08:00 UTC, weekly

const FEED_TYPES_BEFORE = [
  'equity-prices', 'options-prices', 'stock-splits-fetch', 'market-calendar',
  'ticker-info', 'ticker-ratios', 'equity-price-repair',
  'security-reference-populate', 'security-reference-refresh', 'branding-images',
  'equity-prices-plan', 'options-prices-plan',
];
const FEED_TYPES_AFTER = [...FEED_TYPES_BEFORE, SWEEP_FEED];

const checkSql = (feeds: string[]): string =>
  `feed_type IN (${feeds.map((f) => `'${f}'`).join(', ')})`;

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_AFTER)});`);
  scheduleVendorSyncCron(pgm, SWEEP_FEED, SWEEP_SCHEDULE);
};

export const down = (pgm: MigrationBuilder): void => {
  unscheduleVendorSyncCron(pgm, SWEEP_FEED);
  // Fold any sweep rows to a retained feed_type so the narrower CHECK holds.
  pgm.sql(`DELETE FROM vendor_sync_jobs WHERE feed_type = '${SWEEP_FEED}';`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_BEFORE)});`);
};
