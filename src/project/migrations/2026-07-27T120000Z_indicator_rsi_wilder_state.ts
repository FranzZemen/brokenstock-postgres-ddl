/*
Created by Franz Zemen
License Type: UNLICENSED

Persist the Wilder RSI state on `security_daily_indicators`
(daily-indicators-scanner PRD E9 — live provisional overlay).

WHY THE STATE AND NOT JUST THE RSI. A provisional intraday RSI is one more Wilder step from
the previous session's averages:

    delta      = livePrice - prevClose
    avgGain'   = (avgGain * 13 + max(delta, 0)) / 14
    avgLoss'   = (avgLoss * 13 + max(-delta, 0)) / 14
    rsi'       = 100 - 100 / (1 + avgGain' / avgLoss')

Without the stored averages the only alternative is recomputing RSI from a short trailing
window at request time — and a Wilder RSI seeded over ~14 bars does NOT equal one carrying
500 bars of smoothing behind it. The provisional number would silently disagree with the EOD
number displayed beside it, which is worse than showing no overlay at all. Storing the state
makes the two agree by construction: same chain, one extra step.

NULLABLE. Null until RSI converges (28 closes), and null on every row written before this
migration. The overlay simply does not render for a row without state — it degrades to the
stored EOD value, which is the correct fallback.

Cheap: two doubles on a table whose rows already carry ~25 numeric columns.

MIN_SCHEMA_VERSION unchanged — the worker tolerates their absence (it writes them when
present), so this does not gate a deploy.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE security_daily_indicators
      ADD COLUMN IF NOT EXISTS rsi_avg_gain_14 double precision,
      ADD COLUMN IF NOT EXISTS rsi_avg_loss_14 double precision;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE security_daily_indicators
      DROP COLUMN IF EXISTS rsi_avg_gain_14,
      DROP COLUMN IF EXISTS rsi_avg_loss_14;
  `);
};
