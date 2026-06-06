/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Era 3 C6 (2026-06-05) — TRANSFERS / intra-broker share transfers (DAG node #7).
 * Refactors @franzzemen/intra-account-transfers (iteration-2 transfer system) off
 * DynamoDB. See era-3-c06-transfers.prd.md.
 *
 * SCOPE: the iteration-2 persistence ONLY. The legacy iteration-1 transfer code in
 * @franzzemen/transactions (Transfer/TRANSFER_SHARES_TABLE/setShareTransferPrice/
 * queryTransferredByOrigin) is OUT OF SCOPE and untouched.
 *
 * Tables created: transfer_pending, transfer_events, transfer_event_lots.
 * Plus ALTER transactions: turn on the deferred origin_transfer_event_id FK (#4 left
 * it a bare nullable column).
 *
 * Decisions (XF-1…XF-10, Franz 2026-06-05):
 *  - The DDB single-table pk/sk composites + GSIs are dropped; modeled relationally.
 *  - transfer_pending PK = tx_uuid (each pending leg is 1:1 with its originating
 *    transaction; FK → transactions) (XF-2).
 *  - The event's embedded `lotPayload` blob → child table transfer_event_lots, one
 *    row per lot (XF-4). The event's `syntheticTxUuids` list is NOT stored — derived
 *    from transactions.origin_transfer_event_id (XF-3).
 *  - FK graph (XF-5): pending.tx_uuid + events.from_tx_uuid/to_tx_uuid → transactions
 *    (RESTRICT — app deletes transfer rows before the txns); lots → events CASCADE;
 *    events.lineage_parent_id → events (self, SET NULL); transactions.
 *    origin_transfer_event_id → events (RESTRICT — synthetics deleted before event).
 *  - Accounts (XF-6): the DDB `accountUuid` is the broker account identifier string
 *    (= tx.account); store it denormalized + a resolved account_id FK (transactions
 *    T-d pattern). Events carry two (from/to), both nullable.
 *  - security_key plain TEXT, NO securities FK (XF-7 / DEV-T6).
 *  - Epochs → TIMESTAMPTZ, materialized to number at the read boundary (XF-8); no
 *    sentinels here (unlike trades). original_acquisition_date → DATE (off-by-one
 *    gotcha #1, ::text read).
 *  - resolved_by is plain TEXT ('auto' OR an owner uuid — no actor CHECK) (XF-9).
 *
 * Pins MIN_SCHEMA_VERSION = 2026-06-05T140000Z.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ACTOR_CHK = `~ '^${UUID_RE}\\.(user|brokenstock)$'`;
const OWNER_CHK = `~ '^${UUID_RE}\\.user$'`;
const TXN_ID_CHK = `~ '^${UUID_RE}\\.transaction$'`;
const EVENT_ID_CHK = `~ '^${UUID_RE}\\.transfer-event$'`;

const BROKERAGE_CHK = `CHECK (broker IN ('Unknown', 'Fidelity', 'IBKR', 'Schwab'))`;

export const up = (pgm: MigrationBuilder): void => {
  // ----- transfer_pending (PK = originating transaction) -----
  pgm.sql(`
    CREATE TABLE transfer_pending (
      tx_uuid                 TEXT PRIMARY KEY REFERENCES transactions(transaction_id) ON DELETE RESTRICT,
      owner                   TEXT NOT NULL,
      account                 TEXT NOT NULL,
      account_id              TEXT NOT NULL REFERENCES brokerage_accounts(account_id),
      broker                  TEXT NOT NULL,
      security_key            TEXT NOT NULL,
      symbol                  TEXT NOT NULL,
      mic                     TEXT NOT NULL,
      direction               TEXT NOT NULL,
      tx_epoch                TIMESTAMPTZ NOT NULL,
      quantity                NUMERIC NOT NULL,
      counterparty_hint       TEXT,
      basis_from_statement    NUMERIC,
      match_blocked_reason    TEXT,
      origin_name             TEXT,
      last_match_attempt_at   TIMESTAMPTZ,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by              TEXT NOT NULL,
      updated_by              TEXT NOT NULL,
      CONSTRAINT transfer_pending_tx_uuid_format_chk CHECK (tx_uuid ${TXN_ID_CHK}),
      CONSTRAINT transfer_pending_owner_format_chk CHECK (owner ${OWNER_CHK}),
      CONSTRAINT transfer_pending_broker_chk ${BROKERAGE_CHK},
      CONSTRAINT transfer_pending_direction_chk CHECK (direction IN ('OUT', 'IN')),
      CONSTRAINT transfer_pending_match_blocked_chk
        CHECK (match_blocked_reason IS NULL OR match_blocked_reason IN
          ('awaiting-counterpart', 'insufficient-source-history', 'ambiguous-multiple-candidates')),
      CONSTRAINT transfer_pending_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT transfer_pending_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  pgm.createIndex('transfer_pending', ['owner', 'broker'], {name: 'transfer_pending_owner_broker_idx'});
  pgm.createIndex('transfer_pending', ['owner'], {name: 'transfer_pending_owner_idx'});
  pgm.createIndex('transfer_pending', ['account_id'], {name: 'transfer_pending_account_id_idx'});
  pgm.sql(`
    CREATE TRIGGER transfer_pending_set_updated_at BEFORE UPDATE ON transfer_pending
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ----- transfer_events -----
  pgm.sql(`
    CREATE TABLE transfer_events (
      transfer_event_id   TEXT PRIMARY KEY,
      owner               TEXT NOT NULL,
      broker              TEXT NOT NULL,
      security_key        TEXT NOT NULL,
      transfer_epoch      TIMESTAMPTZ NOT NULL,
      from_account        TEXT,
      from_account_id     TEXT REFERENCES brokerage_accounts(account_id),
      to_account          TEXT,
      to_account_id       TEXT REFERENCES brokerage_accounts(account_id),
      from_tx_uuid        TEXT REFERENCES transactions(transaction_id) ON DELETE RESTRICT,
      to_tx_uuid          TEXT REFERENCES transactions(transaction_id) ON DELETE RESTRICT,
      lineage_parent_id   TEXT REFERENCES transfer_events(transfer_event_id) ON DELETE SET NULL,
      resolution          TEXT NOT NULL,
      resolved_at         TIMESTAMPTZ NOT NULL,
      resolved_by         TEXT NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by          TEXT NOT NULL,
      updated_by          TEXT NOT NULL,
      CONSTRAINT transfer_events_id_format_chk CHECK (transfer_event_id ${EVENT_ID_CHK}),
      CONSTRAINT transfer_events_owner_format_chk CHECK (owner ${OWNER_CHK}),
      CONSTRAINT transfer_events_broker_chk ${BROKERAGE_CHK},
      CONSTRAINT transfer_events_resolution_chk
        CHECK (resolution IN ('matched', 'no-counterpart-user-confirmed')),
      CONSTRAINT transfer_events_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT transfer_events_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  pgm.createIndex('transfer_events', ['from_tx_uuid'], {name: 'transfer_events_from_tx_uuid_idx', where: 'from_tx_uuid IS NOT NULL'});
  pgm.createIndex('transfer_events', ['to_tx_uuid'], {name: 'transfer_events_to_tx_uuid_idx', where: 'to_tx_uuid IS NOT NULL'});
  pgm.createIndex('transfer_events', ['owner'], {name: 'transfer_events_owner_idx'});
  pgm.createIndex('transfer_events', ['owner', 'broker', 'security_key'], {name: 'transfer_events_owner_broker_security_idx'});
  pgm.sql(`
    CREATE TRIGGER transfer_events_set_updated_at BEFORE UPDATE ON transfer_events
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ----- transfer_event_lots (the moved lots — replaces the embedded lotPayload blob) -----
  pgm.sql(`
    CREATE TABLE transfer_event_lots (
      transfer_event_id           TEXT NOT NULL REFERENCES transfer_events(transfer_event_id) ON DELETE CASCADE,
      lot_ndx                     INTEGER NOT NULL,
      owner                       TEXT NOT NULL,
      quantity                    NUMERIC NOT NULL,
      basis_per_share             NUMERIC NOT NULL,
      original_acquisition_epoch  TIMESTAMPTZ NOT NULL,
      original_acquisition_date   DATE,
      created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by                  TEXT NOT NULL,
      updated_by                  TEXT NOT NULL,
      PRIMARY KEY (transfer_event_id, lot_ndx),
      CONSTRAINT transfer_event_lots_owner_format_chk CHECK (owner ${OWNER_CHK}),
      CONSTRAINT transfer_event_lots_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT transfer_event_lots_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  pgm.sql(`
    CREATE TRIGGER transfer_event_lots_set_updated_at BEFORE UPDATE ON transfer_event_lots
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ----- transactions.origin_transfer_event_id: turn on the deferred FK (#4 left it bare) -----
  pgm.sql(`
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_origin_transfer_event_id_fkey
        FOREIGN KEY (origin_transfer_event_id) REFERENCES transfer_events(transfer_event_id) ON DELETE RESTRICT,
      ADD CONSTRAINT transactions_origin_transfer_event_id_format_chk
        CHECK (origin_transfer_event_id IS NULL OR origin_transfer_event_id ${EVENT_ID_CHK});
  `);
  // Derive "synthetics owned by this event" (XF-3) — index the back-link.
  pgm.createIndex('transactions', ['origin_transfer_event_id'], {name: 'transactions_origin_transfer_event_id_idx', where: 'origin_transfer_event_id IS NOT NULL'});
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP INDEX IF EXISTS transactions_origin_transfer_event_id_idx;`);
  pgm.sql(`
    ALTER TABLE transactions
      DROP CONSTRAINT IF EXISTS transactions_origin_transfer_event_id_format_chk,
      DROP CONSTRAINT IF EXISTS transactions_origin_transfer_event_id_fkey;
  `);
  pgm.sql(`DROP TRIGGER IF EXISTS transfer_event_lots_set_updated_at ON transfer_event_lots;`);
  pgm.dropTable('transfer_event_lots');
  pgm.sql(`DROP TRIGGER IF EXISTS transfer_events_set_updated_at ON transfer_events;`);
  pgm.dropTable('transfer_events');
  pgm.sql(`DROP TRIGGER IF EXISTS transfer_pending_set_updated_at ON transfer_pending;`);
  pgm.dropTable('transfer_pending');
};
