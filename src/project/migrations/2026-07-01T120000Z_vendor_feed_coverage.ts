/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * equity-price-retroactive-refresh.prd.md — E1 / D4.
 *
 * vendor_feed_coverage — a per-feed "covered through" watermark for the
 * retroactive price planner. One row per feed_type (PK). This is the dedicated,
 * uncontaminated resume point the planner reads to compute its fetch range.
 *
 * Why a dedicated table (D4): `MAX(prices_equity.closing_date)` is NOT a usable
 * watermark — the on-demand REST path (`putAdjustedBars`) and ad-hoc runs write
 * bars for arbitrary dates/securities, so a naive max reads ahead of what the
 * flat-file feed has actually loaded universe-wide (measured: 6/22 had 3 REST
 * rows while the true flat-file watermark was 6/18). This table records only the
 * feed's own progress.
 *
 * Not NOTIFY-emitted — operational state, not consumer-cacheable data (same
 * rationale as stock_splits_coverage).
 *
 * Table create only — does NOT bump MIN_SCHEMA_VERSION on its own (the planner
 * activation lives in the sibling cron migration).
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const OWNER_FMT = `'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$'`;

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE vendor_feed_coverage (
      feed_type             TEXT PRIMARY KEY,
      covered_through_date  DATE,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by            TEXT NOT NULL,
      updated_by            TEXT NOT NULL,
      CONSTRAINT vendor_feed_coverage_created_by_format_chk CHECK (created_by ~ ${OWNER_FMT}),
      CONSTRAINT vendor_feed_coverage_updated_by_format_chk CHECK (updated_by ~ ${OWNER_FMT})
    );
  `);
  pgm.sql(`
    CREATE TRIGGER vendor_feed_coverage_set_updated_at BEFORE UPDATE ON vendor_feed_coverage
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS vendor_feed_coverage_set_updated_at ON vendor_feed_coverage;`);
  pgm.dropTable('vendor_feed_coverage');
};
