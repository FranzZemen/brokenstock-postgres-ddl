/*
Created by Franz Zemen
License Type: UNLICENSED

Era 5 — add open_trade_yield_summaries.lineage_graph (managed-roll lineage).

PRD: trade-yield-persistence/doc/prd/restore-managed-roll-lineage-persistence.prd.md (E1).

The DDB→Aurora migration relationalized the trade-yield summary into typed columns +
segment/unit fact tables but left no home for `TradeYieldSegmentSummary.lineageGraph`
— the v3 managed-rolls inference output the FE Managed Rolls tab renders. So every
persisted summary lost its lineage and the tab went blank for all trades.

`lineage_graph` is the one DELIBERATE jsonb exception to era-4-4a's ZERO-jsonb rule
(see 2026-06-08T120000Z_era_4_4a_yield_persistence.ts decisions 4a-3/4a-4). The rule
exists for query/aggregate FACTS (gains, portions, archetype contributions) which the
rollups SQL over — those stay relational. `lineage_graph` is categorically different:
a BOUNDED, RENDER-ONLY payload the FE consumes verbatim; no SQL ever queries inside it,
and its shape is algorithm-versioned (managed-rolls v1→v3), so relationalizing it would
freeze a churning, never-queried DAG into ~6 child tables for zero query benefit. jsonb
rides the summary row already read on the hot path (zero added read queries). If a single
field ever proves worth querying, hoist THAT field to a typed scalar column (additive) —
do not relationalize the whole graph.

Nullable: equity-only trades carry NULL (no option lineage). Legacy rows are left NULL
and repopulated by the backfill (PRD E5) + future recompute writes.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE open_trade_yield_summaries ADD COLUMN IF NOT EXISTS lineage_graph JSONB;`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE open_trade_yield_summaries DROP COLUMN IF EXISTS lineage_graph;`);
};
