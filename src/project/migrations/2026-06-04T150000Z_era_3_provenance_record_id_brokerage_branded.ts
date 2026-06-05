/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Era 3 C3 (2026-06-04) — PROVENANCE record_id suffix correction.
 *
 * 0.8.2 gave every provenance PK a suffix-format CHECK, but used a plain
 * `<uuid>.record` for brokerage_records.record_id. That's wrong: the record
 * identity is the EXISTING, brokerage-branded BrokerageRecordUUID
 * (financial-identity) — `<uuid-v4>.<Brokerage>-brokerage-record` (e.g.
 * `…​.Fidelity-brokerage-record`), with a published BROKERAGE_RECORD_UUID_REGEX.
 * Its format is load-bearing: `transactions.origin_record_id` (C4) validates
 * against BROKERAGE_RECORD_UUID_REGEX. So record_id must carry the brokerage-
 * branded suffix, not `.record`.
 *
 * (account_id `.account`, file_import_id `.file-import`, import_id `.import`,
 * cash_entry_id `.cash-entry` are correct and unchanged — import/cash have no
 * pre-existing UUID type and are plain by decision; FK relationships bring them
 * back to a brokerage. Only record_id is brokerage-branded.)
 *
 * brokerage_records is empty in C3. Pins MIN_SCHEMA_VERSION = 2026-06-04T150000Z.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// Mirrors BROKERAGE_RECORD_UUID_REGEX (financial-identity) — brokerage set
// matches the brokerage_accounts brokerage CHECK.
const RECORD_ID_CHK = `~ '^${UUID_RE}\\.(Unknown|Fidelity|IBKR|Schwab)-brokerage-record$'`;
const PLAIN_RECORD_CHK = `~ '^${UUID_RE}\\.record$'`;

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE brokerage_records DROP CONSTRAINT IF EXISTS brokerage_records_record_id_format_chk;
    ALTER TABLE brokerage_records
      ADD CONSTRAINT brokerage_records_record_id_format_chk CHECK (record_id ${RECORD_ID_CHK});
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE brokerage_records DROP CONSTRAINT IF EXISTS brokerage_records_record_id_format_chk;
    ALTER TABLE brokerage_records
      ADD CONSTRAINT brokerage_records_record_id_format_chk CHECK (record_id ${PLAIN_RECORD_CHK});
  `);
};
