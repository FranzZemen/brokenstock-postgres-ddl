/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * user_security_roles — the assignment table for the NEW security model
 * (`@franzzemen/endpoint-identity`: PrincipalKind / SecurityRole /
 * SecurityCapability).
 *
 * This is a PARALLEL structure. `roles`, `user_roles` and `role_capabilities`
 * are untouched and keep working until their last consumer is migrated; the two
 * systems coexist deliberately, with an "or" allowance at the gates, and the
 * legacy path is removed only once nothing reads it. See the transition cleanup
 * checklist in broken-stock/doc/uat/new-user-walkthrough.uat.md.
 *
 * WHY NO PARENT TABLE AND NO FK ON security_role
 * ----------------------------------------------
 * `user_roles.role_name` FKs to a seeded `roles` table (ON DELETE RESTRICT).
 * The mirror here would be a `security_roles` table — but that materialises a
 * copy of a vocabulary that is now CODE-OWNED. `SecurityRole` is declared in
 * `@franzzemen/endpoint-identity` as an `as const` array with the union derived
 * from it; the API validates writes with `isSecurityRole`. A DB copy would have
 * to be seeded by migration and kept in step with the union — reintroducing, for
 * roles, exactly the drift problem the code-as-source-of-truth rule exists to
 * prevent. Same reasoning that rejected a `features` catalog table.
 *
 * A CHECK constraint (`security_role IN ('user','administrator')`) was also
 * considered and rejected for the same reason: it would make adding a role a
 * migration, which contradicts the vocabulary living in code.
 *
 * The trade-off is explicit and accepted: an INSERT made directly in psql can
 * write a role name the code does not know. Such a row grants nothing —
 * `resolveCapabilities` ignores unrecognised roles (fail-closed) — so the blast
 * radius is a dead row, not a privilege escalation.
 *
 * WHY NO principal_kind COLUMN
 * ----------------------------
 * Every row in `users` is a `human` principal by definition. `system` is coded,
 * not stored — nothing powerful gets a row in `users`. A column whose value is
 * constant across every row carries no information.
 *
 * NO BACKFILL. Nothing reads this table yet. Granting `user` to the existing
 * population before there is a consumer would be inventing state; roles are
 * assigned explicitly, and signup's default grant lands as its own change.
 *
 * Bumps MIN_SCHEMA_VERSION = 2026-07-16T140000Z (consumer: @franzzemen/users).
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const USER_FMT = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE user_security_roles (
      user_uuid      TEXT NOT NULL,
      security_role  TEXT NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by     TEXT NOT NULL,
      updated_by     TEXT NOT NULL,
      PRIMARY KEY (user_uuid, security_role),
      CONSTRAINT user_security_roles_user_uuid_fkey
        FOREIGN KEY (user_uuid) REFERENCES users(uuid) ON DELETE CASCADE,
      CONSTRAINT user_security_roles_created_by_format_chk
        CHECK (created_by ~ '${USER_FMT}'),
      CONSTRAINT user_security_roles_updated_by_format_chk
        CHECK (updated_by ~ '${USER_FMT}')
    );
  `);

  pgm.sql(`
    CREATE TRIGGER user_security_roles_set_updated_at BEFORE UPDATE ON user_security_roles
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // The PK's leading `user_uuid` already serves the hot read ("what does this
  // principal hold?", once per authorization decision). This index serves the
  // reverse: "who holds `administrator`?" — an admin-console question, and the
  // one an operator asks when auditing who can do what.
  pgm.createIndex('user_security_roles', 'security_role', {name: 'user_security_roles_security_role_idx'});
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS user_security_roles_set_updated_at ON user_security_roles;`);
  pgm.dropTable('user_security_roles', {ifExists: true});
};
