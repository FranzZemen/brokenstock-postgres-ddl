/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * metered_vendor_credits — Era 5 DDB→PG migration of `@franzzemen/financial-api`
 * vendor credit metering (was DDB `METERED_VENDOR_CREDITS` with optimistic
 * version writes). One row per vendor. Cross-process accounting is now enforced
 * by Postgres row locks: the API reads-modifies-writes `buckets` inside a
 * transaction with `SELECT ... FOR UPDATE`, so concurrent worker processes
 * cannot double-spend a vendor's per-second credit window. `version` is retained
 * as an optional optimistic-lock aid.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE metered_vendor_credits (
      vendor                TEXT PRIMARY KEY,
      credits_per_period    BIGINT NOT NULL,
      period_millis         BIGINT NOT NULL,
      buckets               JSONB NOT NULL DEFAULT '{}'::jsonb,
      version               BIGINT NOT NULL DEFAULT 0,
      forever_start         BIGINT NOT NULL,
      forever_credits_used  BIGINT NOT NULL DEFAULT 0,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by            TEXT NOT NULL,
      updated_by            TEXT NOT NULL
    );
  `);
  pgm.sql(`
    CREATE TRIGGER metered_vendor_credits_set_updated_at BEFORE UPDATE ON metered_vendor_credits
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS metered_vendor_credits_set_updated_at ON metered_vendor_credits;`);
  pgm.dropTable('metered_vendor_credits');
};
