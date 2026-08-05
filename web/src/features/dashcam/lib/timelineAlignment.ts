import { RECONSTRUCTION, SIGNAL_NAME_HINTS } from './constants';

/** Minimal shape of a telemetry sample this module needs (matches `SignalPoint` from `@/types/telemetry`). */
export interface SignalPointLike {
  timestamp: string;
  valueNum?: number;
  valueStr?: string;
  valueBool?: boolean;
}

export interface SignalSeriesInput {
  signal: string;
  points: SignalPointLike[];
}

export type CoverageQuality = 'none' | 'sparse' | 'partial' | 'good';

export interface AlignedSignalPoint {
  /** Seconds relative to clip start (negative = pre-roll, > duration = post-roll). */
  atSeconds: number;
  timestamp: string;
  value: number | string | boolean | null;
}

export interface AlignedSignalSeries {
  signal: string;
  points: AlignedSignalPoint[];
  coverage: CoverageQuality;
  gapNotes: string[];
}

export type IncidentEventKind = 'hard_brake' | 'hard_accel' | 'sharp_turn' | 'signal_spike' | 'state_change';

export interface IncidentSequenceEvent {
  id: string;
  atSeconds: number;
  kind: IncidentEventKind;
  signal: string;
  description: string;
  /** Statistical strength of the anomaly (delta / median-absolute-delta). Not a physical unit. */
  zScore: number;
}

export interface ReconstructionResult {
  /** Clip window relative to clip start (0..durationSeconds), independent of pre/post roll. */
  clipWindow: { startSeconds: number; endSeconds: number };
  /** Full reconstruction window including pre/post roll, relative to clip start. */
  reconstructionWindow: { startSeconds: number; endSeconds: number };
  series: AlignedSignalSeries[];
  incidentSequence: IncidentSequenceEvent[];
  overallQuality: CoverageQuality;
  qualityNotes: string[];
}

/** Marker shape compatible with `@/components/data-display`'s `TimelineMarker`. */
export interface ReconstructionMarker {
  at: number;
  kind: 'start' | 'stop' | 'event';
  label: string;
}

/**
 * Projects clip start/end + incident-sequence events onto a normalized
 * 0..1 scale spanning the full reconstruction window (pre-roll through
 * post-roll), for use with `<TimelineScrubber markers=.../>`.
 */
export function toReconstructionMarkers(result: ReconstructionResult): ReconstructionMarker[] {
  const { reconstructionWindow, clipWindow, incidentSequence } = result;
  const span = reconstructionWindow.endSeconds - reconstructionWindow.startSeconds;
  if (span <= 0) return [];
  const normalize = (seconds: number) => Math.min(1, Math.max(0, (seconds - reconstructionWindow.startSeconds) / span));
  const markers: ReconstructionMarker[] = [
    { at: normalize(clipWindow.startSeconds), kind: 'start', label: 'Clip start' },
    { at: normalize(clipWindow.endSeconds), kind: 'stop', label: 'Clip end' },
  ];
  for (const evt of incidentSequence) {
    markers.push({ at: normalize(evt.atSeconds), kind: 'event', label: evt.description });
  }
  return markers;
}

/**
 * Resolves a filename-parsed, timezone-naive clip timestamp to an absolute
 * UTC epoch using an explicit, user-adjustable offset assumption.
 *
 * `offsetMinutes` is the assumed UTC offset (minutes EAST of UTC) of the
 * camera's wall clock, e.g. -420 for UTC-7. Returns null when `capturedAtRaw`
 * is null or unparseable — callers must treat that as "cannot align".
 */
export function resolveClipEpochMs(capturedAtRaw: string | null, offsetMinutes: number): number | null {
  if (!capturedAtRaw) return null;
  const naiveUtcMs = Date.parse(`${capturedAtRaw}Z`);
  if (!Number.isFinite(naiveUtcMs)) return null;
  return naiveUtcMs - offsetMinutes * 60_000;
}

