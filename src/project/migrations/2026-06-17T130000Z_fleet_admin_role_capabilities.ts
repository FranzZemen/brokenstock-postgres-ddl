/*
Created by Franz Zemen
License Type: UNLICENSED

Fleet Admin Console (PRD fleet-admin-console, E2 / D8) — seed the three
fleet capabilities onto `admin-tools-administrator-role` (the role already
exists + is assigned to StiSelini per 2026-06-10T140000Z). The three mirror the
control-plane tiers:

  fleet:read-capability            — MONITOR + read/write the audit trail
  fleet:runtime-control-capability — restart/stop/start a unit, prune releases,
                                     redeploy/rollback a known version
  fleet:iac-control-capability     — registry edits, host-shape changes,
                                     instance lifecycle (cdk/abs)

A UI typed-confirmation gate sits on top of the destructive actions regardless
of capability (capability = who can; confirmation = blast-radius brake).
Idempotent (ON CONFLICT DO NOTHING). Folded into the same admin role per the
existing admin-app-worker convention (split later if needed).
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const BOOTSTRAP_UUID = '00000000-0000-0000-0000-000000000000.user';
const ROLE = 'admin-tools-administrator-role';
const CAPS = [
  'fleet:read-capability',
  'fleet:runtime-control-capability',
  'fleet:iac-control-capability',
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
