/*
Created by Franz Zemen
License Type: UNLICENSED

Era 5 — Postgres backing for @franzzemen/audit-chain (publish/thesis audit trail).

audit-chain was missed in the DDB→Postgres migration: it only had filesystem +
s3-dynamo providers, and app-worker's publish path used the DDB-backed one against
`financials.publish.audit-chain-index` / `-counter` — tables that were deleted in
the teardown, so thesis publish 500s (ResourceNotFoundException). This migration
creates the PG backing for a new PostgresProvider in audit-chain.

Tamper model: the chain's integrity comes from the per-entry hash chain
(previous_hash → current_hash) + signature, verified by audit-chain's verify-chain.
The former S3 Object-Lock gave storage-level WORM (tamper-PREVENTION); PG gives
tamper-EVIDENCE (detection) only. Entries are append-only by convention; no row is
ever updated or deleted by the provider.

Tables owned by brokenstock_app (the migration + worker role) — no explicit GRANT
needed (DB is owned by brokenstock_app per aurora-bootstrap).
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS audit_chain_entry (
      sequence_number BIGINT PRIMARY KEY,
      timestamp       TEXT  NOT NULL,
      actor_id        TEXT  NOT NULL,
      actor_roles     JSONB NOT NULL DEFAULT '[]'::jsonb,
      action_type     TEXT  NOT NULL,
      resource_type   TEXT  NOT NULL,
      resource_id     TEXT  NOT NULL,
      resource_key    TEXT  NOT NULL,
      payload         JSONB,
      previous_hash   TEXT  NOT NULL,
      current_hash    TEXT  NOT NULL,
      signature       TEXT  NOT NULL,
      key_version     TEXT  NOT NULL
    );

    -- Index-query support (queryByActor / queryByResource / queryByAction with an
    -- optional [fromDate,toDate] range on the ISO-8601 timestamp string).
    CREATE INDEX IF NOT EXISTS audit_chain_entry_actor_ts_idx
      ON audit_chain_entry (actor_id, timestamp);
    CREATE INDEX IF NOT EXISTS audit_chain_entry_resource_ts_idx
      ON audit_chain_entry (resource_key, timestamp);
    CREATE INDEX IF NOT EXISTS audit_chain_entry_action_ts_idx
      ON audit_chain_entry (action_type, timestamp);

    -- Gapless monotonic sequence claimed atomically (UPDATE ... RETURNING),
    -- mirroring the DDB atomicIncrement the s3-dynamo provider used. Seeded at 0
    -- so the first claim returns 1.
    CREATE TABLE IF NOT EXISTS audit_chain_counter (
      id              TEXT   PRIMARY KEY,
      sequence_number BIGINT NOT NULL DEFAULT 0
    );
    INSERT INTO audit_chain_counter (id, sequence_number)
      VALUES ('audit-chain-sequence', 0)
      ON CONFLICT (id) DO NOTHING;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    DROP TABLE IF EXISTS audit_chain_entry;
    DROP TABLE IF EXISTS audit_chain_counter;
  `);
};
