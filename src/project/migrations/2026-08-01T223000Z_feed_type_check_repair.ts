/*
Created by Franz Zemen
License Type: UNLICENSED

Repair the `vendor_sync_jobs` feed_type CHECK to the full current feed set.

WHY THIS EXISTS. Every feed-registration migration re-declares the WHOLE list as
a hardcoded `FEED_TYPES_BEFORE` array and rewrites the constraint from it. Copy
the array from a migration that is not the newest one and the rewrite silently
DROPS whatever was added in between. That happened here: the
`security-iv-snapshot` migration was written against the 2026-07-26 daily-
indicators list, which predates `price-discontinuity-audit`.

The failure is asymmetric and that is what makes it dangerous. On a database
with rows of the dropped feed type, the ALTER fails loudly and the whole
migration rolls back. On a database WITHOUT such a row yet, it succeeds — and
leaves a constraint that will reject that feed the first time it runs, long
after anyone connects the two events.

This migration is declarative rather than incremental: it states the full set and
sets it, so running it on a database in either condition converges on the same
correct constraint.

MIN_SCHEMA_VERSION = 2026-08-01T223000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

/** The complete set as of this migration. Additions append here. */
const FEED_TYPES = [
  'equity-prices', 'options-prices', 'stock-splits-fetch', 'market-calendar',
  'ticker-info', 'ticker-ratios', 'equity-price-repair',
  'security-reference-populate', 'security-reference-refresh', 'branding-images',
  'equity-prices-plan', 'options-prices-plan', 'price-rebase-sweep',
  'security-float-refresh',
  'security-short-interest', 'security-short-volume', 'security-short-volume-plan',
  'ipo-refresh', 'daily-indicators', 'price-discontinuity-audit',
  'security-iv-snapshot',
];

const checkSql = (feeds: string[]): string =>
  `feed_type IN (${feeds.map((f) => `'${f}'`).join(', ')})`;

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES)});`);
};

export const down = (): void => {
  // No down. Reverting to a narrower set would re-create the exact defect this
  // migration exists to repair, and the constraint carries no data of its own.
};
