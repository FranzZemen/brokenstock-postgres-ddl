/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Retire the `financial-api` and `instruments` legacy role families — the market-data
 * authorization mechanism, now migrated to feature slugs. See
 * financial-api/doc/prd/market-data-gating.prd.md (E12, D13).
 *
 * VERIFIED IN PRODUCTION BEFORE THIS RAN (D13): Franz confirmed the market-data
 * surfaces (Reference, IPOs, Rotation, Thesis) work under the new slugs. The 71 deep
 * financial-api / instrument-search hasAccess gates were stripped and deployed first
 * (financial-api 35, securities 28, financial-data 5, scanners 1, app-worker 2), so
 * retiring these roles revokes nothing anyone checks.
 *
 * Four roles / eight capabilities:
 *   financial-api-owner-role, financial-api-administrator-role
 *     → financial-api:{stocks,options,funds,bonds,crypto,currencies,dividends}-capability
 *   instruments-owner-role, instruments-administrator-role
 *     → instruments:instrument-search-capability
 *
 * ORDER FORCED BY FKs (reverse of creation): role_capabilities → user_roles → roles.
 *
 * The capability STRINGS survive in code (resource-domain-capability.ts), exactly as
 * every prior retirement kept its vocabulary. What is retired is the ROLES and their
 * grants. A later identity/endpoint-application major may sweep the now-dead symbols
 * across all retired families at once; not required for correctness.
 *
 * `down` restores roles + grants (not user assignments — not reconstructable here and
 * the new model does not need them).
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const BOOTSTRAP_UUID = '00000000-0000-0000-0000-000000000000.user';

const FINANCIAL_API_CAPS = [
  'financial-api:financial-api-bonds-capability',
  'financial-api:financial-api-crypto-capability',
  'financial-api:financial-api-currencies-capability',
  'financial-api:financial-api-dividends-capability',
  'financial-api:financial-api-funds-capability',
  'financial-api:financial-api-options-capability',
  'financial-api:financial-api-stocks-capability',
];
const INSTRUMENTS_CAPS = ['instruments:instrument-search-capability'];

const GRANTS: Record<string, string[]> = {
  'financial-api-owner-role': FINANCIAL_API_CAPS,
  'financial-api-administrator-role': FINANCIAL_API_CAPS,
  'instruments-owner-role': INSTRUMENTS_CAPS,
  'instruments-administrator-role': INSTRUMENTS_CAPS,
};
const ROLES = Object.keys(GRANTS);

export const up = (pgm: MigrationBuilder): void => {
  const inList = ROLES.map(r => `'${r}'`).join(', ');
  pgm.sql(`DELETE FROM role_capabilities WHERE role_name IN (${inList});`);
  pgm.sql(`DELETE FROM user_roles       WHERE role_name IN (${inList});`);
  pgm.sql(`DELETE FROM roles            WHERE name      IN (${inList});`);
};

export const down = (pgm: MigrationBuilder): void => {
  for (const role of ROLES) {
    pgm.sql(`
      INSERT INTO roles (name, description, created_by, updated_by)
      VALUES ('${role}', 'Restored legacy role (market-data-gating retirement rollback)', '${BOOTSTRAP_UUID}', '${BOOTSTRAP_UUID}')
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
