/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * users — Era 1 C1 identity root. PK is the canonical `<uuid>.user` string;
 * CHECK constraints enforce that shape on uuid/created_by/updated_by so bad
 * actors can't slip in foreign-shaped IDs. username + email are uniquely
 * indexed.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE users (
      uuid           TEXT PRIMARY KEY,
      username       TEXT NOT NULL,
      email          TEXT NOT NULL,
      disabled       BOOLEAN NOT NULL DEFAULT FALSE,
      hash           TEXT NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by     TEXT NOT NULL,
      updated_by     TEXT NOT NULL,
      CONSTRAINT users_uuid_format_chk
        CHECK (uuid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$'),
      CONSTRAINT users_created_by_format_chk
        CHECK (created_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$'),
      CONSTRAINT users_updated_by_format_chk
        CHECK (updated_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$')
    );
  `);
  pgm.createIndex('users', 'username', {name: 'users_username_uidx', unique: true});
  pgm.createIndex('users', 'email', {name: 'users_email_uidx', unique: true});
  pgm.sql(`
    CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS users_set_updated_at ON users;`);
  pgm.dropIndex('users', 'email', {name: 'users_email_uidx'});
  pgm.dropIndex('users', 'username', {name: 'users_username_uidx'});
  pgm.dropTable('users');
};
