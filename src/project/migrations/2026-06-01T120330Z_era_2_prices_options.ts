/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * prices_options — Era 2 C1. Deviation D: decomposes DDB's composite sort
 * key (`{expiration}#{strike}#{callPut}#{closingDate}`) into real columns
 * (expiration_date, strike, call_put, closing_date). The app-side
 * parseOptionsSortKey() dies; range queries by expiration/strike inside a
 * security become native B-tree scans. Full field names (no h/l/o/c/v/d/g/t/
 * ve/r compression). `cid` (OCC contract identifier, e.g.,
 * AAPL240419C00150000) retained as a regular column + UNIQUE INDEX — persists
 * vendor-facing canonical id and guards against decompose-vs-cid drift.
 * FK CASCADE to securities (underlying).
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE prices_options (
      security_key        TEXT NOT NULL REFERENCES securities(key) ON DELETE CASCADE,
      expiration_date     DATE NOT NULL,
      strike              DOUBLE PRECISION NOT NULL,
      call_put            TEXT NOT NULL,
      closing_date        DATE NOT NULL,
      cid                 TEXT NOT NULL,
      open                DOUBLE PRECISION,
      high                DOUBLE PRECISION,
      low                 DOUBLE PRECISION,
      close               DOUBLE PRECISION,
      volume              BIGINT,
      transactions        INTEGER,
      last                DOUBLE PRECISION,
      mark                DOUBLE PRECISION,
      bid                 DOUBLE PRECISION,
      bid_size            INTEGER,
      ask                 DOUBLE PRECISION,
      ask_size            INTEGER,
      open_interest       INTEGER,
      implied_volatility  DOUBLE PRECISION,
      delta               DOUBLE PRECISION,
      gamma               DOUBLE PRECISION,
      theta               DOUBLE PRECISION,
      vega                DOUBLE PRECISION,
      rho                 DOUBLE PRECISION,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by          TEXT NOT NULL,
      updated_by          TEXT NOT NULL,
      PRIMARY KEY (security_key, expiration_date, strike, call_put, closing_date),
      CONSTRAINT prices_options_call_put_chk
        CHECK (call_put IN ('call', 'put')),
      CONSTRAINT prices_options_created_by_format_chk
        CHECK (created_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$'),
      CONSTRAINT prices_options_updated_by_format_chk
        CHECK (updated_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$')
    );
  `);
  pgm.createIndex('prices_options', 'cid', {name: 'prices_options_cid_uidx', unique: true});
  pgm.sql(`
    CREATE TRIGGER prices_options_set_updated_at BEFORE UPDATE ON prices_options
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS prices_options_set_updated_at ON prices_options;`);
  pgm.dropIndex('prices_options', 'cid', {name: 'prices_options_cid_uidx'});
  pgm.dropTable('prices_options');
};
