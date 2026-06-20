/*
Created by Franz Zemen
License Type: UNLICENSED

Era 6 / C01 — Reference Enrichment schema (super-PRD D1–D18).

First post-migration FEATURE migration (the DDB→PG migration completed + went
live 2026-06-10). Promotes the Era-2 ticker-data company-info surface into a
SECURITY-CENTRIC reference model anchored to securities(key):

  - DROP ticker_data_company_info        (re-key target; bare-ticker PK, no FK)
  - CREATE security_reference            (PK security_key → FK securities; ticker/mic denormalized)
  - CREATE security_related_companies    (/v1/related-companies — order-ranked peers, no score)
  - CREATE security_transitions          (/vX/.../events — same-entity ticker_change; rename-only v1)

Design notes:
  * NO PG→PG data migration (D4): security_reference is repopulated from the
    vendor by the Era-6 populate batch, not migrated row-by-row. The drop is
    safe — the only code touching ticker_data_company_info is financial-data's
    TickerDataTrustedApi (refactored in C3) + its test, and no live serving
    path invokes it (the vendor-sync ticker-info handler is a stub). The
    prod_blue apply of this migration is coordinated with the C3 financial-data
    refactor + C4 worker deploy, and is operator-gated (the table DROP is the
    one irreversible step).
  * Nullable-heavy (D15): everything vendor-provided is NULLABLE except identity
    (security_key/ticker/mic) and active. The redundant `symbol` +
    `primary_exchange` columns the old table carried are dropped (ticker + mic
    are denormalized from the security). Raw vendor type kept as `vendor_type`;
    the mapped SecurityType lives on securities.asset_class, not duplicated here.
  * vendor_last_updated_utc (D16): renamed from Massive `last_updated_utc` (the
    LIST endpoint's freshness marker) so it never collides with our own
    `updated_at` record-audit column. Drives the monthly delta refresh (D7).
  * Numeric facts → DOUBLE PRECISION (clean JS-number round-trip, matching the
    Era-2 ticker_data convention). DATE = list_date; TIMESTAMPTZ = delisted_utc,
    vendor_last_updated_utc.
  * Actor CHECK = relaxed (user|brokenstock) — the vendor batch writes as a
    system actor (Era-2/3 lesson).

Pins MIN_SCHEMA_VERSION = 2026-06-20T120000Z (supersedes 2026-06-19T130000Z).
financial-data (C3) pins to this DDL minor after its refactor.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ACTOR_CHK = `~ '^${UUID_RE}\\.(user|brokenstock)$'`;

export const up = (pgm: MigrationBuilder): void => {
  // ── Drop the re-key target (D3/D4). Nothing in a live serving path reads it. ──
  pgm.sql(`DROP TRIGGER IF EXISTS ticker_data_company_info_set_updated_at ON ticker_data_company_info;`);
  pgm.sql(`DROP TABLE IF EXISTS ticker_data_company_info;`);

  // ── security_reference — 1:1 with security; company overview body ──
  pgm.sql(`
    CREATE TABLE security_reference (
      security_key                 TEXT PRIMARY KEY REFERENCES securities(key) ON DELETE RESTRICT,
      ticker                       TEXT NOT NULL,           -- denormalized from security
      mic                          TEXT NOT NULL,           -- denormalized from security
      vendor_type                  TEXT,                    -- raw Massive code ('CS','ADRC',…); mapped type = securities.asset_class
      vendor_last_updated_utc      TIMESTAMPTZ,             -- Massive last_updated_utc (LIST); drives delta refresh
      active                       BOOLEAN NOT NULL DEFAULT true,
      name                         TEXT,
      description                  TEXT,
      market                       TEXT,
      locale                       TEXT,
      currency                     TEXT,
      cik                          TEXT,
      composite_figi               TEXT,
      share_class_figi             TEXT,
      sic_code                     TEXT,
      sic_description              TEXT,
      industry                     TEXT,
      total_employees              DOUBLE PRECISION,
      list_date                    DATE,
      market_cap                   DOUBLE PRECISION,
      shares_outstanding           DOUBLE PRECISION,        -- Massive share_class_shares_outstanding
      weighted_shares_outstanding  DOUBLE PRECISION,
      round_lot                    DOUBLE PRECISION,
      ceo                          TEXT,
      fiscal_year_end              TEXT,
      homepage_url                 TEXT,
      phone_number                 TEXT,
      address_line1                TEXT,
      address_city                 TEXT,
      address_state                TEXT,
      address_postal_code          TEXT,
      icon_url                     TEXT,
      logo_url                     TEXT,
      ticker_root                  TEXT,
      ticker_suffix                TEXT,
      delisted_utc                 TIMESTAMPTZ,
      created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by                   TEXT NOT NULL,
      updated_by                   TEXT NOT NULL,
      CONSTRAINT security_reference_market_chk
        CHECK (market IS NULL OR market IN ('stocks', 'crypto', 'fx', 'otc', 'indices')),
      CONSTRAINT security_reference_locale_chk
        CHECK (locale IS NULL OR locale IN ('us', 'global')),
      CONSTRAINT security_reference_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT security_reference_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  pgm.sql(`CREATE INDEX security_reference_ticker_idx ON security_reference (ticker);`);
  pgm.sql(`CREATE INDEX security_reference_active_idx ON security_reference (active) WHERE active;`);
  pgm.sql(`
    CREATE TRIGGER security_reference_set_updated_at BEFORE UPDATE ON security_reference
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── security_related_companies — peer tickers (order-ranked, no score) ──
  // related_security_key is best-effort (D6): resolved only when we hold it and
  // it's unambiguous across MICs; otherwise NULL with the ticker string retained.
  pgm.sql(`
    CREATE TABLE security_related_companies (
      security_key          TEXT NOT NULL REFERENCES securities(key) ON DELETE CASCADE,
      related_ticker        TEXT NOT NULL,
      related_security_key  TEXT REFERENCES securities(key) ON DELETE SET NULL,
      ordinal               INTEGER,                 -- array index = the only relevance signal
      refreshed_at          TIMESTAMPTZ,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by            TEXT NOT NULL,
      updated_by            TEXT NOT NULL,
      PRIMARY KEY (security_key, related_ticker),
      CONSTRAINT security_related_companies_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT security_related_companies_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  pgm.sql(`CREATE INDEX security_related_companies_related_ticker_idx ON security_related_companies (related_ticker);`);
  pgm.sql(`
    CREATE TRIGGER security_related_companies_set_updated_at BEFORE UPDATE ON security_related_companies
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── security_transitions — same-entity ticker_change history (rename-only v1, D10) ──
  // One row per consecutive change (A→B→C = 2 rows). from/to security keys are
  // best-effort (the old symbol is usually delisted → not held → NULL FK).
  pgm.sql(`
    CREATE TABLE security_transitions (
      security_key       TEXT NOT NULL REFERENCES securities(key) ON DELETE CASCADE,
      effective_date     DATE NOT NULL,
      from_ticker        TEXT,
      to_ticker          TEXT,
      from_security_key  TEXT REFERENCES securities(key) ON DELETE SET NULL,
      to_security_key    TEXT REFERENCES securities(key) ON DELETE SET NULL,
      transition_type    TEXT NOT NULL DEFAULT 'ticker_change',
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by         TEXT NOT NULL,
      updated_by         TEXT NOT NULL,
      PRIMARY KEY (security_key, effective_date),
      CONSTRAINT security_transitions_type_chk CHECK (transition_type IN ('ticker_change')),
      CONSTRAINT security_transitions_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT security_transitions_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  pgm.sql(`CREATE INDEX security_transitions_from_ticker_idx ON security_transitions (from_ticker);`);
  pgm.sql(`CREATE INDEX security_transitions_to_ticker_idx ON security_transitions (to_ticker);`);
  pgm.sql(`
    CREATE TRIGGER security_transitions_set_updated_at BEFORE UPDATE ON security_transitions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS security_transitions_set_updated_at ON security_transitions;`);
  pgm.dropTable('security_transitions', {ifExists: true});
  pgm.sql(`DROP TRIGGER IF EXISTS security_related_companies_set_updated_at ON security_related_companies;`);
  pgm.dropTable('security_related_companies', {ifExists: true});
  pgm.sql(`DROP TRIGGER IF EXISTS security_reference_set_updated_at ON security_reference;`);
  pgm.dropTable('security_reference', {ifExists: true});

  // Recreate ticker_data_company_info (Era-2 shape) for reversibility.
  pgm.sql(`
    CREATE TABLE ticker_data_company_info (
      ticker                       TEXT PRIMARY KEY,
      symbol                       TEXT NOT NULL,
      name                         TEXT NOT NULL,
      primary_exchange             TEXT NOT NULL,
      active                       BOOLEAN NOT NULL,
      market                       TEXT NOT NULL,
      description                  TEXT,
      type                         TEXT,
      locale                       TEXT,
      currency                     TEXT,
      cik                          TEXT,
      composite_figi               TEXT,
      share_class_figi             TEXT,
      sic_code                     TEXT,
      sic_description              TEXT,
      industry                     TEXT,
      total_employees              DOUBLE PRECISION,
      list_date                    DATE,
      market_cap                   DOUBLE PRECISION,
      shares_outstanding           DOUBLE PRECISION,
      weighted_shares_outstanding  DOUBLE PRECISION,
      round_lot                    DOUBLE PRECISION,
      ceo                          TEXT,
      fiscal_year_end              TEXT,
      homepage_url                 TEXT,
      phone_number                 TEXT,
      address_line1                TEXT,
      address_city                 TEXT,
      address_state                TEXT,
      address_postal_code          TEXT,
      icon_url                     TEXT,
      logo_url                     TEXT,
      ticker_root                  TEXT,
      ticker_suffix                TEXT,
      delisted_utc                 TIMESTAMPTZ,
      created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by                   TEXT NOT NULL,
      updated_by                   TEXT NOT NULL,
      CONSTRAINT ticker_data_company_info_market_chk
        CHECK (market IN ('stocks', 'crypto', 'fx', 'otc', 'indices')),
      CONSTRAINT ticker_data_company_info_locale_chk
        CHECK (locale IS NULL OR locale IN ('us', 'global')),
      CONSTRAINT ticker_data_company_info_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT ticker_data_company_info_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  pgm.sql(`
    CREATE TRIGGER ticker_data_company_info_set_updated_at BEFORE UPDATE ON ticker_data_company_info
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};
