/*
Created by Franz Zemen
License Type: UNLICENSED

Constant-maturity columns on `security_implied_volatility`
(broken-stock/doc/prd/reference-options-chart.prd.md E12 / D19).

WHY THIS RESHAPES A TABLE PUBLISHED HOURS AGO. The table is EMPTY — the capture
job does not exist yet — so reshaping it now costs nothing, and doing it after a
year of samples would mean either a backfill that cannot be done (the vendor
sells no historical implied volatility at any price) or a permanent split
between old and new rows.

WHY CONSTANT MATURITY AT ALL. Sampling whichever expiration happens to be near
means the measured volatility JUMPS every time that expiration rolls forward,
because volatility differs by expiration. That jump is not a change in
volatility, but it enters the history as if it were — and the whole point of
this table is to be a history a rank is computed against. Sampling one
expiration would manufacture a monthly sawtooth and then rank against it.

So `atm_iv` holds a 30-day CONSTANT-MATURITY value interpolated between the two
expirations that bracket 30 days, and both legs are recorded so any stored value
can be re-derived and audited.

`far_*` is NULLABLE: when only one usable expiration exists, the near leg is
stored as-is and `far_expiration_date` is null. That row is a real reading and
is better than no reading, but it is NOT constant-maturity, and a reader can
tell the difference — which is exactly why the legs are stored rather than just
the blend.

MIN_SCHEMA_VERSION = 2026-08-01T233000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  // Empty table: rename rather than accumulate near-synonyms. `expiration_date`
  // was singular and would have become a lie the moment interpolation landed.
  pgm.sql(`ALTER TABLE security_implied_volatility RENAME COLUMN expiration_date TO near_expiration_date;`);
  pgm.sql(`ALTER TABLE security_implied_volatility RENAME COLUMN days_to_expiry TO near_days_to_expiry;`);
  pgm.sql(`
    ALTER TABLE security_implied_volatility
      -- The maturity atm_iv is normalized to, in days. Stored rather than
      -- assumed so that changing it later is detectable in the data instead of
      -- silently mixing two different measurements in one series.
      ADD COLUMN target_days INTEGER NOT NULL DEFAULT 30,
      -- The near leg's own implied volatility, before blending.
      ADD COLUMN near_iv DOUBLE PRECISION,
      -- The far leg. NULL when only one usable expiration existed, in which case
      -- atm_iv is the near leg unblended and is NOT constant-maturity.
      ADD COLUMN far_expiration_date DATE,
      ADD COLUMN far_days_to_expiry INTEGER,
      ADD COLUMN far_iv DOUBLE PRECISION;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE security_implied_volatility
      DROP COLUMN IF EXISTS far_iv,
      DROP COLUMN IF EXISTS far_days_to_expiry,
      DROP COLUMN IF EXISTS far_expiration_date,
      DROP COLUMN IF EXISTS near_iv,
      DROP COLUMN IF EXISTS target_days;
  `);
  pgm.sql(`ALTER TABLE security_implied_volatility RENAME COLUMN near_days_to_expiry TO days_to_expiry;`);
  pgm.sql(`ALTER TABLE security_implied_volatility RENAME COLUMN near_expiration_date TO expiration_date;`);
};
