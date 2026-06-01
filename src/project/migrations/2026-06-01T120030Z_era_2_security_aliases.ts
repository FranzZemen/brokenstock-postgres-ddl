/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * security_aliases — Era 2 C1. Composite PK (alias_type, alias) preserves
 * DDB primary + sort. One secondary index on (security_key, alias_type)
 * mirrors DDB's `key-index` GSI. FK to securities is RESTRICT — aliases
 * are hand-curated mappings worth surfacing if their target disappears
 * (per Era 2 super-PRD D9).
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE security_aliases (
      alias_type    TEXT NOT NULL,
      alias         TEXT NOT NULL,
      security_key  TEXT NOT NULL REFERENCES securities(key) ON DELETE RESTRICT,
      ignored       BOOLEAN,
      unlisted      BOOLEAN,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by    TEXT NOT NULL,
      updated_by    TEXT NOT NULL,
      PRIMARY KEY (alias_type, alias),
      CONSTRAINT security_aliases_created_by_format_chk
        CHECK (created_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$'),
      CONSTRAINT security_aliases_updated_by_format_chk
        CHECK (updated_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$')
    );
  `);
  pgm.createIndex('security_aliases', ['security_key', 'alias_type'], {
    name: 'security_aliases_security_key_idx',
  });
  pgm.sql(`
    CREATE TRIGGER security_aliases_set_updated_at BEFORE UPDATE ON security_aliases
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS security_aliases_set_updated_at ON security_aliases;`);
  pgm.dropIndex('security_aliases', ['security_key', 'alias_type'], {
    name: 'security_aliases_security_key_idx',
  });
  pgm.dropTable('security_aliases');
};
