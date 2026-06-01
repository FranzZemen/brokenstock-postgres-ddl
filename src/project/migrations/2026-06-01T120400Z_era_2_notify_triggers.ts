/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Era 2 NOTIFY trigger functions + triggers. One trigger function per
 * data-bearing entity (per D2 — self-documenting, per-entity). Fires on
 * AFTER INSERT OR UPDATE OR DELETE (per D8 — deletes matter for cache
 * correctness). Payload is the entity's composite key as a pipe-joined
 * string (per D13). Channel names are kebab-case past-tense (per D10).
 *
 * NO NOTIFY on stock_splits_coverage or market_calendar — those tables hold
 * operational/refresh metadata that no L5 cache consumes.
 *
 * This file's timestamp (2026-06-01T120400Z) is the MIN_SCHEMA_VERSION
 * consumers (Era 2 C3 domain packages, Era 2 C4 vendor-sync-worker) pin
 * against to enforce expand-contract discipline at startup + deploy.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION notify_security_changed() RETURNS trigger AS $$
    DECLARE
      payload TEXT;
    BEGIN
      payload := COALESCE(NEW.key, OLD.key);
      PERFORM pg_notify('security-changed', payload);
      RETURN COALESCE(NEW, OLD);
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER securities_notify
      AFTER INSERT OR UPDATE OR DELETE ON securities
      FOR EACH ROW EXECUTE FUNCTION notify_security_changed();
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION notify_security_alias_changed() RETURNS trigger AS $$
    DECLARE
      payload TEXT;
    BEGIN
      payload := COALESCE(NEW.alias_type, OLD.alias_type) || '|' || COALESCE(NEW.alias, OLD.alias);
      PERFORM pg_notify('security-alias-changed', payload);
      RETURN COALESCE(NEW, OLD);
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER security_aliases_notify
      AFTER INSERT OR UPDATE OR DELETE ON security_aliases
      FOR EACH ROW EXECUTE FUNCTION notify_security_alias_changed();
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION notify_stock_split_changed() RETURNS trigger AS $$
    DECLARE
      payload TEXT;
    BEGIN
      payload := COALESCE(NEW.security_key, OLD.security_key) || '|' ||
                 to_char(COALESCE(NEW.effective_date, OLD.effective_date), 'YYYY-MM-DD');
      PERFORM pg_notify('stock-split-changed', payload);
      RETURN COALESCE(NEW, OLD);
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER stock_splits_notify
      AFTER INSERT OR UPDATE OR DELETE ON stock_splits
      FOR EACH ROW EXECUTE FUNCTION notify_stock_split_changed();
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION notify_market_calendar_holiday_changed() RETURNS trigger AS $$
    DECLARE
      payload TEXT;
    BEGIN
      payload := COALESCE(NEW.mic, OLD.mic) || '|' ||
                 to_char(COALESCE(NEW.holiday_date, OLD.holiday_date), 'YYYY-MM-DD');
      PERFORM pg_notify('market-calendar-holiday-changed', payload);
      RETURN COALESCE(NEW, OLD);
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER market_calendar_holidays_notify
      AFTER INSERT OR UPDATE OR DELETE ON market_calendar_holidays
      FOR EACH ROW EXECUTE FUNCTION notify_market_calendar_holiday_changed();
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION notify_equity_price_changed() RETURNS trigger AS $$
    DECLARE
      payload TEXT;
    BEGIN
      payload := COALESCE(NEW.security_key, OLD.security_key) || '|' ||
                 to_char(COALESCE(NEW.closing_date, OLD.closing_date), 'YYYY-MM-DD');
      PERFORM pg_notify('equity-price-changed', payload);
      RETURN COALESCE(NEW, OLD);
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER prices_equity_notify
      AFTER INSERT OR UPDATE OR DELETE ON prices_equity
      FOR EACH ROW EXECUTE FUNCTION notify_equity_price_changed();
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION notify_option_price_changed() RETURNS trigger AS $$
    DECLARE
      payload TEXT;
    BEGIN
      payload := COALESCE(NEW.security_key, OLD.security_key) || '|' ||
                 to_char(COALESCE(NEW.expiration_date, OLD.expiration_date), 'YYYY-MM-DD') || '|' ||
                 COALESCE(NEW.strike, OLD.strike)::TEXT || '|' ||
                 COALESCE(NEW.call_put, OLD.call_put) || '|' ||
                 to_char(COALESCE(NEW.closing_date, OLD.closing_date), 'YYYY-MM-DD');
      PERFORM pg_notify('option-price-changed', payload);
      RETURN COALESCE(NEW, OLD);
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER prices_options_notify
      AFTER INSERT OR UPDATE OR DELETE ON prices_options
      FOR EACH ROW EXECUTE FUNCTION notify_option_price_changed();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS prices_options_notify ON prices_options;
    DROP FUNCTION IF EXISTS notify_option_price_changed();

    DROP TRIGGER IF EXISTS prices_equity_notify ON prices_equity;
    DROP FUNCTION IF EXISTS notify_equity_price_changed();

    DROP TRIGGER IF EXISTS market_calendar_holidays_notify ON market_calendar_holidays;
    DROP FUNCTION IF EXISTS notify_market_calendar_holiday_changed();

    DROP TRIGGER IF EXISTS stock_splits_notify ON stock_splits;
    DROP FUNCTION IF EXISTS notify_stock_split_changed();

    DROP TRIGGER IF EXISTS security_aliases_notify ON security_aliases;
    DROP FUNCTION IF EXISTS notify_security_alias_changed();

    DROP TRIGGER IF EXISTS securities_notify ON securities;
    DROP FUNCTION IF EXISTS notify_security_changed();
  `);
};
