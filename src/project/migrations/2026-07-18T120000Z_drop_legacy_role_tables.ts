/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Legacy authorization teardown — WAVE 4 (legacy-authz-teardown.prd.md).
 *
 * DROP the three legacy role tables. This is the final, irreversible schema step
 * of the authz migration: authorization is now two mechanisms only — feature
 * slugs (identity `Features` / `hasFeature`) and security capabilities
 * (`user_security_roles` → standard-user / standard-admin). `user_security_roles`
 * is KEPT; only the legacy tables go.
 *
 * SAFE TO DROP — verified before this ran:
 *   - Wave 2 (2026-07-17T170000Z) emptied all three tables (0 rows).
 *   - Wave 4 code deleted `EndpointApplicationsApi.hasAccess` and its
 *     `role_capabilities` query, `sessions-api`'s `user_roles` JOIN, the users
 *     package's `user_roles` CRUD, and the purge registry's `user_roles` entry.
 *     A fleet-wide sweep found zero remaining runtime readers/writers.
 *
 * ORDER FORCED BY FKs: role_capabilities (FK→roles) → user_roles (FK→roles,users)
 * → roles. `IF EXISTS` so a worker that self-applied this on startup and an
 * explicit `abs.migrate` are both idempotent.
 *
 * `down` is forward-only — the legacy role model is retired by design and the
 * tables held no data worth reconstructing. Recreating them would also require
 * restoring the deleted code, which is not this migration's concern.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TABLE IF EXISTS role_capabilities;`);
  pgm.sql(`DROP TABLE IF EXISTS user_roles;`);
  pgm.sql(`DROP TABLE IF EXISTS roles;`);
};

export const down = (): void => {
  // Forward-only. See header — the legacy role tables are retired by design.
};
