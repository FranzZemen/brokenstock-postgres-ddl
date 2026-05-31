/*
Created by Franz Zemen
License Type: UNLICENSED

@franzzemen/brokenstock-postgres-ddl — canonical home of every Brokenstock-
specific Postgres migration across Eras. Exports the absolute path of the
`migrations/` directory so `pg-app.migrate` (from @franzzemen/postgres-app)
can discover it via `require.resolve('@franzzemen/brokenstock-postgres-ddl')`.

Consumers do not import the migration files directly. They import
`migrationsDir` and pass it to `runMigrations`, or they invoke
`pg-app.migrate <env> --migrations-package=@franzzemen/brokenstock-postgres-ddl`
which does the discovery automatically.

Layout (post-build):
  out/project/index.js              ← this module (built artifact)
  out/project/migrations/*.js       ← transpiled migration files (sibling dir)

The path math: index.js lives at out/project/index.js → join with
'migrations' resolves to out/project/migrations/, where node-pg-migrate
discovers .js files and loads them as ESM (per the package's
`"type": "module"`).
*/

import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the `migrations/` directory inside this published package.
 * Resolves correctly whether imported from `out/project/index.js` (post-build)
 * or from `node_modules/@franzzemen/brokenstock-postgres-ddl/out/project/index.js`
 * (consumer install).
 */
export const migrationsDir: string = join(here, 'migrations');
