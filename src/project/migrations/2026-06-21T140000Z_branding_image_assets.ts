/*
Created by Franz Zemen
License Type: UNLICENSED

Branding Image Ingestion (brokenstock-vendor-sync-worker/doc/prd/branding-image-ingestion.prd.md, E1).

`security_reference` already carries the raw Massive `icon_url`/`logo_url`, but those
only resolve with `?apiKey=…` appended — dead on a public page, and appending the key
client-side leaks it. The new chained `branding-images` vendor-sync feed downloads the
images server-side (in-VPC, key never leaves the worker), stores them in our own private
S3 bucket (CloudFront-fronted), and OVERWRITES `security_reference.icon_url/logo_url`
with our own public, content-hash-cache-busted URLs so the FE hero "just works".

This migration:
  1. CREATE TABLE security_branding_assets — the batch's source-of-truth + skip-gate.
     One row per (security_key, kind ∈ {icon, logo}). Tracks the vendor `source_url`
     last downloaded from, our `s3_key` + `served_url`, the `content_hash` (drives
     cache-bust + dedup), `content_type`/`bytes`, `status`, and the last `error`.
     The reference columns remain the FE read surface; this table the operational truth.
  2. Extend the vendor_sync_jobs.feed_type CHECK to admit 'branding-images'. (The feed
     is purely CHAINED off the security-reference feeds — no pg_cron schedule here.)

Skip-gate semantics (D6, enforced in financial-data, not the DB): treat
security_reference.icon_url as the vendor source pointer UNLESS it equals this row's
served_url. null→no_source; ==served_url→done; ==source_url (reference re-clobbered the
same vendor URL)→re-stamp, no download; a new vendor URL→download (reuse S3 if
content_hash unchanged). Download failure → reference column set NULL, status='failed'.

NOTE (D10): 'branding-images' is intentionally NOT added to the schema-types
VendorSyncFeedType union — the worker casts the literal at the handler boundary (same
Kysely-cascade avoidance as the Era-6 security-reference feeds). The NEW TABLE *is* added
to the Database type, which does drive the usual binder republish.

Bumps MIN_SCHEMA_VERSION = 2026-06-21T140000Z (supersedes 2026-06-21T130000Z). The
vendor-sync-worker + financial-data pin this DDL minor for the new table + feed.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ACTOR_CHK = `~ '^${UUID_RE}\\.(user|brokenstock)$'`;

// feed_type CHECK after this migration (current set + branding-images).
const FEED_TYPES_AFTER = [
  'equity-prices', 'options-prices', 'stock-splits-fetch', 'market-calendar',
  'ticker-info', 'ticker-ratios', 'equity-price-repair',
  'security-reference-populate', 'security-reference-refresh',
  'branding-images',
];
const FEED_TYPES_BEFORE = FEED_TYPES_AFTER.filter(f => f !== 'branding-images');

const checkSql = (feeds: string[]): string =>
  `feed_type IN (${feeds.map(f => `'${f}'`).join(', ')})`;

export const up = (pgm: MigrationBuilder): void => {
  // ── security_branding_assets — per-image batch state + skip-gate truth ──
  pgm.sql(`
    CREATE TABLE security_branding_assets (
      security_key   TEXT NOT NULL REFERENCES security_reference(security_key) ON DELETE CASCADE,
      kind           TEXT NOT NULL,                 -- icon | logo
      source_url     TEXT,                          -- vendor URL last downloaded from (key never stored)
      s3_key         TEXT,                          -- object key in the private branding bucket
      served_url     TEXT,                          -- our public CloudFront URL (written back to security_reference)
      content_hash   TEXT,                          -- sha256 hex of the bytes; drives cache-bust + S3 dedup
      content_type   TEXT,                          -- preserved vendor content-type (image/png, image/svg+xml, …)
      bytes          INTEGER,                       -- object size
      status         TEXT NOT NULL DEFAULT 'pending',  -- pending | stored | failed | no_source
      fetched_at     TIMESTAMPTZ,                   -- last successful download time
      error          TEXT,                          -- last failure message (status='failed')
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by     TEXT NOT NULL,
      updated_by     TEXT NOT NULL,
      PRIMARY KEY (security_key, kind),
      CONSTRAINT security_branding_assets_kind_chk   CHECK (kind IN ('icon', 'logo')),
      CONSTRAINT security_branding_assets_status_chk CHECK (status IN ('pending', 'stored', 'failed', 'no_source')),
      CONSTRAINT security_branding_assets_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT security_branding_assets_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  // domainCount ("Securities with branding stored") + status sweeps.
  pgm.sql(`CREATE INDEX security_branding_assets_status_idx ON security_branding_assets (status);`);
  pgm.sql(`
    CREATE TRIGGER security_branding_assets_set_updated_at BEFORE UPDATE ON security_branding_assets
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── admit the chained 'branding-images' feed ──
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_AFTER)});`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_BEFORE)});`);

  pgm.sql(`DROP TRIGGER IF EXISTS security_branding_assets_set_updated_at ON security_branding_assets;`);
  pgm.dropTable('security_branding_assets', {ifExists: true});
};
