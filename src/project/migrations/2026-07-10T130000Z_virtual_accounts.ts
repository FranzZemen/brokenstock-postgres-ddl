/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Virtual Accounts — go-forward strategy tracking via import fan-out
 * (broken-stock/doc/prd/virtual-accounts.prd.md, E1).
 *
 * A virtual account is a normal brokerage_accounts row linked to exactly one
 * SOURCE real account (same brokerage, distinct account string) with an
 * immutable start_at date. It is fed exclusively by backend import fan-out:
 * an import committed to the source also imports into its linked open virtual
 * accounts, with transactions economically dated before start_at dropped at
 * parse time. Virtual accounts are excluded from portfolio-tier gain rollups
 * only; everywhere else they behave as normal accounts.
 *
 * brokerage_accounts:
 *   - source_account_id  TEXT NULL FK → brokerage_accounts.account_id.
 *     Non-null ⇔ the row is virtual. RESTRICT (not CASCADE): deleting a real
 *     account must run the full app-level account-delete cascade per linked
 *     virtual FIRST (trades/transactions/records/imports/gains teardown);
 *     the FK is a backstop against orphan links, never the cleanup mechanism.
 *   - start_at DATE NULL — fan-out drops transactions whose economic date
 *     (paidTransactionEpoch ?? transactionEpoch) predates start-of-day ET.
 *     Both-or-neither with source_account_id (virtual_link_chk).
 *   - closed_at TIMESTAMPTZ NULL — irreversible close: the import feed
 *     (fan-out / delete fan-out / sync-from-source) skips closed virtuals;
 *     valuation and trade curation continue. Only virtuals close
 *     (closed_virtual_chk).
 *
 * brokerage_file_imports:
 *   - fanned_from_file_import_id TEXT NULL FK → brokerage_file_imports
 *     .file_import_id, ON DELETE SET NULL. Stamped on fan-out siblings;
 *     delete fan-out targets by it (and it distinguishes fanned rows from
 *     any other row with a matching filename). SET NULL because the source
 *     import's metadata row can be deleted while the virtual sibling lives on
 *     (independence is the design).
 *   - metric_start_at_dropped_count INTEGER NULL — parse-stage count of
 *     transactions dropped by the start_at filter (fail-loud visibility,
 *     alongside the existing metric_* family).
 *
 * Additive only (nullable column adds; no data rewrite).
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.addColumns('brokerage_accounts', {
    source_account_id: {type: 'text'},
    start_at: {type: 'date'},
    closed_at: {type: 'timestamptz'},
  });
  pgm.sql(`
    ALTER TABLE brokerage_accounts
      ADD CONSTRAINT brokerage_accounts_source_account_id_fkey
        FOREIGN KEY (source_account_id) REFERENCES brokerage_accounts(account_id)
        ON DELETE RESTRICT;
    ALTER TABLE brokerage_accounts
      ADD CONSTRAINT brokerage_accounts_virtual_link_chk
        CHECK ((source_account_id IS NULL) = (start_at IS NULL));
    ALTER TABLE brokerage_accounts
      ADD CONSTRAINT brokerage_accounts_closed_virtual_chk
        CHECK (closed_at IS NULL OR source_account_id IS NOT NULL);
  `);
  // Fan-out enumerates open virtuals by source; partial — real accounts stay out.
  pgm.sql(`
    CREATE INDEX brokerage_accounts_source_account_idx
      ON brokerage_accounts (source_account_id)
      WHERE source_account_id IS NOT NULL;
  `);

  pgm.addColumns('brokerage_file_imports', {
    fanned_from_file_import_id: {type: 'text'},
    metric_start_at_dropped_count: {type: 'integer'},
  });
  pgm.sql(`
    ALTER TABLE brokerage_file_imports
      ADD CONSTRAINT brokerage_file_imports_fanned_from_fkey
        FOREIGN KEY (fanned_from_file_import_id)
        REFERENCES brokerage_file_imports(file_import_id)
        ON DELETE SET NULL;
  `);
  // Delete fan-out looks up siblings by the source import id.
  pgm.sql(`
    CREATE INDEX brokerage_file_imports_fanned_from_idx
      ON brokerage_file_imports (fanned_from_file_import_id)
      WHERE fanned_from_file_import_id IS NOT NULL;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP INDEX IF EXISTS brokerage_file_imports_fanned_from_idx;`);
  pgm.sql(`
    ALTER TABLE brokerage_file_imports
      DROP CONSTRAINT IF EXISTS brokerage_file_imports_fanned_from_fkey;
  `);
  pgm.dropColumns('brokerage_file_imports',
    ['fanned_from_file_import_id', 'metric_start_at_dropped_count'], {ifExists: true});

  pgm.sql(`DROP INDEX IF EXISTS brokerage_accounts_source_account_idx;`);
  pgm.sql(`
    ALTER TABLE brokerage_accounts
      DROP CONSTRAINT IF EXISTS brokerage_accounts_closed_virtual_chk;
    ALTER TABLE brokerage_accounts
      DROP CONSTRAINT IF EXISTS brokerage_accounts_virtual_link_chk;
    ALTER TABLE brokerage_accounts
      DROP CONSTRAINT IF EXISTS brokerage_accounts_source_account_id_fkey;
  `);
  pgm.dropColumns('brokerage_accounts',
    ['source_account_id', 'start_at', 'closed_at'], {ifExists: true});
};
