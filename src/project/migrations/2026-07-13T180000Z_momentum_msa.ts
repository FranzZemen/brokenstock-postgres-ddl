/*
Created by Franz Zemen
License Type: UNLICENSED

Momentum Structural Analysis (PRD: projects/doc/prd/momentum-msa.prd.md, E1).

TWO tables: msa_calibration (the frozen P&F box) and msa_signal (the transition log).

--- msa_calibration ---------------------------------------------------------

The P&F box size is THE parameter that decides whether the signal survives (D7).
It must be per-symbol — a 2% box is right for the S&P and destroys junior silver
miners, whose momentum swings ±80% — and it must then be FROZEN, because a Point &
Figure chart is append-only: new data extends the last column, it never redraws
the ones before it.

Freezing is why this table exists. If the box were re-derived from "all history so
far" on each read, it would drift as new bars arrived, and the whole chart's past
would silently change underneath it. That is not hypothetical — the E9 gate caught
it: XLF's box moved 1% → 2% when the 2008 crash inflated dispersion, and the
five-touch shelf whose July-2007 break IS Oliver's famous call ceased to have ever
existed. So the box is calibrated ONCE from the symbol's history, written here, and
read thereafter. A recalibration is a deliberate act (manual_override), not a side
effect of time passing.

--- msa_signal --------------------------------------------------------------

An append-only log of SIGNAL STATE TRANSITIONS.

Note what is deliberately NOT here: the momentum series itself. Unlike RRG (which
caches rrg_rs_series because it is O(symbols × benchmarks × weeks) and animates
client-side), MSA is a dozen symbols, static, monthly — a few hundred points per
symbol of pure arithmetic over bars that prices_equity already caches. Persisting
the derived series would buy ~150ms and would CREATE a staleness surface: a
retroactive split-rebase silently rewrites prices_equity history (cf. the
adjusted_through_date watermark), and any stored derivative of those bars goes
quietly wrong. Computing on read makes that class of bug impossible. See D12.

What genuinely cannot be recomputed from bars is WHEN YOU WERE TOLD. A recomputed
chart always shows today's truth; it cannot tell you that on 2007-07-31 the
quarterly momentum structure under the financial sector broke and a Sell was
raised. That is what this table holds — and it is why the grain is a transition,
not a snapshot.

Grain: (security_key, study, params_hash, observed_from). A row is opened when the
state changes and closed (observed_to) when it changes again; the open row is the
current state. params_hash folds {barGranularity, meanGranularity, meanLength,
boxSizePct, reversal} so a recalibration (E15) partitions cleanly rather than
silently reinterpreting past signals under new parameters.

security_key FKs CASCADE to securities(key), matching prices_equity: a security we
can price has a securities row, and deleting it should drop its derived signals.

Bumps MIN_SCHEMA_VERSION = 2026-07-13T180000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

const USER_FMT = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.user$';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE msa_calibration (
      security_key    TEXT NOT NULL REFERENCES securities(key) ON DELETE CASCADE,
      study           TEXT NOT NULL,
      box_size_pct    DOUBLE PRECISION NOT NULL,
      reversal        INTEGER NOT NULL DEFAULT 3,
      /* Set when Franz overrides the calibration by eye (E15). A manual box is
         never silently recalculated — that is the whole point of the table. */
      manual_override BOOLEAN NOT NULL DEFAULT false,
      /* Audit: what the auto-calibration saw when it froze this box. */
      calibrated_from_months INTEGER,
      calibrated_through     DATE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by      TEXT NOT NULL,
      updated_by      TEXT NOT NULL,
      PRIMARY KEY (security_key, study),
      CONSTRAINT msa_calibration_study_chk CHECK (study IN ('annual', 'quarterly')),
      CONSTRAINT msa_calibration_box_chk CHECK (box_size_pct > 0),
      CONSTRAINT msa_calibration_reversal_chk CHECK (reversal >= 2),
      CONSTRAINT msa_calibration_created_by_format_chk CHECK (created_by ~ '${USER_FMT}'),
      CONSTRAINT msa_calibration_updated_by_format_chk CHECK (updated_by ~ '${USER_FMT}')
    );
  `);
  pgm.sql(`
    CREATE TRIGGER msa_calibration_set_updated_at BEFORE UPDATE ON msa_calibration
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  pgm.sql(`
    CREATE TABLE msa_signal (
      security_key   TEXT NOT NULL REFERENCES securities(key) ON DELETE CASCADE,
      study          TEXT NOT NULL,
      params_hash    TEXT NOT NULL,
      observed_from  DATE NOT NULL,
      observed_to    DATE,
      state          TEXT NOT NULL,
      conviction     TEXT,
      keyed_to       JSONB,
      level_pct      DOUBLE PRECISION,
      trigger_price  DOUBLE PRECISION,
      coincident     BOOLEAN NOT NULL DEFAULT false,
      notified_at    TIMESTAMPTZ,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by     TEXT NOT NULL,
      updated_by     TEXT NOT NULL,
      PRIMARY KEY (security_key, study, params_hash, observed_from),
      CONSTRAINT msa_signal_study_chk CHECK (study IN ('annual', 'quarterly')),
      CONSTRAINT msa_signal_state_chk CHECK (state IN (
        'NO_STRUCTURE',
        'BULL_INTACT', 'BULL_TRIGGER_PENDING', 'BULL_BROKEN',
        'BEAR_INTACT', 'BEAR_TRIGGER_PENDING', 'BEAR_BROKEN'
      )),
      CONSTRAINT msa_signal_conviction_chk CHECK (conviction IS NULL OR conviction IN ('High', 'Medium', 'Watch', 'None')),
      CONSTRAINT msa_signal_window_chk CHECK (observed_to IS NULL OR observed_to >= observed_from),
      CONSTRAINT msa_signal_created_by_format_chk CHECK (created_by ~ '${USER_FMT}'),
      CONSTRAINT msa_signal_updated_by_format_chk CHECK (updated_by ~ '${USER_FMT}')
    );
  `);

  // "The current state of every symbol" is THE read this table exists to serve
  // (the Signals tab, and the cron deciding whether a transition needs an SNS
  // notification). A partial index on the open row makes it a direct hit rather
  // than a scan-and-filter over the whole transition history.
  pgm.sql(`
    CREATE UNIQUE INDEX msa_signal_current_idx
      ON msa_signal (security_key, study, params_hash)
      WHERE observed_to IS NULL;
  `);

  pgm.sql(`
    CREATE TRIGGER msa_signal_set_updated_at BEFORE UPDATE ON msa_signal
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS msa_signal_set_updated_at ON msa_signal;`);
  pgm.sql(`DROP INDEX IF EXISTS msa_signal_current_idx;`);
  pgm.dropTable('msa_signal', {ifExists: true});
  pgm.sql(`DROP TRIGGER IF EXISTS msa_calibration_set_updated_at ON msa_calibration;`);
  pgm.dropTable('msa_calibration', {ifExists: true});
};
