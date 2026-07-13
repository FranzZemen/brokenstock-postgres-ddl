/*
Created by Franz Zemen 07/13/2026
License Type: UNLICENSED

Drop sessions.effective_permissions + sessions.permissions_stale — for real this time.

History: 2026-07-13T140000Z_drop_effective_permissions dropped these columns while the
deployed workers still SELECTed them, taking prod login down (see that migration and
2026-07-13T160000Z_restore_effective_permissions, which put them back).

The precondition that was unmet then is met now. Every package depending on
@franzzemen/sessions is on ^8.0.1 (which neither reads nor writes these columns), and
all four session-consuming workers are deployed on prod_blue:
    auth-worker@0.3.0, app-worker@0.4.0, admin-app-worker@0.13.0, scanners-worker@0.8.4
lambda-support and users also depend on sessions, but are libraries, not deployed roles.

Nothing reads the columns' contents — entitlements resolve from sessions.features — so
there is no data to preserve. brokenstock-postgres-ddl's schema-types already dropped
both fields, so this migration is what makes the database agree with the types again.

This is a drop-only migration. The plan_version_features `value_number >= 0` CHECK and
the removal of the `resolve-effective-permissions` capability rows both shipped in the
140000Z migration and were NOT reverted by the restore, so they are not repeated here.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE sessions DROP COLUMN IF EXISTS effective_permissions;
    ALTER TABLE sessions DROP COLUMN IF EXISTS permissions_stale;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS effective_permissions JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS permissions_stale BOOLEAN NOT NULL DEFAULT FALSE;
  `);
};
