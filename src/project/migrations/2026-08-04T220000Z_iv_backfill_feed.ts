/*
Created by Franz Zemen 2026-08-04
License Type: UNLICENSED

`security-iv-backfill` feed registration
(broken-stock/doc/prd/reference-options-chart.prd.md E14b).

Admits the feed type. Deliberately schedules NO cron.

WHY NO CRON. This is a one-time historical reconstruction, not an ongoing feed.
Jobs are enqueued per session over a chosen window and then the work is done;
a schedule would either re-run finished dates forever or sit idle. The nightly
`security-iv-snapshot` is the ongoing half, and it already has its own schedule.

WHY IT IS DATE-ADDRESSABLE. The input is one OPRA flat file per trading date, so
the session is the natural unit of work — a partial backfill resumes, a single
bad day re-runs, and progress is visible per date in the admin console rather
than as one opaque multi-hour job.

MIN_SCHEMA_VERSION = 2026-08-04T220000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const IV_BACKFILL = 'security-iv-backfill';

const FEED_TYPES_BEFORE = [
  'equity-prices', 'options-prices', 'stock-splits-fetch', 'market-calendar',
  'ticker-info', 'ticker-ratios', 'equity-price-repair',
  'security-reference-populate', 'security-reference-refresh', 'branding-images',
  'equity-prices-plan', 'options-prices-plan', 'price-rebase-sweep',
  'security-float-refresh',
  'security-short-interest', 'security-short-volume', 'security-short-volume-plan',
  'ipo-refresh', 'daily-indicators', 'price-discontinuity-audit',
  'security-iv-snapshot', 'economy-treasury-yields',
];
const FEED_TYPES_AFTER = [...FEED_TYPES_BEFORE, IV_BACKFILL];

const checkSql = (feeds: string[]): string =>
  `feed_type IN (${feeds.map((f) => `'${f}'`).join(', ')})`;

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_AFTER)});`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_BEFORE)});`);
};
