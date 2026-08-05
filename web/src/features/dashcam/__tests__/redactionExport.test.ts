import { describe, it, expect, vi } from 'vitest';
import { buildIncidentManifest, drawRedactedFrame, type RedactionDrawContext } from '../lib/redactionExport';
import type { ClipRecord } from '../lib/types';
import type { ReconstructionResult } from '../lib/timelineAlignment';

function makeClip(overrides: Partial<ClipRecord> = {}): ClipRecord {
  return {
    id: 'clip_1',
    fileName: '2024-01-15_12-30-05-front.mp4',
    cameraPosition: 'front',
    cameraRaw: 'front',
    source: 'SentryClips',
    capturedAtRaw: '2024-01-15T12:30:05',
    durationSeconds: 30,
    sizeBytes: 1024,
    mimeType: 'video/mp4',
    blob: new Blob(['x']),
    eventSidecar: null,
    motion: { status: 'not_run' },
    eventCandidates: [{ id: 'e1', type: 'sentry_trigger', confidence: 'low', atSeconds: null, basis: ['folder: SentryClips'] }],
    redactions: [{ id: 'r1', kind: 'face', label: 'Passerby', x: 0.1, y: 0.1, width: 0.2, height: 0.2, createdAt: '2024-01-15T00:00:00.000Z' }],
    vehicleId: null,
    notes: '',
    createdAt: '2024-01-15T00:00:00.000Z',
    updatedAt: '2024-01-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildIncidentManifest', () => {
  it('includes clip metadata, redactions, and event candidates without embedding video bytes', () => {
    const manifest = buildIncidentManifest(makeClip(), null);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.clip.fileName).toBe('2024-01-15_12-30-05-front.mp4');
    expect(manifest.redactions).toHaveLength(1);
    expect(manifest.eventCandidates).toHaveLength(1);
    expect(manifest.reconstruction.included).toBe(false);
    expect(JSON.stringify(manifest)).not.toContain('blob');
  });

  it('includes reconstruction summary when provided', () => {
    const reconstruction: ReconstructionResult = {
      clipWindow: { startSeconds: 0, endSeconds: 30 },
      reconstructionWindow: { startSeconds: -15, endSeconds: 45 },
      series: [{ signal: 'Speed', points: [], coverage: 'good', gapNotes: [] }],
      incidentSequence: [],
      overallQuality: 'good',
      qualityNotes: [],
    };
    const manifest = buildIncidentManifest(makeClip(), reconstruction);
    expect(manifest.reconstruction.included).toBe(true);
    expect(manifest.reconstruction.overallQuality).toBe('good');
    expect(manifest.reconstruction.signalCount).toBe(1);
  });

  it('always carries the standard honesty disclaimers', () => {
    const manifest = buildIncidentManifest(makeClip(), null);
    expect(manifest.disclaimers.length).toBeGreaterThan(0);
    expect(manifest.disclaimers.join(' ')).toContain('client-side');
  });
});

describe('drawRedactedFrame', () => {
  it('draws the frame then fills each redaction region scaled to frame size', () => {
    const ctx: RedactionDrawContext = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    };
    drawRedactedFrame(ctx, 'video-source', 200, 100, [
      { id: 'r1', kind: 'face', label: 'A', x: 0.25, y: 0.5, width: 0.1, height: 0.2, createdAt: '' },
    ]);
    expect(ctx.drawImage).toHaveBeenCalledWith('video-source', 0, 0, 200, 100);
    expect(ctx.fillRect).toHaveBeenCalledWith(50, 50, 20, 20);
    expect(ctx.fillStyle).toBe('#000000');
  });

  it('draws nothing extra when there are no regions', () => {
    const ctx: RedactionDrawContext = { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' };
    drawRedactedFrame(ctx, 'src', 100, 100, []);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});
