/*
Created by Franz Zemen
License Type: UNLICENSED

Pause the `security-iv-snapshot` cron
(broken-stock/doc/prd/reference-options-chart.prd.md, E14).

WHY IT IS PAUSED RATHER THAN DELETED. The feed works — it captured usable
readings for ~1,000 underlyings with ~99% true constant-maturity blends. What is
wrong is the SHAPE, not the code: it sweeps 5,201 optionable securities every
weeknight, taking roughly an hour, so that a rank is available for the handful of
options anyone actually opens.

THE DISTINCTION THAT SETTLES IT is perishable versus derivable, not cheap versus
expensive:

  - PERISHABLE — gone if not captured tonight (daily bars, splits, the OPRA
    file). These must be scheduled jobs whatever they cost.
  - DERIVABLE — computable from what we already hold, whenever anyone asks.
    These should not be jobs at all.

Implied volatility was built as perishable because the VENDOR sells no
historical implied volatility. But it is derivable: it can be backed out of an
option's historical price together with the underlying's closes, which we store.
Expired contracts are indexable, so any past session can be reconstructed.

The proof is that pausing costs nothing permanent. A genuinely perishable feed
could not say that.

WHAT SURVIVES. The table, its rank arithmetic, the store/read API and the handler
all stay. The rows already captured stay. If a future cross-sectional scanner
needs a universe-wide sweep — the one thing on-demand cannot serve — re-enabling
is a one-line migration.

The choice between on-demand computation and a reinstated sweep is deliberately
NOT made here. It belongs to E14, along with whether the platform wants an
"analytics" class of work at all.

MIN_SCHEMA_VERSION = 2026-08-02T110000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';
import {scheduleVendorSyncCron, unscheduleVendorSyncCron} from '../vendor-sync-cron.js';

const IV_SNAPSHOT = 'security-iv-snapshot';

/** The schedule this restores on `down` — 22:10 UTC weekdays, post-close. */
const SCHEDULE = '10 22 * * 1-5';

export const up = (pgm: MigrationBuilder): void => {
  unscheduleVendorSyncCron(pgm, IV_SNAPSHOT);
};

export const down = (pgm: MigrationBuilder): void => {
  scheduleVendorSyncCron(pgm, IV_SNAPSHOT, SCHEDULE);
};
