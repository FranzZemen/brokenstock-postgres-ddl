/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * equity-price-retroactive-refresh.prd.md — E1 / E6 / D3 / D5.
 *
 * Convert the price feeds from a self-racing "current_date" cron to a
 * retroactive, watermark-driven PLANNER model, and reschedule them past the
 * vendor publish.
 *
 * BEFORE (Era 5): two cron jobs each fired at 21:35 UTC and INSERTed a single
 * ('equity-prices' | 'options-prices', current_date) job. But Massive publishes
 * session D's equity file at D+1 ~00:30 UTC and its options file at D+1 ~04:00
 * UTC — i.e. HOURS AFTER 21:35 UTC on D. So every weekday the cron asked for a
 * file that would not exist for hours; the feed had not loaded since 6/18.
 *
 * AFTER: the cron enqueues a PLANNER job instead. The worker's planner handler
 * (E3) reads vendor_feed_coverage, enumerates the missing trading days via the
 * market calendar, and fans out one per-date job each (idempotent on
 * (feed_type, scheduled_for_date)). The per-date handler is unchanged.
 *
 *   feed (plan)            schedule (UTC)   ET wall-clock          why
 *   ─────────────────────  ───────────────  ─────────────────────  ────────────────────────
 *   equity-prices-plan     15 1 * * *       20:15 EST / 21:15 EDT  past equity publish (~00:42 UTC tail); same trader-night ET
 *   options-prices-plan    0 5 * * *        00:00 EST / 01:00 EDT  past options publish (~04:00 UTC tail)
 *
 * (Daily, not Mon-Fri: the planner is calendar-aware and simply enqueues nothing
 * on non-trading days, so a fixed daily fire is safe and lets a Friday/holiday
 * gap heal on the next run.)
 *
 * Plan feed_types follow the Era-6 precedent: they are admitted by the DB CHECK
 * but intentionally NOT added to the `VendorSyncFeedType` union (that would force
 * a Kysely-invariance rebuild of the whole @franzzemen closure); the worker casts
 * the two literals at the handler boundary.
 *
 * Seed: insert coverage-row shells for the two per-date feeds with NULL
 * covered_through_date (cold start — the planner's 30-day cap bounds the first
 * run). The E10 start-over resets these explicitly.
 *
 * MIN_SCHEMA_VERSION: bumped to 2026-07-01T150000Z — the worker's planner
 * handlers require the two plan feed_type values to be valid. Sorts LAST (after
 * the two table migrations) so the tables can be applied while this planner
 * activation waits for the E3 worker deploy.
 *
 * ORDER OF APPLICATION: apply only AFTER the vendor-sync-worker with the E3
 * planner handlers is deployed, or the enqueued plan jobs sit unhandled.
 */

import type {MigrationBuilder} from 'node-pg-migrate';
import {scheduleVendorSyncCron, unscheduleVendorSyncCron} from '../vendor-sync-cron.js';

const SYSTEM_OWNER = '00000000-0000-0000-0000-000000000000.user';

// Plan feeds → pg_cron schedule (UTC; see header table).
const PLAN_JOBS: ReadonlyArray<{feed: string; schedule: string}> = [
  {feed: 'equity-prices-plan',  schedule: '15 1 * * *'},
  {feed: 'options-prices-plan', schedule: '0 5 * * *'},
];

// The direct per-date cron jobs being retired (they enqueued current_date).
const RETIRED_DIRECT_FEEDS = ['equity-prices', 'options-prices'] as const;

// NOTE: 'branding-images' is a live feed_type (branding-image-ingestion.prd.md, E6)
// added to the CHECK after the first draft of this list — it MUST be carried through
// both BEFORE and AFTER, or the constraint rebuild rejects the existing branding-images
// job row ("check constraint … is violated by some row").
const FEED_TYPES_BEFORE = [
  'equity-prices', 'options-prices', 'stock-splits-fetch', 'market-calendar',
  'ticker-info', 'ticker-ratios', 'equity-price-repair',
  'security-reference-populate', 'security-reference-refresh', 'branding-images',
];
const FEED_TYPES_AFTER = [...FEED_TYPES_BEFORE, 'equity-prices-plan', 'options-prices-plan'];

// The other vendor-sync crons broken by the same partial-index bug — re-scheduled
// here with the corrected enqueue SQL (schedules unchanged from Era-5/Era-6).
const REPAIR_JOBS: ReadonlyArray<{feed: string; schedule: string}> = [
  {feed: 'stock-splits-fetch',             schedule: '0 11 * * 0'},
  {feed: 'market-calendar',                schedule: '0 13 1 * *'},
  {feed: 'ticker-ratios',                  schedule: '0 7 * * 1-5'},
  {feed: 'security-reference-populate',    schedule: '0 12 * * 0'},
  {feed: 'security-reference-refresh',     schedule: '0 14 1 * *'},
];

const checkSql = (feeds: string[]): string =>
  `feed_type IN (${feeds.map(f => `'${f}'`).join(', ')})`;

export const up = (pgm: MigrationBuilder): void => {
  // 1. Admit the two plan feed_types.
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_AFTER)});`);

  // 2. Retire the direct current_date price crons; schedule the planners.
  for (const feed of RETIRED_DIRECT_FEEDS) unscheduleVendorSyncCron(pgm, feed);
  for (const {feed, schedule} of PLAN_JOBS) scheduleVendorSyncCron(pgm, feed, schedule);

  // 2b. Re-schedule the OTHER vendor-sync crons with the corrected (partial-index)
  // ON CONFLICT — they have all been failing to enqueue since 2026-06-20.
  for (const {feed, schedule} of REPAIR_JOBS) scheduleVendorSyncCron(pgm, feed, schedule);

  // 3. Seed coverage-row shells (cold start; E10 resets explicitly).
  pgm.sql(`
    INSERT INTO vendor_feed_coverage (feed_type, covered_through_date, created_by, updated_by)
    VALUES ('equity-prices', NULL, '${SYSTEM_OWNER}', '${SYSTEM_OWNER}'),
           ('options-prices', NULL, '${SYSTEM_OWNER}', '${SYSTEM_OWNER}')
    ON CONFLICT (feed_type) DO NOTHING;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  // Unschedule the planners; restore the direct 21:35 UTC current_date crons.
  for (const {feed} of PLAN_JOBS) unscheduleVendorSyncCron(pgm, feed);
  for (const feed of RETIRED_DIRECT_FEEDS) scheduleVendorSyncCron(pgm, feed, '35 21 * * 1-5');

  pgm.sql(`DELETE FROM vendor_feed_coverage WHERE feed_type IN ('equity-prices', 'options-prices');`);

  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_BEFORE)});`);
};
