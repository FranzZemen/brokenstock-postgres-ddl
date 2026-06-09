/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * synthetic_trade_item_refs — Era 5 DDB→PG migration of the synthetic-trade
 * component graph (was DDB `SYNTHETIC_TRADE_ITEM_REFS` with a referencedUuid GSI).
 * One row per (parent synthetic trade, ordinal slot). `referenced_uuid` points at
 * a child trade or synthetic-trade; the `referenced_uuid` index replaces the GSI
 * for cycle-detection + parent-ref lookups. FK to synthetic_trades(uuid) ON DELETE
 * CASCADE removes a parent's child refs when the parent is deleted; the API still
 * guards against deleting a synthetic trade that is itself referenced as a child
 * (parent-ref check via the referenced_uuid index).
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE synthetic_trade_item_refs (
      synthetic_trade_uuid  TEXT NOT NULL REFERENCES synthetic_trades(uuid) ON DELETE CASCADE,
      ordinal_position      INTEGER NOT NULL,
      referenced_uuid       TEXT NOT NULL,
      type                  TEXT NOT NULL,
      owner                 TEXT NOT NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by            TEXT NOT NULL,
      updated_by            TEXT NOT NULL,
      PRIMARY KEY (synthetic_trade_uuid, ordinal_position),
      CONSTRAINT synthetic_trade_item_refs_type_chk CHECK (type IN ('trade', 'synthetic-trade'))
    );
  `);
  pgm.createIndex('synthetic_trade_item_refs', 'referenced_uuid', {name: 'synthetic_trade_item_refs_referenced_idx'});
  pgm.sql(`
    CREATE TRIGGER synthetic_trade_item_refs_set_updated_at BEFORE UPDATE ON synthetic_trade_item_refs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS synthetic_trade_item_refs_set_updated_at ON synthetic_trade_item_refs;`);
  pgm.dropIndex('synthetic_trade_item_refs', 'referenced_uuid', {name: 'synthetic_trade_item_refs_referenced_idx'});
  pgm.dropTable('synthetic_trade_item_refs');
};
