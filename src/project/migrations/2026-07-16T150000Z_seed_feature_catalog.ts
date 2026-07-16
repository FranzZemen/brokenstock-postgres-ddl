/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * subscription_features SEED — give the feature catalog a code source.
 *
 * WHY
 * ---
 * The live prod_blue catalog was populated BY HAND and never had a code source:
 * three rows (`real-time`, `scanners`, `benzinga-news`), and no way at all to
 * reach dev_franz — the admin app only talks to prod_blue. So a fresh
 * environment (dev_franz, a rebuilt blue/green) comes up with an EMPTY catalog,
 * and `plan_version_features.feature_slug` FKs to this table, which means no plan
 * can grant anything. Every feature-gated surface is silently unavailable.
 *
 * This is the same defect, and the same fix, as
 * `2026-06-09T120000Z_era_1_identity_role_capabilities_seed.ts` — read its header;
 * it is the identical story one domain over ("populated by hand and never had a
 * code source ... any fresh environment came up deny-all").
 *
 * It also closes a live bug: `journal-entries` is gated in production
 * (`brokenstock-app-worker/.../trades/journal.ts:40,72`) but has NO catalog row,
 * so no plan can grant it, so `checkUsageFromSession` denies every user. Trade
 * journal entries are currently impossible for everyone, including the owner.
 *
 * WHAT CODE OWNS vs WHAT THE ADMIN OWNS
 * -------------------------------------
 * Code owns which slugs EXIST and their `type` — the vocabulary is
 * `featureSlugs` in @franzzemen/identity, and boolean-vs-quantity is a code fact
 * (`journal-entries` is metered by checkUsageFromSession; that is not editorial).
 * A feature is a coded *something*; a slug with no implementation is a promise
 * with nothing behind it, which is why features are entered by migration and not
 * created in the admin app.
 *
 * The ADMIN owns the editorial metadata — name, description, ordinal_position,
 * active, hidden — and edits it in Feature Management. The names below are
 * therefore DEFAULTS, not decrees.
 *
 * ON CONFLICT DO NOTHING: a no-op against prod_blue's three existing rows,
 * preserving whatever names have already been set there, while bringing
 * dev_franz to parity. Idempotent on replay.
 *
 * `default_limit` is left NULL throughout: the LIMIT is a commerce decision that
 * belongs on the plan version (`plan_version_features.value_number`), not on the
 * catalog. A catalog-level default would silently apply to every plan that
 * omitted the slug.
 *
 * NOTE a seeded row grants NOBODY anything. It makes the slug *grantable* — it
 * still has to be attached to a plan version before a user holds it.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const BOOTSTRAP_UUID = '00000000-0000-0000-0000-000000000000.user';

/**
 * Must stay a subset of `featureSlugs` in @franzzemen/identity — the invariant is
 * `vocabulary ⊇ catalog ⊇ mapping`. The `plan_version_features` FK already
 * enforces `catalog ⊇ mapping`; `putFeature`'s write-check enforces
 * `vocabulary ⊇ catalog`; this seed is how a coded slug reaches the catalog in
 * the first place.
 */
const FEATURES: ReadonlyArray<{slug: string; name: string; description: string; type: 'boolean' | 'quantity'}> = [
  {
    slug: 'real-time',
    name: 'Real-Time Market Data',
    description: 'Live intraday data: sub-day chart spans and intervals, and live polling.',
    type: 'boolean',
  },
  {
    slug: 'scanners',
    name: 'Scanners',
    description: 'Access to the Scanners section.',
    type: 'boolean',
  },
  {
    slug: 'benzinga-news',
    name: 'Benzinga News',
    description: 'Benzinga as an additional news source alongside the default vendor.',
    type: 'boolean',
  },
  {
    slug: 'journal-entries',
    name: 'Trade Journal Entries',
    description: 'Journal entries recorded against trades. Metered per period; the limit is set by the plan.',
    type: 'quantity',
  },
];

export const up = (pgm: MigrationBuilder): void => {
  const values = FEATURES
    .map(f => `('${f.slug}', '${f.name.replace(/'/g, "''")}', '${f.description.replace(/'/g, "''")}', '${f.type}', true, '${BOOTSTRAP_UUID}', '${BOOTSTRAP_UUID}')`)
    .join(',\n      ');
  pgm.sql(`
    INSERT INTO subscription_features
      (feature_slug, name, description, type, active, created_by, updated_by)
    VALUES
      ${values}
    ON CONFLICT (feature_slug) DO NOTHING;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  // Only the slugs this migration introduces. ON DELETE RESTRICT on
  // plan_version_features means a slug attached to a live plan version will
  // refuse to drop — which is correct: unseeding a granted feature should fail
  // loudly rather than cascade a plan into granting nothing.
  const list = FEATURES.map(f => `'${f.slug}'`).join(', ');
  pgm.sql(`DELETE FROM subscription_features WHERE feature_slug IN (${list});`);
};
