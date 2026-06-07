/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * ERA 3.5 — Billing / Subscriptions (2026-06-07). Migrate
 * @franzzemen/subscription-plans + @franzzemen/user-subscriptions off DynamoDB.
 * The LAST DDB domain; precondition for Era-5's "remove DynamoDB". See
 * doc/prd/era-3.5-billing-subscriptions.prd.md (decisions BS-1..BS-16).
 *
 * 6 tables, natural keys (Era-2 reference-data style):
 *  - subscription_plans      (plan_slug PK)                         — catalog
 *  - subscription_features   (feature_slug PK)                      — catalog
 *  - plan_versions           (plan_slug, version_number) PK         — draft/active/archived
 *  - plan_version_features   (plan_slug, version_number, feature_slug) PK — entitlements
 *  - user_subscriptions      (user_uuid, plan_slug, version_number) PK
 *  - feature_usage           (user_uuid, feature_slug) PK           — metered counters
 *
 * Key shape decisions:
 *  - BS-4: DDB planVersionId `${slug}#${ver}` → (plan_slug, version_number)
 *    columns + composite FK. The API mapper composes/parses the wire string.
 *  - BS-5: PlanVersionFeature.value (bool|number) → value_bool + value_number,
 *    XOR CHECK (exactly one non-null). resolveEffectivePermissions aggregates
 *    BOOL_OR(value_bool) / MAX(value_number) in one JOIN.
 *  - BS-6: status/type/reset_period → text+CHECK; epoch → timestamptz; audit
 *    cols + set_updated_at trigger; variant_data → jsonb; the DDB
 *    resetPartition='ALL' GSI hack → a plain index on reset_date.
 *  - BS-7: user_uuid = branded `<uuid>.user` CHECK, NO FK to users (soft pointer).
 *  - BS-10: pg_cron usage-reset (prod_blue only, same guard as the Era-1
 *    sessions-ttl sweep). Enforcement is lazy (an expired reset_date reads as
 *    count 0), so the cron is hygiene; hourly is plenty.
 *  - BS-16: ownership FKs CASCADE (plan→version→pvf); cross-reference FKs
 *    RESTRICT (user_subscriptions→version, feature→pvf) so deletes can't
 *    silently drop user data or mutate live entitlements — enforces the
 *    archive→migrate→delete discipline.
 *
 * SYSTEM_FREE seed lives in subscription-plans bin/seed-system-free (re-pointed
 * at PG in E2), not here. Pins MIN_SCHEMA_VERSION = 2026-06-07T130000Z.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_CHK = `~ '^${UUID_RE}\\.user$'`;
