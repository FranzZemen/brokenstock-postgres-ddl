/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Era 4 / 4a (2026-06-08) — YIELD PERSISTENCE. Refactors
 * @franzzemen/trade-yield-persistence off DynamoDB. The derived per-trade
 * yield layer: segments + sub-trade units (per context: open / asOf:DATE /
 * since:EPOCH), the 3 summary tables, and the daily MTM series.
 * See era-4-4a-yield-persistence-ddl.prd.md (decisions 4a-1…4a-10).
 *
 * 8 tables (the 6 DDB tables, relationalized):
 *   trade_yield_segments            (+ child trade_yield_segment_transaction_portions)
 *   sub_trade_yield_units
 *   open_trade_yield_summaries
 *   as_of_trade_yield_summaries
 *   since_trade_yield_summaries
 *   trade_daily_mtm_series          (+ child trade_daily_mtm_archetype_contributions)
 *
 * Decisions:
 *  - 4a-1 fact rows (segments, units) = one table each + a `context` TEXT column
 *    (the DDB SK prefix); every fact read is by (trade_id, context).
 *  - 4a-2 the 3 summaries stay separate tables (distinct keys; as-of has a
 *    by-(owner, date) rollup read the others lack).
 *  - 4a-3/4a-4 ZERO jsonb: the unbounded `transactionPortions[]` → child table
 *    FK'd to transactions; the bounded `segmentArchetypeContributions[]` → child
 *    table (JSONB requires explicit approval — not granted, so relational).
 *    EXCEPTION (approved 2026-06-19, restore-managed-roll-lineage-persistence.prd.md
 *    D2): the ZERO-jsonb rule governs query/aggregate FACTS (gains, portions, archetype
 *    contributions) that the rollups SQL over. It does NOT govern bounded, RENDER-ONLY
 *    payloads no SQL queries inside — `open_trade_yield_summaries.lineage_graph` (the
 *    managed-roll v3 inference DAG the FE consumes verbatim) is jsonb by approved
 *    carve-out (migration 2026-06-19T130000Z_era_5_open_summary_lineage_graph).
 *  - 4a-4b summary segment_uuids[]/unit_uuids[] arrays DROPPED (DDB join-avoidance;
 *    a trade's facts come from WHERE (owner, trade_id, context)).
 *  - 4a-5 branded-text ids + CHECKs (.user / .trade / .trade-yield-segment /
 *    .sub-trade-yield-unit / .sub-trade), per the trade-graph convention.
 *  - 4a-6 FK trade_id -> trades(trade_id) ON DELETE CASCADE (trades.trade_id is
 *    the PK alone; owner is a carried column, not in the FK). Derived rows ARE
 *    owned by the trade -> CASCADE (unlike transactions which RESTRICT).
 *  - 4a-8 context = TEXT + CHECK; as_of_date DATE / since_anchor_epoch BIGINT are
 *    promoted to real typed columns on the summary tables.
 *  - 4a-10 NO backfill — tables born empty.
 *
 * Pins MIN_SCHEMA_VERSION = 2026-06-08T120000Z.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ACTOR_CHK = `~ '^${UUID_RE}\\.(user|brokenstock)$'`;
const OWNER_CHK = `~ '^${UUID_RE}\\.user$'`;
const TRADE_ID_CHK = `~ '^${UUID_RE}\\.trade$'`;
const SEGMENT_ID_CHK = `~ '^${UUID_RE}\\.trade-yield-segment$'`;
const UNIT_ID_CHK = `~ '^${UUID_RE}\\.sub-trade-yield-unit$'`;
const SUB_TRADE_ID_CHK = `~ '^${UUID_RE}\\.sub-trade$'`;
const TXN_ID_CHK = `~ '^${UUID_RE}\\.transaction$'`;

// context = 'open' | 'asOf:<date>' | 'since:<epoch>'
const CONTEXT_CHK = `CHECK (context = 'open' OR context ~ '^asOf:' OR context ~ '^since:')`;

export const up = (pgm: MigrationBuilder): void => {
  // ===== trade_yield_segments =====
  // archetype / boundary_kind are large, evolving value sets -> plain TEXT (no CHECK).
  pgm.sql(`
    CREATE TABLE trade_yield_segments (
      segment_id            TEXT PRIMARY KEY,
      owner                 TEXT NOT NULL,
      trade_id              TEXT NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
      context               TEXT NOT NULL,
      sub_trade_uuids       TEXT[] NOT NULL DEFAULT '{}',
      archetype             TEXT NOT NULL,
      denominator           NUMERIC NOT NULL,
      start_epoch           BIGINT NOT NULL,
      end_epoch             BIGINT,
      start_boundary_kind   TEXT NOT NULL,
      end_boundary_kind     TEXT,
      gain                  NUMERIC NOT NULL,
      mtm_price_at_boundary NUMERIC,
      days                  INTEGER NOT NULL,
      yield                 NUMERIC NOT NULL,
      fees_and_commissions  NUMERIC NOT NULL,
      explanation           TEXT,
      -- managed-rolls-segment-unification lineage/DAG fields (bounded uuid arrays).
      leaf_chain_uuids          TEXT[],
      prior_segment_uuids       TEXT[],
      closing_transaction_uuids TEXT[],
      opening_transaction_uuids TEXT[],
      family_cluster_id         TEXT,
      -- boundaryQuantityDelta {prior, current} -> two columns (no jsonb).
      boundary_qty_delta_prior   NUMERIC,
      boundary_qty_delta_current NUMERIC,
      started_by            TEXT,
      job_id                TEXT,
      writer                TEXT,
      writer_version        TEXT,
      written_at            BIGINT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by            TEXT NOT NULL,
      updated_by            TEXT NOT NULL,
      CONSTRAINT trade_yield_segments_id_format_chk CHECK (segment_id ${SEGMENT_ID_CHK}),
      CONSTRAINT trade_yield_segments_owner_format_chk CHECK (owner ${OWNER_CHK}),
      CONSTRAINT trade_yield_segments_trade_id_format_chk CHECK (trade_id ${TRADE_ID_CHK}),
      CONSTRAINT trade_yield_segments_context_chk ${CONTEXT_CHK},
      CONSTRAINT trade_yield_segments_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT trade_yield_segments_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  pgm.createIndex('trade_yield_segments', ['owner', 'trade_id', 'context'], {name: 'trade_yield_segments_trade_context_idx'});
  pgm.sql(`CREATE TRIGGER trade_yield_segments_set_updated_at BEFORE UPDATE ON trade_yield_segments FOR EACH ROW EXECUTE FUNCTION set_updated_at();`);

  // ===== trade_yield_segment_transaction_portions (child of segment; the unbounded portions) =====
  pgm.sql(`
    CREATE TABLE trade_yield_segment_transaction_portions (
      segment_id      TEXT NOT NULL REFERENCES trade_yield_segments(segment_id) ON DELETE CASCADE,
      transaction_id  TEXT NOT NULL REFERENCES transactions(transaction_id) ON DELETE CASCADE,
      portion         NUMERIC NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by      TEXT NOT NULL,
      PRIMARY KEY (segment_id, transaction_id),
      CONSTRAINT typ_transaction_id_format_chk CHECK (transaction_id ${TXN_ID_CHK}),
      CONSTRAINT typ_created_by_format_chk CHECK (created_by ${ACTOR_CHK})
    );
  `);
  // Reverse lookup: which segments touch a transaction (backdated-tx invalidation).
  pgm.createIndex('trade_yield_segment_transaction_portions', ['transaction_id'], {name: 'typ_transaction_id_idx'});

  // ===== sub_trade_yield_units =====
  pgm.sql(`
    CREATE TABLE sub_trade_yield_units (
      unit_id               TEXT PRIMARY KEY,
      owner                 TEXT NOT NULL,
      trade_id              TEXT NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
      context               TEXT NOT NULL,
      sub_trade_id          TEXT NOT NULL,
      symbol                TEXT NOT NULL,
      archetype             TEXT NOT NULL,
      denominator           NUMERIC NOT NULL,
      start_epoch           BIGINT NOT NULL,
      end_epoch             BIGINT,
      gain                  NUMERIC NOT NULL,
      mtm_price_at_boundary NUMERIC,
      days                  INTEGER NOT NULL,
      yield                 NUMERIC NOT NULL,
      fees_and_commissions  NUMERIC NOT NULL,
      explanation           TEXT,
      started_by            TEXT,
      job_id                TEXT,
      writer                TEXT,
      writer_version        TEXT,
      written_at            BIGINT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by            TEXT NOT NULL,
      updated_by            TEXT NOT NULL,
      CONSTRAINT sub_trade_yield_units_id_format_chk CHECK (unit_id ${UNIT_ID_CHK}),
      CONSTRAINT sub_trade_yield_units_owner_format_chk CHECK (owner ${OWNER_CHK}),
      CONSTRAINT sub_trade_yield_units_trade_id_format_chk CHECK (trade_id ${TRADE_ID_CHK}),
      CONSTRAINT sub_trade_yield_units_sub_trade_id_format_chk CHECK (sub_trade_id ${SUB_TRADE_ID_CHK}),
      CONSTRAINT sub_trade_yield_units_context_chk ${CONTEXT_CHK},
      CONSTRAINT sub_trade_yield_units_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT sub_trade_yield_units_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  pgm.createIndex('sub_trade_yield_units', ['owner', 'trade_id', 'context'], {name: 'sub_trade_yield_units_trade_context_idx'});
  pgm.sql(`CREATE TRIGGER sub_trade_yield_units_set_updated_at BEFORE UPDATE ON sub_trade_yield_units FOR EACH ROW EXECUTE FUNCTION set_updated_at();`);

  // ===== open_trade_yield_summaries (one per (owner, trade)) =====
  pgm.sql(`
    CREATE TABLE open_trade_yield_summaries (
      owner                   TEXT NOT NULL,
      trade_id                TEXT NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
      peak_simultaneous_car   NUMERIC NOT NULL,
      start_epoch             BIGINT NOT NULL,
      end_epoch               BIGINT,
      days                    INTEGER NOT NULL,
      total_gain              NUMERIC NOT NULL,
      realized_gain           NUMERIC NOT NULL,
      unrealized_gain         NUMERIC NOT NULL,
      passive_gain            NUMERIC NOT NULL,
      fees_and_commissions    NUMERIC NOT NULL,
      yield                   NUMERIC NOT NULL,
      annualized_yield_linear NUMERIC NOT NULL,
      annualized_yield_cagr   NUMERIC NOT NULL,
      sub_trade_wins          INTEGER NOT NULL,
      sub_trade_losses        INTEGER NOT NULL,
      sub_trade_breakevens    INTEGER NOT NULL,
      sub_trade_win_rate      NUMERIC,
      sub_trade_win_amount    NUMERIC NOT NULL,
      sub_trade_loss_amount   NUMERIC NOT NULL,
      price_source            TEXT,
      closing_date            DATE,
      computed_at             BIGINT NOT NULL,
      explanation             TEXT,
      price_coverage          NUMERIC,
      recompute_attempts      INTEGER,
      started_by              TEXT,
      job_id                  TEXT,
      writer                  TEXT,
      writer_version          TEXT,
      written_at              BIGINT,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by              TEXT NOT NULL,
      updated_by              TEXT NOT NULL,
      PRIMARY KEY (owner, trade_id),
      CONSTRAINT open_tys_owner_format_chk CHECK (owner ${OWNER_CHK}),
      CONSTRAINT open_tys_trade_id_format_chk CHECK (trade_id ${TRADE_ID_CHK}),
      CONSTRAINT open_tys_price_source_chk CHECK (price_source IS NULL OR price_source IN ('realtime', 'most-recent-close')),
      CONSTRAINT open_tys_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT open_tys_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  pgm.createIndex('open_trade_yield_summaries', ['written_at'], {name: 'open_tys_written_at_idx'});
  pgm.sql(`CREATE TRIGGER open_tys_set_updated_at BEFORE UPDATE ON open_trade_yield_summaries FOR EACH ROW EXECUTE FUNCTION set_updated_at();`);

  // ===== as_of_trade_yield_summaries (one per (owner, trade, as_of_date)) =====
  pgm.sql(`
    CREATE TABLE as_of_trade_yield_summaries (
      owner                   TEXT NOT NULL,
      trade_id                TEXT NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
      as_of_date              DATE NOT NULL,
      as_of_epoch             BIGINT NOT NULL,
      peak_simultaneous_car   NUMERIC,
      start_epoch             BIGINT,
      end_epoch               BIGINT,
      days                    INTEGER,
      total_gain              NUMERIC,
      realized_gain           NUMERIC,
      unrealized_gain         NUMERIC,
      passive_gain            NUMERIC,
      fees_and_commissions    NUMERIC,
      yield                   NUMERIC,
      annualized_yield_linear NUMERIC,
      annualized_yield_cagr   NUMERIC,
      sub_trade_wins          INTEGER,
      sub_trade_losses        INTEGER,
      sub_trade_breakevens    INTEGER,
      sub_trade_win_rate      NUMERIC,
      sub_trade_win_amount    NUMERIC,
      sub_trade_loss_amount   NUMERIC,
      price_coverage          NUMERIC,
      error                   TEXT,
      price_source            TEXT,
      closing_date            DATE,
      explanation             TEXT,
      computed_at             BIGINT NOT NULL,
      started_by              TEXT,
      job_id                  TEXT,
      writer                  TEXT,
      writer_version          TEXT,
      written_at              BIGINT,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by              TEXT NOT NULL,
      updated_by              TEXT NOT NULL,
      PRIMARY KEY (owner, trade_id, as_of_date),
      CONSTRAINT asof_tys_owner_format_chk CHECK (owner ${OWNER_CHK}),
      CONSTRAINT asof_tys_trade_id_format_chk CHECK (trade_id ${TRADE_ID_CHK}),
      CONSTRAINT asof_tys_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT asof_tys_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  // The as-of gain-rollup reads all trades for an (owner, as_of_date).
  pgm.createIndex('as_of_trade_yield_summaries', ['owner', 'as_of_date'], {name: 'asof_tys_owner_date_idx'});
  pgm.sql(`CREATE TRIGGER asof_tys_set_updated_at BEFORE UPDATE ON as_of_trade_yield_summaries FOR EACH ROW EXECUTE FUNCTION set_updated_at();`);

  // ===== since_trade_yield_summaries (one per (owner, trade, since_anchor_epoch)) =====
  pgm.sql(`
    CREATE TABLE since_trade_yield_summaries (
      owner                   TEXT NOT NULL,
      trade_id                TEXT NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
      since_anchor_epoch      BIGINT NOT NULL,
      gain_since              NUMERIC,
      peak_simultaneous_car   NUMERIC,
      start_epoch             BIGINT,
      end_epoch               BIGINT,
      days                    INTEGER,
      total_gain              NUMERIC,
      realized_gain           NUMERIC,
      unrealized_gain         NUMERIC,
      passive_gain            NUMERIC,
      fees_and_commissions    NUMERIC,
      yield                   NUMERIC,
      annualized_yield_linear NUMERIC,
      annualized_yield_cagr   NUMERIC,
      sub_trade_wins          INTEGER,
      sub_trade_losses        INTEGER,
      sub_trade_breakevens    INTEGER,
      sub_trade_win_rate      NUMERIC,
      sub_trade_win_amount    NUMERIC,
      sub_trade_loss_amount   NUMERIC,
      price_source            TEXT,
      closing_date            DATE,
      explanation             TEXT,
      computed_at             BIGINT NOT NULL,
      started_by              TEXT,
      job_id                  TEXT,
      writer                  TEXT,
      writer_version          TEXT,
      written_at              BIGINT,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by              TEXT NOT NULL,
      updated_by              TEXT NOT NULL,
      PRIMARY KEY (owner, trade_id, since_anchor_epoch),
      CONSTRAINT since_tys_owner_format_chk CHECK (owner ${OWNER_CHK}),
      CONSTRAINT since_tys_trade_id_format_chk CHECK (trade_id ${TRADE_ID_CHK}),
      CONSTRAINT since_tys_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT since_tys_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  pgm.sql(`CREATE TRIGGER since_tys_set_updated_at BEFORE UPDATE ON since_trade_yield_summaries FOR EACH ROW EXECUTE FUNCTION set_updated_at();`);

  // ===== trade_daily_mtm_series (one per (owner, trade, date)) =====
  pgm.sql(`
    CREATE TABLE trade_daily_mtm_series (
      owner             TEXT NOT NULL,
      trade_id          TEXT NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
      date_epoch        BIGINT NOT NULL,
      date              DATE NOT NULL,
      mtm_amount        NUMERIC NOT NULL,
      car_at_date       NUMERIC NOT NULL,
      price_coverage    NUMERIC NOT NULL,
      computed_at       BIGINT NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by        TEXT NOT NULL,
      updated_by        TEXT NOT NULL,
      PRIMARY KEY (owner, trade_id, date_epoch),
      CONSTRAINT tdms_owner_format_chk CHECK (owner ${OWNER_CHK}),
      CONSTRAINT tdms_trade_id_format_chk CHECK (trade_id ${TRADE_ID_CHK}),
      CONSTRAINT tdms_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT tdms_updated_by_format_chk CHECK (updated_by ${ACTOR_CHK})
    );
  `);
  // Chart range scan, ordered by date.
  pgm.createIndex('trade_daily_mtm_series', ['owner', 'trade_id', 'date'], {name: 'tdms_owner_trade_date_idx'});
  pgm.sql(`CREATE TRIGGER tdms_set_updated_at BEFORE UPDATE ON trade_daily_mtm_series FOR EACH ROW EXECUTE FUNCTION set_updated_at();`);

  // ===== trade_daily_mtm_archetype_contributions (child of the daily-mtm row) =====
  // Bounded by #archetypes (<=16). Relational (not jsonb) per the JSONB-needs-approval rule.
  pgm.sql(`
    CREATE TABLE trade_daily_mtm_archetype_contributions (
      owner             TEXT NOT NULL,
      trade_id          TEXT NOT NULL,
      date_epoch        BIGINT NOT NULL,
      archetype         TEXT NOT NULL,
      car_contribution  NUMERIC NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by        TEXT NOT NULL,
      PRIMARY KEY (owner, trade_id, date_epoch, archetype),
      CONSTRAINT tdmac_created_by_format_chk CHECK (created_by ${ACTOR_CHK}),
      CONSTRAINT tdmac_parent_fkey
        FOREIGN KEY (owner, trade_id, date_epoch)
        REFERENCES trade_daily_mtm_series(owner, trade_id, date_epoch) ON DELETE CASCADE
    );
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('trade_daily_mtm_archetype_contributions');
  pgm.sql(`DROP TRIGGER IF EXISTS tdms_set_updated_at ON trade_daily_mtm_series;`);
  pgm.dropTable('trade_daily_mtm_series');
  pgm.sql(`DROP TRIGGER IF EXISTS since_tys_set_updated_at ON since_trade_yield_summaries;`);
  pgm.dropTable('since_trade_yield_summaries');
  pgm.sql(`DROP TRIGGER IF EXISTS asof_tys_set_updated_at ON as_of_trade_yield_summaries;`);
  pgm.dropTable('as_of_trade_yield_summaries');
  pgm.sql(`DROP TRIGGER IF EXISTS open_tys_set_updated_at ON open_trade_yield_summaries;`);
  pgm.dropTable('open_trade_yield_summaries');
  pgm.sql(`DROP TRIGGER IF EXISTS sub_trade_yield_units_set_updated_at ON sub_trade_yield_units;`);
  pgm.dropTable('sub_trade_yield_units');
  pgm.dropTable('trade_yield_segment_transaction_portions');
  pgm.sql(`DROP TRIGGER IF EXISTS trade_yield_segments_set_updated_at ON trade_yield_segments;`);
  pgm.dropTable('trade_yield_segments');
};
