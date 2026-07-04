/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * transfer-matcher duplicate-event guard (2026-07-03).
 *
 * A MATCHED transfer event is uniquely identified by its
 * (owner, from_tx_uuid, to_tx_uuid) triple: each side is 1:1 with a single
 * originating transaction, so a given (from, to) pair is exactly one physical
 * transfer. The matcher, however, minted a fresh random `transfer_event_id`
 * per resolve and inserted UNCONDITIONALLY — the PK never collided, so two
 * concurrent (or a re-run) matcher passes over the same still-pending pair each
 * created an event and each spawned a full set of synthetic cost-basis lots,
 * DOUBLE-COUNTING the transferred position. This surfaced as phantom-open
 * trades after the 2026-07-02 re-import (15 duplicate matched events across 8
 * accounts; e.g. Value/Z05610854 showed CVX/GILD/HII/WTRG/STLD/LMT open when
 * all were fully closed).
 *
 * This partial unique index makes the duplicate structurally impossible and is
 * the arbiter for the matcher's new `ON CONFLICT DO NOTHING` claim insert
 * (see @franzzemen/intra-account-transfers TrustedTransferEventApi.putMatchedClaim
 * and brokenstock-orchestrator transfer-matcher-orchestrator #resolveCandidate).
 *
 * Partial predicate: only 'matched' events carry BOTH tx uuids. One-sided
 * 'no-counterpart-user-confirmed' events (from OR to null) are excluded and can
 * still coexist.
 *
 * PRECONDITION: this index cannot be created while duplicate matched pairs
 * exist. The existing 15 duplicates must be cleared first — either by deleting
 * every import (the delete cascade dissolves all transfer events + synthetics)
 * or by a targeted dedup — before this migration runs.
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE UNIQUE INDEX transfer_events_matched_pair_uq
      ON transfer_events (owner, from_tx_uuid, to_tx_uuid)
      WHERE resolution = 'matched' AND from_tx_uuid IS NOT NULL AND to_tx_uuid IS NOT NULL;
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP INDEX IF EXISTS transfer_events_matched_pair_uq;`);
};
