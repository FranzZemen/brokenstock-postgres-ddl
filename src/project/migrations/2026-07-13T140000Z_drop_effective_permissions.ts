/*
Created by Franz Zemen 07/13/2026
License Type: UNLICENSED

Retire `effectivePermissions` and the dormant permission-staleness machinery.

`sessions.features` (2026-06-22T120000Z) superseded `effective_permissions` as the
first-class entitlement set. Every consumer now reads `features`; nothing reads or
writes `effective_permissions` any more. `permissions_stale` was never set to true
by production code — its only emitter (the `x-permissions-stale` response header in
lambda-support) served the decommissioned outside-VPC lambdas — so the flag has been
permanently false and the header permanently absent. Both columns go.

ORDERING: the sessions package must ALREADY be deployed at the version that stops
SELECTing these columns before this migration runs. A stale reader 500s on a dropped
column. sessions' MIN_SCHEMA_VERSION is deliberately NOT pinned forward to this
migration precisely so that ordering is possible.

Also tightens plan_version_features: `value_number` had no non-negative CHECK (only
`subscription_features.default_limit` did), so a negative limit was storable. Under
the three-state quantity contract a limit <= 0 is not a limit at all — "not granted"
is expressed by omitting the row, and "unlimited" by `value_bool = true` — so a
negative value is meaningless and now rejected.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE sessions DROP COLUMN IF EXISTS effective_permissions;
    ALTER TABLE sessions DROP COLUMN IF EXISTS permissions_stale;

    ALTER TABLE plan_version_features
      ADD CONSTRAINT pvf_value_number_non_negative_chk
      CHECK (value_number IS NULL OR value_number >= 0);

    DELETE FROM role_capabilities
      WHERE capability = 'user-subscriptions:resolve-effective-permissions-capability';
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE plan_version_features
      DROP CONSTRAINT IF EXISTS pvf_value_number_non_negative_chk;

    ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS effective_permissions JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS permissions_stale BOOLEAN NOT NULL DEFAULT FALSE;
  `);
  // The dropped capability rows are not restored: the capability constant no longer
  // exists in endpoint-application, so nothing could reference it after a rollback.
};
