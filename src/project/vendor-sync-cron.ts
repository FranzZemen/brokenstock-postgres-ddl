/*
Created by Franz Zemen 2026-07-13
License Type: UNLICENSED

Shared pg_cron helpers for the `vendor_sync_jobs` feed crons.

WHY THIS EXISTS — the ON CONFLICT predicate has now been got wrong twice, and both times
it silently killed every cron it touched for weeks:

  - 2026-06-20: the Admin Batch Control migration replaced the FULL unique dedupe index on
    (feed_type, scheduled_for_date) with a PARTIAL one. Every cron's enqueue SQL kept the
    bare `ON CONFLICT (cols)` — which does NOT match a partial index — so every vendor-sync
    cron began failing with "there is no unique or exclusion constraint matching the ON
    CONFLICT specification". 2026-07-01T150000Z found and repaired them.
  - 2026-07-10: the three new feed migrations (free-float, short-interest/volume, IPO) were
    each written by copying a neighbouring migration, and re-introduced the bare form. All
    four crons they registered failed on EVERY fire until 2026-07-13T120000Z repaired them.
    The short-volume planner never ran once, so its never-lose-a-day self-heal never fired
    and a publish-lag day (2026-07-10) sat permanently red.

The root cause both times was the same: each cron migration carried its OWN copy-pasted
copy of the enqueue SQL and the pg_cron DO-block, so the predicate had to be got right N
times independently. It is now defined exactly ONCE, here.

**Every new vendor-sync cron migration MUST use `scheduleVendorSyncCron` — never hand-roll
the SQL.** The predicate is not optional and it is not obvious; that is precisely why it
keeps getting dropped.

This module deliberately lives OUTSIDE `migrations/`: node-pg-migrate loads every .js file
in that directory as a migration, so a helper placed there would be executed as one.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

/** Synthetic system actor for cron-inserted rows (a `<uuid>.user`). */
const SYSTEM_OWNER = '00000000-0000-0000-0000-000000000000.user';

/**
 * The predicate of the PARTIAL dedupe index `vendor_sync_jobs_dedupe_uidx`
 * (2026-06-20T150000Z):
 *
 *     CREATE UNIQUE INDEX vendor_sync_jobs_dedupe_uidx
 *       ON vendor_sync_jobs (feed_type, scheduled_for_date)
 *       WHERE feed_type <> 'equity-price-repair' AND NOT ad_hoc;
 *
 * An `ON CONFLICT` inference clause must restate a partial index's predicate VERBATIM or
 * Postgres cannot match it and the INSERT aborts. Cron rows are always ad_hoc=false and
 * non-repair, so they fall inside the index.
 *
 * If the index predicate ever changes, change it HERE and re-schedule every cron — a skew
 * between the two is silent until a cron fires.
 */
export const VENDOR_SYNC_DEDUPE_PREDICATE =
  `(feed_type <> 'equity-price-repair' AND NOT ad_hoc)`;

/**
 * The enqueue statement a vendor-sync cron runs: insert one job for `feed` at the current
 * date, deduped against a same-day scheduled row. Predicate-qualified — see
 * VENDOR_SYNC_DEDUPE_PREDICATE.
 */
export const vendorSyncEnqueueSql = (feed: string): string => `
  INSERT INTO vendor_sync_jobs (job_id, feed_type, scheduled_for_date, created_by, updated_by)
  VALUES (gen_random_uuid()::text || '.vendor-sync-job', '${feed}', current_date, '${SYSTEM_OWNER}', '${SYSTEM_OWNER}')
  ON CONFLICT (feed_type, scheduled_for_date) WHERE ${VENDOR_SYNC_DEDUPE_PREDICATE} DO NOTHING;
`.trim();

/** pg_cron job name for a feed. */
export const vendorSyncCronName = (feed: string): string => `vendor-sync-${feed}`;

/**
 * Schedule (or re-schedule) the pg_cron job that enqueues `feed` on `schedule` (UTC).
 * Unschedules any existing job of the same name first, so this is idempotent and is also
 * the correct way to CORRECT a previously-registered job's SQL.
 *
 * No-ops with a NOTICE when pg_cron is absent, or when running against a database other
 * than `cron.database_name` (jobs are only registered in the one cron database).
 */
export const scheduleVendorSyncCron = (pgm: MigrationBuilder, feed: string, schedule: string): void => {
  const name = vendorSyncCronName(feed);
  pgm.sql(`
    DO $do$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE NOTICE 'Skipping pg_cron ${name} on %: pg_cron not installed.', current_database();
      ELSIF current_database() <> (SELECT setting FROM pg_settings WHERE name = 'cron.database_name') THEN
        RAISE NOTICE 'Skipping pg_cron ${name} on %: jobs only registered in cron.database_name.', current_database();
      ELSE
        EXECUTE 'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = ''${name}''';
        EXECUTE $sql$SELECT cron.schedule('${name}', '${schedule}', $job$${vendorSyncEnqueueSql(feed)}$job$)$sql$;
      END IF;
    END
    $do$;
  `);
};

/** Remove the pg_cron job for `feed` (used by `down`, and to retire a feed). */
export const unscheduleVendorSyncCron = (pgm: MigrationBuilder, feed: string): void => {
  const name = vendorSyncCronName(feed);
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
