/*
Created by Franz Zemen
License Type: UNLICENSED

Move the `daily-indicators` safety-net cron from 03:00 UTC to 07:00 UTC.

WHY. 03:00 was chosen as "safely past the 01:15 UTC equity plan and its per-date jobs". It
is not. Measured on 2026-07-28, `equity-prices` for the 2026-07-27 session ran 01:15 → 05:15
— it takes about four hours to load ~12,000 securities from the universe flat file. The
03:00 indicator cron therefore fired 2h15m before its own inputs existed, found ONE security
with a bar for that session, wrote one row, and completed green. That one-row session became
the newest session in the plane, and the Overbought/Oversold scanner — which took the plane's
maximum session as "today" — returned nothing for every filter setting.

That timing is not an anomaly: at 03:00 UTC the last close is ~7 hours old and its load is
mid-flight, so every weekday run had the same defect. Mondays escaped it by accident, having
targeted Friday's session, whose bars landed on Saturday.

07:00 UTC sits after the equity load's observed completion with ~1h45m of headroom, and
still hours before Franz looks at a scanner. It remains only a SAFETY NET: the primary path
is the chain fired when `equity-prices` completes (dequeue-loop `maybeTriggerDailyIndicators`),
which now enqueues ad-hoc so it cannot be blocked by a stale dedupe key — the reason it had
never once fired.

Timing alone is not the fix and is not treated as one. The handler now states its own
precondition (park as `awaiting_vendor` when the session's bars are not loaded) and asserts
its own outcome (alert when a run writes implausibly few rows), so a load that runs long, or
a schedule that drifts, cannot silently produce a partial session again. This migration only
stops the common case from relying on those guards every single night.

Uses `scheduleVendorSyncCron`, which unschedules first and is the sanctioned way to correct
a registered job — the enqueue SQL and its partial-index ON CONFLICT predicate are defined
exactly once, deliberately (see vendor-sync-cron.ts's history).
*/

import type {MigrationBuilder} from 'node-pg-migrate';
import {scheduleVendorSyncCron} from '../vendor-sync-cron.js';

const FEED = 'daily-indicators';

/** 07:00 UTC — after the observed ~05:15 completion of the session's equity price load. */
const SCHEDULE = '0 7 * * *';

/** The original schedule, restored by `down`. */
const PREVIOUS_SCHEDULE = '0 3 * * *';

export const up = (pgm: MigrationBuilder): void => {
  scheduleVendorSyncCron(pgm, FEED, SCHEDULE);
};

export const down = (pgm: MigrationBuilder): void => {
  scheduleVendorSyncCron(pgm, FEED, PREVIOUS_SCHEDULE);
};
