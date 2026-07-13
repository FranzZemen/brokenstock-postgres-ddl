/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Schwab Think Or Swim JSON parser (2026-07-13) — Schwab Parsers PRD, E2.
 *
 * Schwab lets you download transaction history as either CSV or JSON. financial-identity
 * adds 'Schwab Think Or Swim JSON Parser' to the ParserName union; that union is
 * CHECK-enforced in Postgres on brokerage_file_imports.parser_name, so without this
 * migration a Schwab JSON file parses fine and then dies on INSERT.
 *
 * Unlike the E*Trade change (2026-07-12T180000Z), this touches ONE constraint, not eight:
 * 'Schwab' already exists in the Brokerage union, so none of the six brokerage-valued
 * columns move, and brokerage_records.record_id — whose format regex embeds the
 * brokerage-branded UUID suffix — is likewise unaffected. Only the parser set widens.
 *
 * Purely a widening: every value accepted before is still accepted, so no existing row
 * can violate the new constraint and no backfill is needed.
 *
 * `down` narrows the set back. It will FAIL if any file import was parsed by the JSON
 * parser by then — deliberately. Silently dropping the parser_name of a real import to
 * satisfy a rollback would be worse than refusing to roll back.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const PARSERS_BEFORE = `'Standard JSON History Parser',
                        'Fidelity CSV Parser',
                        'Fidelity Multiple Account CSV Parser',
                        'Fidelity Retirement Parser',
                        'IBKR XML Flex Query Parser',
                        'Schwab Think Or Swim CSV Parser',
                        'ETrade CSV Parser',
                        'ETrade Morgan Stanley CSV Parser'`;
const PARSERS_AFTER = `${PARSERS_BEFORE},
                        'Schwab Think Or Swim JSON Parser'`;

function setParserNameCheck(pgm: MigrationBuilder, parsers: string): void {
  pgm.sql(`
    ALTER TABLE brokerage_file_imports DROP CONSTRAINT IF EXISTS brokerage_file_imports_parser_name_chk;
    ALTER TABLE brokerage_file_imports
      ADD CONSTRAINT brokerage_file_imports_parser_name_chk CHECK (parser_name IN (${parsers}));
  `);
}

export const up = (pgm: MigrationBuilder): void => {
  setParserNameCheck(pgm, PARSERS_AFTER);
};

export const down = (pgm: MigrationBuilder): void => {
  setParserNameCheck(pgm, PARSERS_BEFORE);
};
