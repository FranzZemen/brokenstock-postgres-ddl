/*
Created by Franz Zemen 2026-07-16
License Type: UNLICENSED

IBKR Flex Web Service Sync — weekday batch driver JOIN-KEY FIX (BUG-002, part 2).
Supersedes 2026-07-16T120000Z_ibkr_sync_batch_cron_fix.ts.

The original batch-driver migration had TWO independent defects in the user_roles
join. Part 1 (2026-07-16T120000Z) fixed the `::uuid` cast that hard-errored every
run (`operator does not exist: text = uuid`). Verification against prod_blue then
exposed the second defect: the join key is wrong.

    LEFT JOIN user_roles ur ON ur.user_uuid = split_part(c.owner, '.', 1)

`user_roles.user_uuid` stores the FULL owner string (`<uuid>.user`), but
`split_part(c.owner, '.', 1)` strips the `.user` suffix and yields the bare uuid,
so the join never matches → every enqueued job carries `ownerRoles: []`. The
imports-worker `import.ibkr-fetch` consumer runs the fetch AS the user and needs the
user's roles to pass hasAccess, so a role-less job would fail authorization — the
daily sync would still be broken, just with a different signature.

Fix: join on the full owner string — `ur.user_uuid = c.owner`. Verified read-only on
prod_blue: the corrected join returns all 22 roles for the enabled config. Everything
else is byte-for-byte identical (same job name → re-`cron.schedule` replaces in place,
same schedule, same insert, same idempotency key).

No schema change, no worker-code dependency → no MIN_SCHEMA_VERSION bump, no worker
redeploy. Registered ONLY on cron.database_name (prod_blue); the guard skips dev_franz.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const CRON_NAME = 'ibkr-sync-batch';
const SCHEDULE = '0 11 * * 1-5';

// Parameter-free so it embeds as a cron command string. Only jobs actually inserted
// (ON CONFLICT DO NOTHING → RETURNING) get a work chunk, so deduped days create nothing.
// FIX (BUG-002 part 2): join user_roles on the FULL owner string (`ur.user_uuid = c.owner`),
// not the `.user`-stripped bare uuid — user_roles.user_uuid stores `<uuid>.user`.
const enqueueSql = `
  WITH cfg AS (
    SELECT c.owner, c.account,
           COALESCE(jsonb_agg(to_jsonb(ur.role_name)) FILTER (WHERE ur.role_name IS NOT NULL), '[]'::jsonb) AS roles
    FROM ibkr_report_config c
    LEFT JOIN user_roles ur ON ur.user_uuid = c.owner
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

// down: unschedule so a rollback leaves no half-broken job behind. Re-running the
// prior migration's up() restores the (role-less) previous command.
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
