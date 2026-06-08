/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Era 4 / 4b (2026-06-08) — GAIN SNAPSHOTS. Refactors @franzzemen/gain-snapshots
 * off DynamoDB. The append-incremental daily gain ledger (nightly) + the as-of
 * reconstitution cache. See era-4-4b-gains-as-sql.prd.md (decisions 4b-1…4b-9).
 *
 * 4 tables:
 *   nightly_account_gains    (owner, date, brokerage, account)   -- forever ledger
 *   nightly_portfolio_gains  (owner, date)                        -- forever ledger
 *   as_of_account_gains      (owner, as_of_date, brokerage, account)  -- cache, ttl-purged
 *   as_of_portfolio_gains    (owner, as_of_date)                  -- cache, ttl-purged
 *
 * Decisions:
 *  - 4b-1 typed columns, ZERO jsonb; DDB SK encoders drop -> real columns.
 *  - 4b-2 NO FK (gains are aggregates without a single-row parent; portfolio rows
 *    key on (owner,date) only). Cascade is ORCHESTRATED (deleteAccountRows /
 *    deletePortfolioRows / deleteAsOfRowsForDates).
 *  - 4b-5 as-of `ttl` (epoch SECONDS, write-time + 30d) kept as a column; a
 *    prod_blue-guarded pg_cron job purges expired rows (DDB TTL has no PG analog).
 *  - 4b-7 gain triple + closed-trade W/L tally + generated_on_epoch + parent_job_id
 *    + provenance + audit/trigger.
 *  - 4b-8 NO backfill — tables born empty.
 *
 * Pins MIN_SCHEMA_VERSION = 2026-06-08T130000Z.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ACTOR_CHK = `~ '^${UUID_RE}\\.(user|brokenstock)$'`;
const OWNER_CHK = `~ '^${UUID_RE}\\.user$'`;

// Shared gain + W/L tally + meta + provenance + audit columns (repeated per table).
const gainColumns = (): string => `
      cumulative_gain     NUMERIC NOT NULL,
      realized_gain       NUMERIC NOT NULL,
      unrealized_gain     NUMERIC NOT NULL,
      trade_wins          INTEGER NOT NULL,
      trade_losses        INTEGER NOT NULL,
      trade_breakevens    INTEGER NOT NULL,
      trade_win_rate      NUMERIC,
      trade_win_amount    NUMERIC NOT NULL,
      trade_loss_amount   NUMERIC NOT NULL,
      generated_on_epoch  BIGINT NOT NULL,
      parent_job_id       TEXT,
      started_by          TEXT,
      job_id              TEXT,
      writer              TEXT,
      writer_version      TEXT,
      written_at          BIGINT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by          TEXT NOT NULL,
      updated_by          TEXT NOT NULL`;

