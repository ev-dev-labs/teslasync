import { MOTION_SAMPLE_PAIRS, MOTION_SCORE_THRESHOLDS } from './constants';

export type MotionScoreResult =
  | { status: 'ok'; score: number; samplePairs: number }
  | { status: 'unavailable'; reason: string };

/**
 * Pure, browser-free frame-difference score: mean absolute luminance delta
 * between two equal-length RGBA buffers, normalized to 0..1. This is a
 * brightness/pixel-difference heuristic ONLY — it does not identify what
 * changed (person, vehicle, shadow, headlight glare, ...).
 *
 * Throws `RangeError` for mismatched buffer lengths (a caller bug, not a
 * runtime/platform limitation) so it surfaces immediately in development.
 */
export function frameDiffScore(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length) {
    throw new RangeError(`frameDiffScore: buffer length mismatch (${a.length} vs ${b.length})`);
  }
  if (a.length === 0) return 0;
  let sum = 0;
  let samples = 0;
  // Step by 4 (RGBA) and further stride by 4 pixels for performance —
  // sampling every pixel of every frame pair is unnecessary for a coarse
  // motion heuristic.
  const pixelStride = 4 * 4;
  for (let i = 0; i + 2 < a.length; i += pixelStride) {
    const lumaA = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    const lumaB = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
    sum += Math.abs(lumaA - lumaB);
    samples += 1;
  }
  if (samples === 0) return 0;
  return Math.min(1, sum / samples / 255);
}

export function classifyMotionScore(score: number): 'low' | 'medium' | 'high' {
  if (score >= MOTION_SCORE_THRESHOLDS.medium) return 'high';
  if (score >= MOTION_SCORE_THRESHOLDS.low) return 'medium';
  return 'low';
}

/** Minimal shape this module needs from an `HTMLVideoElement`, kept narrow so it's mockable in tests. */
export interface SampleableVideo {
  duration: number;
  videoWidth: number;
  videoHeight: number;
  currentTime: number;
  addEventListener(type: 'seeked', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'seeked', listener: () => void): void;
}

/** Minimal canvas-2d-context shape this module draws through. */
export interface Sampleable2DContext {
  drawImage(source: unknown, dx: number, dy: number, dw: number, dh: number): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): { data: Uint8ClampedArray };
}

function seekTo(video: SampleableVideo, time: number): Promise<void> {
  return new Promise((resolve) => {
    const handler = () => resolve();
    video.addEventListener('seeked', handler, { once: true });
    video.currentTime = time;
  });
}

/**
 * Computes a coarse, sampled-frame motion score for a clip by seeking to
 * evenly-spaced points across its duration, drawing each frame to an
 * off-DOM canvas, and diffing consecutive samples with {@link frameDiffScore}.
 *
 * Explicitly fails (returns `{status:'unavailable', reason}`) rather than
 * silently returning a fake score whenever a required browser API is
 * missing: no `document`, no 2D canvas context, or a non-finite/zero
 * clip duration (undecodable video). Callers must surface `reason` to the
 * user rather than treating "unavailable" as "no motion".
 */
export async function computeClipMotionScore(
  video: SampleableVideo,
  opts?: { sampleCount?: number; createCanvas?: (w: number, h: number) => { getContext(kind: '2d'): Sampleable2DContext | null } },
): Promise<MotionScoreResult> {
  const sampleCount = opts?.sampleCount ?? MOTION_SAMPLE_PAIRS;

  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    return { status: 'unavailable', reason: 'clip has no decodable duration' };
  }

  const createCanvas =
    opts?.createCanvas ??
    ((w: number, h: number) => {
      if (typeof document === 'undefined') {
        throw new Error('document is unavailable');
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      return canvas as unknown as { getContext(kind: '2d'): Sampleable2DContext | null };
    });

  const width = Math.max(1, Math.min(160, video.videoWidth || 160));
  const height = Math.max(1, Math.min(90, video.videoHeight || 90));

  let canvas: { getContext(kind: '2d'): Sampleable2DContext | null };
  try {
    canvas = createCanvas(width, height);
  } catch (err) {
    return { status: 'unavailable', reason: `canvas creation failed: ${(err as Error).message}` };
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { status: 'unavailable', reason: '2D canvas context is unavailable in this browser' };
  }

  const usableDuration = Math.max(0, video.duration - 0.2);
  const step = usableDuration / (sampleCount + 1);
  const frames: Uint8ClampedArray[] = [];

  try {
    for (let i = 1; i <= sampleCount; i++) {
      await seekTo(video, Math.min(video.duration, step * i));
      ctx.drawImage(video, 0, 0, width, height);
      frames.push(ctx.getImageData(0, 0, width, height).data);
    }
  } catch (err) {
    return { status: 'unavailable', reason: `frame extraction failed: ${(err as Error).message}` };
  }

  if (frames.length < 2) {
    return { status: 'unavailable', reason: 'not enough decodable frames were sampled' };
  }

  let total = 0;
  for (let i = 1; i < frames.length; i++) {
    total += frameDiffScore(frames[i - 1], frames[i]);
  }
  const score = total / (frames.length - 1);
  return { status: 'ok', score, samplePairs: frames.length - 1 };
}
