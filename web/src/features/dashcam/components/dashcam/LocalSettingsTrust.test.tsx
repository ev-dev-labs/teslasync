import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import { Button } from '@/components/ui';
import { defaultDashcamSettings, type ClipRecord, type DashcamSettings } from '../../lib/types';
import { ImportPanel } from './ImportPanel';
import { ClipDetailPanel } from './ClipDetailPanel';

const mocks = vi.hoisted(() => ({
  query: {} as DataStateSource<DashcamSettings> & { isLoading: boolean },
  refetch: vi.fn(),
  importClips: vi.fn(),
  updateSettings: vi.fn(),
  reconstruction: vi.fn(),
}));

vi.mock('../../hooks/useDashcamSettings', () => ({
  useDashcamSettings: () => ({ ...mocks.query, refetch: mocks.refetch }),
  useUpdateDashcamSettings: () => ({ mutate: mocks.updateSettings }),
}));
vi.mock('../../hooks/useClipCatalog', () => ({
  useImportClips: () => ({ mutateAsync: mocks.importClips, isPending: false, error: null }),
}));
vi.mock('../../hooks/useReconstruction', () => ({
  useReconstruction: (...args: unknown[]) => {
    mocks.reconstruction(...args);
    return { reconstruction: null };
  },
}));
vi.mock('./ClipPlayerPanel', () => ({ ClipPlayerPanel: () => <div>Clip playback</div> }));
vi.mock('./RedactionEditor', () => ({ RedactionEditor: () => <div>Redaction editor</div> }));
vi.mock('./EventEvidencePanel', () => ({ EventEvidencePanel: () => <div>Clip events</div> }));
vi.mock('./ExportManifestPanel', () => ({ ExportManifestPanel: () => <div>Export manifest</div> }));
vi.mock('./ReconstructionTimeline', () => ({
  ReconstructionTimeline: ({ settings, onUpdateSettings }: {
    settings: DashcamSettings;
    onUpdateSettings: (settings: DashcamSettings) => void;
  }) => <div>
    <span>Offset {settings.assumedTimezoneOffsetMinutes}</span>
    <span>Pre-roll {settings.reconstructionPreRollSeconds}</span>
    <span>Metadata {String(settings.autoDetectMetadataEvents)}</span>
    <Button onClick={() => onUpdateSettings(settings)}>Save offset</Button>
  </div>,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) => {
      const options = typeof fallback === 'object' && fallback != null
        ? fallback as Record<string, unknown> : values;
      const template = typeof fallback === 'string' ? fallback
        : typeof options?.defaultValue === 'string' ? options.defaultValue : key;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? name));
    },
    i18n: { language: 'en' },
  }),
}));

const clip: ClipRecord = {
  id: 'clip', fileName: 'clip.mp4', cameraPosition: 'front', cameraRaw: null,
  source: 'SavedClips', capturedAtRaw: '2026-10-14T10:00:00', durationSeconds: 60,
  sizeBytes: 1, mimeType: 'video/mp4', blob: new Blob(), eventSidecar: null,
  motion: { status: 'not_run' }, eventCandidates: [], redactions: [], vehicleId: 1,
  notes: '', createdAt: '', updatedAt: '',
};
const saved = {
  ...defaultDashcamSettings(), assumedTimezoneOffsetMinutes: 0,
  reconstructionPreRollSeconds: 0, reconstructionPostRollSeconds: 0,
  autoDetectMetadataEvents: false,
};
const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
const view = () => <MemoryRouter>
  <ImportPanel vehicleId={1} />
  <ClipDetailPanel clip={clip} vehicleId={1} />
</MemoryRouter>;
const selectFile = () => fireEvent.change(screen.getByLabelText('Video file(s)'), {
  target: { files: [file] },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query = { isLoading: false };
  mocks.importClips.mockResolvedValue([]);
});
afterEach(cleanup);

