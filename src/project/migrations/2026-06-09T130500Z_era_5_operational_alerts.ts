/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * operational_alerts — Era 5 DDB+SQS→PG migration of `@franzzemen/brokenstock-alerts`
 * `AlertsTrustedApi` (was DDB `OPERATIONAL_ALERTS` + an SQS FIFO enqueue → writer
 * Lambda). In PG the SQS hop + writer Lambda collapse to a direct upsert:
 * `enqueueAlert` now calls the same write path. Dedup/re-open is serialized per
 * incident by a row lock on the dedupe_key rows (replacing the FIFO
 * MessageGroupId=dedupeKey ordering).
 *
 * `dedupe_key` is indexed (NOT unique — a dedupe_key accrues multiple Resolved
 * rows over time; the write path finds the open-vs-resolved row). `status` is
 * indexed for the admin listAlerts(statuses) query. `ttl_epoch` retains the
 * DDB TTL value for a future cleanup job (PG has no native row TTL).
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE operational_alerts (
      alert_id        TEXT PRIMARY KEY,
      type            TEXT NOT NULL,
      status          TEXT NOT NULL,
      dedupe_key      TEXT NOT NULL,
      owner           TEXT,
      description     JSONB,
      resolved_epoch  BIGINT,
      ttl_epoch       BIGINT,
      notes           JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by      TEXT NOT NULL,
      updated_by      TEXT NOT NULL,
      CONSTRAINT operational_alerts_status_chk CHECK (status IN ('New', 'In Progress', 'Resolved'))
    );
  `);
  pgm.createIndex('operational_alerts', 'dedupe_key', {name: 'operational_alerts_dedupe_key_idx'});
  pgm.createIndex('operational_alerts', 'status', {name: 'operational_alerts_status_idx'});
  pgm.sql(`
    CREATE TRIGGER operational_alerts_set_updated_at BEFORE UPDATE ON operational_alerts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS operational_alerts_set_updated_at ON operational_alerts;`);
  pgm.dropIndex('operational_alerts', 'status', {name: 'operational_alerts_status_idx'});
  pgm.dropIndex('operational_alerts', 'dedupe_key', {name: 'operational_alerts_dedupe_key_idx'});
  pgm.dropTable('operational_alerts');
};
