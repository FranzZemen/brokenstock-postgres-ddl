/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * E*Trade brokerage (2026-07-12) — E*Trade CSV Parsers PRD.
 *
 * financial-identity 65.19.0 adds 'ETrade' to the Brokerage union and two parser
 * names ('ETrade CSV Parser', 'ETrade Morgan Stanley CSV Parser') to ParserName.
 * The brokerage set is CHECK-enforced in Postgres on every table that stores it,
 * so without this migration an E*Trade import parses fine and then dies on INSERT.
 *
 * Six brokerage columns, all carrying the same four-value CHECK:
 *
 *   brokerage_accounts.brokerage, transactions.brokerage, trades.brokerage,
 *   sub_trades.brokerage, transfer_pending.broker, transfer_events.broker
 *
 * plus two constraints that encode the brokerage set indirectly:
 *
 *   brokerage_records.record_id — a format regex whose suffix is the
 *     brokerage-branded BrokerageRecordUUID (`<uuid>.<Brokerage>-brokerage-record`,
 *     see 2026-06-04T150000Z). An E*Trade record_id fails the old alternation.
 *   brokerage_file_imports.parser_name — the parser-name CHECK, which gains the
 *     two E*Trade parsers.
 *
 * Purely a widening: every value accepted before is still accepted, so no existing
 * row can violate the new constraints and no backfill or rewrite is needed. The
 * ALTERs take an ACCESS EXCLUSIVE lock only briefly — validating each CHECK scans
 * the table, but these constraints are being replaced with strict supersets, so
 * correctness does not depend on the scan finding anything.
 *
 * `down` narrows the set back to the original four brokerages / six parsers. It will
 * FAIL if any E*Trade row exists by then — deliberately. Silently dropping E*Trade
 * data to satisfy a rollback would be worse than refusing to roll back.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const BROKERAGES_BEFORE = `'Unknown', 'Fidelity', 'IBKR', 'Schwab'`;
const BROKERAGES_AFTER = `'Unknown', 'Fidelity', 'IBKR', 'Schwab', 'ETrade'`;

const RECORD_ID_CHK_BEFORE = `~ '^${UUID_RE}\\.(Unknown|Fidelity|IBKR|Schwab)-brokerage-record$'`;
const RECORD_ID_CHK_AFTER = `~ '^${UUID_RE}\\.(Unknown|Fidelity|IBKR|Schwab|ETrade)-brokerage-record$'`;

const PARSERS_BEFORE = `'Standard JSON History Parser',
                        'Fidelity CSV Parser',
                        'Fidelity Multiple Account CSV Parser',
                        'Fidelity Retirement Parser',
                        'IBKR XML Flex Query Parser',
                        'Schwab Think Or Swim CSV Parser'`;
const PARSERS_AFTER = `${PARSERS_BEFORE},
                        'ETrade CSV Parser',
                        'ETrade Morgan Stanley CSV Parser'`;

/** table → (constraint name, column) for the six brokerage-valued columns. */
const BROKERAGE_CONSTRAINTS: Array<{table: string, constraint: string, column: string}> = [
  {table: 'brokerage_accounts', constraint: 'brokerage_accounts_brokerage_chk', column: 'brokerage'},
  {table: 'transactions', constraint: 'transactions_brokerage_chk', column: 'brokerage'},
  {table: 'trades', constraint: 'trades_brokerage_chk', column: 'brokerage'},
  {table: 'sub_trades', constraint: 'sub_trades_brokerage_chk', column: 'brokerage'},
  {table: 'transfer_pending', constraint: 'transfer_pending_broker_chk', column: 'broker'},
  {table: 'transfer_events', constraint: 'transfer_events_broker_chk', column: 'broker'}
];

function setBrokerageChecks(pgm: MigrationBuilder, brokerages: string): void {
  for (const {table, constraint, column} of BROKERAGE_CONSTRAINTS) {
    pgm.sql(`
      ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${constraint};
      ALTER TABLE ${table}
        ADD CONSTRAINT ${constraint} CHECK (${column} IN (${brokerages}));
    `);
  }
}

function setRecordIdCheck(pgm: MigrationBuilder, check: string): void {
  pgm.sql(`
    ALTER TABLE brokerage_records DROP CONSTRAINT IF EXISTS brokerage_records_record_id_format_chk;
    ALTER TABLE brokerage_records
      ADD CONSTRAINT brokerage_records_record_id_format_chk CHECK (record_id ${check});
  `);
}

function setParserNameCheck(pgm: MigrationBuilder, parsers: string): void {
  pgm.sql(`
    ALTER TABLE brokerage_file_imports DROP CONSTRAINT IF EXISTS brokerage_file_imports_parser_name_chk;
    ALTER TABLE brokerage_file_imports
      ADD CONSTRAINT brokerage_file_imports_parser_name_chk CHECK (parser_name IN (${parsers}));
  `);
}

export const up = (pgm: MigrationBuilder): void => {
  setBrokerageChecks(pgm, BROKERAGES_AFTER);
  setRecordIdCheck(pgm, RECORD_ID_CHK_AFTER);
  setParserNameCheck(pgm, PARSERS_AFTER);
};

export const down = (pgm: MigrationBuilder): void => {
  setBrokerageChecks(pgm, BROKERAGES_BEFORE);
  setRecordIdCheck(pgm, RECORD_ID_CHK_BEFORE);
  setParserNameCheck(pgm, PARSERS_BEFORE);
};
