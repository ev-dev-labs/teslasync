import type { DataState } from '@/api/dataState';
import type { SourceState } from '@/components/layout';

/** Presentation only: trust and retries remain owned by the canonical DataState. */
export function sourcePresentation(state: DataState<unknown>, hasContent: boolean): SourceState {
  if (state.fatalError) return 'error';
  if (state.status === 'initial') return 'loading';
  if (state.refreshError || state.status === 'stale') return 'retained';
  if (!hasContent) return 'empty';
  return 'ready';
}
