/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Era 3 C6 fix (2026-06-06) — correct the transactions.origin_transfer_event_id FK
 * from ON DELETE RESTRICT to ON DELETE CASCADE.
 *
 * WHY: the synthetic transactions an event owns carry origin_transfer_event_id =
 * <event>. The transfer cascade (brokenstock-orchestrator
 * transfer-matcher-orchestrator.cascadeDeleteForTransactions / ...ForAccount)
 * deletes the EVENT first (capturing it for the rebuild fan-out) and the owned
 * synthetics SECOND. With RESTRICT, deleting the event while its synthetics still
 * reference it is blocked — the cascade can't run. CASCADE lets the event delete
 * dissolve its synthetics; the orchestrator's explicit synthetic-delete becomes a
 * harmless no-op, and the partition rebuild (driven by the returned events) is
 * unaffected. (The event→transactions FKs from_tx_uuid/to_tx_uuid stay RESTRICT —
 * those protect the opposite order: a transaction can't be deleted until the
 * transfer rows referencing it are gone, which is what forces the cascade to run
 * and produce the rebuild signal. Only the synthetic→event direction was wrong.)
 *
 * The applied 0.10.0 migration is left untouched (editing an applied migration
 * risks checksum drift); this is an additive ALTER. MIN_SCHEMA_VERSION bumps to
 * 2026-06-06T120000Z.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const EVENT_ID_CHK = `~ '^${UUID_RE}\\.transfer-event$'`;

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE transactions DROP CONSTRAINT transactions_origin_transfer_event_id_fkey;`);
  pgm.sql(`
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_origin_transfer_event_id_fkey
        FOREIGN KEY (origin_transfer_event_id) REFERENCES transfer_events(transfer_event_id) ON DELETE CASCADE;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE transactions DROP CONSTRAINT transactions_origin_transfer_event_id_fkey;`);
  pgm.sql(`
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_origin_transfer_event_id_fkey
        FOREIGN KEY (origin_transfer_event_id) REFERENCES transfer_events(transfer_event_id) ON DELETE RESTRICT;
  `);
  // format CHECK is independent and unchanged here (it lives in 0.10.0).
  void EVENT_ID_CHK;
};
