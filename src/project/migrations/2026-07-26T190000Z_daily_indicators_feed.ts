/*
Created by Franz Zemen
License Type: UNLICENSED

`daily-indicators` feed registration (daily-indicators-scanner.prd.md, E4 — D12/D13).

Admits the `daily-indicators` feed_type and schedules its safety-net cron.

WHY A VENDOR-SYNC FEED FOR A JOB THAT CALLS NO VENDOR (D12). It computes
`security_daily_indicators` from bars we already store — zero vendor calls, zero credits.
It rides `vendor_sync_jobs` purely to inherit the admin console: status card, ad-hoc run,
recent runs with counts, live progress bar, and the trading-day calendar. The one internal
chained job that stayed OUT of this registry — nightly-yield-rollup, on pg_chunked_jobs —
needed a hand-written special case in four separate admin routes plus its own bespoke detail
component. The substrate is a job-row table, not a statement about where data comes from.

TRIGGERING (D13). The primary path is a CHAIN: when an `equity-prices` job completes for a
session, the dequeue loop enqueues `daily-indicators` for the same date (the
maybeTriggerBrandingImages single-predecessor pattern). The cron scheduled here at 03:00 UTC
is a SAFETY NET for a misfired chain — by then the 01:15 UTC equity plan and its per-date
jobs have long finished. A cron-fired run with no payload computes the last completed
session; if the chain already did that date, the recompute is idempotent (upsert) and
harmless.

NOT date-addressable-planner shaped: unlike the price feeds there is no per-date fan-out
planner, because the arithmetic is cheap (~0.26 ms per security for 500 bars, ~3 s of CPU
for the whole universe) and the run is entirely I/O-bound. One job walks the securities and
emits every session in its range, so a historical fill is a single job with a wide range
rather than 500 fanned-out ones.

feed_type is admitted by the CHECK but NOT added to the exported VendorSyncFeedType union —
same convention as the plan feeds and the security-reference-* / branding-images feeds; the
worker casts at the boundary to avoid a Kysely-invariance rebuild of the whole closure.

MIN_SCHEMA_VERSION = 2026-07-26T190000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';
import {scheduleVendorSyncCron, unscheduleVendorSyncCron} from '../vendor-sync-cron.js';

const DAILY_INDICATORS = 'daily-indicators';

/** 03:00 UTC — safely past the 01:15 UTC equity plan and its per-date jobs. */
const SCHEDULE = '0 3 * * *';

const FEED_TYPES_BEFORE = [
  'equity-prices', 'options-prices', 'stock-splits-fetch', 'market-calendar',
  'ticker-info', 'ticker-ratios', 'equity-price-repair',
  'security-reference-populate', 'security-reference-refresh', 'branding-images',
  'equity-prices-plan', 'options-prices-plan', 'price-rebase-sweep',
  'security-float-refresh',
  'security-short-interest', 'security-short-volume', 'security-short-volume-plan',
  'ipo-refresh',
];
const FEED_TYPES_AFTER = [...FEED_TYPES_BEFORE, DAILY_INDICATORS];

const checkSql = (feeds: string[]): string =>
  `feed_type IN (${feeds.map((f) => `'${f}'`).join(', ')})`;

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_AFTER)});`);
  scheduleVendorSyncCron(pgm, DAILY_INDICATORS, SCHEDULE);
};

export const down = (pgm: MigrationBuilder): void => {
  unscheduleVendorSyncCron(pgm, DAILY_INDICATORS);
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_BEFORE)});`);
};
