/*
Created by Franz Zemen
License Type: UNLICENSED

`price-discontinuity-audit` feed registration
(projects/doc/prd/stock-dividend-price-adjustment.prd.md, E7).

WHY. The stock_dividend price defect sat undetected for three weeks because every
individual piece looked reasonable: the vendor published the event, we stored it, the
rebase ran, and the rebase's own filter quietly excluded it. Nothing failed. This feed is
the detector for that entire CLASS of bug — "a security repriced in a way our adjustment
pipeline cannot account for" — rather than for any one cause.

WHAT IT LOOKS FOR (calibrated 2026-07-26 against repaired data). A close-to-close move that
is SPLIT-SHAPED and has no corroborating adjustment on record. Split-shaped, NOT merely
large: a plain magnitude rule was already tried and retired (daily-indicators-scanner PRD
D10) because small caps routinely run 200-300% on news — of 565 securities with a >35% move,
only 64 were split-shaped, so a magnitude rule buries the signal under ~500 real movers.

Measured alert volume over a trailing 60 sessions:

    move > 35%, no adjustment within +/-3 days ......... 2,090   useless
    ... and within 1% of a simple ratio ...............     58   ~1/day
    ... and both closes >= $1 .........................     20
    ... and both closes >= $5  <-- CHOSEN .............      9   ~1 per 7 sessions
    ... and both closes >= $10 ........................      4

THE PRICE FLOOR IS LOAD-BEARING, not arbitrary tightening. Without it the list is dominated
by WARRANTS (LIMNW, SLXNW, ORIQW, DFSCW, EVLVW, FGIWW, TE.WS) where a $0.10 -> $0.20 tick is
an exact 2.0 ratio and entirely normal. Sub-dollar common stock has the same quantisation
problem. Filtering by instrument type would be an alternative; the price floor is simpler and
catches both cases.

IT IS A REVIEW QUEUE, NOT AN AUTO-FIX. Triage of the nine current survivors: four (HCAI,
QBTZ, SDOT, UBXG) have a split on record whose watermark already advanced and are probably
genuine microcap volatility; four (PRIM 202.92->101.23, IBX, UPC, CRNX 42.03->83.53) have no
split on record at all. PRIM reads like an unrecorded 2:1 — but CRNX doubling is equally
consistent with real biotech news. The shape of a number cannot settle that, so the feed
raises an alert for a human and never adjusts anything.

SCHEDULE. 03:30 UTC — after the 01:15 UTC equity plan, its per-date jobs, and the 03:00 UTC
daily-indicators safety net, so it audits a settled picture. Not chained off equity-prices:
unlike daily-indicators nothing downstream waits on it, and a fixed slot keeps the alert
cadence predictable.

feed_type is admitted by the CHECK but NOT added to the exported VendorSyncFeedType union —
same convention as the plan feeds, security-reference-*, branding-images and
daily-indicators; the worker casts at the boundary to avoid a Kysely-invariance rebuild of
the whole closure.

MIN_SCHEMA_VERSION = 2026-07-26T210000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';
import {scheduleVendorSyncCron, unscheduleVendorSyncCron} from '../vendor-sync-cron.js';

const PRICE_DISCONTINUITY_AUDIT = 'price-discontinuity-audit';

/** 03:30 UTC — past the equity plan, its per-date jobs, and the 03:00 indicators net. */
const SCHEDULE = '30 3 * * *';

const FEED_TYPES_BEFORE = [
  'equity-prices', 'options-prices', 'stock-splits-fetch', 'market-calendar',
  'ticker-info', 'ticker-ratios', 'equity-price-repair',
  'security-reference-populate', 'security-reference-refresh', 'branding-images',
  'equity-prices-plan', 'options-prices-plan', 'price-rebase-sweep',
  'security-float-refresh',
  'security-short-interest', 'security-short-volume', 'security-short-volume-plan',
  'ipo-refresh', 'daily-indicators',
];
const FEED_TYPES_AFTER = [...FEED_TYPES_BEFORE, PRICE_DISCONTINUITY_AUDIT];

const checkSql = (feeds: string[]): string =>
  `feed_type IN (${feeds.map((f) => `'${f}'`).join(', ')})`;

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_AFTER)});`);
  scheduleVendorSyncCron(pgm, PRICE_DISCONTINUITY_AUDIT, SCHEDULE);
};

export const down = (pgm: MigrationBuilder): void => {
  unscheduleVendorSyncCron(pgm, PRICE_DISCONTINUITY_AUDIT);
  pgm.sql(`ALTER TABLE vendor_sync_jobs DROP CONSTRAINT IF EXISTS vendor_sync_jobs_feed_type_chk;`);
  pgm.sql(`ALTER TABLE vendor_sync_jobs ADD CONSTRAINT vendor_sync_jobs_feed_type_chk CHECK (${checkSql(FEED_TYPES_BEFORE)});`);
};
