/**
 * Domain types for the local-first Dashcam / Sentry Intelligence feature.
 *
 * Everything in this file describes data that lives ENTIRELY in the
 * browser (IndexedDB). Nothing here is sent to, or received from, the
 * TeslaSync backend — the only backend-derived input this feature reads
 * is vehicle telemetry history (via `useSignalEvidenceBundle`), which is
 * combined locally with clip metadata for reconstruction.
 */

/** Camera position recognized from Tesla's dashcam/Sentry filename convention. */
export type CameraPosition =
  | 'front'
  | 'back'
  | 'left_repeater'
  | 'right_repeater'
  | 'left_pillar'
  | 'right_pillar'
  | 'unknown';

/** Source folder a clip was exported from (when it can be determined). */
export type ClipSource = 'RecentClips' | 'SavedClips' | 'SentryClips' | 'unknown';

/**
 * Loosely-typed mirror of Tesla's `event.json` sidecar file, which ships
 * alongside SavedClips/SentryClips exports. Every field is optional and
 * independently nullable — the file format is undocumented and has
 * drifted across firmware versions, so this parser only trusts fields it
 * can positively identify (see `lib/clipParsing.ts`).
 */
export interface EventJsonSidecar {
  /** Raw `timestamp` field as reported by the sidecar (car-local, no zone). */
  timestamp: string | null;
  city: string | null;
  est_lat: number | null;
  est_lon: number | null;
  /** Free-text machine reason code, e.g. "sentry_aware_object_detection". */
  reason: string | null;
  /** Camera name as reported by the sidecar, if present. */
  camera: string | null;
}

/** A privacy-redaction mask drawn over playback. Coordinates are normalized 0..1. */
export interface RedactionRegion {
  id: string;
  kind: 'face' | 'plate' | 'general';
  label: string;
  /** Normalized top-left X (0 = left edge, 1 = right edge). */
  x: number;
  /** Normalized top-left Y (0 = top edge, 1 = bottom edge). */
  y: number;
  /** Normalized width (fraction of frame width). */
  width: number;
  /** Normalized height (fraction of frame height). */
  height: number;
  createdAt: string;
}

/**
 * Basis-honest event candidate. `type` is the feature's best guess at what
 * happened; `basis` is a list of human-readable evidence strings that MUST
 * accurately describe how the candidate was derived (metadata, telemetry
 * statistics, or a sampled-frame pixel-difference score). Never phrase a
 * `basis` entry as if computer vision object/person/plate detection ran —
 * it did not.
 */
export type EventCandidateType =
  | 'sentry_trigger'
  | 'manual_save'
  | 'impact'
  | 'hard_brake'
  | 'hard_accel'
  | 'sharp_turn'
  | 'motion'
  | 'unknown';

export type EventConfidence = 'low' | 'medium' | 'high';

export interface EventCandidate {
  id: string;
  type: EventCandidateType;
  confidence: EventConfidence;
  /** Offset in seconds from clip start, or null for whole-clip-level candidates. */
  atSeconds: number | null;
  basis: string[];
}

/** Result of the local sampled-frame motion analysis (see `lib/motionScore.ts`). */
export interface MotionScoreSummary {
  status: 'not_run' | 'ok' | 'unavailable';
  score?: number;
  samplePairs?: number;
  /** Explicit reason when `status === 'unavailable'` — never silently swallowed. */
  reason?: string;
  computedAt?: string;
}

/** A single imported clip and everything derived from it, all local. */
export interface ClipRecord {
  id: string;
  fileName: string;
  cameraPosition: CameraPosition;
  cameraRaw: string | null;
  source: ClipSource;
  /** Naive local wall-clock string parsed from the filename, e.g. "2024-01-15T12:30:00". No timezone. */
  capturedAtRaw: string | null;
  durationSeconds: number | null;
  sizeBytes: number;
  mimeType: string;
  blob: Blob;
  eventSidecar: EventJsonSidecar | null;
  motion: MotionScoreSummary;
  eventCandidates: EventCandidate[];
  redactions: RedactionRegion[];
  vehicleId: number | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** Local, per-browser feature settings. */
export interface DashcamSettings {
  /**
   * Assumed UTC offset (minutes east of UTC) of the camera's wall clock,
   * e.g. -420 for UTC-7. Filenames carry no timezone, so reconstruction
   * needs an explicit, user-correctable assumption. Defaults to the
   * browser's current local offset as a reasonable starting guess.
   */
  assumedTimezoneOffsetMinutes: number;
  /** Seconds of telemetry to include before the clip's parsed start time. */
  reconstructionPreRollSeconds: number;
  /** Seconds of telemetry to include after the clip ends. */
  reconstructionPostRollSeconds: number;
  defaultRedactionKind: 'face' | 'plate' | 'general';
  /** Derive event candidates from folder/event.json metadata automatically on import. */
  autoDetectMetadataEvents: boolean;
}

export function defaultDashcamSettings(): DashcamSettings {
  return {
    assumedTimezoneOffsetMinutes: -new Date().getTimezoneOffset(),
    reconstructionPreRollSeconds: 15,
    reconstructionPostRollSeconds: 15,
    defaultRedactionKind: 'face',
    autoDetectMetadataEvents: true,
  };
}
