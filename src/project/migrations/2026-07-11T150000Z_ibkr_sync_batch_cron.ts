/*
Created by Franz Zemen 2026-07-11
License Type: UNLICENSED

IBKR Flex Web Service Sync — weekday batch driver (E7).
See ibkr-flex-web-service-sync.prd.md (D11, D12).

A pg_cron job that, each weekday morning ET, enqueues one `import.ibkr-fetch`
pg-chunked-job per enabled, non-error `ibkr_report_config` row. The imports-worker's
`import.ibkr-fetch` consumer (E5) drains them (its 60s poll backstop picks up the
directly-inserted chunks — no NOTIFY needed for a daily job).

Design:
  * Schedule '0 11 * * 1-5' (UTC) = 06:00 EST / 07:00 EDT, Mon–Fri. Weekdays only —
    markets are closed weekends (Monday covers Friday); dedup makes any redundant
    pull a no-op anyway. After IBKR's overnight backend finishes prior-day Activity
    statements.
  * Enqueues DIRECTLY into job/job_chunk (no submitJob TS call available from SQL).
    - owner + account come from the config; ownerRoles are looked up from user_roles
      (the import runs as the user, so it needs the user's roles to pass hasAccess).
    - partition_key = NULL: avoids colliding with the single-flight unique index if a
      manual sync (E6) for the same account is active. Batch-level dedup is the
      idempotency_key instead.
    - idempotency_key = 'ibkr-batch#<owner>#<account>#<ET-date>' (ON CONFLICT DO
      NOTHING) → at most one batch fetch per account per day.
    - status='running', chunk_total=1, one 'work' job_chunk (chunk_ordinal 0).
  * Registered ONLY on cron.database_name (prod_blue) — the guard skips dev_franz.

Bumps MIN_SCHEMA_VERSION = 2026-07-11T150000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const CRON_NAME = 'ibkr-sync-batch';
const SCHEDULE = '0 11 * * 1-5';

// Parameter-free so it embeds as a cron command string. Only jobs actually inserted
// (ON CONFLICT DO NOTHING → RETURNING) get a work chunk, so deduped days create nothing.
const enqueueSql = `
  WITH cfg AS (
    SELECT c.owner, c.account,
           COALESCE(jsonb_agg(to_jsonb(ur.role_name)) FILTER (WHERE ur.role_name IS NOT NULL), '[]'::jsonb) AS roles
    FROM ibkr_report_config c
    LEFT JOIN user_roles ur ON ur.user_uuid = (split_part(c.owner, '.', 1))::uuid
    WHERE c.enabled = true AND c.status <> 'error'
    GROUP BY c.owner, c.account
  ),
  new_jobs AS (
    INSERT INTO job (job_type, owner, partition_key, status, chunk_total, payload, idempotency_key, started_at)
    SELECT 'import.ibkr-fetch', cfg.owner, NULL, 'running', 1,
           jsonb_build_object('owner', cfg.owner, 'ownerRoles', cfg.roles, 'account', cfg.account, 'kind', 'ibkr-fetch'),
           'ibkr-batch#' || cfg.owner || '#' || cfg.account || '#' || to_char((now() AT TIME ZONE 'America/New_York'), 'YYYY-MM-DD'),
           now()
    FROM cfg
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING job_id, job_type, payload
  )
  INSERT INTO job_chunk (job_id, job_type, kind, chunk_ordinal, partition, status, payload)
  SELECT job_id, job_type, 'work', 0, payload->>'account', 'pending', payload
  FROM new_jobs;
`.trim();

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    DO $do$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE NOTICE 'Skipping pg_cron ${CRON_NAME} on %: pg_cron not installed.', current_database();
      ELSIF current_database() <> (SELECT setting FROM pg_settings WHERE name = 'cron.database_name') THEN
        RAISE NOTICE 'Skipping pg_cron ${CRON_NAME} on %: jobs only registered in cron.database_name.', current_database();
      ELSE
        EXECUTE 'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = ''${CRON_NAME}''';
        EXECUTE $sql$SELECT cron.schedule('${CRON_NAME}', '${SCHEDULE}', $job$${enqueueSql}$job$)$sql$;
      END IF;
    END
    $do$;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    DO $do$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
         AND current_database() = (SELECT setting FROM pg_settings WHERE name = 'cron.database_name') THEN
        EXECUTE 'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = ''${CRON_NAME}''';
      END IF;
    END
    $do$;
  `);
};
