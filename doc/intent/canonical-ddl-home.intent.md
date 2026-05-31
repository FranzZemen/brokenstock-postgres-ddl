# Intent: Canonical DDL Home

**Status:** Active (since Pre-Era-1.6, 2026-05-30)
**Parent PRD:** `~/dev/projects/doc/prd/pre-era-1.6-centralize-ddl-and-foundation-cleanup.prd.md`

## Why this package exists separate from `postgres-app`

`@franzzemen/postgres-app` is generic, product-agnostic infrastructure: pool,
kysely wrapper, LISTEN/NOTIFY, node-pg-migrate runner, `MIN_SCHEMA_VERSION`
verification. It must stay reusable for any future Postgres consumer —
possibly open-source one day.

Brokenstock-specific DDL (USERS, BROKERAGE_FILE_IMPORTS, AUTH tables, etc.)
has no business living inside that generic library. It lives here.

## Why one canonical home (vs. per-worker `migrations/` directories)

The pre-Era-1.6 federated model had `~/dev/brokenstock-worker-template/migrations/`
holding the worker's schema. The plan was for Era 1's auth-worker to add its own
`~/dev/brokenstock-auth-worker/migrations/`, Era 2's imports-worker to add
`~/dev/brokenstock-imports-worker/migrations/`, etc.

That federates ownership unsustainably:

- When Era 5 needs to add a column to a table Era 2's imports-worker introduced,
  the migration has to land in a worker repo that no longer owns the table's
  conceptual scope.
- Two workers' migrations landing with overlapping timestamps requires
  cross-repo arbitration.
- The sort order across "all Brokenstock migrations" is partitioned per repo,
  not global.

One canonical repo solves all three.

## How Eras contribute

Every Era's DDL work lands here. `pg-app.migrate` (and its wrapper
`abs.migrate`) point at this package; consumers do not import migration files
directly.

Each consumer (auth-worker, imports-worker, ...) declares its own
`MIN_SCHEMA_VERSION` — a timestamp string naming the latest migration filename
its code requires. The consumer rebuilds when its MIN_SCHEMA_VERSION advances,
not when this package publishes.

## Filename format

`YYYY-MM-DDTHHMMSSZ_<snake_case_slug>.cjs`

- ISO 8601 UTC, filesystem-safe (colons replaced with nothing; `Z` literal).
- Underscore separator between timestamp and slug.
- Sortable lexicographically as plain strings — this is what
  `verifyMinSchemaVersion`'s `WHERE name >= $1` query relies on.
- New format sorts AFTER the pre-Era-1.6 epoch-ms format (`1700...` < `2026...`
  lexicographically).

## What the `migrationsDir` export is for

`pg-app.migrate <env> --migrations-package=<pkg>` discovers the migrations
directory by:

1. `require.resolve('<pkg>/package.json')` → finds the installed package.
2. `import('<pkg>')` → reads the package's `migrationsDir` export.

So consumers (and CLIs) never need to know the on-disk layout of this package —
they just import it and read `migrationsDir`.
