/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * vendor_sync_jobs — Era 2 C4 (2026-06-02). Queue table for the
 * vendor-sync-worker fleet. Lands in `@franzzemen/brokenstock-postgres-ddl`
 * as a shared system table (per C4 D5) — same package as `worker_jobs` and
 * `smoke_events`. Era 3's `@franzzemen/pg-queue` package later refactors
 * this into a generalized primitive without moving the table.
 *
 * Design:
 * - PK is job_id (uuid4 string). Vendor-sync handlers reference jobs by id
 *   for logging/retry; the FOR UPDATE SKIP LOCKED dequeue selects by status
 *   + next_attempt_at.
 * - UNIQUE (feed_type, scheduled_for_date) guards against EventBridge
 *   double-fires (Aurora Data API INSERT from a STAYS-AS-LAMBDA shim hits
 *   the unique constraint on a duplicate fire and becomes a no-op).
 * - status CHECK is the 4-state machine: queued → in_progress → completed
 *   | failed.
 * - feed_type CHECK pins the 6 in-scope feeds (C4 D3).
 * - NOTIFY fires on INSERT only (worker LISTEN wakes the dequeue loop).
 *   UPDATE/DELETE skip NOTIFY so the worker doesn't self-trigger.
 *
 * Pins the new MIN_SCHEMA_VERSION = 2026-06-02T130000Z (supersedes the
 * 2026-06-02T120000Z stock-splits-coverage amendment).
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE vendor_sync_jobs (
      job_id              TEXT PRIMARY KEY,
      feed_type           TEXT NOT NULL,
      scheduled_for_date  DATE NOT NULL,
      payload             JSONB,
      status              TEXT NOT NULL DEFAULT 'queued',
      attempts            INTEGER NOT NULL DEFAULT 0,
      next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_error          TEXT,
      enqueued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at          TIMESTAMPTZ,
      completed_at        TIMESTAMPTZ,
      worker_instance_id  TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by          TEXT NOT NULL,
      updated_by          TEXT NOT NULL,
      CONSTRAINT vendor_sync_jobs_status_chk
        CHECK (status IN ('queued', 'in_progress', 'completed', 'failed')),
      CONSTRAINT vendor_sync_jobs_feed_type_chk
        CHECK (feed_type IN ('equity-prices', 'options-prices', 'stock-splits-fetch',
                             'market-calendar', 'ticker-info', 'ticker-ratios')),
      CONSTRAINT vendor_sync_jobs_created_by_format_chk
        CHECK (created_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$'),
      CONSTRAINT vendor_sync_jobs_updated_by_format_chk
        CHECK (updated_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$')
    );
  `);
  pgm.createIndex('vendor_sync_jobs', ['feed_type', 'scheduled_for_date'], {
    name: 'vendor_sync_jobs_dedupe_uidx',
    unique: true,
  });
  pgm.createIndex('vendor_sync_jobs', ['status', 'next_attempt_at'], {
    name: 'vendor_sync_jobs_status_next_attempt_idx',
    where: "status IN ('queued', 'in_progress')",
  });
  pgm.sql(`
    CREATE TRIGGER vendor_sync_jobs_set_updated_at BEFORE UPDATE ON vendor_sync_jobs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
  pgm.sql(`
    CREATE OR REPLACE FUNCTION notify_vendor_sync_job_enqueued() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_notify('vendor-sync-job-enqueued', NEW.feed_type || '|' || NEW.job_id);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  pgm.sql(`
    CREATE TRIGGER vendor_sync_jobs_notify
      AFTER INSERT ON vendor_sync_jobs
      FOR EACH ROW EXECUTE FUNCTION notify_vendor_sync_job_enqueued();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS vendor_sync_jobs_notify ON vendor_sync_jobs;`);
  pgm.sql(`DROP FUNCTION IF EXISTS notify_vendor_sync_job_enqueued();`);
  pgm.sql(`DROP TRIGGER IF EXISTS vendor_sync_jobs_set_updated_at ON vendor_sync_jobs;`);
  pgm.dropIndex('vendor_sync_jobs', ['status', 'next_attempt_at'], {
    name: 'vendor_sync_jobs_status_next_attempt_idx',
  });
  pgm.dropIndex('vendor_sync_jobs', ['feed_type', 'scheduled_for_date'], {
    name: 'vendor_sync_jobs_dedupe_uidx',
  });
  pgm.dropTable('vendor_sync_jobs');
};
