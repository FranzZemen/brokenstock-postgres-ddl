/*
Era 5 — `equity-price-changed` per-row NOTIFY suppression guard.

`prices_equity_notify` fires `notify_equity_price_changed()` FOR EACH ROW, emitting
one `pg_notify('equity-price-changed', '<securityKey>|<closingDate>')` per row. That
is correct for ordinary 1-row price writes, but import-time split adjustment rewrites
a security's ENTIRE pre-effective history in one bulk upsert (a reverse split on a
security with ~3-4y of daily bars = ~1000-1500 rows). That fired ~1500 individual
pg_notify calls per security — measured ~0.85ms/row, ~3.2s of an import's ~3.5s
`processStage-adjust-splits` (trace analysis 2026-06-12).

Fix: guard the per-row notify behind a session GUC. When
`app.suppress_equity_price_notify = 'on'` (set via `SET LOCAL` for the bulk
split-adjust transaction in financial-data's `splitAdjustBars`), the trigger skips
the per-row emit; the application then sends ONE coalesced
`pg_notify('equity-price-changed', '<securityKey>|*')` whose `|*` wildcard the
PriceCache subscriber maps to a prefix invalidation of that security's bars.

`current_setting(name, true)` is missing-ok (returns NULL when unset), so when the GUC
is not set the guard is false and notify fires exactly as before — no behaviour change
on the ordinary write path.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
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
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  // Restore the unguarded per-row notify (pre-guard behaviour).
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
  `);
};
