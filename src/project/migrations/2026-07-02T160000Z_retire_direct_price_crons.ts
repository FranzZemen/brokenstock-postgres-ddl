/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * equity-price-retroactive-refresh.prd.md — E1 follow-up (cleanup).
 *
 * The planner-activation migration (2026-07-01T150000Z_equity_price_planner_cron)
 * retired the two direct current_date price crons (vendor-sync-equity-prices,
 * vendor-sync-options-prices) via a guard:
 *
 *     ELSIF current_database() <> (SELECT setting FROM pg_settings
 *                                  WHERE name = 'cron.database_name') THEN skip
 *   (schedule) and
 *     IF ... AND current_database() = (SELECT setting ... 'cron.database_name')
 *   (unschedule).
 *
 * On this Aurora cluster `cron.database_name` is not exposed via pg_settings, so
 * that scalar is NULL. `current_database() <> NULL` and `current_database() = NULL`
 * both evaluate to NULL (falsy). The asymmetry bit us:
 *   - schedule's SKIP test (`<> NULL`) was falsy → schedule RAN (planners created ✓)
 *   - unschedule's PROCEED test (`= NULL`) was falsy → unschedule was SKIPPED (✗)
 * so the two racing direct crons survived at 21:35 UTC with the stale (pre-partial-
 * index) ON CONFLICT and keep failing to enqueue.
 *
 * This migration finishes the retirement with a guard that depends ONLY on the
 * pg_cron extension existing in the current database (the correct, sufficient gate
 * — cron.job is reachable iff the extension is installed here), independent of the
 * unreadable cron.database_name GUC. Idempotent: unscheduling an absent job is a
 * no-op, so this is safe on fresh envs (where the direct crons may never have
 * existed) and on prod_blue (where they do).
 */

import type {MigrationBuilder} from 'node-pg-migrate';
import {scheduleVendorSyncCron, unscheduleVendorSyncCron} from '../vendor-sync-cron.js';

const SYSTEM_OWNER = '00000000-0000-0000-0000-000000000000.user';
const DIRECT_FEEDS = ['equity-prices', 'options-prices'] as const;
// gate ONLY on pg_cron presence in the current DB (robust to NULL cron.database_name).
export const up = (pgm: MigrationBuilder): void => {
  for (const feed of DIRECT_FEEDS) unscheduleVendorSyncCron(pgm, feed);
};

export const down = (pgm: MigrationBuilder): void => {
  // Restore the direct current_date crons (Era-5 schedule). scheduleVendorSyncCron emits
  // the partial-index-qualified ON CONFLICT — the faithful inverse of retiring them.
  for (const feed of DIRECT_FEEDS) scheduleVendorSyncCron(pgm, feed, '35 21 * * 1-5');
};
