/*
Created by Franz Zemen
License Type: UNLICENSED

Era 5 — extend `admin-tools-administrator-role` to cover the last two fail-open
admin-app-worker route modules (option-adjustments + batch-jobs thin status),
now gated by requireCapability. Folded into the same role per Franz (split later).
The role already exists + is assigned to StiSelini (2026-06-10T140000Z migration);
this only adds capability rows. Idempotent (ON CONFLICT DO NOTHING).
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const BOOTSTRAP_UUID = '00000000-0000-0000-0000-000000000000.user';
const ROLE = 'admin-tools-administrator-role';
const CAPS = [
  'option-adjustments:read-capability',
  'option-adjustments:write-capability',
  'batch-jobs:read-capability',
];

const esc = (s: string): string => s.replace(/'/g, "''");

export const up = (pgm: MigrationBuilder): void => {
  const values = CAPS
    .map((cap) => `('${ROLE}', '${esc(cap)}', '${BOOTSTRAP_UUID}', '${BOOTSTRAP_UUID}')`)
    .join(',\n      ');
  pgm.sql(`
    INSERT INTO role_capabilities (role_name, capability, created_by, updated_by) VALUES
      ${values}
    ON CONFLICT (role_name, capability) DO NOTHING;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  const list = CAPS.map((c) => `'${esc(c)}'`).join(', ');
  pgm.sql(`DELETE FROM role_capabilities WHERE role_name = '${ROLE}' AND capability IN (${list});`);
};
