/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * role_capabilities — Era 1 C1 M:N between roles and capability strings.
 * Capability strings are free-form TEXT (the closed set lives in code);
 * role deletes cascade their capability rows. No seed — capabilities are
 * assigned by administrators post-bootstrap.
 *
 * This file's timestamp (2026-05-31T120300Z) is the MIN_SCHEMA_VERSION for
 * Era 1 C1 — any consumer that depends on the full Era 1 identity schema
 * pins to this value.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE role_capabilities (
      role_name     TEXT NOT NULL,
      capability    TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by    TEXT NOT NULL,
      updated_by    TEXT NOT NULL,
      PRIMARY KEY (role_name, capability),
      CONSTRAINT role_capabilities_role_name_fkey
        FOREIGN KEY (role_name) REFERENCES roles(name) ON DELETE CASCADE
    );
  `);
  pgm.createIndex('role_capabilities', 'role_name', {name: 'role_capabilities_role_name_idx'});
  pgm.sql(`
    CREATE TRIGGER role_capabilities_set_updated_at BEFORE UPDATE ON role_capabilities
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS role_capabilities_set_updated_at ON role_capabilities;`);
  pgm.dropIndex('role_capabilities', 'role_name', {name: 'role_capabilities_role_name_idx'});
  pgm.dropTable('role_capabilities');
};
