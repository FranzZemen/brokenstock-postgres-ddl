/*
Created by Franz Zemen 2026-08-06
License Type: UNLICENSED

Repair the `vendor_sync_jobs` feed_type CHECK — SECOND OCCURRENCE of the failure
that `2026-08-01T223000Z_feed_type_check_repair.ts` was written to fix, five days
after that file was written to warn about it.

WHAT HAPPENED. `2026-08-06T140000Z_economy_monthly_feeds.ts` copied its
`FEED_TYPES_BEFORE` array from the newest feed migration it could find, which was
`2026-08-04T220000Z_iv_backfill_feed.ts`. It missed
`2026-08-05T120000Z_iv_backfill_planner_cron.ts`, which had added
`security-iv-backfill-plan` in between. The rewritten constraint therefore
dropped a feed type that is live and running daily.

THE ASYMMETRY IS THE DANGEROUS PART, and it played out exactly as the earlier
repair predicted:

  - **prod_blue** has `security-iv-backfill-plan` rows (2, newest 2026-08-06
    07:30). The ALTER failed loudly, the transaction rolled back, and nothing was
    damaged. The loud failure is the GOOD outcome.
  - **dev_franz** has no such row yet. The ALTER SUCCEEDED and left a constraint
    that would reject the planner the first time it ran there — silently, and
    long after anyone would connect the two events.

So this migration exists to converge dev_franz, and is a harmless re-assert on
prod_blue.

WHY THE PATTERN KEEPS BITING. Adding a feed requires restating the entire list
from memory of the migration history, and the history is not linear in a way
grep makes obvious — the file that added the missing entry is named for a CRON,
not for a feed type. Anyone doing this again should read the LIVE constraint
rather than the migration files:

  select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'vendor_sync_jobs'::regclass
     and conname = 'vendor_sync_jobs_feed_type_chk';

That is ground truth. The migration files are a reconstruction of it, and this is
the second time the reconstruction has been wrong.

Declarative, not incremental: it states the full set and sets it, so it converges
from either condition.

MIN_SCHEMA_VERSION = 2026-08-06T150000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

/**
 * The complete set, taken from the LIVE prod_blue constraint on 2026-08-06 plus
 * the three feeds added by the migration immediately before this one. Additions
 * append here.
 */
const FEED_TYPES = [
  'equity-prices', 'options-prices', 'stock-splits-fetch', 'market-calendar',
  'ticker-info', 'ticker-ratios', 'equity-price-repair',
  'security-reference-populate', 'security-reference-refresh', 'branding-images',
  'equity-prices-plan', 'options-prices-plan', 'price-rebase-sweep',
  'security-float-refresh',
  'security-short-interest', 'security-short-volume', 'security-short-volume-plan',
  'ipo-refresh', 'daily-indicators', 'price-discontinuity-audit',
  'security-iv-snapshot', 'economy-treasury-yields',
  'security-iv-backfill', 'security-iv-backfill-plan',
  'economy-inflation', 'economy-inflation-expectations', 'economy-labor-market',
];

const checkSql = (feeds: string[]): string =>
  `feed_type IN (${feeds.map((f) => `'${f}'`).join(', ')})`;

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES)});`);
};

export const down = (): void => {
  // Deliberately empty. This migration repairs a constraint to the set that is
  // actually in use; there is no earlier state worth restoring, and restoring
  // one would re-introduce the defect.
};
