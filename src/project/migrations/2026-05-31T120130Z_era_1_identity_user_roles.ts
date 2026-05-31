/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * user_roles — Era 1 C1 M:N join between users and roles.
 * User deletes cascade; role deletes are RESTRICTed (roles are a closed set
 * and shouldn't disappear from under live assignments).
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE user_roles (
      user_uuid   TEXT NOT NULL,
      role_name   TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by  TEXT NOT NULL,
      updated_by  TEXT NOT NULL,
      PRIMARY KEY (user_uuid, role_name),
      CONSTRAINT user_roles_user_uuid_fkey
        FOREIGN KEY (user_uuid) REFERENCES users(uuid) ON DELETE CASCADE,
      CONSTRAINT user_roles_role_name_fkey
        FOREIGN KEY (role_name) REFERENCES roles(name) ON DELETE RESTRICT
    );
  `);
  pgm.createIndex('user_roles', 'user_uuid', {name: 'user_roles_user_uuid_idx'});
  pgm.createIndex('user_roles', 'role_name', {name: 'user_roles_role_name_idx'});
  pgm.sql(`
    CREATE TRIGGER user_roles_set_updated_at BEFORE UPDATE ON user_roles
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS user_roles_set_updated_at ON user_roles;`);
  pgm.dropIndex('user_roles', 'role_name', {name: 'user_roles_role_name_idx'});
  pgm.dropIndex('user_roles', 'user_uuid', {name: 'user_roles_user_uuid_idx'});
  pgm.dropTable('user_roles');
};
