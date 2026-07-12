/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * role_capabilities SEED — user:delete-user-capability (2026-07-12).
 *
 * Grants the new full-data-purge capability (endpoint-application 12.2.0) to
 * `user-administrator-role`, the same role that already holds create/edit/get.
 * It is deliberately a SEPARATE capability from `user:edit-users-capability`
 * rather than folded into it: edit covers the reversible disable, this covers an
 * irreversible erasure of every row the user owns. Splitting them means a role
 * can be granted day-to-day user administration without the ability to destroy.
 *
 * Follows 2026-06-09T120000Z_era_1_identity_role_capabilities_seed.ts:
 * INSERT ... ON CONFLICT DO NOTHING, so re-running against a populated prod_blue
 * is a no-op and a fresh environment comes up at parity.
 *
 * The route that gates on this capability (DELETE /admin/users/:username on
 * brokenstock-auth-worker) ships after this migration — seeding first means the
 * route is never live-but-deny-all.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const BOOTSTRAP_UUID = '00000000-0000-0000-0000-000000000000.user';

const ROLE_CAPABILITIES: ReadonlyArray<readonly [string, string]> = [
  ['user-administrator-role', 'user:delete-user-capability'],
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
