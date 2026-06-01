/*
Created by Franz Zemen
License Type: UNLICENSED

Kysely `Database` interface mirroring the Era 1 C1 + Pre-Era-1 schema. Single
source of truth for the TypeScript shape of every Brokenstock-managed Postgres
table. Consumers (`@franzzemen/users`, `@franzzemen/sessions`,
`@franzzemen/endpoint-application`, the auth-worker) import:

    import type {Database} from '@franzzemen/brokenstock-postgres-ddl/schema-types';

and pass it as the generic to `createKysely<Database>(pool)`. Editing the
migration files in this same repo + this interface in the same PR keeps schema
shape and schema DDL in lockstep.

## Boundary translation

C1 D6 stores timestamps as TIMESTAMPTZ + a `set_updated_at()` trigger. The
ecosystem's `DBRecord` shape uses `createdEpoch: number` / `updatedEpoch:
number` for backwards-compatible API surfaces. SELECT projections in consumer
code do `EXTRACT(EPOCH FROM created_at) * 1000` (or equivalent kysely
expression) to materialize the epoch number at the boundary. INSERTs supply
the trigger-defaulted columns as `Generated`. UPDATEs skip `updated_at` — the
BEFORE UPDATE trigger overwrites whatever the caller passes.

## Why columns are typed the way they are

- `Generated<Date>` for `created_at` / `updated_at` — DB-side defaults +
  trigger-managed. Callers MUST NOT supply on INSERT; UPDATE writes are
  silently overridden by the trigger.
- `Date` (plain) for application-managed TIMESTAMPTZ columns (`start_at`,
  `expires_at`, `refresh_token_expires_at`) — callers always provide.
- `unknown` for `effective_permissions JSONB` — consumers narrow to their
  own `EffectivePermissions` type via kysely's `Json` helpers or by typing
  the SELECT projection.
- `string` for every `TEXT` column. C1 D2 uses TEXT PKs with CHECK regex; no
  native UUID type.

## Schema mapping

This interface mirrors the 7 Era 1 C1 migrations + the 2 Pre-Era-1 substrate
tables (smoke_events, worker_jobs). Subset interfaces exist per-table for
consumers that only touch a few tables — type-narrowing happens at the query
site (`db.selectFrom('role_capabilities')`) rather than via a parallel
restricted-Database type.
*/

import type {Generated} from 'kysely';

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

