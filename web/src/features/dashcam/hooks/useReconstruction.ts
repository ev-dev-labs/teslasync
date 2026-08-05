import { useMemo } from 'react';
import { useSignalEvidenceBundle } from '@/api/hooks/useTelemetry';
import { resolveClipEpochMs, alignSignalHistoryToClip, type ReconstructionResult } from '../lib/timelineAlignment';
import type { ClipRecord, DashcamSettings } from '../lib/types';

export interface UseReconstructionResult {
  /** Null when the clip's filename carried no parseable timestamp — reconstruction cannot align without it. */
  clipEpochMs: number | null;
  /** Hours of telemetry lookback actually requested (bounded by the evidence-bundle hook, from-now only). */
  lookbackHours: number;
  reconstruction: ReconstructionResult | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  /** True when the clip predates what a "last N hours from now" query can reach without server-side history retention. */
  possiblyOutOfLookbackRange: boolean;
}

/**
 * Combines a clip's parsed timestamp with live telemetry history for the
 * selected signals, producing a gap/quality-annotated reconstruction.
 *
 * IMPORTANT LIMITATION (surfaced via `possiblyOutOfLookbackRange`): the
 * underlying `/signals/.../history` endpoint only supports "last N hours
 * from now", not an arbitrary historical window anchored to the clip's own
 * date. For old clips this hook requests enough hours to reach back to the
 * clip's start, but very old clips may exceed what the server has actually
 * retained — that is a server-side retention question this hook cannot
 * answer, so it surfaces the caveat instead of guessing.
 */
export function useReconstruction(
  vehicleId: number,
  clip: ClipRecord | null,
  settings: DashcamSettings,
  selectedSignals: string[],
): UseReconstructionResult {
  const clipEpochMs = clip ? resolveClipEpochMs(clip.capturedAtRaw, settings.assumedTimezoneOffsetMinutes) : null;

  const lookbackHours = useMemo(() => {
    if (clipEpochMs == null) return 24;
    const ageMs = Date.now() - clipEpochMs;
    const ageHours = ageMs / 3_600_000;
    const withPostRoll = ageHours + settings.reconstructionPostRollSeconds / 3600 + 1;
    return Math.max(1, Math.min(24 * 365, Math.ceil(withPostRoll)));
  }, [clipEpochMs, settings.reconstructionPostRollSeconds]);

  const bundle = useSignalEvidenceBundle(vehicleId, selectedSignals, lookbackHours);

  const reconstruction = useMemo<ReconstructionResult | null>(() => {
    if (clip == null || clipEpochMs == null) return null;
    return alignSignalHistoryToClip({
      clipStartEpochMs: clipEpochMs,
      clipDurationSeconds: clip.durationSeconds ?? 0,
      preRollSeconds: settings.reconstructionPreRollSeconds,
      postRollSeconds: settings.reconstructionPostRollSeconds,
      seriesInput: bundle.data.map((s) => ({ signal: s.signal, points: s.response.data })),
    });
  }, [clip, clipEpochMs, settings.reconstructionPreRollSeconds, settings.reconstructionPostRollSeconds, bundle.data]);

  const possiblyOutOfLookbackRange = clipEpochMs != null && Date.now() - clipEpochMs > 24 * 365 * 3_600_000 - 3_600_000;

  return {
    clipEpochMs,
    lookbackHours,
    reconstruction,
    isLoading: bundle.isLoading,
    isError: bundle.isError,
    error: bundle.error,
    possiblyOutOfLookbackRange,
  };
}