describe('independent local dashcam settings trust', () => {
  it.each([
    ['active loading', { isLoading: true, isPending: true, fetchStatus: 'fetching' as const }],
    ['paused without data', { isLoading: false, isPending: true, fetchStatus: 'paused' as const }],
    ['idle without data', { isLoading: false, isPending: true, fetchStatus: 'idle' as const }],
    ['initial failure', { isLoading: false, isError: true, error: new Error('Local settings read failed') }],
  ])('blocks import and alignment during %s, but preserves independent clip content', (_, query) => {
    mocks.query = query;
    render(view());
    selectFile();
    expect(screen.getByRole('button', { name: 'Import 1 clip(s)' })).toBeDisabled();
    expect(screen.getByText('Clip playback')).toBeInTheDocument();
    expect(mocks.reconstruction).toHaveBeenLastCalledWith(0, null, expect.any(Object), []);
    fireEvent.click(screen.getByRole('tab', { name: 'Reconstruction' }));
    expect(screen.queryByText('Save offset')).not.toBeInTheDocument();
    expect(mocks.importClips).not.toHaveBeenCalled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    if (mocks.query.isLoading) {
      expect(screen.getAllByLabelText('Loading Settings')).toHaveLength(2);
      expect(screen.queryByText('Pending')).not.toBeInTheDocument();
    }
    if (mocks.query.fetchStatus === 'paused') {
      expect(screen.getAllByText('Refresh paused')).toHaveLength(2);
      expect(screen.queryByLabelText('Loading Settings')).not.toBeInTheDocument();
      fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
      expect(mocks.refetch).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    ['successful absent-record defaults', defaultDashcamSettings()],
    ['successful zero and false preferences', saved],
  ])('uses %s only after a real read resolves', async (_, settings) => {
    mocks.query = { data: settings, isSuccess: true, isLoading: false };
    render(view());
    selectFile();
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 clip(s)' }));
    await waitFor(() => expect(mocks.importClips).toHaveBeenCalledWith({
      files: [file], sidecarFile: null, vehicleId: 1, settings,
    }));
    fireEvent.click(screen.getByRole('tab', { name: 'Reconstruction' }));
    expect(screen.getByText(`Offset ${settings.assumedTimezoneOffsetMinutes}`)).toBeInTheDocument();
    expect(mocks.reconstruction).toHaveBeenLastCalledWith(1, clip, settings, []);
  });

  it('retains preferences on refresh failure, retries only settings, and recovers without resets', async () => {
    mocks.query = { data: saved, isSuccess: true, isLoading: false };
    const { rerender } = render(view());
    selectFile();
    fireEvent.click(screen.getByRole('tab', { name: 'Reconstruction' }));
    mocks.query = { data: saved, isLoading: false, isError: true, error: new Error('Settings refresh failed') };
    rerender(view());
    expect(screen.getByText('Offset 0')).toBeInTheDocument();
    expect(screen.getByText('Pre-roll 0')).toBeInTheDocument();
    expect(screen.getByText('Metadata false')).toBeInTheDocument();
    expect(screen.getAllByText('Settings may be out of date')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[0]);
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.importClips).not.toHaveBeenCalled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 clip(s)' }));
    await waitFor(() => expect(mocks.importClips).toHaveBeenCalledWith(expect.objectContaining({ settings: saved })));
    expect(mocks.reconstruction).toHaveBeenLastCalledWith(1, clip, saved, []);
    mocks.query = { data: saved, isLoading: false, isSuccess: true };
    rerender(view());
    expect(screen.queryByText('Settings may be out of date')).not.toBeInTheDocument();
    expect(screen.getByText('Offset 0')).toBeInTheDocument();
  });

  it('recovers from an initial failed read without discarding selected import files', () => {
    mocks.query = { isLoading: false, isError: true, error: new Error('Settings read failed') };
    const { rerender } = render(view());
    selectFile();
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    mocks.query = { data: saved, isLoading: false, isSuccess: true };
    rerender(view());
    expect(screen.getByRole('button', { name: 'Import 1 clip(s)' })).toBeEnabled();
    expect(mocks.reconstruction).toHaveBeenLastCalledWith(1, clip, saved, []);
  });

  it('qualifies a paused refresh without losing retained settings or inventing a read failure', () => {
    mocks.query = { data: saved, isLoading: false, fetchStatus: 'paused' };
    render(view());
    selectFile();
    expect(screen.getByRole('button', { name: 'Import 1 clip(s)' })).toBeEnabled();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2);
    for (const notice of screen.getAllByTestId('stale-refresh-warning')) {
      expect(notice).toHaveAttribute('data-refresh-blocked', 'true');
    }
    expect(screen.queryByText('Failed to load data')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Reconstruction' }));
    expect(screen.getByText('Offset 0')).toBeInTheDocument();
    expect(mocks.reconstruction).toHaveBeenLastCalledWith(1, clip, saved, []);
  });
});
