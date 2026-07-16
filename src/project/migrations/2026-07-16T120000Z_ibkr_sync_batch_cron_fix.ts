/*
Created by Franz Zemen 2026-07-16
License Type: UNLICENSED

IBKR Flex Web Service Sync — weekday batch driver TYPE-CAST FIX (BUG-002).
Supersedes 2026-07-11T150000Z_ibkr_sync_batch_cron.ts.

The original cron SQL joined:
    LEFT JOIN user_roles ur ON ur.user_uuid = (split_part(c.owner, '.', 1))::uuid
but `user_roles.user_uuid` is `text`, so Postgres has no `text = uuid` operator and
aborted the WHOLE cron statement every run:
    ERROR: operator does not exist: text = uuid
Result: the batch driver has NEVER enqueued a single `import.ibkr-fetch` job since it
was deployed (2026-07-11). cron.job_run_details showed status=failed every weekday.

Fix: drop the `::uuid` cast — compare the split owner-uuid to the `text` column
directly (`ur.user_uuid = split_part(c.owner, '.', 1)`). Everything else is byte-for-byte
identical to the original: same job name (re-`cron.schedule` replaces the command in
place), same schedule, same direct job/job_chunk insert, same idempotency key.

No schema change, no worker-code dependency → no MIN_SCHEMA_VERSION bump, no worker
redeploy. Registered ONLY on cron.database_name (prod_blue); the guard skips dev_franz.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const CRON_NAME = 'ibkr-sync-batch';
const SCHEDULE = '0 11 * * 1-5';

// Parameter-free so it embeds as a cron command string. Only jobs actually inserted
// (ON CONFLICT DO NOTHING → RETURNING) get a work chunk, so deduped days create nothing.
// FIX (BUG-002): `ur.user_uuid = split_part(c.owner, '.', 1)` — no `::uuid` cast (text = text).
const enqueueSql = `
  WITH cfg AS (
    SELECT c.owner, c.account,
           COALESCE(jsonb_agg(to_jsonb(ur.role_name)) FILTER (WHERE ur.role_name IS NOT NULL), '[]'::jsonb) AS roles
    FROM ibkr_report_config c
    LEFT JOIN user_roles ur ON ur.user_uuid = split_part(c.owner, '.', 1)
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

// down: re-register the (buggy) original SQL is pointless; just unschedule so a rollback
// leaves no half-broken job behind. Re-running the prior migration's up() restores it.
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
