/*
Created by Franz Zemen
License Type: UNLICENSED

Short Interest & Short Volume Feeds (PRD: projects/doc/prd/short-interest-and-short-volume-feeds.prd.md, E1).

Two Massive short-sentiment feeds, kept as DATED HISTORY (graphable trend) — cloned
from the prices_equity template (composite PK on security_key + a date; DOUBLE
PRECISION numerics; FK CASCADE to securities; .user-format actor CHECKs; set_updated_at
trigger). NOT columns on security_reference (float's snapshot model is wrong here).

  - security_short_interest  (security_key, settlement_date) — FINRA bi-weekly.
  - security_short_volume    (security_key, trade_date)      — FINRA daily.

Changes:
  1. Create the two tables.
  2. Extend the vendor_sync_jobs.feed_type CHECK to admit:
       security-short-interest        (weekly, read-only run-history calendar)
       security-short-volume          (daily, date-addressable calendar)
       security-short-volume-plan      (daily planner — never-lose-a-day fan-out)
  3. pg_cron: security-short-interest weekly Sun 18:00 UTC (after the float feed at
     16:00); security-short-volume-plan daily 11:00 UTC (~06:00-07:00 ET — the prior
     trading day's short volume is reliably published by then).

feed_type literals are admitted by the CHECK but NOT added to the exported
VendorSyncFeedType union (worker casts at the boundary — same convention as the
security-reference-* / branding-images / security-float-refresh feeds).

Bumps MIN_SCHEMA_VERSION = 2026-07-10T140000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const SYSTEM_OWNER = '00000000-0000-0000-0000-000000000000.user';
const USER_FMT = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$';

const NEW_JOBS: ReadonlyArray<{feed: string; schedule: string}> = [
  {feed: 'security-short-interest',    schedule: '0 18 * * 0'}, // Sun 18:00 UTC, after float (16:00)
  {feed: 'security-short-volume-plan', schedule: '0 11 * * *'}, // daily 11:00 UTC (~06:00-07:00 ET)
];

const FEED_TYPES_BEFORE = [
  'equity-prices', 'options-prices', 'stock-splits-fetch', 'market-calendar',
  'ticker-info', 'ticker-ratios', 'equity-price-repair',
  'security-reference-populate', 'security-reference-refresh', 'branding-images',
  'equity-prices-plan', 'options-prices-plan', 'price-rebase-sweep',
  'security-float-refresh',
];
const FEED_TYPES_AFTER = [
  ...FEED_TYPES_BEFORE,
  'security-short-interest', 'security-short-volume', 'security-short-volume-plan',
];

const jobName = (feed: string): string => `vendor-sync-${feed}`;

const checkSql = (feeds: string[]): string =>
  `feed_type IN (${feeds.map((f) => `'${f}'`).join(', ')})`;

const enqueueSql = (feed: string): string => `
  INSERT INTO vendor_sync_jobs (job_id, feed_type, scheduled_for_date, created_by, updated_by)
  VALUES (gen_random_uuid()::text || '.vendor-sync-job', '${feed}', current_date, '${SYSTEM_OWNER}', '${SYSTEM_OWNER}')
  ON CONFLICT (feed_type, scheduled_for_date) DO NOTHING;
`.trim();

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

const createTable = (pgm: MigrationBuilder, table: string, dateCol: string, cols: string): void => {
  pgm.sql(`
    CREATE TABLE ${table} (
      security_key  TEXT NOT NULL REFERENCES securities(key) ON DELETE CASCADE,
      ${dateCol}    DATE NOT NULL,
      ${cols}
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by    TEXT NOT NULL,
      updated_by    TEXT NOT NULL,
      PRIMARY KEY (security_key, ${dateCol}),
      CONSTRAINT ${table}_created_by_format_chk CHECK (created_by ~ '${USER_FMT}'),
      CONSTRAINT ${table}_updated_by_format_chk CHECK (updated_by ~ '${USER_FMT}')
    );
  `);
  pgm.sql(`
    CREATE TRIGGER ${table}_set_updated_at BEFORE UPDATE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const up = (pgm: MigrationBuilder): void => {
  createTable(pgm, 'security_short_interest', 'settlement_date', `
      short_interest    DOUBLE PRECISION,
      avg_daily_volume  DOUBLE PRECISION,
      days_to_cover     DOUBLE PRECISION,`);

  createTable(pgm, 'security_short_volume', 'trade_date', `
      short_volume        DOUBLE PRECISION,
      total_volume        DOUBLE PRECISION,
      short_volume_ratio  DOUBLE PRECISION,
      exempt_volume       DOUBLE PRECISION,
      non_exempt_volume   DOUBLE PRECISION,`);

  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_AFTER)});`);

  for (const {feed, schedule: sched} of NEW_JOBS) schedule(pgm, feed, sched);
};

export const down = (pgm: MigrationBuilder): void => {
  for (const {feed} of NEW_JOBS) unschedule(pgm, feed);

  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_BEFORE)});`);

  pgm.sql(`DROP TRIGGER IF EXISTS security_short_volume_set_updated_at ON security_short_volume;`);
  pgm.dropTable('security_short_volume', {ifExists: true});
  pgm.sql(`DROP TRIGGER IF EXISTS security_short_interest_set_updated_at ON security_short_interest;`);
  pgm.dropTable('security_short_interest', {ifExists: true});
};
