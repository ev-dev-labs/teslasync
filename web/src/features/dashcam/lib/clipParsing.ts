import { CAMERA_POSITIONS, CLIP_FILENAME_REGEX, SOURCE_FOLDER_MARKERS } from './constants';
import type { CameraPosition, ClipSource, EventJsonSidecar } from './types';

export interface ParsedClipFilename {
  /** Naive local wall-clock ISO string with no timezone, e.g. "2024-01-15T12:30:00". Null if unparseable. */
  capturedAtRaw: string | null;
  camera: CameraPosition;
  cameraRaw: string | null;
  /** True when the filename matched Tesla's `YYYY-MM-DD_HH-MM-SS-camera.ext` convention exactly. */
  matched: boolean;
}

/**
 * Deterministically parses a Tesla dashcam/Sentry clip filename.
 *
 * Never throws — an unrecognized filename yields `matched: false` with
 * `capturedAtRaw: null` and `camera: 'unknown'` rather than a guess.
 */
export function parseClipFilename(fileName: string): ParsedClipFilename {
  const trimmed = (fileName ?? '').trim();
  const match = CLIP_FILENAME_REGEX.exec(trimmed);
  if (!match) {
    return { capturedAtRaw: null, camera: 'unknown', cameraRaw: null, matched: false };
  }
  const [, year, month, day, hour, minute, second, cameraRaw] = match;
  const capturedAtRaw = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  const normalizedCamera = cameraRaw.toLowerCase();
  const camera: CameraPosition = (CAMERA_POSITIONS as readonly string[]).includes(normalizedCamera)
    ? (normalizedCamera as CameraPosition)
    : 'unknown';
  return { capturedAtRaw, camera, cameraRaw, matched: true };
}

/**
 * Classifies a clip's export source from a browser-supplied relative path
 * (e.g. `File.webkitRelativePath`). Returns `'unknown'` when no path is
 * available or none of the known Tesla export folder names appear in it —
 * this function never guesses.
 */
export function detectSourceFromPath(relativePath: string | null | undefined): ClipSource {
  if (!relativePath) return 'unknown';
  const segments = relativePath.split(/[/\\]/).map((s) => s.toLowerCase());
  for (const segment of segments) {
    const hit = SOURCE_FOLDER_MARKERS[segment];
    if (hit) return hit;
  }
  return 'unknown';
}

/**
 * Defensively parses a Tesla `event.json` sidecar. The wire format is
 * undocumented and has drifted across firmware versions, so every field
 * is validated independently and absent/malformed fields resolve to
 * `null` rather than throwing or fabricating a value.
 */
export function parseEventSidecar(raw: unknown): EventJsonSidecar | null {
  if (raw == null || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v : null);
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    timestamp: str(obj.timestamp),
    city: str(obj.city),
    est_lat: num(obj.est_lat),
    est_lon: num(obj.est_lon),
    reason: str(obj.reason),
    camera: str(obj.camera),
  };
}

/**
 * Deterministic, content-derived id so re-importing the same file (same
 * name + size + last-modified) resolves to the same catalog entry instead
 * of creating a duplicate.
 */
export function buildClipId(fileName: string, sizeBytes: number, lastModifiedMs: number): string {
  const raw = `${fileName}::${sizeBytes}::${lastModifiedMs}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) | 0;
  }
  return `clip_${(hash >>> 0).toString(36)}_${sizeBytes.toString(36)}`;
}
