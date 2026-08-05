/*
Created by Franz Zemen 2026-08-05
License Type: UNLICENSED

Store the volatility rank per (security, session)
(projects/doc/prd/volatility-scanner.prd.md E1 / D10).

WHY STORE IT. Today the rank is computed in TypeScript from a year of samples
fetched per security. That is right for one security on a chart and impossible
for a scanner: 4,580 rankable securities against ~251 sessions each, on a
15-second poll, for every connected client. `security_daily_indicators.hv_30` is
already precomputed nightly for exactly this reason, and the scanner
architecture assumes one indexed row per security per session.

A rank is only meaningful AS OF a session, so storing it per session is not a
cache — it is the honest grain of the number. The consequence, stated because a
reader will otherwise expect otherwise: a stored rank reflects the window that
existed when it was written. It does NOT drift as later sessions arrive.
Re-running a past session recomputes it.

WHY THREE COLUMNS AND NOT ONE.
  - `iv_rank` is where the reading sits between the window's low and high. It is
    the number the scanner sorts on, and the one that answers "expensive for this
    name".
  - `iv_percentile` is the share of the window at or below the reading. The two
    diverge whenever the distribution is lopsided — a name that sat near its low
    all year and spiked once has a high rank and a high percentile; one that
    drifted up steadily has a high rank and a middling percentile. The chart
    already shows both and the scanner should not have to pick.
  - `iv_rank_samples` is how many readings the window actually held. Without it
    a rank cannot be told apart from a rank computed on eleven readings, and the
    existing display already labels that case `provisional`. Storing the count
    rather than a boolean keeps the threshold a display judgement in code
    (`MIN_CONFIDENT_SAMPLES`), which is where the other two thresholds live.

NULLABLE, all three: a session whose window holds nothing usable has no rank,
and writing 0 would be a real statement (bottom of the range) rather than an
absence. Same reasoning as `atm_iv` itself.

The partial index is on the scanner's actual access path — newest session, our
own readings, rank present — rather than on the columns generally. A scan reads
one session and never a range.

MIN_SCHEMA_VERSION: not bumped. The columns are additive and nullable; a worker
without them writes NULL and the scanner is not built yet.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE security_implied_volatility
      ADD COLUMN IF NOT EXISTS iv_rank         DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS iv_percentile   DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS iv_rank_samples INTEGER;
  `);

  pgm.sql(`
    COMMENT ON COLUMN security_implied_volatility.iv_rank IS
      'Where atm_iv sits between the trailing window''s low and high, 0-100, AS OF closing_date. Does not drift as later sessions arrive; re-running the session recomputes it. NULL = no usable window.';
  `);
  pgm.sql(`
    COMMENT ON COLUMN security_implied_volatility.iv_percentile IS
      'Share of the trailing window at or below atm_iv, 0-100. Diverges from iv_rank on a lopsided distribution, which is why both are stored.';
  `);
  pgm.sql(`
    COMMENT ON COLUMN security_implied_volatility.iv_rank_samples IS
      'Readings the window held. Below MIN_CONFIDENT_SAMPLES (60, in code) the rank is provisional — the threshold is a display judgement and deliberately not stored.';
  `);

  // The scanner's access path: one session, our readings, rank present.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS security_implied_volatility_rank_scan_idx
      ON security_implied_volatility (closing_date, iv_rank DESC)
      WHERE iv_source = 'computed' AND iv_rank IS NOT NULL;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP INDEX IF EXISTS security_implied_volatility_rank_scan_idx;`);
  pgm.sql(`
    ALTER TABLE security_implied_volatility
      DROP COLUMN IF EXISTS iv_rank,
      DROP COLUMN IF EXISTS iv_percentile,
      DROP COLUMN IF EXISTS iv_rank_samples;
  `);
};
