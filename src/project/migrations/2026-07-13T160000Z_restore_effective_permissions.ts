/*
Created by Franz Zemen 07/13/2026
License Type: UNLICENSED

INCIDENT RECOVERY — restores sessions.effective_permissions + sessions.permissions_stale.

2026-07-13T140000Z_drop_effective_permissions dropped these two columns. It was
written on the assumption that the sessions@8.0.0 workers (which no longer SELECT
them) would be deployed FIRST. That ordering did not hold: `abs.ddl-publish` packs
the tarball from the shared local working tree, so the drop migration was swept into
an unrelated 0.28.2 DDL train and applied to prod_blue while the deployed workers were
still auth-worker@0.2.1 — i.e. still reading the columns. Every session read then
failed with `column sessions.effective_permissions does not exist`, which surfaced as
a 500 on POST /login for both the trader and admin apps.

This migration puts the columns back so the CURRENTLY DEPLOYED workers work again. It
is a forward migration, not a rollback, because a `--direction down --count N` would
have reverted an unrelated later migration (schwab_json_parser) that sorts after the
drop.

The columns are restored to their original definition and left EMPTY ('{}' / false) —
nothing reads their contents any more (the live code path resolves entitlements from
sessions.features), so no data reconstruction is required. They exist purely so the
old code's SELECT projection resolves.

Re-dropping them is deliberately NOT re-attempted here. Do it only after every
sessions-consuming worker (auth-worker, app-worker, admin-app-worker, scanners-worker)
is deployed on sessions@8.0.0 or later, in a migration with a LATER timestamp.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS effective_permissions JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS permissions_stale BOOLEAN NOT NULL DEFAULT FALSE;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE sessions DROP COLUMN IF EXISTS effective_permissions;
    ALTER TABLE sessions DROP COLUMN IF EXISTS permissions_stale;
  `);
};
