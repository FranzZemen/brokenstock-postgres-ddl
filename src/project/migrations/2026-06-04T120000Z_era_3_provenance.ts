/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Era 3 C3 (2026-06-04) — PROVENANCE. The keystone schema migrating the 5
 * provenance entities DDB → Postgres:
 *
 *   brokerage_accounts      (parent — owner/brokerage/account identity)
 *   brokerage_file_imports  (one row per imported file; references accounts)
 *   brokerage_records       (parsed broker rows; references file_imports + securities)
 *   brokerage_imports       (per-file import summary; references file_imports)
 *   cash_entry              (cash ledger entries; references file_imports; txn FK in C4)
 *
 * Decisions encoded (era-3-c03-provenance.prd.md, CD-1…CD-9 + D6/D7/D10/D12):
 *  - D6  : surrogate UUID PKs (`<entity>_id uuid PK DEFAULT gen_random_uuid()`);
 *          the DDB stringly-typed composite keys (accountPartition,
 *          brokerageAccountFilename) are dropped in favour of real columns +
 *          UNIQUE constraints.
 *  - CD-1: audit columns = Era-1/2 convention — created_at/updated_at
 *          TIMESTAMPTZ + per-table set_updated_at() trigger; created_by/
 *          updated_by TEXT each with the actor-format CHECK (regex copied
 *          VERBATIM from vendor_sync_jobs). NO NOTIFY trigger on provenance
 *          tables.
 *  - CD-2: `owner uuid NOT NULL` denormalized onto the 4 child tables (real
 *          indexed column — owner-scoped queries are the dominant DDB access
 *          pattern). brokerage/account are NOT denormalized onto children —
 *          reached via account_id → brokerage_accounts.
 *  - CD-3: enums = TEXT + CHECK (Brokerage 4, FileImportStatus 17,
 *          ParserName 6, BrokerageRecordStatus 5); TS unions in schema-types
 *          mirror the CHECKs. Not native PG enum types.
 *  - CD-4: time mapping — *Epoch (ms) → TIMESTAMPTZ; Datestamp (YYYY-MM-DD)
 *          → DATE. ⚠ DATE-TZ off-by-one vigilance (reference-ddb-pg-cutover-
 *          gotchas) at the API edge.
 *  - CD-5: brokerage_file_imports — `metrics` → 7 TYPED numeric columns
 *          (commercial-queryability); `history` → JSONB (variable status log).
 *  - CD-6: no DDB→PG row transform; the re-pointed parse/reconcile pipeline
 *          populates security_key + file_import_id natively at re-import time.
 *  - CD-7: index preservation honouring DDB access patterns (see per-table
 *          indexes below); records uses a PARTIAL index
 *          WHERE status='pending-split-resolution' (replaces the DDB
 *          status-index GSI).
 *  - D7  : brokerage_records.payload JSONB carries the open generic
 *          IMPORT_RECORD broker payload (no fixed broker column list).
 *  - CD-8/D10: cash_entry.transaction_id is NOT created here — added in C4.
 *
 * brokerage_records.security_key → securities(key) is a real FK (securities
 * already in PG since Era 2). securities(key) is TEXT (mic:ticker composite).
 *
 * FK-dependency order (up): accounts → file_imports → records / imports /
 * cash_entry. down() drops in reverse.
 *
 * Pins MIN_SCHEMA_VERSION = 2026-06-04T120000Z.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

// Actor-format CHECK — the RELAXED form (Era-2 actor_chk_relax, 2026-06-02):
// accepts `<uuid>.user` OR `<uuid>.brokenstock`. Provenance rows are written by
// the user on intake AND by SYSTEM identities during reconcile/process on
// imports-worker — `.user`-only would reject the pipeline writes (the exact
// failure Era-2 C5 hit on prices_equity).
const ACTOR_CHK_FRAGMENT =
  "'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(user|brokenstock)$'";

