import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import { neonColorMap, semanticToNeon } from '@/lib/tokens';
import type { ClipRecord } from '../lib/types';
import DashcamIntelligencePage from './DashcamIntelligencePage';

const h = vi.hoisted(() => ({
  query: {} as DataStateSource<ClipRecord[]>,
  persistent: true,
  fallbackReason: null as string | null,
}));

vi.mock('../hooks/useClipCatalog', () => ({
  useClipCatalog: () => h.query,
  useDeleteClip: () => ({ mutate: vi.fn(), error: null }),
  useImportClips: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
}));
vi.mock('../hooks/useDashcamDb', () => ({
  useDashcamDb: () => ({ persistent: h.persistent, fallbackReason: h.fallbackReason }),
}));
vi.mock('../hooks/useDashcamSettings', () => ({
  useDashcamSettings: () => ({ data: undefined }),
  useUpdateDashcamSettings: () => ({ mutate: vi.fn() }),
}));
vi.mock('../hooks/useReconstruction', () => ({
  useReconstruction: () => ({
    reconstruction: null, sources: [], clipEpochMs: null, lookbackHours: 24,
    possiblyOutOfLookbackRange: false, hasRetainedHistory: false,
    isLoading: false, isError: false, error: null, refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useMotionAnalysis', () => ({
  useMotionAnalysis: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 4 }),
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
    id: 'synthetic-local-front', fileName: '2026-10-05T10-00-00-front.mp4',
    cameraPosition: 'front', cameraRaw: 'front', source: 'SavedClips',
    capturedAtRaw: '2026-10-05T10:00:00', durationSeconds: null,
    sizeBytes: 0, mimeType: 'video/mp4', blob: new Blob(),
    eventSidecar: null, motion: { status: 'not_run' }, vehicleId: 4,
    eventCandidates: [], redactions: [], notes: '', createdAt: '', updatedAt: '',
  };
}

function page() {
  return <MemoryRouter><DashcamIntelligencePage /></MemoryRouter>;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.query = { data: [clip()], isLoading: false, error: null, refetch: vi.fn() };
  h.persistent = true;
  h.fallbackReason = null;
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:synthetic-local-clip');
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('DashcamIntelligencePage restrained persistence disclosure', () => {
  it('uses the shared warning role and retains the actual memory-only reason during loading', () => {
    h.persistent = false;
    h.fallbackReason = 'IndexedDB permission denied';
    h.query = { data: undefined, isLoading: true, refetch: vi.fn() };
    render(page());

    const message = screen.getByText(/imported clips will be lost when this tab closes/);
    expect(message).toHaveTextContent(
      'Local storage is not persistent in this browser (IndexedDB permission denied) — imported clips will be lost when this tab closes.',
    );
    const warning = message.closest('[role="status"]');
    expect(warning).toHaveClass(...neonColorMap[semanticToNeon.warning].ring.split(' '));
    expect(warning).not.toHaveClass('border-amber-400/30', 'bg-amber-500/5');
    expect(screen.getByRole('status', { name: 'Loading Dashcam & Sentry intelligence' })).toBeInTheDocument();
    expect(screen.getByLabelText('Video file(s)')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Camera' })).toBeInTheDocument();
    expect(screen.getByText('No clip selected')).toBeInTheDocument();
  });

  it('uses the existing unknown reason without pretending storage is persistent', () => {
    h.persistent = false;
    render(page());
    expect(screen.getByText(/imported clips will be lost when this tab closes/))
      .toHaveTextContent('(unknown reason)');
    expect(screen.getByRole('list', { name: 'Imported clips' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2026-10-05T10-00-00-front\.mp4/ })).toBeInTheDocument();
  });

  it('does not show memory-only disclosure for the persistent adapter', () => {
    h.fallbackReason = 'unused fallback reason';
    render(page());
    expect(screen.queryByText(/imported clips will be lost when this tab closes/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Video file(s)')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Imported clips' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2026-10-05T10-00-00-front\.mp4/ })).toBeInTheDocument();
  });

  it('retains selected playback and all detail destinations through warning and catalog refresh failure', () => {
    const { container, rerender } = render(page());
    fireEvent.click(screen.getByRole('button', { name: /2026-10-05T10-00-00-front\.mp4/ }));
    const video = container.querySelector('video');
    expect(video).toHaveAttribute('src', 'blob:synthetic-local-clip');

    h.persistent = false;
    h.fallbackReason = 'Memory adapter';
    h.query = { ...h.query, error: new Error('Catalog refresh denied'), isError: true };
    rerender(page());

    expect(screen.getByText(/imported clips will be lost when this tab closes/)).toHaveTextContent('Memory adapter');
    expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeInTheDocument();
    expect(container.querySelector('video')).toBe(video);
    expect(screen.getByRole('button', { name: /2026-10-05T10-00-00-front\.mp4/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeInTheDocument();
    for (const name of ['Player', 'Redaction', 'Events', 'Reconstruction', 'Export']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.query.refetch).toHaveBeenCalledOnce();
  });

  it('isolates fatal catalog failure while preserving fallback disclosure, import, filters and detail guidance', () => {
    h.persistent = false;
    h.fallbackReason = 'Storage unavailable';
    h.query = { data: undefined, isLoading: false, isError: true, error: new Error('Catalog unavailable'), refetch: vi.fn() };
    render(page());
    expect(screen.getByText('The local clip catalog could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText(/imported clips will be lost when this tab closes/)).toHaveTextContent('Storage unavailable');
    expect(screen.queryByText('No clips imported yet')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Video file(s)')).toBeInTheDocument();
    expect(screen.getByLabelText('event.json (optional)')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Camera' })).toBeInTheDocument();
    expect(screen.getByText('No clip selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.query.refetch).toHaveBeenCalledOnce();
  });

  it('keeps no-match filters independent of selected detail and restores the full catalog', async () => {
    render(page());
    fireEvent.click(screen.getByRole('button', { name: /2026-10-05T10-00-00-front\.mp4/ }));
    fireEvent.change(screen.getByPlaceholderText('Search filename or notes…'), { target: { value: 'no match' } });
    expect(await screen.findByText('No clips match these filters')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Export' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    const selected = within(screen.getByRole('list', { name: 'Imported clips' })).getByRole('button', { name: /2026-10-05T10-00-00-front\.mp4/ });
    expect(selected).toHaveAttribute('aria-pressed', 'true');
  });
});
