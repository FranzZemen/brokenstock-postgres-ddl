/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Seed the `trade-journaling-data` feature into the catalog.
 *
 * Features are declared in code (`featureSlugs` in @franzzemen/identity, 23.4.0) and
 * enter `subscription_features` by migration — never from the admin app, which edits
 * their text. See 2026-07-16T150000Z_seed_feature_catalog for the full rationale.
 *
 * WHAT IT IS FOR
 * --------------
 * The BASE entitlement for the whole per-trade data plane: importing broker
 * statements (Fidelity, IBKR, E*TRADE, Schwab), JSON and manual imports, and
 * everything derived from or journaled on the result — transactions, trades,
 * per-trade yields and gains, charts, thesis-yields, and journal entries.
 *
 * One slug replacing TWO retired legacy role families (`trades-api-*` and
 * `file-import-*`) and subsuming the retired `journal-entries` quantity meter. See
 * brokenstock-orchestrator/doc/prd/trade-journaling-data-gating.prd.md.
 *
 * A BASE GATE: derived aggregate views (Overall Portfolio, Overall Income) require
 * this slug AND their own view slug. A plan granting `overall-portfolio-tracking` or
 * `overall-income-tracking` MUST also grant this, or the aggregate view goes dark.
 *
 * `boolean`: you either have trade-journal data or you do not. Nothing to meter — the
 * quantity meter this replaces (`journal-entries`) is being retired separately.
 *
 * ON CONFLICT DO NOTHING; grants NOBODY anything — it makes the slug grantable; it
 * still has to be attached to a plan version.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const BOOTSTRAP_UUID = '00000000-0000-0000-0000-000000000000.user';
const SLUG = 'trade-journaling-data';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    INSERT INTO subscription_features
      (feature_slug, name, description, type, active, created_by, updated_by)
    VALUES
      ('${SLUG}',
       'Trade Journal & Imports',
       'Import broker statements (Fidelity, IBKR, E*TRADE, Schwab), JSON, and manual entries; view and journal the resulting trades, transactions, yields and gains.',
       'boolean',
       true,
       '${BOOTSTRAP_UUID}',
       '${BOOTSTRAP_UUID}')
    ON CONFLICT (feature_slug) DO NOTHING;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  // plan_version_features FKs this ON DELETE RESTRICT, so this refuses once the slug
  // is on a live plan version — correctly: unseeding a granted feature should fail
  // loudly rather than silently strip it from a plan.
  pgm.sql(`DELETE FROM subscription_features WHERE feature_slug = '${SLUG}';`);
};
