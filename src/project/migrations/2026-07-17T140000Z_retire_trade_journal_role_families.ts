/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Retire the three legacy role families subsumed by the `trade-journaling-data`
 * feature slug: `trades-api-*`, `transactions-*`, and `file-import-*` (owner +
 * administrator each — six roles). See
 * brokenstock-orchestrator/doc/prd/trade-journaling-data-gating.prd.md (E13, D12).
 *
 * VERIFIED IN PRODUCTION BEFORE THIS RAN (D12): StiSelini and `test` both reached the
 * trade-journal surface holding ONLY the `user` security role and the
 * `trade-journaling-data` slug — no legacy role. The roles were demonstrated dead
 * weight, not assumed. This is the reverse of accounts, where the gates were already
 * off; here they were LOAD-BEARING and were stripped + deployed first (72 hasAccess
 * calls across trades, transactions, file-imports, thesis, synthetic-trades, and the
 * orchestrator), so retiring these roles now revokes nothing anyone checks.
 *
 * WHY NO LEGACY_CAPABILITY_SECURITY_MAP BACKSTOP IS NEEDED (unlike the
 * user-administrator retirement): that retirement kept its capabilities live and
 * leaned on the map so the routes kept working. Here the capability CHECKS are gone
 * entirely — authorization moved to a single feature gate at the app-worker route,
 * and the pipeline is trusted-internal. Nothing consults these capabilities, so
 * nothing needs to answer for them.
 *
 * ORDER IS FORCED BY THE FOREIGN KEYS, reverse of creation:
 *   1. role_capabilities  — FK role_name → roles(name)
 *   2. user_roles         — FK role_name → roles(name) ON DELETE RESTRICT
 *   3. roles              — the parent, last
 * Deleting the parent first fails loudly (RESTRICT) — correct: a role still held by
 * somebody must not vanish underneath them.
 *
 * The capability STRINGS survive in code (endpoint-application's
 * resource-domain-capability.ts and synthetic-trades' own capability module), exactly
 * as the user-administrator retirement kept its vocabulary. What is retired is the
 * ROLES and their grants, not the capability names. A later identity major may sweep
 * the now-dead symbols; it is not required for correctness.
 *
 * NOT INCLUDED HERE: the `journal-entries` slug. It is subsumed by
 * `trade-journaling-data` (D3) and its meter is already removed from code, but it is
 * still granted by live `plan_version_features` rows (pro-monthly) — removing it is a
 * commerce decision + a plan edit, not a role retirement. It sits harmless (nothing
 * meters it) until that decision is made.
 *
 * `down` is a genuine restore of the roles + their grants, so a rollback leaves a
 * working legacy-authorization environment if the feature model were ever backed out.
 * User-role ASSIGNMENTS are not restored — which users held which role is not
 * reconstructable from here, and the new model does not need them.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const BOOTSTRAP_UUID = '00000000-0000-0000-0000-000000000000.user';

const ROLES = [
  'trades-api-owner-role',
  'trades-api-administrator-role',
  'transactions-owner-role',
  'transactions-administrator-role',
  'file-import-owner-role',
  'file-import-administrator-role',
];

/**
 * The capability grants restored by `down`, per role. Mirrors the era-1 seed
 * (2026-06-09T120000Z_era_1_identity_role_capabilities_seed). Owner and administrator
 * of each family granted the same capabilities in that seed.
 */
// Exactly as found in prod_blue role_capabilities before deletion (verified
// 2026-07-17). The trades-api roles also grant three capabilities that were never
// enforced anywhere — `trade-roles-api:*`, `as-of-yield-reconstitute`,
// `yield-history-reset` — dead symbols carried in the seed; restored for fidelity.
const TRADES_API_CAPS = [
  'trade-roles-api:trade-roles-api-capability',
  'trades-api:as-of-yield-reconstitute-capability',
  'trades-api:trades-api-journal-create-capability',
  'trades-api:trades-api-journal-delete-capability',
  'trades-api:trades-api-journal-search-capability',
  'trades-api:trades-api-journal-update-capability',
  'trades-api:trades-api-search-capability',
  'trades-api:trades-api-update-capability',
  'trades-api:trades-api-yield-history-reset-capability',
];
const FILE_IMPORT_CAPS = [
  'file-imports:delete-file-imports-capability',
  'file-imports:import-file-capability',
  'file-imports:list-file-imports-capability',
  'file-imports:parse-file-capability',
  'file-imports:unprocess-file-capability',
];
const GRANTS: Record<string, string[]> = {
  'trades-api-owner-role': TRADES_API_CAPS,
  'trades-api-administrator-role': TRADES_API_CAPS,
  'transactions-owner-role': ['transactions:transactions-search-capability'],
  'transactions-administrator-role': ['transactions:transactions-search-capability'],
  'file-import-owner-role': FILE_IMPORT_CAPS,
  'file-import-administrator-role': FILE_IMPORT_CAPS,
};

export const up = (pgm: MigrationBuilder): void => {
  const inList = ROLES.map(r => `'${r}'`).join(', ');
  // 1. grants, 2. assignments, 3. roles — children before parents (FK order).
  pgm.sql(`DELETE FROM role_capabilities WHERE role_name IN (${inList});`);
  pgm.sql(`DELETE FROM user_roles       WHERE role_name IN (${inList});`);
  pgm.sql(`DELETE FROM roles            WHERE name      IN (${inList});`);
};

export const down = (pgm: MigrationBuilder): void => {
  for (const role of ROLES) {
    pgm.sql(`
      INSERT INTO roles (name, description, created_by, updated_by)
      VALUES ('${role}', 'Restored legacy role (trade-journaling-data retirement rollback)', '${BOOTSTRAP_UUID}', '${BOOTSTRAP_UUID}')
      ON CONFLICT (name) DO NOTHING;
    `);
    for (const cap of GRANTS[role] ?? []) {
      pgm.sql(`
        INSERT INTO role_capabilities (role_name, capability, created_by, updated_by)
        VALUES ('${role}', '${cap}', '${BOOTSTRAP_UUID}', '${BOOTSTRAP_UUID}')
        ON CONFLICT (role_name, capability) DO NOTHING;
      `);
    }
  }
};
