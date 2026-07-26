/*
Created by Franz Zemen
License Type: UNLICENSED

Market-calendar repair: seed 2024 US market holidays + the 2025-01-09 national day of
mourning (daily-indicators-scanner.prd.md E1 — found during the historical price backfill).

THE DEFECT. `market_calendar_holidays` covered ONLY 2025–2027 (288 rows = 9 MICs × 32
dates, loaded by the Era-2 DDB migration). Nothing has added to it since, because the
`market-calendar` handler in the vendor-sync worker is still a stub — its body is a log line
and `// TODO E8: pull vendor calendar`. The monthly `vendor-sync-market-calendar` cron has
therefore been running and doing nothing.

For the daily feed that never mattered: it only ever pulls recent dates, well inside the
loaded range. It surfaced the moment E1 replayed history — `TradingCalendar.tradingDaysBetween`
saw no 2024 holidays, enumerated the closed sessions as trading days, and the per-date jobs
failed against a flat file that does not exist for a closed market:

    2024-09-02  Labor Day
    2024-11-28  Thanksgiving
    2024-12-25  Christmas
    2025-01-09  National Day of Mourning (President Carter)

The fourth is the instructive one: 2025 IS within the loaded range and still missed it,
because that closure was announced after the calendar snapshot was taken. So the gap is not
only "we lack 2024" — the source carries scheduled holidays and not ad-hoc closures.

WHAT THIS MIGRATION DOES: inserts the 2024 holiday set and 2025-01-09 for all 9 MICs already
present in the table, idempotently (ON CONFLICT DO NOTHING). It does NOT fix the stub
handler — that is a separate piece of work, and it carries a deadline: coverage currently
ends 2027-12-24, so from 2028-01-01 EVERY holiday becomes an enumerated "trading day" and
the nightly feed will fail on each one.

HALF-DAYS: rows carrying `early_close` are trading days, not closures —
`TradingCalendar.#isHoliday` returns `h !== undefined && h.earlyClose === undefined`. The
three 2024 early closes are included for accuracy; they do not remove a trading day. Note
the stored time is UTC (existing rows show 18:00:00 for a 13:00 ET November close), so
2024-07-03 — which falls in EDT — is 17:00:00, not 18:00:00.

No schema change; data only. MIN_SCHEMA_VERSION is unchanged.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const SYSTEM_OWNER = '00000000-0000-0000-0000-000000000000.user';

/** Every MIC already carrying holiday rows (9 × 32 = the existing 288). */
const MICS = ['ARCX', 'BATS', 'PINX', 'XASE', 'XNAS', 'XNGS', 'XNMS', 'XNYS', 'XOTC'];

/** `earlyClose` null = full closure; a time (UTC) = half-day, still a trading day. */
const HOLIDAYS: ReadonlyArray<{date: string; name: string; earlyClose: string | null}> = [
  // 2024 — names match the existing 2025+ rows exactly.
  {date: '2024-01-01', name: "New Year's Day",   earlyClose: null},
  {date: '2024-01-15', name: 'MLK Day',          earlyClose: null},
  {date: '2024-02-19', name: 'Presidents Day',   earlyClose: null},
  {date: '2024-03-29', name: 'Good Friday',      earlyClose: null},
  {date: '2024-05-27', name: 'Memorial Day',     earlyClose: null},
  {date: '2024-06-19', name: 'Juneteenth',       earlyClose: null},
  {date: '2024-07-03', name: 'Independence Day', earlyClose: '17:00:00'}, // 13:00 EDT
  {date: '2024-07-04', name: 'Independence Day', earlyClose: null},
  {date: '2024-09-02', name: 'Labor Day',        earlyClose: null},
  {date: '2024-11-28', name: 'Thanksgiving',     earlyClose: null},
  {date: '2024-11-29', name: 'Thanksgiving',     earlyClose: '18:00:00'}, // 13:00 EST
  {date: '2024-12-24', name: 'Christmas',        earlyClose: '18:00:00'}, // 13:00 EST
  {date: '2024-12-25', name: 'Christmas',        earlyClose: null},
  // Ad-hoc closure the vendor snapshot never carried.
  {date: '2025-01-09', name: 'National Day of Mourning', earlyClose: null},
];

export const up = (pgm: MigrationBuilder): void => {
  const values = MICS.flatMap((mic) =>
    HOLIDAYS.map((h) =>
      `('${mic}', DATE '${h.date}', '${h.name.replace(/'/g, "''")}', ` +
      `${h.earlyClose === null ? 'NULL' : `TIME '${h.earlyClose}'`}, ` +
      `'${SYSTEM_OWNER}', '${SYSTEM_OWNER}')`,
    ),
  ).join(',\n    ');

  pgm.sql(`
    INSERT INTO market_calendar_holidays (mic, holiday_date, name, early_close, created_by, updated_by)
    VALUES
    ${values}
    ON CONFLICT DO NOTHING;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  const dates = HOLIDAYS.map((h) => `DATE '${h.date}'`).join(', ');
  pgm.sql(`DELETE FROM market_calendar_holidays WHERE holiday_date IN (${dates});`);
};
