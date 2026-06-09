/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * synthetic_trades — Era 5 DDB→PG migration of `@franzzemen/synthetic-trades`
 * `SyntheticTradesTrustedApi` (was DDB `SYNTHETIC_TRADES`). Per-owner synthetic
 * trade store; `components` are derived at read time, not persisted. `uuid` is the
 * app-minted globally-unique PK; `owner` is denormalized for owner-scoped reads.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE synthetic_trades (
      uuid        TEXT PRIMARY KEY,
      owner       TEXT NOT NULL,
      symbol      TEXT NOT NULL,
      name        TEXT,
      status      TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by  TEXT NOT NULL,
      updated_by  TEXT NOT NULL
    );
  `);
  pgm.createIndex('synthetic_trades', 'owner', {name: 'synthetic_trades_owner_idx'});
  pgm.sql(`
    CREATE TRIGGER synthetic_trades_set_updated_at BEFORE UPDATE ON synthetic_trades
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS synthetic_trades_set_updated_at ON synthetic_trades;`);
  pgm.dropIndex('synthetic_trades', 'owner', {name: 'synthetic_trades_owner_idx'});
  pgm.dropTable('synthetic_trades');
};
