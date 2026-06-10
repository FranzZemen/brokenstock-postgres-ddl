/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * pending_work — Era 5 DDB→PG migration of `@franzzemen/pending-work` PendingWorkApi
 * (was DDB `PENDING_WORK`, pk=ownerUuid / sk=kind#scopeKey#workId). The "declare a
 * pending-work row before kicking off async work" surface. work_id is the app-minted
 * globally-unique PK; owner is nullable (user-initiated kinds omit it) and indexed for
 * queryPending(ownerUuid). ttl_epoch retains the DDB TTL value for a future cleanup job.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE pending_work (
      work_id     TEXT PRIMARY KEY,
      owner       TEXT,
      kind        TEXT NOT NULL,
      scope_key   TEXT NOT NULL,
      producer    TEXT NOT NULL,
      status      TEXT NOT NULL,
      ttl_epoch   BIGINT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by  TEXT NOT NULL,
      updated_by  TEXT NOT NULL
    );
  `);
  pgm.createIndex('pending_work', 'owner', {name: 'pending_work_owner_idx'});
  pgm.sql(`
    CREATE TRIGGER pending_work_set_updated_at BEFORE UPDATE ON pending_work
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS pending_work_set_updated_at ON pending_work;`);
  pgm.dropIndex('pending_work', 'owner', {name: 'pending_work_owner_idx'});
  pgm.dropTable('pending_work');
};
