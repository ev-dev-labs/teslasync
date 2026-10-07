import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ClipFilterBar } from './ClipFilterBar';
import { ClipCatalogList } from './ClipCatalogList';
import { EventEvidencePanel } from './EventEvidencePanel';
import { ImportPanel } from './ImportPanel';
import { ExportManifestPanel } from './ExportManifestPanel';
import { defaultClipFilterState } from '../../lib/clipFilter';
import { defaultDashcamSettings, type ClipRecord } from '../../lib/types';
import type { ReconstructionResult } from '../../lib/timelineAlignment';

const h = vi.hoisted(() => ({
  remove: vi.fn(), importFiles: vi.fn(), downloadJson: vi.fn(), downloadBlob: vi.fn(), draw: vi.fn(),
  importError: null as Error | null,
}));
vi.mock('../../hooks/useClipCatalog', () => ({
  useDeleteClip: () => ({ mutate: h.remove }),
  useImportClips: () => ({ mutateAsync: h.importFiles, isPending: false, error: h.importError }),
}));
vi.mock('../../hooks/useDashcamSettings', () => ({
  useDashcamSettings: () => ({ data: undefined }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatDuration: (seconds: number | null) => seconds == null ? '—' : `${seconds}s` }),
}));
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'dashcam.camera.front': 'Avant',
        'dashcam.source.SavedClips': 'Enregistré',
        'dashcam.events.type.hard_brake': 'Freinage (statistique)',
      };
      return (translations[key] ?? fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? `{{${name}}}`));
    },
    i18n: { language: 'en' },
  }),
}));
vi.mock('../../lib/redactionExport', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/redactionExport')>(),
  downloadJson: h.downloadJson,
  downloadBlobAs: h.downloadBlob,
  drawRedactedFrame: h.draw,
}));

