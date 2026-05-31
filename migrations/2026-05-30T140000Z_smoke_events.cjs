/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * smoke_events table — the only schema state the worker depends on.
 * Future templates derived from this repo add their own migrations and
 * bump MIN_SCHEMA_VERSION accordingly.
 */

exports.up = (pgm) => {
  pgm.createTable('smoke_events', {
    id: {type: 'serial', primaryKey: true},
    payload: {type: 'text', notNull: true},
    created_at: {type: 'timestamptz', notNull: true, default: pgm.func('now()')},
  });
};

exports.down = (pgm) => {
  pgm.dropTable('smoke_events');
};
