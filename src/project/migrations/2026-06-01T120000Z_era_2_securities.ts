/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * securities — Era 2 C1 reference-data root. TEXT PK `key` preserving today's
 * `mic:ticker` composite string so every downstream table that holds a
 * `<securityKey>` soft pointer stays valid byte-for-byte. CHECK constraint
 * enforces the shape. Five secondary indexes mirror DDB's five GSIs
 * (ticker-index, mic-index, asset-class-index, currency-index,
 * country-code-index) per `[[feedback-preserve-ddb-access-patterns]]`. The
 * `set_updated_at()` trigger function from Era 1 C1 is reused.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE securities (
      key           TEXT PRIMARY KEY,
      mic           TEXT NOT NULL,
      exchange      TEXT NOT NULL,
      ticker        TEXT NOT NULL,
      asset_class   TEXT NOT NULL,
      currency      TEXT NOT NULL,
      description   TEXT,
      country_code  TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by    TEXT NOT NULL,
      updated_by    TEXT NOT NULL,
      CONSTRAINT securities_key_format_chk
        CHECK (key ~ '^[A-Z0-9]+:[A-Z0-9.\\-]+$'),
      CONSTRAINT securities_created_by_format_chk
        CHECK (created_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$'),
      CONSTRAINT securities_updated_by_format_chk
        CHECK (updated_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$')
    );
  `);
  pgm.createIndex('securities', 'ticker', {name: 'securities_ticker_idx'});
  pgm.createIndex('securities', 'mic', {name: 'securities_mic_idx'});
  pgm.createIndex('securities', 'asset_class', {name: 'securities_asset_class_idx'});
  pgm.createIndex('securities', 'currency', {name: 'securities_currency_idx'});
  pgm.createIndex('securities', 'country_code', {name: 'securities_country_code_idx'});
  pgm.sql(`
    CREATE TRIGGER securities_set_updated_at BEFORE UPDATE ON securities
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS securities_set_updated_at ON securities;`);
  pgm.dropIndex('securities', 'country_code', {name: 'securities_country_code_idx'});
  pgm.dropIndex('securities', 'currency', {name: 'securities_currency_idx'});
  pgm.dropIndex('securities', 'asset_class', {name: 'securities_asset_class_idx'});
  pgm.dropIndex('securities', 'mic', {name: 'securities_mic_idx'});
  pgm.dropIndex('securities', 'ticker', {name: 'securities_ticker_idx'});
  pgm.dropTable('securities');
};
