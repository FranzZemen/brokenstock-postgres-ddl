/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Drop the antiquated trade "sealed" / "Archive" attribute end-to-end.
 * See trades/doc/prd/drop-sealed-archive-attribute.prd.md (Epic E9/E10).
 *
 * `trades.sealed` was an unused "freeze this trade from recompute" / FE-Archive
 * flag — every row is false in every environment (PRD Epic E0 verifies/normalizes
 * to false before this runs). `thesis.exclude_sealed` was its only dependent
 * consumer (filter sealed trades out of thesis matching) and is meaningless once
 * nothing is ever sealed, so it goes too.
 *
 * Ordering: this migration is applied AFTER all de-sealed application code is
 * deployed (no code references either column), so the DROP cannot break a live
 * read/write.
 *
 * down() restores column STRUCTURE only — historical values are not recoverable
 * (they were all the default anyway: trades.sealed=false, thesis.exclude_sealed=null).
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.dropColumn('trades', 'sealed', {ifExists: true});
  pgm.dropColumn('thesis', 'exclude_sealed', {ifExists: true});
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.addColumn('trades', {
    sealed: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
  });
  pgm.addColumn('thesis', {
    exclude_sealed: {
      type: 'boolean',
      notNull: false,
    },
  });
};
