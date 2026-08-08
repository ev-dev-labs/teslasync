import type { CameraPosition } from './types';

/** Filenames Tesla dashcam/Sentry exports use for each camera position. */
export const CAMERA_POSITIONS: readonly CameraPosition[] = [
  'front',
  'back',
  'left_repeater',
  'right_repeater',
  'left_pillar',
  'right_pillar',
];

/**
 * Tesla dashcam/Sentry filename convention:
 * `YYYY-MM-DD_HH-MM-SS-<camera>.<ext>`
 * e.g. "2024-01-15_12-30-00-front.mp4".
 */
export const CLIP_FILENAME_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-([a-z_]+)\.(mp4|mov|m4v)$/i;

/** Folder-name markers used to classify a clip's export source when a relative path is available. */
export const SOURCE_FOLDER_MARKERS: Record<string, 'RecentClips' | 'SavedClips' | 'SentryClips'> = {
  recentclips: 'RecentClips',
  savedclips: 'SavedClips',
  sentryclips: 'SentryClips',
};

/** Motion score buckets — thresholds are on the 0..1 normalized `frameDiffScore` scale. */
export const MOTION_SCORE_THRESHOLDS = {
  low: 0.08,
  medium: 0.18,
} as const;

/** Number of frame-pairs sampled across a clip's duration for the motion heuristic. */
export const MOTION_SAMPLE_PAIRS = 6;

/** Reconstruction alignment tuning. */
export const RECONSTRUCTION = {
  /** A gap longer than this fraction of the reconstruction window is called out explicitly. */
  gapWindowFraction: 0.4,
  /** Minimum sample count before a series is considered anything but "sparse". */
  sparsePointThreshold: 3,
  /** z-score multiple over the median absolute delta that flags a "signal spike". */
  spikeZScore: 3,
} as const;

/** Keyword → richer incident-sequence label mapping (case-insensitive substring match on signal name). */
export const SIGNAL_NAME_HINTS: Record<string, 'hard_brake' | 'hard_accel' | 'sharp_turn'> = {
  brake: 'hard_brake',
  decel: 'hard_brake',
  accel: 'hard_accel',
  throttle: 'hard_accel',
  steer: 'sharp_turn',
  yaw: 'sharp_turn',
};

/** Reason-code keyword → event type mapping for Tesla `event.json` `reason` field. */
export const REASON_TYPE_HINTS: Array<{ match: RegExp; type: 'impact' | 'sentry_trigger' | 'manual_save' }> = [
  { match: /impact|collision|crash/i, type: 'impact' },
  { match: /object_detection|aware|sentry|honk|alarm/i, type: 'sentry_trigger' },
  { match: /user_interaction|panel_click|dashcam_icon|manual/i, type: 'manual_save' },
];
