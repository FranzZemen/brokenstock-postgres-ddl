/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Era 2 systemic actor-CHECK relax. The original Era 2 reference tables copied
 * securities' `created_by/updated_by ~ '…\.user$'` CHECK, but vendor-sync /
 * price-refresh data is written by SYSTEM identities (`…00N.brokenstock`), not
 * users. The C5 cutover hit this on prices_equity (system actors 002/003) after
 * ticker_data (004, fixed in 0.6.1). Relax every Era 2 reference table's actor
 * CHECK to accept `<uuid>.user` OR `<uuid>.brokenstock` so legitimate system
 * writes (and their migration) are accepted. Already-stored `.user` rows still
 * satisfy the relaxed CHECK. Pins MIN_SCHEMA_VERSION = 2026-06-02T160000Z.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const ACTOR_CHK = `~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(user|brokenstock)$'`;
const USER_CHK = `~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$'`;

// [table, constraint-prefix] — the mic table's constraints use the short prefix.
const TARGETS: ReadonlyArray<readonly [string, string]> = [
  ['securities', 'securities'],
  ['security_aliases', 'security_aliases'],
  ['stock_splits', 'stock_splits'],
  ['stock_splits_coverage', 'stock_splits_coverage'],
  ['market_calendar', 'market_calendar'],
  ['market_calendar_holidays', 'market_calendar_holidays'],
  ['prices_equity', 'prices_equity'],
  ['prices_options', 'prices_options'],
  ['market_identifier_code_mappings', 'mic_mappings'],
];

function rewrite(pgm: MigrationBuilder, chk: string): void {
  for (const [table, prefix] of TARGETS) {
    pgm.sql(`
      ALTER TABLE ${table}
        DROP CONSTRAINT IF EXISTS ${prefix}_created_by_format_chk,
        DROP CONSTRAINT IF EXISTS ${prefix}_updated_by_format_chk;
      ALTER TABLE ${table}
        ADD CONSTRAINT ${prefix}_created_by_format_chk CHECK (created_by ${chk}),
        ADD CONSTRAINT ${prefix}_updated_by_format_chk CHECK (updated_by ${chk});
    `);
  }
}

export const up = (pgm: MigrationBuilder): void => rewrite(pgm, ACTOR_CHK);
export const down = (pgm: MigrationBuilder): void => rewrite(pgm, USER_CHK);
