/*
Created by Franz Zemen 2026-07-13
License Type: UNLICENSED

Extends the vendor_sync_jobs.status CHECK to admit a 6th state, 'awaiting_vendor':

  queued → in_progress → completed | failed | skipped | awaiting_vendor

'awaiting_vendor' means the run reached the vendor and the vendor simply has not
published the data for that date YET. It is NOT a fault: nothing is broken, no one
needs to act, and the day is expected to load on a later run. Today those runs land as
'failed' — indistinguishable on the admin status calendar from a genuine error (a red
cell for a day whose data merely isn't out yet), which is exactly the noise that made
the 2026-07-10 short-volume day look like an outage when it was a publish-lag artifact.

Distinct from the neighbouring states:
  - 'failed'  — a real fault; someone should look.
  - 'skipped' — deliberately and PERMANENTLY closed out; treated as covered, and the
                contiguous coverage watermark advances past it.
  - 'awaiting_vendor' — transient; NOT covered, so the coverage watermark stays put and
                the daily planner revives the day on its next run (never-lose-a-day).

Coverage needs no change: advanceFeedCoverageContiguous keys on
`status in ('completed','skipped')`, so an awaiting_vendor day is already a hole and
halts the contiguous prefix — which is the correct behaviour.

The partial claim index `vendor_sync_jobs_status_next_attempt_idx`
(WHERE status IN ('queued','in_progress')) already excludes 'awaiting_vendor', so such a
row is never re-claimed by the dequeue loop — no index change needed (same as 'skipped').

NOTE (schema-types): 'awaiting_vendor' is deliberately NOT added to the exported
`VendorSyncJobStatus` union, mirroring 'skipped' (2026-07-06T120000Z) and the ad_hoc /
result_summary / feed_type NOTEs. Adding a member to a Database-typed union forces a
Kysely-invariance rebuild of the whole @franzzemen closure for a value only the two leaf
workers (vendor-sync-worker, admin-app-worker) produce/consume. Those workers cast at the
query boundary. The CHECK is the enforcement point; no npmu cascade.

Pins MIN_SCHEMA_VERSION = 2026-07-13T130000Z: the vendor-sync-worker dequeue loop writes
status='awaiting_vendor', which older schemas reject.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const STATUS_BEFORE = ['queued', 'in_progress', 'completed', 'failed', 'skipped'];
const STATUS_AFTER = [...STATUS_BEFORE, 'awaiting_vendor'];

const checkSql = (states: string[]): string =>
  `status IN (${states.map((s) => `'${s}'`).join(', ')})`;

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_status_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_status_chk CHECK (${checkSql(STATUS_AFTER)});`);
};

export const down = (pgm: MigrationBuilder): void => {
  // Reversible only if no 'awaiting_vendor' rows remain; a live one would violate the
  // narrower CHECK. Fold them back to 'failed' (their pre-migration representation) first.
  pgm.sql(`UPDATE vendor_sync_jobs SET status = 'failed' WHERE status = 'awaiting_vendor';`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_status_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_status_chk CHECK (${checkSql(STATUS_BEFORE)});`);
};
