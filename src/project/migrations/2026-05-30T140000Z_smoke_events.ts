/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * smoke_events table — the only schema state the worker depends on.
 * Future templates derived from this repo add their own migrations and
 * bump MIN_SCHEMA_VERSION accordingly.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('smoke_events', {
    id: {type: 'serial', primaryKey: true},
    payload: {type: 'text', notNull: true},
    created_at: {type: 'timestamptz', notNull: true, default: pgm.func('now()')},
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('smoke_events');
};