export const up = (pgm: MigrationBuilder): void => {
  // ---- brokerage_accounts (parent) ----------------------------------------
  pgm.sql(`
    CREATE TABLE brokerage_accounts (
      account_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner        UUID NOT NULL,
      brokerage    TEXT NOT NULL,
      account      TEXT NOT NULL,
      nickname     TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by   TEXT NOT NULL,
      updated_by   TEXT NOT NULL,
      CONSTRAINT brokerage_accounts_brokerage_chk
        CHECK (brokerage IN ('Unknown', 'Fidelity', 'IBKR', 'Schwab')),
      CONSTRAINT brokerage_accounts_created_by_format_chk
        CHECK (created_by ~ ${ACTOR_CHK_FRAGMENT}),
      CONSTRAINT brokerage_accounts_updated_by_format_chk
        CHECK (updated_by ~ ${ACTOR_CHK_FRAGMENT})
    );
  `);
  // D6 / CD-7 / DEV-1: accountPartition string key dropped → UNIQUE identity.
  pgm.createIndex('brokerage_accounts', ['owner', 'brokerage', 'account'], {
    name: 'brokerage_accounts_identity_uidx',
    unique: true,
  });
  pgm.createIndex('brokerage_accounts', ['owner'], {
    name: 'brokerage_accounts_owner_idx',
  });
  // The old DDB brokerage-index LSI.
  pgm.createIndex('brokerage_accounts', ['owner', 'brokerage'], {
    name: 'brokerage_accounts_owner_brokerage_idx',
  });
  pgm.sql(`
    CREATE TRIGGER brokerage_accounts_set_updated_at BEFORE UPDATE ON brokerage_accounts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ---- brokerage_file_imports ---------------------------------------------
  // FileImport + _FileImport. metrics → 7 typed numeric columns (CD-5);
  // history → JSONB (CD-5). *Epoch → TIMESTAMPTZ; Datestamp → DATE (CD-4).
  pgm.sql(`
    CREATE TABLE brokerage_file_imports (
      file_import_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner                       UUID NOT NULL,
      account_id                  UUID NOT NULL REFERENCES brokerage_accounts(account_id),
      filename                    TEXT NOT NULL,
      original_filename           TEXT,
      brokerage_account_filename  TEXT NOT NULL,
      split                       BOOLEAN,
      import_date                 TIMESTAMPTZ,
      status                      TEXT,
      status_text                 TEXT,
      parser_name                 TEXT,
      earliest_transaction        DATE,
      latest_transaction          DATE,
      exported_date               DATE,
      history                     JSONB,
      retry_after                 TIMESTAMPTZ,
      pause_source                TEXT,
      pre_calculate_dependencies  BOOLEAN,
      hash                        TEXT NOT NULL,
      length                      BIGINT NOT NULL,
      metric_total_tx             NUMERIC,
      metric_parser_dropped_count NUMERIC,
      metric_split_dropped_count  NUMERIC,
      metric_near_miss_count      NUMERIC,
      metric_alias_ignored_tx     NUMERIC,
      metric_remapped_tx          NUMERIC,
      metric_unlisted_tx          NUMERIC,
      created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by                  TEXT NOT NULL,
      updated_by                  TEXT NOT NULL,
      CONSTRAINT brokerage_file_imports_status_chk
        CHECK (status IN ('none', 'imported',
                          'pending split multiple accounts decision',
                          'ready for parsing', 'parsing',
                          'pending instrument identification',
                          'ready for processing', 'adjusting for stock splits',
                          'processing', 'processed', 'matched', 'failed',
                          'unprocessing', 'deleting', 'retrying',
                          'pending duplicate records decision',
                          'calculating-dependencies', 'complete')),
      CONSTRAINT brokerage_file_imports_parser_name_chk
        CHECK (parser_name IN ('Standard JSON History Parser',
                              'Fidelity CSV Parser',
                              'Fidelity Multiple Account CSV Parser',
                              'Fidelity Retirement Parser',
                              'IBKR XML Flex Query Parser',
                              'Schwab Think Or Swim CSV Parser')),
      CONSTRAINT brokerage_file_imports_created_by_format_chk
        CHECK (created_by ~ ${ACTOR_CHK_FRAGMENT}),
      CONSTRAINT brokerage_file_imports_updated_by_format_chk
        CHECK (updated_by ~ ${ACTOR_CHK_FRAGMENT})
    );
  `);
  pgm.createIndex('brokerage_file_imports', ['filename'], {
    name: 'brokerage_file_imports_filename_idx',
  });
  pgm.createIndex('brokerage_file_imports', ['brokerage_account_filename'], {
    name: 'brokerage_file_imports_baf_idx',
  });
  pgm.createIndex('brokerage_file_imports', ['hash'], {
    name: 'brokerage_file_imports_hash_idx',
  });
  pgm.createIndex('brokerage_file_imports', ['account_id'], {
    name: 'brokerage_file_imports_account_id_idx',
  });
  pgm.createIndex('brokerage_file_imports', ['owner'], {
    name: 'brokerage_file_imports_owner_idx',
  });
  pgm.sql(`
    CREATE TRIGGER brokerage_file_imports_set_updated_at BEFORE UPDATE ON brokerage_file_imports
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ---- brokerage_records --------------------------------------------------
  // BrokerageRecordBase + _ extras. payload JSONB = open IMPORT_RECORD (D7).
  // file_import_id NOT NULL (every record originates from a file). security_key
  // nullable — set during reconcile (D12/CD-6).
  pgm.sql(`
    CREATE TABLE brokerage_records (
      record_id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner                        UUID NOT NULL,
      account_id                   UUID NOT NULL REFERENCES brokerage_accounts(account_id),
      file_import_id               UUID NOT NULL REFERENCES brokerage_file_imports(file_import_id),
      security_key                 TEXT REFERENCES securities(key),
      status                       TEXT NOT NULL,
      filename                     TEXT,
      brokerage_unique_identifier  TEXT,
      hash                         TEXT,
      ignored_by                   UUID,
      ignored_at                   TIMESTAMPTZ,
      resolved_at                  TIMESTAMPTZ,
      resolution_diagnostic        TEXT,
      payload                      JSONB,
      created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by                   TEXT NOT NULL,
      updated_by                   TEXT NOT NULL,
      CONSTRAINT brokerage_records_status_chk
        CHECK (status IN ('processed', 'deleted', 'ignored', 'unprocessed',
                          'pending-split-resolution')),
      CONSTRAINT brokerage_records_created_by_format_chk
        CHECK (created_by ~ ${ACTOR_CHK_FRAGMENT}),
      CONSTRAINT brokerage_records_updated_by_format_chk
        CHECK (updated_by ~ ${ACTOR_CHK_FRAGMENT})
    );
  `);
  // CD-7: PARTIAL index replaces the DDB status-index GSI (only this status
  // is ever queried by status).
  pgm.createIndex('brokerage_records', ['status'], {
    name: 'brokerage_records_pending_split_idx',
    where: "status = 'pending-split-resolution'",
  });
  pgm.createIndex('brokerage_records', ['filename'], {
    name: 'brokerage_records_filename_idx',
  });
  pgm.createIndex('brokerage_records', ['hash'], {
    name: 'brokerage_records_hash_idx',
  });
  pgm.createIndex('brokerage_records', ['account_id'], {
    name: 'brokerage_records_account_id_idx',
  });
  pgm.createIndex('brokerage_records', ['owner'], {
    name: 'brokerage_records_owner_idx',
  });
  pgm.createIndex('brokerage_records', ['file_import_id'], {
    name: 'brokerage_records_file_import_id_idx',
  });
  pgm.createIndex('brokerage_records', ['security_key'], {
    name: 'brokerage_records_security_key_idx',
  });
  pgm.sql(`
    CREATE TRIGGER brokerage_records_set_updated_at BEFORE UPDATE ON brokerage_records
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ---- brokerage_imports --------------------------------------------------
  // _BrokerageImport (per-file import summary). importDateEpoch → TIMESTAMPTZ.
  pgm.sql(`
    CREATE TABLE brokerage_imports (
      import_id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner                       UUID NOT NULL,
      account_id                  UUID NOT NULL REFERENCES brokerage_accounts(account_id),
      file_import_id              UUID REFERENCES brokerage_file_imports(file_import_id),
      filename                    TEXT,
      brokerage_account_filename  TEXT NOT NULL,
      import_date                 TIMESTAMPTZ,
      records_count               INTEGER,
      records_hash                TEXT,
      created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by                  TEXT NOT NULL,
      updated_by                  TEXT NOT NULL,
      CONSTRAINT brokerage_imports_created_by_format_chk
        CHECK (created_by ~ ${ACTOR_CHK_FRAGMENT}),
      CONSTRAINT brokerage_imports_updated_by_format_chk
        CHECK (updated_by ~ ${ACTOR_CHK_FRAGMENT})
    );
  `);
  // CD-7 / DEV-1: brokerageAccountFilename string key dropped → UNIQUE identity.
  pgm.createIndex('brokerage_imports', ['owner', 'brokerage_account_filename'], {
    name: 'brokerage_imports_identity_uidx',
    unique: true,
  });
  // CD-7: dedup queryImportHash.
  pgm.createIndex('brokerage_imports', ['records_hash'], {
    name: 'brokerage_imports_records_hash_idx',
  });
  pgm.createIndex('brokerage_imports', ['filename'], {
    name: 'brokerage_imports_filename_idx',
  });
  pgm.createIndex('brokerage_imports', ['account_id'], {
    name: 'brokerage_imports_account_id_idx',
  });
  pgm.sql(`
    CREATE TRIGGER brokerage_imports_set_updated_at BEFORE UPDATE ON brokerage_imports
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ---- cash_entry ---------------------------------------------------------
  // CashEntry. transactionEpoch → transaction_date TIMESTAMPTZ (CD-4).
  // NO transaction_id column yet — added in C4 (CD-8 / D10). Table created here
  // but not written until C4 + the post-C5 re-import.
  pgm.sql(`
    CREATE TABLE cash_entry (
      cash_entry_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner            UUID NOT NULL,
      account_id       UUID NOT NULL REFERENCES brokerage_accounts(account_id),
      file_import_id   UUID REFERENCES brokerage_file_imports(file_import_id),
      symbol           TEXT,
      amount           NUMERIC,
      fees             NUMERIC,
      commission       NUMERIC,
      transaction_date TIMESTAMPTZ,
      description      TEXT,
      origin_name      TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by       TEXT NOT NULL,
      updated_by       TEXT NOT NULL,
      CONSTRAINT cash_entry_created_by_format_chk
        CHECK (created_by ~ ${ACTOR_CHK_FRAGMENT}),
      CONSTRAINT cash_entry_updated_by_format_chk
        CHECK (updated_by ~ ${ACTOR_CHK_FRAGMENT})
    );
  `);
  pgm.createIndex('cash_entry', ['account_id'], {
    name: 'cash_entry_account_id_idx',
  });
  pgm.createIndex('cash_entry', ['symbol'], {
    name: 'cash_entry_symbol_idx',
  });
  // origin_name used for deletion (CD-7).
  pgm.createIndex('cash_entry', ['origin_name'], {
    name: 'cash_entry_origin_name_idx',
  });
  pgm.createIndex('cash_entry', ['owner'], {
    name: 'cash_entry_owner_idx',
  });
  pgm.sql(`
    CREATE TRIGGER cash_entry_set_updated_at BEFORE UPDATE ON cash_entry
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS cash_entry_set_updated_at ON cash_entry;`);
  pgm.dropTable('cash_entry');
  pgm.sql(`DROP TRIGGER IF EXISTS brokerage_imports_set_updated_at ON brokerage_imports;`);
  pgm.dropTable('brokerage_imports');
  pgm.sql(`DROP TRIGGER IF EXISTS brokerage_records_set_updated_at ON brokerage_records;`);
  pgm.dropTable('brokerage_records');
  pgm.sql(`DROP TRIGGER IF EXISTS brokerage_file_imports_set_updated_at ON brokerage_file_imports;`);
  pgm.dropTable('brokerage_file_imports');
  pgm.sql(`DROP TRIGGER IF EXISTS brokerage_accounts_set_updated_at ON brokerage_accounts;`);
  pgm.dropTable('brokerage_accounts');
};
