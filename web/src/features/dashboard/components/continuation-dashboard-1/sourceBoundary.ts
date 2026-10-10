import type { DataState } from '@/api/dataState';
import type { SourceState } from '@/components/layout';

export function sourceBoundaryState(state: DataState<unknown>, hasContent: boolean): SourceState {
  if (state.fatalError) return 'error';
  if (state.status === 'initial') return 'loading';
  if (hasContent && (state.refreshError || state.isRefreshBlocked || state.status === 'stale')) return 'retained';
  return hasContent ? 'ready' : 'empty';
}
