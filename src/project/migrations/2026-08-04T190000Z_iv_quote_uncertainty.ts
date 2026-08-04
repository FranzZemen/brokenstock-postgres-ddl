/*
Created by Franz Zemen 2026-08-04
License Type: UNLICENSED

`security_implied_volatility` — record how much the QUOTE pins the reading
(broken-stock/doc/prd/reference-options-chart.prd.md E14).

THE PROBLEM THIS SOLVES, MEASURED. On an illiquid contract the bid-ask spread is
wider than the quantity being measured, so no single implied volatility is
defensible. A real example from the first computed run: CONY, an $18.56 fund,
whose nearest option was quoted **5 cents bid against 75 cents ask** — the ask
fifteen times the bid. Volatility consistent with that quote runs from roughly
15% to 80%. Taking the midpoint yields a confident-looking number that the market
does not support.

It is not a new problem, only a newly visible one: the previous capture stored
the VENDOR's figure, so their pick on an untradeable quote went in silently.

WHY A MEASURED BAND RATHER THAN A SPREAD THRESHOLD. "Refuse if the spread exceeds
N%" sounds principled and is not: the same spread in cents pins volatility
tightly on one contract and not at all on another, depending on how sensitive its
price is to volatility. So we solve the volatility implied by the BID and by the
ASK and store both. The distance between them IS the uncertainty, in the same
units as the answer, per contract, with no threshold invented anywhere.

WHY BOTH ENDS ARE NULLABLE, SEPARATELY. A bid at or below intrinsic implies no
volatility at all — common on thin contracts. A NULL low end means "unbounded
below", which is a stronger statement about unreliability than any number, and
collapsing it to the mid would understate the uncertainty precisely where it is
worst.

NO THRESHOLD IS STORED. Where the line falls between "usable" and "too wide"
belongs to the caller and will differ between a chart label and a scanner filter.
Baking one in at capture time would freeze a display decision into the history.

MIN_SCHEMA_VERSION = 2026-08-04T190000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE security_implied_volatility
      ADD COLUMN atm_iv_at_bid DOUBLE PRECISION,
      ADD COLUMN atm_iv_at_ask DOUBLE PRECISION;
  `);

  pgm.sql(`
    COMMENT ON COLUMN security_implied_volatility.atm_iv_at_bid IS
      'Constant-maturity implied volatility implied by the BID side of the quote, as a decimal. '
      'With atm_iv_at_ask this is how tightly the market pins the reading - the honest measure of '
      'uncertainty, in the same units as the answer. NULL means the bid implies no volatility at all '
      '(at or below intrinsic), i.e. unbounded below - a STRONGER statement of unreliability than any number.';
  `);
  pgm.sql(`
    COMMENT ON COLUMN security_implied_volatility.atm_iv_at_ask IS
      'Constant-maturity implied volatility implied by the ASK side of the quote, as a decimal. '
      'Measured 2026-08-04: liquid names sit a fraction of a point from atm_iv_at_bid; a thin fund '
      'spanned roughly 15% to 80%, where no single reading is defensible.';
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE security_implied_volatility
      DROP COLUMN IF EXISTS atm_iv_at_bid,
      DROP COLUMN IF EXISTS atm_iv_at_ask;
  `);
};
