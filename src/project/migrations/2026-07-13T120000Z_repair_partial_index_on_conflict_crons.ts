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
import {scheduleVendorSyncCron} from '../vendor-sync-cron.js';

// The four crons registered on 2026-07-10 with the bare ON CONFLICT. Schedules are
// carried through UNCHANGED — only the enqueue SQL is being corrected, and it now comes
// from the single shared definition in ../vendor-sync-cron.ts (added the same day, so
// this class of bug cannot be re-introduced by copy-paste a third time).
const BROKEN_JOBS: ReadonlyArray<{feed: string; schedule: string}> = [
  {feed: 'security-float-refresh',     schedule: '0 16 * * 0'}, // Sun 16:00 UTC
  {feed: 'security-short-interest',    schedule: '0 18 * * 0'}, // Sun 18:00 UTC, after float
  {feed: 'security-short-volume-plan', schedule: '0 11 * * *'}, // daily 11:00 UTC (~06:00-07:00 ET)
  {feed: 'ipo-refresh',                schedule: '0 12 * * *'}, // daily 12:00 UTC
];

export const up = (pgm: MigrationBuilder): void => {
  for (const {feed, schedule} of BROKEN_JOBS) scheduleVendorSyncCron(pgm, feed, schedule);
};

export const down = (pgm: MigrationBuilder): void => {
  // Deliberately NOT a faithful inverse. The prior state of these four crons was SQL that
  // aborts on every fire — a cron that cannot enqueue anything is not a state worth being
  // able to return to, and re-planting the bare ON CONFLICT here would put the very
  // template this migration exists to eliminate back into the tree. Reversing this
  // migration leaves the crons correctly scheduled; the feed migrations that own them
  // (2026-07-10T120000Z / T140000Z / T150000Z) remain their `down` path.
};
