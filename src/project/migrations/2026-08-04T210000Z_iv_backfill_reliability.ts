/*
Created by Franz Zemen 2026-08-04
License Type: UNLICENSED

`security_implied_volatility` — reliability signal for BACKFILLED readings
(broken-stock/doc/prd/reference-options-chart.prd.md E14b).

WHY THE EXISTING COLUMNS DO NOT COVER THIS. The nightly capture measures how
tightly a QUOTE pins a reading, by solving the volatility at the bid and at the
ask. The backfill has no quote to measure: the OPRA daily flat file carries
open/high/low/close and volume, and no bid or ask at all. So `atm_iv_at_bid` and
`atm_iv_at_ask` are permanently NULL on backfilled rows, and a reader with only
those columns would have no way to tell a solid historical reading from a
worthless one.

WHAT REPLACES IT. The TRADE COUNT behind the close. Measured in this PRD: the
same SPY contract traded **2 times** in one session and **7,089** nine days
later. A close from two trades is a print, not a price, and drawing it with the
same confidence as the other is the failure this whole document exists to avoid.

AND HOW FAR FROM THE MONEY. A flat file contains only contracts that TRADED, so
on a quiet session the nearest traded strike can sit well away from spot. A
reading taken there is not the at-the-money volatility it claims to be, however
heavily that strike traded — so the distance is recorded rather than assumed
small.

NO THRESHOLD IS STORED, for the same reason as the quote band: where "usable"
ends is a display judgement that will differ between a chart label and a scanner
filter, and freezing today's opinion into history would be wrong.

MIN_SCHEMA_VERSION = 2026-08-04T210000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE security_implied_volatility
      ADD COLUMN atm_transactions INTEGER,
      ADD COLUMN atm_moneyness_distance DOUBLE PRECISION;
  `);
  pgm.sql(`
    COMMENT ON COLUMN security_implied_volatility.atm_transactions IS
      'Trades behind the close that was inverted. The reliability signal for BACKFILLED readings, standing in '
      'for the bid-ask spread the daily flat file does not carry. Measured: one SPY contract traded 2 times in a '
      'session and 7,089 nine days later. NULL on nightly rows, which use atm_iv_at_bid/_ask instead, and NULL '
      'from the backfill means the vendor did not report it - which is NOT evidence that it traded a lot.';
  `);
  pgm.sql(`
    COMMENT ON COLUMN security_implied_volatility.atm_moneyness_distance IS
      'How far the chosen strike sat from spot, as a fraction of spot. A flat file contains only contracts that '
      'TRADED, so on a quiet session the nearest traded strike can be well away from the money - and a reading '
      'taken there is not the at-the-money volatility it claims to be.';
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE security_implied_volatility
      DROP COLUMN IF EXISTS atm_transactions,
      DROP COLUMN IF EXISTS atm_moneyness_distance;
  `);
};
