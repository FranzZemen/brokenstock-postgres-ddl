/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * market_identifier_code_mappings — Era 2 C1 amendment 2026-06-01. The 7th
 * Era 2 reference-data entity (scope discovery during C3 securities
 * exploration). Maps MIC codes to alternate vendor codes + country codes.
 *
 * DDB shape preserved per `[[feedback-preserve-ddb-access-patterns]]`:
 *   - PK: (mic, alt_code)
 *   - Secondary index on (alt_code, mic) mirrors DDB ALT_CODE_INDEX GSI
 *   - Secondary index on (country_code, mic) mirrors DDB COUNTRY_CODE_INDEX GSI
 *
 * No FK to securities — MIC is a free-form code, not a FK target. No NOTIFY
 * trigger — admin-curated, low change rate, no L5 cache shipped (C3 D7 lists 6
 * L5 services; this entity does not get its own cache).
 *
 * This file's timestamp (2026-06-01T120430Z) is the updated MIN_SCHEMA_VERSION
 * Era 2 consumers pin to (supersedes C1 v0.2.0's 2026-06-01T120400Z).
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE market_identifier_code_mappings (
      mic            TEXT NOT NULL,
      alt_code       TEXT NOT NULL,
      country_code   TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by     TEXT NOT NULL,
      updated_by     TEXT NOT NULL,
      PRIMARY KEY (mic, alt_code),
      CONSTRAINT mic_mappings_created_by_format_chk
        CHECK (created_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$'),
      CONSTRAINT mic_mappings_updated_by_format_chk
        CHECK (updated_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$')
    );
  `);
  pgm.createIndex('market_identifier_code_mappings', ['alt_code', 'mic'], {
    name: 'mic_mappings_alt_code_idx',
  });
  pgm.createIndex('market_identifier_code_mappings', ['country_code', 'mic'], {
    name: 'mic_mappings_country_code_idx',
  });
  pgm.sql(`
    CREATE TRIGGER mic_mappings_set_updated_at BEFORE UPDATE ON market_identifier_code_mappings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS mic_mappings_set_updated_at ON market_identifier_code_mappings;`);
  pgm.dropIndex('market_identifier_code_mappings', ['country_code', 'mic'], {
    name: 'mic_mappings_country_code_idx',
  });
  pgm.dropIndex('market_identifier_code_mappings', ['alt_code', 'mic'], {
    name: 'mic_mappings_alt_code_idx',
  });
  pgm.dropTable('market_identifier_code_mappings');
};
