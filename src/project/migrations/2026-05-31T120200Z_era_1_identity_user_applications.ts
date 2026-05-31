/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * user_applications — Era 1 C1 which apps a user may access. Application set
 * is closed via CHECK (brokenstock | brokenstock-admin); changes require a
 * migration so the set stays auditable.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE user_applications (
      user_uuid    TEXT NOT NULL,
      application  TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by   TEXT NOT NULL,
      updated_by   TEXT NOT NULL,
      PRIMARY KEY (user_uuid, application),
      CONSTRAINT user_applications_user_uuid_fkey
        FOREIGN KEY (user_uuid) REFERENCES users(uuid) ON DELETE CASCADE,
      CONSTRAINT user_applications_application_chk
        CHECK (application IN ('brokenstock', 'brokenstock-admin'))
    );
  `);
  pgm.createIndex('user_applications', 'user_uuid', {name: 'user_applications_user_uuid_idx'});
  pgm.sql(`
    CREATE TRIGGER user_applications_set_updated_at BEFORE UPDATE ON user_applications
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS user_applications_set_updated_at ON user_applications;`);
  pgm.dropIndex('user_applications', 'user_uuid', {name: 'user_applications_user_uuid_idx'});
  pgm.dropTable('user_applications');
};
