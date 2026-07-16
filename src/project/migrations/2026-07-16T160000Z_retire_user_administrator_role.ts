/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Retire `user-administrator-role`.
 *
 * The role is replaced by the new security model (@franzzemen/endpoint-identity:
 * SecurityRole 'administrator' → SecurityCapability 'standard-admin'). Every
 * capability it granted is satisfied through LEGACY_CAPABILITY_SECURITY_MAP in
 * endpoint-application, which `EndpointApplicationsApi.hasAccess` consults when the
 * legacy leg says no — so all thirteen `user:*`-gated routes keep working with no
 * route changes at all.
 *
 * VERIFIED IN PRODUCTION BEFORE THIS RAN: StiSelini administered users while
 * holding ONLY the `administrator` security role and no legacy role. The role was
 * demonstrated to be dead weight, not assumed to be.
 *
 * ORDER IS FORCED BY THE FOREIGN KEYS, and it is the reverse of how the rows were
 * created:
 *   1. role_capabilities  — FK role_name → roles(name)
 *   2. user_roles         — FK role_name → roles(name) ON DELETE RESTRICT
 *   3. roles              — the parent, last
 * Deleting the parent first fails loudly (RESTRICT), which is correct: a role still
 * held by somebody must not vanish underneath them.
 *
 * The five LIVE capabilities being revoked (all granted by this role ALONE — there
 * is no user-owner-role, so nothing backstops them; that is exactly why the gates
 * had to move first):
 *   user:create-user-capability          (2026-06-09T120000Z seed :89)
 *   user:edit-users-capability           (:90)
 *   user:get-user-by-email-capability    (:91)
 *   user:get-user-by-username-capability (:92)
 *   user:delete-user-capability          (2026-07-12T120100Z_user_delete_capability_seed:28)
 *
 * The sixth, `user:logout-capability` (:93), was already dead — nothing in the fleet
 * ever checked it and the logout route is ungated by design. It is deleted here with
 * the rest rather than left as an orphan row pointing at a role that no longer exists.
 *
 * NOTE the capability STRINGS survive in code (endpoint-application's
 * resource-domain-capability.ts): the routes still ask for them, and the map answers.
 * What is retired is the ROLE and its grants, not the vocabulary of capabilities.
 *
 * `down` is a genuine restore — grants included — because a forward-only rollback
 * would leave an environment with no way to administer users if the new model were
 * ever backed out.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const ROLE = 'user-administrator-role';
const BOOTSTRAP_UUID = '00000000-0000-0000-0000-000000000000.user';

/** The six pairs seeded for this role, across two prior migrations. */
const CAPABILITIES = [
  'user:create-user-capability',
  'user:edit-users-capability',
  'user:get-user-by-email-capability',
  'user:get-user-by-username-capability',
  'user:logout-capability',
  'user:delete-user-capability',
];

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`DELETE FROM role_capabilities WHERE role_name = '${ROLE}';`);
  pgm.sql(`DELETE FROM user_roles WHERE role_name = '${ROLE}';`);
  pgm.sql(`DELETE FROM roles WHERE name = '${ROLE}';`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    INSERT INTO roles (name, created_by, updated_by)
    VALUES ('${ROLE}', '${BOOTSTRAP_UUID}', '${BOOTSTRAP_UUID}')
    ON CONFLICT (name) DO NOTHING;
  `);
  const values = CAPABILITIES
    .map(c => `('${ROLE}', '${c}', '${BOOTSTRAP_UUID}', '${BOOTSTRAP_UUID}')`)
    .join(',\n      ');
  pgm.sql(`
    INSERT INTO role_capabilities (role_name, capability, created_by, updated_by)
    VALUES
      ${values}
    ON CONFLICT DO NOTHING;
  `);
  // user_roles is NOT restored: which users held the role is not recoverable from
  // here, and re-granting it to a guess would be worse than leaving it to an admin.
};
