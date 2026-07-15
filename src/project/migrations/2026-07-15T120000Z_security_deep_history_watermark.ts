/*
Created by Franz Zemen
License Type: UNLICENSED

Deep-History Watermark (financial-data/doc/prd/deep-history-watermark.prd.md, E1).

Adds `securities.vendor_earliest_date DATE NULL` — the oldest date the price vendor
(Massive) actually has for a security. It is the BACKWARD-edge mirror of the
`prices_equity.adjusted_through_date` watermark: that one records "these bars are
split-adjusted THROUGH date X" (forward edge); this one records "the vendor has
nothing EARLIER than date X" (backward edge).

Why it exists: `EquityPriceTrustedApi.getDeepHistory` trusts its cached bars only if
the earliest cached bar sits near the requested floor. MSA requests from a fixed
`2003-01-01`, which predates every ETF's vendor inception, so the check can never
pass — and every /momentum/msa request re-fetches all 11 symbols from Massive and
re-writes them via putAdjustedBars (a vendor stampede + a prod write on every page
load). With this watermark, coverage is judged against `max(requestedFloor,
vendor_earliest_date)` — a security holding everything the vendor has is "covered",
even if that starts in 2012 — so the fetch (and the write) stops.

Additive only: nullable, no default, no data rewrite. NULL means "the vendor floor
has never been probed", which is the correct starting state — financial-data sets
the value the first time a deep pull returns bars later than what was asked for
(the only signal that reveals the true floor). No backfill migration: a blanket
MIN(closing_date) seed would falsely mark securities primed with only recent closes
as covered and suppress their legitimate backfill. See PRD D2/D4.

Bumps MIN_SCHEMA_VERSION = 2026-07-15T120000Z for consumers that read the column
(financial-data).
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.addColumn('securities', {
    vendor_earliest_date: {
      type: 'date',
      notNull: false,
    },
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropColumn('securities', 'vendor_earliest_date', {ifExists: true});
};
