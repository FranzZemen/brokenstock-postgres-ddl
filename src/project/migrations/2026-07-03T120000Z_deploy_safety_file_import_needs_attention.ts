/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * deploy-safety-and-graceful-shutdown.prd.md — E3 (honest import completion).
 *
 * Adds the terminal-but-flagged 'needs-attention' status to the
 * brokerage_file_imports status CHECK constraint. finalizeProcessStage sets this
 * (instead of 'complete') when a required post-condition — currently: every
 * `transferred shares` transaction the import wrote has a transfer_pending or
 * resolved transfer_events row — is still unmet after a one-shot auto-retry, so a
 * silently-skipped capture surfaces as a flagged import rather than a clean
 * 'complete' (the 2026-07-02 mixed-version-deploy incident).
 *
 * Idempotent: DROP ... IF EXISTS then ADD. The enum lives as TEXT + CHECK (CD-3),
 * mirroring the FileImportStatus union in @franzzemen/financial-identity.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const STATUS_LIST_WITH_NEEDS_ATTENTION = `'none', 'imported',
  'pending split multiple accounts decision',
  'ready for parsing', 'parsing',
  'pending instrument identification',
  'ready for processing', 'adjusting for stock splits',
  'processing', 'processed', 'matched', 'failed',
  'unprocessing', 'deleting', 'retrying',
  'pending duplicate records decision',
  'calculating-dependencies', 'complete', 'needs-attention'`;

const STATUS_LIST_ORIGINAL = `'none', 'imported',
  'pending split multiple accounts decision',
  'ready for parsing', 'parsing',
  'pending instrument identification',
  'ready for processing', 'adjusting for stock splits',
  'processing', 'processed', 'matched', 'failed',
  'unprocessing', 'deleting', 'retrying',
  'pending duplicate records decision',
  'calculating-dependencies', 'complete'`;

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE brokerage_file_imports DROP CONSTRAINT IF EXISTS brokerage_file_imports_status_chk`);
  pgm.sql(`ALTER TABLE brokerage_file_imports
             ADD CONSTRAINT brokerage_file_imports_status_chk
             CHECK (status IN (${STATUS_LIST_WITH_NEEDS_ATTENTION}))`);
};

export const down = (pgm: MigrationBuilder): void => {
  // Reversible only if no rows currently sit at 'needs-attention' (the tighter
  // constraint would reject them). Callers must resolve/unprocess those first.
  pgm.sql(`ALTER TABLE brokerage_file_imports DROP CONSTRAINT IF EXISTS brokerage_file_imports_status_chk`);
  pgm.sql(`ALTER TABLE brokerage_file_imports
             ADD CONSTRAINT brokerage_file_imports_status_chk
             CHECK (status IN (${STATUS_LIST_ORIGINAL}))`);
};
