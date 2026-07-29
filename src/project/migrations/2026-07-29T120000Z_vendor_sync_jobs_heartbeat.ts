/*
Created by Franz Zemen 2026-07-29
License Type: UNLICENSED

Stale-job reclaim for vendor_sync_jobs (BUG-001, brokenstock-vendor-sync-worker).

Adds `heartbeat_at TIMESTAMPTZ` — a liveness lease written by the worker that owns
an in-flight job, bumped on a fixed interval for as long as that worker's process is
alive. It is deliberately NOT `updated_at`: the `set_updated_at` trigger fires on
every UPDATE, so `updated_at` cannot distinguish "the owning worker is still alive"
from "some other statement touched the row".

Why this exists. `claimNextJob` only ever claims `status = 'queued'`, and there was
no lease, no heartbeat, and no reaper. A worker that died mid-job orphaned its row at
`in_progress` PERMANENTLY — nothing in the system could ever move it again. On
2026-07-14 the security-reference-refresh worker wedged 5m40s into a 12,991-ticker
run and was SIGKILLed the next day during a deploy; the admin console still showed
that job "running, 10%" fifteen days later, and the monthly feed silently stopped.

With this column the worker reclaims any `in_progress` row whose lease has gone
stale (`coalesce(heartbeat_at, started_at) < now() - lease`), returning it to
'queued' so the normal retry ladder picks it up — or failing it outright once
`attempts` is spent, so a job that wedges every time surfaces as `failed` instead of
cycling forever.

The claim index `vendor_sync_jobs_status_next_attempt_idx` is partial on
`status IN ('queued','in_progress')` and already covers the reclaim scan's `status`
predicate; no new index is warranted for a table this small.

NOTE (schema-types): `heartbeat_at` is deliberately NOT added to the exported
`Database` type in schema-types/index.ts, mirroring the ad_hoc / result_summary /
Era-6 feed_type NOTE in the 2026-06-20 admin-batch-control migration and the
'skipped' status NOTE in 2026-07-06T120000Z. Adding a column to a Database-typed
table forces a Kysely-invariance rebuild of the entire @franzzemen closure for a
value only vendor-sync-worker writes and reads. It is cast at the query boundary
there (same as the existing `'in_progress' as any` / `result_summary` casts in
dequeue-loop.ts).

Backfill: existing `in_progress` rows get `heartbeat_at = NULL`, and the reclaim
predicate falls back to `started_at`, so every currently-orphaned row (including the
2026-07-14 security-reference-refresh job) is immediately eligible on first boot.

Pins MIN_SCHEMA_VERSION = 2026-07-29T120000Z: vendor-sync-worker writes and reads
`heartbeat_at` on every claim, which older schemas reject.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP COLUMN IF EXISTS heartbeat_at;`);
};
