/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Seed the three account-gating features into the catalog: `account-management`,
 * `max-accounts`, `virtual-accounts`.
 *
 * Features are declared in code (`featureSlugs` in @franzzemen/identity, 23.3.0) and
 * enter `subscription_features` by migration — never from the admin app, which edits
 * their text. See 2026-07-16T150000Z_seed_feature_catalog for the full rationale.
 *
 * WHAT THEY ARE FOR
 * -----------------
 * Together they replace `accounts-owner-role` / `accounts-administrator-role` — a
 * legacy pair granting four identical capabilities, which is why user `test` could
 * not so much as see the Portfolio icon. Portfolio management is the first thing a
 * new user must do, so it was the first real wall.
 *
 *  - `account-management` (boolean) — the master gate. Create, view, edit, delete
 *    portfolios. The other two are carve-out RESTRICTIONS layered on top of it, not
 *    independent grants.
 *  - `max-accounts` (QUANTITY) — how many portfolios may be created.
 *  - `virtual-accounts` (boolean) — create, display, operate on virtual portfolios.
 *
 * `max-accounts` IS THE ONE WITH INVERTED POLARITY
 * ------------------------------------------------
 * ABSENT MEANS UNLIMITED. Every other slug is a grant whose absence is restrictive;
 * this is a restriction whose absence is permissive. They share one `Features` map
 * and one shape, so nothing in the data distinguishes them — hence the description
 * says so in plain language, because the admin plan editor is where the mistake
 * would be made: removing the row grants UNLIMITED, while setting it to 0 grants
 * NONE. An admin reasoning by analogy ("absent = they don't get it") would give away
 * unlimited portfolios by deletion.
 *
 * `default_limit` STAYS NULL — and that is load-bearing, not incidental. Nothing
 * reads it into entitlement (`resolveFeatures` reads `plan_version_features` only;
 * `default_limit` merely surfaces through the plans DTO). Giving `max-accounts` a
 * catalog default would put the real limit in two places and quietly become the
 * code-side default the design rejects.
 *
 * The descriptions are written as PRODUCT, not plumbing: they become an
 * admin-facing reference, and must survive without a developer to interpret them.
 * The vocabulary array says a slug EXISTS; nothing else says what it DOES.
 *
 * ON CONFLICT DO NOTHING. Grants NOBODY anything — it makes the slugs grantable;
 * each still has to be attached to a plan version.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const BOOTSTRAP_UUID = '00000000-0000-0000-0000-000000000000.user';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    INSERT INTO subscription_features
      (feature_slug, name, description, type, active, created_by, updated_by)
    VALUES
      ('account-management',
       'Portfolio Management',
       'Create, view, edit, and delete your portfolios (brokerage accounts).',
       'boolean',
       true,
       '${BOOTSTRAP_UUID}',
       '${BOOTSTRAP_UUID}'),
      ('max-accounts',
       'Portfolio Limit',
       'The maximum number of portfolios you may create. Leaving this feature off the plan means UNLIMITED portfolios; setting it to 0 means none.',
       'quantity',
       true,
       '${BOOTSTRAP_UUID}',
       '${BOOTSTRAP_UUID}'),
      ('virtual-accounts',
       'Virtual Portfolios',
       'Create and use virtual portfolios — go-forward strategy tracking inside a real account.',
       'boolean',
       true,
       '${BOOTSTRAP_UUID}',
       '${BOOTSTRAP_UUID}')
    ON CONFLICT (feature_slug) DO NOTHING;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  // plan_version_features FKs this ON DELETE RESTRICT, so this refuses once a slug is
  // on a live plan version — correctly: unseeding a granted feature should fail loudly
  // rather than silently strip it from a plan.
  pgm.sql(`
    DELETE FROM subscription_features
     WHERE feature_slug IN ('account-management', 'max-accounts', 'virtual-accounts');
  `);
};
