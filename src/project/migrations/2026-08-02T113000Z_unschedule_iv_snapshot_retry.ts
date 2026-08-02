/*
Created by Franz Zemen
License Type: UNLICENSED

Actually unschedule the `security-iv-snapshot` cron.

The pause migration (2026-08-02T110000Z) reported success and changed nothing.
`unscheduleVendorSyncCron` guarded on `current_database() = (SELECT setting FROM
pg_settings WHERE name = 'cron.database_name')`, and that setting reads NULL for
a non-superuser role. `anything = NULL` is NULL, never TRUE, so the guard was
never satisfied and the unschedule silently no-opped — while the migration
recorded a clean run.

The helper is fixed in the same release. This migration re-applies the
unschedule, since the earlier one is already recorded as run and will not
re-execute.

MIN_SCHEMA_VERSION = 2026-08-02T113000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';
import {scheduleVendorSyncCron, unscheduleVendorSyncCron} from '../vendor-sync-cron.js';

const IV_SNAPSHOT = 'security-iv-snapshot';
const SCHEDULE = '10 22 * * 1-5';

export const up = (pgm: MigrationBuilder): void => {
  unscheduleVendorSyncCron(pgm, IV_SNAPSHOT);
};

export const down = (pgm: MigrationBuilder): void => {
  scheduleVendorSyncCron(pgm, IV_SNAPSHOT, SCHEDULE);
};
