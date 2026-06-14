/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Era 5 — partitioned-job collision policy substrate support.
 * See pg-chunked-jobs/doc/prd/partitioned-job-collision-policy.prd.md (E2).
 *
 * Adds the columns/statuses the new collision policies need:
 *  - job.dirty (coalesce + dirty-rerun): a job marked dirty by a coalesced
 *    collision re-arms once at finalize instead of going terminal.
 *  - job status 'queued' (queue policy): a parked job NOT in the single-flight
 *    active set (planning/running/finalizing) — promoted to 'running' when the
 *    key frees. 'canceled' was already in the job check from the Era-3 substrate.
 *  - job_chunk status 'canceled' (supersede policy): pending chunks of a
 *    superseded job are marked canceled (out of the claimable set).
 *  - job.next_run_at (debounce): absolute timestamp a debounced rollup's rerun
 *    is gated to (O5 dedicated column; the FE renders the countdown off it). The
 *    re-armed work chunks' next_attempt_at is set to this so the existing claim
 *    gating defers the rerun. NULL = run as soon as claimable.
 *  - job.queued_partitions (queue policy): the parked fan-out spec for a 'queued'
 *    job (PartitionSpec[]) held until the partition_key frees and it's promoted.
 *  - job.rerun_count (coalesce rerun cap): consecutive dirty-reruns for one
 *    finalize lineage; the consumer stops re-arming past the configured cap.
 *
 * Additive + widening only (no data rewrite, no drops). Pins
 * MIN_SCHEMA_VERSION = 2026-06-13T120000Z.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  // job.dirty — coalesce/dirty-rerun marker.
  pgm.sql(`ALTER TABLE job ADD COLUMN IF NOT EXISTS dirty BOOLEAN NOT NULL DEFAULT false;`);

  // job.next_run_at — debounce schedule + FE countdown (nullable; NULL = immediate).
  pgm.sql(`ALTER TABLE job ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ;`);

  // job.queued_partitions — parked fan-out spec for a 'queued' job (queue policy).
  pgm.sql(`ALTER TABLE job ADD COLUMN IF NOT EXISTS queued_partitions JSONB;`);

  // job.rerun_count — consecutive dirty-reruns, for the coalesce rerun cap.
  pgm.sql(`ALTER TABLE job ADD COLUMN IF NOT EXISTS rerun_count INTEGER NOT NULL DEFAULT 0;`);

  // job status: add 'queued' (parked, outside the single-flight active set).
  // 'canceled' already present from the Era-3 substrate migration.
  pgm.sql(`ALTER TABLE job DROP CONSTRAINT IF EXISTS job_status_chk;`);
  pgm.sql(`
    ALTER TABLE job ADD CONSTRAINT job_status_chk
      CHECK (status IN ('queued', 'planning', 'running', 'finalizing',
                        'completed', 'completed_with_errors', 'failed', 'canceled'));
  `);

  // job_chunk status: add 'canceled' (pending chunks of a superseded job).
  pgm.sql(`ALTER TABLE job_chunk DROP CONSTRAINT IF EXISTS job_chunk_status_chk;`);
  pgm.sql(`
    ALTER TABLE job_chunk ADD CONSTRAINT job_chunk_status_chk
      CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead', 'canceled'));
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE job_chunk DROP CONSTRAINT IF EXISTS job_chunk_status_chk;`);
  pgm.sql(`
    ALTER TABLE job_chunk ADD CONSTRAINT job_chunk_status_chk
      CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead'));
  `);
  pgm.sql(`ALTER TABLE job DROP CONSTRAINT IF EXISTS job_status_chk;`);
  pgm.sql(`
    ALTER TABLE job ADD CONSTRAINT job_status_chk
      CHECK (status IN ('planning', 'running', 'finalizing',
                        'completed', 'completed_with_errors', 'failed', 'canceled'));
  `);
  pgm.sql(`ALTER TABLE job DROP COLUMN IF EXISTS rerun_count;`);
  pgm.sql(`ALTER TABLE job DROP COLUMN IF EXISTS queued_partitions;`);
  pgm.sql(`ALTER TABLE job DROP COLUMN IF EXISTS next_run_at;`);
  pgm.sql(`ALTER TABLE job DROP COLUMN IF EXISTS dirty;`);
};
