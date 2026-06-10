/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * batch_control + batch_control_workers — Era 5 DDB→PG migration of
 * `@franzzemen/batch-control` BatchControlTrustedApi (was DDB `BATCH_CONTROL` +
 * `BATCH_CONTROL_WORKERS`).
 *
 * batch_control: one row per process. Carries the resumable-batch process state
 * (status, bookmark, worker_counts) AND the distributed lease (lease_holder +
 * lease_expiry) used by the live file-import / trade-pipeline concurrency guard.
 * The DDB conditional-update lease semantics (acquire iff free/expired/own) map to
 * a `SELECT ... FOR UPDATE` + conditional UPDATE in a transaction.
 *
 * batch_control_workers: one row per (process_id, worker_key). `status` is a column
 * (so reconcileWorkerCounters can GROUP BY status); the rest of the WorkerStatusRecord
 * lives in the `data` JSONB payload (variable per worker kind).
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE batch_control (
      process_id       TEXT PRIMARY KEY,
      status           TEXT NOT NULL,
      started_by       TEXT,
      started_epoch    BIGINT,
      completed_epoch  BIGINT,
      bookmark         TEXT,
      metadata         JSONB,
      worker_counts    JSONB,
      lease_holder     TEXT,
      lease_expiry     BIGINT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by       TEXT NOT NULL,
      updated_by       TEXT NOT NULL
    );
  `);
  pgm.sql(`
    CREATE TABLE batch_control_workers (
      process_id   TEXT NOT NULL,
      worker_key   TEXT NOT NULL,
      status       TEXT NOT NULL,
      data         JSONB,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by   TEXT NOT NULL,
      updated_by   TEXT NOT NULL,
      PRIMARY KEY (process_id, worker_key)
    );
  `);
  pgm.sql(`CREATE INDEX batch_control_workers_process_status_idx ON batch_control_workers (process_id, status);`);
  pgm.sql(`
    CREATE TRIGGER batch_control_set_updated_at BEFORE UPDATE ON batch_control
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
  pgm.sql(`
    CREATE TRIGGER batch_control_workers_set_updated_at BEFORE UPDATE ON batch_control_workers
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS batch_control_workers_set_updated_at ON batch_control_workers;`);
  pgm.sql(`DROP TRIGGER IF EXISTS batch_control_set_updated_at ON batch_control;`);
  pgm.sql(`DROP INDEX IF EXISTS batch_control_workers_process_status_idx;`);
  pgm.dropTable('batch_control_workers');
  pgm.dropTable('batch_control');
};
