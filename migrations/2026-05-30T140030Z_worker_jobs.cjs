/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * worker_jobs — canonical Pre-Era-1 D6 queue table. Demonstrates the
 * LISTEN/NOTIFY + FOR UPDATE SKIP LOCKED pattern that replaces SQS for
 * worker-fleet workloads.
 *
 * Conventions:
 *   - id is BIGSERIAL — generic queues outgrow INT range fast.
 *   - payload is JSONB — typed by the consumer per-channel.
 *   - status: 'pending' | 'in_flight' | 'completed' | 'failed'.
 *   - attempts + next_attempt_at carry the retry/backoff state ON the row
 *     so survival is queue-table-resident, not in-process.
 *   - locked_by / locked_at are informational for in_flight rows;
 *     row-level locks via FOR UPDATE SKIP LOCKED are what actually exclude
 *     concurrent workers, not these columns.
 *   - Partial index on (next_attempt_at) WHERE status='pending' keeps the
 *     pending-poll cheap as the table grows.
 */

exports.up = (pgm) => {
  pgm.createTable('worker_jobs', {
    id: {type: 'bigserial', primaryKey: true},
    channel: {type: 'text', notNull: true},
    payload: {type: 'jsonb', notNull: true},
    status: {type: 'text', notNull: true, default: 'pending'},
    attempts: {type: 'integer', notNull: true, default: 0},
    next_attempt_at: {type: 'timestamptz', notNull: true, default: pgm.func('now()')},
    locked_by: {type: 'text'},
    locked_at: {type: 'timestamptz'},
    last_error: {type: 'text'},
    created_at: {type: 'timestamptz', notNull: true, default: pgm.func('now()')},
    completed_at: {type: 'timestamptz'},
  });
  pgm.createIndex('worker_jobs', ['channel', 'next_attempt_at'], {
    name: 'worker_jobs_pending_idx',
    where: "status = 'pending'",
  });
};

exports.down = (pgm) => {
  pgm.dropTable('worker_jobs');
};
