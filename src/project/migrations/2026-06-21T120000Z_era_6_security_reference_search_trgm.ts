/*
Created by Franz Zemen
License Type: UNLICENSED

Era 6 — Reference Screen search support (reference-screen.prd.md, E1).

Backs the new top-level Reference screen's ticker autocomplete. The screen is
search-driven (no browsable list), so SecurityReferenceApi.search(term) runs an
ILIKE over security_reference on every keystroke:

  WHERE active
    AND (lower(ticker) LIKE lower($1) || '%'      -- symbol prefix
         OR lower(name)  LIKE '%' || lower($1) || '%')  -- company-name substring

The Era-6 schema (2026-06-20T120000Z) gave security_reference only a plain btree
on `ticker` (case-sensitive, prefix-only) and a partial index on `active` — so a
case-insensitive ticker prefix and an unanchored name substring both seq-scan the
entire active US universe per keystroke. With performance paramount on an
every-keystroke path, we add `pg_trgm` GIN trigram indexes on lower(ticker) and
lower(name): trigram GIN serves both ILIKE prefix and ILIKE substring (the
planner decomposes the pattern into trigrams and probes the index), so the two
indexes cover the full search predicate above.

`pg_trgm` is a stock contrib extension (no superuser data, available on Aurora).
CREATE EXTENSION IF NOT EXISTS is idempotent and safe to co-locate with the
index creation in the migration transaction.

Additive only (extension + two indexes; no table/column/data change) — does NOT
bump MIN_SCHEMA_VERSION. CREATE INDEX (not CONCURRENTLY) to stay inside the
node-pg-migrate transaction, matching the repo's other index migrations; the
table is vendor-batch-written and not on a hot OLTP write path, so the brief
build lock is immaterial.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);

  // Case-insensitive ticker prefix (lower(ticker) LIKE 'aapl%') + substring.
  pgm.sql(`
    CREATE INDEX security_reference_ticker_trgm_idx
      ON security_reference USING gin (lower(ticker) gin_trgm_ops);
  `);

  // Company-name substring (lower(name) LIKE '%apple%').
  pgm.sql(`
    CREATE INDEX security_reference_name_trgm_idx
      ON security_reference USING gin (lower(name) gin_trgm_ops);
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP INDEX IF EXISTS security_reference_name_trgm_idx;`);
  pgm.sql(`DROP INDEX IF EXISTS security_reference_ticker_trgm_idx;`);
  // Leave the pg_trgm extension in place — other features may rely on it, and
  // dropping a shared extension on a down-migration is the riskier default.
};
