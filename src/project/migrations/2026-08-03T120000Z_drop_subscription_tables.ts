/*
Created by Franz Zemen 2026-08-03
License Type: UNLICENSED

Drop the six subscription tables. BrokenStock is not being commercialised.

See `projects/doc/prd/commercial-surface-decommission.prd.md` (E22). On 2026-08-02 Franz
decided the product will not be sold; it is a private tool with one user. Every consumer
of these tables was removed first, in this order:

  E5   the browser stopped reading feature grants          (broken-stock, shell 0.4.0)
  E6   the backend gates went                              (5 packages, 68 route arrays)
  E7   `real-time` became a server-side constant           (D4's one exception)
  E9   login/refresh stopped resolving features            (auth-worker 0.6.24)
  E10  the plan/feature/subscription admin screens went    (broken-stock-admin)
  E11  the admin routes, ALB rule and 18 gateway routes    (admin-app-worker 0.16.30)

Nothing reads these tables. This migration is the last step, not the first.

WHY DROP RATHER THAN LEAVE THEM EMPTY. The PRD originally kept them, reasoning that
deleting them would destroy the record of what the system used to do. That was wrong on
its own terms: the principle it invoked ("delete forward; never rewrite history") is about
not rewriting GIT history, and the record of this design is safe in git, in published
package versions and in the PRDs. Meanwhile these are not empty schema — they hold a
working price list: `pro-monthly` at 4,000 cents, `progressive-test-plan` at $0, eight
active plan versions and fourteen feature grants. That is the most concrete artifact of
commercialisation left anywhere in the system, and the only one that survived every
browser-bundle scan, because it was never in the bundle.

ERASURE. `user_subscriptions` and `feature_usage` are owner-keyed and were registered in
`@franzzemen/users` PURGE_REGISTRY with `disposition: 'explicit'`. They are removed from
that registry in the same change, and `TrustedUserSubscriptionsApi.deleteByOwner()` and its
call in `purge-orchestrator.ts` go with them. The registry's completeness test — which
scans the LIVE schema for owner-keyed tables and fails if any is unregistered — is the
control that ties the two halves together: it failed the moment the registry entries were
removed and passes again only once these tables are actually gone. That is why the registry
edit and this migration must ship together.

NAMES. The catalogue tables are `subscription_plans` and `subscription_features`, NOT
`plans`/`features` — the Kysely `Database` interface maps them under the shorter keys, which
is what the first draft of this migration copied. That draft used `DROP TABLE IF EXISTS` and
would have SILENTLY no-opped on both, reporting success while leaving the price list in
place. So: no `IF EXISTS` here. A wrong table name must fail this migration, not skip it.
Names verified against `2026-06-07T130000Z_era_3_5_subscriptions.ts`, which created all six.

ORDER. `plan_version_features` and `user_subscriptions` carry FKs into `plan_versions`,
which FKs into `subscription_plans`; `feature_usage` and `plan_version_features` reference
`subscription_features`. Children first. `CASCADE` is deliberately NOT used — if an
unexpected dependency exists, this should fail loudly rather than quietly drop something
nobody predicted.

IRREVERSIBLE. `down` throws rather than recreating the tables — see the note on it below.


*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  // Children before parents. No CASCADE: an unexpected dependent should fail this
  // migration, not disappear with it.
  pgm.sql(`
    DROP TABLE feature_usage;
    DROP TABLE plan_version_features;
    DROP TABLE user_subscriptions;
    DROP TABLE plan_versions;
    DROP TABLE subscription_plans;
    DROP TABLE subscription_features;
  `);
};

export const down = (): never => {
  // NO ROLLBACK. Deliberate.
  //
  // The first draft of this file recreated the six tables inline. That was a trap, and it
  // was already wrong when written: it declared `price_in_cents` where the real column is
  // `default_price_in_cents`, and `feature_type` where the real column is `type`. A `down`
  // that runs successfully and leaves a schema subtly unlike the original is worse than no
  // `down` at all — the next migration to touch these tables would fail somewhere else
  // entirely, a long way from the cause.
  //
  // Rolling back is also pointless in the direction that matters. `down` could never
  // restore the rows: the plan catalogue, the eight plan versions, the fourteen feature
  // grants and every user subscription are gone with `up`. A structure-only rollback
  // recreates six empty tables that nothing reads, since every consumer was removed first
  // (commercial-surface-decommission E5/E6/E9/E22/E23) and both owning packages are retired.
  //
  // If these tables are ever genuinely needed again, the authoritative DDL is in
  // `2026-06-07T130000Z_era_3_5_subscriptions.ts`, which created all six. Copy it from
  // there rather than trusting a paraphrase written on the way out.
  throw new Error(
    'Migration 2026-08-03T120000Z_drop_subscription_tables is not reversible. The six ' +
    'subscription tables were dropped with their data (commercial-surface-decommission ' +
    'E22). To recreate the structures, see 2026-06-07T130000Z_era_3_5_subscriptions.ts.',
  );
};
