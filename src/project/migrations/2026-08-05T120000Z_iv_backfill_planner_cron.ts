/*
Created by Franz Zemen 2026-08-05
License Type: UNLICENSED

Put `security-iv-backfill` on a daily schedule, via a PLANNER
(broken-stock/doc/prd/reference-options-chart.prd.md E14b).

WHY IT NEEDS A SCHEDULE AT ALL. It was registered with none on 2026-08-04, and
that was right for what it then was: a one-time reconstruction of a year of
history. It stopped being right the moment it became the thing that keeps that
history current. Franz, 2026-08-05, on finding the 2026-08-04 session missing
from the console calendar: "anything that updates periodically needs a schedule,
just like every other similar batch job." The gap was real — nothing was ever
going to fill that day, and the volatility rank on the options chart does not
say how old its newest reading is, so the history would have aged silently.

WHY A PLANNER AND NOT A PLAIN CRON. `scheduleVendorSyncCron` enqueues
`current_date`. The OPRA daily file for session D publishes at D+1 ~04:00 UTC,
so a plain cron on this feed would ask every single morning for a file that will
not exist until the next one. That is exactly the self-racing `current_date`
cron the price feeds were converted away from in 2026-07-01T150000Z, where it
had left them not loading since 6/18. The planner reads the coverage watermark,
enumerates the trading days actually missing, and fans out one job per date —
which also means a day missed for any reason heals on the next run rather than
waiting for someone to notice it on a calendar.

SCHEDULE: 07:30 UTC daily, and every part of that is from a measurement.
  - The OPRA file for session D lands D+1 ~04:00 UTC (2026-07-01T150000Z).
  - The session's equity prices — which the handler needs for every underlying's
    close — ran 01:15 → 05:15 UTC when measured on 2026-07-28, about four hours
    for ~12,000 securities.
  - `economy-treasury-yields` runs at 06:00 UTC and supplies the session's
    risk-free rate.
  - `daily-indicators` runs at 07:00 UTC. One worker runs one job at a time, so
    07:30 stays clear of it rather than queueing behind it.
Daily rather than Mon-Fri: the planner is calendar-aware and enumerates nothing
on a non-trading day, so a fixed daily fire is safe and lets a Friday or holiday
gap heal on the next run.

AUTO-SKIP IS OFF for this feed, and that is the one thing not to "tidy up". The
planner's cap writes a still-uncovered date off as permanently lost, which is
correct for sources that publish a rolling window. The OPRA file does not age
out — its history reaches 2016 — and these readings are DERIVED rather than
captured, so an old uncovered date is a date to fill. A skip would also make it
unreachable, because a skipped date counts as covered and the planner never
looks at it again.

ORDER OF APPLICATION: apply only AFTER a vendor-sync-worker carrying
`securityIvBackfillPlanHandler` is deployed, or the first cron fire enqueues a
plan job no handler can claim, which sits in the queue and shows red on the
console until a worker catches up.

NO MIN_SCHEMA_VERSION BUMP, deliberately, following the precedent this file's
own history sets for cron migrations (`schema-version.ts`: the 2026-07-01 planner
crons were likewise not pinned). The worker does not INSERT plan rows — the cron
does — so a worker running ahead of this migration simply holds a handler for a
feed type that cannot yet exist, which is harmless. Pinning would invert the
required order and refuse to boot the very worker this migration waits for.
*/

import type {MigrationBuilder} from 'node-pg-migrate';
import {scheduleVendorSyncCron, unscheduleVendorSyncCron} from '../vendor-sync-cron.js';

const SYSTEM_OWNER = '00000000-0000-0000-0000-000000000000.user';

const PLAN_FEED = 'security-iv-backfill-plan';
const PER_DATE_FEED = 'security-iv-backfill';

/** See the header — after the options file, the equity load, and the treasury rate. */
const SCHEDULE = '30 7 * * *';

/*
 * The feed_type CHECK, restated in full. The plan feed follows the Era-6
 * precedent: admitted by the CHECK but deliberately NOT added to the
 * `VendorSyncFeedType` union, because widening that type forces a
 * Kysely-invariance rebuild of the entire @franzzemen closure for one string.
 * The worker casts the literal at the handler boundary.
 */
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
const FEED_TYPES_AFTER = [...FEED_TYPES_BEFORE, PLAN_FEED];

const checkSql = (feeds: string[]): string =>
  `feed_type IN (${feeds.map((f) => `'${f}'`).join(', ')})`;

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_AFTER)});`);

  /*
   * Seed the coverage watermark at the last session the 2026-08-04 reconstruction
   * actually landed, so the first scheduled run plans forward from real coverage
   * rather than cold-starting 30 days back and re-enqueuing sessions that are
   * already complete. Those re-runs would be harmless — the writes are idempotent
   * — but they would cost an hour of queue and make the first night look like a
   * fault on the calendar.
   *
   * COALESCE guards a database where the reconstruction never ran (dev_franz):
   * NULL is the cold-start value and the planner's 30-day cap bounds it.
   */
  pgm.sql(`
    INSERT INTO vendor_feed_coverage (feed_type, covered_through_date, created_by, updated_by)
    VALUES (
      '${PER_DATE_FEED}',
      (SELECT max(closing_date) FROM security_implied_volatility),
      '${SYSTEM_OWNER}', '${SYSTEM_OWNER}'
    )
    ON CONFLICT (feed_type) DO NOTHING;
  `);

  scheduleVendorSyncCron(pgm, PLAN_FEED, SCHEDULE);
};

export const down = (pgm: MigrationBuilder): void => {
  unscheduleVendorSyncCron(pgm, PLAN_FEED);
  pgm.sql(`DELETE FROM vendor_feed_coverage WHERE feed_type = '${PER_DATE_FEED}';`);
  // Any queued plan rows must go before the CHECK narrows, or the constraint
  // cannot be re-added.
  pgm.sql(`DELETE FROM vendor_sync_jobs WHERE feed_type = '${PLAN_FEED}';`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_BEFORE)});`);
};
