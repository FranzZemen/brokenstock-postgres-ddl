/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Era 3 C5 (2026-06-05) — TRADES / TRADE GRAPH (DAG node #6). The terminal node
 * of the import vertical: consumes `transactions` and stamps trade membership
 * back onto them (D8). Refactors @franzzemen/trades off DDB.
 * See era-3-c05-trades.prd.md.
 *
 * Tables created: trades, sub_trades, trade_journal_entries.
 * Plus ALTER transactions: real trade_id FK + composite membership index.
 *
 * Decisions (TR-1…TR-7, Franz 2026-06-05):
 *  - TR-1 NO `trade_origins` table — "trades for an origin" is derived from
 *    transactions.origin_name + trade_id (D8 made the xref redundant).
 *  - TR-2 opened_epoch / closed_epoch = BIGINT, NOT timestamptz. They carry
 *    Number.MIN_SAFE_INTEGER (open/unknown) and Number.MAX_SAFE_INTEGER (not
 *    closed) sentinels that timestamptz cannot represent; the trade-build matcher
 *    compares `=== MAX_SAFE_INTEGER` directly. (The audit epochs created/updated
 *    still go TIMESTAMPTZ + trigger as everywhere else.)
 *  - TR-3 brokerage/account DENORMALIZED onto trades + sub_trades (query-hot, like
 *    transactions T-d); account_id FK kept for integrity + cascade.
 *  - TR-4 security_key plain TEXT, NO securities FK (DEV-T6: Unknown:<TICKER>
 *    intentionally absent from securities; would orphan at re-import).
 *  - TR-5 transactions.trade_id FK → trades ON DELETE RESTRICT (transactions are
 *    NOT owned by a trade; the domain clears membership before deleting the trade
 *    row, as the DDB code already does). sub_trades.trade_id FK ON DELETE CASCADE
 *    (sub-trades ARE owned). trade_journal_entries.transaction_id FK ON DELETE
 *    CASCADE.
 *  - TR-6 journal timestamp stored verbatim: timestamp TEXT (ISO) + timestamp_epoch
 *    BIGINT (immutable), mirroring DDB.
 *  - TR-7 open_positions = NUMERIC (net sum of fractional quantities; Number() on read).
 *
 * D8 wiring: trade_transaction_refs + sub_trade.transactionUuids[] are DROPPED
 *   (no DDB→PG table). Membership lives as transactions(trade_id, sub_trade_ndx,
 *   ordinal_position) — already columns from node #4; this migration adds the real
 *   trade_id FK + the composite reverse-lookup index. TRADE_YIELDS_REFS retired (E18).
 *
 * Pins MIN_SCHEMA_VERSION = 2026-06-05T130000Z.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ACTOR_CHK = `~ '^${UUID_RE}\\.(user|brokenstock)$'`;
const OWNER_CHK = `~ '^${UUID_RE}\\.user$'`;
const TRADE_ID_CHK = `~ '^${UUID_RE}\\.trade$'`;
const SUB_TRADE_ID_CHK = `~ '^${UUID_RE}\\.sub-trade$'`;
const JOURNAL_ID_CHK = `~ '^${UUID_RE}\\.trade-journal-entry$'`;

const BROKERAGE_CHK = `CHECK (brokerage IN ('Unknown', 'Fidelity', 'IBKR', 'Schwab'))`;
const STATUS_CHK = `CHECK (status IN ('Open', 'Closed', 'Open Imbalance'))`;

export const up = (pgm: MigrationBuilder): void => {
  // ----- trades -----
  pgm.sql(`
    CREATE TABLE trades (
      trade_id          TEXT PRIMARY KEY,
      owner             TEXT NOT NULL,
      account_id        TEXT NOT NULL REFERENCES brokerage_accounts(account_id),
      brokerage         TEXT NOT NULL,
      account           TEXT NOT NULL,
      symbol_partition  TEXT NOT NULL,
      symbol            TEXT NOT NULL,
      security_key      TEXT NOT NULL,
      status            TEXT NOT NULL,
      sealed            BOOLEAN NOT NULL DEFAULT false,
      opened_epoch      BIGINT NOT NULL,
      closed_epoch      BIGINT NOT NULL,
      open_positions    NUMERIC NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by        TEXT NOT NULL,
      updated_by        TEXT NOT NULL,
      CONSTRAINT trades_trade_id_format_chk CHECK (trade_id ${TRADE_ID_CHK}),
      CONSTRAINT trades_owner_format_chk CHECK (owner ${OWNER_CHK}),
      CONSTRAINT trades_brokerage_chk ${BROKERAGE_CHK},
      CONSTRAINT trades_status_chk ${STATUS_CHK},
      CONSTRAINT trades_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT trades_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  // Access patterns (DDB LSIs → PG indexes; accountPartition reconstructed as (brokerage,account)).
  pgm.createIndex('trades', ['owner'], {name: 'trades_owner_idx'});
  pgm.createIndex('trades', ['owner', 'brokerage'], {name: 'trades_owner_brokerage_idx'});
  pgm.createIndex('trades', ['owner', 'brokerage', 'account'], {name: 'trades_owner_brokerage_account_idx'});
  pgm.createIndex('trades', ['owner', 'symbol_partition'], {name: 'trades_owner_symbol_partition_idx'});
  pgm.createIndex('trades', ['owner', 'symbol'], {name: 'trades_owner_symbol_idx'});
  pgm.createIndex('trades', ['security_key'], {name: 'trades_security_key_idx'});
  pgm.sql(`
    CREATE TRIGGER trades_set_updated_at BEFORE UPDATE ON trades
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ----- sub_trades -----
  pgm.sql(`
    CREATE TABLE sub_trades (
      sub_trade_id      TEXT PRIMARY KEY,
      trade_id          TEXT NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
      owner             TEXT NOT NULL,
      account_id        TEXT NOT NULL REFERENCES brokerage_accounts(account_id),
      brokerage         TEXT NOT NULL,
      account           TEXT NOT NULL,
      ndx               INTEGER NOT NULL,
      partition         TEXT NOT NULL,
      symbol            TEXT NOT NULL,
      security_key      TEXT NOT NULL,
      security_type     TEXT NOT NULL,
      status            TEXT NOT NULL,
      opened_epoch      BIGINT NOT NULL,
      closed_epoch      BIGINT NOT NULL,
      open_positions    NUMERIC NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by        TEXT NOT NULL,
      updated_by        TEXT NOT NULL,
      CONSTRAINT sub_trades_sub_trade_id_format_chk CHECK (sub_trade_id ${SUB_TRADE_ID_CHK}),
      CONSTRAINT sub_trades_owner_format_chk CHECK (owner ${OWNER_CHK}),
      CONSTRAINT sub_trades_brokerage_chk ${BROKERAGE_CHK},
      CONSTRAINT sub_trades_status_chk ${STATUS_CHK},
      CONSTRAINT sub_trades_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT sub_trades_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK}),
      CONSTRAINT sub_trades_trade_id_ndx_uq UNIQUE (trade_id, ndx)
    );
  `);
  pgm.createIndex('sub_trades', ['trade_id'], {name: 'sub_trades_trade_id_idx'});
  pgm.createIndex('sub_trades', ['owner'], {name: 'sub_trades_owner_idx'});
  pgm.createIndex('sub_trades', ['owner', 'brokerage', 'account'], {name: 'sub_trades_owner_brokerage_account_idx'});
  pgm.sql(`
    CREATE TRIGGER sub_trades_set_updated_at BEFORE UPDATE ON sub_trades
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ----- trade_journal_entries -----
  pgm.sql(`
    CREATE TABLE trade_journal_entries (
      journal_entry_id  TEXT PRIMARY KEY,
      transaction_id    TEXT NOT NULL REFERENCES transactions(transaction_id) ON DELETE CASCADE,
      owner             TEXT NOT NULL,
      title             TEXT NOT NULL,
      timestamp         TEXT NOT NULL,
      timestamp_epoch   BIGINT NOT NULL,
      journal_entry     TEXT NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by        TEXT NOT NULL,
      updated_by        TEXT NOT NULL,
      CONSTRAINT trade_journal_entries_id_format_chk CHECK (journal_entry_id ${JOURNAL_ID_CHK}),
      CONSTRAINT trade_journal_entries_owner_format_chk CHECK (owner ${OWNER_CHK}),
      CONSTRAINT trade_journal_entries_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT trade_journal_entries_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  pgm.createIndex('trade_journal_entries', ['transaction_id'], {name: 'trade_journal_entries_transaction_id_idx'});
  pgm.createIndex('trade_journal_entries', ['owner'], {name: 'trade_journal_entries_owner_idx'});
  pgm.sql(`
    CREATE TRIGGER trade_journal_entries_set_updated_at BEFORE UPDATE ON trade_journal_entries
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ----- D8 wiring on transactions: real trade_id FK + composite membership index -----
  // The columns trade_id / sub_trade_ndx / ordinal_position already exist (node #4,
  // nullable, no FK). Add the FK now that `trades` exists; RESTRICT because
  // transactions outlive trades (domain clears membership before deleting a trade).
  pgm.sql(`
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_trade_id_fkey
        FOREIGN KEY (trade_id) REFERENCES trades(trade_id) ON DELETE RESTRICT,
      ADD CONSTRAINT transactions_trade_id_format_chk
        CHECK (trade_id IS NULL OR trade_id ${TRADE_ID_CHK});
  `);
  // Replace the node-#4 single-column partial index with the composite reverse-lookup
  // that trade_transaction_refs used to serve ("transactions of trade X / sub-trade (X,n)").
  pgm.sql(`DROP INDEX IF EXISTS transactions_trade_id_idx;`);
  pgm.createIndex(
    'transactions',
    ['trade_id', 'sub_trade_ndx', 'ordinal_position'],
    {name: 'transactions_trade_membership_idx', where: 'trade_id IS NOT NULL'},
  );
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP INDEX IF EXISTS transactions_trade_membership_idx;`);
  pgm.sql(`
    ALTER TABLE transactions
      DROP CONSTRAINT IF EXISTS transactions_trade_id_format_chk,
      DROP CONSTRAINT IF EXISTS transactions_trade_id_fkey;
  `);
  // Restore the node-#4 partial single-column index.
  pgm.createIndex('transactions', ['trade_id'], {name: 'transactions_trade_id_idx', where: 'trade_id IS NOT NULL'});

  pgm.sql(`DROP TRIGGER IF EXISTS trade_journal_entries_set_updated_at ON trade_journal_entries;`);
  pgm.dropTable('trade_journal_entries');
  pgm.sql(`DROP TRIGGER IF EXISTS sub_trades_set_updated_at ON sub_trades;`);
  pgm.dropTable('sub_trades');
  pgm.sql(`DROP TRIGGER IF EXISTS trades_set_updated_at ON trades;`);
  pgm.dropTable('trades');
};
