/*
Created by Franz Zemen
License Type: UNLICENSED

Optionability + option activity on `security_reference`
(projects/doc/prd/daily-indicators-scanner.prd.md, E6/D17).

WHY. The overbought/oversold scanner exists to generate OPTIONS trades — long puts on
overbought names, long calls on oversold ones. A perfectly oversold stock with no listed
options is noise in that list, so optionability is a first-class screening dimension, not a
nice-to-have. Option volume additionally separates "technically optionable" from "actually
tradeable": a name with three contracts and 11 total volume has quotes so wide the signal is
unusable.

WHERE THE DATA COMES FROM. Free. The `options-prices` handler already streams the whole OPRA
day-agg flat file every night and then throws away every contract we do not hold. E6 taps
that same stream BEFORE the held-contract filter and aggregates per underlying, so we learn
the optionable universe at zero extra vendor cost and zero extra credits.

WRITE DISCIPLINE — these four columns have exactly ONE writer (the options-prices handler
via `updateOptionActivity`), and are deliberately NOT part of `#toRow` /
`upsertSecurityReference`. Same rule the free-float columns follow: a nightly
security-reference refresh must not null them out. Read the free-float comment in
`security-reference.trusted.api.ts` before touching this.

NULLABLE ON PURPOSE. NULL means "we have not observed an OPRA session for this security
yet", which is different from `optionable = false` ("we streamed a session and it had no
contracts"). A screen wanting genuinely optionable names must test `optionable IS TRUE`, not
`!= false`.

`options_as_of` is the closing date of the OPRA session the counts came from — staleness is
visible without joining anything.

MIN_SCHEMA_VERSION = 2026-07-27T010000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE security_reference
      ADD COLUMN IF NOT EXISTS optionable        boolean,
      ADD COLUMN IF NOT EXISTS option_contracts  integer,
      ADD COLUMN IF NOT EXISTS option_volume     bigint,
      ADD COLUMN IF NOT EXISTS options_as_of     date;
  `);
  // The scanner's hot path is "optionable, liquid names on date D", so the partial index
  // covers only the rows a screen can return. Keeps it small — a minority of the ~12,700
  // tracked securities carry listed options.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS security_reference_optionable_idx
      ON security_reference (optionable, option_volume DESC)
      WHERE optionable IS TRUE AND active IS TRUE;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP INDEX IF EXISTS security_reference_optionable_idx;`);
  pgm.sql(`
    ALTER TABLE security_reference
      DROP COLUMN IF EXISTS optionable,
      DROP COLUMN IF EXISTS option_contracts,
      DROP COLUMN IF EXISTS option_volume,
      DROP COLUMN IF EXISTS options_as_of;
  `);
};
