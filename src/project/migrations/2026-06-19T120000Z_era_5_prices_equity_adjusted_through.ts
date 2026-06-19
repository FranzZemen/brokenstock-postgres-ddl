/*
Created by Franz Zemen
License Type: UNLICENSED

Era 5 — add prices_equity.adjusted_through_date (the split-adjustment watermark).

PRD: financial-data/doc/prd/equity-price-split-adjustment-watermark.prd.md (E1).

Each bar now records the date THROUGH WHICH split adjustments are already baked in
— the per-bar analog of a transaction's `lastSplitDate`. A bar is correct in today's
basis once every split with `effective_date > adjusted_through_date` has been applied:

  - a RAW vendor flat-file bar for date T already reflects all splits effective <= T
    (the market baked them into the as-traded price), so its watermark = closing_date;
  - a REST `adjusted=true` bar pulled on date P already reflects all splits effective
    <= P (the vendor back-adjusted the series), so its watermark = the pull date.

The watermark is what makes the rebase idempotent and stops the runaway double-/over-
adjustment that drove `prices_equity` to ~1e29 (XFOR) and ~1e-26 (NVDA): the old
`splitAdjustBars` re-divided bars by the split factor unconditionally, compounding
~factor^N across delete+reimports.

Nullable. Legacy rows are left NULL — they are repopulated through the fixed write
path during the one-time cleanup (PRD E8), which stamps the watermark. New writes
always stamp it (PRD E2). The rebase only acts on rows that carry a watermark.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE prices_equity ADD COLUMN IF NOT EXISTS adjusted_through_date DATE;`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE prices_equity DROP COLUMN IF EXISTS adjusted_through_date;`);
};
