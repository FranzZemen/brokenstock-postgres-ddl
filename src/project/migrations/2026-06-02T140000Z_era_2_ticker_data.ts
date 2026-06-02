/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Era 2 ticker-data absorption (super-PRD v0.4.0). The single DynamoDB
 * TICKER_DATA table (PK `ticker`, SK `sk` ∈ {COMPANY_INFO, RATIOS}) normalizes
 * into two Postgres tables, one per SK category:
 *
 *   - ticker_data_company_info  (one row per ticker; CompanyInfo)
 *   - ticker_data_ratios        (one row per ticker; latest-only Ratios)
 *
 * Faithful typed-column mapping of `CompanyInfo` / `Ratios`
 * (@franzzemen/financial-identity) per `[[feedback-per-column-ddb-pg-audit]]`.
 * Every `number` field → DOUBLE PRECISION (clean JS-number round-trip, no
 * bigint coercion). Nested `CompanyInfo.address` flattened to four columns.
 * Access is PK-only (getCompanyInfo / getRatios / batchGet by ticker), so no
 * secondary indexes. No FK to securities — `ticker` is a bare vendor symbol,
 * not a `mic:ticker` securityKey (the DDB table had no such relationship).
 *
 * The Era 1 C1 `set_updated_at()` trigger function is reused.
 *
 * Pins the new MIN_SCHEMA_VERSION = 2026-06-02T140000Z (supersedes the
 * vendor_sync_jobs 130000Z migration). financial-data consumers pin to this
 * after the C3 ticker→kysely refactor.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const USER_CHK = `~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$'`;

export const up = (pgm: MigrationBuilder): void => {
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
      CONSTRAINT ticker_data_company_info_created_by_format_chk
        CHECK (created_by ${USER_CHK}),
      CONSTRAINT ticker_data_company_info_updated_by_format_chk
        CHECK (updated_by ${USER_CHK})
    );
  `);
  pgm.sql(`
    CREATE TRIGGER ticker_data_company_info_set_updated_at BEFORE UPDATE ON ticker_data_company_info
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  pgm.sql(`
    CREATE TABLE ticker_data_ratios (
      ticker                   TEXT PRIMARY KEY,
      symbol                   TEXT NOT NULL,
      cik                      TEXT,
      as_of_date               DATE NOT NULL,
      close_price              DOUBLE PRECISION NOT NULL,
      average_volume           DOUBLE PRECISION,
      market_cap               DOUBLE PRECISION,
      enterprise_value         DOUBLE PRECISION,
      earnings_per_share       DOUBLE PRECISION,
      price_to_earnings        DOUBLE PRECISION,
      price_to_book            DOUBLE PRECISION,
      price_to_sales           DOUBLE PRECISION,
      price_to_cash_flow       DOUBLE PRECISION,
      price_to_free_cash_flow  DOUBLE PRECISION,
      ev_to_sales              DOUBLE PRECISION,
      ev_to_ebitda             DOUBLE PRECISION,
      return_on_assets         DOUBLE PRECISION,
      return_on_equity         DOUBLE PRECISION,
      current_ratio            DOUBLE PRECISION,
      quick_ratio              DOUBLE PRECISION,
      cash_ratio               DOUBLE PRECISION,
      debt_to_equity           DOUBLE PRECISION,
      dividend_yield           DOUBLE PRECISION,
      free_cash_flow           DOUBLE PRECISION,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by               TEXT NOT NULL,
      updated_by               TEXT NOT NULL,
      CONSTRAINT ticker_data_ratios_created_by_format_chk
        CHECK (created_by ${USER_CHK}),
      CONSTRAINT ticker_data_ratios_updated_by_format_chk
        CHECK (updated_by ${USER_CHK})
    );
  `);
  pgm.sql(`
    CREATE TRIGGER ticker_data_ratios_set_updated_at BEFORE UPDATE ON ticker_data_ratios
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS ticker_data_ratios_set_updated_at ON ticker_data_ratios;`);
  pgm.dropTable('ticker_data_ratios');
  pgm.sql(`DROP TRIGGER IF EXISTS ticker_data_company_info_set_updated_at ON ticker_data_company_info;`);
  pgm.dropTable('ticker_data_company_info');
};
