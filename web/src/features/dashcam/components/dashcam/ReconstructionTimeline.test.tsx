import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReconstructionTimeline, type ReconstructionTimelineProps } from './ReconstructionTimeline';
import { defaultDashcamSettings } from '../../lib/types';
import { MemoryRouter } from 'react-router-dom';

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
