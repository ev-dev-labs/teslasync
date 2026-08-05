import { describe, it, expect } from 'vitest';
import { parseClipFilename, detectSourceFromPath, parseEventSidecar, buildClipId } from '../lib/clipParsing';

describe('parseClipFilename', () => {
  it('parses a well-formed Tesla dashcam filename', () => {
    const result = parseClipFilename('2024-01-15_12-30-05-front.mp4');
    expect(result.matched).toBe(true);
    expect(result.capturedAtRaw).toBe('2024-01-15T12:30:05');
    expect(result.camera).toBe('front');
    expect(result.cameraRaw).toBe('front');
  });

  it('recognizes every known camera position', () => {
    const cameras = ['front', 'back', 'left_repeater', 'right_repeater', 'left_pillar', 'right_pillar'];
    for (const camera of cameras) {
      const result = parseClipFilename(`2024-01-15_12-30-05-${camera}.mp4`);
      expect(result.camera).toBe(camera);
    }
  });

  it('is case-insensitive on the camera suffix and extension', () => {
    const result = parseClipFilename('2024-01-15_12-30-05-FRONT.MP4');
    expect(result.matched).toBe(true);
    expect(result.camera).toBe('front');
  });

  it('does not guess when the filename does not match the convention', () => {
    const result = parseClipFilename('random_video.mp4');
    expect(result.matched).toBe(false);
    expect(result.capturedAtRaw).toBeNull();
    expect(result.camera).toBe('unknown');
    expect(result.cameraRaw).toBeNull();
  });

  it('marks an unrecognized camera suffix as unknown but keeps the raw text', () => {
    const result = parseClipFilename('2024-01-15_12-30-05-dashboard.mp4');
    expect(result.matched).toBe(true);
    expect(result.camera).toBe('unknown');
    expect(result.cameraRaw).toBe('dashboard');
  });

  it('handles empty/undefined input without throwing', () => {
    expect(() => parseClipFilename('')).not.toThrow();
    expect(parseClipFilename('').matched).toBe(false);
  });
});

describe('detectSourceFromPath', () => {
  it('detects SentryClips from a relative path', () => {
    expect(detectSourceFromPath('TeslaCam/SentryClips/2024-01-15_12-30-05/2024-01-15_12-30-05-front.mp4')).toBe(
      'SentryClips',
    );
  });

  it('detects SavedClips and RecentClips case-insensitively', () => {
    expect(detectSourceFromPath('TeslaCam/savedclips/x.mp4')).toBe('SavedClips');
    expect(detectSourceFromPath('TeslaCam/RECENTCLIPS/x.mp4')).toBe('RecentClips');
  });

  it('returns unknown for an absent or unrecognized path', () => {
    expect(detectSourceFromPath(null)).toBe('unknown');
    expect(detectSourceFromPath(undefined)).toBe('unknown');
    expect(detectSourceFromPath('SomeOtherFolder/x.mp4')).toBe('unknown');
  });
});

describe('parseEventSidecar', () => {
  it('parses a well-formed event.json object', () => {
    const parsed = parseEventSidecar({
      timestamp: '2024-01-15T12:30:00',
      city: 'San Francisco',
      est_lat: 37.7749,
      est_lon: -122.4194,
      reason: 'sentry_aware_object_detection',
      camera: 'front',
    });
    expect(parsed).toEqual({
      timestamp: '2024-01-15T12:30:00',
      city: 'San Francisco',
      est_lat: 37.7749,
      est_lon: -122.4194,
      reason: 'sentry_aware_object_detection',
      camera: 'front',
    });
  });

  it('returns null for non-object input', () => {
    expect(parseEventSidecar(null)).toBeNull();
    expect(parseEventSidecar(undefined)).toBeNull();
    expect(parseEventSidecar('not json')).toBeNull();
    expect(parseEventSidecar(42)).toBeNull();
  });

  it('drops malformed fields to null instead of throwing', () => {
    const parsed = parseEventSidecar({ timestamp: 123, est_lat: 'not a number', reason: '' });
    expect(parsed).toEqual({ timestamp: null, city: null, est_lat: null, est_lon: null, reason: null, camera: null });
  });
});

describe('buildClipId', () => {
  it('is deterministic for identical inputs', () => {
    const a = buildClipId('2024-01-15_12-30-05-front.mp4', 12345, 1705320605000);
    const b = buildClipId('2024-01-15_12-30-05-front.mp4', 12345, 1705320605000);
    expect(a).toBe(b);
  });

  it('differs when any input changes', () => {
    const base = buildClipId('a.mp4', 100, 1000);
    expect(buildClipId('b.mp4', 100, 1000)).not.toBe(base);
    expect(buildClipId('a.mp4', 200, 1000)).not.toBe(base);
    expect(buildClipId('a.mp4', 100, 2000)).not.toBe(base);
  });
});
