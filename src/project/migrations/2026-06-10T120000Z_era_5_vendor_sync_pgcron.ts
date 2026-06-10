/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Era 5 (2026-06-10) — VENDOR-SYNC SCHEDULING MOVES INTO pg_cron.
 *
 * Replaces the 6 `VendorSync*ShimFunction` lambdas in sam-brokenstock-batch.
 * Each shim was a tiny EventBridge-cron → lambda that did a single
 * `INSERT INTO vendor_sync_jobs (...)` via the Aurora Data API (the lambda
 * lives OUTSIDE the VPC, so Data API was the only way into private Aurora).
 * pg_cron runs INSIDE the database, so it can do that INSERT directly — which
 * lets us delete all 6 Functions + their EventBridge schedules + the shared
 * lambda code. These were the last scheduler lambdas.
 *
 * This migration registers 6 cron jobs (one per feed), each doing the exact
 * same INSERT the shim did:
 *
 *   INSERT INTO vendor_sync_jobs (job_id, feed_type, scheduled_for_date, created_by, updated_by)
 *   VALUES (<uuid>.vendor-sync-job, <feed>, current_date, <SYSTEM_OWNER>, <SYSTEM_OWNER>)
 *   ON CONFLICT (feed_type, scheduled_for_date) DO NOTHING;
 *
 * Row-shape parity with the shim (functions/lambda-vendor-sync-enqueue-shim/src/index.ts):
 *   - job_id            = gen_random_uuid()::text || '.vendor-sync-job'   (shim: randomUUID() + '.vendor-sync-job')
 *   - feed_type         = the literal feed string
 *   - scheduled_for_date= current_date                                     (shim: new Date().toISOString UTC date)
 *   - created_by/updated_by = SYSTEM_OWNER ('00000000-…-000000000000.user')
 *   - everything else defaults (status='queued', attempts=0, NOTIFY trigger fires on INSERT)
 *   - ON CONFLICT (feed_type, scheduled_for_date) DO NOTHING — same double-fire idempotency.
 *
 * scheduled_for_date / current_date: the shim computed the date in UTC for ALL 6
 * feeds (none of the SAM Functions set SCHEDULED_FOR_DATE_TZ, so the default-UTC
 * branch ran). pg_cron's `current_date` is evaluated in the server timezone (UTC),
 * so it produces the identical date. ✓
 *
 * =====================================================================
 * TIMEZONE / DST — the key gotcha.
 * =====================================================================
 * EventBridge schedules were `America/New_York` (DST-aware: ET wall-clock all year).
 * pg_cron cron expressions run in the SERVER timezone (UTC) and are NOT DST-aware.
 * A naive UTC conversion using the summer offset (EDT, UTC-4) would, in winter
 * (EST, UTC-5), fire one hour EARLY in ET terms — which for the post-close
 * equity/options feeds would mean firing BEFORE the 16:00 ET market close.
 *
 * Conversion rule used here: **convert each ET time using the EST offset (UTC-5).**
 * Result: the job fires at the EXACT intended ET wall-clock time in winter (EST),
 * and one hour LATER (in ET terms) in summer (EDT) — i.e. NEVER EARLIER than the
 * intended ET time, in either DST state. For post-close / post-threshold feeds
 * "never earlier" is exactly the safe direction.
 *
 *   ET time (EventBridge)        +5h  UTC (pg_cron)     winter ET / summer ET
 *   ──────────────────────────  ────  ───────────────   ─────────────────────
 *   equity-prices   16:35 Mon-Fri  →  21:35  35 21 * * 1-5   16:35 EST / 17:35 EDT  (post-16:00 close both)
 *   options-prices  16:35 Mon-Fri  →  21:35  35 21 * * 1-5   16:35 EST / 17:35 EDT  (post-close both)
 *   stock-splits    06:00 Sun       →  11:00   0 11 * * 0    06:00 EST / 07:00 EDT  (Sun morning both)
 *   market-calendar 08:00 1st-of-mo →  13:00   0 13 1 * *    08:00 EST / 09:00 EDT  (1st, midday-UTC: no rollover)
 *   ticker-info     07:00 Sun       →  12:00   0 12 * * 0    07:00 EST / 08:00 EDT  (Sun morning both)
 *   ticker-ratios   02:00 Mon-Fri   →  07:00   0  7 * * 1-5  02:00 EST / 03:00 EDT  (pre-market both)
 *
 * Day-of-week / day-of-month rollover check (must hold in BOTH DST states):
 *   - 21:35 UTC → 16:35 EST / 17:35 EDT — same ET calendar day, weekday Mon-Fri holds. ✓
 *   - 11:00/12:00 UTC Sun → 06:00-08:00 ET Sunday morning — same day, Sun holds. ✓
 *   - 13:00 UTC on the 1st → 08:00-09:00 ET on the 1st (midday UTC, far from any
 *     midnight) — no month rollover in either offset. ✓
 *   - 07:00 UTC → 02:00 EST / 03:00 EDT — same ET calendar day, weekday Mon-Fri holds. ✓
 *   (A 02:00-ET time maps to 06:00-07:00 UTC, safely mid-morning UTC, so the UTC
 *    weekday never disagrees with the ET weekday — no Sunday/Saturday bleed.)
 *
 * Note: pg_cron has no native IANA-timezone scheduling on this Aurora, so the
 * fixed-UTC-with-EST-offset approach above is the correct year-round-safe choice.
 *
 * =====================================================================
 * IDEMPOTENCY / RE-RUNNABILITY.
 * =====================================================================
 * Like the era_4_4b as-of-gains-purge job, registration is guarded so the jobs
 * are only created in the database named by `cron.database_name` (pg_cron stores
 * all jobs in one DB regardless of target — prod_blue here). On the registering
 * DB, each job is unschedule-by-jobname-if-exists then re-scheduled, so the
 * migration is safe to re-run. Stable jobnames: `vendor-sync-<feed>`.
 *
 * No table/column changes — does NOT bump MIN_SCHEMA_VERSION.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const SYSTEM_OWNER = '00000000-0000-0000-0000-000000000000.user';

