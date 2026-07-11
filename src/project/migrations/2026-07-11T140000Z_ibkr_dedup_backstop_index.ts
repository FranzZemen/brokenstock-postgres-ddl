/*
Created by Franz Zemen 2026-07-11
License Type: UNLICENSED

IBKR transaction dedup — DB backstop index (E3 defense-in-depth).
See ibkr-flex/doc/prd/ibkr-flex-web-service-sync.prd.md (D10).

Cross-import dedup for IBKR is a single app-level block (brokenstock-orchestrator
parseStage step 4 → transactionsApi.queryBrokerageDuplicates, keyed on
brokerage_unique_identifier = tradeID / transactionID). There is otherwise NO DB
uniqueness on brokerage_unique_identifier — transaction_id (a fresh UUID per parse)
is the only unique key — so if that block ever regressed, overlapping re-pulls
(the whole point of the sync) would insert duplicates silently.

This partial UNIQUE index is the backstop: a duplicate IBKR (owner, account,
brokerage_unique_identifier) insert now FAILS LOUD instead of duplicating. It never
fires in normal operation (the app dedup splices duplicates out before insert), so
it does not change the happy path.

SCOPE: IBKR only — mirrors the IBKR-gated app dedup. Other brokerages (Fidelity/
Schwab) rely on non-overlapping files and are NOT transaction-deduped, so a blanket
index could wrongly reject a legitimate future non-IBKR import. Partial predicate
also excludes empty identifiers.

PRECONDITION (verified 2026-07-11 on prod_blue + dev_franz): zero existing
duplicate (owner, account, brokerage_unique_identifier) groups for IBKR (and in
fact across all brokerages), so CREATE UNIQUE INDEX succeeds.

Bumps MIN_SCHEMA_VERSION = 2026-07-11T140000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE UNIQUE INDEX transactions_ibkr_buid_uq
      ON transactions (owner, account, brokerage_unique_identifier)
      WHERE brokerage = 'IBKR'
        AND brokerage_unique_identifier IS NOT NULL
        AND btrim(brokerage_unique_identifier) <> '';
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP INDEX IF EXISTS transactions_ibkr_buid_uq;`);
};
