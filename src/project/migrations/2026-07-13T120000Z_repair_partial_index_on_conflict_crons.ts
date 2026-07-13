/*
Created by Franz Zemen
License Type: UNLICENSED

Repair the four vendor-sync crons registered on 2026-07-10 with a BARE `ON CONFLICT`.

The `vendor_sync_jobs` dedupe index is PARTIAL (2026-06-20T150000Z):

    CREATE UNIQUE INDEX vendor_sync_jobs_dedupe_uidx
      ON vendor_sync_jobs (feed_type, scheduled_for_date)
      WHERE feed_type <> 'equity-price-repair' AND NOT ad_hoc;

A bare `ON CONFLICT (feed_type, scheduled_for_date)` does NOT match a partial index —
Postgres raises "there is no unique or exclusion constraint matching the ON CONFLICT
specification", the INSERT aborts, and the cron enqueues NOTHING. 2026-07-01T150000Z
found this and fixed the then-existing crons by qualifying the clause with the index
predicate; the three 2026-07-10 feed migrations (security_free_float,
short_interest_and_volume, ipo_feed) each re-introduced the bare form, so every cron they
registered has failed on every fire since.

Confirmed on prod_blue (cron.job_run_details, 2026-07-13): all four below `failed` with
that exact message on every run, while every cron carrying the predicate-qualified clause
shows `succeeded / INSERT 0 1`.

Impact was worst for `security-short-volume-plan`: the daily planner is what implements
never-lose-a-day (revive a failed day, fan out missing ones). Because it never ran, the
2026-07-10 short-volume day — which failed legitimately, having been pulled at 17:27 EDT
before FINRA published — was never revived and stayed permanently red.

Fix: re-`cron.schedule` the four jobs, unchanged schedules, with the predicate-qualified
ON CONFLICT. Schema-only for pg_cron; no table/constraint changes, so MIN_SCHEMA_VERSION
is NOT bumped (no worker code depends on this).

Once applied, the next 11:00 UTC planner fire revives 2026-07-10 on its own.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const SYSTEM_OWNER = '00000000-0000-0000-0000-000000000000.user';

// The four crons registered on 2026-07-10 with the bare ON CONFLICT. Schedules are
// carried through UNCHANGED — only the enqueue SQL is being corrected.
const BROKEN_JOBS: ReadonlyArray<{feed: string; schedule: string}> = [
  {feed: 'security-float-refresh',    schedule: '0 16 * * 0'}, // Sun 16:00 UTC
  {feed: 'security-short-interest',   schedule: '0 18 * * 0'}, // Sun 18:00 UTC, after float
  {feed: 'security-short-volume-plan', schedule: '0 11 * * *'}, // daily 11:00 UTC (~06:00-07:00 ET)
  {feed: 'ipo-refresh',               schedule: '0 12 * * *'}, // daily 12:00 UTC
];

const jobName = (feed: string): string => `vendor-sync-${feed}`;

// Predicate-qualified ON CONFLICT — MUST name the partial index's predicate. See header.
const enqueueSql = (feed: string): string => `
  INSERT INTO vendor_sync_jobs (job_id, feed_type, scheduled_for_date, created_by, updated_by)
  VALUES (gen_random_uuid()::text || '.vendor-sync-job', '${feed}', current_date, '${SYSTEM_OWNER}', '${SYSTEM_OWNER}')
  ON CONFLICT (feed_type, scheduled_for_date) WHERE (feed_type <> 'equity-price-repair' AND NOT ad_hoc) DO NOTHING;
`.trim();

// The bare form these crons were registered with — restored by `down`.
const bareEnqueueSql = (feed: string): string => `
  INSERT INTO vendor_sync_jobs (job_id, feed_type, scheduled_for_date, created_by, updated_by)
  VALUES (gen_random_uuid()::text || '.vendor-sync-job', '${feed}', current_date, '${SYSTEM_OWNER}', '${SYSTEM_OWNER}')
  ON CONFLICT (feed_type, scheduled_for_date) DO NOTHING;
`.trim();

const scheduleJob = (pgm: MigrationBuilder, feed: string, sched: string, sql: (f: string) => string): void => {
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
        EXECUTE $sql$SELECT cron.schedule('${name}', '${sched}', $job$${sql(feed)}$job$)$sql$;
      END IF;
    END
    $do$;
  `);
};

export const up = (pgm: MigrationBuilder): void => {
  for (const {feed, schedule} of BROKEN_JOBS) scheduleJob(pgm, feed, schedule, enqueueSql);
};

export const down = (pgm: MigrationBuilder): void => {
  for (const {feed, schedule} of BROKEN_JOBS) scheduleJob(pgm, feed, schedule, bareEnqueueSql);
};
