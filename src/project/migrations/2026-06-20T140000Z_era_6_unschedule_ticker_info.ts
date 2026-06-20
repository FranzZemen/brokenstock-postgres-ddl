/*
Created by Franz Zemen
License Type: UNLICENSED

Era 6 — corrective: actually unschedule the dead `vendor-sync-ticker-info`
pg_cron job.

The 2026-06-20T130000Z migration's unschedule helper guarded on
`current_database() = (SELECT setting FROM pg_settings WHERE name='cron.database_name')`.
On Aurora the `cron.database_name` GUC is not readable by the `brokenstock_app`
role, so that subquery returns NULL, the `=` guard is never true, and the
unschedule silently no-op'd (the schedule() helper used an ELSE branch, so the
new feeds DID get scheduled — only the unschedule was skipped).

Robust pattern: guard on the job actually existing in cron.job (only true on the
cron database where pg_cron registered it) — no dependency on the unreadable GUC.

No table/column changes — does NOT bump MIN_SCHEMA_VERSION.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    DO $do$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
         AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vendor-sync-ticker-info') THEN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'vendor-sync-ticker-info';
      END IF;
    END
    $do$;
  `);
};

export const down = (_pgm: MigrationBuilder): void => {
  // No-op: re-scheduling the retired ticker-info feed is undesirable. The
  // 2026-06-20T130000Z down() restores it if a full Era-6 rollback is run.
};
