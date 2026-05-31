/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * sessions — Era 1 C1 JWT-shaped session rows + pg_cron TTL sweep.
 *
 * pg_cron is policy-pinned to one database per cluster (cron.database_name=prod_blue,
 * set by Pre-Era-1.6 E9). Aurora's pg_cron rejects `CREATE EXTENSION` in any
 * other database AND requires rds_superuser to install at all. So:
 *   - prod_blue: pg_cron is installed out-of-band by Aurora master (one-time,
 *     before C4 migration). This migration registers the sessions-ttl-sweep job.
 *   - dev_franz / scratch / others: cron schema doesn't exist; the migration
 *     applies the sessions table and skips the cron block entirely.
 *
 * The current_database() guard runs OUTSIDE any cron.* reference; the cron.*
 * calls are wrapped in EXECUTE so their names never resolve on non-prod_blue
 * databases. Documented in PRD Q3 / R8. See [[project-postgres-ddl-discipline]]
 * for the pg_cron substrate decision and a future CDK-managed install path
 * (Path B) for automating prod_blue's extension provisioning.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE sessions (
      token                       TEXT PRIMARY KEY,
      owner                       TEXT NOT NULL,
      start                       TEXT NOT NULL,
      start_at                    TIMESTAMPTZ NOT NULL,
      app_context                 TEXT NOT NULL,
      authenticated               BOOLEAN NOT NULL,
      previously_authenticated    BOOLEAN NOT NULL,
      invalidated                 BOOLEAN NOT NULL DEFAULT FALSE,
      refresh_token               TEXT NOT NULL,
      refresh_token_expires_at    TIMESTAMPTZ NOT NULL,
      effective_permissions       JSONB NOT NULL DEFAULT '{}'::jsonb,
      permissions_stale           BOOLEAN NOT NULL DEFAULT FALSE,
      expires_at                  TIMESTAMPTZ NOT NULL,
      created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by                  TEXT NOT NULL,
      updated_by                  TEXT NOT NULL,
      CONSTRAINT sessions_token_format_chk
        CHECK (token ~ '^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$'),
      CONSTRAINT sessions_owner_fkey
        FOREIGN KEY (owner) REFERENCES users(uuid) ON DELETE CASCADE
    );
  `);
  pgm.createIndex('sessions', 'owner', {name: 'sessions_owner_idx'});
  pgm.createIndex('sessions', 'expires_at', {name: 'sessions_expires_at_idx'});
  pgm.sql(`
    CREATE TRIGGER sessions_set_updated_at BEFORE UPDATE ON sessions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  pgm.sql(`
    DO $$
    BEGIN
      IF current_database() <> 'prod_blue' THEN
        RAISE NOTICE 'Skipping pg_cron sessions-ttl-sweep on %: only registered in cron.database_name (prod_blue).', current_database();
        RETURN;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE EXCEPTION 'pg_cron extension is not installed in prod_blue. Master must run CREATE EXTENSION pg_cron; before this migration (see [[project-postgres-ddl-discipline]]).';
      END IF;

      -- EXECUTE keeps cron.* identifiers unresolved on databases that never
      -- reach this point (defense alongside the early-return above).
      EXECUTE 'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = ''sessions-ttl-sweep''';
      EXECUTE $sql$SELECT cron.schedule('sessions-ttl-sweep', '0 * * * *', $job$DELETE FROM sessions WHERE expires_at < now() - interval '1 day'$job$)$sql$;
    END $$;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    DO $$
    BEGIN
      IF current_database() = 'prod_blue'
         AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        EXECUTE 'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = ''sessions-ttl-sweep''';
      END IF;
    END $$;
  `);
  pgm.sql(`DROP TRIGGER IF EXISTS sessions_set_updated_at ON sessions;`);
  pgm.dropIndex('sessions', 'expires_at', {name: 'sessions_expires_at_idx'});
  pgm.dropIndex('sessions', 'owner', {name: 'sessions_owner_idx'});
  pgm.dropTable('sessions');
};
