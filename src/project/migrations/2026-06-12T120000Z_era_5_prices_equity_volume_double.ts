/*
Created by Franz Zemen
License Type: UNLICENSED

Era 5 — change prices_equity.volume from BIGINT to DOUBLE PRECISION.

BIGINT was an unstated "market volume is whole shares" assumption that is wrong on
two counts: (1) the data provider (Massive) documents the volume field `v` as a
`number` (decimal-capable) — only the separate transaction count `n` is an integer;
and (2) we split-adjust cached bars (`volume * factor`), and a reverse/fractional
split (e.g. PINX:LBUY 1-for-156, factor≈0.00641) yields a fractional adjusted
volume. Writing that fraction into a BIGINT column threw
`invalid input syntax for type bigint: "12.025641025641026"`, which aborted the
whole import transaction (the error was swallowed log-and-continue, cascading every
later statement as "current transaction is aborted").

DOUBLE PRECISION matches the sibling price columns (high/low/open/close are already
DOUBLE PRECISION), returns as a native JS number (no pg-types parser pin needed),
matches Massive's `number` type, and stores fractional split-adjusted volume without
loss. (Note: financial-data's BIGINT oid-20 parser pin no longer applies to volume;
it is harmless to leave.)
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  // bigint → double precision is an implicit, lossless widening for existing values.
  pgm.sql(`ALTER TABLE prices_equity ALTER COLUMN volume TYPE DOUBLE PRECISION;`);
};

export const down = (pgm: MigrationBuilder): void => {
  // Round back to whole shares to fit BIGINT (lossy for any split-adjusted fractions).
  pgm.sql(`ALTER TABLE prices_equity ALTER COLUMN volume TYPE BIGINT USING round(volume)::bigint;`);
};
