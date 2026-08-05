import { describe, it, expect } from 'vitest';
import { createMemoryDashcamDb } from '../lib/db/memoryAdapter';
import { defaultDashcamSettings, type ClipRecord } from '../lib/types';

function makeClip(id: string, createdAt: string): ClipRecord {
  return {
    id,
    fileName: `${id}.mp4`,
    cameraPosition: 'front',
    cameraRaw: 'front',
    source: 'unknown',
    capturedAtRaw: null,
    durationSeconds: 10,
    sizeBytes: 100,
    mimeType: 'video/mp4',
    blob: new Blob(['x']),
    eventSidecar: null,
    motion: { status: 'not_run' },
    eventCandidates: [],
    redactions: [],
    vehicleId: null,
    notes: '',
    createdAt,
    updatedAt: createdAt,
  };
}

describe('createMemoryDashcamDb', () => {
  it('starts empty with default settings', async () => {
    const db = createMemoryDashcamDb();
    expect(await db.listClips()).toEqual([]);
    expect(await db.getSettings()).toEqual(defaultDashcamSettings());
  });

  it('round-trips a clip through put/get/list/delete', async () => {
    const db = createMemoryDashcamDb();
    const clip = makeClip('a', '2024-01-01T00:00:00.000Z');
    await db.putClip(clip);
    expect(await db.getClip('a')).toEqual(clip);
    expect(await db.listClips()).toHaveLength(1);

    await db.deleteClip('a');
    expect(await db.getClip('a')).toBeNull();
    expect(await db.listClips()).toEqual([]);
  });

  it('lists clips newest-first by createdAt', async () => {
    const db = createMemoryDashcamDb();
    await db.putClip(makeClip('old', '2024-01-01T00:00:00.000Z'));
    await db.putClip(makeClip('new', '2024-06-01T00:00:00.000Z'));
    const listed = await db.listClips();
    expect(listed.map((c) => c.id)).toEqual(['new', 'old']);
  });

  it('persists settings updates', async () => {
    const db = createMemoryDashcamDb();
    const next = { ...defaultDashcamSettings(), reconstructionPreRollSeconds: 42 };
    await db.putSettings(next);
    expect(await db.getSettings()).toEqual(next);
  });

  it('getClip returns null for an unknown id', async () => {
    const db = createMemoryDashcamDb();
    expect(await db.getClip('missing')).toBeNull();
  });
});
