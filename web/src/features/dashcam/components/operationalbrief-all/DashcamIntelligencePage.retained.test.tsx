import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import type { ClipRecord } from '../../lib/types';
import DashcamIntelligencePage from '../../pages/DashcamIntelligencePage';

const h = vi.hoisted(() => ({
  query: {
    data: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as DataStateSource<ClipRecord[]>,
  persistent: true,
  fallbackReason: null as string | null,
  remove: vi.fn(),
  importFiles: vi.fn(),
  motion: vi.fn(),
}));

vi.mock('../../hooks/useClipCatalog', () => ({
  useClipCatalog: () => h.query,
  useDeleteClip: () => ({ mutate: h.remove, error: null }),
  useImportClips: () => ({ mutateAsync: h.importFiles, isPending: false, error: null }),
}));
vi.mock('../../hooks/useDashcamDb', () => ({
  useDashcamDb: () => ({ persistent: h.persistent, fallbackReason: h.fallbackReason }),
}));
vi.mock('../../hooks/useDashcamSettings', () => ({
  useDashcamSettings: () => ({ data: undefined }),
  useUpdateDashcamSettings: () => ({ mutate: vi.fn() }),
}));
vi.mock('../../hooks/useReconstruction', () => ({
  useReconstruction: () => ({
    reconstruction: null, sources: [], clipEpochMs: null, lookbackHours: 24,
    possiblyOutOfLookbackRange: false, hasRetainedHistory: false,
    isLoading: false, isError: false, error: null, refetch: vi.fn(),
  }),
}));
vi.mock('../../hooks/useMotionAnalysis', () => ({
  useMotionAnalysis: () => ({ mutate: h.motion, isPending: false }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 7 }),
}));
vi.mock('@/hooks/useOperationalMode', () => ({
  useOperationalMode: () => ({ isReadOnly: false }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatDuration: (value: number | null) => value == null ? '—' : `${value}s` }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtNumber: (value: number) => String(value),
    fmtInt: (value: number) => String(value),
  }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: (value: string | Date | null) => String(value ?? '—') }),
}));
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
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

function clip(): ClipRecord {
  return {
    id: 'retained-front', fileName: '2026-10-05T10-00-00-front.mp4',
    cameraPosition: 'front', cameraRaw: 'front', source: 'SavedClips',
    capturedAtRaw: '2026-10-05T10:00:00', durationSeconds: null,
    sizeBytes: 4, mimeType: 'video/mp4', blob: new Blob(['clip']),
    eventSidecar: null, motion: { status: 'not_run' }, vehicleId: 7,
    eventCandidates: [], redactions: [], notes: '', createdAt: '', updatedAt: '',
  };
}

function renderPage() {
  return render(<MemoryRouter><DashcamIntelligencePage /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.query = { data: [clip()], isLoading: false, error: null, refetch: vi.fn() };
  h.persistent = true;
  h.fallbackReason = null;
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:retained-clip');
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('dashcam retained page and non-summary boundaries', () => {
  it('retains selected local media, source, camera-clock text and controls after catalog refresh failure', () => {
    const current = h.query.data![0];
    const { container, rerender } = renderPage();
    fireEvent.click(screen.getByRole('option'));
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('2026-10-05 10:00:00')).toBeInTheDocument();
    expect(within(screen.getByRole('option')).getByText('Front')).toBeInTheDocument();
    expect(within(screen.getByRole('option')).getByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('— / —')).toBeInTheDocument();
    const video = container.querySelector('video');
    expect(video).toHaveAttribute('src', 'blob:retained-clip');

    h.query = { ...h.query, error: new Error('Local catalog refresh denied'), isError: true };
    rerender(<MemoryRouter><DashcamIntelligencePage /></MemoryRouter>);
    expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeInTheDocument();
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('video')).toBe(video);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Redaction' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Events' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Reconstruction' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Export' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.query.refetch).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Run local motion analysis' }));
    expect(h.motion).toHaveBeenCalledWith(current);
    fireEvent.click(screen.getByRole('button', { name: 'Delete clip' }));
    expect(h.remove).toHaveBeenCalledWith(current.id);
    expect(container.querySelector('[data-operational-brief]')).toBeNull();
  });

  it('keeps import and facet controls on initial catalog failure without claiming an empty successful catalog', () => {
    h.query = { data: undefined, isLoading: false, isError: true, error: new Error('IndexedDB unavailable'), refetch: vi.fn() };
    renderPage();
    expect(screen.getByText('The local clip catalog could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('No clips imported yet')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Video file(s)')).toBeInTheDocument();
    expect(screen.getByLabelText('event.json (optional)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 0 clip(s)' })).toBeDisabled();
    expect(screen.getByRole('group', { name: 'Camera' })).toBeInTheDocument();
    expect(screen.getByText('No clip selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.query.refetch).toHaveBeenCalledOnce();
  });

  it('does not remove selected playback or local actions when catalog refresh is paused offline', () => {
    const { container, rerender } = renderPage();
    fireEvent.click(screen.getByRole('option'));
    const video = container.querySelector('video');
    h.query = { ...h.query, fetchStatus: 'paused', isFetching: false };
    rerender(<MemoryRouter><DashcamIntelligencePage /></MemoryRouter>);
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('video')).toBe(video);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run local motion analysis' })).toBeEnabled();
    expect(screen.getByLabelText('Video file(s)')).toBeInTheDocument();
    expect(screen.queryByText('No clips imported yet')).not.toBeInTheDocument();
  });

  it('keeps filtered-empty distinct from successful-empty and restores the catalog through clear filters', async () => {
    const { rerender } = renderPage();
    fireEvent.change(screen.getByPlaceholderText('Search filename or notes…'), { target: { value: 'no match' } });
    expect(await screen.findByText('No clips match these filters')).toBeInTheDocument();
    expect(screen.queryByText('No clips imported yet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('option')).toBeInTheDocument();
    h.query = { ...h.query, data: [] };
    rerender(<MemoryRouter><DashcamIntelligencePage /></MemoryRouter>);
    expect(screen.getByText('No clips imported yet')).toBeInTheDocument();
    expect(screen.queryByText('No clips match these filters')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Video file(s)')).toBeInTheDocument();
    expect(screen.getByText('No clip selected')).toBeInTheDocument();
  });

  it('retains memory-only storage disclosure during loading and does not substitute recording or live-stream KPIs', () => {
    h.persistent = false;
    h.fallbackReason = 'IndexedDB permission denied';
    h.query = { data: undefined, isLoading: true, refetch: vi.fn() };
    const { container, rerender } = renderPage();
    expect(screen.getByText(/imported clips will be lost when this tab closes/)).toHaveTextContent('IndexedDB permission denied');
    expect(screen.getByRole('status', { name: 'Loading Dashcam & Sentry intelligence' })).toBeInTheDocument();
    expect(screen.getByLabelText('Video file(s)')).toBeInTheDocument();
    h.query = { ...h.query, data: [clip()], isLoading: false };
    rerender(<MemoryRouter><DashcamIntelligencePage /></MemoryRouter>);
    expect(screen.getByText(/imported clips will be lost when this tab closes/)).toBeInTheDocument();
    expect(within(screen.getByRole('listbox', { name: 'Imported clips' })).getByRole('option')).toBeInTheDocument();
    expect(container.querySelector('[data-operational-brief]')).toBeNull();
  });
});
