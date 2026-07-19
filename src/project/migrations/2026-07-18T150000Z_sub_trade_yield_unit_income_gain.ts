/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Sub-trade yield scoping — E10b (sub-trade-yield-scoping.prd.md D9).
 *
 * Add `sub_trade_yield_units.income_gain`: the PASSIVE component of `gain` —
 * dividends, return of capital, loaned-shares interest earned by that
 * sub-trade's position.
 *
 * WHY: E4 attaches income to the sub-trade holding the position that earned it,
 * instead of letting it seed its own zero-position sub-trade. That is correct,
 * but it makes the income INVISIBLE — the cash folds into the sub-trade's `gain`
 * and nothing distinguishes it from trading P&L. D9: "Show income as a sub-line
 * on the position card. Folding silently would hide the dividend outside the
 * Income tab." The card cannot show what the row does not carry, and the
 * transactions that would reveal it are only fetched when the card is expanded.
 *
 * NULLABLE and additive: rows written before this column existed carry NULL,
 * which readers treat identically to 0 (no income). Nothing is backfilled —
 * values appear as the yield engine recomputes.
 *
 * ⚠️ Read sites must guard the NULL. `Number(null) === 0` happens to be the
 * CORRECT coercion here (absent income == no income), unlike the `yield` column
 * where 0 is a false claim of "broke even" — but the mapper still uses an
 * explicit guard so the two columns' intent stays legible side by side.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE sub_trade_yield_units ADD COLUMN IF NOT EXISTS income_gain NUMERIC;`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE sub_trade_yield_units DROP COLUMN IF EXISTS income_gain;`);
};
