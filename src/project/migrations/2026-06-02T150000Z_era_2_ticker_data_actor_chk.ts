/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Era 2 ticker-data actor-CHECK relax. The original ticker_data tables
 * (140000Z) copied the securities `created_by/updated_by ~ '…\.user$'` CHECK
 * verbatim — wrong for ticker-data, which is written by the vendor-sync SYSTEM
 * identity (`…004.brokenstock`), not a user. Real DDB rows carry `.brokenstock`
 * actors, so the C5 migration (and any live vendor-sync write) would be
 * rejected by the `.user`-only CHECK.
 *
 * Relax both tables' actor CHECKs to accept `<uuid>.user` OR `<uuid>.brokenstock`.
 * Discovered by the C5 dry-run (22.4k company_info + 10.3k ratios validation
 * hits). Pins MIN_SCHEMA_VERSION = 2026-06-02T150000Z.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const ACTOR_CHK = `~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(user|brokenstock)$'`;
const USER_CHK = `~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$'`;

const TABLES = ['ticker_data_company_info', 'ticker_data_ratios'];

export const up = (pgm: MigrationBuilder): void => {
  for (const t of TABLES) {
    pgm.sql(`
      ALTER TABLE ${t}
        DROP CONSTRAINT IF EXISTS ${t}_created_by_format_chk,
        DROP CONSTRAINT IF EXISTS ${t}_updated_by_format_chk;
      ALTER TABLE ${t}
        ADD CONSTRAINT ${t}_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
        ADD CONSTRAINT ${t}_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK});
    `);
  }
};

export const down = (pgm: MigrationBuilder): void => {
  for (const t of TABLES) {
    pgm.sql(`
      ALTER TABLE ${t}
        DROP CONSTRAINT IF EXISTS ${t}_created_by_format_chk,
        DROP CONSTRAINT IF EXISTS ${t}_updated_by_format_chk;
      ALTER TABLE ${t}
        ADD CONSTRAINT ${t}_created_by_format_chk CHECK (created_by ${USER_CHK}),
        ADD CONSTRAINT ${t}_updated_by_format_chk CHECK (updated_by ${USER_CHK});
    `);
  }
};
