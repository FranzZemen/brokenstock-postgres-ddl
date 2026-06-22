/*
Created by Franz Zemen
License Type: UNLICENSED

Assign-Plans-to-Users (user-subscriptions/doc/prd/assign-plans-to-users.prd.md, E2).

`session.features` is the first-class plan-feature entitlement set resolved at login
from the user's active subscriptions (user-subscriptions `resolveFeatures` →
`Record<slug, true | number>`) and hydrated on every session read. It supersedes the
dormant `effective_permissions` column ("old thinking, being retired") — that column is
LEFT IN PLACE and untouched; new consumers (financial-data's real-time gate, and later
the orchestrator yield-pricing gate) read `features`, not `effective_permissions`.

This migration adds `sessions.features JSONB NOT NULL DEFAULT '{}'` — additive only
(nullable-with-default semantics; no data rewrite). Existing rows get `{}` (no grants);
the value is populated at the next session start by `startSession`.

Pins MIN_SCHEMA_VERSION = 2026-06-22T120000Z for consumers that read `sessions.features`
(the `sessions` package, once it persists/hydrates the column).
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.addColumn('sessions', {
    features: {
      type: 'jsonb',
      notNull: true,
      default: '{}',
    },
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropColumn('sessions', 'features', {ifExists: true});
};
