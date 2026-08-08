import { REASON_TYPE_HINTS, MOTION_SCORE_THRESHOLDS } from './constants';
import type {
  ClipSource,
  EventCandidate,
  EventCandidateType,
  EventConfidence,
  EventJsonSidecar,
  MotionScoreSummary,
} from './types';
import type { IncidentSequenceEvent } from './timelineAlignment';

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}

/** Maps a Tesla `event.json` `reason` code to an event type via keyword hints. Honest fallback: 'unknown'. */
export function classifyReason(reason: string | null | undefined): EventCandidateType {
  if (!reason) return 'unknown';
  for (const hint of REASON_TYPE_HINTS) {
    if (hint.match.test(reason)) return hint.type;
  }
  return 'unknown';
}

/**
 * Derives event candidates from clip metadata alone (folder + event.json).
 * Basis strings cite the exact metadata fields used — no inference beyond
 * what the filesystem/sidecar actually reports.
 */
export function deriveMetadataCandidates(params: {
  source: ClipSource;
  eventSidecar: EventJsonSidecar | null;
}): EventCandidate[] {
  const { source, eventSidecar } = params;
  const candidates: EventCandidate[] = [];

  if (eventSidecar?.reason) {
    const type = classifyReason(eventSidecar.reason);
    const basis = [`event.json reason: "${eventSidecar.reason}"`];
    if (source !== 'unknown') basis.push(`folder: ${source}`);
    candidates.push({
      id: nextId('meta'),
      type,
      confidence: type === 'unknown' ? 'low' : 'medium',
      atSeconds: null,
      basis,
    });
    return candidates;
  }

  if (source === 'SentryClips') {
    candidates.push({
      id: nextId('meta'),
      type: 'sentry_trigger',
      confidence: 'low',
      atSeconds: null,
      basis: ['folder: SentryClips (no event.json reason found — trigger cause unknown)'],
    });
  } else if (source === 'SavedClips') {
    candidates.push({
      id: nextId('meta'),
      type: 'manual_save',
      confidence: 'low',
      atSeconds: null,
      basis: ['folder: SavedClips (user-saved clip; no event metadata found)'],
    });
  }

  return candidates;
}

/**
 * Derives a single event candidate from a sampled-frame motion score.
 * The basis text deliberately says "pixel-difference" — this is a brightness
 * delta heuristic, NOT object/person/vehicle detection, and must never be
 * described as such.
 */
export function deriveMotionCandidate(motion: MotionScoreSummary): EventCandidate[] {
  if (motion.status !== 'ok' || motion.score == null) return [];
  const confidence: EventConfidence =
    motion.score >= MOTION_SCORE_THRESHOLDS.medium ? 'high' : motion.score >= MOTION_SCORE_THRESHOLDS.low ? 'medium' : 'low';
  if (motion.score < MOTION_SCORE_THRESHOLDS.low) return [];
  return [
    {
      id: nextId('motion'),
      type: 'motion',
      confidence,
      atSeconds: null,
      basis: [
        `sampled-frame pixel-difference score: ${motion.score.toFixed(3)} across ${motion.samplePairs ?? 0} frame-pair(s)`,
        'basis: luminance delta heuristic only — no object/person/plate recognition was performed',
      ],
    },
  ];
}

/** Converts telemetry-derived incident-sequence events into user-facing candidates. */
export function deriveTelemetryCandidates(events: IncidentSequenceEvent[]): EventCandidate[] {
  return events
    .filter((e) => e.kind === 'hard_brake' || e.kind === 'hard_accel' || e.kind === 'sharp_turn')
    .map((e) => ({
      id: nextId('telemetry'),
      type: e.kind as EventCandidateType,
      confidence: (Math.abs(e.zScore) >= 5 ? 'high' : Math.abs(e.zScore) >= 4 ? 'medium' : 'low') as EventConfidence,
      atSeconds: e.atSeconds,
      basis: [e.description],
    }));
}

/** Merges candidates from every source, sorted with whole-clip candidates first, then chronologically. */
export function mergeEventCandidates(...groups: EventCandidate[][]): EventCandidate[] {
  const all = groups.flat();
  return [...all].sort((a, b) => {
    if (a.atSeconds == null && b.atSeconds == null) return 0;
    if (a.atSeconds == null) return -1;
    if (b.atSeconds == null) return 1;
    return a.atSeconds - b.atSeconds;
  });
}
