/*
Created by Franz Zemen 2026-07-07
License Type: UNLICENSED

Rename the scanner slug `price-size` → `daytrading`
(projects/doc/prd/scanners.prd.md, E17/D21, v0.7.0).

The v1 scanner becomes the Daytrading Scanner. `scanner_slug` is free TEXT (the
registry lives in @franzzemen/scanners, not the DB), so the rename is a pure
data migration of any saved `scanner_settings` filter-sets — only the seeded
rows exist. Idempotent: the guarded UPDATE is a no-op once applied, and skips
any (owner, name) that already has a 'daytrading' row (none expected — the slug
is net-new) to avoid a PK collision.

Pins MIN_SCHEMA_VERSION = 2026-07-07T120000Z for @franzzemen/brokenstock-scanners-worker
(the worker code addresses settings under the new slug).
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    UPDATE scanner_settings s
       SET scanner_slug = 'daytrading'
     WHERE s.scanner_slug = 'price-size'
       AND NOT EXISTS (
         SELECT 1 FROM scanner_settings d
          WHERE d.owner = s.owner
            AND d.name = s.name
            AND d.scanner_slug = 'daytrading'
       );
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    UPDATE scanner_settings s
       SET scanner_slug = 'price-size'
     WHERE s.scanner_slug = 'daytrading'
       AND NOT EXISTS (
         SELECT 1 FROM scanner_settings d
          WHERE d.owner = s.owner
            AND d.name = s.name
            AND d.scanner_slug = 'price-size'
       );
  `);
};
