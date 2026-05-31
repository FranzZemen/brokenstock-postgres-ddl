# `@franzzemen/brokenstock-postgres-ddl` — Usage

**Companion docs:** [intent](../intent/canonical-ddl-home.intent.md), [guide](../guide/package.guide.md).

Two call shapes — pick whichever fits the caller.

## CLI: `pg-app.migrate`

The normal path. `@franzzemen/postgres-app`'s bin script discovers this
package by name and runs node-pg-migrate against its `migrationsDir`.

```bash
BROKENSTOCK_DB=dev_franz \
  npx -y -p @franzzemen/postgres-app pg-app.migrate nonprod \
  --migrations-package=@franzzemen/brokenstock-postgres-ddl
```

- `nonprod` (positional) picks the environment block consumed by
  `@franzzemen/execution-context-secrets-loader` (Pre-Era-1.7 D7). No
  `AWSSECRET`; no `./config.json.encrypt` cwd assumption.
- `BROKENSTOCK_DB` selects the `aws.rds.<role>` sub-block (which database
  inside the cluster).
- `--migrations-package=<name>` triggers
  `require.resolve('<name>/package.json')` discovery → import →
  `migrationsDir`.

This is what `abs.migrate`'s SSM Document invokes on the worker host.

## In-process call: `runMigrations`

For callers that already hold a pool (tests, scripts, an in-process apply
during local dev):

```ts
import {migrationsDir} from '@franzzemen/brokenstock-postgres-ddl';
import {runMigrations} from '@franzzemen/postgres-app/migrations';

await runMigrations(ec, pool, {
  direction: 'up',
  migrationsDir,
  migrationsTable: 'pgmigrations', // or per-consumer suffix when sharing a DB
});
```

`migrationsDir` is the absolute path to `out/project/migrations/` inside the
installed package — usable verbatim by node-pg-migrate.

## Verify a consumer's `MIN_SCHEMA_VERSION`

Boot-time / deploy pre-flight gate. The consumer owns the version string;
this package owns the migrations the string names.

```ts
import {verifyMinSchemaVersion} from '@franzzemen/postgres-app/migrations';
import {MIN_SCHEMA_VERSION} from './schema-version.js';

await verifyMinSchemaVersion(ec, pool, MIN_SCHEMA_VERSION, 'pgmigrations_<consumer>');
```

If Aurora's `pgmigrations*` table has no row with `name >= MIN_SCHEMA_VERSION`,
the call throws `MinSchemaVersionError`. Run `pg-app.migrate` (or
`abs.migrate`) against the right env first.
