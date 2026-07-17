/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Legacy authorization teardown — WAVE 2 (legacy-authz-teardown.prd.md).
 *
 * Retire EVERY remaining legacy role and delete all grants + assignments. After
 * Wave 1, nothing in the fleet calls `hasAccess` against a legacy capability — every
 * surface authorizes on feature slugs (`hasFeature`) or security capabilities
 * (`standard-user` / `standard-admin`, via `user_security_roles`). So these rows grant
 * nothing anyone checks.
 *
 * VERIFIED BEFORE THIS RAN: (a) a fleet-wide sweep found zero live legacy `hasAccess`
 * calls; (b) the administrator (`d234c213…`) holds the `administrator` security role in
 * `user_security_roles`, so the admin console resolves through `standard-admin`; (c)
 * app-worker, admin-app-worker, auth-worker, imports-worker all redeployed healthy on
 * the Wave-1 code.
 *
 * This is a FULL wipe of all three legacy tables' CONTENTS (11 roles, 68 grants, up to
 * 8 assignments) — every role is being retired, not a subset. The tables themselves are
 * DROPPED in Wave 4; this wave empties them first so the retirement can be verified in
 * production before the irreversible code+schema teardown.
 *
 * ORDER FORCED BY FKs: role_capabilities → user_roles → roles.
 *
 * `down` is forward-only — a full legacy wipe is not reconstructable, and the end state
 * (legacy authz gone) is the goal. Rolling back means restoring from the per-family
 * retirement migrations that precede this, then re-adding the Wave-1 code.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`DELETE FROM role_capabilities;`);
  pgm.sql(`DELETE FROM user_roles;`);
  pgm.sql(`DELETE FROM roles;`);
};

export const down = (): void => {
  // Forward-only. See header — a full legacy-role wipe is not restorable here.
};
