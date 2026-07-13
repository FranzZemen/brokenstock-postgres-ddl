/*
Created by Franz Zemen
License Type: UNLICENSED

Era 6 / C04 — vendor-sync reference feeds.

Two new vendor-sync feeds replace the now-dead `ticker-info` feed (which fed the
dropped `ticker_data_company_info` table):

  - security-reference-populate  (weekly)  — discover the active US-stock universe,
      create missing securities via the orchestrator chokepoint, upsert
      security_reference, enrich newly-seen tickers.
  - security-reference-refresh   (monthly) — delta-gate on vendor last_updated_utc;
      re-enrich only changed tickers; mark delisted (never delete).

Changes:
  1. Extend the vendor_sync_jobs.feed_type CHECK to admit the two new feeds.
     `ticker-info` stays in the CHECK (historical rows) but is no longer scheduled
     or handled (its handler is removed in the worker).
  2. pg_cron: unschedule the dead `vendor-sync-ticker-info` job; schedule the two
     new feeds (UTC; DST notes per the Era-5 vendor-sync pg_cron migration).

Bumps MIN_SCHEMA_VERSION = 2026-06-20T130000Z (the worker's new handlers require
the new feed_type values to be valid).
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const SYSTEM_OWNER = '00000000-0000-0000-0000-000000000000.user';

// feed_type → pg_cron schedule (UTC). populate weekly (Sun 12:00 UTC), refresh
// monthly (1st 14:00 UTC). Cadence per Era-6 super-PRD D8.
const NEW_JOBS: ReadonlyArray<{feed: string; schedule: string}> = [
  {feed: 'security-reference-populate', schedule: '0 12 * * 0'},
  {feed: 'security-reference-refresh',  schedule: '0 14 1 * *'},
];

const FEED_TYPES_AFTER = [
  'equity-prices', 'options-prices', 'stock-splits-fetch', 'market-calendar',
  'ticker-info', 'ticker-ratios', 'equity-price-repair',
  'security-reference-populate', 'security-reference-refresh',
];
const FEED_TYPES_BEFORE = [
  'equity-prices', 'options-prices', 'stock-splits-fetch', 'market-calendar',
  'ticker-info', 'ticker-ratios', 'equity-price-repair',
];

const jobName = (feed: string): string => `vendor-sync-${feed}`;

// ⚠️ HISTORICAL — DO NOT COPY THIS AS A TEMPLATE.
// The bare `ON CONFLICT (cols)` below was CORRECT when this migration was written: the
// dedupe index was a FULL unique index then. Since 2026-06-20T150000Z it is PARTIAL, and
// a bare ON CONFLICT no longer matches it — every cron carrying this form aborts on each
// fire ("no unique or exclusion constraint matching the ON CONFLICT specification").
// The crons registered here were re-scheduled with the corrected SQL by
// 2026-07-01T150000Z, so this file's form is inert; it is left intact only because it is
// what actually ran at the time.
// NEW cron migrations MUST use `scheduleVendorSyncCron` from ../vendor-sync-cron.ts.
const enqueueSql = (feed: string): string => `
  INSERT INTO vendor_sync_jobs (job_id, feed_type, scheduled_for_date, created_by, updated_by)
  VALUES (gen_random_uuid()::text || '.vendor-sync-job', '${feed}', current_date, '${SYSTEM_OWNER}', '${SYSTEM_OWNER}')
  ON CONFLICT (feed_type, scheduled_for_date) DO NOTHING;
`.trim();

const checkSql = (feeds: string[]): string =>
  `feed_type IN (${feeds.map(f => `'${f}'`).join(', ')})`;

const schedule = (pgm: MigrationBuilder, feed: string, sched: string): void => {
  const name = jobName(feed);
  pgm.sql(`
    DO $do$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE NOTICE 'Skipping pg_cron ${name} on %: pg_cron not installed.', current_database();
      ELSIF current_database() <> (SELECT setting FROM pg_settings WHERE name = 'cron.database_name') THEN
        RAISE NOTICE 'Skipping pg_cron ${name} on %: jobs only registered in cron.database_name.', current_database();
      ELSE
        EXECUTE 'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = ''${name}''';
        EXECUTE $sql$SELECT cron.schedule('${name}', '${sched}', $job$${enqueueSql(feed)}$job$)$sql$;
      END IF;
    END
    $do$;
  `);
};

const unschedule = (pgm: MigrationBuilder, feed: string): void => {
  const name = jobName(feed);
  pgm.sql(`
    DO $do$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
         AND current_database() = (SELECT setting FROM pg_settings WHERE name = 'cron.database_name') THEN
        EXECUTE 'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = ''${name}''';
      END IF;
    END
    $do$;
  `);
};

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_AFTER)});`);

  // Retire the dead ticker-info feed (its target table ticker_data_company_info is dropped).
  unschedule(pgm, 'ticker-info');

  for (const {feed, schedule: sched} of NEW_JOBS) schedule(pgm, feed, sched);
};

export const down = (pgm: MigrationBuilder): void => {
  for (const {feed} of NEW_JOBS) unschedule(pgm, feed);

  // Restore the ticker-info schedule (Era-5 cadence: Sun 12:00 UTC).
  schedule(pgm, 'ticker-info', '0 12 * * 0');

  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_BEFORE)});`);
};
