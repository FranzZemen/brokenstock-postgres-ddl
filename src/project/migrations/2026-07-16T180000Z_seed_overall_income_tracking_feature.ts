/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Seed the `overall-income-tracking` feature into the catalog.
 *
 * Features are declared in code (`featureSlugs` in @franzzemen/identity, 23.2.0) and
 * enter `subscription_features` by migration — never from the admin app, which edits
 * their text. See 2026-07-16T150000Z_seed_feature_catalog for the full rationale.
 *
 * WHAT IT IS FOR
 * --------------
 * The Income tab on the Overall Portfolio screen — dividends and other income across
 * the whole portfolio (`GET /income/overall`).
 *
 * A SEPARATE slug from `overall-portfolio-tracking`, deliberately. Income is a
 * distinct thing to sell, and a tab is exactly the granularity a feature should gate.
 * Sharing the portfolio slug would mean pricing could never separate them without a
 * code change — which is the whole reason commerce lives on its own axis.
 *
 * WHAT IT REPLACES
 * ----------------
 * `transactions:transactions-search-capability` — another legacy role-capability
 * refusing a legitimate user on a screen they can otherwise see. Same shape as the
 * landing-page defect (T1), one tab over.
 *
 * `boolean`: you either see your income or you do not. Nothing to meter.
 *
 * ON CONFLICT DO NOTHING; default_limit NULL (the limit is a plan decision, not a
 * catalog one). Grants NOBODY anything — it makes the slug grantable; it still has to
 * be attached to a plan version.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const BOOTSTRAP_UUID = '00000000-0000-0000-0000-000000000000.user';
const SLUG = 'overall-income-tracking';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    INSERT INTO subscription_features
      (feature_slug, name, description, type, active, created_by, updated_by)
    VALUES
      ('${SLUG}',
       'Income Tracking',
       'Track dividends and other income across your whole portfolio.',
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
