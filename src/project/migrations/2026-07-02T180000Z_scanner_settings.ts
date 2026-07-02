/*
Created by Franz Zemen 2026-07-02
License Type: UNLICENSED

Scanner settings (projects/doc/prd/scanners.prd.md, E1/D8).

Per-user saved filter-sets for scanners — the ONLY thing scanners persist
(D16). Named filter-sets from day one: v1 UI reads/writes the single 'default'
set; a later preset picker needs no migration.

  - scanner_settings  (PK (owner, scanner_slug, name); settings JSONB is the
                       scanner-specific filter shape — e.g. price-size stores
                       {marketCapMin/Max, lastCloseMin/Max})

Design notes:
  * owner = '<uuid>.user' (strict user format — settings are user-owned; the
    system actor never owns a filter-set). No FK to users: the users table PK
    is bare uuid while domain tables carry the '<uuid>.user' actor form, and
    owner-scoped domain tables (transactions, trades, …) follow the same
    FK-less owner convention.
  * scanner_slug is free TEXT (e.g. 'price-size') — the scanner registry lives
    in @franzzemen/scanners, not the DB; a CHECK enum here would force a
    migration per new scanner.
  * settings JSONB NOT NULL — shape is owned/validated by the scanners
    package per scanner_slug; the DB stores it opaquely.
  * Actor CHECK = relaxed (user|brokenstock) on created_by/updated_by per the
    Era-2/3 convention; owner CHECK is strict '.user'.

Pins MIN_SCHEMA_VERSION = 2026-07-02T180000Z for @franzzemen/scanners.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ACTOR_CHK = `~ '^${UUID_RE}\\.(user|brokenstock)$'`;
const OWNER_CHK = `~ '^${UUID_RE}\\.user$'`;

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE scanner_settings (
      owner         TEXT NOT NULL,
      scanner_slug  TEXT NOT NULL,
      name          TEXT NOT NULL DEFAULT 'default',
      settings      JSONB NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by    TEXT NOT NULL,
      updated_by    TEXT NOT NULL,
      PRIMARY KEY (owner, scanner_slug, name),
      CONSTRAINT scanner_settings_owner_format_chk CHECK (owner ${OWNER_CHK}),
      CONSTRAINT scanner_settings_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT scanner_settings_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  pgm.sql(`
    CREATE TRIGGER scanner_settings_set_updated_at BEFORE UPDATE ON scanner_settings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS scanner_settings_set_updated_at ON scanner_settings;`);
  pgm.dropTable('scanner_settings', {ifExists: true});
};
