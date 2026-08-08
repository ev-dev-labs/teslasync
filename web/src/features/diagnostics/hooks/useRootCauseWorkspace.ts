import { useMemo, useState } from 'react';
import {
  useSignalEvidenceBundle,
  useSignals,
  type SignalEvidenceBundleResult,
} from '@/api/hooks/useTelemetry';
import {
  analyzeRootCause,
  isAnalysisDefensible,
  selectRelatedSignals,
  type RelatedSignalCandidate,
  type RootCauseAnalysisResult,
} from '../lib/rootCauseIntelligence';

/**
 * Shared Root-Cause workspace hook.
 *
 * Both `RootCauseIntelligencePage` and `ServiceEvidencePackPage` need the
 * exact same underlying state (focal signal, analysis window, the bounded
 * related-signal selection, the fetched evidence bundle, and the derived
 * `analyzeRootCause` result) so this hook is the single place that composes
 * them. The two pages differ only in which panels they render from the
 * result — the workspace itself has no page-specific concerns.
 *
 * Data flow:
 *   1. `useSignals(vehicleId)` — the vehicle's full signal-name catalog.
 *   2. `selectRelatedSignals(focalSignal, catalog)` — a pure, deterministic,
 *      bounded (≤ `MAX_RELATED_SIGNALS`) related-signal selection. This is
 *      synchronous and does not depend on the network.
 *   3. `useSignalEvidenceBundle(vehicleId, [focal, ...related], windowHours)`
 *      — fetches history for the focal signal plus its related candidates
 *      in one hook (at most 8 signals — exactly `1 + MAX_RELATED_SIGNALS`).
 *   4. `analyzeRootCause(...)` — pure statistics over whatever history has
 *      resolved so far, memoized so it only recomputes when the bundle's
 *      data, the focal signal, or the catalog actually change.
 *
 * `vehicleId` is accepted as a parameter (rather than the hook calling
 * `useSelectedVehicle()` itself) so pages can call every hook
 * unconditionally, BEFORE their own `if (vehicleId == null) return <...>`
 * early return — the Rules of Hooks require the hook call itself to never
 * be skipped, even though the underlying queries are disabled for a
 * `null`/`0` id.
 */

export const ROOT_CAUSE_WINDOW_HOUR_PRESETS = [24, 72, 168, 720] as const;
export type RootCauseWindowHours = (typeof ROOT_CAUSE_WINDOW_HOUR_PRESETS)[number];

const DEFAULT_WINDOW_HOURS: RootCauseWindowHours = 72;

export interface RootCauseWorkspace {
  /** Full signal-name catalog for the vehicle (empty while loading/absent). */
  catalog: string[];
  /** The `useSignals` query — exposed so pages can render the picker panel's own loading/error/empty state. */
  signalsQuery: ReturnType<typeof useSignals>;
  /** The user-selected signal under investigation. Empty string = none chosen yet. */
  focalSignal: string;
  setFocalSignal: (signal: string) => void;
  /** Analysis window, in hours. One of `ROOT_CAUSE_WINDOW_HOUR_PRESETS`. */
  windowHours: number;
  setWindowHours: (hours: number) => void;
  /** Deterministic, bounded (≤ `MAX_RELATED_SIGNALS`) related-signal selection for `focalSignal`. */
  relatedCandidates: RelatedSignalCandidate[];
  /** Raw fetched history for the focal signal + related candidates. */
  evidenceBundle: SignalEvidenceBundleResult;
  /** The full, memoized root-cause analysis result — never throws, always structurally complete. */
  analysis: RootCauseAnalysisResult;
  /** Mirrors `isAnalysisDefensible(analysis)` — gates the Service Evidence Pack export action. */
  isDefensible: boolean;
  /** True once the user has picked a focal signal (independent of whether data has loaded yet). */
  hasChosenSignal: boolean;
}

export function useRootCauseWorkspace(vehicleId: number | null): RootCauseWorkspace {
  const id = vehicleId ?? 0;
  const [focalSignal, setFocalSignal] = useState('');
  const [windowHours, setWindowHours] = useState<number>(DEFAULT_WINDOW_HOURS);

  const signalsQuery = useSignals(id);
  const catalog = useMemo(() => signalsQuery.data ?? [], [signalsQuery.data]);

  const relatedCandidates = useMemo(
    () => selectRelatedSignals(focalSignal, catalog),
    [focalSignal, catalog],
  );

  const bundleSignalNames = useMemo(() => {
    if (focalSignal === '') return [];
    return [focalSignal, ...relatedCandidates.map((c) => c.signal)];
  }, [focalSignal, relatedCandidates]);

  const evidenceBundle = useSignalEvidenceBundle(id, bundleSignalNames, windowHours);

  const analysis = useMemo(() => {
    const bundleData = evidenceBundle.data;
    const focalEntry = bundleData.find((d) => d.signal === focalSignal);
    const relatedSeries = bundleData
      .filter((d) => d.signal !== focalSignal)
      .map((d) => ({ signal: d.signal, points: d.response.data ?? [] }));
    return analyzeRootCause({
      focalSignal,
      catalog,
      focalPoints: focalEntry?.response.data ?? [],
      relatedSeries,
    });
  }, [evidenceBundle.data, focalSignal, catalog]);

  const isDefensible = useMemo(() => isAnalysisDefensible(analysis), [analysis]);

  return {
    catalog,
    signalsQuery,
    focalSignal,
    setFocalSignal,
    windowHours,
    setWindowHours,
    relatedCandidates,
    evidenceBundle,
    analysis,
    isDefensible,
    hasChosenSignal: focalSignal !== '',
  };
}
