/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Era 3 C3 (2026-06-04) — PROVENANCE app-minted PKs.
 *
 * The 0.8.0 provenance migration (D6) drafted every PK as
 * `<entity>_id UUID PRIMARY KEY DEFAULT gen_random_uuid()` — DB-generated,
 * native uuid, NO suffix. That contradicts the project-wide convention: UUIDs
 * are APP-MINTED via @franzzemen/utility.getUUID<T>() and carry a domain-shape
 * suffix (`<uuid>.<type>`), stored as TEXT — exactly like users.uuid and
 * FileImportUUID (`<uuid>.file-import`, which already existed and was being
 * thrown away by the gen_random_uuid PK). The suffix identifies the domain
 * shape and has value long after migration (Franz, 2026-06-04).
 *
 * This migration retypes the 5 provenance PKs (and the child FK columns that
 * reference them) native UUID → TEXT, drops the gen_random_uuid defaults, and
 * adds the suffix-format CHECKs. The app now supplies the branded id on insert
 * via getBrokerageAccountUUID / getFileImportUUID / getBrokerageRecordUUID /
 * getBrokerageImportUUID / getCashEntryUUID (endpoint-financial-identity).
 *
 *   brokerage_accounts.account_id        → '<uuid>.account'
 *   brokerage_file_imports.file_import_id→ '<uuid>.file-import'
 *   brokerage_records.record_id          → '<uuid>.record'
 *   brokerage_imports.import_id          → '<uuid>.import'
 *   cash_entry.cash_entry_id             → '<uuid>.cash-entry'
 *
 * Provenance tables are empty in C3, so the ALTERs are trivial. owner /
 * ignored_by (0.8.1) and security_key (already TEXT) are untouched. Pins
 * MIN_SCHEMA_VERSION = 2026-06-04T140000Z; the C3 domain packages pin this.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

// [table, pk-column, suffix]
const PKS: ReadonlyArray<readonly [string, string, string]> = [
  ['brokerage_accounts', 'account_id', 'account'],
  ['brokerage_file_imports', 'file_import_id', 'file-import'],
  ['brokerage_records', 'record_id', 'record'],
  ['brokerage_imports', 'import_id', 'import'],
  ['cash_entry', 'cash_entry_id', 'cash-entry'],
];

// [table, fk-column, ref-table, ref-column] — child columns referencing the PKs.
// Postgres inline single-column REFERENCES auto-names the constraint
// `<table>_<column>_fkey`.
const FKS: ReadonlyArray<readonly [string, string, string, string]> = [
  ['brokerage_file_imports', 'account_id', 'brokerage_accounts', 'account_id'],
  ['brokerage_records', 'account_id', 'brokerage_accounts', 'account_id'],
  ['brokerage_records', 'file_import_id', 'brokerage_file_imports', 'file_import_id'],
  ['brokerage_imports', 'account_id', 'brokerage_accounts', 'account_id'],
  ['brokerage_imports', 'file_import_id', 'brokerage_file_imports', 'file_import_id'],
  ['cash_entry', 'account_id', 'brokerage_accounts', 'account_id'],
  ['cash_entry', 'file_import_id', 'brokerage_file_imports', 'file_import_id'],
];

export const up = (pgm: MigrationBuilder): void => {
  // 1. Drop FK constraints so the referenced PK types can change.
  for (const [table, col] of FKS) {
    pgm.sql(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_${col}_fkey;`);
  }
  // 2. Retype child FK columns UUID → TEXT (uuid → text is an assignment-safe cast).
  for (const [table, col] of FKS) {
    pgm.sql(`ALTER TABLE ${table} ALTER COLUMN ${col} TYPE TEXT;`);
  }
  // 3. Retype PKs UUID → TEXT, drop the gen_random_uuid default, add suffix CHECK.
  for (const [table, col, suffix] of PKS) {
    pgm.sql(`
      ALTER TABLE ${table} ALTER COLUMN ${col} DROP DEFAULT;
      ALTER TABLE ${table} ALTER COLUMN ${col} TYPE TEXT;
      ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_${col}_format_chk
          CHECK (${col} ~ '^${UUID_RE}\\.${suffix}$');
    `);
  }
  // 4. Recreate the FK constraints (now TEXT → TEXT).
  for (const [table, col, refTable, refCol] of FKS) {
    pgm.sql(`
      ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_${col}_fkey
          FOREIGN KEY (${col}) REFERENCES ${refTable}(${refCol});
    `);
  }
};

export const down = (pgm: MigrationBuilder): void => {
  // Reverse: drop FKs + CHECKs, retype back to native UUID (strip the branded
  // suffix — lossy by design; safe on empty tables), restore gen_random_uuid
  // defaults, recreate FKs.
  for (const [table, col] of FKS) {
    pgm.sql(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_${col}_fkey;`);
  }
  for (const [table, col] of PKS) {
    pgm.sql(`
      ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_${col}_format_chk;
      ALTER TABLE ${table}
        ALTER COLUMN ${col} TYPE UUID USING (regexp_replace(${col}, '\\..*$', ''))::uuid;
      ALTER TABLE ${table} ALTER COLUMN ${col} SET DEFAULT gen_random_uuid();
    `);
  }
  for (const [table, col] of FKS) {
    pgm.sql(`
      ALTER TABLE ${table}
        ALTER COLUMN ${col} TYPE UUID USING (regexp_replace(${col}, '\\..*$', ''))::uuid;
    `);
  }
  for (const [table, col, refTable, refCol] of FKS) {
    pgm.sql(`
      ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_${col}_fkey
          FOREIGN KEY (${col}) REFERENCES ${refTable}(${refCol});
    `);
  }
};
