/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Shared set_updated_at() trigger function per Era 1 C1 D17 — reused by every
 * Era 1 table's BEFORE UPDATE trigger to keep updated_at honest without
 * relying on application code.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP FUNCTION IF EXISTS set_updated_at();`);
};
