/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Era 5 — index supporting the owner-scoped /jobs poll.
 * See pg-chunked-jobs listOwnerJobs() + brokenstock-app-worker GET /jobs.
 *
 * The FE polls the owner's live queue via:
 *
 *   SELECT ... FROM job
 *   WHERE owner = $1 AND status = ANY($2::text[])
 *   ORDER BY submitted_at ASC
 *
 * The Era-3 substrate gave `job` indexes on idempotency_key, partition_key
 * (single-flight), and (job_type, status) — none lead with `owner`, so this
 * poll seq-scanned the whole job table (which accumulates every terminal job).
 *
 * A composite (owner, submitted_at) is the right shape: `owner` is an equality
 * so it seeks, and submitted_at is then index-ordered, satisfying the ORDER BY
 * with no sort. `status` is left as a residual filter — a PARTIAL index keyed on
 * the active-status set would be smaller, but the poll passes the statuses as a
 * runtime parameter array (`status = ANY($2::text[])`), which the planner cannot
 * prove implies a literal partial predicate, so a partial index would simply go
 * unused. Plain composite is the robust, guaranteed-used choice.
 *
 * Additive only (index create / drop; no data rewrite).
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.createIndex('job', ['owner', 'submitted_at'], {
    name: 'job_owner_submitted_at_idx',
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropIndex('job', ['owner', 'submitted_at'], {
    name: 'job_owner_submitted_at_idx',
    ifExists: true,
  });
};
