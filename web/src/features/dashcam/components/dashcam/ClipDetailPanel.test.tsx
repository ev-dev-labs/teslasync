import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClipRecord } from '../../lib/types';
import { defaultDashcamSettings } from '../../lib/types';
import { ClipDetailPanel } from './ClipDetailPanel';

const h = vi.hoisted(() => ({
  locale: 'en',
  settings: vi.fn(),
  reconstruction: vi.fn(),
  redaction: vi.fn(),
  events: vi.fn(),
  timeline: vi.fn(),
  manifest: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      const label = typeof fallback === 'string' ? fallback
        : typeof fallback?.defaultValue === 'string' ? fallback.defaultValue : key;
      return h.locale === 'en' ? label : `Translated ${label}`;
    },
  }),
}));
vi.mock('../../hooks/useDashcamSettings', () => ({
  useDashcamSettings: () => h.settings(),
  useUpdateDashcamSettings: () => ({ mutate: vi.fn() }),
}));
vi.mock('../../hooks/useReconstruction', () => ({
  useReconstruction: (...args: unknown[]) => h.reconstruction(...args),
}));
vi.mock('../../hooks/useMotionAnalysis', () => ({
  useMotionAnalysis: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatDuration: (seconds: number) => `${seconds}s` }),
}));
vi.mock('./RedactionEditor', () => ({ RedactionEditor: (props: unknown) => {
  h.redaction(props);
  return <div>Redaction content</div>;
} }));
vi.mock('./EventEvidencePanel', () => ({ EventEvidencePanel: (props: unknown) => {
  h.events(props);
  return <div>Events content</div>;
} }));
vi.mock('./ReconstructionTimeline', () => ({ ReconstructionTimeline: (props: unknown) => {
  h.timeline(props);
  return <div>Reconstruction content</div>;
} }));
vi.mock('./ExportManifestPanel', () => ({ ExportManifestPanel: (props: unknown) => {
  h.manifest(props);
  return <div>Export content</div>;
} }));

const clip: ClipRecord = {
  id: 'local-front', fileName: 'front.mp4', cameraPosition: 'front', cameraRaw: 'front',
  source: 'SavedClips', capturedAtRaw: '2026-10-05T10:00:00', durationSeconds: 60,
  sizeBytes: 1, mimeType: 'video/mp4', blob: new Blob(['clip'], { type: 'video/mp4' }),
  eventSidecar: null, motion: { status: 'not_run' }, eventCandidates: [], redactions: [],
  vehicleId: 4, notes: '', createdAt: '', updatedAt: '',
};
const settings = defaultDashcamSettings();
const result = { reconstruction: { clipId: clip.id }, sources: [], isLoading: false };
const keys = ['player', 'redaction', 'events', 'reconstruction', 'export'] as const;

beforeEach(() => {
  vi.clearAllMocks();
  h.locale = 'en';
  h.settings.mockReturnValue({ data: settings, isLoading: false, isSuccess: true });
  h.reconstruction.mockReturnValue(result);
  let nextUrl = 0;
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => `blob:clip-${++nextUrl}`);
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ClipDetailPanel tab panel linkage', () => {
  it('links each stable key to the active focusable panel and retains populated child inputs', () => {
    render(<ClipDetailPanel clip={clip} vehicleId={4} />);
    const tabs = screen.getAllByRole('tab');
    keys.forEach((key, index) => {
      fireEvent.click(tabs[index]);
      const panel = screen.getByRole('tabpanel');
      expect(tabs[index].id).toMatch(new RegExp(`-tab-${key}$`));
      expect(tabs[index]).toHaveAttribute('aria-selected', 'true');
      expect(tabs[index]).toHaveAttribute('aria-controls', panel.id);
      expect(panel).toHaveAttribute('aria-labelledby', tabs[index].id);
      expect(panel).toHaveAttribute('tabindex', '0');
      if (key === 'player') expect(panel.querySelector('video')).toHaveAttribute('src', 'blob:clip-1');
      else expect(within(panel).getByText(`${key === 'events' ? 'Events' : key[0].toUpperCase() + key.slice(1)} content`)).toBeInTheDocument();
    });
    expect(h.redaction).toHaveBeenCalledWith({ clip });
    expect(h.events).toHaveBeenCalledWith({ clip });
    expect(h.timeline).toHaveBeenCalledWith(expect.objectContaining({
      clip, vehicleId: 4, settings, result, selectedSignals: [],
    }));
    expect(h.manifest).toHaveBeenCalledWith({ clip, reconstruction: result.reconstruction, buildManifest: expect.any(Function) });
    expect(h.reconstruction).toHaveBeenCalledWith(4, clip, settings, []);
  });

  it('keeps IDs independent of translated labels and unique across instances of the same clip', () => {
    const content = <><ClipDetailPanel clip={clip} vehicleId={4} /><ClipDetailPanel clip={clip} vehicleId={4} /></>;
    const { rerender } = render(content);
    const ids = screen.getAllByRole('tab').map(tab => tab.id);
    expect(new Set(ids).size).toBe(10);
    const panelIds = screen.getAllByRole('tabpanel').map(panel => panel.id);
    expect(new Set(panelIds).size).toBe(2);
    h.locale = 'fr';
    rerender(<><ClipDetailPanel clip={clip} vehicleId={4} /><ClipDetailPanel clip={clip} vehicleId={4} /></>);
    expect(screen.getAllByRole('tab').map(tab => tab.id)).toEqual(ids);
    expect(screen.getAllByRole('tabpanel').map(panel => panel.id)).toEqual(panelIds);
    expect(screen.getAllByRole('tab', { name: 'Translated Player' })).toHaveLength(2);
  });

  it('unmounts media when switching away and releases URLs on remount and final cleanup', () => {
    const { container, unmount } = render(<ClipDetailPanel clip={clip} vehicleId={4} />);
    expect(container.querySelectorAll('video')).toHaveLength(1);
    expect(h.redaction).not.toHaveBeenCalled();
    expect(h.timeline).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Events' }));
    expect(container.querySelector('video')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:clip-1');
    fireEvent.click(screen.getByRole('tab', { name: 'Player' }));
    expect(container.querySelector('video')).toHaveAttribute('src', 'blob:clip-2');
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:clip-2');
  });
});
