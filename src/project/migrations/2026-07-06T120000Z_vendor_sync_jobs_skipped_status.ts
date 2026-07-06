/*
Created by Franz Zemen 2026-07-06
License Type: UNLICENSED

Equity Price Feed Reliability + Ad-Hoc Refresh (equity-price-feed-reliability-and-
adhoc-refresh.prd.md — E2/D5).

Extends the vendor_sync_jobs.status CHECK to admit a 5th state, 'skipped':

  queued → in_progress → completed | failed | skipped

'skipped' means a trading-day file will never load and the date is deliberately
closed out — either the planner's AUTO-skip when a still-missing day ages past the
30-day retroactive-refresh cap (D2), or an admin MANUAL skip (D3). A skipped date is
treated as "covered" by the planner (it stops re-enqueuing it and the contiguous
coverage watermark advances past it, unblocking nightly-rollup gating), and it renders
distinctly from 'failed' on the admin status calendar.

NOTE (schema-types): 'skipped' is deliberately NOT added to the exported
`VendorSyncJobStatus` union in schema-types/index.ts, mirroring the ad_hoc /
result_summary / Era-6 feed_type NOTE in the 2026-06-20 admin-batch-control migration.
Adding a member to a Database-typed union forces a Kysely-invariance rebuild of the
entire @franzzemen closure for a value only the two leaf workers (vendor-sync-worker,
admin-app-worker) produce/consume. Those workers cast 'skipped' at the query boundary
(same as the existing `'in_progress' as any` / `'failed' as never` casts in
dequeue-loop.ts). The CHECK is the enforcement point; no npmu cascade.

The partial claim index `vendor_sync_jobs_status_next_attempt_idx`
(WHERE status IN ('queued','in_progress')) already excludes 'skipped', so a skipped
row is never claimed by the dequeue loop — no index change needed.

Pins MIN_SCHEMA_VERSION = 2026-07-06T120000Z: the vendor-sync-worker planner and the
admin-app-worker skip endpoint write status='skipped', which older schemas reject.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const STATUS_AFTER = ['queued', 'in_progress', 'completed', 'failed', 'skipped'];
const STATUS_BEFORE = ['queued', 'in_progress', 'completed', 'failed'];

const checkSql = (states: string[]): string =>
  `status IN (${states.map((s) => `'${s}'`).join(', ')})`;

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_status_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_status_chk CHECK (${checkSql(STATUS_AFTER)});`);
};

export const down = (pgm: MigrationBuilder): void => {
  // Reversible only if no 'skipped' rows remain; a live skipped row would violate the
  // narrower CHECK. Fold any skipped rows back to 'failed' first so the constraint holds.
  pgm.sql(`UPDATE vendor_sync_jobs SET status = 'failed' WHERE status = 'skipped';`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_status_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_status_chk CHECK (${checkSql(STATUS_BEFORE)});`);
};
