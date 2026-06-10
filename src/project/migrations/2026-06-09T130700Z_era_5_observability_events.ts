/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * observability_events — Era 5 DDB→PG migration of `@franzzemen/observability`
 * ObservabilityWriter / ObservabilityReaderTrustedApi (was DDB with a byKind GSI).
 * Append-only operational event stream (namespace.kind tagged: invalidation.*,
 * file-import-*, http-5xx, errors, dividends, worker states). Indexed by
 * (kind, epoch) for listByKind and (owner, epoch) for listByOwner. rru/wru were
 * DynamoDB capacity metrics — kept nullable for type compatibility, unused in PG.
 * The retired SQS-era kinds (invalidation.consumed / invalidation.dlq_landed) are
 * pruned at the code layer (no longer emitted); free-form TEXT here imposes no enum.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE observability_events (
      event_id     TEXT PRIMARY KEY,
      owner        TEXT NOT NULL,
      namespace    TEXT NOT NULL,
      kind         TEXT NOT NULL,
      epoch_ms     BIGINT NOT NULL,
      dims         JSONB,
      rru          NUMERIC,
      wru          NUMERIC,
      duration_ms  NUMERIC,
      success      BOOLEAN,
      producer     TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by   TEXT NOT NULL,
      updated_by   TEXT NOT NULL
    );
  `);
  pgm.sql(`CREATE INDEX observability_events_kind_epoch_idx ON observability_events (kind, epoch_ms DESC);`);
  pgm.sql(`CREATE INDEX observability_events_owner_epoch_idx ON observability_events (owner, epoch_ms DESC);`);
  pgm.sql(`
    CREATE TRIGGER observability_events_set_updated_at BEFORE UPDATE ON observability_events
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS observability_events_set_updated_at ON observability_events;`);
  pgm.sql(`DROP INDEX IF EXISTS observability_events_owner_epoch_idx;`);
  pgm.sql(`DROP INDEX IF EXISTS observability_events_kind_epoch_idx;`);
  pgm.dropTable('observability_events');
};
