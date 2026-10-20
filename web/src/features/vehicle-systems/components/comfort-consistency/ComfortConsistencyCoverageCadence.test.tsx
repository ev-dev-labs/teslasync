import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { formatDateTime } from '@/lib/dateFormat';
import { formatMetric } from '@/lib/metric-reference/formatMetric';
import type { MetricPreferences } from '@/lib/metric-reference/types';
import { summarizeComfortConsistency } from '../../lib/comfortConsistency';
import { ComfortConsistencyCoverageCadence } from './ComfortConsistencyCoverageCadence';
import type { ComfortConsistencyQueryState } from './types';

const h = vi.hoisted(() => ({
  locale: 'de-DE',
  tz: 'America/New_York',
  dates: vi.fn<(value: Date) => void>(),
  metrics: [] as readonly StatMetric[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, string>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values?.[key] ?? ''),
  }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    tz: h.tz,
    formatDateTime: (value: Date) => {
      h.dates(value);
      return formatDateTime(value, { locale: h.locale, tz: h.tz });
    },
  }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtPercent: (value: number) => `${value}%`,
    fmtInt: (value: number) => String(value),
  }),
}));
vi.mock('@/components/layout', () => ({
  LayoutCard: ({ title, children }: { title: string; children: ReactNode }) =>
    <section aria-label={title}>{children}</section>,
}));
vi.mock('@/components/ui', () => ({
  Text: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

const preferences: MetricPreferences = {
  units: {
    distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
    energy: 'kWh', duration: 's', power: 'kW', locale: 'en-US', precision: 2,
  },
  currency: { kind: 'symbol', value: '$' },
};

vi.mock('../operationalbrief-all/VehicleOperationalBrief', () => ({
  VehicleOperationalBrief: ({ metrics }: { metrics: readonly StatMetric[] }) => {
    h.metrics = metrics;
    return <div>{metrics.map(metric =>
      <span key={metric.occurrenceId} data-testid={metric.occurrenceId}>
        {formatMetric(metric.metricId, metric.rawValue, preferences, undefined, metric.display).text}
      </span>,
    )}</div>;
  },
}));

const earliest = Date.parse('2026-01-01T00:15:00Z');
const latest = earliest + 300_000;
const state: ComfortConsistencyQueryState = {
  vehicleSelected: true, isLoading: false, isResolved: true,
  error: null, refreshError: null, onRetry: vi.fn(),
};
const summary = () => summarizeComfortConsistency([earliest, latest].map(ms => ({
  timestamp: new Date(ms).toISOString(),
  insideTemp: 21, driverTempSetting: 21, passengerTempSetting: 21, hvacPower: true,
})));
const duration = (seconds: number | null | undefined) => `${seconds} seconds`;

afterEach(cleanup);
beforeEach(() => {
  h.locale = 'de-DE';
  h.tz = 'America/New_York';
  h.dates.mockClear();
  h.metrics = [];
});

describe('ComfortConsistencyCoverageCadence', () => {
  it('uses effective locale and zone without changing source instants or populated cadence facts', () => {
    const data = summary();
    const { rerender } = render(
      <ComfortConsistencyCoverageCadence summary={data} state={state} locale="en-US" formatDuration={duration} />,
    );
    for (const [id, ms] of [['earliest', earliest], ['latest', latest]] as const) {
      expect(screen.getByTestId(id)).toHaveTextContent(
        `${formatDateTime(new Date(ms), { locale: h.locale, tz: h.tz })} (${h.tz})`,
      );
      expect(h.metrics.find(metric => metric.occurrenceId === id)?.rawValue).toBe(ms);
    }
    expect(h.dates.mock.calls.map(([date]) => date.getTime())).toEqual([earliest, latest]);
    for (const id of ['span', 'median', 'p90', 'max']) {
      expect(screen.getByTestId(id)).toHaveTextContent('300 seconds');
    }
    expect(screen.getByTestId('state-coverage')).toHaveTextContent('100%');
    expect(screen.getByTestId('gap-pair')).toHaveTextContent('1 / 0');

    h.locale = 'en-GB';
    h.tz = 'Asia/Kolkata';
    rerender(<ComfortConsistencyCoverageCadence summary={data} state={state} locale="en-US" formatDuration={duration} />);
    expect(screen.getByTestId('earliest')).toHaveTextContent(
      `${formatDateTime(new Date(earliest), { locale: h.locale, tz: h.tz })} (${h.tz})`,
    );
    expect(data.coverage.earliestValidMs).toBe(earliest);
    expect(data.coverage.latestValidMs).toBe(latest);
  });

  it('keeps null timestamps missing without invoking the formatter or appending a zone', () => {
    const data = summary();
    data.coverage.earliestValidMs = null;
    data.coverage.latestValidMs = null;
    render(<ComfortConsistencyCoverageCadence summary={data} state={state} locale="en-US" formatDuration={duration} />);
    for (const id of ['earliest', 'latest']) {
      expect(screen.getByTestId(id)).toHaveTextContent(/^—$/);
      expect(h.metrics.find(metric => metric.occurrenceId === id)?.rawValue).toBeNull();
    }
    expect(h.dates).not.toHaveBeenCalled();
    expect(screen.getByTestId('span')).toHaveTextContent('300 seconds');
  });

  it('formats epoch zero as a real instant rather than a missing timestamp', () => {
    const data = summary();
    data.coverage.earliestValidMs = 0;
    render(<ComfortConsistencyCoverageCadence summary={data} state={state} locale="en-US" formatDuration={duration} />);
    expect(screen.getByTestId('earliest')).toHaveTextContent(
      `${formatDateTime(new Date(0), { locale: h.locale, tz: h.tz })} (${h.tz})`,
    );
    expect(h.metrics.find(metric => metric.occurrenceId === 'earliest')?.rawValue).toBe(0);
  });
});
