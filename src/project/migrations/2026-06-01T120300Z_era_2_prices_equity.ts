/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * prices_equity — Era 2 C1. Deviation C: full field names (high/low/open/
 * close/volume) replacing DDB's abbreviated (h/l/o/c/v) compression — Postgres
 * has TOAST + page compression so the storage motivation goes away. DOUBLE
 * PRECISION on OHLCV (per D3) matches vendor source fidelity. Composite PK
 * (security_key, closing_date) preserves DDB PK + SK. PK-only index strategy
 * (per D6) — no secondary indexes ship; add when a real query pattern
 * demands. FK CASCADE to securities.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE prices_equity (
      security_key  TEXT NOT NULL REFERENCES securities(key) ON DELETE CASCADE,
      closing_date  DATE NOT NULL,
      high          DOUBLE PRECISION NOT NULL,
      low           DOUBLE PRECISION NOT NULL,
      open          DOUBLE PRECISION NOT NULL,
      close         DOUBLE PRECISION NOT NULL,
      volume        BIGINT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by    TEXT NOT NULL,
      updated_by    TEXT NOT NULL,
      PRIMARY KEY (security_key, closing_date),
      CONSTRAINT prices_equity_created_by_format_chk
        CHECK (created_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$'),
      CONSTRAINT prices_equity_updated_by_format_chk
        CHECK (updated_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$')
    );
  `);
  pgm.sql(`
    CREATE TRIGGER prices_equity_set_updated_at BEFORE UPDATE ON prices_equity
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS prices_equity_set_updated_at ON prices_equity;`);
  pgm.dropTable('prices_equity');
};
