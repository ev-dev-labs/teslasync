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

export interface EventBasisMessage {
  key: string;
  defaultValue: string;
  values?: Record<string, string | number>;
  /** Original evidence remains authoritative for persistence and export. */
  raw: string;
}

interface DescribedEventCandidate extends EventCandidate {
  basisMessages?: EventBasisMessage[];
}

/** Only explicit generated descriptors are localized; legacy/user basis text stays raw. */
export function eventBasisMessages(candidate: EventCandidate): (EventBasisMessage | string)[] {
  const { basisMessages } = candidate as DescribedEventCandidate;
  return candidate.basis.map((raw, index) => {
    const message = basisMessages?.[index];
    return message?.raw === raw ? message : raw;
  });
}

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
 * Raw basis strings cite the exact metadata fields used; descriptors localize
 * only the application explanation, never the metadata values.
 */
export function deriveMetadataCandidates(params: {
  source: ClipSource;
  eventSidecar: EventJsonSidecar | null;
}): DescribedEventCandidate[] {
  const { source, eventSidecar } = params;
  const candidates: DescribedEventCandidate[] = [];

  if (eventSidecar?.reason) {
    const type = classifyReason(eventSidecar.reason);
    const basis = [`event.json reason: "${eventSidecar.reason}"`];
    const basisMessages: EventBasisMessage[] = [{
      key: 'dashcam.events.basis.reason',
      defaultValue: 'event.json reason: "{{reason}}"',
      values: { reason: eventSidecar.reason },
      raw: basis[0],
    }];
    if (source !== 'unknown') {
      basis.push(`folder: ${source}`);
      basisMessages.push({
        key: 'dashcam.events.basis.folder',
        defaultValue: 'folder: {{folder}}',
        values: { folder: source },
        raw: basis[1],
      });
    }
    candidates.push({
      id: nextId('meta'),
      type,
      confidence: type === 'unknown' ? 'low' : 'medium',
      atSeconds: null,
      basis,
      basisMessages,
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
      basisMessages: [{
        key: 'dashcam.events.basis.sentryFolder',
        defaultValue: 'folder: {{folder}} (no event.json reason found — trigger cause unknown)',
        values: { folder: source },
        raw: 'folder: SentryClips (no event.json reason found — trigger cause unknown)',
      }],
    });
  } else if (source === 'SavedClips') {
    candidates.push({
      id: nextId('meta'),
      type: 'manual_save',
      confidence: 'low',
      atSeconds: null,
      basis: ['folder: SavedClips (user-saved clip; no event metadata found)'],
      basisMessages: [{
        key: 'dashcam.events.basis.savedFolder',
        defaultValue: 'folder: {{folder}} (user-saved clip; no event metadata found)',
        values: { folder: source },
        raw: 'folder: SavedClips (user-saved clip; no event metadata found)',
      }],
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
export function deriveMotionCandidate(motion: MotionScoreSummary): DescribedEventCandidate[] {
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
      basisMessages: [{
        key: 'dashcam.events.basis.motionScore',
        defaultValue: 'sampled-frame pixel-difference score: {{score}} across {{pairs}} frame-pair(s)',
        values: { score: motion.score.toFixed(3), pairs: motion.samplePairs ?? 0 },
        raw: `sampled-frame pixel-difference score: ${motion.score.toFixed(3)} across ${motion.samplePairs ?? 0} frame-pair(s)`,
      }, {
        key: 'dashcam.events.basis.motionDisclaimer',
        defaultValue: 'basis: luminance delta heuristic only — no object/person/plate recognition was performed',
        raw: 'basis: luminance delta heuristic only — no object/person/plate recognition was performed',
      }],
    },
  ];
}

/**
 * Converts telemetry incidents to candidate-shaped values without updating a clip.
 * Reconstruction displays its incident sequence separately; this helper does not
 * connect telemetry to persisted clip event evidence.
 */
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
