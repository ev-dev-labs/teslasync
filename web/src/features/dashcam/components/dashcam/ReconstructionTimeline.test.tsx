import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReconstructionTimeline, type ReconstructionTimelineProps } from './ReconstructionTimeline';
import { defaultDashcamSettings } from '../../lib/types';
import { MemoryRouter } from 'react-router-dom';
import { deriveDataState } from '@/api/dataState';
import type { SignalHistoryResponse } from '@/types/telemetry';

vi.mock('./SignalPicker', () => ({ SignalPicker: () => null }));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatDuration: (seconds: number) => `${seconds}s` }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtNumber: (value: number) => String(value) }),
}));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
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

function props(): ReconstructionTimelineProps {
  return {
    clip: {
      id: 'clip', fileName: 'clip.mp4', cameraPosition: 'front', cameraRaw: null,
      source: 'SavedClips', capturedAtRaw: '2026-10-05T10:00:00', durationSeconds: 60,
      sizeBytes: 1, mimeType: 'video/mp4', blob: new Blob(), eventSidecar: null,
      motion: { status: 'not_run' }, eventCandidates: [], redactions: [], vehicleId: 1,
      notes: '', createdAt: '', updatedAt: '',
    },
    vehicleId: 1, settings: defaultDashcamSettings(), onUpdateSettings: vi.fn(),
    selectedSignals: ['Speed'], onSelectedSignalsChange: vi.fn(),
    result: {
      clipEpochMs: 1, lookbackHours: 24, isLoading: false, isError: false,
      hasRetainedHistory: true, refetch: vi.fn(async () => {}),
      sources: [],
      error: null, possiblyOutOfLookbackRange: false,
      reconstruction: {
        clipWindow: { startSeconds: 0, endSeconds: 60 },
        reconstructionWindow: { startSeconds: -15, endSeconds: 75 },
        series: [
          {
            signal: 'Speed', coverage: 'partial', gapNotes: ['Recorded gap evidence'],
            points: [
              { atSeconds: -10, timestamp: '2026-10-05T09:59:50Z', value: 0 },
              { atSeconds: 65, timestamp: '2026-10-05T10:01:05Z', value: 6 },
            ],
          },
          { signal: 'Heading', points: [], coverage: 'none', gapNotes: ['No heading samples'] },
        ],
        incidentSequence: [
          { id: 'brake', signal: 'Speed', atSeconds: 10, kind: 'hard_brake', zScore: 4, description: 'Brake evidence' },
          { id: 'turn', signal: 'Heading', atSeconds: 40, kind: 'sharp_turn', zScore: 5, description: 'Turn evidence' },
        ],
        overallQuality: 'partial', qualityNotes: ['No samples'],
      },
    },
  };
}
afterEach(cleanup);

