/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Era 3 C1 (2026-06-03) — substrate tables for the canonical Postgres batch
 * substrate (`@franzzemen/pg-queue` + `@franzzemen/pg-chunked-jobs`).
 *
 * Lands here as shared system tables (RD-2) — same package as `worker_jobs`,
 * `vendor_sync_jobs`, `smoke_events`. Code-only packages; DDL lives in the
 * canonical DDL home.
 *
 * Three tables:
 *  - `job`        — one row per batch operation (parent; O(1) progress via
 *                   denormalized chunk_completed/chunk_failed counters).
 *  - `job_chunk`  — one row per unit of work AND the queue row (conforms to
 *                   the pg-queue queue-row contract). `kind='finalize'` is the
 *                   separate finalize work-item (RD-5), NOT counted in
 *                   chunk_total/_completed/_failed.
 *  - `queue`      — generic single-shot queue table for trivial non-chunked
 *                   consumers; proves the pg-queue helpers are table-agnostic.
 *
 * Queue-row contract (RD-21, adopts the names already shipping in worker_jobs
 * + vendor_sync_jobs — supersedes the design-notes D1 sketch run_after/
 * lease_expires_at): status, attempts, max_attempts, next_attempt_at (backoff
 * gate), locked_by, locked_at (lease gate: reclaim when locked_at +
 * lease(job_type) < now()), payload, result, last_error.
 *
 * Status machines:
 *  - job:       planning → running → finalizing → completed |
 *               completed_with_errors | failed | canceled
 *  - chunk/queue: pending → processing → completed | failed (poison) |
 *               dead (exhausted) (RD-9)
 *
 * NOTIFY is application-level (a pg-queue helper fires
 * `pg_notify('chunk_ready:'||job_type, job_id)` inside the fan-out / resume /
 * finalize-enqueue transaction, RD-10) — NOT a DB trigger, so channel naming
 * stays in code and the primitive remains generic.
 *
 * Audit: created_at/updated_at + set_updated_at() trigger (reused). No
 * created_by/updated_by actor-format CHECK — these are generic infrastructure
 * rows, not domain-provenance rows; `job.owner` captures ownership.
 *
 * Pins MIN_SCHEMA_VERSION = 2026-06-03T120000Z.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  // ---- job (parent) -------------------------------------------------------
  pgm.sql(`
    CREATE TABLE job (
      job_id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      job_type          TEXT NOT NULL,
      owner             TEXT,
      partition_key     TEXT,
      status            TEXT NOT NULL DEFAULT 'planning',
      chunk_total       INTEGER NOT NULL DEFAULT 0,
      chunk_completed   INTEGER NOT NULL DEFAULT 0,
      chunk_failed      INTEGER NOT NULL DEFAULT 0,
      payload           JSONB,
      result            JSONB,
      error             TEXT,
      idempotency_key   TEXT,
      submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at        TIMESTAMPTZ,
      finalized_at      TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT job_status_chk
        CHECK (status IN ('planning', 'running', 'finalizing',
                          'completed', 'completed_with_errors', 'failed', 'canceled'))
    );
  `);
  // RD-8: NULL idempotency_key allowed many times (PG UNIQUE treats NULLs as
  // distinct) → "no dedupe"; a supplied key dedupes the submit.
  pgm.createIndex('job', ['idempotency_key'], {
    name: 'job_idempotency_key_uidx',
    unique: true,
  });
  // RD-13: single-flight per partition_key — only one active job per key.
  // NULL partition_key is unconstrained (jobs that don't chain).
  pgm.createIndex('job', ['partition_key'], {
    name: 'job_partition_key_singleflight_uidx',
    unique: true,
    where: "status IN ('planning', 'running', 'finalizing')",
  });
  pgm.createIndex('job', ['job_type', 'status'], {
    name: 'job_type_status_idx',
  });
  pgm.sql(`
    CREATE TRIGGER job_set_updated_at BEFORE UPDATE ON job
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ---- job_chunk (unit of work AND queue row) -----------------------------
  // job_type denormalized from job so the claim query is single-table
  // (no join) — resolves the super-PRD "JobRecord column finalization" item.
  pgm.sql(`
    CREATE TABLE job_chunk (
      chunk_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      job_id            BIGINT NOT NULL REFERENCES job(job_id) ON DELETE CASCADE,
      job_type          TEXT NOT NULL,
      kind              TEXT NOT NULL DEFAULT 'work',
      chunk_ordinal     INTEGER NOT NULL,
      partition         TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'pending',
      attempts          INTEGER NOT NULL DEFAULT 0,
      max_attempts      INTEGER NOT NULL DEFAULT 5,
      next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      locked_by         TEXT,
      locked_at         TIMESTAMPTZ,
      payload           JSONB,
      result            JSONB,
      last_error        TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT job_chunk_status_chk
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead')),
      CONSTRAINT job_chunk_kind_chk
        CHECK (kind IN ('work', 'finalize'))
    );
  `);
  // RD-15: opaque-partition identity + fan-out dedup. The finalize chunk-of-one
  // uses a sentinel partition ('__finalize__') so it's one-per-job too.
  pgm.createIndex('job_chunk', ['job_id', 'partition'], {
    name: 'job_chunk_job_partition_uidx',
    unique: true,
  });
  // Claim predicate (RD-9): pending+next_attempt_at OR processing (lease
  // reclaim leg). Bounded to active states.
  pgm.createIndex('job_chunk', ['job_type', 'status', 'next_attempt_at'], {
    name: 'job_chunk_claim_idx',
    where: "status IN ('pending', 'processing')",
  });
  pgm.sql(`
    CREATE TRIGGER job_chunk_set_updated_at BEFORE UPDATE ON job_chunk
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ---- queue (generic single-shot, optional) ------------------------------
  pgm.sql(`
    CREATE TABLE queue (
      queue_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      queue_name        TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'pending',
      attempts          INTEGER NOT NULL DEFAULT 0,
      max_attempts      INTEGER NOT NULL DEFAULT 5,
      next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      locked_by         TEXT,
      locked_at         TIMESTAMPTZ,
      payload           JSONB,
      result            JSONB,
      last_error        TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT queue_status_chk
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead'))
    );
  `);
  pgm.createIndex('queue', ['queue_name', 'status', 'next_attempt_at'], {
    name: 'queue_claim_idx',
    where: "status IN ('pending', 'processing')",
  });
  pgm.sql(`
    CREATE TRIGGER queue_set_updated_at BEFORE UPDATE ON queue
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS queue_set_updated_at ON queue;`);
  pgm.dropTable('queue');
  pgm.sql(`DROP TRIGGER IF EXISTS job_chunk_set_updated_at ON job_chunk;`);
  pgm.dropTable('job_chunk');
  pgm.sql(`DROP TRIGGER IF EXISTS job_set_updated_at ON job;`);
  pgm.dropTable('job');
};
