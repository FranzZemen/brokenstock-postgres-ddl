/*
Created by Franz Zemen
License Type: UNLICENSED

IPO Feed (PRD: projects/doc/prd/ipo-feed.prd.md, E1).

Massive /vX/reference/ipos — IPO events (rumor -> pending -> new -> history, plus
withdrawn / postponed / direct_listing_process), history back to 2008. UNLIKE every
prior Massive feed this data is NOT tied to an existing security: rumor/pending/
upcoming IPOs have no security_reference row and no firm ticker/exchange yet. It
therefore lands in a STANDALONE event table, not a security_key-keyed one.

  - ipo_events              (ipo_key)              — one durable row per offering,
                                                     upserted in place. PK is a
                                                     COALESCE(us_code, isin, ticker)
                                                     synthesized at write time.
                                                     security_key is NULLABLE, NO FK
                                                     (the security may not exist yet);
                                                     best-effort resolved for the
                                                     IPO<->Reference cross-link only.
  - ipo_status_transitions  (ipo_key, observed_at) — append-only status-change log
                                                     (the PK-upsert keeps only current
                                                     state; this preserves the lifecycle
                                                     timeline for the detail drawer).

Changes:
  1. Create ipo_events + ipo_status_transitions.
  2. Extend the vendor_sync_jobs.feed_type CHECK to admit `ipo-refresh`.
  3. pg_cron: ipo-refresh daily 12:00 UTC (Massive updates daily; timing is loose —
     this is reference data, not a trading-day-aligned feed).

The `ipo-refresh` literal is admitted by the CHECK but NOT added to the exported
VendorSyncFeedType union (worker casts at the boundary — same convention as the
security-reference-* / branding-images / security-float-refresh / short-* feeds).

Bumps MIN_SCHEMA_VERSION = 2026-07-10T150000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';
import {scheduleVendorSyncCron, unscheduleVendorSyncCron} from '../vendor-sync-cron.js';

const SYSTEM_OWNER = '00000000-0000-0000-0000-000000000000.user';
const USER_FMT = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$';

const IPO_FEED = 'ipo-refresh';
const IPO_SCHEDULE = '0 12 * * *'; // daily 12:00 UTC

// Massive ipo_status enum (results[].ipo_status).
const IPO_STATUSES = [
  'direct_listing_process', 'history', 'new', 'pending', 'postponed', 'rumor', 'withdrawn',
];

const FEED_TYPES_BEFORE = [
  'equity-prices', 'options-prices', 'stock-splits-fetch', 'market-calendar',
  'ticker-info', 'ticker-ratios', 'equity-price-repair',
  'security-reference-populate', 'security-reference-refresh', 'branding-images',
  'equity-prices-plan', 'options-prices-plan', 'price-rebase-sweep',
  'security-float-refresh',
  'security-short-interest', 'security-short-volume', 'security-short-volume-plan',
];
const FEED_TYPES_AFTER = [...FEED_TYPES_BEFORE, IPO_FEED];

const checkSql = (feeds: string[]): string =>
  `feed_type IN (${feeds.map((f) => `'${f}'`).join(', ')})`;

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE ipo_events (
      ipo_key               TEXT NOT NULL,
      security_key          TEXT,
      ticker                TEXT,
      issuer_name           TEXT,
      ipo_status            TEXT NOT NULL,
      primary_exchange      TEXT,
      security_type         TEXT,
      security_description  TEXT,
      currency_code         TEXT,
      announced_date        DATE,
      issue_start_date      DATE,
      issue_end_date        DATE,
      listing_date          DATE,
      lowest_offer_price    DOUBLE PRECISION,
      highest_offer_price   DOUBLE PRECISION,
      final_issue_price     DOUBLE PRECISION,
      min_shares_offered    DOUBLE PRECISION,
      max_shares_offered    DOUBLE PRECISION,
      shares_outstanding    DOUBLE PRECISION,
      lot_size              DOUBLE PRECISION,
      total_offer_size      DOUBLE PRECISION,
      isin                  TEXT,
      us_code               TEXT,
      vendor_last_updated   DATE,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by            TEXT NOT NULL,
      updated_by            TEXT NOT NULL,
      PRIMARY KEY (ipo_key),
      CONSTRAINT ipo_events_status_chk CHECK (ipo_status IN (${IPO_STATUSES.map((s) => `'${s}'`).join(', ')})),
      CONSTRAINT ipo_events_created_by_format_chk CHECK (created_by ~ '${USER_FMT}'),
      CONSTRAINT ipo_events_updated_by_format_chk CHECK (updated_by ~ '${USER_FMT}')
    );
  `);
  pgm.sql(`CREATE INDEX ipo_events_listing_date_idx ON ipo_events (listing_date);`);
  pgm.sql(`CREATE INDEX ipo_events_status_idx ON ipo_events (ipo_status);`);
  pgm.sql(`CREATE INDEX ipo_events_security_key_idx ON ipo_events (security_key) WHERE security_key IS NOT NULL;`);
  pgm.sql(`CREATE INDEX ipo_events_ticker_idx ON ipo_events (ticker);`);
  pgm.sql(`
    CREATE TRIGGER ipo_events_set_updated_at BEFORE UPDATE ON ipo_events
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  pgm.sql(`
    CREATE TABLE ipo_status_transitions (
      ipo_key      TEXT NOT NULL,
      ipo_status   TEXT NOT NULL,
      observed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (ipo_key, observed_at),
      CONSTRAINT ipo_status_transitions_status_chk CHECK (ipo_status IN (${IPO_STATUSES.map((s) => `'${s}'`).join(', ')}))
    );
  `);
  pgm.sql(`CREATE INDEX ipo_status_transitions_ipo_key_idx ON ipo_status_transitions (ipo_key, observed_at);`);

  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_AFTER)});`);

  scheduleVendorSyncCron(pgm, IPO_FEED, IPO_SCHEDULE);
};

export const down = (pgm: MigrationBuilder): void => {
  unscheduleVendorSyncCron(pgm, IPO_FEED);

  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_BEFORE)});`);

  pgm.dropTable('ipo_status_transitions', {ifExists: true});
  pgm.sql(`DROP TRIGGER IF EXISTS ipo_events_set_updated_at ON ipo_events;`);
  pgm.dropTable('ipo_events', {ifExists: true});
};
