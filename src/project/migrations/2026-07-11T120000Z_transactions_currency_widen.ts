/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Widen transactions_currency_chk (2026-07-11).
 *
 * The Era-3 transactions table (2026-06-05) pinned currency to CHECK
 * (currency IN ('USD','EUR')) — adequate while every imported statement was
 * US/EUR-denominated. The first IBKR Flex Query import holding a Canadian
 * security (Alimentation Couche-Tard, symbol ATD, listingExchange="TSE",
 * ISIN CA01626P1484, currency="CAD") violated the constraint: the transaction
 * batch insert aborted, the import.parse job died after 5 retries, and the
 * file silently reverted to "Ready for parsing". See BUG-001 in this repo's
 * doc/bugs/bug-report.md.
 *
 * The IBKR parser correctly passes the security's native currency through
 * (record.currency), so the fix is to admit the currencies a US IBKR investor
 * realistically holds. Widening to ('USD','EUR','CAD','GBP') is a superset of
 * the prior set — every existing row already satisfies it, so ADD CONSTRAINT
 * validates cleanly with no data rewrite.
 *
 * NOTE ON PRICING: admitting CAD/GBP lets these transactions IMPORT; it does
 * not make them priceable. The Massive vendor covers US equities only (no TSX/
 * XTSE), so non-US securities resolve to the 'XXXX' (Unknown) MIC placeholder,
 * land as unlisted, and do not price. This is accepted (Franz 2026-07-11):
 * closed trades need no pricing for yield, and open non-US positions simply
 * won't value until a Canadian/international data vendor is integrated.
 *
 * Bumps MIN_SCHEMA_VERSION = 2026-07-11T120000Z. No worker code depends on the
 * widened set (it is purely a DB-side admission check), so no worker redeploy
 * is required — only the migration.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_currency_chk;
    ALTER TABLE transactions ADD CONSTRAINT transactions_currency_chk
      CHECK (currency IN ('USD', 'EUR', 'CAD', 'GBP'));
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  // Reverting requires no CAD/GBP rows to exist, or the ADD will fail — expected.
  pgm.sql(`
    ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_currency_chk;
    ALTER TABLE transactions ADD CONSTRAINT transactions_currency_chk
      CHECK (currency IN ('USD', 'EUR'));
  `);
};
