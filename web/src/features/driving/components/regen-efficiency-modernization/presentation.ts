import type { DataState, DataStateSource } from '@/api/dataState';
import type { RegenSectionState } from '../regen-efficiency';

/** Presentation-only guard. Never coerce an unknown measurement into zero. */
export function isKnownNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Preserve the existing section contract while admitting retained query data.
 * Disabled/unresolved queries without data are NOT promoted to success.
 * Raw refresh errors are shown by StaleRefreshWarning beside retained content.
 */
export function toRegenSectionState<T>(
  state: DataState<T>,
  query: DataStateSource<T>,
): RegenSectionState {
  return {
    isLoading: !state.hasData && Boolean(query.isLoading),
    isResolved: state.hasData || query.isSuccess === true,
    error: state.fatalError,
    onRetry: () => { void query.refetch?.(); },
  };
}
