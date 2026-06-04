/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Era 3 C3 (2026-06-04) — PROVENANCE owner/ignored_by type fix.
 *
 * The 0.8.0 provenance migration typed `owner` (all 5 tables) and
 * `ignored_by` (brokerage_records) as native Postgres `UUID`. But these
 * columns hold BRANDED identities — `getSessionOwner()` returns
 * `AccountOwner = UUID<'user'>`, whose runtime value carries a `.user`
 * suffix (utility.getUUID: `${uuid()}.${objectType}`); `ignored_by` is an
 * actor that may be `<uuid>.user` OR `<uuid>.brokenstock`. The native `uuid`
 * type rejects the suffix (`invalid input syntax for type uuid`) at the first
 * insert — the exact class of cutover bug that only appears at insert time
 * (reference-ddb-pg-cutover-gotchas #2: "actor namespace is not just .user").
 *
 * The suffix is intentional: it identifies the DOMAIN SHAPE of the identity
 * (.user vs .brokenstock). So the columns must be TEXT holding the full
 * branded value — matching the Era-1 identity convention (users.uuid TEXT
 * `<uuid>.user`; user_roles.user_uuid TEXT). This migration retypes them and
 * adds the format CHECKs that guard the domain-shape invariant:
 *   - owner       → TEXT, CHECK `<uuid>.user$`         (an account owner is always a user)
 *   - ignored_by  → TEXT, CHECK `<uuid>.(user|brokenstock)$` (a record may be auto-ignored by a system actor)
 *
 * Provenance tables are empty in C3 (nothing is written yet), so the ALTERs
 * are trivial. schema-types already declares both columns as `string` — no
 * TS change. Pins MIN_SCHEMA_VERSION = 2026-06-04T130000Z (supersedes the
 * 0.8.0 provenance pin); the C3 domain packages pin this timestamp.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const OWNER_CHK = `~ '^${UUID_RE}\\.user$'`;          // an account owner is always a user
const ACTOR_CHK = `~ '^${UUID_RE}\\.(user|brokenstock)$'`; // ignored_by may be a system actor

const OWNER_TABLES: ReadonlyArray<string> = [
  'brokerage_accounts',
  'brokerage_file_imports',
  'brokerage_records',
  'brokerage_imports',
  'cash_entry',
];

export const up = (pgm: MigrationBuilder): void => {
  for (const table of OWNER_TABLES) {
    pgm.sql(`
      ALTER TABLE ${table} ALTER COLUMN owner TYPE TEXT;
      ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_owner_format_chk CHECK (owner ${OWNER_CHK});
    `);
  }
  pgm.sql(`
    ALTER TABLE brokerage_records ALTER COLUMN ignored_by TYPE TEXT;
    ALTER TABLE brokerage_records
      ADD CONSTRAINT brokerage_records_ignored_by_format_chk
        CHECK (ignored_by ${ACTOR_CHK});
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  // Reverse to native UUID, stripping the branded suffix. Safe on the empty
  // C3 tables; lossy by design (the suffix is exactly what up() preserves).
  pgm.sql(`
    ALTER TABLE brokerage_records DROP CONSTRAINT IF EXISTS brokerage_records_ignored_by_format_chk;
    ALTER TABLE brokerage_records
      ALTER COLUMN ignored_by TYPE UUID USING (regexp_replace(ignored_by, '\\..*$', ''))::uuid;
  `);
  for (const table of OWNER_TABLES) {
    pgm.sql(`
      ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_owner_format_chk;
      ALTER TABLE ${table}
        ALTER COLUMN owner TYPE UUID USING (regexp_replace(owner, '\\..*$', ''))::uuid;
    `);
  }
};
