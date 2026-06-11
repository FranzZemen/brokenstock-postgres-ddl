# Intent: Canonical DDL Home

**Status:** Active (since Pre-Era-1.6, 2026-05-30; amended Pre-Era-1.7, 2026-05-31; S3-transport decoupling 2026-05-31)
**Parent PRDs:**
- `~/dev/projects/doc/prd/pre-era-1.6-centralize-ddl-and-foundation-cleanup.prd.md`
- `~/dev/projects/doc/prd/pre-era-1.7-secrets-loader-and-migration-shape.prd.md`

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
its code requires. The consumer rebuilds when its `MIN_SCHEMA_VERSION` advances,
not when this package publishes.

## Source layout (Pre-Era-1.7 D4)

```
src/project/
  index.ts                ← exports migrationsDir
  migrations/
    YYYY-MM-DDTHHMMSSZ_<snake_case_slug>.ts
```

Build pipeline (`tsc` via `@franzzemen/build-system`) transpiles to:

```
out/project/
  index.js
  migrations/
    YYYY-MM-DDTHHMMSSZ_<snake_case_slug>.js
```

Migrations are authored as TypeScript ESM under `src/project/migrations/`,
matching the rest of the `@franzzemen/*` source convention. node-pg-migrate 8.x
discovers the transpiled `.js` files in `migrationsDir` directly — no extra
configuration needed beyond pointing it at the directory.

Pre-Era-1.6 used `migrations/*.cjs` at the repo root with `out/project/index.js`
walking three parents up to find them. Pre-Era-1.7 retired that layout: the
migrations now live inside the source tree alongside `index.ts`, and post-build
`out/project/index.js` reads its sibling `migrations/` directory:

```ts
export const migrationsDir = join(here, 'migrations');
```

## Filename format

`YYYY-MM-DDTHHMMSSZ_<snake_case_slug>.ts`

- ISO 8601 UTC, filesystem-safe (colons removed; `Z` literal).
- Underscore separator between timestamp and slug.
- Sortable lexicographically as plain strings — this is what
  `verifyMinSchemaVersion`'s `WHERE name >= $1` query relies on.
- Sorts after the pre-Era-1.6 epoch-ms format (`1700...` < `2026...`
  lexicographically), so the format change is forward-compatible with any
  pre-existing rows in `pgmigrations*` tables.

## What the `migrationsDir` export is for

`pg-app.migrate <env> --migrations-package=<pkg>` discovers the migrations
directory by:

1. `require.resolve('<pkg>/package.json')` → finds the installed package.
2. `import('<pkg>')` → reads the package's `migrationsDir` export.

Consumers (and the CLI) never need to know the on-disk layout of this package —
they just import it and read `migrationsDir`.

## Runtime configuration (Pre-Era-1.7 D1)

This package ships **no `config.json.encrypt`**. Production runtime config
(Aurora endpoints, IAM users, pool sizing) is delivered to `pg-app.migrate` by
`@franzzemen/execution-context-secrets-loader`, reading from the same Secrets
Manager secret-set the broken-stock-admin tooling writes. The host's IAM role
(`Secrets-Manager-User-Policy`) authorises the read; no `AWSSECRET` env var is
involved.

This package may grow integration tests in the future. If/when it does, they'll
use a local `config.json.encrypt` per the global D2 test-vs-production split —
but that file is never shipped in the npm tarball.

## What ships in the npm tarball (Pre-Era-1.7 D12)

`package.json` declares no `files:` field. npm's default behaviour ships
everything not gitignored; the practical effect is `out/project/index.js` plus
`out/project/migrations/*.js`. The Pre-Era-1.6 `files: ["out/", "migrations/",
"config.json.encrypt"]` whitelist was the root cause of the empty `0.1.0`
tarball (paths didn't exist relative to where `npm publish` was invoked); the
no-`files:` pattern matches `postgres-app` and removes the failure mode.

## Consumption path (S3-transport decoupling, 2026-05-31)

As of `@franzzemen/aws-build-system` 0.3.8, this package is consumed via
S3, not via the worker artifact's `node_modules/` closure. This is the
Shape B path (a standalone DDL tarball deployed independently of worker
artifacts) — pulled forward from Beta Era because Pre-Era-1.7 already
needed it to land schema changes without rebuilding worker-template every
time a migration drops.

### Migration mechanics

DDL releases use a two-step publish:

1. **`bs.publish`** in this repo — publishes to npm. Paper trail only;
   npm is not on the migration hot path.
2. **`abs.ddl-publish <env>`** — `npm pack`s the built `out/project/`
   tree, uploads the tarball to
   `s3://brokenstock-<env>-deploys/<pkg>/<ver>/<pkg>-<ver>.tgz`, and
   writes a plain-text `latest` pointer object at
   `s3://brokenstock-<env>-deploys/<pkg>/latest` whose body is the
   semver string. Same bucket and IAM model as `abs.publish`.

`abs.migrate <env> <role> <ver> [--ddl-version <semver>]` then dispatches
the `BrokenstockMigrate-<env>` SSM Document. The worker host:

1. Resolves `--ddl-version` (default `latest`) by reading the S3 `latest`
   pointer.
2. Downloads the corresponding tarball into a per-invocation scratch
   directory and extracts it.
3. Invokes `$CURRENT/node_modules/.bin/pg-app.migrate <role>
   --migrations-dir=<scratch>/package/migrations [--direction ...]
   [--count ...]`.
4. Discards the scratch directory after the run.

No npm install on the host. The worker artifact's bundled `pg-app.migrate`
must be **≥ postgres-app 1.1.9** (the version that introduced
`--migrations-dir`); older worker artifacts cannot consume DDL via this
path and must be redeployed before migrations can land.

The prior Shape A path — `cd
$CURRENT/node_modules/@franzzemen/brokenstock-postgres-ddl/` and discover
migrations via `--migrations-package` — is retired. Worker-template no
longer needs this package in its dependency closure for the migration
path to work; transitive dependencies remain only insofar as other code
(e.g., MIN_SCHEMA_VERSION verification at consumer boot) still resolves
`migrationsDir` from the npm-installed copy.

### `pg_cron` extension prerequisite (prod_blue only)

The C4 sessions migration uses `pg_cron` for scheduled cleanup of expired
session rows. `pg_cron` is an Aurora-managed extension that must be enabled
at the **cluster master** level — `CREATE EXTENSION pg_cron;` cannot run
inside a node-pg-migrate transaction against a non-master node, and the
extension itself must be added to the cluster's parameter group's
`shared_preload_libraries`.

For Pre-Era-1.7, this is handled out-of-band on prod_blue only:

1. Operator connects to the Aurora
   prod_blue cluster master as a sufficiently-privileged role.
2. Runs `CREATE EXTENSION pg_cron;` once. This is idempotent against an
   already-installed extension.
3. The C4 sessions migration then runs normally via `abs.migrate`.

The sessions migration **self-skips on non-prod_blue databases** — the
cron-scheduling SQL is guarded by a check on `current_database()` so that
running migrations against scratch DBs, integration-test DBs, or future
non-prod_blue prod databases does not fail on a missing extension.

Future CDK-managed automation of the `CREATE EXTENSION pg_cron` step (plus
the parameter-group `shared_preload_libraries` change) is a Pre-Era-2.x
consideration; tracked alongside other cluster-bootstrap automation.
