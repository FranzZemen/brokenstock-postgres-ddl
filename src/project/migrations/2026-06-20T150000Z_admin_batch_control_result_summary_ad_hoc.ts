/*
Created by Franz Zemen
License Type: UNLICENSED

Admin Batch Control & Observability — PRD E1 (broken-stock-admin/doc/prd/
admin-batch-control.prd.md).

Restores the batch control plane (ad-hoc launch + domain-level run observability)
stripped during the Era-5 EC2/Aurora migration. Two columns on vendor_sync_jobs:

  1. result_summary JSONB — a per-run, handler-shaped domain summary the worker
     persists on completion (e.g. for the reference feeds: securities created,
     references enriched, related refreshed, transitions written, delisted,
     skipped, failed). The admin "Batch Jobs" panel reads the latest + history.
     JSONB is the approved per-run-metrics exception (opaque, per-feed-shaped).

  2. ad_hoc BOOLEAN NOT NULL DEFAULT false — set true on admin "Run now" INSERTs.
     The dedupe unique index (feed_type, scheduled_for_date) becomes PARTIAL,
     excluding ad_hoc rows so an admin may launch a feed any number of times/day
     (incl. after a same-day cron run or failure); cron jobs keep their one-per-day
     double-fire protection. equity-price-repair stays excluded (Era-5 carve-out).

NOTE (schema-types): these two columns are deliberately NOT added to the
schema-types VendorSyncJobsTable / Database type — mirroring the Era-6 feed_type
NOTE in schema-types/index.ts. Adding either column to the Database type would
force a Kysely-invariance rebuild of the entire @franzzemen closure for one JSONB
column + one boolean used only by two leaf workers (vendor-sync-worker,
admin-app-worker). Those workers cast at the query boundary instead (result_summary
is Json≈unknown, so no real type safety is lost; ad_hoc is enforced by the partial
index, not the type). No npmu cascade.

Pins MIN_SCHEMA_VERSION = 2026-06-20T150000Z (supersedes 2026-06-20T130000Z): the
vendor-sync-worker writes result_summary and the admin-app-worker writes ad_hoc.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE vendor_sync_jobs
      ADD COLUMN IF NOT EXISTS result_summary JSONB,
      ADD COLUMN IF NOT EXISTS ad_hoc BOOLEAN NOT NULL DEFAULT false;
  `);

  // Re-create the dedupe unique index as partial: scheduled (cron) jobs keep
  // one-per-(feed,day); ad_hoc + equity-price-repair are exempt.
  pgm.sql(`DROP INDEX IF EXISTS vendor_sync_jobs_dedupe_uidx;`);
  pgm.sql(`
    CREATE UNIQUE INDEX vendor_sync_jobs_dedupe_uidx
      ON vendor_sync_jobs (feed_type, scheduled_for_date)
      WHERE feed_type <> 'equity-price-repair' AND NOT ad_hoc;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  // Restore the Era-5 partial index (excludes only equity-price-repair).
  pgm.sql(`DROP INDEX IF EXISTS vendor_sync_jobs_dedupe_uidx;`);
  pgm.sql(`
    CREATE UNIQUE INDEX vendor_sync_jobs_dedupe_uidx
      ON vendor_sync_jobs (feed_type, scheduled_for_date)
      WHERE feed_type <> 'equity-price-repair';
  `);

  pgm.sql(`
    ALTER TABLE vendor_sync_jobs
      DROP COLUMN IF EXISTS ad_hoc,
      DROP COLUMN IF EXISTS result_summary;
  `);
};
