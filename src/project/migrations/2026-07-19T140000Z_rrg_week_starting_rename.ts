/*
Created by Franz Zemen
License Type: UNLICENSED

Rotation / RRG — rename rrg_rs_series.week_ending → week_starting.

The column never held a week-ENDING date. Weekly candles are bucketed by
`weekAnchor()` (financial-data price-chart.ts), which snaps to the ISO-week
MONDAY, and `rollupCandle` stamps that anchor as the candle's date. So the value
stored here is the Monday the week STARTS, four days before the Friday close the
coordinates are actually computed from.

The misnomer leaked all the way to the UI, whose "AS-OF WEEK" label printed the
column verbatim and so read four days early. It also masked a second bug in the
closed-week filter (`anchor + 6 < today`, i.e. Sunday) that withheld a finished
week until the following Monday. Both are fixed in financial-data; this migration
makes the storage layer stop lying about what it holds.

Rename only — no data change. The PRIMARY KEY (benchmark_key, symbol_key,
granularity, params_hash, week_ending) follows the rename automatically; Postgres
rewrites the constraint definition in place, so no index rebuild and no table
rewrite. rrg_rs_series is a pure derived cache (recomputable from prices_equity),
so even total loss here would be self-healing.

`rrg_series_meta.computed_through_week` is deliberately NOT renamed: "computed
through week X" is anchor-agnostic and stays accurate either way.

Bumps MIN_SCHEMA_VERSION = 2026-07-19T140000Z — app-worker must deploy the
matching financial-data (RrgPoint.weekStarting) alongside this.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE rrg_rs_series RENAME COLUMN week_ending TO week_starting;`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE rrg_rs_series RENAME COLUMN week_starting TO week_ending;`);
};