export interface UsersTable {
  /** `<uuid>.user` PK, app-minted via @franzzemen/utility.getUUID<'user'>(). */
  uuid: string;
  username: string;
  email: string;
  disabled: Generated<boolean>;
  hash: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

// ---------------------------------------------------------------------------
// roles
// ---------------------------------------------------------------------------

export interface RolesTable {
  /** Role slug (e.g. 'user-administrator-role') — PK and FK target. */
  name: string;
  description: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

// ---------------------------------------------------------------------------
// user_roles (M:N join)
// ---------------------------------------------------------------------------

export interface UserRolesTable {
  user_uuid: string;
  role_name: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

// ---------------------------------------------------------------------------
// user_applications
// ---------------------------------------------------------------------------

export interface UserApplicationsTable {
  user_uuid: string;
  /** CHECK constrained to ('brokenstock', 'brokenstock-admin'). */
  application: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

export interface SessionsTable {
  /** JWT (three base64url segments separated by '.'). PK. */
  token: string;
  /** users.uuid FK CASCADE. */
  owner: string;
  /** ISO timestamp string preserved from the API surface. */
  start: string;
  start_at: Date;
  app_context: string;
  authenticated: boolean;
  previously_authenticated: boolean;
  invalidated: Generated<boolean>;
  refresh_token: string;
  refresh_token_expires_at: Date;
  /** JSONB; consumers narrow to their own EffectivePermissions type. */
  effective_permissions: Generated<unknown>;
  permissions_stale: Generated<boolean>;
  expires_at: Date;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

// ---------------------------------------------------------------------------
// role_capabilities
// ---------------------------------------------------------------------------

export interface RoleCapabilitiesTable {
  /** roles.name FK CASCADE. */
  role_name: string;
  /** Free-form capability string (the closed set lives in code). */
  capability: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

// ---------------------------------------------------------------------------
// Pre-Era-1 substrate (smoke_events, worker_jobs) — included so the worker
// fleet can use a single Database type across schema concerns.
// ---------------------------------------------------------------------------

export interface SmokeEventsTable {
  id: Generated<number>;
  payload: string;
  created_at: Generated<Date>;
}

export type WorkerJobStatus = 'pending' | 'in_flight' | 'completed' | 'failed';

export interface WorkerJobsTable {
  id: Generated<string>;
  channel: string;
  payload: unknown;
  status: Generated<WorkerJobStatus>;
  attempts: Generated<number>;
  next_attempt_at: Generated<Date>;
  locked_by: string | null;
  locked_at: Date | null;
  last_error: string | null;
  created_at: Generated<Date>;
  completed_at: Date | null;
}

// ---------------------------------------------------------------------------
// Era 2 C1 — reference data (securities, aliases, splits, calendar, prices).
// Six logical entities, eight physical tables after deviations A + B.
// ---------------------------------------------------------------------------

export interface SecuritiesTable {
  /** `mic:ticker` composite string PK (e.g. 'XNAS:AAPL'). CHECK-constrained. */
  key: string;
  mic: string;
  exchange: string;
  ticker: string;
  asset_class: string;
  currency: string;
  description: string | null;
  country_code: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

export interface SecurityAliasesTable {
  alias_type: string;
  alias: string;
  /** securities.key FK RESTRICT. */
  security_key: string;
  ignored: boolean | null;
  unlisted: boolean | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

export interface StockSplitsTable {
  /** securities.key FK CASCADE. */
  security_key: string;
  effective_date: Date;
  ticker: string;
  split_factor: number;
  split_to: number | null;
  split_from: number | null;
  historical_adjustment_factor: number | null;
  adjustment_type: string;
  vendor_name: string;
  applied_at: Date | null;
  txn_count: number | null;
  vendor_corrected_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

export type StockSplitsCoverageStatus = 'ready' | 'pending' | 'failed';

export interface StockSplitsCoverageTable {
  /** securities.key FK CASCADE. PK (one row per security). */
  security_key: string;
  status: StockSplitsCoverageStatus;
  applied_through_date: Date | null;
  last_attempt_at: Date | null;
  last_error: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

export interface MarketCalendarTable {
  mic: string;
  year: number;
  refreshed_at: Date;
  source: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

export interface MarketCalendarHolidaysTable {
  mic: string;
  holiday_date: Date;
  name: string;
  /** PostgreSQL TIME; string at the kysely boundary. */
  early_close: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

export interface PricesEquityTable {
  /** securities.key FK CASCADE. */
  security_key: string;
  closing_date: Date;
  high: number;
  low: number;
  open: number;
  close: number;
  volume: bigint | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

export type OptionCallPut = 'call' | 'put';

export interface PricesOptionsTable {
  /** securities.key FK CASCADE (underlying). */
  security_key: string;
  expiration_date: Date;
  strike: number;
  call_put: OptionCallPut;
  closing_date: Date;
  /** OCC canonical identifier (e.g. 'AAPL240419C00150000'). UNIQUE. */
  cid: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: bigint | null;
  transactions: number | null;
  last: number | null;
  mark: number | null;
  bid: number | null;
  bid_size: number | null;
  ask: number | null;
  ask_size: number | null;
  open_interest: number | null;
  implied_volatility: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

// ---------------------------------------------------------------------------
// Database — pass as the kysely generic.
// ---------------------------------------------------------------------------

export interface Database {
  users: UsersTable;
  roles: RolesTable;
  user_roles: UserRolesTable;
  user_applications: UserApplicationsTable;
  sessions: SessionsTable;
  role_capabilities: RoleCapabilitiesTable;
  securities: SecuritiesTable;
  security_aliases: SecurityAliasesTable;
  stock_splits: StockSplitsTable;
  stock_splits_coverage: StockSplitsCoverageTable;
  market_calendar: MarketCalendarTable;
  market_calendar_holidays: MarketCalendarHolidaysTable;
  prices_equity: PricesEquityTable;
  prices_options: PricesOptionsTable;
  smoke_events: SmokeEventsTable;
  worker_jobs: WorkerJobsTable;
}