// feed_type → pg_cron schedule (UTC; see DST table in header).
const JOBS: ReadonlyArray<{feed: string; schedule: string}> = [
  {feed: 'equity-prices',      schedule: '35 21 * * 1-5'},
  {feed: 'options-prices',     schedule: '35 21 * * 1-5'},
  {feed: 'stock-splits-fetch', schedule: '0 11 * * 0'},
  {feed: 'market-calendar',    schedule: '0 13 1 * *'},
  {feed: 'ticker-info',        schedule: '0 12 * * 0'},
  {feed: 'ticker-ratios',      schedule: '0 7 * * 1-5'},
];

const jobName = (feed: string): string => `vendor-sync-${feed}`;

// The per-feed enqueue SQL — byte-for-byte the shim's INSERT, parameter-free so
// it can be embedded as a cron job command string.
const enqueueSql = (feed: string): string => `
  INSERT INTO vendor_sync_jobs (job_id, feed_type, scheduled_for_date, created_by, updated_by)
  VALUES (gen_random_uuid()::text || '.vendor-sync-job', '${feed}', current_date, '${SYSTEM_OWNER}', '${SYSTEM_OWNER}')
  ON CONFLICT (feed_type, scheduled_for_date) DO NOTHING;
`.trim();

export const up = (pgm: MigrationBuilder): void => {
  for (const {feed, schedule} of JOBS) {
    const name = jobName(feed);
    // dollar-quote the inner job SQL ($job$) and the outer EXECUTE string ($sql$).
    pgm.sql(`
      DO $do$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
          RAISE NOTICE 'Skipping pg_cron ${name} on %: pg_cron not installed.', current_database();
        ELSIF current_database() <> (SELECT setting FROM pg_settings WHERE name = 'cron.database_name') THEN
          RAISE NOTICE 'Skipping pg_cron ${name} on %: jobs only registered in cron.database_name.', current_database();
        ELSE
          EXECUTE 'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = ''${name}''';
          EXECUTE $sql$SELECT cron.schedule('${name}', '${schedule}', $job$${enqueueSql(feed)}$job$)$sql$;
        END IF;
      END
      $do$;
    `);
  }
};

export const down = (pgm: MigrationBuilder): void => {
  for (const {feed} of JOBS) {
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
  }
};