function clip(): ClipRecord {
  return {
    id: 'selected-42', fileName: '2026-10-05T10-00-00-front.mp4',
    cameraPosition: 'front', cameraRaw: 'front', source: 'SavedClips',
    capturedAtRaw: '2026-10-05T10:00:00', durationSeconds: null,
    sizeBytes: 1, mimeType: 'video/mp4', blob: new Blob(['clip']),
    eventSidecar: null, motion: { status: 'not_run' }, vehicleId: 7,
    notes: '', createdAt: '', updatedAt: '',
    redactions: [{ id: 'mask-9', kind: 'plate', label: 'User label', x: 0.1, y: 0.2, width: 0.3, height: 0.4, createdAt: '' }],
    eventCandidates: [
      { id: 'event-1', type: 'hard_brake', confidence: 'low', atSeconds: 0, basis: ['exact telemetry basis', 'not object detection'] },
      { id: 'event-2', type: 'manual_save', confidence: 'medium', atSeconds: null, basis: ['folder metadata'] },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.importError = null;
  h.importFiles.mockResolvedValue([]);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:still');
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('dashcam residual presentation preservation', () => {
  it('retains localized active-chip identity when the current catalog has no matching facet option', () => {
    render(<ClipFilterBar clips={[]} filters={{ ...defaultClipFilterState(), camera: 'front' }} onChange={vi.fn()} />);
    expect(screen.getByText('Avant')).toBeInTheDocument();
    expect(screen.queryByText('front')).not.toBeInTheDocument();
  });
  it('localizes ordered/count-bearing facets as pressed filters and preserves every other filter field', () => {
    const onChange = vi.fn();
    const filters = { ...defaultClipFilterState(), query: 'keep query', source: 'SavedClips' as const };
    render(<ClipFilterBar clips={[clip()]} filters={filters} onChange={onChange} />);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    const camera = screen.getByRole('group', { name: 'Camera' });
    expect(within(camera).getByRole('button', { name: 'All(1)' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(camera).getByRole('button', { name: 'Avant(1)' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...filters, camera: 'front' });
    expect(within(screen.getByRole('group', { name: 'Source folder' })).getByRole('button', { name: 'Enregistré(1)' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('group', { name: 'Event type' })).getByRole('button', { name: 'Freinage (statistique)(1)' })).toBeInTheDocument();
  });

  it('preserves selected IDs, raw camera-clock text, unknown duration and exact delete identity', () => {
    const current = clip();
    const onSelect = vi.fn();
    render(<ClipCatalogList clips={[current]} totalCount={1} selectedClipId={current.id} onSelect={onSelect} onClearFilters={vi.fn()} />);
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Avant')).toBeInTheDocument();
    expect(screen.getByText('Enregistré')).toBeInTheDocument();
    expect(screen.getByText('2026-10-05 10:00:00')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option'));
    expect(onSelect).toHaveBeenCalledWith(current.id);
    fireEvent.click(screen.getByRole('button', { name: 'Delete clip' }));
    expect(h.remove).toHaveBeenCalledWith(current.id);
  });

  it('retains all evidence and distinguishes a zero timestamp from a whole-clip event', () => {
    render(<EventEvidencePanel clip={clip()} />);
    expect(screen.getByText('Freinage (statistique)')).toBeInTheDocument();
    expect(screen.getByText('exact telemetry basis — not object detection')).toBeInTheDocument();
    expect(screen.getByText('folder metadata')).toBeInTheDocument();
    expect(screen.getByText('t=0.00s')).toBeInTheDocument();
    expect(screen.getByText('whole clip')).toBeInTheDocument();
  });

  it('keeps local files and the native error on failure, then resets both inputs only after success', async () => {
    const video = new File(['video'], 'front.mp4', { type: 'video/mp4' });
    const sidecar = new File(['{}'], 'event.json', { type: 'application/json' });
    const error = new Error('IndexedDB denied');
    h.importError = error;
    h.importFiles.mockRejectedValueOnce(error);
    render(<MemoryRouter><ImportPanel vehicleId={7} /></MemoryRouter>);
    const videos = screen.getByLabelText('Video file(s)');
    const sidecars = screen.getByLabelText('event.json (optional)');
    fireEvent.change(videos, { target: { files: [video] } });
    fireEvent.change(sidecars, { target: { files: [sidecar] } });
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 clip(s)' }));
    await waitFor(() => expect(h.importFiles).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Import 1 clip(s)' })).toBeEnabled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(h.importFiles).toHaveBeenCalledWith({ files: [video], sidecarFile: sidecar, vehicleId: 7, settings: defaultDashcamSettings() });
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 clip(s)' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import 0 clip(s)' })).toBeDisabled());
    expect(videos).toHaveValue('');
    expect(sidecars).toHaveValue('');
  });

  it('exports the full local manifest and renders native decode failure without claiming a video export', () => {
    const current = clip();
    render(<ExportManifestPanel clip={current} reconstruction={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download incident manifest (JSON)' }));
    expect(h.downloadJson).toHaveBeenCalledWith(`${current.fileName}.incident-manifest.json`, expect.objectContaining({
      eventCandidates: current.eventCandidates,
      redactions: current.redactions.map(({ createdAt: _createdAt, ...region }) => region),
      reconstruction: { included: false },
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Export redacted still (PNG)' }));
    const video = document.body.querySelector('video')!;
    fireEvent.error(video);
    expect(screen.getByText('This browser could not decode the clip for a still export.')).toBeInTheDocument();
    expect(document.body.querySelector('video')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:still');
    expect(h.downloadBlob).not.toHaveBeenCalled();
    expect(screen.getByText(/not a redacted video file/)).toBeInTheDocument();
  });

  it('exports all reconstruction incidents and quality notes without sampling or losing source identity', () => {
    const reconstruction: ReconstructionResult = {
      clipWindow: { startSeconds: 0, endSeconds: 60 },
      reconstructionWindow: { startSeconds: -15, endSeconds: 75 },
      series: [
        { signal: 'Speed', points: [{ atSeconds: -5, timestamp: '2026-10-05T09:59:55Z', value: 0 }], coverage: 'sparse', gapNotes: ['Exact gap'] },
        { signal: 'Heading', points: [], coverage: 'none', gapNotes: ['Missing heading'] },
      ],
      incidentSequence: Array.from({ length: 30 }, (_, index) => ({
        id: `incident-${index}`, atSeconds: index, kind: 'signal_spike' as const,
        signal: 'Speed', description: `Source evidence ${index}`, zScore: index,
      })),
      overallQuality: 'partial', qualityNotes: ['Exact clock assumption', 'Exact source limitation'],
    };
    render(<ExportManifestPanel clip={clip()} reconstruction={reconstruction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download incident manifest (JSON)' }));
    expect(h.downloadJson).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      reconstruction: {
        included: true, signalCount: 2, overallQuality: 'partial',
        qualityNotes: reconstruction.qualityNotes, incidentSequence: reconstruction.incidentSequence,
      },
    }));
  });

  it('retains native canvas geometry, mask objects, PNG name and successful cleanup', () => {
    const current = clip();
    const context = {} as CanvasRenderingContext2D;
    const png = new Blob(['png'], { type: 'image/png' });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(png));
    render(<ExportManifestPanel clip={current} reconstruction={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export redacted still (PNG)' }));
    const video = document.body.querySelector('video')!;
    Object.defineProperty(video, 'videoWidth', { value: 1920 });
    Object.defineProperty(video, 'videoHeight', { value: 1080 });
    fireEvent.loadedData(video);
    expect(h.draw).toHaveBeenCalledWith(context, video, 1920, 1080, current.redactions);
    expect(h.downloadBlob).toHaveBeenCalledWith(png, `${current.fileName}.redacted-still.png`);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:still');
    expect(document.body.querySelector('video')).toBeNull();
  });

  it('shows native thrown export errors while cleaning up the decoded video', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => { throw new Error('Native canvas denied'); });
    render(<ExportManifestPanel clip={clip()} reconstruction={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export redacted still (PNG)' }));
    fireEvent.loadedData(document.body.querySelector('video')!);
    expect(screen.getByText('Native canvas denied')).toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:still');
    expect(document.body.querySelector('video')).toBeNull();
    expect(h.downloadBlob).not.toHaveBeenCalled();
  });
});
