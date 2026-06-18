/*
Created by Franz Zemen
License Type: UNLICENSED

Fleet Admin Console (PRD fleet-admin-console, E2 / D9) — central audit trail.

Every fleet action the local console performs — runtime ops executed via SSM
(restart/stop/start a unit, prune releases, redeploy/rollback a known version)
AND IaC-coupled changes (registry edits → cdk/abs, instance lifecycle) — is
recorded here via the admin-app-worker DB-REST gateway, so there is a central,
server-side trail even though execution happens on Franz's laptop. The console's
audit client buffers locally when the worker is unreachable and flushes on return.

Append-mostly: a row is INSERTed at action start (status='started') and may be
UPDATEd once on completion (status -> 'success'|'failure', result/output/error/
completed_at). No row is deleted by the gateway.

Tables owned by brokenstock_app (the migration + worker role) — no explicit GRANT
needed (DB is owned by brokenstock_app per aurora-bootstrap).
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS fleet_admin_audit (
      id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      actor           TEXT        NOT NULL,
      actor_roles     JSONB       NOT NULL DEFAULT '[]'::jsonb,
      -- tier mirrors the PRD control-plane tiers (D5/D8).
      tier            TEXT        NOT NULL CHECK (tier IN ('monitor', 'runtime', 'iac')),
      -- e.g. 'unit.restart', 'releases.prune', 'version.redeploy', 'version.rollback',
      -- 'iac.memoryShare.change', 'iac.processCount.change', 'instance.create', 'instance.terminate'.
      action          TEXT        NOT NULL,
      target_kind     TEXT,        -- 'role' | 'unit' | 'instance' | 'host' | 'registry'
      target          TEXT,        -- 'yields-worker', 'yields-worker@1', 'i-0abc...'
      env             TEXT        NOT NULL,   -- 'nonprod'
      db_name         TEXT,                    -- 'prod_blue'
      params          JSONB       NOT NULL DEFAULT '{}'::jsonb,
      status          TEXT        NOT NULL CHECK (status IN ('started', 'success', 'failure')),
      ssm_command_id  TEXT,        -- correlation to the SSM RunCommand invocation
      result          TEXT,        -- short outcome summary
      output          TEXT,        -- captured output (truncated by the caller)
      error           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at    TIMESTAMPTZ
    );

    -- Activity-feed ordering (newest first) + the common filters.
    CREATE INDEX IF NOT EXISTS fleet_admin_audit_created_idx
      ON fleet_admin_audit (created_at DESC);
    CREATE INDEX IF NOT EXISTS fleet_admin_audit_actor_created_idx
      ON fleet_admin_audit (actor, created_at DESC);
    CREATE INDEX IF NOT EXISTS fleet_admin_audit_action_created_idx
      ON fleet_admin_audit (action, created_at DESC);
    CREATE INDEX IF NOT EXISTS fleet_admin_audit_target_created_idx
      ON fleet_admin_audit (target, created_at DESC);
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TABLE IF EXISTS fleet_admin_audit;`);
};
