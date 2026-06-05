/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Era 3 C4 (2026-06-05) — TRANSACTIONS. The hinge table: brokerage_records feed
 * it (origin_record_id), and cash_entry (D10) + trades (D8) hang off it.
 * Refactors @franzzemen/transactions off DDB. See era-3-c04-transactions.prd.md.
 *
 * Decisions (T-a…T-e, Franz 2026-06-05):
 *  - PK transaction_id = app-minted TransactionUUID `<uuid>.transaction`
 *    (getTransactionUUID; CHECK mirrors TRANSACTION_UUID_REGEX). TEXT, no default.
 *  - brokerage/account DENORMALIZED onto the row (T-d revised) — transactions is
 *    query-hot; account_id FK is ALSO kept. No JOIN on read.
 *  - origin polymorphism split (D9): origin_record_id → brokerage_records(record_id)
 *    is a REAL FK now (nullable; set for origin='import'); origin_transfer_event_id
 *    is a nullable column with NO FK (transfer_events lands node #7).
 *  - trade membership (D8): trade_id / sub_trade_ndx / ordinal_position are columns
 *    now, NO FK (trades land node #6; written by the trades domain, not this API).
 *  - 7 money/size fields → NUMERIC; transactionEpoch/paidTransactionEpoch/createdEpoch
 *    → TIMESTAMPTZ; tradingDate/lastSplitDate → DATE.
 *  - Enums CHECK-enforced only for the small/stable sets (brokerage, currency,
 *    origin, action_type). action/security_type/alias_type/mic/country_code are
 *    plain TEXT (large/evolving; app-validated by validateTransaction).
 *  - ALSO: ALTER cash_entry ADD transaction_id (FK → transactions) — D10, unblocks
 *    cash writes (node #5).
 *
 * DEV-T6 (resolved, Franz 2026-06-05): security_key is NOT NULL plain TEXT, NO
 *   securities FK — `Unknown:<TICKER>` keys are intentionally absent from
 *   `securities` (and we don't want them there), so a real FK would orphan at
 *   re-import (cutover-gotcha #3). App-validated; kept an index for joins.
 *
 * Nullability per parser audit (Franz 2026-06-05): alias_type / brokerage_alias /
 *   underlying_symbol are ALWAYS set at creation in every parser → NOT NULL;
 *   underlying_exchange / country_code (convert* may return undefined) → nullable.
 *   (The Transaction VALIDATION schema omits alias_type/underlying_exchange/
 *   country_code — likely a defect in financial-identity; flagged, not fixed here.)
 *
 * Pins MIN_SCHEMA_VERSION = 2026-06-05T120000Z.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ACTOR_CHK = `~ '^${UUID_RE}\\.(user|brokenstock)$'`;
const OWNER_CHK = `~ '^${UUID_RE}\\.user$'`;
const TXN_ID_CHK = `~ '^${UUID_RE}\\.transaction$'`;

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE transactions (
      transaction_id            TEXT PRIMARY KEY,
      owner                     TEXT NOT NULL,
      account_id                TEXT NOT NULL REFERENCES brokerage_accounts(account_id),
      brokerage                 TEXT NOT NULL,
      account                   TEXT NOT NULL,
      transaction_date          TIMESTAMPTZ NOT NULL,
      trading_date              DATE NOT NULL,
      paid_transaction_date     TIMESTAMPTZ,
      last_split_date           DATE NOT NULL,
      security_key              TEXT NOT NULL,
      alias_type                TEXT NOT NULL,
      mic                       TEXT NOT NULL,
      symbol                    TEXT NOT NULL,
      brokerage_alias           TEXT NOT NULL,
      underlying_symbol         TEXT NOT NULL,
      underlying_exchange       TEXT,
      country_code              TEXT,
      security_type             TEXT NOT NULL,
      action                    TEXT NOT NULL,
      action_type               TEXT NOT NULL,
      quantity                  NUMERIC NOT NULL,
      price                     NUMERIC NOT NULL,
      parsed_quantity           NUMERIC NOT NULL,
      parsed_price              NUMERIC NOT NULL,
      commission                NUMERIC NOT NULL,
      fees                      NUMERIC NOT NULL,
      amount                    NUMERIC NOT NULL,
      currency                  TEXT NOT NULL,
      origin                    TEXT NOT NULL,
      origin_name               TEXT NOT NULL,
      origin_record_id          TEXT REFERENCES brokerage_records(record_id),
      origin_transfer_event_id  TEXT,
      brokerage_unique_identifier TEXT,
      transfer_counterparty_hint  TEXT,
      trade_id                  TEXT,
      sub_trade_ndx             INTEGER,
      ordinal_position          INTEGER,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by                TEXT NOT NULL,
      updated_by                TEXT NOT NULL,
      CONSTRAINT transactions_transaction_id_format_chk CHECK (transaction_id ${TXN_ID_CHK}),
      CONSTRAINT transactions_owner_format_chk CHECK (owner ${OWNER_CHK}),
      CONSTRAINT transactions_brokerage_chk
        CHECK (brokerage IN ('Unknown', 'Fidelity', 'IBKR', 'Schwab')),
      CONSTRAINT transactions_action_type_chk
        CHECK (action_type IN ('Opening', 'Closing', 'Unary', 'NonShareBasedUnary', 'Unknown')),
      CONSTRAINT transactions_currency_chk CHECK (currency IN ('USD', 'EUR')),
      CONSTRAINT transactions_origin_chk CHECK (origin IN ('import', 'manual', 'transfer-event')),
      CONSTRAINT transactions_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT transactions_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);

  // Indexes — honor the DDB access patterns (PRD §4).
  pgm.createIndex('transactions', ['owner', 'account_id'], {name: 'transactions_owner_account_idx'});
  pgm.createIndex('transactions', ['owner', 'origin_name'], {name: 'transactions_owner_origin_name_idx'});
  pgm.createIndex('transactions', ['owner', 'symbol'], {name: 'transactions_owner_symbol_idx'});
  pgm.createIndex('transactions', ['owner', 'transaction_date'], {name: 'transactions_owner_txn_date_idx'});
  pgm.createIndex('transactions', ['owner', 'brokerage', 'account'], {name: 'transactions_owner_brokerage_account_idx'});
  pgm.createIndex('transactions', ['owner', 'brokerage_unique_identifier'], {name: 'transactions_owner_buid_idx'});
  pgm.createIndex('transactions', ['security_key'], {name: 'transactions_security_key_idx'});
  pgm.createIndex('transactions', ['origin_record_id'], {name: 'transactions_origin_record_id_idx'});
  // Trade membership lookup (partial — most rows are non-trade/cash until trades build).
  pgm.createIndex('transactions', ['trade_id'], {name: 'transactions_trade_id_idx', where: 'trade_id IS NOT NULL'});

  pgm.sql(`
    CREATE TRIGGER transactions_set_updated_at BEFORE UPDATE ON transactions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // D10 — cash_entry.transaction_id FK → transactions (deferred from C3, added now).
  pgm.sql(`
    ALTER TABLE cash_entry ADD COLUMN transaction_id TEXT REFERENCES transactions(transaction_id);
  `);
  pgm.createIndex('cash_entry', ['transaction_id'], {name: 'cash_entry_transaction_id_idx'});
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP INDEX IF EXISTS cash_entry_transaction_id_idx;`);
  pgm.sql(`ALTER TABLE cash_entry DROP COLUMN IF EXISTS transaction_id;`);
  pgm.sql(`DROP TRIGGER IF EXISTS transactions_set_updated_at ON transactions;`);
  pgm.dropTable('transactions');
};
