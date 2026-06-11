/*
Created by Franz Zemen
License Type: UNLICENSED

Era 5 — seed the role_capabilities rows for the subscription-plans and
user-subscriptions admin domains. These capabilities are part of the code's
closed set (endpoint-application `resource-domain-capability.ts`) and the
subscription-plans-api / user-subscriptions-api ENFORCE them via hasAccess →
ResourceAccessException. But the 2026-06-09 role_capabilities_seed captured the
then-current prod_blue rows VERBATIM (62 pairs) and contained ZERO rows for these
two domains — so every subscription/user-subscription admin route has been
failing closed (403) on prod_blue since the Era-3.5 cutover. (admin-app-worker
always ran the REAL hasAccess; the lambda-support `hasAccess→true` bypass it
never used was removed in Era-5 F.1 regardless.)

This grants:
  - subscription-plans-administrator-role        → all 19 subscription-plans caps
  - subscription-plans-reader-role               → the read-only (list/get) subset
  - user-subscriptions-administrator-role        → all 11 user-subscriptions caps
  - user-subscriptions-owner-role                → the owner read subset

NOTE: this maps capabilities to ROLES. For an admin user to benefit they must HOLD
the relevant *-administrator-role (user_roles). Role assignment is runtime data
(not seeded here); if the admin user predates these roles, assign them via the
admin user-management UI (whose own user:* caps are already seeded).

Idempotent: INSERT ... ON CONFLICT DO NOTHING. Mirrors the 2026-06-09 seed.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const BOOTSTRAP_UUID = '00000000-0000-0000-0000-000000000000.user';

const SP = (c: string) => `subscription-plans:${c}-capability`;
const US = (c: string) => `user-subscriptions:${c}-capability`;

const SP_ALL = [
  'list-plans', 'get-plan', 'put-plan', 'delete-plan',
  'list-features', 'get-feature', 'put-feature', 'delete-feature',
  'put-plan-feature', 'delete-plan-feature', 'list-plan-features',
  'list-plan-versions', 'get-plan-version', 'put-plan-version',
  'activate-plan-version', 'archive-plan-version',
  'put-plan-version-feature', 'delete-plan-version-feature', 'list-plan-version-features',
].map(SP);
const SP_READ = ['list-plans', 'get-plan', 'list-features', 'get-feature',
  'list-plan-features', 'list-plan-versions', 'get-plan-version', 'list-plan-version-features'].map(SP);

const US_ALL = [
  'put-user-subscription', 'get-user-subscription', 'list-user-subscriptions',
  'expire-user-subscription', 'delete-user-subscription',
  'put-feature-usage', 'get-feature-usage', 'list-feature-usages', 'delete-feature-usage',
  'list-feature-usages-due-for-reset', 'resolve-effective-permissions',
].map(US);
const US_OWNER = ['get-user-subscription', 'list-user-subscriptions',
  'get-feature-usage', 'list-feature-usages', 'resolve-effective-permissions'].map(US);

const ROLE_CAPABILITIES: ReadonlyArray<readonly [string, string]> = [
  ...SP_ALL.map((c) => ['subscription-plans-administrator-role', c] as const),
  ...SP_READ.map((c) => ['subscription-plans-reader-role', c] as const),
  ...US_ALL.map((c) => ['user-subscriptions-administrator-role', c] as const),
  ...US_OWNER.map((c) => ['user-subscriptions-owner-role', c] as const),
];

const esc = (s: string): string => s.replace(/'/g, "''");

export const up = (pgm: MigrationBuilder): void => {
  const values = ROLE_CAPABILITIES
    .map(([role, cap]) => `('${esc(role)}', '${esc(cap)}', '${BOOTSTRAP_UUID}', '${BOOTSTRAP_UUID}')`)
    .join(',\n      ');
  pgm.sql(`
    INSERT INTO role_capabilities (role_name, capability, created_by, updated_by) VALUES
      ${values}
    ON CONFLICT (role_name, capability) DO NOTHING;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  const pairs = ROLE_CAPABILITIES
    .map(([role, cap]) => `('${esc(role)}', '${esc(cap)}')`)
    .join(', ');
  pgm.sql(`DELETE FROM role_capabilities WHERE (role_name, capability) IN (${pairs});`);
};
