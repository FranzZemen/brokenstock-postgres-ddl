/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * THESIS (2026-06-07) — migrate @franzzemen/thesis off DynamoDB.
 *
 * A small standalone domain (NOT part of an Era — investment theses, a trader
 * feature). The DDB layout was 2 tables: THESIS_TABLE (HASH owner / RANGE uuid,
 * LSI name) + THESIS_SYMBOL_TABLE (reverse symbol→thesis lookup). Modeled
 * relationally as ONE table:
 *  - THESIS_SYMBOL_TABLE is DROPPED — Aurora answers "theses for a symbol"
 *    natively via a GIN index on the `underlying_symbols text[]` array, so the
 *    separate reverse-lookup table (a DDB access-pattern workaround) is gone.
 *  - the `name-index` LSI → a plain (owner, name) btree index.
 *  - thesis narrative + template stay in S3 (only `narrative_s3_key` is stored).
 *
 * PK = thesis_id = the app-minted branded ThesisUUID (`<uuid>.thesis`, TEXT +
 * CHECK), per the universal app-minted-suffix-PK convention. owner is the
 * branded `<uuid>.user`. timeWindow {startEpoch, endEpoch?} → 2 nullable
 * TIMESTAMPTZ cols (real epochs, no sentinels). yieldRef* cached snapshot kept
 * as columns. createdEpoch/updatedEpoch (DBRecord) → created_at/updated_at
 * timestamptz, materialized back to epoch at the read boundary.
 *
 * Pins MIN_SCHEMA_VERSION = 2026-06-07T120000Z.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const THESIS_ID_CHK = `~ '^${UUID_RE}\\.thesis$'`;
const OWNER_CHK = `~ '^${UUID_RE}\\.user$'`;

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE thesis (
      thesis_id                TEXT PRIMARY KEY CHECK (thesis_id ${THESIS_ID_CHK}),
      owner                    TEXT NOT NULL CHECK (owner ${OWNER_CHK}),
      name                     TEXT NOT NULL,
      thesis_summary           TEXT NOT NULL,
      underlying_symbols       TEXT[] NOT NULL DEFAULT '{}',
      time_window_start_epoch  TIMESTAMPTZ,
      time_window_end_epoch    TIMESTAMPTZ,
      accounts                 TEXT[],
      exclude_sealed           BOOLEAN,
      narrative_s3_key         TEXT,
      publish_slug             TEXT,
      publish_link             TEXT,
      is_published             BOOLEAN,
      first_published_at       TIMESTAMPTZ,
      last_published_at        TIMESTAMPTZ,
      copyright_notice         TEXT,
      yield_ref_trade_uuids    TEXT[],
      yield_ref_as_of_epoch    TIMESTAMPTZ,
      yield_ref_computed_at    TIMESTAMPTZ,
      yield_ref_is_stale       BOOLEAN,
      created_by               TEXT,
      updated_by               TEXT,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Replaces the DDB name-index LSI (list-by-name, owner-scoped).
    CREATE INDEX thesis_owner_name_idx ON thesis (owner, name);

    -- Replaces THESIS_SYMBOL_TABLE: "theses for a symbol" via array membership.
    CREATE INDEX thesis_underlying_symbols_gin ON thesis USING GIN (underlying_symbols);

    CREATE TRIGGER thesis_set_updated_at
      BEFORE UPDATE ON thesis
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TABLE IF EXISTS thesis;`);
};
