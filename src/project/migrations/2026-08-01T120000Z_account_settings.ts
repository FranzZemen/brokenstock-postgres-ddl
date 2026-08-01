/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Per-account settings bag
 * (broken-stock/doc/prd/manual-transactions-charges-and-chart.prd.md, D7/E2).
 *
 * brokerage_accounts:
 *   - settings JSONB NULL — an open bag of per-account settings. Its first and
 *     currently only key is `chargeSchedule`, the seven commission/fee numbers
 *     used to price manually-entered transactions so a simulated trade costs
 *     what a real one would.
 *
 * WHY A BAG AND NOT COLUMNS. The charge schedule alone is seven numbers, and
 * the account is the natural home for the per-account settings that follow it.
 * One nullable JSONB add costs one migration ever; seven typed columns cost a
 * migration per setting thereafter. Nothing queries or aggregates these values
 * — they are read whole, with the account, by the code that prices a line — so
 * the usual argument for typed columns (indexing, constraints, SQL arithmetic)
 * does not apply here.
 *
 * NULL means "no settings", which means no charges. That is deliberately the
 * same thing every account that predates this column already does (D53), so
 * there is no backfill and no default row to write.
 *
 * Shape validation lives in `@franzzemen/financial-identity` (accountSchema →
 * accountSettingsSchema), which is deliberately NON-STRICT below the `settings`
 * key: a worker running an older copy of financial-identity must pass an
 * unknown setting through untouched rather than reject the account update that
 * carries it (D8). Putting a CHECK constraint on the JSON here would defeat
 * that by making the database the strict party instead.
 *
 * Additive only — one nullable column add, no data rewrite, no lock beyond the
 * catalog update.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.addColumns('brokerage_accounts', {
    settings: {type: 'jsonb'},
  });
  pgm.sql(`
    COMMENT ON COLUMN brokerage_accounts.settings IS
      'Open per-account settings bag. First key: chargeSchedule (manual-transaction commission/fee rates). NULL = no settings = no charges. Validated by financial-identity, deliberately non-strict.';
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropColumns('brokerage_accounts', ['settings']);
};
