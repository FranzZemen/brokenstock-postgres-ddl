/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Era 2 prices_options cid-UNIQUE fix. The original table (120330Z) put a
 * UNIQUE index on `cid` (the OCC contract identifier, e.g. AAPL240419C00150000).
 * But prices_options is a daily-bar TIME SERIES — its PK is
 * (security_key, expiration_date, strike, call_put, closing_date) — so the same
 * `cid` recurs across every closing_date of a contract. The UNIQUE constraint is
 * therefore wrong and rejects all but one bar per contract (surfaced by the C5
 * options cutover). Replace it with a NON-unique index (cid is still a useful
 * denormalized lookup column). Pins MIN_SCHEMA_VERSION = 2026-06-02T170000Z.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP INDEX IF EXISTS prices_options_cid_uidx;`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS prices_options_cid_idx ON prices_options (cid);`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP INDEX IF EXISTS prices_options_cid_idx;`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS prices_options_cid_uidx ON prices_options (cid);`);
};
