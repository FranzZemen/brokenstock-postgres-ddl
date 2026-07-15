/*
Created by Franz Zemen
License Type: UNLICENSED

Ticker Ratios — dated history (graphable trend), E2.

`ticker_data_ratios` is latest-only (PK = ticker, every nightly write overwrites),
so a ratio's past is destroyed on each refresh and nothing can be charted. This
adds the ledger half of a cache/ledger split:

  - ticker_data_ratios          (existing) — latest-only, ONE row per ticker.
      The hot path: the Investment Scanner screens the whole ~5k universe on every
      poll and wants exactly one row per ticker. Left exactly as-is.
  - ticker_data_ratios_history  (new)      — append-only, (ticker, as_of_date).
      The ledger behind the Reference charts.

KEYED BY BARE TICKER, NOT security_key — deliberately, against the
security_short_interest / prices_equity house convention (which is
(security_key, date) + FK CASCADE). Two reasons, both measured against prod_blue
on 2026-07-14:

  1. NON-LOSSY. 602 of the 5,163 vendor ratios rows (11.7%) resolve to NO row in
     `securities`. A security_key PK with an FK would silently discard their
     history forever — including for tickers that only later get added to
     `securities`, whose past would then be unrecoverable.
  2. SEMANTICS. Massive's ratios are COMPANY-level, not listing-level. AZUL's P/E
     is one number across `XASE:AZUL` and `XNYS:AZUL`. Keying by listing would
     invent a precision the vendor's data does not carry. (Ticker→security is
     effectively 1:1 anyway: 12,698 distinct tickers over 12,702 securities; four
     collide, one of which has a ratios row.)

Consumers scoped by securityKey (Reference) derive the ticker from `MIC:TICKER`
and read by ticker. Universe screens join `securities.ticker = ratios.ticker`
(indexed below). No FK: vendor reference data must not evaporate when a security
row is deleted.

NO as_of staleness filter here or in the writer — the vendor's per-ticker
as_of_date is RAGGED (observed: 4,814 rows at 2026-05-29, 349 scattered back to
2026-04-24). A composite (ticker, as_of_date) key absorbs raggedness natively:
re-writing the same as-of is an idempotent no-op, so the ledger stays correct
with no staleness heuristic at all.

Bumps MIN_SCHEMA_VERSION = 2026-07-14T120000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const USER_FMT = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE ticker_data_ratios_history (
      ticker                   TEXT NOT NULL,
      as_of_date               DATE NOT NULL,
      symbol                   TEXT NOT NULL,
      cik                      TEXT,
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
      PRIMARY KEY (ticker, as_of_date),
      CONSTRAINT ticker_data_ratios_history_created_by_format_chk
        CHECK (created_by ~ '${USER_FMT}'),
      CONSTRAINT ticker_data_ratios_history_updated_by_format_chk
        CHECK (updated_by ~ '${USER_FMT}')
    );
  `);

  pgm.sql(`
    CREATE TRIGGER ticker_data_ratios_history_set_updated_at BEFORE UPDATE ON ticker_data_ratios_history
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // Chart reads are "one ticker, ordered by date" — the PK's leading `ticker`
  // already serves them. This index serves the other direction: "what did the
  // universe look like on date D" (as-of screens, backfill gap detection).
  pgm.sql(`CREATE INDEX ticker_data_ratios_history_as_of_date_idx ON ticker_data_ratios_history (as_of_date);`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS ticker_data_ratios_history_set_updated_at ON ticker_data_ratios_history;`);
  pgm.dropTable('ticker_data_ratios_history', {ifExists: true});
};
