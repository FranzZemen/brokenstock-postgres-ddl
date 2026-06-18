/*
 * Created by Franz Zemen
 * License: UNLICENSED
 *
 * Pending-transfer "dismiss" escape hatch.
 *
 * Some transfer legs can never be auto-resolved — the sending account's
 * acquisition history isn't (and won't be) imported (e.g. a closing 401k whose
 * full cost-basis lives with the plan record-keeper), or a leg was orphaned by
 * a trade deletion ('awaiting-counterpart'). `markUntracked` can't help: its
 * OUT path hard-errors on insufficient FIFO source, and it isn't offered for
 * 'awaiting-counterpart' at all. The user just wants the reconciliation noise
 * gone.
 *
 * `dismissed` is a user-set, durable "leave this leg alone" flag. The matcher
 * candidate read (queryByOwnerBroker) and the owner-wide Pending tab read
 * (queryByOwner) both filter `dismissed = false`, so a dismissed leg disappears
 * from the tray AND stops being considered as a pairing candidate for other
 * legs. `putForTransactions` never writes `dismissed` on its ON CONFLICT update,
 * so the flag survives a re-import of the same file (the column default carries
 * new rows; existing dismissed rows are left untouched).
 *
 * Dismissing changes NOTHING in positions/P&L — raw `transferred shares in/out`
 * rows are already dropped from the FIFO/trades pipeline, so an unmatched
 * transfer never affected the numbers; this only clears the flag.
 *
 * Additive only (nullable-with-default column add; no data rewrite).
 */

import type {MigrationBuilder} from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.addColumn('transfer_pending', {
    dismissed: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropColumn('transfer_pending', 'dismissed', {ifExists: true});
};
