import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportManifestPanel } from './ExportManifestPanel';
import type { ClipRecord } from '../../lib/types';
import type { ReconstructionResult } from '../../lib/timelineAlignment';

const exports = vi.hoisted(() => ({
  downloadJson: vi.fn(), downloadBlobAs: vi.fn(), drawRedactedFrame: vi.fn(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('../../lib/redactionExport', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/redactionExport')>(),
  ...exports,
}));

function clip(id = 'first'): ClipRecord {
  return {
    id, fileName: `${id}-front.mp4`, cameraPosition: 'front', cameraRaw: 'front',
    source: 'SavedClips', capturedAtRaw: '2026-10-14T10:00:00',
    durationSeconds: 60, sizeBytes: 4, mimeType: 'video/mp4', blob: new Blob([id]),
    eventSidecar: null, motion: { status: 'not_run' }, vehicleId: 7,
    notes: 'Local evidence', createdAt: '', updatedAt: '',
    redactions: [{ id: 'mask', kind: 'plate', label: 'Plate', x: 0.1, y: 0.2, width: 0.3, height: 0.4, createdAt: '' }],
    eventCandidates: [{ id: 'event', type: 'manual_save', confidence: 'medium', atSeconds: 0, basis: ['folder metadata'] }],
  };
}

const png = new Blob(['png'], { type: 'image/png' });
let encoders: BlobCallback[];

function startExport() {
  fireEvent.click(screen.getByRole('button', { name: 'Export redacted still (PNG)' }));
  const video = document.body.querySelector('video');
  expect(video).not.toBeNull();
  return video!;
}

beforeEach(() => {
  vi.resetAllMocks();
  encoders = [];
  let url = 0;
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => `blob:attempt-${++url}`);
    static revokeObjectURL = vi.fn();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => { encoders.push(callback); });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ExportManifestPanel attempt ownership', () => {
  it('exports populated metadata, masks and reconstruction without losing evidence', () => {
    const current = clip();
    const reconstruction: ReconstructionResult = {
      clipWindow: { startSeconds: 0, endSeconds: 60 },
      reconstructionWindow: { startSeconds: -15, endSeconds: 75 },
      series: [{ signal: 'Speed', points: [{ atSeconds: 0, timestamp: '2026-10-14T10:00:00Z', value: 0 }], coverage: 'sparse', gapNotes: ['Exact gap'] }],
      incidentSequence: [{ id: 'incident', atSeconds: 0, kind: 'signal_spike', signal: 'Speed', description: 'Exact source evidence', zScore: 3 }],
      overallQuality: 'partial', qualityNotes: ['Exact clock assumption'],
    };
    render(<ExportManifestPanel clip={current} reconstruction={reconstruction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download incident manifest (JSON)' }));
    expect(exports.downloadJson).toHaveBeenCalledWith(`${current.fileName}.incident-manifest.json`, expect.objectContaining({
      clip: expect.objectContaining({ fileName: current.fileName, capturedAtRaw: current.capturedAtRaw, durationSeconds: 60 }),
      eventCandidates: current.eventCandidates,
      redactions: current.redactions.map(({ createdAt: _createdAt, ...mask }) => mask),
      reconstruction: { included: true, overallQuality: 'partial', qualityNotes: reconstruction.qualityNotes, signalCount: 1, incidentSequence: reconstruction.incidentSequence },
    }));
    expect(screen.getByText(/not a redacted video file/)).toBeInTheDocument();
  });

  it('keeps one attempt pending through encoding and exports the initial frame with real dimensions', () => {
    const current = clip();
    render(<ExportManifestPanel clip={current} reconstruction={null} />);
    const video = startExport();
    const button = screen.getByRole('button', { name: 'Export redacted still (PNG)' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    Object.defineProperties(video, { videoWidth: { value: 1920 }, videoHeight: { value: 1080 } });
    expect(video.currentTime).toBe(0);
    fireEvent.loadedData(video);
    expect(exports.drawRedactedFrame).toHaveBeenCalledWith(expect.anything(), video, 1920, 1080, current.redactions);
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
    expect(document.body.querySelector('video')).toBeNull();
    expect(video).not.toHaveAttribute('src');
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:attempt-1');
    expect(button).toBeDisabled();
    act(() => encoders[0](png));
    expect(exports.downloadBlobAs).toHaveBeenCalledExactlyOnceWith(png, `${current.fileName}.redacted-still.png`);
    expect(button).toBeEnabled();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('disposes an old decoder without revoking or failing the next clip attempt', () => {
    const { rerender } = render(<ExportManifestPanel clip={clip()} reconstruction={null} />);
    const oldVideo = startExport();
    rerender(<ExportManifestPanel clip={clip('second')} reconstruction={null} />);
    expect(oldVideo.isConnected).toBe(false);
    const nextVideo = startExport();
    fireEvent.error(oldVideo);
    fireEvent.loadedData(oldVideo);
    expect(exports.drawRedactedFrame).not.toHaveBeenCalled();
    expect(nextVideo.isConnected).toBe(true);
    expect(nextVideo.src).toContain('blob:attempt-2');
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:attempt-1');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.loadedData(nextVideo);
    act(() => encoders[0](png));
    expect(exports.downloadBlobAs).toHaveBeenCalledWith(png, 'second-front.mp4.redacted-still.png');
    expect(vi.mocked(URL.revokeObjectURL).mock.calls).toEqual([['blob:attempt-1'], ['blob:attempt-2']]);
  });

  it.each([png, null])('ignores stale PNG completion after changing clips (%s)', (result) => {
    const { rerender } = render(<ExportManifestPanel clip={clip()} reconstruction={null} />);
    fireEvent.loadedData(startExport());
    rerender(<ExportManifestPanel clip={clip('second')} reconstruction={null} />);
    const nextVideo = startExport();
    act(() => encoders[0](result));
    expect(exports.downloadBlobAs).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export redacted still (PNG)' })).toBeDisabled();
    expect(nextVideo.isConnected).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:attempt-1');
    fireEvent.loadedData(nextVideo);
    act(() => encoders[1](png));
    expect(exports.downloadBlobAs).toHaveBeenCalledExactlyOnceWith(png, 'second-front.mp4.redacted-still.png');
  });

  it.each(['decoding', 'encoding'])('disposes on tab unmount during %s without affecting a remounted panel', (phase) => {
    const first = render(<ExportManifestPanel clip={clip()} reconstruction={null} />);
    const oldVideo = startExport();
    if (phase === 'encoding') fireEvent.loadedData(oldVideo);
    first.unmount();
    render(<ExportManifestPanel clip={clip('second')} reconstruction={null} />);
    const nextVideo = startExport();
    fireEvent.error(oldVideo);
    fireEvent.loadedData(oldVideo);
    if (phase === 'encoding') act(() => encoders[0](null));
    expect(exports.downloadBlobAs).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(nextVideo.isConnected).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:attempt-1');
  });

  it('retains native decode errors, clears them on context change, and allows retry', () => {
    const { rerender } = render(<ExportManifestPanel clip={clip()} reconstruction={null} />);
    const video = startExport();
    Object.defineProperty(video, 'error', { value: { message: 'Native decoder rejected bytes' } });
    fireEvent.error(video);
    expect(screen.getByText('Native decoder rejected bytes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export redacted still (PNG)' })).toBeEnabled();
    rerender(<ExportManifestPanel clip={clip('second')} reconstruction={null} />);
    expect(screen.queryByText('Native decoder rejected bytes')).not.toBeInTheDocument();
    fireEvent.error(startExport());
    expect(screen.getByText('This browser could not decode the clip for a still export.')).toBeInTheDocument();
  });

  it.each(['canvas', 'draw', 'encode', 'download'])('retains native %s errors and releases only its own resources', (stage) => {
    const message = `Native ${stage} denied`;
    if (stage === 'canvas') vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementationOnce(() => { throw new Error(message); });
    if (stage === 'draw') exports.drawRedactedFrame.mockImplementationOnce(() => { throw new Error(message); });
    if (stage === 'encode') vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce(() => { throw new Error(message); });
    if (stage === 'download') exports.downloadBlobAs.mockImplementationOnce(() => { throw new Error(message); });
    render(<ExportManifestPanel clip={clip()} reconstruction={null} />);
    fireEvent.loadedData(startExport());
    if (stage === 'download') act(() => encoders[0](png));
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(document.body.querySelector('video')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:attempt-1');
    expect(screen.getByRole('button', { name: 'Export redacted still (PNG)' })).toBeEnabled();
  });

  it.each(['canvas', 'png'])('reports unavailable %s rather than claiming success', (stage) => {
    if (stage === 'canvas') vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(null);
    render(<ExportManifestPanel clip={clip()} reconstruction={null} />);
    fireEvent.loadedData(startExport());
    if (stage === 'png') act(() => encoders[0](null));
    expect(screen.getByText(stage === 'canvas'
      ? 'This browser could not create a still-image canvas.'
      : 'This browser could not encode the still image.')).toBeInTheDocument();
    expect(exports.downloadBlobAs).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Export redacted still (PNG)' })).toBeEnabled();
  });

  it('reports URL setup failure and permits a new attempt', () => {
    vi.mocked(URL.createObjectURL).mockImplementationOnce(() => { throw new Error('Local URL denied'); });
    render(<ExportManifestPanel clip={clip()} reconstruction={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export redacted still (PNG)' }));
    expect(screen.getByText('Local URL denied')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export redacted still (PNG)' })).toBeEnabled();
    startExport();
    expect(screen.queryByText('Local URL denied')).not.toBeInTheDocument();
  });
});
