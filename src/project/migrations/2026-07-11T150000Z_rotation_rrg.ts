/*
Created by Franz Zemen
License Type: UNLICENSED

Rotation / Relative Rotation Graph (PRD: projects/doc/prd/rotation-rrg.prd.md, E1).

Layer-2 cache for computed RRG coordinates. For a symbol S measured against a
benchmark B on the weekly close series:
  RS_t        = close_S,t / close_B,t
  RS-Ratio_t  = 100 + k · zscoreL(RS)             (X)
  RS-Momentum = 100 + k · zscoreL(ΔRS-Ratio over m) (Y)
Normalization is PER-SYMBOL (a symbol's coords depend only on itself + the
benchmark, not the plotted set), which is what makes the per-symbol cache grain
sound — {XLK,XLF} and {XLK,XLF,XLV} reuse the XLK/XLF rows.

Two tables (per PRD D6/D7):

  rrg_rs_series  — one row per (benchmark, symbol, granularity, params_hash,
                   week_ending) holding the plot coordinates. Closed-week rows
                   are immutable and appended weekly.

  rrg_series_meta — one row per (benchmark, symbol, granularity, params_hash)
                   holding the raw-bars FINGERPRINT + the warmup window it was
                   computed over + the last computed week. On read we recompute
                   the fingerprint of the raw prices_equity window and compare:
                   a match means append only the missing recent weeks; a
                   mismatch means a retroactive split-adjust/backfill mutated the
                   underlying bars, so the series is discarded and recomputed.
                   (Storing the fingerprint on a companion row — not per data
                   row — disambiguates "grew by a week" from "history changed".)

Both key columns FK CASCADE to securities(key): a security we can price already
has a securities row (prices_equity FKs the same), and deleting a security
should drop its derived RRG cache. params_hash folds {L, m, k, smoothing,
granularity} so a calibration change (E11) partitions cleanly from stale rows.

PK-only + the meta PK; no secondary indexes ship (series reads are PK-prefix
range scans on (benchmark_key, symbol_key, granularity, params_hash)).

Bumps MIN_SCHEMA_VERSION = 2026-07-11T150000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const USER_FMT = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE rrg_rs_series (
      benchmark_key  TEXT NOT NULL REFERENCES securities(key) ON DELETE CASCADE,
      symbol_key     TEXT NOT NULL REFERENCES securities(key) ON DELETE CASCADE,
      granularity    TEXT NOT NULL,
      params_hash    TEXT NOT NULL,
      week_ending    DATE NOT NULL,
      rs             DOUBLE PRECISION NOT NULL,
      rs_ratio       DOUBLE PRECISION NOT NULL,
      rs_momentum    DOUBLE PRECISION NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by     TEXT NOT NULL,
      updated_by     TEXT NOT NULL,
      PRIMARY KEY (benchmark_key, symbol_key, granularity, params_hash, week_ending),
      CONSTRAINT rrg_rs_series_granularity_chk CHECK (granularity IN ('week')),
      CONSTRAINT rrg_rs_series_created_by_format_chk CHECK (created_by ~ '${USER_FMT}'),
      CONSTRAINT rrg_rs_series_updated_by_format_chk CHECK (updated_by ~ '${USER_FMT}')
    );
  `);
  pgm.sql(`
    CREATE TRIGGER rrg_rs_series_set_updated_at BEFORE UPDATE ON rrg_rs_series
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  pgm.sql(`
    CREATE TABLE rrg_series_meta (
      benchmark_key       TEXT NOT NULL REFERENCES securities(key) ON DELETE CASCADE,
      symbol_key          TEXT NOT NULL REFERENCES securities(key) ON DELETE CASCADE,
      granularity         TEXT NOT NULL,
      params_hash         TEXT NOT NULL,
      window_start_date   DATE NOT NULL,
      computed_through_week DATE NOT NULL,
      bars_fingerprint    TEXT NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by          TEXT NOT NULL,
      updated_by          TEXT NOT NULL,
      PRIMARY KEY (benchmark_key, symbol_key, granularity, params_hash),
      CONSTRAINT rrg_series_meta_granularity_chk CHECK (granularity IN ('week')),
      CONSTRAINT rrg_series_meta_created_by_format_chk CHECK (created_by ~ '${USER_FMT}'),
      CONSTRAINT rrg_series_meta_updated_by_format_chk CHECK (updated_by ~ '${USER_FMT}')
    );
  `);
  pgm.sql(`
    CREATE TRIGGER rrg_series_meta_set_updated_at BEFORE UPDATE ON rrg_series_meta
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS rrg_series_meta_set_updated_at ON rrg_series_meta;`);
  pgm.dropTable('rrg_series_meta', {ifExists: true});
  pgm.sql(`DROP TRIGGER IF EXISTS rrg_rs_series_set_updated_at ON rrg_rs_series;`);
  pgm.dropTable('rrg_rs_series', {ifExists: true});
};
