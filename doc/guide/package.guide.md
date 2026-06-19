# `@franzzemen/brokenstock-postgres-ddl` — Guide

**Audience:** Maintainers adding migrations to Brokenstock's canonical DDL home.
**Companion docs:** [intent](../intent/canonical-ddl-home.intent.md), [usage](../usage/package.usage.md).

## What this package is

The single, canonical source of every Brokenstock-specific Postgres migration
across Eras. It exports one symbol — `migrationsDir` — pointing at the
directory of transpiled node-pg-migrate files. It is consumed by the worker
chain transitively through `@franzzemen/brokenstock-worker-template`.

## Prerequisites for maintainers

- Local dev shell with `aws` CLI v2, `git`, Node 22+.
- `@franzzemen/build-system` available via `npx`.
- Familiarity with node-pg-migrate's TypeScript migration API
  (https://salsita.github.io/node-pg-migrate/).

No Aurora reach is required to edit migrations; the package itself has no
integration tests today. The schemas are exercised end-to-end by worker-template's
integration tests after publish + install.

## Source layout

```
src/project/
  index.ts                       ← exports migrationsDir
  migrations/
    2026-05-30T140000Z_smoke_events.ts
    2026-05-30T140030Z_worker_jobs.ts
    ...
```

Post-`bs.build`:

```
out/project/
  index.js                       ← migrationsDir = join(here, 'migrations')
  migrations/
    2026-05-30T140000Z_smoke_events.js
    ...
```

node-pg-migrate 8.x reads all non-dotfile entries in `migrationsDir`, sorts
them lexicographically by name, and runs unapplied ones in order.

## Adding a migration

1. Pick a UTC ISO timestamp and a snake_case slug. Filename format:
   `YYYY-MM-DDTHHMMSSZ_<slug>.ts` (see [intent doc](../intent/canonical-ddl-home.intent.md#filename-format)).

   ```bash
   TS=$(date -u +"%Y-%m-%dT%H%M%SZ")
   FILE="src/project/migrations/${TS}_add_user_email_index.ts"
   ```

2. Write the migration. node-pg-migrate TS shape:

   ```ts
   import type {MigrationBuilder} from 'node-pg-migrate';

   export async function up(pgm: MigrationBuilder): Promise<void> {
     pgm.createIndex('users', 'email', {unique: true});
   }

   export async function down(pgm: MigrationBuilder): Promise<void> {
     pgm.dropIndex('users', 'email');
   }
   ```

3. Build and confirm the transpiled `.js` lands next to its siblings:

   ```bash
   npx bs.build
   ls out/project/migrations/
   ```

4. If a consumer's code depends on the new schema, bump that consumer's
   `MIN_SCHEMA_VERSION` constant to this migration's filename (the bare
   timestamp string, no extension). Example in
   `brokenstock-worker-template/src/project/schema-version.ts`:

   ```ts
   export const MIN_SCHEMA_VERSION = '2026-05-31T101500Z';
   ```

   `MIN_SCHEMA_VERSION` ties the consumer's deploy to the migration: `abs.deploy`'s
   pre-flight `verify` refuses to roll out new code if Aurora's
   `pgmigrations*` table doesn't yet hold a row with `name >= MIN_SCHEMA_VERSION`.

   Don't bump for migrations the consumer doesn't depend on — DDL can land
   ahead of code that uses it.

## Publish flow

Standard `@franzzemen/*` publish via `@franzzemen/build-system`:

```bash
npx bs.minor "describe the new migrations or schema change"
# or bs.patch / bs.major as appropriate
```

This package belongs in `~/dev/projects/package.json`'s `npmuDependencies`
chain (after `postgres-app`, before `brokenstock-worker-template`). A
chain-wide refresh via `npx npmu` will rebuild and republish this in order;
typically you publish only this package + downstream when iterating.

There is no `files:` whitelist in `package.json` (Pre-Era-1.7 D12) — npm ships
everything not gitignored. The effective payload is `out/project/`. If you
ever feel the urge to re-introduce `files:`, don't — the empty `0.1.0`
tarball failure was caused by exactly that whitelist.

## How consumers pick it up

`@franzzemen/brokenstock-worker-template` declares this package as a regular
`dependency`. When the worker artifact is built (`bs.server-build`), npm
resolves this package and includes it in the tarball's `node_modules/`. On
deploy the host's `/opt/brokenstock/current/node_modules/@franzzemen/brokenstock-postgres-ddl/`
points at the version locked into that artifact.

`abs.migrate` then calls `pg-app.migrate` against the DDL package; see the
[usage doc](../usage/package.usage.md) for both the CLI and the in-process call shape.

## What does not live here

- **Runtime config** (`config.json.encrypt`). Production callers bootstrap
  via `loadSecretsExecutionConfigsFunction` reading from Secrets Manager
  (Pre-Era-1.7 D1). This package ships no config.
- **Per-consumer `MIN_SCHEMA_VERSION` constants.** Each worker package owns
  its own gate.
- **Consumer-specific helpers** (kysely `Database` interfaces, table query
  helpers, etc.). Those live in the consumer.

## Operational notes

- **One global timeline.** All Eras land migrations here in ISO timestamp
  order. Resist any temptation to fork per-domain subdirectories — it breaks
  the global sort that `verifyMinSchemaVersion` relies on.
- **No `down` cascade in production.** node-pg-migrate's `down` exists for
  local rework; production rollbacks are forward-only via a follow-up
  migration. Write `down` for hygiene, but don't rely on it.
- **Don't import migration files directly.** Consumers import the
  `migrationsDir` path, not the migration modules.

## Fleet Admin Console schema (0.13.24)

The Fleet Admin Console added (migration in the global timeline, shipped 0.13.24,
migrated to prod_blue + dev_franz):

- **`fleet_admin_audit`** — append-only audit log of every console mutation
  (restart/stop/start/prune/redeploy/rollback): actor, action, target, params, result,
  timestamp. The console's DB-REST gateway (`admin-app-worker` `/admin/fleet/audit`) is the
  only writer.
- **Three capabilities** seeded on `admin-tools-administrator-role`: `fleet:read`
  (monitor), `fleet:runtime-control` (the runtime mutations above), `fleet:iac-control`
  (reserved for console epics E7/E8, not yet wired to actions).

PRD: `~/dev/projects/doc/prd/fleet-admin-console.prd.md`.
