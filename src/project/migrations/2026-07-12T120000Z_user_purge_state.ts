/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * users purge state (2026-07-12) — User Deletion / Full Data Purge.
 *
 * Admin user deletion is a hard, irreversible purge of every owner-keyed row in
 * the fleet plus the user's S3 objects, executed asynchronously by a job the
 * brokenstock-admin-app-worker consumes. The `users` row is deleted LAST (it is
 * the auth account; sessions/user_roles/user_applications FK-cascade from it),
 * so the row itself is the natural place to carry in-flight purge state: it
 * survives the entire purge, and list/admin-views already read it.
 *
 * Three nullable columns, all NULL for every existing and normally-created user:
 *
 *   purge_requested_at — set by the DELETE route (via TrustedUsersApi.requestPurge)
 *     the moment a purge is accepted. Non-NULL means "this user is being erased";
 *     it is the idempotency/precondition guard (a second DELETE 409s) and it is
 *     what makes the state survive queue loss — if the job vanishes, the user is
 *     still visibly mid-purge rather than silently intact.
 *
 *   purge_failed_at / purge_error — written by the worker when the job exhausts
 *     max_attempts and goes dead. Without these, `deleting…` and `delete-failed`
 *     are indistinguishable from the users row alone and the admin SPA would have
 *     to join the job queue to render a status. With them the status is a pure
 *     function of this row: requested & !failed => deleting…, failed => delete-failed.
 *     A re-enqueue clears them.
 *
 * No CHECK ties the three together (e.g. failed => requested): the worker is the
 * only writer and a partial state is preferable to a migration-time constraint we
 * would have to fight during backfill or manual intervention.
 *
 * Purely additive — no data rewrite, no backfill, no worker redeploy required for
 * existing workers (they never SELECT these columns).
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS purge_requested_at TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS purge_failed_at    TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS purge_error        TEXT        NULL;
  `);

  // Purging users are a tiny minority of the table; a partial index keeps the
  // "show me everything mid-purge" admin sweep cheap without indexing the NULLs.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS users_purge_requested_at_idx
      ON users (purge_requested_at)
      WHERE purge_requested_at IS NOT NULL;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP INDEX IF EXISTS users_purge_requested_at_idx;`);
  pgm.sql(`
    ALTER TABLE users
      DROP COLUMN IF EXISTS purge_requested_at,
      DROP COLUMN IF EXISTS purge_failed_at,
      DROP COLUMN IF EXISTS purge_error;
  `);
};
