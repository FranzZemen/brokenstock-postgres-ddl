/*
Created by Franz Zemen
License Type: UNLICENSED

Daily Indicators & the Overbought / Oversold Scanner
(PRD: projects/doc/prd/daily-indicators-scanner.prd.md, E2 — D6/D7/D8/D9/D10).

`security_daily_indicators` — one row per (security, trading session) holding a standard
indicator set computed nightly from `prices_equity`. This is the fleet's FIRST persisted
server-side indicator plane: today SMA/EMA/MACD are computed client-side by Highstock
(scanners.prd.md D24), the vendor's RSI endpoint costs 1 credit per ticker (~12,700/day to
cover the market, and it cannot answer historical dates), and the only other derived series
— `rrg_rs_series` — is write-only cache, not a queryable plane.

WHY THIS TABLE EXISTS AT ALL (the measurement, prod_blue 2026-07-24): `prices_equity` held
2,991,464 bars over 12,724 securities but a MEDIAN OF 28 BARS PER SECURITY — only 715 (5.6%)
had 60 or more. The universe-wide flat-file feed had been running ~28 sessions and took no
history backfill (scanners.prd.md D4). E1 replays ~2 years of daily flat files to fix that;
this table is what consumes the result.

DELIBERATE DEVIATION — PRIMARY KEY ORDER (D7). Every other price-shaped table here is keyed
`(security_key, <date>)` with a PK-only index strategy (era-2 prices_equity D6). This one is
keyed `(closing_date, security_key)` — DATE-LEADING — because the dominant query inverts the
usual one: "every security matching a predicate ON DATE D" (the scanner), which under a
security-leading PK is a full scan. A secondary index `(security_key, closing_date)` keeps
the per-security history path (sparkline, divergence/trend work) a PK-prefix range scan.
Two indexes on a ~2.8M-row/year table is the accepted cost of that inversion; it is the one
place this feature knowingly departs from house convention, and the scan pattern is why.

COLUMN NOTES:
  - `close`/`volume` are DENORMALIZED from prices_equity so a scan needs no join at all.
  - Indicator periods are COLUMNS, not a params_hash. RRG's params_hash exists to partition
    calibration experiments; these are standard settings and are not user-tunable. A future
    rsi_21 is an ALTER, not a migration of key shape.
  - Every indicator column is NULLABLE and warms up INDEPENDENTLY (D9): rsi_14 needs ~30
    bars, sma_200 needs 200, high_52w needs 252. A row is written whenever at least one is
    computable, and `bars_in_window` records the depth so a reader can judge trust. The
    rejected alternative — skip the security until fully warm — silently hides recent IPOs,
    which is exactly where sharp RSI moves happen.
  - `suspect` (D10) flags a window containing an unexplained >35% single-day move. RSI is
    scale-invariant, so a UNIFORMLY split-adjusted window is fine; the hazard is a window
    straddling an unrecorded split, which injects a phantom ±90% day and yields RSI ~1 or
    ~99. `stock_splits` is fetched weekly (Sun) and the rebase sweep runs Saturday, so a
    mid-week split leaves history mis-based for days. Measured on prod_blue: 1,087 such
    moves across 649 securities in ~90 sessions (~12/day) — few enough to be cheap to flag,
    many enough that unflagged they would occupy the top of every overbought/oversold list.
  - NO OBV / MFI / Force Index. The drop_momentum_msa migration (2026-07-15) names exactly
    those as the known indicators MSA reduced to with no edge, and OBV is cumulative from
    inception (a 20-day slope would be the sane form if ever wanted).

WRITER: the nightly `daily-indicators` job (E4) recomputes the trailing window statelessly
rather than carrying Wilder averages forward (D8) — incremental state drifts and would make
every split rebase a correctness incident. Hence the RELAXED actor CHECK below: batch
writers use the system `.brokenstock`/`.user` actor, and the strict `.user`-only form broke
Era-2/3 batch writes.

This migration creates the table ONLY. The `daily-indicators` feed_type CHECK widening and
its pg_cron entry land with the handler in E4, so the schema can go out ahead of the worker.

Bumps MIN_SCHEMA_VERSION = 2026-07-26T170000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

/** Batch writers use the system actor — `.user` OR `.brokenstock` (Era-2/3 lesson). */
const ACTOR_FMT = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(user|brokenstock)$';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE security_daily_indicators (
      closing_date        DATE NOT NULL,
      security_key        TEXT NOT NULL REFERENCES securities(key) ON DELETE CASCADE,

      -- Denormalized bar facts so the scanner never joins prices_equity.
      close               DOUBLE PRECISION,
      volume              DOUBLE PRECISION,

      -- Momentum oscillators (Wilder smoothing).
      rsi_14              DOUBLE PRECISION,
      rsi_2               DOUBLE PRECISION,

      -- Trend.
      sma_20              DOUBLE PRECISION,
      sma_50              DOUBLE PRECISION,
      sma_200             DOUBLE PRECISION,
      ema_9               DOUBLE PRECISION,
      ema_21              DOUBLE PRECISION,

      -- MACD 12/26/9.
      macd_line           DOUBLE PRECISION,
      macd_signal         DOUBLE PRECISION,
      macd_hist           DOUBLE PRECISION,

      -- Volatility. hv_* are annualized close-to-close; the options work compares them
      -- against implied vol to judge whether a contract is rich or cheap.
      atr_14              DOUBLE PRECISION,
      atr_pct             DOUBLE PRECISION,
      hv_20               DOUBLE PRECISION,
      hv_30               DOUBLE PRECISION,

      -- Bollinger (20, 2 sigma) as scalars: %b positions the close in the channel,
      -- bandwidth measures channel width. Upper/lower are redundant with close + sma_20.
      bb_percent_b        DOUBLE PRECISION,
      bb_bandwidth        DOUBLE PRECISION,

      -- Liquidity. Dollar volume is the tradeability filter that keeps untradeable
      -- names off the scanner; share volume alone is misleading across price levels.
      adv_20_shares       DOUBLE PRECISION,
      adv_20_dollar       DOUBLE PRECISION,

      -- Yearly context: oversold 3% off a 52-week high is a pullback; oversold at a
      -- fresh low is a falling knife. Different trades.
      high_52w            DOUBLE PRECISION,
      low_52w             DOUBLE PRECISION,
      pct_from_52w_high   DOUBLE PRECISION,

      -- Meta.
      bars_in_window      INTEGER NOT NULL,
      suspect             BOOLEAN NOT NULL DEFAULT false,
      computed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by          TEXT NOT NULL,
      updated_by          TEXT NOT NULL,

      -- DATE-LEADING (D7) — see the header. The scan is "all securities on date D".
      PRIMARY KEY (closing_date, security_key),
      CONSTRAINT security_daily_indicators_created_by_format_chk CHECK (created_by ~ '${ACTOR_FMT}'),
      CONSTRAINT security_daily_indicators_updated_by_format_chk CHECK (updated_by ~ '${ACTOR_FMT}')
    );
  `);

  // Per-security history: sparkline, divergence, and the trend work that follows. Without
  // this the date-leading PK would make a single symbol's series a full scan.
  pgm.sql(`
    CREATE INDEX security_daily_indicators_security_date_idx
      ON security_daily_indicators (security_key, closing_date);
  `);

  pgm.sql(`
    CREATE TRIGGER security_daily_indicators_set_updated_at BEFORE UPDATE ON security_daily_indicators
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS security_daily_indicators_set_updated_at ON security_daily_indicators;`);
  pgm.dropTable('security_daily_indicators', {ifExists: true});
};
