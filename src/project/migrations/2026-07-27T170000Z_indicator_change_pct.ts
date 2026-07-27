/*
Created by Franz Zemen
License Type: UNLICENSED

Session-over-session change on `security_daily_indicators`
(oo-scanner-filters-and-rsi-chart PRD E1 — D1/D2/D3).

WHY STORED AND NOT DERIVED. The Overbought/Oversold scanner needs the same change-% filter
the Daytrading Scanner has, but it cannot borrow that scanner's number: there, change-% is
`entitled-price` (live price vs. last close), which has no meaning for a session in the past
— and this scanner is date-addressable by design. So change-% here is the move from the
security's previous close to this session's close.

The tempting shortcut is a query-time `lag()` over the plane. It is wrong. "The previous
session" is only well defined GLOBALLY, and the securities most likely to be sitting at an
RSI extreme are exactly the ones that break that assumption: halted names, newly listed
names, anything absent from the prior session. Storing the value lets the nightly compute —
which already walks the security's own bar sequence and holds the prior bar (ATR's true
range uses it) — write the correct denominator by construction. It is also directly
filterable and orderable without a join.

NULLABLE, and null means "cannot be stated": a security's first bar has no prior close, and
a non-positive prior close would make the percentage Infinity or nonsense. A zero would be a
lie in both cases.

Backfill is a separate one-time statement (E1 step 3), not run here: it touches ~5.03M rows
and belongs in a chunked, observable run rather than inside a migration transaction.

MIN_SCHEMA_VERSION unchanged — writers tolerate the columns' absence in the same way the
Wilder-state columns did, so this does not gate a deploy.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE security_daily_indicators
      ADD COLUMN IF NOT EXISTS prev_close double precision,
      ADD COLUMN IF NOT EXISTS change_pct double precision;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE security_daily_indicators
      DROP COLUMN IF EXISTS prev_close,
      DROP COLUMN IF EXISTS change_pct;
  `);
};
