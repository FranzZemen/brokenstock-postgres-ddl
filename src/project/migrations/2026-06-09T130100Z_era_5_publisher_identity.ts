/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * publisher_identity — Era 5 DDB→PG migration of `@franzzemen/publish-thesis`
 * `PublisherIdentityApi` (was DDB `PUBLISHER_IDENTITY`). One row per owner
 * (getOrCreate). `publisher_uuid` is the privacy-safe public path segment
 * (distinct from owner_uuid) and is unique.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE publisher_identity (
      owner_uuid          TEXT PRIMARY KEY,
      publisher_uuid      TEXT NOT NULL UNIQUE,
      is_index_published  BOOLEAN NOT NULL DEFAULT false,
      index_link          TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by          TEXT NOT NULL,
      updated_by          TEXT NOT NULL
    );
  `);
  pgm.sql(`
    CREATE TRIGGER publisher_identity_set_updated_at BEFORE UPDATE ON publisher_identity
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS publisher_identity_set_updated_at ON publisher_identity;`);
  pgm.dropTable('publisher_identity');
};
