/*
Created by Franz Zemen 2026-07-18
License Type: UNLICENSED

brokerage_file_imports — surface parser anomalies on the import.

WHY: a parser that recognises a source row but cannot convert it previously dropped it
behind a `log.warn`. The row vanished and the import still reported success, so an entire
class of broker data could go missing with nothing in the result to say so. That is exactly
how 15 IBKR `Transfers` (net +$13,644.74) and two reverse-split `CorporateActions` were
discarded for months — present in every statement, mentioned nowhere.

`ParserResult.anomalies` (brokerage-parsers 20.9.0+) turned those drops into structured
DATA, but nothing persisted or displayed it: population was live, visibility was not. These
two columns close that loop.

TWO columns, deliberately:
  metric_parser_anomaly_count — an integer sibling of the existing metric_* disposition
      counters, so the UI can render a tile the same way it renders Dropped/Ignored.
  parser_anomalies            — the DETAIL. A bare count ("3 anomalies") does not tell an
      operator WHAT was discarded, and "what" is the entire point. JSONB holds the
      {kind, value, sourceId, message} array verbatim so a drop is traceable back to the
      row in the source file without re-parsing it.

Both NULLABLE: parseStage writes partial metrics, legacy rows omit the field entirely, and
a parser that produces no anomalies writes nothing rather than an empty array.

No backfill. Historical imports predate anomaly capture; NULL correctly means "we did not
record this" rather than "there were none" — the distinction matters here, because claiming
zero anomalies for an import that in fact dropped rows would recreate the false-confidence
problem this whole change exists to remove.

Bumps MIN_SCHEMA_VERSION = 2026-07-18T150000Z.
PRD: brokerage-parsers/doc/prd/ibkr-flex-coverage.prd.md (E3c)
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE brokerage_file_imports
      ADD COLUMN IF NOT EXISTS metric_parser_anomaly_count INTEGER,
      ADD COLUMN IF NOT EXISTS parser_anomalies            JSONB;
  `);
  pgm.sql(`
    COMMENT ON COLUMN brokerage_file_imports.metric_parser_anomaly_count IS
      'Count of ParserResult.anomalies for this import. NULL = not recorded (pre-2026-07-18 imports), which is NOT the same as zero.';
  `);
  pgm.sql(`
    COMMENT ON COLUMN brokerage_file_imports.parser_anomalies IS
      'ParserAnomaly[] verbatim: {kind, value, sourceId, message}. Rows the parser recognised but did not convert. NOTE some kinds (unrecognized-deposit-withdrawal-description) DID import and are flagged for verification rather than dropped.';
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE brokerage_file_imports
      DROP COLUMN IF EXISTS metric_parser_anomaly_count,
      DROP COLUMN IF EXISTS parser_anomalies;
  `);
};
