/*
Created by Franz Zemen 2026-07-18
License Type: UNLICENSED

IBKR Flex Web Service Sync — batch driver: drop the user_roles join + ownerRoles.
Supersedes 2026-07-16T130000Z_ibkr_sync_batch_cron_join_fix.ts.

The legacy-authz-teardown DROPped `user_roles` (2026-07-18T120000Z). The live
`ibkr-sync-batch` cron command still `LEFT JOIN user_roles` to build an `ownerRoles`
jsonb key, so its next weekday run would error `relation "user_roles" does not exist`.
That key was already dead — the imports-worker reconstructs the requestor's session
from `owner` alone and reads no session roles (authorization moved to feature slugs +
security capabilities at the enqueueing route).

Fix: re-`cron.schedule` the same job with the join and the `ownerRoles` key removed.
The enqueue is otherwise byte-for-byte identical — same job name (re-schedule replaces
in place), same schedule, same idempotency key, same job/job_chunk inserts. No schema
change, no worker-code dependency → no MIN_SCHEMA_VERSION bump, no worker redeploy.
Registered ONLY on cron.database_name (prod_blue); the guard skips dev_franz.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const CRON_NAME = 'ibkr-sync-batch';
const SCHEDULE = '0 11 * * 1-5';

// Parameter-free so it embeds as a cron command string. Only jobs actually inserted
// (ON CONFLICT DO NOTHING → RETURNING) get a work chunk, so deduped days create nothing.
// No user_roles join, no ownerRoles jsonb key (legacy-authz-teardown).
const enqueueSql = `
  WITH cfg AS (
    SELECT c.owner, c.account
    FROM ibkr_report_config c
    WHERE c.enabled = true AND c.status <> 'error'
    GROUP BY c.owner, c.account
  ),
  new_jobs AS (
    INSERT INTO job (job_type, owner, partition_key, status, chunk_total, payload, idempotency_key, started_at)
    SELECT 'import.ibkr-fetch', cfg.owner, NULL, 'running', 1,
           jsonb_build_object('owner', cfg.owner, 'account', cfg.account, 'kind', 'ibkr-fetch'),
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

// down: unschedule so a rollback leaves no half-broken job behind. Re-running the
// prior migration's up() would restore the (now table-less) user_roles join — which
// no longer exists — so a rollback should stop here rather than re-break the cron.
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
