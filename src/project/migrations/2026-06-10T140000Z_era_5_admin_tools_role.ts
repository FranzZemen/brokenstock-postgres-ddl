/*
Created by Franz Zemen
License Type: UNLICENSED

Era 5 — `admin-tools-administrator-role`: closes the FAIL-OPEN authz gap on the
admin-app-worker routes that had NO hasAccess hop (config editor, operational
alerts / observability / ops-split-metrics). Those routes now call
requireCapability(...) → EndpointApplicationsApi.hasAccess, which validates the
capability by shape (`<domain>:<name>-capability`) against role_capabilities — so
these capability strings need not live in the closed-set enum.

Per Franz (2026-06-10): FOLD config + alerts under ONE role for now; separate later.

Seeds:
  - role `admin-tools-administrator-role`
  - role_capabilities: that role → admin-config:read/write + operational-alerts:read/write
  - user_roles: assigns the role to user 'StiSelini' (the verified admin; looked up by
    username, NOT a hardcoded UUID). No-op where that user doesn't exist (e.g. dev_franz).

Idempotent: INSERT ... ON CONFLICT DO NOTHING.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const BOOTSTRAP_UUID = '00000000-0000-0000-0000-000000000000.user';
const ROLE = 'admin-tools-administrator-role';
const ADMIN_USERNAME = 'StiSelini';

const CAPS = [
  'admin-config:read-capability',
  'admin-config:write-capability',
  'operational-alerts:read-capability',
  'operational-alerts:write-capability',
];

const esc = (s: string): string => s.replace(/'/g, "''");

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    INSERT INTO roles (name, description, created_by, updated_by) VALUES
      ('${ROLE}', 'Folded admin-tools role: config editor + operational alerts (Era 5; split later).', '${BOOTSTRAP_UUID}', '${BOOTSTRAP_UUID}')
    ON CONFLICT (name) DO NOTHING;
  `);
  const capValues = CAPS
    .map((cap) => `('${ROLE}', '${esc(cap)}', '${BOOTSTRAP_UUID}', '${BOOTSTRAP_UUID}')`)
    .join(',\n      ');
  pgm.sql(`
    INSERT INTO role_capabilities (role_name, capability, created_by, updated_by) VALUES
      ${capValues}
    ON CONFLICT (role_name, capability) DO NOTHING;
  `);
  // Assign to the verified admin user by username (no-op if absent in this DB).
  pgm.sql(`
    INSERT INTO user_roles (user_uuid, role_name, created_by, updated_by)
    SELECT uuid, '${ROLE}', '${BOOTSTRAP_UUID}', '${BOOTSTRAP_UUID}'
    FROM users WHERE username = '${esc(ADMIN_USERNAME)}'
    ON CONFLICT (user_uuid, role_name) DO NOTHING;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DELETE FROM user_roles WHERE role_name = '${ROLE}';`);
  pgm.sql(`DELETE FROM role_capabilities WHERE role_name = '${ROLE}';`);
  pgm.sql(`DELETE FROM roles WHERE name = '${ROLE}';`);
};
