/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Era 2 C1 amendment 2026-06-02: restore the DDB shape of
 * `stock_splits_coverage` that was lost in the v0.4.0 migration.
 *
 * Defect surfaced during C3 stock-splits prep (post-mortem in MEMORY's
 * feedback_per_column_ddb_pg_audit). The original v0.4.0 migration silently
 * narrowed the DDB shape to worker-progress-only fields:
 *   - dropped: earliestCoverageDate, latestCoverageDate, coverageSource
 *   - renamed:  coverageStatus → status
 *   - flipped:  coverageStatus optional (DDB) → status NOT NULL (PG)
 *
 * None of those changes were locked as named Deviations in the C1 PRD; they
 * were unflagged designer-flavored "improvements" during migration writing.
 * Per [[feedback-preserve-ddb-access-patterns]] + the new
 * [[feedback-per-column-ddb-pg-audit]], the DDB shape must round-trip.
 *
 * This migration:
 *   1. Adds back earliest_coverage_date / latest_coverage_date / coverage_source.
 *   2. Renames status → coverage_status.
 *   3. Makes coverage_status NULLABLE (DDB read-as-`ready'-when-absent
 *      semantics preserved at the API layer, not at the DB).
 *   4. Replaces the status CHECK with one keyed on coverage_status and
 *      tolerating NULL.
 *
 * Pins the new MIN_SCHEMA_VERSION = 2026-06-02T120000Z (supersedes the
 * 2026-06-01T120500Z mic-mappings amendment). Consumers refactoring against
 * Era 2 C1 must pin to this timestamp from now on.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE stock_splits_coverage
      ADD COLUMN earliest_coverage_date DATE,
      ADD COLUMN latest_coverage_date   DATE,
      ADD COLUMN coverage_source        TEXT;
  `);
  pgm.sql(`
    ALTER TABLE stock_splits_coverage
      RENAME COLUMN status TO coverage_status;
  `);
  pgm.sql(`
    ALTER TABLE stock_splits_coverage
      DROP CONSTRAINT IF EXISTS stock_splits_coverage_status_chk;
  `);
  pgm.sql(`
    ALTER TABLE stock_splits_coverage
      ALTER COLUMN coverage_status DROP NOT NULL;
  `);
  pgm.sql(`
    ALTER TABLE stock_splits_coverage
      ADD CONSTRAINT stock_splits_coverage_status_chk
        CHECK (coverage_status IS NULL OR coverage_status IN ('ready', 'pending', 'failed'));
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  // Best-effort reverse: re-tighten coverage_status, rename back, drop the
  // restored columns. Will lose any rows whose coverage_status is NULL.
  pgm.sql(`
    ALTER TABLE stock_splits_coverage
      DROP CONSTRAINT IF EXISTS stock_splits_coverage_status_chk;
  `);
  pgm.sql(`
    UPDATE stock_splits_coverage SET coverage_status = 'ready' WHERE coverage_status IS NULL;
  `);
  pgm.sql(`
    ALTER TABLE stock_splits_coverage
      ALTER COLUMN coverage_status SET NOT NULL;
  `);
  pgm.sql(`
    ALTER TABLE stock_splits_coverage
      RENAME COLUMN coverage_status TO status;
  `);
  pgm.sql(`
    ALTER TABLE stock_splits_coverage
      ADD CONSTRAINT stock_splits_coverage_status_chk
        CHECK (status IN ('ready', 'pending', 'failed'));
  `);
  pgm.sql(`
    ALTER TABLE stock_splits_coverage
      DROP COLUMN IF EXISTS coverage_source,
      DROP COLUMN IF EXISTS latest_coverage_date,
      DROP COLUMN IF EXISTS earliest_coverage_date;
  `);
};
