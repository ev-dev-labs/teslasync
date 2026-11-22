import { describe, it, expect } from 'vitest';
import { createMemoryDashcamDb } from '../lib/db/memoryAdapter';
import { retentionStatus, type ClipRetention, type RetentionKey } from '../lib/clipRetention';
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

  it('only arms for the exact imported clip, subject and vehicle and rejects a stale edit', async () => {
    const db = createMemoryDashcamDb();
    const clip = { ...makeClip('real', '2026-05-01T10:00:00Z'), vehicleId: 7 };
    const plan: ClipRetention = {
      subject: 'synthetic-owner', vehicleId: 7, clipId: clip.id, clipImportedAt: clip.createdAt,
      revision: 'first', confirmedAt: '2026-05-01T10:01:00Z',
      deadline: '2026-05-02T10:00:00Z', hold: null, snoozeUntil: null,
    };
    const key: RetentionKey = [plan.subject, plan.vehicleId, clip.id];
    const change = { key, clipImportedAt: clip.createdAt, expectedRevision: null, next: plan };
    expect(await db.changeRetention(change)).toBe(false);
    await db.putClip(clip);
    expect(await db.changeRetention(change)).toBe(true);
    expect(await db.listRetention('synthetic-foreign', 7)).toEqual([]);
    expect(await db.listRetention(plan.subject, 8)).toEqual([]);
    expect(await db.listRetention(plan.subject, 7)).toEqual([plan]);
    expect(await db.changeRetention({ ...change, next: { ...plan, revision: 'stale' } })).toBe(false);
    expect(retentionStatus(plan, Date.parse('2026-05-01T10:00:00Z'))).toBe('due');
    expect(retentionStatus(plan, Date.parse(plan.deadline))).toBe('expired');
    expect(await db.changeRetention({ ...change, expectedRevision: plan.revision, next: null })).toBe(true);
    expect(await db.getClip(clip.id)).toEqual(clip);
    expect(await db.changeRetention(change)).toBe(true);
    await db.deleteClip(clip.id);
    await db.putClip({ ...clip, createdAt: '2026-05-01T12:01:00Z' });
    expect(await db.listRetention(plan.subject, 7)).toEqual([]);
    expect(await db.changeRetention(change)).toBe(false);
  });
});
