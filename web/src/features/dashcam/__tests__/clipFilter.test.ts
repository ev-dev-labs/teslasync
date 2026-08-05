import { describe, it, expect } from 'vitest';
import { filterClips, defaultClipFilterState, countByCamera, countByEventType } from '../lib/clipFilter';
import type { ClipRecord } from '../lib/types';

function makeClip(overrides: Partial<ClipRecord>): ClipRecord {
  return {
    id: overrides.id ?? 'id',
    fileName: overrides.fileName ?? '2024-01-01_00-00-00-front.mp4',
    cameraPosition: overrides.cameraPosition ?? 'front',
    cameraRaw: 'front',
    source: overrides.source ?? 'unknown',
    capturedAtRaw: null,
    durationSeconds: 10,
    sizeBytes: 100,
    mimeType: 'video/mp4',
    blob: new Blob(['x']),
    eventSidecar: null,
    motion: { status: 'not_run' },
    eventCandidates: overrides.eventCandidates ?? [],
    redactions: [],
    vehicleId: null,
    notes: overrides.notes ?? '',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

describe('filterClips', () => {
  const clips: ClipRecord[] = [
    makeClip({ id: 'a', fileName: '2024-01-01_08-00-00-front.mp4', cameraPosition: 'front', source: 'SentryClips', eventCandidates: [{ id: 'e1', type: 'sentry_trigger', confidence: 'low', atSeconds: null, basis: [] }] }),
    makeClip({ id: 'b', fileName: '2024-01-02_09-00-00-back.mp4', cameraPosition: 'back', source: 'SavedClips', notes: 'garage door incident' }),
    makeClip({ id: 'c', fileName: '2024-01-03_10-00-00-left_repeater.mp4', cameraPosition: 'left_repeater', source: 'RecentClips' }),
  ];

  it('returns everything with the default (unfiltered) state', () => {
    expect(filterClips(clips, defaultClipFilterState())).toHaveLength(3);
  });

  it('filters by camera position', () => {
    const result = filterClips(clips, { ...defaultClipFilterState(), camera: 'back' });
    expect(result.map((c) => c.id)).toEqual(['b']);
  });

  it('filters by source folder', () => {
    const result = filterClips(clips, { ...defaultClipFilterState(), source: 'SentryClips' });
    expect(result.map((c) => c.id)).toEqual(['a']);
  });

  it('filters by event candidate type', () => {
    const result = filterClips(clips, { ...defaultClipFilterState(), eventType: 'sentry_trigger' });
    expect(result.map((c) => c.id)).toEqual(['a']);
  });

  it('searches filename case-insensitively', () => {
    const result = filterClips(clips, { ...defaultClipFilterState(), query: 'BACK' });
    expect(result.map((c) => c.id)).toEqual(['b']);
  });

  it('searches notes as well as filename', () => {
    const result = filterClips(clips, { ...defaultClipFilterState(), query: 'garage door' });
    expect(result.map((c) => c.id)).toEqual(['b']);
  });

  it('combines facets with AND semantics', () => {
    const result = filterClips(clips, { ...defaultClipFilterState(), camera: 'front', source: 'SavedClips' });
    expect(result).toHaveLength(0);
  });

  it('counts clips per camera and per event type', () => {
    expect(countByCamera(clips, 'front')).toBe(1);
    expect(countByCamera(clips, 'back')).toBe(1);
    expect(countByEventType(clips, 'sentry_trigger')).toBe(1);
    expect(countByEventType(clips, 'impact')).toBe(0);
  });
});
