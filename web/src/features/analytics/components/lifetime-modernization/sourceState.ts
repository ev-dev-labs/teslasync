import type { SectionState } from './SectionCard';

/** The lifetime query owns only its source, never the independently gated AI. */
export function lifetimeSectionState({
  hasData, isLoading, isError, empty,
}: {
  hasData: boolean;
  isLoading: boolean;
  isError: boolean;
  empty: boolean;
}): SectionState {
  if (hasData) return empty ? 'empty' : isError ? 'retained' : 'ready';
  return isLoading ? 'loading' : isError ? 'error' : 'empty';
}
