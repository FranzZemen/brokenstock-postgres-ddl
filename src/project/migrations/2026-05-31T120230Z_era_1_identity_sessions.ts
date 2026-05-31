/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * sessions — Era 1 C1 JWT-shaped session rows + pg_cron TTL sweep.
 *
 * pg_cron substrate (cluster parameter group + `cron.database_name=prod_blue`)
 * is owned by Pre-Era-1.6 E9 and is a prerequisite. `CREATE EXTENSION` installs
 * the extension in this database; job rows live in `cron.job`, but jobs only
 * FIRE in the database named by the cluster's `cron.database_name` param —
 * that's `prod_blue` per Aurora's per-cluster constraint. `dev_franz` will
 * have the row in `cron.job` but the sweep won't execute there. This is
 * expected and documented in PRD Q3 / R8.
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

  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pg_cron;`);
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sessions-ttl-sweep') THEN
        PERFORM cron.unschedule('sessions-ttl-sweep');
      END IF;
    END $$;
  `);
  pgm.sql(`
    SELECT cron.schedule(
      'sessions-ttl-sweep',
      '0 * * * *',
      $$DELETE FROM sessions WHERE expires_at < now() - interval '1 day'$$
    );
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sessions-ttl-sweep') THEN
        PERFORM cron.unschedule('sessions-ttl-sweep');
      END IF;
    END $$;
  `);
  pgm.sql(`DROP TRIGGER IF EXISTS sessions_set_updated_at ON sessions;`);
  pgm.dropIndex('sessions', 'expires_at', {name: 'sessions_expires_at_idx'});
  pgm.dropIndex('sessions', 'owner', {name: 'sessions_owner_idx'});
  pgm.dropTable('sessions');
};