describe('reconstruction read-only event overview adoption', () => {
  it('shows ready zero evidence beside every normalized pending, failed, empty and nonnumeric source', () => {
    const input = props();
    const ready: SignalHistoryResponse = {
      vehicleId: 1, signal: 'Speed', from: '', to: '', count: 1,
      data: [{ timestamp: '2026-10-05T10:00:00Z', valueNum: 0 }],
    };
    const retryFailed = vi.fn();
    input.result.sources = [
      { signal: 'Speed', state: deriveDataState({ data: ready }, { provenance: 'historical' }) },
      { signal: 'Heading', state: deriveDataState<SignalHistoryResponse>({ isPending: true }) },
      { signal: 'Gear', state: deriveDataState<SignalHistoryResponse>({ error: new Error('Gear failed'), refetch: retryFailed }) },
      { signal: 'Temperature', state: deriveDataState({ data: { ...ready, signal: 'Temperature', count: 0, data: [] } }, { unavailable: true }) },
      { signal: 'Mode', state: deriveDataState({ data: { ...ready, signal: 'Mode', data: [{ timestamp: ready.data[0].timestamp, valueStr: 'Park' }] } }) },
      { signal: 'Soc', state: deriveDataState<SignalHistoryResponse>({ isPending: true }) },
      { signal: 'Voltage', state: deriveDataState<SignalHistoryResponse>({ isPending: true }) },
      { signal: 'Current', state: deriveDataState<SignalHistoryResponse>({ isPending: true }) },
    ];
    input.selectedSignals = input.result.sources.map(source => source.signal);
    input.result.isLoading = true;
    input.result.isError = true;
    input.result.error = new Error('Gear failed');
    input.result.reconstruction!.series = [input.result.reconstruction!.series[0]];
    const { container } = render(<ReconstructionTimeline {...input} />);
    expect(Array.from(container.querySelectorAll('[data-signal-source]'), element => element.getAttribute('data-signal-source')))
      .toEqual(['Speed', 'Heading', 'Gear', 'Temperature', 'Mode', 'Soc', 'Voltage', 'Current']);
    const row = (signal: string) => container.querySelector(`[data-signal-source="${signal}"]`) as HTMLElement;
    expect(within(row('Speed')).getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('First: 0 at t=-10s · last: 6 at t=65s')).toBeInTheDocument();
    expect(within(row('Heading')).getByText('Pending')).toBeInTheDocument();
    expect(within(row('Heading')).queryByText(/sample\(s\)/)).toBeNull();
    expect(within(row('Gear')).getByText('Failed')).toBeInTheDocument();
    expect(within(row('Temperature')).getByText('Unavailable')).toBeInTheDocument();
    expect(within(row('Temperature')).queryByText('0 sample(s)')).toBeNull();
    expect(within(row('Mode')).getByText('Ready')).toBeInTheDocument();
    expect(within(row('Mode')).getByText('1 sample(s)')).toBeInTheDocument();
    fireEvent.click(within(row('Gear')).getByRole('button', { name: 'Retry' }));
    expect(retryFailed).toHaveBeenCalledTimes(1);
    expect(input.result.refetch).not.toHaveBeenCalled();
    expect(screen.getByText('Recorded gap evidence')).toBeInTheDocument();
    expect(screen.getByText('Brake evidence')).toBeInTheDocument();
    expect(container.querySelector('[data-timeline-mode="readOnly"]')).not.toBeNull();
  });

  it('keeps source-local retained last success and zero values while retrying only that signal', () => {
    const input = props();
    const retrySpeed = vi.fn();
    const retryHeading = vi.fn();
    const response: SignalHistoryResponse = {
      vehicleId: 1, signal: 'Speed', from: '', to: '', count: 1,
      data: [{ timestamp: '2026-10-05T10:00:00Z', valueNum: 0 }],
    };
    const updatedAt = Date.UTC(2026, 9, 5, 10, 5);
    input.result.sources = [
      { signal: 'Speed', state: deriveDataState({ data: response, error: new Error('Speed refresh failed'), dataUpdatedAt: updatedAt, refetch: retrySpeed }, { provenance: 'historical' }) },
      { signal: 'Heading', state: deriveDataState({ data: { ...response, signal: 'Heading' }, refetch: retryHeading }, { provenance: 'historical' }) },
    ];
    input.result.isError = true;
    input.result.error = new Error('Speed refresh failed');
    const { container } = render(<ReconstructionTimeline {...input} />);
    const speed = container.querySelector('[data-signal-source="Speed"]') as HTMLElement;
    expect(within(speed).getByText('Cached · refresh failed')).toBeInTheDocument();
    expect(within(speed).getByText(`Last updated: ${new Date(updatedAt).toLocaleString()}`)).toBeInTheDocument();
    expect(input.result.sources[0].state.data).toBe(response);
    expect(input.result.sources[0].state.updatedAt).toBe(updatedAt);
    expect(screen.getByText('First: 0 at t=-10s · last: 6 at t=65s')).toBeInTheDocument();
    expect(screen.getByText('Brake evidence')).toBeInTheDocument();
    fireEvent.click(within(speed).getByRole('button', { name: 'Retry' }));
    expect(retrySpeed).toHaveBeenCalledTimes(1);
    expect(retryHeading).not.toHaveBeenCalled();
    expect(input.result.refetch).not.toHaveBeenCalled();
  });

  it('retains signed-window geometry and every incident without fabricated seeking', () => {
    const { container } = render(<ReconstructionTimeline {...props()} />);
    const overview = container.querySelector('[data-timeline-mode="readOnly"]')!;
    expect(screen.queryByRole('slider', { name: /timeline/i })).not.toBeInTheDocument();
    expect(overview.querySelector('[tabindex]')).toBeNull();
    expect(overview.querySelector('[role="slider"]')).toBeNull();
    expect(overview.querySelector('[data-timeline-playhead]')).toBeNull();
    const markers = overview.querySelectorAll('[data-timeline-marker]');
    expect(markers).toHaveLength(4);
    expect(markers[0]).toHaveAttribute('data-marker-id', 'clip-start');
    expect(markers[0]).toHaveAttribute('aria-label', expect.stringContaining('t=0s'));
    expect(markers[0]).toHaveStyle({ left: `${15 / 90 * 100}%` });
    expect(markers[1]).toHaveStyle({ left: `${75 / 90 * 100}%` });
    expect(markers[2]).toHaveAttribute('data-marker-id', 'brake');
    expect(markers[2]).toHaveAttribute('aria-label', expect.stringContaining('Brake evidence'));
    expect(markers[3]).toHaveAttribute('data-marker-id', 'turn');
    expect(markers[3]).toHaveAttribute('aria-label', expect.stringContaining('Turn evidence'));
    expect(screen.getByText('t=-15s')).toBeInTheDocument();
    expect(screen.getByText('t=75s')).toBeInTheDocument();
    expect(screen.getByText('2 sample(s)')).toBeInTheDocument();
    expect(screen.getByText('0 sample(s)')).toBeInTheDocument();
    expect(screen.getByText('First: 0 at t=-10s · last: 6 at t=65s')).toBeInTheDocument();
    expect(screen.getByText('Recorded gap evidence')).toBeInTheDocument();
    expect(screen.getByText('No heading samples')).toBeInTheDocument();
    expect(screen.getByText('Brake evidence')).toBeInTheDocument();
    expect(screen.getByText('Turn evidence')).toBeInTheDocument();
  });

  it('keeps retained evidence visible when history refresh fails', () => {
    const input = props();
    input.result.isError = true;
    input.result.error = new Error('history unavailable');
    render(<ReconstructionTimeline {...input} />);
    expect(screen.getByText('Recorded gap evidence')).toBeInTheDocument();
    expect(screen.getByText('Brake evidence')).toBeInTheDocument();
    expect(screen.getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(input.result.refetch).toHaveBeenCalledOnce();
  });

  it('does not mistake a derived empty reconstruction for retained history on initial failure', () => {
    const input = props();
    input.result.hasRetainedHistory = false;
    input.result.isError = true;
    input.result.error = new Error('first history request failed');
    const { container } = render(<MemoryRouter><ReconstructionTimeline {...input} /></MemoryRouter>);
    expect(container.querySelector('[data-timeline-mode="readOnly"]')).toBeNull();
    expect(screen.queryByText('Brake evidence')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(input.result.refetch).toHaveBeenCalledOnce();
  });

  it('keeps prerequisites explicit without offering a fake event slider', () => {
    const input = props();
    input.clip.capturedAtRaw = null;
    render(<ReconstructionTimeline {...input} />);
    expect(screen.getByText(/did not include a parseable capture time/)).toBeInTheDocument();
    expect(screen.queryByText('Recorded gap evidence')).not.toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });
});
