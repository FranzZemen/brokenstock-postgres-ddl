/*
Created by Franz Zemen
License Type: UNLICENSED

Admin Batch Control & Observability — PRD E1 / D6.

Seed `batch-jobs:run-capability` onto the existing `admin-tools-administrator-role`
(already assigned to StiSelini; see 2026-06-10T140000Z + 2026-06-10T150000Z). The
admin "Run now" launch route is gated on this capability (status reads keep using
the existing `batch-jobs:read-capability`). Idempotent (ON CONFLICT DO NOTHING).
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const BOOTSTRAP_UUID = '00000000-0000-0000-0000-000000000000.user';
const ROLE = 'admin-tools-administrator-role';
const CAP = 'batch-jobs:run-capability';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    INSERT INTO role_capabilities (role_name, capability, created_by, updated_by) VALUES
      ('${ROLE}', '${CAP}', '${BOOTSTRAP_UUID}', '${BOOTSTRAP_UUID}')
    ON CONFLICT (role_name, capability) DO NOTHING;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DELETE FROM role_capabilities WHERE role_name = '${ROLE}' AND capability = '${CAP}';`);
};
