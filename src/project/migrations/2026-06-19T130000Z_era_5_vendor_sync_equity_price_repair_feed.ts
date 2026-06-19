/*
Created by Franz Zemen
License Type: UNLICENSED

Era 5 — add the `equity-price-repair` vendor-sync feed (PRD E5).

A background feed that delete+repopulates a security's corrupted equity price
history (the split-adjustment watermark repair) and invalidates the derived
yields/gains. Two schema accommodations vs the scheduled feeds:

  1. Relax the feed_type CHECK to admit 'equity-price-repair'.
  2. The dedupe unique index (feed_type, scheduled_for_date) must NOT collapse
     repairs — multiple ad-hoc repairs can be enqueued the same day (admin tool +
     bulk cleanup). Make the unique index PARTIAL, excluding this feed. The repair
     feed carries its target securityKeys in the JSONB payload, so day-dedupe is
     meaningless for it anyway.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;
    ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk
      CHECK (feed_type IN ('equity-prices', 'options-prices', 'stock-splits-fetch',
                           'market-calendar', 'ticker-info', 'ticker-ratios',
                           'equity-price-repair'));
  `);
  // Partial unique index: dedupe the scheduled feeds by (feed_type, day), but allow
  // any number of 'equity-price-repair' jobs to coexist.
  pgm.sql(`DROP INDEX IF EXISTS vendor_sync_jobs_dedupe_uidx;`);
  pgm.sql(`
    CREATE UNIQUE INDEX vendor_sync_jobs_dedupe_uidx
      ON vendor_sync_jobs (feed_type, scheduled_for_date)
      WHERE feed_type <> 'equity-price-repair';
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP INDEX IF EXISTS vendor_sync_jobs_dedupe_uidx;`);
  pgm.sql(`
    CREATE UNIQUE INDEX vendor_sync_jobs_dedupe_uidx
      ON vendor_sync_jobs (feed_type, scheduled_for_date);
  `);
  pgm.sql(`
    ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;
    ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk
      CHECK (feed_type IN ('equity-prices', 'options-prices', 'stock-splits-fetch',
                           'market-calendar', 'ticker-info', 'ticker-ratios'));
  `);
};
