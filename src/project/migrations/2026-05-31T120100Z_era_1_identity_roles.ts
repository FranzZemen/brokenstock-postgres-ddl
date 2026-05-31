/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * roles — Era 1 C1 closed set of named roles. PK is the role name itself
 * (low-cardinality, stable, human-meaningful). Seeded with the 21 canonical
 * RoleNames from identity/role.ts via the all-zero bootstrap UUID.
 * Per C1 PRD: no FK on created_by/updated_by to users (deliberate — roles
 * predate any real user).
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const ROLES = [
  'user-administrator-role',
  'accounts-administrator-role',
  'accounts-owner-role',
  'file-import-administrator-role',
  'file-import-owner-role',
  'instruments-administrator-role',
  'instruments-owner-role',
  'transactions-administrator-role',
  'transactions-owner-role',
  'analytics-administrator-role',
  'analytics-owner-role',
  'financial-api-administrator-role',
  'financial-api-owner-role',
  'trades-api-administrator-role',
  'trades-api-owner-role',
  'subscription-plans-administrator-role',
  'subscription-plans-reader-role',
  'user-subscriptions-administrator-role',
  'user-subscriptions-owner-role',
  'security-aliases-administrator-role',
  'security-aliases-owner-role',
];

const BOOTSTRAP_UUID = '00000000-0000-0000-0000-000000000000.user';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE roles (
      name        TEXT PRIMARY KEY,
      description TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by  TEXT NOT NULL,
      updated_by  TEXT NOT NULL
    );
  `);
  pgm.sql(`
    CREATE TRIGGER roles_set_updated_at BEFORE UPDATE ON roles
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
  const values = ROLES.map(r => `('${r}', '${BOOTSTRAP_UUID}', '${BOOTSTRAP_UUID}')`).join(',\n      ');
  pgm.sql(`
    INSERT INTO roles (name, created_by, updated_by) VALUES
      ${values};
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  const list = ROLES.map(r => `'${r}'`).join(', ');
  pgm.sql(`DELETE FROM roles WHERE name IN (${list});`);
  pgm.sql(`DROP TRIGGER IF EXISTS roles_set_updated_at ON roles;`);
  pgm.dropTable('roles');
};
