/**
 * BulkActionToolbar.
 *
 * Singular-name alias of the existing `BulkActionsToolbar`. `BulkActionToolbar`
 * (no trailing s) reads consistently with the bulk hooks `useBulkSelection` /
 * `BulkAction`. Re-exporting keeps the existing adopters compiling while new
 * pages can use the singular name.
 *
 * Why a thin alias and not a fresh implementation:
 *   - The existing component already covers count + total label, Action buttons
 *     with loading, Clear button, optional ConfirmDialog routing, and role=region
 *     a11y. Re-implementing would duplicate the confirm-dialog wiring.
 *   - Both names continue to work, so partial migrations don't break.
 */

export { BulkActionsToolbar as BulkActionToolbar } from './BulkActionsToolbar';
export type {
  BulkAction,
  BulkActionsToolbarProps as BulkActionToolbarProps,
} from './BulkActionsToolbar';
