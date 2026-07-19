/*
Created by Franz Zemen 2026-07-19
License Type: UNLICENSED

Retire the six Era-2 L5 cache-invalidation NOTIFY triggers.

WHY: these six channels have published into the void since 2026-06-01. They were the
publisher half of a specified L1-L5 layered cache architecture
(`projects/doc/intent/architecture-evolution.intent.md:313-334`, Era 2 C1/C2/C3). All six
L5 subscriber classes were built, tested, and closed out as complete — and NOT ONE was
ever started in any process, because the per-fleet wiring epic was never written.
`era-2-c04-vendor-sync-worker.prd.md:141` asserted that other fleets would "get
invalidations for free via the L5 LISTEN/NOTIFY chain. No special integration needed in
this worker." True of vendor-sync; nobody ever picked up the other-fleets side.

The investigation (`projects/doc/prd/l5-cache-tier-retirement.prd.md`) evaluated each of
the six domains independently and found that NONE wants invalidation-based caching:

  security-changed                 batchGetSecurities already exists
  security-alias-changed           hot path is consistentRead=true — a cache there is a
                                   CORRECTNESS REGRESSION, not an optimization
  stock-split-changed              reads ARE hot, but the fix is a batch read; a cache
                                   adds an uncommitted-read hazard (trx-scoped import
                                   reads) to save ~1 query per chunk
  market-calendar-holiday-changed  REDUNDANT — TradingCalendar already caches these
                                   288 rows on a 1h TTL. Wiring it = two caches, one
                                   dataset
  equity-price-changed             superseded by sub-trade-yield-scoping D20 — price
                                   caching is a short-TTL burst concern sited at the
                                   consumer, now live as the orchestrator's
                                   price-burst-cache
  option-price-changed             OptionsPriceCache had zero readers, and options herd
                                   factor is ~1 (a contract is normally held by exactly
                                   one trade) so no cache design would have paid

L4 (`@franzzemen/in-memory-cache`) SURVIVES and is untouched — it is the substrate the
burst cache is built on. Only the L5 tier goes.

COST IS NOT THE REASON. `pg_notify` into a channel with no listener is an in-memory
append to the transaction's pending-notify list. The ~0.85ms/row figure in
`2026-06-12T160000Z_era_5_equity_price_notify_suppress_guard.ts` was an ATTRIBUTION, not
a measurement: the trace it cites measured `processStage-adjust-splits` end-to-end, and
that same change also replaced `splitAdjustBars` with `rebaseEquityBars` (one
transaction, one bulk upsert) — a far likelier source of the win. The nightly
equity-prices feed has been writing the full ~12,000-security universe through the same
unguarded trigger every night without complaint. These triggers are being removed because
nothing consumes them, not because they were expensive.

NOT TOUCHED — the three channels that work as designed:
  vendor-sync-job-enqueued  (2026-06-02T130000Z, vendor-sync-worker dequeue loop)
  chunk_ready:<job_type>    (2026-06-03T120000Z, pg-chunked-jobs consumers)
  pg-queue channels

ADDITIVE, per expand-contract discipline: the Era-2 migration is the MIN_SCHEMA_VERSION
that consumers pin against and is NOT edited in place. Its `down` block is the template
for this `up`.

REVERSIBILITY: `down` restores the exact pre-retirement state — the five Era-2 functions
verbatim, plus the Era-5 GUC-GUARDED variant of `notify_equity_price_changed` (that
guard, not the Era-2 original, is what was live when this migration ran). Restoring the
unguarded Era-2 version here would silently undo the Era-5 change.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  // Triggers first, then their functions — a function cannot be dropped while a trigger
  // still depends on it.
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

export const down = (pgm: MigrationBuilder): void => {
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

  // NOTE: the Era-5 GUC-guarded variant, NOT the Era-2 original — see the header.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION notify_equity_price_changed() RETURNS trigger AS $$
    DECLARE
      payload TEXT;
    BEGIN
      IF current_setting('app.suppress_equity_price_notify', true) = 'on' THEN
        RETURN COALESCE(NEW, OLD);
      END IF;
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