const SLUG_CHK = "~ '^[a-z0-9]+(-[a-z0-9]+)*$'";
const RESET_PERIODS = "('second','minute','hour','day','week','month')";

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    -- ── Catalog: plans ──────────────────────────────────────────────────
    CREATE TABLE subscription_plans (
      plan_slug              TEXT PRIMARY KEY CHECK (plan_slug ${SLUG_CHK}),
      name                   TEXT NOT NULL,
      description            TEXT,
      default_price_in_cents INTEGER NOT NULL DEFAULT 0 CHECK (default_price_in_cents >= 0),
      created_by             TEXT,
      updated_by             TEXT,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- ── Catalog: features ───────────────────────────────────────────────
    CREATE TABLE subscription_features (
      feature_slug      TEXT PRIMARY KEY CHECK (feature_slug ${SLUG_CHK}),
      name              TEXT NOT NULL,
      description       TEXT,
      type              TEXT NOT NULL CHECK (type IN ('boolean','quantity')),
      default_limit     INTEGER CHECK (default_limit IS NULL OR default_limit >= 0),
      active            BOOLEAN NOT NULL DEFAULT true,
      hidden            BOOLEAN NOT NULL DEFAULT false,
      ordinal_position  INTEGER CHECK (ordinal_position IS NULL OR ordinal_position >= 0),
      created_by        TEXT,
      updated_by        TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- ── Plan versions (draft → active → archived) ───────────────────────
    -- created_at doubles as PlanVersion.createdAt (materialized to epoch at read).
    CREATE TABLE plan_versions (
      plan_slug       TEXT NOT NULL REFERENCES subscription_plans(plan_slug) ON DELETE CASCADE,
      version_number  INTEGER NOT NULL CHECK (version_number >= 1),
      status          TEXT NOT NULL CHECK (status IN ('draft','active','archived')),
      created_by      TEXT,
      updated_by      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (plan_slug, version_number)
    );

    -- ── Plan-version → feature entitlements ─────────────────────────────
    CREATE TABLE plan_version_features (
      plan_slug       TEXT NOT NULL,
      version_number  INTEGER NOT NULL,
      feature_slug    TEXT NOT NULL REFERENCES subscription_features(feature_slug) ON DELETE RESTRICT,
      value_bool      BOOLEAN,
      value_number    NUMERIC,
      reset_period    TEXT CHECK (reset_period IS NULL OR reset_period IN ${RESET_PERIODS}),
      variant_data    JSONB,
      created_by      TEXT,
      updated_by      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (plan_slug, version_number, feature_slug),
      FOREIGN KEY (plan_slug, version_number)
        REFERENCES plan_versions(plan_slug, version_number) ON DELETE CASCADE,
      CONSTRAINT pvf_value_xor_chk CHECK ((value_bool IS NOT NULL) <> (value_number IS NOT NULL))
    );
    -- Reverse lookup (DDB featureSlug-index GSI): plan versions offering a feature.
    CREATE INDEX plan_version_features_feature_idx ON plan_version_features (feature_slug);

    -- ── User subscriptions ──────────────────────────────────────────────
    CREATE TABLE user_subscriptions (
      user_uuid       TEXT NOT NULL CHECK (user_uuid ${OWNER_CHK}),
      plan_slug       TEXT NOT NULL,
      version_number  INTEGER NOT NULL,
      status          TEXT NOT NULL CHECK (status IN ('active','trialing','expired')),
      auto_upgrade    BOOLEAN NOT NULL DEFAULT false,
      created_by      TEXT,
      updated_by      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_uuid, plan_slug, version_number),
      FOREIGN KEY (plan_slug, version_number)
        REFERENCES plan_versions(plan_slug, version_number) ON DELETE RESTRICT
    );
    -- DDB planVersionId-index GSI: listSubscriptionsByPlanVersion (plan-migration).
    CREATE INDEX user_subscriptions_plan_version_idx ON user_subscriptions (plan_slug, version_number);

    -- ── Feature usage (metered counters; quantity features only) ─────────
    -- No FK on feature_slug — transient counter data, not catalog integrity
    -- (matches the DDB shape). resetPartition='ALL' GSI hack dropped.
    CREATE TABLE feature_usage (
      user_uuid      TEXT NOT NULL CHECK (user_uuid ${OWNER_CHK}),
      feature_slug   TEXT NOT NULL,
      current_count  INTEGER NOT NULL DEFAULT 0 CHECK (current_count >= 0),
      reset_date     TIMESTAMPTZ NOT NULL,
      reset_period   TEXT NOT NULL CHECK (reset_period IN ${RESET_PERIODS}),
      created_by     TEXT,
      updated_by     TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_uuid, feature_slug)
    );
    CREATE INDEX feature_usage_reset_date_idx ON feature_usage (reset_date);

    -- ── updated_at triggers ─────────────────────────────────────────────
    CREATE TRIGGER subscription_plans_set_updated_at BEFORE UPDATE ON subscription_plans
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    CREATE TRIGGER subscription_features_set_updated_at BEFORE UPDATE ON subscription_features
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    CREATE TRIGGER plan_versions_set_updated_at BEFORE UPDATE ON plan_versions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    CREATE TRIGGER plan_version_features_set_updated_at BEFORE UPDATE ON plan_version_features
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    CREATE TRIGGER user_subscriptions_set_updated_at BEFORE UPDATE ON user_subscriptions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    CREATE TRIGGER feature_usage_set_updated_at BEFORE UPDATE ON feature_usage
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── BS-10: pg_cron usage-reset (prod_blue only; lazy enforcement makes
  // this hygiene). Advances each due counter to count 0 + next-period reset.
  pgm.sql(`
    DO $$
    BEGIN
      IF current_database() <> 'prod_blue' THEN
        RAISE NOTICE 'Skipping pg_cron feature-usage-reset on %: only registered in cron.database_name (prod_blue).', current_database();
        RETURN;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE EXCEPTION 'pg_cron extension is not installed in prod_blue. Master must run CREATE EXTENSION pg_cron; before this migration.';
      END IF;

      EXECUTE 'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = ''feature-usage-reset''';
      EXECUTE $sql$SELECT cron.schedule('feature-usage-reset', '0 * * * *', $job$
        UPDATE feature_usage
           SET current_count = 0,
               reset_date = now() + (CASE reset_period
                 WHEN 'second' THEN interval '1 second'
                 WHEN 'minute' THEN interval '1 minute'
                 WHEN 'hour'   THEN interval '1 hour'
                 WHEN 'day'    THEN interval '1 day'
                 WHEN 'week'   THEN interval '1 week'
                 WHEN 'month'  THEN interval '1 month'
               END)
         WHERE reset_date <= now()
      $job$)$sql$;
    END $$;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    DO $$
    BEGIN
      IF current_database() = 'prod_blue'
         AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        EXECUTE 'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = ''feature-usage-reset''';
      END IF;
    END $$;
  `);
  pgm.sql(`
    DROP TABLE IF EXISTS feature_usage;
    DROP TABLE IF EXISTS user_subscriptions;
    DROP TABLE IF EXISTS plan_version_features;
    DROP TABLE IF EXISTS plan_versions;
    DROP TABLE IF EXISTS subscription_features;
    DROP TABLE IF EXISTS subscription_plans;
  `);
};
