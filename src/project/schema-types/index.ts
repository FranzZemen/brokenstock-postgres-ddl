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
  /** securities.key FK RESTRICT. NULL for ignored/unlisted aliases (no real security — e.g. cash symbols). */
  security_key: string | null;
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
  /** Earliest vendor-fetch date (DDB parity). Nullable until first successful fetch. */
  earliest_coverage_date: Date | null;
  /** Latest vendor-fetch date (DDB parity). Nullable until first successful fetch. */
  latest_coverage_date: Date | null;
  /** Vendor identifier for the source of this coverage (DDB parity, e.g. 'massive'). */
  coverage_source: string | null;
  /**
   * Vendor-fetch state. NULL = treat as 'ready' per DDB legacy semantics
   * (rows pre-dating the field). API layer projects null → 'ready'.
   */
  coverage_status: StockSplitsCoverageStatus | null;
  /** Worker progress marker — latest effective_date applied across transactions. */
  applied_through_date: Date | null;
  /** Last failed-fetch timestamp (post-DDB addition for ops visibility). */
  last_attempt_at: Date | null;
  /** Last failed-fetch error (post-DDB addition for ops visibility). */
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
  volume: number | null;
  /**
   * Split-adjustment watermark — the date through which split adjustments are
   * already baked into this bar (per-bar analog of a transaction's lastSplitDate).
   * The rebase applies only splits with effective_date > adjusted_through_date.
   * NULL on legacy rows written before the watermark existed (PRD E1/E8).
   */
  adjusted_through_date: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

export type OptionCallPut = 'call' | 'put';

