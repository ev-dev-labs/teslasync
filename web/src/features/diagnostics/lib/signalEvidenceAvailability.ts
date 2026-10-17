import type { SignalEvidenceBundleSource } from '@/api/hooks/useTelemetry';

/** Legacy presenters have no source contract; bundle callers use only the original response. */
export function hasSignalHistory(
  sources: readonly SignalEvidenceBundleSource[] | undefined,
  signal: string,
): boolean {
  if (!sources || sources.length === 0) return true;
  const state = sources.find((source) => source.signal === signal)?.state;
  return state?.hasData === true && (state.data?.data?.length ?? 0) > 0;
}
