/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Sub-trade yield scoping — E25 (sub-trade-yield-scoping.prd.md, D19).
 *
 * Make `sub_trade_yield_units.yield` NULLABLE so a CAPITAL-LESS unit can record
 * "not applicable" instead of a fabricated `0`.
 *
 * A capital-less unit is one with `denominator = 0`: real cash with no derivable
 * capital base. The live case is an `Open Imbalance` slice — a close whose
 * opening lies outside the imported history (KTOS 260717P00060000, -$3,702.62).
 * Yield is gain ÷ denominator; with a zero denominator the ratio is undefined,
 * and storing `0` asserts "broke even", which is a different and false claim.
 *
 * D19 (Franz, 2026-07-18): both review sessions had recommended deriving this in
 * the front end instead, on the verified evidence that no BACKEND consumer
 * computes on `yield` — the only writers are the folds, the only reader is a FE
 * that already local-derives from `denominator`. That evidence was correct but
 * described the consumers that exist TODAY. Analytics is on the roadmap, and an
 * analytic reading `yield` without also reading `denominator` sees `0` as a
 * genuine break-even. A convention you must know to read the number correctly is
 * exactly the decay mode this PRD exists to cure, so the column carries the
 * distinction itself.
 *
 * ⚠️ THE COLUMN CHANGE ALONE IS A NO-OP. `trade-yield-persistence`'s row mapper
 * reads `yield: Number(row.yield)`, and `Number(null) === 0` — a NULL silently
 * round-trips back to `0` while appearing to work. E26 fixes that mapper, the
 * `SubTradeYieldUnit.yield` type, and the fold branches. Ship them together.
 *
 * No data is rewritten here: existing rows keep their stored `0`. They are
 * corrected when the yield engine recomputes them (P1a recompute / P2
 * restatement), which is also what makes the new NULLs appear.
 *
 * `down` restores NOT NULL, backfilling any NULL to 0 first so the constraint
 * can be re-applied — accepting that this reintroduces the fabricated value,
 * which is the whole point of the forward migration.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE sub_trade_yield_units ALTER COLUMN "yield" DROP NOT NULL;`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`UPDATE sub_trade_yield_units SET "yield" = 0 WHERE "yield" IS NULL;`);
  pgm.sql(`ALTER TABLE sub_trade_yield_units ALTER COLUMN "yield" SET NOT NULL;`);
};
