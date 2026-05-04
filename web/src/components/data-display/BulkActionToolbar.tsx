/**
 * BulkActionToolbar — Phase-45 / Prompt 32
 *
 * Singular-name alias of the existing `BulkActionsToolbar` (Phase-40 /
 * Prompt 51). Phase-45 / 32 standardised on `BulkActionToolbar` (no
 * trailing s) so the new bulk hooks `useBulkSelection` / `BulkAction`
 * read consistently in feature pages. Re-exporting keeps the existing
 * adopters compiling while the new pages can use the singular name.
 *
 * Why a thin alias and not a fresh implementation:
 *   - The Phase-40 component already covers everything the prompt's
 *     design specifies: count + total label, Action buttons (with
 *     loading), Clear button, optional ConfirmDialog routing, role=region
 *     a11y. Re-implementing would duplicate the confirm-dialog wiring
 *     introduced by Phase-45 / 04 and silenced by Phase-45 / 29.
 *   - Both names continue to work, so partial migrations don't break.
 */

export { BulkActionsToolbar as BulkActionToolbar } from './BulkActionsToolbar';
export type {
  BulkAction,
  BulkActionsToolbarProps as BulkActionToolbarProps,
} from './BulkActionsToolbar';
