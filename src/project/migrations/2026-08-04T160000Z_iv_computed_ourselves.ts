/*
Created by Franz Zemen 2026-08-04
License Type: UNLICENSED

`security_implied_volatility` — store OUR computed implied volatility, keep the
vendor's alongside as a permanent accuracy check
(broken-stock/doc/prd/reference-options-chart.prd.md E14).

WHAT CHANGES. `atm_iv`, `near_iv` and `far_iv` become OUR numbers, derived by
inverting an option pricing model on the contract's market price. They were the
vendor's. The vendor's blended figure moves to `vendor_atm_iv`, where it stops
being the product and becomes the measurement.

WHY THE VENDOR'S NUMBER IS KEPT RATHER THAN DROPPED. It is the only answer key
this system will ever have. The vendor publishes implied volatility for the
CURRENT moment only — 0 for any past date — so today's chain is the one place
our arithmetic can be checked against someone else's. Storing both every night
turns "we believe the math is right" into a measurement we can query, and it
means the night our numbers start drifting is visible rather than discovered
later. A self-consistent test can never catch that.

WHY THE RATE IS STORED. Without it a stored reading cannot be reproduced. The
rate moves daily and the table it comes from is rewritten in full on every feed
run (economy-indicators.prd.md D2), so "what rate did we use on 12 March" is
otherwise unanswerable after the fact. Stored as PERCENT, matching
`economy_treasury_yields` — the conversion to a fraction belongs to the pricing
math, and having two units for one quantity in one database is how a
hundredfold error gets in.

WHY THE DIVIDEND FLAG. Whether a dividend fell inside the window decides which
model priced the contract: with one, early exercise can be worth something and a
binomial tree runs; without one, an American call is EXACTLY a European call and
the closed form is used. Two readings for the same security in consecutive
months can therefore come from different models, and this column is what makes
that visible instead of looking like a volatility move.

NO BACKFILL OF EXISTING ROWS. The 1,000 rows already captured hold the vendor's
number in `atm_iv`. They are left alone and NOT copied into `vendor_atm_iv`,
because that would assert they were computed the new way. They are one session
out of a series that needs a year, and the backfill will overwrite them.

MIN_SCHEMA_VERSION = 2026-08-04T160000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE security_implied_volatility
      ADD COLUMN vendor_atm_iv        DOUBLE PRECISION,
      ADD COLUMN risk_free_rate_pct   DOUBLE PRECISION,
      ADD COLUMN rate_observation_date DATE,
      ADD COLUMN had_dividend_in_window BOOLEAN,
      ADD COLUMN iv_source            TEXT NOT NULL DEFAULT 'vendor';
  `);

  pgm.sql(`
    ALTER TABLE security_implied_volatility
      ADD CONSTRAINT security_implied_volatility_iv_source_chk
        CHECK (iv_source IN ('vendor', 'computed'));
  `);

  pgm.sql(`
    COMMENT ON COLUMN security_implied_volatility.atm_iv IS
      'Constant-maturity at-the-money implied volatility as a DECIMAL (0.24 = 24%). '
      'Whose number this is depends on iv_source. NULL means we looked and found nothing usable - NEVER zero volatility.';
  `);
  pgm.sql(`
    COMMENT ON COLUMN security_implied_volatility.vendor_atm_iv IS
      'The vendor''s blended figure for the same sample, kept as a permanent accuracy check on our own arithmetic. '
      'Not the product. NULL on rows predating the comparison, and on any row where the vendor published nothing.';
  `);
  pgm.sql(`
    COMMENT ON COLUMN security_implied_volatility.risk_free_rate_pct IS
      'PERCENT (3.78 = 3.78%), matching economy_treasury_yields. The rate actually used, so a reading can be reproduced '
      'after the source table has been rewritten by a later feed run.';
  `);
  pgm.sql(`
    COMMENT ON COLUMN security_implied_volatility.rate_observation_date IS
      'The date the rate was published for, which is NOT always closing_date - yields publish on trading days only, '
      'so a holiday resolves to the nearest earlier date.';
  `);
  pgm.sql(`
    COMMENT ON COLUMN security_implied_volatility.had_dividend_in_window IS
      'True when a dividend ex-date fell before expiry, which selects the binomial tree over the closed form. '
      'Consecutive months for one security can use different models; this is what makes that visible.';
  `);
  pgm.sql(`
    COMMENT ON COLUMN security_implied_volatility.iv_source IS
      'Who computed atm_iv: ''computed'' = ours, ''vendor'' = read from the vendor snapshot. '
      'Existing rows default to ''vendor'' because that is what they are. Mixing the two in one rank measures the gap '
      'between two calculations as much as it measures volatility.';
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE security_implied_volatility DROP CONSTRAINT IF EXISTS security_implied_volatility_iv_source_chk;`);
  pgm.sql(`
    ALTER TABLE security_implied_volatility
      DROP COLUMN IF EXISTS vendor_atm_iv,
      DROP COLUMN IF EXISTS risk_free_rate_pct,
      DROP COLUMN IF EXISTS rate_observation_date,
      DROP COLUMN IF EXISTS had_dividend_in_window,
      DROP COLUMN IF EXISTS iv_source;
  `);
};