let idCounter = 0;
function nextEventId(): string {
  idCounter += 1;
  return `incident_${idCounter}`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function classifyCoverage(pointCount: number, largestGapSeconds: number, windowSeconds: number): CoverageQuality {
  if (pointCount === 0) return 'none';
  if (pointCount < RECONSTRUCTION.sparsePointThreshold) return 'sparse';
  if (windowSeconds > 0 && largestGapSeconds / windowSeconds > RECONSTRUCTION.gapWindowFraction) return 'partial';
  return 'good';
}

function hintForSignal(signalName: string): 'hard_brake' | 'hard_accel' | 'sharp_turn' | null {
  const lower = signalName.toLowerCase();
  for (const [keyword, kind] of Object.entries(SIGNAL_NAME_HINTS)) {
    if (lower.includes(keyword)) return kind;
  }
  return null;
}

/**
 * Aligns bounded signal history series to a clip's timeline and produces a
 * gap/quality-annotated reconstruction, including a statistically-derived
 * (not physically-calibrated) incident sequence.
 */
export function alignSignalHistoryToClip(params: {
  clipStartEpochMs: number;
  clipDurationSeconds: number;
  preRollSeconds: number;
  postRollSeconds: number;
  seriesInput: SignalSeriesInput[];
}): ReconstructionResult {
  const { clipStartEpochMs, clipDurationSeconds, preRollSeconds, postRollSeconds, seriesInput } = params;
  const windowStart = -preRollSeconds;
  const windowEnd = clipDurationSeconds + postRollSeconds;
  const windowSeconds = windowEnd - windowStart;

  const series: AlignedSignalSeries[] = [];
  const incidentSequence: IncidentSequenceEvent[] = [];

  for (const input of seriesInput) {
    const points: AlignedSignalPoint[] = [];
    for (const p of input.points) {
      const epochMs = Date.parse(p.timestamp);
      if (!Number.isFinite(epochMs)) continue;
      const atSeconds = (epochMs - clipStartEpochMs) / 1000;
      if (atSeconds < windowStart || atSeconds > windowEnd) continue;
      const value = p.valueNum ?? p.valueStr ?? (p.valueBool != null ? p.valueBool : null);
      points.push({ atSeconds, timestamp: p.timestamp, value });
    }
    points.sort((a, b) => a.atSeconds - b.atSeconds);

    let largestGap = 0;
    const gapNotes: string[] = [];
    for (let i = 1; i < points.length; i++) {
      const gap = points[i].atSeconds - points[i - 1].atSeconds;
      if (gap > largestGap) largestGap = gap;
    }
    const coverage = classifyCoverage(points.length, largestGap, windowSeconds);
    if (coverage === 'none') {
      gapNotes.push(`No telemetry samples found for "${input.signal}" in the reconstruction window.`);
    } else if (coverage === 'sparse') {
      gapNotes.push(`Only ${points.length} sample(s) for "${input.signal}" — too few to plot a reliable trend.`);
    } else if (coverage === 'partial') {
      gapNotes.push(
        `Largest data gap for "${input.signal}" is ${largestGap.toFixed(1)}s (${Math.round((largestGap / windowSeconds) * 100)}% of the window).`,
      );
    }

    series.push({ signal: input.signal, points, coverage, gapNotes });

    // Numeric spike detection (statistical, not physically calibrated).
    const numericPoints = points.filter((p) => typeof p.value === 'number') as (AlignedSignalPoint & { value: number })[];
    if (numericPoints.length >= 3) {
      const deltas = numericPoints.slice(1).map((p, i) => p.value - numericPoints[i].value);
      const absDeltas = deltas.map(Math.abs);
      const medAbs = median(absDeltas) || 1e-9;
      const hint = hintForSignal(input.signal);
      deltas.forEach((delta, i) => {
        const z = Math.abs(delta) / medAbs;
        if (z >= RECONSTRUCTION.spikeZScore) {
          const at = numericPoints[i + 1].atSeconds;
          const kind: IncidentEventKind = hint ?? 'signal_spike';
          const direction = delta < 0 ? 'decrease' : 'increase';
          incidentSequence.push({
            id: nextEventId(),
            atSeconds: at,
            kind,
            signal: input.signal,
            zScore: z,
            description: hint
              ? `"${input.signal}" suggests a ${hint.replace('_', ' ')}: largest ${direction} in window (z≈${z.toFixed(1)}) at t=${at.toFixed(1)}s`
              : `"${input.signal}" statistical spike: ${direction} of ${delta.toFixed(2)} (z≈${z.toFixed(1)}) at t=${at.toFixed(1)}s`,
          });
        }
      });
    }

    // Boolean/text state-change detection.
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1].value;
      const curr = points[i].value;
      if (typeof curr === 'number' || typeof prev === 'number') continue;
      if (prev !== curr && curr != null) {
        incidentSequence.push({
          id: nextEventId(),
          atSeconds: points[i].atSeconds,
          kind: 'state_change',
          signal: input.signal,
          zScore: 0,
          description: `"${input.signal}" changed to ${String(curr)} at t=${points[i].atSeconds.toFixed(1)}s`,
        });
      }
    }
  }

  incidentSequence.sort((a, b) => a.atSeconds - b.atSeconds);

  const coverages = series.map((s) => s.coverage);
  let overallQuality: CoverageQuality = 'none';
  if (coverages.length > 0) {
    if (coverages.every((c) => c === 'none')) overallQuality = 'none';
    else if (coverages.some((c) => c === 'partial' || c === 'sparse')) overallQuality = 'partial';
    else overallQuality = 'good';
  }

  const qualityNotes = series.flatMap((s) => s.gapNotes);
  if (series.length === 0) {
    qualityNotes.push('No telemetry signals were selected for this reconstruction.');
  }

  return {
    clipWindow: { startSeconds: 0, endSeconds: clipDurationSeconds },
    reconstructionWindow: { startSeconds: windowStart, endSeconds: windowEnd },
    series,
    incidentSequence,
    overallQuality,
    qualityNotes,
  };
}
