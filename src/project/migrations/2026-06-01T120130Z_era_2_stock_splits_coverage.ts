/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * stock_splits_coverage — Era 2 C1. Deviation A sibling: per-security splits
 * fetch state (replaces DDB's sortKey = "~coverage" sentinel row pattern).
 * One row per security. PK is `security_key`. FK CASCADE to securities,
 * symmetric with `stock_splits.security_key`. NOT emitted via NOTIFY —
 * coverage metadata is operational state, not consumer-cacheable data.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE stock_splits_coverage (
      security_key          TEXT PRIMARY KEY REFERENCES securities(key) ON DELETE CASCADE,
      status                TEXT NOT NULL,
      applied_through_date  DATE,
      last_attempt_at       TIMESTAMPTZ,
      last_error            TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by            TEXT NOT NULL,
      updated_by            TEXT NOT NULL,
      CONSTRAINT stock_splits_coverage_status_chk
        CHECK (status IN ('ready', 'pending', 'failed')),
      CONSTRAINT stock_splits_coverage_created_by_format_chk
        CHECK (created_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$'),
      CONSTRAINT stock_splits_coverage_updated_by_format_chk
        CHECK (updated_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$')
    );
  `);
  pgm.sql(`
    CREATE TRIGGER stock_splits_coverage_set_updated_at BEFORE UPDATE ON stock_splits_coverage
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS stock_splits_coverage_set_updated_at ON stock_splits_coverage;`);
  pgm.dropTable('stock_splits_coverage');
};
