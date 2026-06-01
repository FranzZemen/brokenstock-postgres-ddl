/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * market_calendar — Era 2 C1. Deviation B parent: per (mic, year) refresh
 * metadata. The DDB whole-row merge-upsert (`MARKET_CALENDAR` with
 * `holidays` array on the same row) splits into this metadata table +
 * `market_calendar_holidays` with one row per holiday. NOT emitted via
 * NOTIFY — refresh metadata is operational state.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE market_calendar (
      mic           TEXT NOT NULL,
      year          INTEGER NOT NULL,
      refreshed_at  TIMESTAMPTZ NOT NULL,
      source        TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by    TEXT NOT NULL,
      updated_by    TEXT NOT NULL,
      PRIMARY KEY (mic, year),
      CONSTRAINT market_calendar_created_by_format_chk
        CHECK (created_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$'),
      CONSTRAINT market_calendar_updated_by_format_chk
        CHECK (updated_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$')
    );
  `);
  pgm.sql(`
    CREATE TRIGGER market_calendar_set_updated_at BEFORE UPDATE ON market_calendar
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS market_calendar_set_updated_at ON market_calendar;`);
  pgm.dropTable('market_calendar');
};
