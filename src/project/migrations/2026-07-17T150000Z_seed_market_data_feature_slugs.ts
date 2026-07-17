/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Seed the four market-data feature slugs: `financial-reference`, `ipo`, `rotation`,
 * `thesis-management`. See financial-api/doc/prd/market-data-gating.prd.md.
 *
 * Declared in code (`featureSlugs` in @franzzemen/identity, 23.5.0) and entered into
 * `subscription_features` by migration — never from the admin app, which edits their
 * text. See 2026-07-16T150000Z_seed_feature_catalog for the full rationale.
 *
 * These gate the market-data surfaces, replacing the legacy `financial-api` /
 * `instruments` role families (retired in a later migration once the deep gates are
 * stripped and deployed). `financial-reference`, `ipo`, `rotation` are standalone LEAF
 * slugs (surface + standard-user). `thesis-management` is a base+VIEW slug — thesis is
 * trade-derived, so it requires `trade-journaling-data` AND this.
 *
 * All boolean. ON CONFLICT DO NOTHING; grants NOBODY anything — each still has to be
 * attached to a plan version.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const BOOTSTRAP_UUID = '00000000-0000-0000-0000-000000000000.user';

const FEATURES: Array<{slug: string; name: string; description: string}> = [
  {
    slug: 'financial-reference',
    name: 'Reference Data',
    description: 'Reference data: security profiles, short interest and volume, ticker metadata, and aggregated news.',
  },
  {
    slug: 'ipo',
    name: 'IPOs',
    description: 'Upcoming and recent IPOs.',
  },
  {
    slug: 'rotation',
    name: 'Rotation',
    description: 'Relative-rotation-graph analysis of sector and symbol momentum.',
  },
  {
    slug: 'thesis-management',
    name: 'Thesis Management',
    description: 'Create and manage investment theses and their trade matching.',
  },
];

export const up = (pgm: MigrationBuilder): void => {
  const values = FEATURES.map(f =>
    `('${f.slug}', '${f.name}', '${f.description.replace(/'/g, "''")}', 'boolean', true, '${BOOTSTRAP_UUID}', '${BOOTSTRAP_UUID}')`,
  ).join(',\n      ');
  pgm.sql(`
    INSERT INTO subscription_features
      (feature_slug, name, description, type, active, created_by, updated_by)
    VALUES
      ${values}
    ON CONFLICT (feature_slug) DO NOTHING;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  // plan_version_features FKs this ON DELETE RESTRICT — refuses once a slug is on a
  // live plan version, correctly.
  const inList = FEATURES.map(f => `'${f.slug}'`).join(', ');
  pgm.sql(`DELETE FROM subscription_features WHERE feature_slug IN (${inList});`);
};
