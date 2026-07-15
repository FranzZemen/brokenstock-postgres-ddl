/*
Created by Franz Zemen
License Type: UNLICENSED

SCRAP Momentum / MSA — drop `msa_calibration` and `msa_signal`.

The Momentum Structural Analysis feature (momentum-msa.prd.md) is being fully unwound.
Validation studies (divergence, pivot-lead, rejection-tails, volume-weighted momentum vs
MACD) showed no systematic edge or meaningful lead over price — everything reduced to
known indicators (200 SMA, MACD, Force Index, OBV, MFI) with no advantage. Hard scrap.

These two tables are feature-specific — nothing else references them (the box calibration
and the signal-transition log). Dropping them here; the momentum code, routes, gateway
route and ALB rule are removed in the same sweep. Reverses 2026-07-13T180000Z_momentum_msa.ts.

Bumps MIN_SCHEMA_VERSION = 2026-07-15T130000Z.
*/

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TRIGGER IF EXISTS msa_signal_set_updated_at ON msa_signal;`);
  pgm.sql(`DROP INDEX IF EXISTS msa_signal_current_idx;`);
  pgm.dropTable('msa_signal', {ifExists: true});
  pgm.sql(`DROP TRIGGER IF EXISTS msa_calibration_set_updated_at ON msa_calibration;`);
  pgm.dropTable('msa_calibration', {ifExists: true});
};

export const down = (): void => {
  // One-way scrap. The feature is gone; recreating empty tables would serve nothing.
  // If ever revived, re-apply 2026-07-13T180000Z_momentum_msa.ts.
};