export interface MarketIdentifierCodeMappingsTable {
  mic: string;
  alt_code: string;
  country_code: string | null;
  source: string | null;
  country: string | null;
  timezone: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

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
// Era 6 (Reference Enrichment) — the Era-2 ticker_data_company_info table is
// re-keyed into a security-centric model anchored to securities(key):
//   security_reference          (1:1 with security; company overview body)
//   security_related_companies  (peer tickers; order-ranked, no score)
//   security_transitions        (same-entity ticker_change history; rename-only v1)
// ticker_data_ratios is left untouched (out of Era-6 scope). Every number →
// DOUBLE PRECISION; DATE = list_date; TIMESTAMPTZ = vendor_last_updated_utc,
// delisted_utc. See 2026-06-20T120000Z_era_6_security_reference.ts.
// ---------------------------------------------------------------------------

export interface SecurityReferenceTable {
  /** PK; `mic:ticker` securityKey → FK securities(key) ON DELETE RESTRICT. */
  security_key: string;
  /** Denormalized from the security. */
  ticker: string;
  /** Denormalized from the security. */
  mic: string;
  /** Raw Massive type code ('CS','ADRC',…); mapped SecurityType = securities.asset_class. */
  vendor_type: string | null;
  /** Massive last_updated_utc (LIST endpoint freshness marker); drives delta refresh. */
  vendor_last_updated_utc: Date | null;
  active: Generated<boolean>;
  name: string | null;
  description: string | null;
  /** CHECK (when present): stocks | crypto | fx | otc | indices. */
  market: string | null;
  /** CHECK (when present): us | global. */
  locale: string | null;
  currency: string | null;
  cik: string | null;
  composite_figi: string | null;
  share_class_figi: string | null;
  sic_code: string | null;
  sic_description: string | null;
  industry: string | null;
  total_employees: number | null;
  list_date: Date | null;
  market_cap: number | null;
  /** Massive share_class_shares_outstanding. */
  shares_outstanding: number | null;
  weighted_shares_outstanding: number | null;
  round_lot: number | null;
  ceo: string | null;
  fiscal_year_end: string | null;
  homepage_url: string | null;
  phone_number: string | null;
  address_line1: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal_code: string | null;
  icon_url: string | null;
  logo_url: string | null;
  ticker_root: string | null;
  ticker_suffix: string | null;
  delisted_utc: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

export interface SecurityRelatedCompaniesTable {
  /** Subject security → FK securities(key) ON DELETE CASCADE. */
  security_key: string;
  /** Denormalized vendor symbol of the peer. */
  related_ticker: string;
  /** Best-effort: resolved only when held + unambiguous across MICs; else NULL. */
  related_security_key: string | null;
  /** Array index from /v1/related-companies — the only relevance signal. */
  ordinal: number | null;
  refreshed_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

export interface SecurityTransitionsTable {
  /** Current entity → FK securities(key) ON DELETE CASCADE. */
  security_key: string;
  /** Date of the change to to_ticker. */
  effective_date: Date;
  from_ticker: string | null;
  to_ticker: string | null;
  /** Best-effort FK (old symbol is usually delisted → not held → NULL). */
  from_security_key: string | null;
  to_security_key: string | null;
  /** CHECK: 'ticker_change' (rename-only v1; extensible). */
  transition_type: Generated<string>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

export interface TickerDataRatiosTable {
  ticker: string;
  symbol: string;
  cik: string | null;
  as_of_date: Date;
  close_price: number;
  average_volume: number | null;
  market_cap: number | null;
  enterprise_value: number | null;
  earnings_per_share: number | null;
  price_to_earnings: number | null;
  price_to_book: number | null;
  price_to_sales: number | null;
  price_to_cash_flow: number | null;
  price_to_free_cash_flow: number | null;
  ev_to_sales: number | null;
  ev_to_ebitda: number | null;
  return_on_assets: number | null;
  return_on_equity: number | null;
  current_ratio: number | null;
  quick_ratio: number | null;
  cash_ratio: number | null;
  debt_to_equity: number | null;
  dividend_yield: number | null;
  free_cash_flow: number | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

// ---------------------------------------------------------------------------
// Database — pass as the kysely generic.
// ---------------------------------------------------------------------------

// Era 5 — audit-chain Postgres backing (publish/thesis audit trail; replaces the
// retired s3-dynamo provider). Append-only; integrity via the per-entry hash chain.
export interface AuditChainEntryTable {
  sequence_number: number;
  timestamp: string;
  actor_id: string;
  actor_roles: unknown;          // JSONB Roles[]
  action_type: string;
  resource_type: string;
  resource_id: string;
  resource_key: string;          // `${resourceType}#${resourceId}`
  payload: unknown | null;       // JSONB
  previous_hash: string;
  current_hash: string;
  signature: string;
  key_version: string;
}

export interface AuditChainCounterTable {
  id: string;
  sequence_number: number;
}

// ---------------------------------------------------------------------------
// fleet_admin_audit — Fleet Admin Console central audit trail (PRD E2 / D9).
// Append-mostly: INSERT at action start, optional single UPDATE on completion.
// BIGINT identity PK comes back from node-pg as a string (see job_id).
// ---------------------------------------------------------------------------

export interface FleetAdminAuditTable {
  id: Generated<string>;
  actor: string;
  actor_roles: Generated<unknown>;
  /** 'monitor' | 'runtime' | 'iac' (CHECK-constrained). */
  tier: string;
  action: string;
  target_kind: string | null;
  target: string | null;
  env: string;
  db_name: string | null;
  params: Generated<unknown>;
  /** 'started' | 'success' | 'failure' (CHECK-constrained). */
  status: string;
  ssm_command_id: string | null;
  result: string | null;
  output: string | null;
  error: string | null;
  created_at: Generated<Date>;
  completed_at: Date | null;
}

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
  market_identifier_code_mappings: MarketIdentifierCodeMappingsTable;
  security_reference: SecurityReferenceTable;
  security_related_companies: SecurityRelatedCompaniesTable;
  security_transitions: SecurityTransitionsTable;
  ticker_data_ratios: TickerDataRatiosTable;
  smoke_events: SmokeEventsTable;
  worker_jobs: WorkerJobsTable;
  vendor_sync_jobs: VendorSyncJobsTable;
  job: JobTable;
  job_chunk: JobChunkTable;
  queue: QueueTable;
  brokerage_accounts: BrokerageAccountsTable;
  brokerage_file_imports: BrokerageFileImportsTable;
  brokerage_records: BrokerageRecordsTable;
  brokerage_imports: BrokerageImportsTable;
  cash_entry: CashEntryTable;
  transactions: TransactionsTable;
  trades: TradesTable;
  sub_trades: SubTradesTable;
  trade_journal_entries: TradeJournalEntriesTable;
  transfer_pending: TransferPendingTable;
  transfer_events: TransferEventsTable;
  transfer_event_lots: TransferEventLotsTable;
  thesis: ThesisTable;
  subscription_plans: SubscriptionPlansTable;
  subscription_features: SubscriptionFeaturesTable;
  plan_versions: PlanVersionsTable;
  plan_version_features: PlanVersionFeaturesTable;
  user_subscriptions: UserSubscriptionsTable;
  feature_usage: FeatureUsageTable;
  // Era 4 / 4a — yield persistence (trade-yield-persistence DDB→PG).
  trade_yield_segments: TradeYieldSegmentsTable;
  trade_yield_segment_transaction_portions: TradeYieldSegmentTransactionPortionsTable;
  sub_trade_yield_units: SubTradeYieldUnitsTable;
  open_trade_yield_summaries: OpenTradeYieldSummariesTable;
  as_of_trade_yield_summaries: AsOfTradeYieldSummariesTable;
  since_trade_yield_summaries: SinceTradeYieldSummariesTable;
  trade_daily_mtm_series: TradeDailyMtmSeriesTable;
  trade_daily_mtm_archetype_contributions: TradeDailyMtmArchetypeContributionsTable;
  // Era 4 / 4b — gain snapshots (gain-snapshots DDB→PG).
  nightly_account_gains: NightlyAccountGainsTable;
  nightly_portfolio_gains: NightlyPortfolioGainsTable;
  as_of_account_gains: AsOfAccountGainsTable;
  as_of_portfolio_gains: AsOfPortfolioGainsTable;
  // Era 5 — final domain DDB→PG ports.
  synthetic_trades: SyntheticTradesTable;
  synthetic_trade_item_refs: SyntheticTradeItemRefsTable;
  publisher_identity: PublisherIdentityTable;
  ops_split_metrics: OpsSplitMetricsTable;
  metered_vendor_credits: MeteredVendorCreditsTable;
  operational_alerts: OperationalAlertsTable;
  pending_work: PendingWorkTable;
  observability_events: ObservabilityEventsTable;
  batch_control: BatchControlTable;
  batch_control_workers: BatchControlWorkersTable;
  audit_chain_entry: AuditChainEntryTable;
  audit_chain_counter: AuditChainCounterTable;
  fleet_admin_audit: FleetAdminAuditTable;
}

/**
 * pending_work — @franzzemen/pending-work DDB→PG (Era 5). work_id PK; owner
 * nullable (user kinds omit it). ttl_epoch BIGINT (read back as string).
 */
export interface PendingWorkTable {
  work_id: string;
  owner: string | null;
  kind: string;
  scope_key: string;
  producer: string;
  status: string;
  ttl_epoch: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

/**
 * observability_events — @franzzemen/observability DDB→PG (Era 5). Append-only.
 * epoch_ms BIGINT; rru/wru/duration_ms NUMERIC (read back as string); dims JSONB.
 */
export interface ObservabilityEventsTable {
  event_id: string;
  owner: string;
  namespace: string;
  kind: string;
  epoch_ms: string;
  dims: unknown | null;
  rru: string | null;
  wru: string | null;
  duration_ms: string | null;
  success: boolean | null;
  producer: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

/**
 * batch_control — @franzzemen/batch-control DDB→PG (Era 5). Process row + the
 * distributed lease (lease_holder/lease_expiry). started/completed/lease BIGINT
 * (read back as string); metadata/worker_counts JSONB.
 */
export interface BatchControlTable {
  process_id: string;
  status: string;
  started_by: string | null;
  started_epoch: string | null;
  completed_epoch: string | null;
  bookmark: string | null;
  metadata: unknown | null;
  worker_counts: unknown | null;
  lease_holder: string | null;
  lease_expiry: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

/**
 * batch_control_workers — @franzzemen/batch-control DDB→PG (Era 5). One row per
 * (process_id, worker_key). status is a column (GROUP BY for reconcile); the rest
 * of the WorkerStatusRecord lives in the data JSONB payload.
 */
export interface BatchControlWorkersTable {
  process_id: string;
  worker_key: string;
  status: string;
  data: unknown | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

/**
 * operational_alerts — @franzzemen/brokenstock-alerts DDB+SQS→PG (Era 5). The SQS
 * enqueue + writer Lambda collapse to a direct upsert; dedup/re-open serialized by
 * a row lock on dedupe_key. resolved_epoch/ttl_epoch BIGINT (read back as string);
 * description + notes are JSONB (notes is the AlertNote[] append log).
 */
export interface OperationalAlertsTable {
  alert_id: string;
  type: string;
  /** 'New' | 'In Progress' | 'Resolved' (CHECK). */
  status: string;
  dedupe_key: string;
  owner: string | null;
  description: unknown | null;
  resolved_epoch: string | null;
  ttl_epoch: string | null;
  notes: Generated<unknown>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

/**
 * synthetic_trades — @franzzemen/synthetic-trades DDB→PG (Era 5). `uuid` is the
 * app-minted globally-unique PK; `owner` denormalized for owner-scoped reads.
 * Epoch boundary (createdEpoch/updatedEpoch) materializes from created_at/updated_at.
 */
export interface SyntheticTradesTable {
  uuid: string;
  owner: string;
  symbol: string;
  name: string | null;
  status: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

/**
 * synthetic_trade_item_refs — @franzzemen/synthetic-trades component graph DDB→PG
 * (Era 5). One row per (parent synthetic_trade_uuid, ordinal_position). FK to
 * synthetic_trades(uuid) ON DELETE CASCADE; `referenced_uuid` index backs
 * cycle-detection + parent-ref lookups.
 */
export interface SyntheticTradeItemRefsTable {
  synthetic_trade_uuid: string;
  ordinal_position: number;
  referenced_uuid: string;
  /** 'trade' | 'synthetic-trade' (CHECK). */
  type: string;
  owner: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

/**
 * publisher_identity — @franzzemen/publish-thesis DDB→PG (Era 5). One row per
 * owner; publisher_uuid is the unique public path segment.
 */
export interface PublisherIdentityTable {
  owner_uuid: string;
  publisher_uuid: string;
  is_index_published: Generated<boolean>;
  index_link: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

/**
 * ops_split_metrics — @franzzemen/stock-splits DDB→PG (Era 5). Append-only ops
 * telemetry. event_epoch BIGINT (reads back as string; Number() at boundary);
 * split_factor/magnitude NUMERIC (string at boundary); details JSONB.
 */
export interface OpsSplitMetricsTable {
  event_uuid: string;
  event_type: string;
  event_date: string;
  event_epoch: string;
  owner: string;
  security_key: string | null;
  effective_date: string | null;
  split_factor: string | null;
  magnitude: string | null;
  details: unknown | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

/**
 * metered_vendor_credits — @franzzemen/financial-api DDB→PG (Era 5). One row per
 * vendor; cross-process accounting via SELECT ... FOR UPDATE on the row. BIGINT
 * columns read back as string (Number() at boundary); buckets is a JSONB
 * { [epochSecond: string]: creditsUsed }.
 */
export interface MeteredVendorCreditsTable {
  vendor: string;
  credits_per_period: string;
  period_millis: string;
  buckets: Generated<Record<string, number>>;
  version: Generated<string>;
  forever_start: string;
  forever_credits_used: Generated<string>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

/**
 * thesis — @franzzemen/thesis DDB→PG (2026-06-07; standalone, not an Era).
 * THESIS_SYMBOL_TABLE dropped (GIN on underlying_symbols replaces it); name-index
 * LSI → (owner,name) btree. Narrative/template stay in S3.
 */
export interface ThesisTable {
  /** App-minted branded ThesisUUID `<uuid>.thesis`. */
  thesis_id: string;
  /** Branded `<uuid>.user`. */
  owner: string;
  name: string;
  thesis_summary: string;
  underlying_symbols: Generated<string[]>;
  /** timeWindow.startEpoch (timestamptz). */
  time_window_start_epoch: Date | null;
  /** timeWindow.endEpoch (timestamptz). */
  time_window_end_epoch: Date | null;
  accounts: string[] | null;
  narrative_s3_key: string | null;
  publish_slug: string | null;
  publish_link: string | null;
  is_published: boolean | null;
  first_published_at: Date | null;
  last_published_at: Date | null;
  copyright_notice: string | null;
  yield_ref_trade_uuids: string[] | null;
  yield_ref_as_of_epoch: Date | null;
  yield_ref_computed_at: Date | null;
  yield_ref_is_stale: boolean | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// ---------------------------------------------------------------------------
// vendor_sync_jobs — Era 2 C4 queue table for vendor-sync-worker.
// ---------------------------------------------------------------------------

/** 4-state job lifecycle. */
export type VendorSyncJobStatus = 'queued' | 'in_progress' | 'completed' | 'failed';

/** The 6 in-scope vendor feeds (C4 D3). */
export type VendorSyncFeedType =
  | 'equity-prices'
  | 'options-prices'
  | 'stock-splits-fetch'
  | 'market-calendar'
  | 'ticker-info'
  | 'ticker-ratios'
  // Ad-hoc background repair of corrupted equity price history (PRD E5). Unlike the
  // scheduled feeds it is not dedupe-by-day (multiple repairs may run in a day), and
  // its payload carries the target securityKeys.
  | 'equity-price-repair';

export interface VendorSyncJobsTable {
  /** uuid4 string PK. */
  job_id: string;
  feed_type: VendorSyncFeedType;
  /** Trading-date / refresh-date the job covers. */
  scheduled_for_date: Date;
  /** Free-form per-feed metadata (e.g. ticker list). */
  payload: unknown;
  status: Generated<VendorSyncJobStatus>;
  attempts: Generated<number>;
  next_attempt_at: Generated<Date>;
  last_error: string | null;
  enqueued_at: Generated<Date>;
  started_at: Date | null;
  completed_at: Date | null;
  /** EC2 IMDS instance-id of the worker that claimed the job. */
  worker_instance_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

// ---------------------------------------------------------------------------
// Era 3 C1 — pg-queue / pg-chunked-jobs substrate (job, job_chunk, queue).
// Generic batch substrate; see era-3-c01-substrate-pg-queue-and-chunked-jobs
// .prd.md (RD-1…RD-21). BIGINT identity PKs surface as `string` through the
// kysely PostgresDialect (node-pg returns bigint as string to avoid precision
// loss); FK columns referencing them are typed `string`.
// ---------------------------------------------------------------------------

/** Parent job lifecycle (RD-6). `queued` (collision-policy `queue`) is a parked
 *  status OUTSIDE the single-flight active set — promoted to `running` when the
 *  partition_key frees. `canceled` is the terminal state of a superseded job. */
export type JobStatus =
  | 'queued'
  | 'planning'
  | 'running'
  | 'finalizing'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'canceled';

/** Queue-row lifecycle for chunks + generic queue rows (RD-9): failed=poison,
 *  dead=exhausted, canceled=pending chunk of a superseded job (collision-policy `supersede`). */
export type QueueRowStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'dead' | 'canceled';

/** Work chunk vs the separate finalize chunk-of-one (RD-5). */
export type JobChunkKind = 'work' | 'finalize';

export interface JobTable {
  job_id: Generated<string>;
  job_type: string;
  owner: string | null;
  /** Single-flight chaining key (RD-13); NULL = unconstrained. */
  partition_key: string | null;
  status: Generated<JobStatus>;
  /** Counters track kind='work' chunks only (RD-5) → O(1) progress. */
  chunk_total: Generated<number>;
  chunk_completed: Generated<number>;
  chunk_failed: Generated<number>;
  /** Set true by a coalesced collision; finalize re-arms once then clears it
   *  (collision-policy `coalesce` + dirty-rerun). */
  dirty: Generated<boolean>;
  /** Debounce schedule + FE countdown (collision-policy `coalesce` + debounce):
   *  absolute timestamp the dirty-rerun is gated to. NULL = run when claimable. */
  next_run_at: Date | null;
  /** Parked fan-out spec (PartitionSpec[]) for a `queued` job (collision-policy
   *  `queue`); consumed + cleared when the job is promoted. NULL otherwise. */
  queued_partitions: unknown;
  /** Consecutive dirty-reruns for one finalize lineage; gates the rerun cap. */
  rerun_count: Generated<number>;
  payload: unknown;
  result: unknown;
  error: string | null;
  /** UNIQUE; NULL = no dedupe (RD-8). */
  idempotency_key: string | null;
  submitted_at: Generated<Date>;
  started_at: Date | null;
  finalized_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface JobChunkTable {
  chunk_id: Generated<string>;
  /** FK → job.job_id. */
  job_id: string;
  /** Denormalized from job for single-table claim (no join). */
  job_type: string;
  kind: Generated<JobChunkKind>;
  chunk_ordinal: number;
  /** Opaque partition identity; substrate never parses it (RD-15). */
  partition: string;
  status: Generated<QueueRowStatus>;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  /** Backoff gate (RD-21). */
  next_attempt_at: Generated<Date>;
  /** Lease owner (NULL when free). */
  locked_by: string | null;
  /** Lease gate: reclaim when locked_at + lease(job_type) < now() (RD-4/RD-21). */
  locked_at: Date | null;
  payload: unknown;
  result: unknown;
  last_error: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** Generic single-shot queue row (RD-9) — conforms to the same queue-row contract. */
export interface QueueTable {
  queue_id: Generated<string>;
  queue_name: string;
  status: Generated<QueueRowStatus>;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  next_attempt_at: Generated<Date>;
  locked_by: string | null;
  locked_at: Date | null;
  payload: unknown;
  result: unknown;
  last_error: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// ---------------------------------------------------------------------------
// Era 3 C3 — provenance (brokerage_accounts, brokerage_file_imports,
// brokerage_records, brokerage_imports, cash_entry). See
// era-3-c03-provenance.prd.md (CD-1…CD-9 + D6/D7/D10/D12). Surrogate UUID PKs
// (D6) surface as `string` through the kysely PostgresDialect; FK columns
// referencing them (and securities.key TEXT) are typed `string`. JSONB →
// `unknown`; TIMESTAMPTZ/DATE → `Date`; the 7 metrics columns are NUMERIC →
// `number`. Enum CHECKs mirrored as TS unions below.
// ---------------------------------------------------------------------------

/** financial-identity brokerage.ts:6 — the 4 brokerages. */
export type Brokerage = 'Unknown' | 'Fidelity' | 'IBKR' | 'Schwab';

/** financial-identity imports/file-import.ts:20-37 — file-import lifecycle (17 vals). */
export type FileImportStatus =
  | 'none'
  | 'imported'
  | 'pending split multiple accounts decision'
  | 'ready for parsing'
  | 'parsing'
  | 'pending instrument identification'
  | 'ready for processing'
  | 'adjusting for stock splits'
  | 'processing'
  | 'processed'
  | 'matched'
  | 'failed'
  | 'unprocessing'
  | 'deleting'
  | 'retrying'
  | 'pending duplicate records decision'
  | 'calculating-dependencies'
  | 'complete';

/** financial-identity imports/parser-name.ts:6 — the 6 parsers. */
export type ParserName =
  | 'Standard JSON History Parser'
  | 'Fidelity CSV Parser'
  | 'Fidelity Multiple Account CSV Parser'
  | 'Fidelity Retirement Parser'
  | 'IBKR XML Flex Query Parser'
  | 'Schwab Think Or Swim CSV Parser';

/** financial-identity imports/brokerage-record.ts:13-18 — record lifecycle (5 vals). */
export type BrokerageRecordStatus =
  | 'processed'
  | 'deleted'
  | 'ignored'
  | 'unprocessed'
  | 'pending-split-resolution';

export interface BrokerageAccountsTable {
  /** App-minted branded PK `<uuid>.account` (getBrokerageAccountUUID). */
  account_id: string;
  /** users.uuid (denormalized owner). */
  owner: string;
  brokerage: Brokerage;
  account: string;
  nickname: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

export interface BrokerageFileImportsTable {
  /** App-minted branded PK `<uuid>.file-import` (getFileImportUUID). */
  file_import_id: string;
  /** Denormalized owner (CD-2). */
  owner: string;
  /** brokerage_accounts.account_id FK. */
  account_id: string;
  filename: string;
  original_filename: string | null;
  brokerage_account_filename: string;
  split: boolean | null;
  /** importDateEpoch → TIMESTAMPTZ (CD-4). */
  import_date: Date | null;
  status: FileImportStatus | null;
  status_text: string | null;
  parser_name: ParserName | null;
  /** Datestamp → DATE (CD-4). */
  earliest_transaction: Date | null;
  /** Datestamp → DATE (CD-4). */
  latest_transaction: Date | null;
  /** Datestamp → DATE (CD-4). */
  exported_date: Date | null;
  /** FileImportHistory[] → JSONB (CD-5). */
  history: unknown;
  /** retryAfterEpoch → TIMESTAMPTZ (CD-4). */
  retry_after: Date | null;
  pause_source: string | null;
  pre_calculate_dependencies: boolean | null;
  hash: string;
  /** BIGINT → string at the kysely boundary. */
  length: string;
  /** FileImportMetrics.totalTx (CD-5). */
  metric_total_tx: number | null;
  /** FileImportMetrics.parserDroppedCount (CD-5). */
  metric_parser_dropped_count: number | null;
  /** FileImportMetrics.splitDroppedCount (CD-5). */
  metric_split_dropped_count: number | null;
  /** FileImportMetrics.nearMissCount (CD-5). */
  metric_near_miss_count: number | null;
  /** FileImportMetrics.aliasIgnoredTx (CD-5). */
  metric_alias_ignored_tx: number | null;
  /** FileImportMetrics.remappedTx (CD-5). */
  metric_remapped_tx: number | null;
  /** FileImportMetrics.unlistedTx (CD-5). */
  metric_unlisted_tx: number | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

export interface BrokerageRecordsTable {
  /** App-minted brokerage-branded PK `<uuid>.<Brokerage>-brokerage-record`
   *  (financial-identity BrokerageRecordUUID; format load-bearing for
   *  transactions.origin_record_id). */
  record_id: string;
  /** Denormalized owner (CD-2). */
  owner: string;
  /** brokerage_accounts.account_id FK. */
  account_id: string;
  /** brokerage_file_imports.file_import_id FK (NOT NULL). */
  file_import_id: string;
  /** securities.key (TEXT) FK; set during reconcile (D12/CD-6), nullable. */
  security_key: string | null;
  status: BrokerageRecordStatus;
  filename: string | null;
  brokerage_unique_identifier: string | null;
  hash: string | null;
  ignored_by: string | null;
  ignored_at: Date | null;
  resolved_at: Date | null;
  resolution_diagnostic: string | null;
  /** Open generic IMPORT_RECORD broker payload → JSONB (D7). */
  payload: unknown;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

export interface BrokerageImportsTable {
  /** App-minted branded PK `<uuid>.import` (getBrokerageImportUUID). */
  import_id: string;
  /** Denormalized owner (CD-2). */
  owner: string;
  /** brokerage_accounts.account_id FK. */
  account_id: string;
  /** brokerage_file_imports.file_import_id FK. */
  file_import_id: string | null;
  filename: string | null;
  brokerage_account_filename: string;
  /** importDateEpoch → TIMESTAMPTZ (CD-4). */
  import_date: Date | null;
  records_count: number | null;
  records_hash: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

export interface CashEntryTable {
  /** App-minted branded PK `<uuid>.cash-entry` (getCashEntryUUID). */
  cash_entry_id: string;
  /** Denormalized owner (CD-2). */
  owner: string;
  /** brokerage_accounts.account_id FK. */
  account_id: string;
  /** brokerage_file_imports.file_import_id FK. */
  file_import_id: string | null;
  symbol: string | null;
  amount: number | null;
  fees: number | null;
  commission: number | null;
  /** transactionEpoch → TIMESTAMPTZ (CD-4). */
  transaction_date: Date | null;
  description: string | null;
  origin_name: string | null;
  /** transactions.transaction_id FK (D10; added C4 2026-06-05). */
  transaction_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

// ---------------------------------------------------------------------------
// Era 3 C4 — transactions (the hinge). See era-3-c04-transactions.prd.md.
// ---------------------------------------------------------------------------
export interface TransactionsTable {
  /** App-minted PK `<uuid>.transaction` (financial-identity getTransactionUUID). */
  transaction_id: string;
  /** Denormalized owner `<uuid>.user`. */
  owner: string;
  /** brokerage_accounts.account_id FK. */
  account_id: string;
  /** Denormalized for query speed (T-d). */
  brokerage: Brokerage;
  account: string;
  /** transactionEpoch → TIMESTAMPTZ. */
  transaction_date: Date;
  /** tradingDate → DATE (travels as 'YYYY-MM-DD' string via the parser pin). */
  trading_date: string;
  /** paidTransactionEpoch → TIMESTAMPTZ. */
  paid_transaction_date: Date | null;
  /** lastSplitDate → DATE. */
  last_split_date: string;
  /** securityKey — plain TEXT, NO securities FK (DEV-T6: Unknown:<TICKER> keys
   *  intentionally absent from securities; app-validated). */
  security_key: string;
  alias_type: string;
  mic: string;
  symbol: string;
  brokerage_alias: string;
  underlying_symbol: string;
  underlying_exchange: string | null;
  country_code: string | null;
  security_type: string;
  action: string;
  action_type: string;
  /** NUMERIC — reads back as string; Number() at the boundary. */
  quantity: string;
  price: string;
  parsed_quantity: string;
  parsed_price: string;
  commission: string;
  fees: string;
  amount: string;
  currency: string;
  origin: string;
  origin_name: string;
  /** brokerage_records.record_id FK (origin='import'); null otherwise (D9). */
  origin_record_id: string | null;
  /** transfer_events FK deferred to #7 — nullable column, no FK. */
  origin_transfer_event_id: string | null;
  brokerage_unique_identifier: string | null;
  transfer_counterparty_hint: string | null;
  /** Trade membership (D8) — written by the trades domain (#6). Real FK →
   *  trades(trade_id) ON DELETE RESTRICT added in node #6 (C5). */
  trade_id: string | null;
  sub_trade_ndx: number | null;
  ordinal_position: number | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

// ---------------------------------------------------------------------------
// trades / sub_trades / trade_journal_entries — Era 3 C5 (node #6, D8).
// Refactors @franzzemen/trades off DDB. See era-3-c05-trades.prd.md.
// D8: trade↔transaction membership lives on `transactions`
// (trade_id/sub_trade_ndx/ordinal_position); trade_transaction_refs +
// sub_trade.transactionUuids[] are dropped (no PG table). trade_origins is also
// dropped (TR-1 — derived from transactions.origin_name).
// ---------------------------------------------------------------------------

export interface TradesTable {
  /** App-minted PK `<uuid>.trade` (financial-identity getTradeUUID). */
  trade_id: string;
  /** Denormalized owner `<uuid>.user`. */
  owner: string;
  /** brokerage_accounts.account_id FK. */
  account_id: string;
  /** Denormalized for query speed (TR-3). */
  brokerage: Brokerage;
  account: string;
  /** getSymbolPartition(getAccountPartition(brokerage,account), symbol). */
  symbol_partition: string;
  symbol: string;
  /** securityKey — plain TEXT, NO securities FK (TR-4 / DEV-T6). */
  security_key: string;
  /** 'Open' | 'Closed' | 'Open Imbalance' (CHECK). */
  status: string;
  /** TR-2 — BIGINT, keeps MIN/MAX_SAFE_INTEGER sentinels (reads back as string;
   *  Number() at the boundary). NOT timestamptz. */
  opened_epoch: string;
  closed_epoch: string;
  /** NUMERIC — reads back as string; Number() at the boundary (TR-7). */
  open_positions: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

export interface SubTradesTable {
  /** App-minted PK `<uuid>.sub-trade` (financial-identity getSubTradeUUID). */
  sub_trade_id: string;
  /** trades.trade_id FK (ON DELETE CASCADE — sub-trades are owned). */
  trade_id: string;
  owner: string;
  account_id: string;
  /** Denormalized (TR-3). */
  brokerage: Brokerage;
  account: string;
  /** Sub-trade index within the trade; UNIQUE(trade_id, ndx). */
  ndx: number;
  /** SubTradePartition `${string}:${SecurityType}`. */
  partition: string;
  symbol: string;
  security_key: string;
  security_type: string;
  status: string;
  /** TR-2 — BIGINT sentinels; string on read. */
  opened_epoch: string;
  closed_epoch: string;
  /** NUMERIC; string on read. */
  open_positions: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

export interface TradeJournalEntriesTable {
  /** App-minted PK `<uuid>.trade-journal-entry` (getTradeJournalEntryUUID). */
  journal_entry_id: string;
  /** transactions.transaction_id FK (ON DELETE CASCADE). */
  transaction_id: string;
  owner: string;
  title: string;
  /** ISO Timestamp string, stored verbatim (TR-6). */
  timestamp: string;
  /** BIGINT, immutable; string on read (TR-6). */
  timestamp_epoch: string;
  journal_entry: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

// ---------------------------------------------------------------------------
// transfer_pending / transfer_events / transfer_event_lots — Era 3 C6 (node #7).
// Refactors @franzzemen/intra-account-transfers (iteration-2 transfers) off DDB.
// See era-3-c06-transfers.prd.md. The DDB single-table pk/sk + the event's
// embedded lotPayload blob + syntheticTxUuids list are all dropped: modeled
// relationally (lots → own rows; synthetics derived via
// transactions.origin_transfer_event_id). Epochs → TIMESTAMPTZ (no sentinels).
// ---------------------------------------------------------------------------

export interface TransferPendingTable {
  /** PK = the originating `transferred shares out/in` transaction (XF-2). FK → transactions. */
  tx_uuid: string;
  owner: string;
  /** Broker account identifier string (DDB's misnamed `accountUuid` = tx.account). */
  account: string;
  /** brokerage_accounts.account_id FK (resolved). */
  account_id: string;
  broker: Brokerage;
  security_key: string;
  symbol: string;
  mic: string;
  /** 'OUT' | 'IN' (CHECK). */
  direction: string;
  /** txEpoch → TIMESTAMPTZ. */
  tx_epoch: Date;
  /** NUMERIC — string on read; Number() at the boundary. */
  quantity: string;
  counterparty_hint: string | null;
  basis_from_statement: string | null;
  /** awaiting-counterpart | insufficient-source-history | ambiguous-multiple-candidates (CHECK). */
  match_blocked_reason: string | null;
  origin_name: string | null;
  last_match_attempt_at: Date | null;
  /**
   * User-set "leave this leg alone" flag. Dismissed legs are filtered out of the
   * matcher candidate read and the Pending tab, and the flag survives re-import
   * (putForTransactions never writes it on conflict). Escape hatch for legs that
   * can't be auto-resolved (no source history, orphaned counterpart).
   */
  dismissed: Generated<boolean>;
  /** Audit. `createdAt` (domain) is materialized from created_at (same instant). */
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

export interface TransferEventsTable {
  /** App-minted PK `<uuid>.transfer-event` (newTransferEventId). */
  transfer_event_id: string;
  owner: string;
  broker: Brokerage;
  security_key: string;
  transfer_epoch: Date;
  /** Sender account string / resolved FK — null on a no-counterpart in-only event. */
  from_account: string | null;
  from_account_id: string | null;
  /** Receiver account string / resolved FK — null on a no-counterpart out-only event. */
  to_account: string | null;
  to_account_id: string | null;
  /** Originating broker `transferred shares out`/`in` transactions (nullable). */
  from_tx_uuid: string | null;
  to_tx_uuid: string | null;
  /** Parent event for chained A→B→C transfers (self-FK, SET NULL). */
  lineage_parent_id: string | null;
  /** 'matched' | 'no-counterpart-user-confirmed' (CHECK). */
  resolution: string;
  resolved_at: Date;
  /** 'auto' (matcher) or an owner uuid (user-resolved) — plain TEXT, no actor CHECK. */
  resolved_by: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

export interface TransferEventLotsTable {
  /** FK → transfer_events (ON DELETE CASCADE); composite PK with lot_ndx. */
  transfer_event_id: string;
  /** FIFO order within the event. */
  lot_ndx: number;
  owner: string;
  /** NUMERIC — string on read. */
  quantity: string;
  basis_per_share: string;
  original_acquisition_epoch: Date;
  /** DATE — 'YYYY-MM-DD' via ::text read (off-by-one gotcha #1); null if absent. */
  original_acquisition_date: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

// ---------------------------------------------------------------------------
// Era 3.5 — Billing / Subscriptions (subscription-plans + user-subscriptions
// DDB→PG). Natural keys; planVersionId `${slug}#${ver}` → (plan_slug,
// version_number) composite; PlanVersionFeature.value (bool|number) → two
// nullable typed cols (XOR CHECK); epoch → timestamptz; user_uuid soft pointer.
// See doc/prd/era-3.5-billing-subscriptions.prd.md.
// ---------------------------------------------------------------------------

/** Subscription plan catalog row (global, admin-managed). */
export interface SubscriptionPlansTable {
  /** Branded PlanSlug (lowercase-kebab). */
  plan_slug: string;
  name: string;
  description: string | null;
  default_price_in_cents: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** Feature catalog row (global). type discriminates boolean vs quantity. */
export interface SubscriptionFeaturesTable {
  feature_slug: string;
  name: string;
  description: string | null;
  /** 'boolean' | 'quantity'. */
  type: string;
  /** Default quota for quantity features. */
  default_limit: number | null;
  active: Generated<boolean>;
  hidden: Generated<boolean>;
  ordinal_position: number | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** Plan version (draft → active → archived). created_at doubles as PlanVersion.createdAt. */
export interface PlanVersionsTable {
  plan_slug: string;
  version_number: number;
  /** 'draft' | 'active' | 'archived'. */
  status: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** Entitlement: a feature on a plan version. value_bool XOR value_number (BS-5). */
export interface PlanVersionFeaturesTable {
  plan_slug: string;
  version_number: number;
  feature_slug: string;
  /** Set iff the feature is type 'boolean'. */
  value_bool: boolean | null;
  /** Set iff the feature is type 'quantity' (NUMERIC → string on read). */
  value_number: string | null;
  /** Reset cadence for quantity features. */
  reset_period: string | null;
  /** Arbitrary per-plan customization (e.g. {theme:'dark'}). */
  variant_data: unknown | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** A user's subscription to a plan version. */
export interface UserSubscriptionsTable {
  /** Branded `<uuid>.user` (soft pointer, no FK to users). */
  user_uuid: string;
  plan_slug: string;
  version_number: number;
  /** 'active' | 'trialing' | 'expired'. */
  status: string;
  auto_upgrade: Generated<boolean>;
  created_by: string | null;
  updated_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** Metered usage counter (quantity features only). reset_date index replaces the DDB resetPartition GSI. */
export interface FeatureUsageTable {
  user_uuid: string;
  feature_slug: string;
  current_count: Generated<number>;
  reset_date: Date;
  /** TimeUnit. */
  reset_period: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// ===========================================================================
// Era 4 / 4a — yield persistence (trade-yield-persistence DDB→PG)
// NUMERIC/BIGINT read back as string (Number() at the boundary, per trades TR-7);
// INTEGER → number; DATE → Date; trigger-managed timestamps → Generated<Date>.
// ===========================================================================

/** Per-segment yield facts, scoped by context ('open' | 'asOf:DATE' | 'since:EPOCH'). */
export interface TradeYieldSegmentsTable {
  /** App-minted PK `<uuid>.trade-yield-segment`. */
  segment_id: string;
  /** Branded `<uuid>.user`. */
  owner: string;
  /** trades.trade_id FK ON DELETE CASCADE. */
  trade_id: string;
  context: string;
  sub_trade_uuids: Generated<string[]>;
  archetype: string;
  /** NUMERIC. */
  denominator: string;
  /** BIGINT. */
  start_epoch: string;
  end_epoch: string | null;
  start_boundary_kind: string;
  end_boundary_kind: string | null;
  gain: string;
  mtm_price_at_boundary: string | null;
  days: number;
  yield: string;
  fees_and_commissions: string;
  explanation: string | null;
  /** managed-rolls lineage/DAG (bounded uuid arrays). */
  leaf_chain_uuids: string[] | null;
  prior_segment_uuids: string[] | null;
  closing_transaction_uuids: string[] | null;
  opening_transaction_uuids: string[] | null;
  family_cluster_id: string | null;
  /** boundaryQuantityDelta {prior, current} — NUMERIC, read back as string. */
  boundary_qty_delta_prior: string | null;
  boundary_qty_delta_current: string | null;
  started_by: string | null;
  job_id: string | null;
  writer: string | null;
  writer_version: string | null;
  written_at: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

/** The unbounded `transactionPortions[]` of a segment, relationalized (4a-4). */
export interface TradeYieldSegmentTransactionPortionsTable {
  segment_id: string;
  /** transactions.transaction_id FK ON DELETE CASCADE. */
  transaction_id: string;
  portion: string;
  created_at: Generated<Date>;
  created_by: string;
}

/** Per-symbol forensic yield units, scoped by context. */
export interface SubTradeYieldUnitsTable {
  /** App-minted PK `<uuid>.sub-trade-yield-unit`. */
  unit_id: string;
  owner: string;
  trade_id: string;
  context: string;
  /** `<uuid>.sub-trade`. */
  sub_trade_id: string;
  symbol: string;
  archetype: string;
  denominator: string;
  start_epoch: string;
  end_epoch: string | null;
  gain: string;
  mtm_price_at_boundary: string | null;
  days: number;
  yield: string;
  fees_and_commissions: string;
  explanation: string | null;
  started_by: string | null;
  job_id: string | null;
  writer: string | null;
  writer_version: string | null;
  written_at: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

/** One PSCaR summary per (owner, trade). */
export interface OpenTradeYieldSummariesTable {
  owner: string;
  trade_id: string;
  peak_simultaneous_car: string;
  start_epoch: string;
  end_epoch: string | null;
  days: number;
  total_gain: string;
  realized_gain: string;
  unrealized_gain: string;
  passive_gain: string;
  fees_and_commissions: string;
  yield: string;
  annualized_yield_linear: string;
  annualized_yield_cagr: string;
  sub_trade_wins: number;
  sub_trade_losses: number;
  sub_trade_breakevens: number;
  sub_trade_win_rate: string | null;
  sub_trade_win_amount: string;
  sub_trade_loss_amount: string;
  /** 'realtime' | 'most-recent-close' (CHECK). */
  price_source: string | null;
  closing_date: Date | null;
  computed_at: string;
  explanation: string | null;
  price_coverage: string | null;
  recompute_attempts: number | null;
  started_by: string | null;
  job_id: string | null;
  writer: string | null;
  writer_version: string | null;
  written_at: string | null;
  /**
   * JSONB TradeYieldSegmentSummary.lineageGraph (managed-roll v3 inference output).
   * Render-only, bounded payload — the FE Managed Rolls tab consumes it verbatim;
   * no SQL queries inside it. Deliberate exception to era-4-4a's ZERO-jsonb rule
   * (see restore-managed-roll-lineage-persistence.prd.md D2). NULL for equity-only trades.
   */
  lineage_graph: unknown | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

/** One summary per (owner, trade, as_of_date). Nullable analytics carry an `error` row. */
export interface AsOfTradeYieldSummariesTable {
  owner: string;
  trade_id: string;
  as_of_date: Date;
  as_of_epoch: string;
  peak_simultaneous_car: string | null;
  start_epoch: string | null;
  end_epoch: string | null;
  days: number | null;
  total_gain: string | null;
  realized_gain: string | null;
  unrealized_gain: string | null;
  passive_gain: string | null;
  fees_and_commissions: string | null;
  yield: string | null;
  annualized_yield_linear: string | null;
  annualized_yield_cagr: string | null;
  sub_trade_wins: number | null;
  sub_trade_losses: number | null;
  sub_trade_breakevens: number | null;
  sub_trade_win_rate: string | null;
  sub_trade_win_amount: string | null;
  sub_trade_loss_amount: string | null;
  price_coverage: string | null;
  error: string | null;
  price_source: string | null;
  closing_date: Date | null;
  explanation: string | null;
  computed_at: string;
  started_by: string | null;
  job_id: string | null;
  writer: string | null;
  writer_version: string | null;
  written_at: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

/** One summary per (owner, trade, since_anchor_epoch). */
export interface SinceTradeYieldSummariesTable {
  owner: string;
  trade_id: string;
  since_anchor_epoch: string;
  gain_since: string | null;
  peak_simultaneous_car: string | null;
  start_epoch: string | null;
  end_epoch: string | null;
  days: number | null;
  total_gain: string | null;
  realized_gain: string | null;
  unrealized_gain: string | null;
  passive_gain: string | null;
  fees_and_commissions: string | null;
  yield: string | null;
  annualized_yield_linear: string | null;
  annualized_yield_cagr: string | null;
  sub_trade_wins: number | null;
  sub_trade_losses: number | null;
  sub_trade_breakevens: number | null;
  sub_trade_win_rate: string | null;
  sub_trade_win_amount: string | null;
  sub_trade_loss_amount: string | null;
  price_source: string | null;
  closing_date: Date | null;
  explanation: string | null;
  computed_at: string;
  started_by: string | null;
  job_id: string | null;
  writer: string | null;
  writer_version: string | null;
  written_at: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

/** Lazy daily MTM curve per trade (chart temporal series). */
export interface TradeDailyMtmSeriesTable {
  owner: string;
  trade_id: string;
  date_epoch: string;
  date: Date;
  mtm_amount: string;
  car_at_date: string;
  price_coverage: string;
  computed_at: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

/** Per-(daily-mtm row, archetype) CaR contribution — the relationalized bounded array. */
export interface TradeDailyMtmArchetypeContributionsTable {
  owner: string;
  trade_id: string;
  date_epoch: string;
  archetype: string;
  car_contribution: string;
  created_at: Generated<Date>;
  created_by: string;
}

// ===========================================================================
// Era 4 / 4b — gain snapshots (gain-snapshots DDB→PG)
// NUMERIC/BIGINT → string (Number() at boundary); INTEGER → number; DATE → Date;
// trigger timestamps → Generated<Date>. `& Partial<Provenance>` → nullable provenance cols.
// ===========================================================================

/** Shared gain + closed-trade W/L tally + meta + provenance + audit columns. */
interface GainSnapshotColumns {
  /** NUMERIC. */
  cumulative_gain: string;
  realized_gain: string;
  unrealized_gain: string;
  trade_wins: number;
  trade_losses: number;
  trade_breakevens: number;
  trade_win_rate: string | null;
  trade_win_amount: string;
  trade_loss_amount: string;
  /** BIGINT. */
  generated_on_epoch: string;
  parent_job_id: string | null;
  started_by: string | null;
  job_id: string | null;
  writer: string | null;
  writer_version: string | null;
  written_at: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by: string;
  updated_by: string;
}

/** Per (owner, date, brokerage, account) daily gain — forever ledger. */
export interface NightlyAccountGainsTable extends GainSnapshotColumns {
  owner: string;
  date: Date;
  brokerage: string;
  account: string;
}

/** Per (owner, date) portfolio gain — forever ledger. */
export interface NightlyPortfolioGainsTable extends GainSnapshotColumns {
  owner: string;
  date: Date;
}

/** Per (owner, as_of_date, brokerage, account) reconstituted gain — ttl-purged cache. */
export interface AsOfAccountGainsTable extends GainSnapshotColumns {
  owner: string;
  as_of_date: Date;
  brokerage: string;
  account: string;
  /** epoch SECONDS expiry (BIGINT). */
  ttl: string;
}

/** Per (owner, as_of_date) reconstituted portfolio gain — ttl-purged cache. */
export interface AsOfPortfolioGainsTable extends GainSnapshotColumns {
  owner: string;
  as_of_date: Date;
  ttl: string;
}
