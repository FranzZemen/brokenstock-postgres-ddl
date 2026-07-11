/*
Created by Franz Zemen 2026-07-11
License Type: UNLICENSED

IBKR Flex Web Service Sync — per-user report config (E3).
See ibkr-flex/doc/prd/ibkr-flex-web-service-sync.prd.md (D4, D5, D6, D14).

Per-user, per-account configuration for the opt-in IBKR "sync" path: the token
and query id needed to pull a Flex Query report over IBKR's Flex Web Service,
plus the sync's last-run status (a failed fetch produces no file row, so status
must live here).

  - ibkr_report_config (PK (owner, account) — one-to-many per user; a user with
                        N IBKR accounts has N rows. Single-account statements
                        only; multi-account fan-out is out of scope.)

Design notes:
  * owner = '<uuid>.user' (strict user format; sync configs are user-owned). No
    FK to users — follows the owner-scoped FK-less convention of
    scanner_settings / transactions / trades.
  * token and query_id are stored ENCRYPTED (AES-256-GCM via
    @franzzemen/safe-config encryptField, key from Secrets Manager). The DB holds
    opaque base64 ciphertext; it never sees plaintext. Plain TEXT columns.
  * status IN ('ok','error') — 'error' is the halt-until-fixed state set on a
    config-fatal IBKR error (expired/invalid token, invalid query, IP restriction).
    The batch skips enabled rows whose status='error' until the user re-saves.
  * enabled defaults false — a user is a sync participant only after opting in.
  * last_sync_status / last_sync_error surface fetch outcomes (there is no
    brokerage_file_imports row on a failed fetch).
  * Actor CHECK relaxed (user|brokenstock) on created_by/updated_by; owner CHECK
    strict '.user'. Shared set_updated_at trigger.

Pins MIN_SCHEMA_VERSION = 2026-07-11T130000Z for @franzzemen/ibkr-flex.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ACTOR_CHK = `~ '^${UUID_RE}\\.(user|brokenstock)$'`;
const OWNER_CHK = `~ '^${UUID_RE}\\.user$'`;

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE ibkr_report_config (
      owner            TEXT NOT NULL,
      account          TEXT NOT NULL,
      query_id         TEXT NOT NULL,
      token            TEXT NOT NULL,
      label            TEXT,
      enabled          BOOLEAN NOT NULL DEFAULT false,
      status           TEXT NOT NULL DEFAULT 'ok',
      last_synced_at   TIMESTAMPTZ,
      last_sync_status TEXT,
      last_sync_error  TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by       TEXT NOT NULL,
      updated_by       TEXT NOT NULL,
      PRIMARY KEY (owner, account),
      CONSTRAINT ibkr_report_config_owner_format_chk CHECK (owner ${OWNER_CHK}),
      CONSTRAINT ibkr_report_config_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT ibkr_report_config_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK}),
      CONSTRAINT ibkr_report_config_status_chk CHECK (status IN ('ok', 'error'))
    );
  `);
  // The daily batch driver iterates enabled, non-error rows across all owners.
  pgm.sql(`
    CREATE INDEX ibkr_report_config_enabled_idx
      ON ibkr_report_config (enabled, status)
      WHERE enabled = true AND status <> 'error';
  `);
  pgm.sql(`
    CREATE TRIGGER ibkr_report_config_set_updated_at BEFORE UPDATE ON ibkr_report_config
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS ibkr_report_config_set_updated_at ON ibkr_report_config;`);
  pgm.dropTable('ibkr_report_config', {ifExists: true});
};
