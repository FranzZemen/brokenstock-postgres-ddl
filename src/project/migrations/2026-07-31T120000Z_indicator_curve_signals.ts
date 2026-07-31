/*
Created by Franz Zemen
License Type: UNLICENSED

Curve-signal columns on `security_daily_indicators`
(indicator-curve-signals.prd.md, E2 — D6/D7/D8/D11/D12/D13/D24).

WHAT THIS ADDS. The table already stores the indicator LINES. It stores nothing about their
GEOMETRY: whether a line is rising, whether it is curling up, or where two lines crossed.
These columns hold that, computed in the same nightly forward pass that writes the lines
(E3), so the scanner can ask "RSI curling up, and the fast/slow pair crossed up within the
last few sessions, above a rising 200-day average" as one indexed query rather than pulling
history per security and deciding in application code.

`sma_18` IS THE ODD ONE OUT (D11). It is a LINE, not a signal, and it is here because the
trader's pair is EMA 9 / SMA 18 while the table happens to store SMA 20. Twenty is not
eighteen and the crossover would land on the wrong bars.

WHY NO STRENGTH SCORE COLUMN (D8/D1). An earlier draft had a rolled-up 0-to-1 crossover
score. It is deliberately absent. Nothing here has been through a forward-return study, and
a scanner that RANKS names by a composite score is a recommendation no matter what the
tooltip says — the platform already cancelled a signal on exactly that evidence. The pieces
(direction, slope gap, both-agree) are stored separately and are filterable and sortable on
their own, which is the whole product.

WHY THE NORMALIZED VALUE AND THE STATE ARE BOTH STORED. The `*_slope` value carries the
magnitude and, in its sign, the raw direction. The `*_slope_state` is that direction after
debouncing (a two-threshold trigger that will not flip on a line hovering at the boundary),
which is what a filter should read — the raw sign flips constantly on a noisy line. They are
not redundant: one is "how steep", the other is "has it committed".

WHY `bars_since_cross` CAN BE NULL WHILE A CROSS EXISTS (D13). It is censored at the nightly
compute window. This is the only unbounded-lookback quantity in the table, and the nightly
job sees roughly 260 bars while a history backfill sees everything — an uncapped count would
make the two paths write different numbers into the same row depending on which ran. Null
past the cap makes them agree, and "crossed within the last few sessions" (the only filter
anybody wants) is unaffected. Null ALSO means "never crossed in the window", and both read
the same way under `bars_since_cross <= N`, which excludes nulls.

EVERY COLUMN IS NULLABLE, and null consistently means "cannot be stated": through warmup,
on a line too flat to have a scale worth dividing by, and on `suspect` rows, where a
mis-based bar would otherwise manufacture a maximal curvature spike and a phantom crossover
and sort itself to the top of a ranked scanner (D22).

NO CHECK CONSTRAINTS on the small-int direction/state columns. A CHECK on an added column
forces a validating scan of ~5M rows to prove a table of all-nulls satisfies it; the writer
is the single source of these values and is pinned by its own tests.

Backfill is NOT run here (E3 step 5): it re-reads every bar for every security and belongs
in a chunked, observable job, not inside a migration transaction.

MIN_SCHEMA_VERSION unchanged — writers tolerate the columns' absence, exactly as the
change-% and Wilder-state column adds did, so this does not gate a deploy.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

/*
Small ints rather than text for direction and state, because these are the columns the
scanner filters on across a whole date's rows: -1 falling / below / down, 0 flat, 1 rising /
above / up. The crossover LIFECYCLE is text instead — it has three named values that are not
an ordering, and 'held' has to be readable in a hand-written query.
*/
const COLUMNS = `
      -- The trader's pair needs an 18, and the table has a 20 (D11).
      ADD COLUMN IF NOT EXISTS sma_18                          double precision,

      -- Single-line geometry (D6). Normalized slope/curvature plus the debounced state.
      ADD COLUMN IF NOT EXISTS rsi_14_slope                    double precision,
      ADD COLUMN IF NOT EXISTS rsi_14_slope_state              smallint,
      ADD COLUMN IF NOT EXISTS rsi_14_curvature                double precision,
      ADD COLUMN IF NOT EXISTS rsi_14_curvature_state          smallint,
      ADD COLUMN IF NOT EXISTS macd_line_slope                 double precision,
      ADD COLUMN IF NOT EXISTS macd_line_slope_state           smallint,
      ADD COLUMN IF NOT EXISTS macd_line_curvature             double precision,
      ADD COLUMN IF NOT EXISTS macd_line_curvature_state       smallint,
      -- Close gets slope only: raw price is the noisiest series on the row, and a short
      -- parabola fitted to it changes its mind about "curling up" almost every bar (D6).
      ADD COLUMN IF NOT EXISTS close_slope                     double precision,
      ADD COLUMN IF NOT EXISTS close_slope_state               smallint,

      -- Crossover: EMA 9 x SMA 18 (D7/D8).
      ADD COLUMN IF NOT EXISTS ema_9_sma_18_cross_dir          smallint,
      ADD COLUMN IF NOT EXISTS ema_9_sma_18_bars_since_cross   integer,
      ADD COLUMN IF NOT EXISTS ema_9_sma_18_cross_slope_gap    double precision,
      ADD COLUMN IF NOT EXISTS ema_9_sma_18_cross_both_agree   boolean,
      ADD COLUMN IF NOT EXISTS ema_9_sma_18_cross_state        text,

      -- Crossover: MACD line x MACD signal (D7/D8).
      ADD COLUMN IF NOT EXISTS macd_cross_dir                  smallint,
      ADD COLUMN IF NOT EXISTS macd_cross_bars_since           integer,
      ADD COLUMN IF NOT EXISTS macd_cross_slope_gap            double precision,
      ADD COLUMN IF NOT EXISTS macd_cross_both_agree           boolean,
      ADD COLUMN IF NOT EXISTS macd_cross_state                text,

      -- Trend context (D24). A fast/slow up-cross means opposite things below a falling
      -- 200-day average and above a rising 50-day one, so the cross is close to unusable as
      -- a filter without the surrounding trend on the same row.
      ADD COLUMN IF NOT EXISTS close_vs_sma_50                 smallint,
      ADD COLUMN IF NOT EXISTS close_vs_sma_200                smallint,
      ADD COLUMN IF NOT EXISTS sma_50_slope_state              smallint,
      ADD COLUMN IF NOT EXISTS sma_200_slope_state             smallint,
      ADD COLUMN IF NOT EXISTS macd_zero_side                  smallint,
      -- Spread between the pair, normalized so it compares across price levels. A spread
      -- that squeezed tight and is now widening is the setup; the raw dollar gap is not.
      ADD COLUMN IF NOT EXISTS ema_9_sma_18_spread             double precision,
      -- Session volume over the 20-day average, on the cross bar. Conviction, cheaply.
      ADD COLUMN IF NOT EXISTS volume_vs_adv_20                double precision
`;

const DROPS = [
  'sma_18',
  'rsi_14_slope', 'rsi_14_slope_state', 'rsi_14_curvature', 'rsi_14_curvature_state',
  'macd_line_slope', 'macd_line_slope_state', 'macd_line_curvature', 'macd_line_curvature_state',
  'close_slope', 'close_slope_state',
  'ema_9_sma_18_cross_dir', 'ema_9_sma_18_bars_since_cross', 'ema_9_sma_18_cross_slope_gap',
  'ema_9_sma_18_cross_both_agree', 'ema_9_sma_18_cross_state',
  'macd_cross_dir', 'macd_cross_bars_since', 'macd_cross_slope_gap',
  'macd_cross_both_agree', 'macd_cross_state',
  'close_vs_sma_50', 'close_vs_sma_200', 'sma_50_slope_state', 'sma_200_slope_state',
  'macd_zero_side', 'ema_9_sma_18_spread', 'volume_vs_adv_20',
];

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE security_daily_indicators
${COLUMNS};
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE security_daily_indicators
      ${DROPS.map(column => `DROP COLUMN IF EXISTS ${column}`).join(',\n      ')};
  `);
};
