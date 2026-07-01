/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * equity-price-retroactive-refresh.prd.md — E8 / D10-D13.
 *
 * transaction_split_history — a per-(transaction, split) ledger recording the
 * split factor applied to each transaction. It is the provenance + recompute
 * input for the reset-then-replay transaction split-adjustment (E9): the
 * materialized transactions.quantity/price stay the hot read path, and this
 * ledger records WHICH splits produced them, with a real FK back to the split.
 *
 * Grain: one row per (transaction, split) actually applied — a split only lands
 * a row on transactions whose trade_date < effective_date, so the table is sparse
 * (a transaction with no post-trade split has zero rows).
 *
 * FKs:
 *   - transaction_id → transactions(transaction_id) ON DELETE CASCADE.
 *       Unimport deletes transactions; their ledger rows go with them.
 *   - (security_key, effective_date) → stock_splits(security_key, effective_date)
 *       ON DELETE RESTRICT (D12). A vendor split correction/deletion must trigger
 *       an explicit recompute of affected transactions FIRST — a split row cannot
 *       be removed while it still silently backs materialized values.
 *
 * Equity-only (D13): option adjustments arrive as broker import transactions, not
 * as company-issued split factors, so they are ordinary rows with no ledger.
 *
 * Indexed both directions: PK prefix covers "splits on a transaction"; a separate
 * index on (security_key, effective_date) covers "transactions touched by split X"
 * (needed when a split is corrected/deleted to find the recompute set).
 *
 * Bumps MIN_SCHEMA_VERSION = 2026-07-01T140000Z — the E9 recompute writes here.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const OWNER_FMT = `'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$'`;

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE transaction_split_history (
      transaction_id  TEXT NOT NULL REFERENCES transactions(transaction_id) ON DELETE CASCADE,
      security_key    TEXT NOT NULL,
      effective_date  DATE NOT NULL,
      factor          DOUBLE PRECISION NOT NULL,
      applied_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by      TEXT NOT NULL,
      updated_by      TEXT NOT NULL,
      PRIMARY KEY (transaction_id, security_key, effective_date),
      CONSTRAINT transaction_split_history_split_fk
        FOREIGN KEY (security_key, effective_date)
        REFERENCES stock_splits (security_key, effective_date) ON DELETE RESTRICT,
      CONSTRAINT transaction_split_history_created_by_format_chk CHECK (created_by ~ ${OWNER_FMT}),
      CONSTRAINT transaction_split_history_updated_by_format_chk CHECK (updated_by ~ ${OWNER_FMT})
    );
  `);
  // Reverse lookup: transactions touched by a given split (correction/deletion → recompute set).
  pgm.createIndex('transaction_split_history', ['security_key', 'effective_date'], {
    name: 'transaction_split_history_split_idx',
  });
  pgm.sql(`
    CREATE TRIGGER transaction_split_history_set_updated_at BEFORE UPDATE ON transaction_split_history
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS transaction_split_history_set_updated_at ON transaction_split_history;`);
  pgm.sql(`DROP INDEX IF EXISTS transaction_split_history_split_idx;`);
  pgm.dropTable('transaction_split_history');
};
