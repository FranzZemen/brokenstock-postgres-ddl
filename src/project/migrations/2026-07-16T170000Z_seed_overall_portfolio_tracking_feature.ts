/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Seed the `overall-portfolio-tracking` feature into the catalog.
 *
 * This is how a feature enters `subscription_features` — by migration, never from
 * the admin app. The vocabulary is code (`featureSlugs` in @franzzemen/identity,
 * 23.1.0); this migration is the same code lifecycle, one step over. See
 * 2026-07-16T150000Z_seed_feature_catalog for the full rationale and for why
 * putFeature is update-only.
 *
 * WHAT IT IS FOR
 * --------------
 * The post-login landing page (/overall-portfolio) and its yield/gain periods.
 * Today that surface is gated by `trades-api:trades-api-search-capability` — an
 * ancient role-capability that only `trades-api-owner-role` /
 * `trades-api-administrator-role` grant. The result is that a legitimate new user
 * lands on their own home page and gets a 403 (the T1 defect: login was never
 * broken; the landing page simply refused them).
 *
 * It is replaced by TWO checks, on the two axes, both required:
 *   - security: the `user` SecurityRole → `standard-admin`'s sibling `standard-user`
 *   - commerce: this slug
 * "May this account act" and "does this plan include portfolio tracking" are
 * different questions on different lifecycles. Folding the second into a role would
 * make a pricing change a security change.
 *
 * A "standard" feature — every `user` is expected to hold it, and it belongs on the
 * base plan. Standard is not the same as free-of-charge or ungated: it still has to
 * be *granted*, which is exactly what makes it re-bundlable later without touching
 * anyone's security posture.
 *
 * `boolean`: you either track a portfolio or you do not. Nothing to meter.
 *
 * ON CONFLICT DO NOTHING and default_limit NULL, for the same reasons as the
 * original catalog seed.
 *
 * NOTE this grants NOBODY anything. It makes the slug *grantable*; it still has to
 * be attached to a plan version before any user holds it. The old guard therefore
 * STAYS until that happens — removing it first would swap one 403 for another.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const BOOTSTRAP_UUID = '00000000-0000-0000-0000-000000000000.user';
const SLUG = 'overall-portfolio-tracking';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    INSERT INTO subscription_features
      (feature_slug, name, description, type, active, created_by, updated_by)
    VALUES
      ('${SLUG}',
       'Portfolio Tracking',
       'Track your overall portfolio: aggregate positions, yields and gains over time.',
       'boolean',
       true,
       '${BOOTSTRAP_UUID}',
       '${BOOTSTRAP_UUID}')
    ON CONFLICT (feature_slug) DO NOTHING;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  // plan_version_features FKs this ON DELETE RESTRICT, so this refuses to run once
  // the slug is attached to a live plan version — correctly: unseeding a granted
  // feature should fail loudly rather than silently strip it from a plan.
  pgm.sql(`DELETE FROM subscription_features WHERE feature_slug = '${SLUG}';`);
};
