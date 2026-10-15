import type { ComponentProps } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatMetric } from '@/components/data-display';
import { buildDrivingRhythm } from '../../lib/drivingRhythm';
import type { NestedDrivingBrief } from '../operationalbrief-a-m/NestedDrivingBrief';
import { RhythmCoverageSummary } from './RhythmCoverageSummary';
import source from './RhythmCoverageSummary.tsx?raw';

const { capture } = vi.hoisted(() => ({
  capture: vi.fn<(props: ComponentProps<typeof NestedDrivingBrief>) => void>(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values?.[key] ?? '')),
  }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { locale: 'en-US' } }),
}));
vi.mock('../operationalbrief-a-m/NestedDrivingBrief', () => ({
  NestedDrivingBrief: (props: ComponentProps<typeof NestedDrivingBrief>) => {
    capture(props);
    return <div>{props.title}</div>;
  },
}));

afterEach(() => {
  cleanup();
  capture.mockClear();
});

const state = { isLoading: false, retained: false, error: null, onRetry: vi.fn() };
const emptySummary = buildDrivingRhythm([], {
  timeZone: 'UTC',
  nowMs: Date.parse('2026-08-08T12:00:00Z'),
});

describe('RhythmCoverageSummary', () => {
  it('uses the public data-display type export without a deep import', () => {
    expect(source).toContain("import type { StatMetric } from '@/components/data-display';");
    expect(source).not.toContain('@/components/data-display/');
  });

  it('preserves all populated coverage operands and the included span', () => {
    render(<RhythmCoverageSummary summary={{
      ...emptySummary,
      observed: 7,
      total: 4,
      invalidTimestampCount: 2,
      futureTimestampCount: 1,
      distanceMeasuredDrives: 3,
      firstStartTs: '2026-08-01T08:00:00Z',
      lastStartTs: '2026-08-07T09:00:00Z',
    }} state={state} />);

    const metrics: StatMetric[] = [
      { metricId: 'count', occurrenceId: 'returned', rawValue: 7, label: 'Rows returned' },
      { metricId: 'count', occurrenceId: 'included', rawValue: 4, label: 'Valid starts included' },
      { metricId: 'count', occurrenceId: 'invalid', rawValue: 2, label: 'Invalid timestamps' },
      { metricId: 'count', occurrenceId: 'future', rawValue: 1, label: 'Future timestamps' },
    ];
    expect(capture).toHaveBeenLastCalledWith(expect.objectContaining({
      metrics,
      loading: false,
      unavailable: false,
      retained: false,
      period: expect.objectContaining({
        kind: 'unknown',
        label: '2026-08-01T08:00:00Z – 2026-08-07T09:00:00Z · UTC',
      }),
    }));
    expect(screen.getByText(/Included span:.*distance available for 3 of 4 included drives\./))
      .toBeInTheDocument();
    expect(screen.getByText(/All 7 drives in the selected dates/)).toBeInTheDocument();
    expect(screen.queryByText(/Coverage will appear/)).not.toBeInTheDocument();
  });

  it.each([
    [0, 'Coverage will appear when the selected date scope returns drives.'],
    [2, 'Returned rows were accounted for, but none had an eligible non-future start.'],
  ])('preserves empty coverage messaging for %i returned rows', (observed, message) => {
    render(<RhythmCoverageSummary summary={{ ...emptySummary, observed }} state={state} />);
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByText('Observed-history coverage')).toBeInTheDocument();
    expect(screen.queryByText(/Included span:/)).not.toBeInTheDocument();
  });

  it('preserves loading, unavailable, and retained source flags', () => {
    render(<RhythmCoverageSummary summary={emptySummary} state={{
      ...state, isLoading: true, retained: true, error: new Error('Unavailable'),
    }} />);
    expect(capture).toHaveBeenLastCalledWith(expect.objectContaining({
      loading: true, unavailable: true, retained: true,
    }));
  });
});