export const up = (pgm: MigrationBuilder): void => {
  // ===== nightly_account_gains (forever ledger) =====
  pgm.sql(`
    CREATE TABLE nightly_account_gains (
      owner       TEXT NOT NULL,
      date        DATE NOT NULL,
      brokerage   TEXT NOT NULL,
      account     TEXT NOT NULL,
      ${gainColumns()},
      PRIMARY KEY (owner, date, brokerage, account),
      CONSTRAINT nag_owner_format_chk CHECK (owner ${OWNER_CHK}),
      CONSTRAINT nag_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT nag_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  // Latest-row + history range scan per (owner, brokerage, account).
  pgm.createIndex('nightly_account_gains', ['owner', 'brokerage', 'account', 'date'], {name: 'nag_owner_acct_date_idx'});
  pgm.sql(`CREATE TRIGGER nag_set_updated_at BEFORE UPDATE ON nightly_account_gains FOR EACH ROW EXECUTE FUNCTION set_updated_at();`);

  // ===== nightly_portfolio_gains (forever ledger) =====
  pgm.sql(`
    CREATE TABLE nightly_portfolio_gains (
      owner       TEXT NOT NULL,
      date        DATE NOT NULL,
      ${gainColumns()},
      PRIMARY KEY (owner, date),
      CONSTRAINT npg_owner_format_chk CHECK (owner ${OWNER_CHK}),
      CONSTRAINT npg_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT npg_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  // (PK (owner, date) btree serves latest = ORDER BY date DESC + history range.)
  pgm.sql(`CREATE TRIGGER npg_set_updated_at BEFORE UPDATE ON nightly_portfolio_gains FOR EACH ROW EXECUTE FUNCTION set_updated_at();`);

  // ===== as_of_account_gains (cache, ttl-purged) =====
  pgm.sql(`
    CREATE TABLE as_of_account_gains (
      owner       TEXT NOT NULL,
      as_of_date  DATE NOT NULL,
      brokerage   TEXT NOT NULL,
      account     TEXT NOT NULL,
      ttl         BIGINT NOT NULL,   -- epoch SECONDS (write-time + 30d); purged by pg_cron
      ${gainColumns()},
      PRIMARY KEY (owner, as_of_date, brokerage, account),
      CONSTRAINT aoag_owner_format_chk CHECK (owner ${OWNER_CHK}),
      CONSTRAINT aoag_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT aoag_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  // (PK prefix (owner, as_of_date) serves the getAsOfAccountRowsForDate rollup read.)
  pgm.createIndex('as_of_account_gains', ['ttl'], {name: 'aoag_ttl_idx'});
  pgm.sql(`CREATE TRIGGER aoag_set_updated_at BEFORE UPDATE ON as_of_account_gains FOR EACH ROW EXECUTE FUNCTION set_updated_at();`);

  // ===== as_of_portfolio_gains (cache, ttl-purged) =====
  pgm.sql(`
    CREATE TABLE as_of_portfolio_gains (
      owner       TEXT NOT NULL,
      as_of_date  DATE NOT NULL,
      ttl         BIGINT NOT NULL,
      ${gainColumns()},
      PRIMARY KEY (owner, as_of_date),
      CONSTRAINT aopg_owner_format_chk CHECK (owner ${OWNER_CHK}),
      CONSTRAINT aopg_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT aopg_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  pgm.createIndex('as_of_portfolio_gains', ['ttl'], {name: 'aopg_ttl_idx'});
  pgm.sql(`CREATE TRIGGER aopg_set_updated_at BEFORE UPDATE ON as_of_portfolio_gains FOR EACH ROW EXECUTE FUNCTION set_updated_at();`);

  // ===== as-of TTL purge (pg_cron) — prod_blue-guarded, mirrors the era_3_5 pattern =====
  pgm.sql(`
    DO $do$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE NOTICE 'Skipping pg_cron as-of-gains-purge on %: pg_cron not installed.', current_database();
      ELSIF current_database() <> (SELECT setting FROM pg_settings WHERE name = 'cron.database_name') THEN
        RAISE NOTICE 'Skipping pg_cron as-of-gains-purge on %: only registered in cron.database_name (prod_blue).', current_database();
      ELSE
        EXECUTE 'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = ''as-of-gains-purge''';
        EXECUTE $sql$SELECT cron.schedule('as-of-gains-purge', '17 * * * *', $job$
          DELETE FROM as_of_account_gains   WHERE ttl < EXTRACT(EPOCH FROM now())::bigint;
          DELETE FROM as_of_portfolio_gains WHERE ttl < EXTRACT(EPOCH FROM now())::bigint;
        $job$)$sql$;
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
        EXECUTE 'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = ''as-of-gains-purge''';
      END IF;
    END
    $do$;
  `);
  pgm.sql(`DROP TRIGGER IF EXISTS aopg_set_updated_at ON as_of_portfolio_gains;`);
  pgm.dropTable('as_of_portfolio_gains');
  pgm.sql(`DROP TRIGGER IF EXISTS aoag_set_updated_at ON as_of_account_gains;`);
  pgm.dropTable('as_of_account_gains');
  pgm.sql(`DROP TRIGGER IF EXISTS npg_set_updated_at ON nightly_portfolio_gains;`);
  pgm.dropTable('nightly_portfolio_gains');
  pgm.sql(`DROP TRIGGER IF EXISTS nag_set_updated_at ON nightly_account_gains;`);
  pgm.dropTable('nightly_account_gains');
};
