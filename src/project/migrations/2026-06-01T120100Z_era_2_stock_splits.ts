/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * stock_splits — Era 2 C1. Deviation A: the DDB "sort-key sentinel" pattern
 * (sortKey = "~coverage") for per-security metadata is split off into a
 * sibling `stock_splits_coverage` table. This file holds the real split
 * events only. Composite PK (security_key, effective_date) preserves DDB
 * PK + SK. FK CASCADE to securities (per Era 2 super-PRD D9 — splits are
 * derived from securities).
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE stock_splits (
      security_key                  TEXT NOT NULL REFERENCES securities(key) ON DELETE CASCADE,
      effective_date                DATE NOT NULL,
      ticker                        TEXT NOT NULL,
      split_factor                  DOUBLE PRECISION NOT NULL,
      split_to                      DOUBLE PRECISION,
      split_from                    DOUBLE PRECISION,
      historical_adjustment_factor  DOUBLE PRECISION,
      adjustment_type               TEXT NOT NULL,
      vendor_name                   TEXT NOT NULL,
      applied_at                    TIMESTAMPTZ,
      txn_count                     INTEGER,
      vendor_corrected_at           TIMESTAMPTZ,
      created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by                    TEXT NOT NULL,
      updated_by                    TEXT NOT NULL,
      PRIMARY KEY (security_key, effective_date),
      CONSTRAINT stock_splits_created_by_format_chk
        CHECK (created_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$'),
      CONSTRAINT stock_splits_updated_by_format_chk
        CHECK (updated_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$')
    );
  `);
  pgm.sql(`
    CREATE TRIGGER stock_splits_set_updated_at BEFORE UPDATE ON stock_splits
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS stock_splits_set_updated_at ON stock_splits;`);
  pgm.dropTable('stock_splits');
};
