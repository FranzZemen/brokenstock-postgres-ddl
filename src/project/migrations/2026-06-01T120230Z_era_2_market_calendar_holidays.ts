/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * market_calendar_holidays — Era 2 C1. Deviation B child: one row per holiday
 * (mic, holiday_date). Replaces the DDB array-on-row-merge pattern. No FK to
 * market_calendar — holiday rows reference (mic, year) by implicit composite;
 * refresh writes are transactional (DELETE existing for (mic, year) + INSERT
 * new + UPSERT metadata). Emits via NOTIFY on the
 * `market-calendar-holiday-changed` channel.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE market_calendar_holidays (
      mic           TEXT NOT NULL,
      holiday_date  DATE NOT NULL,
      name          TEXT NOT NULL,
      early_close   TIME,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by    TEXT NOT NULL,
      updated_by    TEXT NOT NULL,
      PRIMARY KEY (mic, holiday_date),
      CONSTRAINT market_calendar_holidays_created_by_format_chk
        CHECK (created_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$'),
      CONSTRAINT market_calendar_holidays_updated_by_format_chk
        CHECK (updated_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$')
    );
  `);
  pgm.sql(`
    CREATE TRIGGER market_calendar_holidays_set_updated_at BEFORE UPDATE ON market_calendar_holidays
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS market_calendar_holidays_set_updated_at ON market_calendar_holidays;`);
  pgm.dropTable('market_calendar_holidays');
};
