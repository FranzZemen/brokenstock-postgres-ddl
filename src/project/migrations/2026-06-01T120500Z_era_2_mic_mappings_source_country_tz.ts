/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Era 2 C1 amendment 2026-06-01: backfill source / country / timezone columns
 * on market_identifier_code_mappings.
 *
 * Defect surfaced during C3 securities refactor: the original 120430Z
 * migration created the table with (mic, alt_code, country_code, audit) but
 * dropped `source` (REQUIRED in the @franzzemen/financial-identity
 * MarketIdentifierCodeMapping shape) plus optional `country` and `timezone`.
 *
 * This migration adds the three columns. `source` lands NULLABLE because the
 * table is shipped empty by C1; data load (post C5 vendor-sync) will populate
 * it. We do NOT add a NOT NULL constraint here because none of the C1-applied
 * environments (scratch, dev_franz) have any rows yet — but if rows exist, a
 * single backfill UPDATE is required before this migration is safe to enforce.
 *
 * Pins the new MIN_SCHEMA_VERSION = 2026-06-01T120500Z (supersedes 120430Z).
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE market_identifier_code_mappings
      ADD COLUMN source   TEXT,
      ADD COLUMN country  TEXT,
      ADD COLUMN timezone TEXT;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE market_identifier_code_mappings
      DROP COLUMN IF EXISTS timezone,
      DROP COLUMN IF EXISTS country,
      DROP COLUMN IF EXISTS source;
  `);
};
