---
title: Era 3.5 — Subscriptions / Usage Schema (intent)
type: intent
version: 0.1.0
created: 2026-06-07
parent: ../../../../projects/doc/prd/era-3.5-billing-subscriptions.prd.md
---

# Era 3.5 — Subscriptions / Usage Schema (intent)

## Why this schema exists

Era 3.5 migrates Brokenstock's **last DynamoDB domain** — billing/entitlements (`subscription-plans` + `user-subscriptions`) — from DynamoDB to PostgreSQL. The migration `2026-06-07T130000Z_era_3_5_subscriptions` owns the DDL; this document captures the design rationale so it survives the migration file. It also sets `MIN_SCHEMA_VERSION` for the new admin-app-worker / app-worker / auth-worker code that reads these tables.

Six logical entities map to **six physical tables**, plus a pg_cron job for usage reset.

## The six tables

| Table | PK | Notes |
|-------|----|----|
| `subscription_plans` | `slug` (natural key) | The plan catalog (e.g. `free`, `pro`). |
| `subscription_features` | `slug` (natural key) | The feature catalog; `variant_data` → `jsonb`. |
| `plan_versions` | `(plan_slug, version_number)` | Composite natural key — replaces the DDB `planVersionId = "slug#ver"` string. FK `plan_slug → subscription_plans` ON DELETE CASCADE. Exactly one active version per plan. |
| `plan_version_features` | `(plan_slug, version_number, feature_slug)` | M:N plan-version ↔ feature with the per-version feature value. FK to `plan_versions` (composite) + `subscription_features`. |
| `user_subscriptions` | `(user_uuid, plan_slug, version_number)` | A user's subscription to a plan version. `user_uuid` is a **soft pointer** (no FK — users live in the identity tables / are an app-minted concern). |
| `feature_usage` | `(user_uuid, feature_slug)` | Metered-feature counters; `reset_period` text+CHECK; `current_count` + `reset_date`. |

## Approved decisions (BS-1…BS-16)

- **Natural keys, not surrogate ids.** `slug` for plans/features; `(plan_slug, version_number)` composite for versions. The DDB `planVersionId` `slug#ver` string becomes a real composite FK — no string-splitting in queries.
- **`plan_version_features.value` (bool | number) → two nullable typed columns + CHECK.** DDB stored a polymorphic value; Postgres gets `value_bool` / `value_number` with a CHECK that exactly one is set. Type-safe, queryable.
- **Column conventions (BS-6):** `status` / `type` / `reset_period` → `text` + CHECK constraints (not enums — additive evolution without a migration); `variant_data` → `jsonb`; audit columns `created_by` / `updated_by` / `created_at` / `updated_at` + a `set_updated_at` trigger on every table.
- **effectivePermissions → single JOIN (BS-8).** `resolveEffectivePermissions(owner)` is one JOIN across user_subscriptions → plan_versions → plan_version_features → subscription_features with `BOOL_OR` / `MAX` aggregation — replacing the DDB multi-read fan-out.
- **archivePlanVersion is synchronous (BS-9).** Re-points subscribers in a single PG bulk `UPDATE` — no SQS plan-migration queue, no async job, no `/admin/jobs` poll.
- **usage-reset → pg_cron.** A `feature-usage-reset` cron job (`0 * * * *`) resets due `feature_usage` counters in-database, replacing the hourly `lambda-usage-reset`. The job is **guarded to only register in `cron.database_name` (prod_blue)** — on any other database the migration RAISEs a NOTICE and skips, so dev_franz/scratch DBs don't double-run it.

## MIN_SCHEMA_VERSION

This migration's timestamp `2026-06-07T130000Z` is the floor pinned by admin-app-worker, app-worker (catalog route), and auth-worker (`resolveEffectivePermissions`). Those workers refuse to boot against an Aurora behind it.

## Cross-references

- Parent PRD: `~/dev/projects/doc/prd/era-3.5-billing-subscriptions.prd.md`
- Consuming packages: `@franzzemen/subscription-plans` (@2.x), `@franzzemen/user-subscriptions` (@2.x)
- Era-5: the 6 DDB subscription tables are torn down in the Era-5 sweep (not here).
