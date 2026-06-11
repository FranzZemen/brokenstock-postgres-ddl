/*
Created by Franz Zemen
License Type: UNLICENSED

Era 5 — make security_aliases.security_key NULLABLE.

The Era-2 table defined `security_key TEXT NOT NULL REFERENCES securities(key)`,
but the application deliberately exempts `ignored` and `unlisted` aliases from
needing a real security (securities-alias.trusted.api: `if (!ignored && !unlisted)`
skips the existence check). Those aliases represent symbols with NO security
counterpart (e.g. a cash/money-market symbol like SPAXX). The NOT NULL + FK
rejected them at insert time (FK violation on `security_aliases_security_key_fkey`).

Dropping NOT NULL lets ignored/unlisted aliases store NULL security_key — the FK
is not enforced for NULL, which is exactly the intended semantics. Non-ignored
aliases still store a real, FK-checked key. Identity is the PK (alias_type, alias)
+ the ignored/unlisted flags; security_key was never the marker.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE security_aliases ALTER COLUMN security_key DROP NOT NULL;`);
};

export const down = (pgm: MigrationBuilder): void => {
  // Re-imposing NOT NULL would fail if any ignored/unlisted rows hold NULL; this
  // backfills them to the alias value first (their original placeholder key).
  pgm.sql(`
    UPDATE security_aliases SET security_key = alias WHERE security_key IS NULL;
    ALTER TABLE security_aliases ALTER COLUMN security_key SET NOT NULL;
  `);
};
