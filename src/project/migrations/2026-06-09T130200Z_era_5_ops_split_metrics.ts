/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * ops_split_metrics — Era 5 DDB→PG migration of `@franzzemen/stock-splits`
 * `OpsSplitMetricsTrustedApi` (was DDB `OPS_SPLIT_METRICS`). Append-only ops
 * telemetry for the stock-split pipeline; read surface (list / listRange) is
 * consumed by broken-stock-admin's ops-splits view + the orchestrator. Absent
 * owner is stored as the SYSTEM owner sentinel by the API.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE ops_split_metrics (
      event_uuid      TEXT PRIMARY KEY,
      event_type      TEXT NOT NULL,
      event_date      TEXT NOT NULL,
      event_epoch     BIGINT NOT NULL,
      owner           TEXT NOT NULL,
      security_key    TEXT,
      effective_date  TEXT,
      split_factor    NUMERIC,
      magnitude       NUMERIC,
      details         JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by      TEXT NOT NULL,
      updated_by      TEXT NOT NULL
    );
  `);
  // Primary read pattern: by (event_type, event_date), newest first; listRange filters event_date ranges across event_types.
  pgm.sql(`
    CREATE INDEX ops_split_metrics_type_date_idx
      ON ops_split_metrics (event_type, event_date, event_epoch DESC);
  `);
  pgm.sql(`
    CREATE TRIGGER ops_split_metrics_set_updated_at BEFORE UPDATE ON ops_split_metrics
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS ops_split_metrics_set_updated_at ON ops_split_metrics;`);
  pgm.sql(`DROP INDEX IF EXISTS ops_split_metrics_type_date_idx;`);
  pgm.dropTable('ops_split_metrics');
};
