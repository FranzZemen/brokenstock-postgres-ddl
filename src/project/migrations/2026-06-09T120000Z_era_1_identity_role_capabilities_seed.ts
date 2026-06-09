/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * role_capabilities SEED — Era 1 C1.
 *
 * The original role_capabilities create migration (2026-05-31T120300Z) shipped
 * with "No seed — capabilities assigned by administrators post-bootstrap". In
 * practice the live prod_blue set was populated by hand and never had a code
 * source, so any fresh environment (dev_franz, a rebuilt blue/green) came up
 * deny-all — every capability-gated route 403s. That is the launch blocker for
 * opening the APIs to the internet.
 *
 * This migration makes the canonical 62 role→capability pairs reproducible. It
 * is the verbatim prod_blue set as of 2026-06-09 (the roles FK parent is already
 * seeded by 2026-05-31T120100Z). Idempotent: INSERT ... ON CONFLICT DO NOTHING,
 * so re-running against an already-populated prod_blue is a no-op and seeding a
 * fresh dev_franz brings it to parity.
 *
 * Capability strings are the closed set the code gates on (resource:capability).
 * No new capabilities are introduced here — the FE-route gates added alongside
 * this seed reuse existing trades-api capabilities (trades-api-search,
 * as-of-yield-reconstitute), which is why no row here is new.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const BOOTSTRAP_UUID = '00000000-0000-0000-0000-000000000000.user';

/** Verbatim prod_blue role_capabilities (2026-06-09), 62 pairs. */
const ROLE_CAPABILITIES: ReadonlyArray<readonly [string, string]> = [
  ['accounts-administrator-role', 'accounts:delete-account-capability'],
  ['accounts-administrator-role', 'accounts:get-account-capability'],
  ['accounts-administrator-role', 'accounts:list-accounts-capability'],
  ['accounts-administrator-role', 'accounts:put-account-capability'],
  ['accounts-owner-role', 'accounts:delete-account-capability'],
  ['accounts-owner-role', 'accounts:get-account-capability'],
  ['accounts-owner-role', 'accounts:list-accounts-capability'],
  ['accounts-owner-role', 'accounts:put-account-capability'],
  ['analytics-administrator-role', 'analytics:analytics-income-capability'],
  ['analytics-administrator-role', 'analytics:analytics-income-ladder-capability'],
  ['analytics-administrator-role', 'analytics:analytics-metrics-capability'],
  ['analytics-owner-role', 'analytics:analytics-income-capability'],
  ['analytics-owner-role', 'analytics:analytics-income-ladder-capability'],
  ['analytics-owner-role', 'analytics:analytics-metrics-capability'],
  ['file-import-administrator-role', 'file-imports:delete-file-imports-capability'],
  ['file-import-administrator-role', 'file-imports:import-file-capability'],
  ['file-import-administrator-role', 'file-imports:list-file-imports-capability'],
  ['file-import-administrator-role', 'file-imports:parse-file-capability'],
  ['file-import-administrator-role', 'file-imports:unprocess-file-capability'],
  ['financial-api-administrator-role', 'financial-api:financial-api-bonds-capability'],
  ['financial-api-administrator-role', 'financial-api:financial-api-crypto-capability'],
  ['financial-api-administrator-role', 'financial-api:financial-api-currencies-capability'],
  ['financial-api-administrator-role', 'financial-api:financial-api-dividends-capability'],
  ['financial-api-administrator-role', 'financial-api:financial-api-funds-capability'],
  ['financial-api-administrator-role', 'financial-api:financial-api-options-capability'],
  ['financial-api-administrator-role', 'financial-api:financial-api-stocks-capability'],
  ['financial-api-owner-role', 'financial-api:financial-api-bonds-capability'],
  ['financial-api-owner-role', 'financial-api:financial-api-crypto-capability'],
  ['financial-api-owner-role', 'financial-api:financial-api-currencies-capability'],
  ['financial-api-owner-role', 'financial-api:financial-api-dividends-capability'],
  ['financial-api-owner-role', 'financial-api:financial-api-funds-capability'],
  ['financial-api-owner-role', 'financial-api:financial-api-options-capability'],
  ['financial-api-owner-role', 'financial-api:financial-api-stocks-capability'],
  ['instruments-administrator-role', 'instruments:instrument-search-capability'],
  ['instruments-owner-role', 'instruments:instrument-search-capability'],
  ['security-aliases-administrator-role', 'security-aliases:administrator-capability'],
  ['security-aliases-owner-role', 'security-aliases:owner-capability'],
  ['trades-api-administrator-role', 'trade-roles-api:trade-roles-api-capability'],
  ['trades-api-administrator-role', 'trades-api:as-of-yield-reconstitute-capability'],
  ['trades-api-administrator-role', 'trades-api:trades-api-journal-create-capability'],
  ['trades-api-administrator-role', 'trades-api:trades-api-journal-delete-capability'],
  ['trades-api-administrator-role', 'trades-api:trades-api-journal-search-capability'],
  ['trades-api-administrator-role', 'trades-api:trades-api-journal-update-capability'],
  ['trades-api-administrator-role', 'trades-api:trades-api-search-capability'],
  ['trades-api-administrator-role', 'trades-api:trades-api-update-capability'],
  ['trades-api-administrator-role', 'trades-api:trades-api-yield-history-reset-capability'],
  ['trades-api-owner-role', 'trade-roles-api:trade-roles-api-capability'],
  ['trades-api-owner-role', 'trades-api:as-of-yield-reconstitute-capability'],
  ['trades-api-owner-role', 'trades-api:trades-api-journal-create-capability'],
  ['trades-api-owner-role', 'trades-api:trades-api-journal-delete-capability'],
  ['trades-api-owner-role', 'trades-api:trades-api-journal-search-capability'],
  ['trades-api-owner-role', 'trades-api:trades-api-journal-update-capability'],
  ['trades-api-owner-role', 'trades-api:trades-api-search-capability'],
  ['trades-api-owner-role', 'trades-api:trades-api-update-capability'],
  ['trades-api-owner-role', 'trades-api:trades-api-yield-history-reset-capability'],
  ['transactions-administrator-role', 'transactions:transactions-search-capability'],
  ['transactions-owner-role', 'transactions:transactions-search-capability'],
  ['user-administrator-role', 'user:create-user-capability'],
  ['user-administrator-role', 'user:edit-users-capability'],
  ['user-administrator-role', 'user:get-user-by-email-capability'],
  ['user-administrator-role', 'user:get-user-by-username-capability'],
  ['user-administrator-role', 'user:logout-capability'],
];

const esc = (s: string): string => s.replace(/'/g, "''");

export const up = (pgm: MigrationBuilder): void => {
  const values = ROLE_CAPABILITIES
    .map(([role, cap]) => `('${esc(role)}', '${esc(cap)}', '${BOOTSTRAP_UUID}', '${BOOTSTRAP_UUID}')`)
    .join(',\n      ');
  pgm.sql(`
    INSERT INTO role_capabilities (role_name, capability, created_by, updated_by) VALUES
      ${values}
    ON CONFLICT (role_name, capability) DO NOTHING;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  const pairs = ROLE_CAPABILITIES
    .map(([role, cap]) => `('${esc(role)}', '${esc(cap)}')`)
    .join(', ');
  pgm.sql(`DELETE FROM role_capabilities WHERE (role_name, capability) IN (${pairs});`);
};
