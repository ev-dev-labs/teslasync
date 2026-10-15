import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveDataState, type DataStateSource } from '@/api/dataState';
import type { SleepEfficiencyData } from '@/types/energy';
import { analyzeSleepEfficiency } from '../../lib/sleepEfficiencyAnalysis';
import { sleepEfficiencyFixture } from './sleepEfficiency.fixture';
import { SleepEvidenceOverview } from './SleepEvidenceOverview';

function Provider({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

function props(source: DataStateSource<SleepEfficiencyData>): ComponentProps<typeof SleepEvidenceOverview> {
  const trust = deriveDataState(source, { provenance: 'historical' });
  return {
    analysis: analyzeSleepEfficiency(source.data, Date.parse('2026-08-07T12:00:00Z'), '2026-08-04', '2026-08-06'),
    trust,
    state: {
      vehicleSelected: true,
      isLoading: Boolean(source.isLoading || source.isFetching),
      isResolved: trust.hasData,
      error: trust.fatalError,
      refreshError: trust.refreshError,
      onRetry: () => { source.refetch?.(); },
    },
  };
}

function metric(container: HTMLElement, id: string) {
  const element = container.querySelector(`[data-operational-metric="${id}"]`);
  expect(element).not.toBeNull();
  return element!;
}

afterEach(cleanup);

describe('SleepEvidenceOverview source trust through the existing evidence adapter', () => {
  it.each([
    ['absent', undefined],
    ['null', null],
    ['invalid collection', {}],
    ['invalid count', [{ state: 'asleep', count: NaN, total_minutes: 0 }]],
    ['infinite count', [{ state: 'asleep', count: Infinity, total_minutes: 0 }]],
    ['null count', [{ state: 'asleep', count: null, total_minutes: 0 }]],
    ['string count', [{ state: 'asleep', count: '0', total_minutes: 0 }]],
    ['negative count', [{ state: 'asleep', count: -1, total_minutes: 0 }]],
    ['fractional count', [{ state: 'asleep', count: 0.5, total_minutes: 0 }]],
    ['missing state', [{ state: '', count: 0, total_minutes: 0 }]],
  ])('withholds transition counts for %s inputs rather than inventing zero', (_label, rows) => {
    const data = Object.assign(sleepEfficiencyFixture(), { state_distribution: rows });
    const view = render(<SleepEvidenceOverview {...props({ data, isSuccess: true })} />, { wrapper: Provider });
    expect(metric(view.container, 'sleep-destinations')).toHaveAttribute('data-value-state', 'missing');
    expect(metric(view.container, 'sleep-asleep-count-share')).toHaveAttribute('data-value-state', 'missing');
  });

  it('preserves supplied zero counts even when other rows are invalid', () => {
    const data = {
      ...sleepEfficiencyFixture(),
      state_distribution: [
        { state: 'asleep', count: 0, total_minutes: 0 },
        { state: 'online', count: -1, total_minutes: 0 },
      ],
    };
    const view = render(<SleepEvidenceOverview {...props({ data, isSuccess: true })} />, { wrapper: Provider });
    expect(metric(view.container, 'sleep-destinations')).toHaveAttribute('data-value-state', 'value');
    expect(metric(view.container, 'sleep-destinations').querySelector('[data-operational-value]')).toHaveTextContent('0');
    expect(metric(view.container, 'sleep-asleep-count-share')).toHaveAttribute('data-value-state', 'missing');
  });

  it('preserves fractional duration evidence and signed source values without changing count validation', () => {
    const data = {
      ...sleepEfficiencyFixture(),
      state_distribution: [
        { state: 'asleep', count: 1, total_minutes: 0.5 },
        { state: 'online', count: 1, total_minutes: 1.5 },
      ],
      time_to_sleep_avg_min: 0.25,
      sentry_comparison: [
        { sentry_mode: true, count: 1, avg_drain_rate: 0.25, avg_duration_hours: 0.5, avg_battery_lost: 0.125, avg_temp: -2.5 },
        { sentry_mode: false, count: 1, avg_drain_rate: 0.5, avg_duration_hours: 0.5, avg_battery_lost: 0.25, avg_temp: -1.5 },
      ],
    };
    const input = props({ data, isSuccess: true });
    const view = render(<SleepEvidenceOverview {...input} />, { wrapper: Provider });
    expect(metric(view.container, 'sleep-duration-efficiency').querySelector('[data-operational-value]')).toHaveTextContent('25');
    expect(metric(view.container, 'sleep-average-time-to-sleep').querySelector('[data-operational-value]')).toHaveTextContent('0.25');
    expect(input.analysis.sentry.drainRateDifference).toBe(-0.25);
    expect(input.analysis.sentry.on.avgTempC).toBe(-2.5);
    expect(metric(view.container, 'sleep-sentry-comparison')).toHaveAttribute('data-value-state', 'value');
  });

  it('distinguishes active loading from paused without data and preserves all metric shells', () => {
    const view = render(<SleepEvidenceOverview {...props({ isLoading: true, isFetching: true, fetchStatus: 'fetching' })} />,
      { wrapper: Provider });
    expect(screen.getByRole('status', { name: 'Loading sleep evidence' })).toBeInTheDocument();
    expect(screen.getByText('Loading source evidence')).toBeVisible();
    expect(view.container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(view.container.querySelectorAll('[data-operational-metric]')).toHaveLength(7);
    expect(metric(view.container, 'sleep-destinations')).toHaveAttribute('data-value-state', 'missing');

    view.rerender(<SleepEvidenceOverview {...props({ isLoading: true, fetchStatus: 'paused' })} />);
    expect(screen.queryByText('Loading source evidence')).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-operational-brief]')).not.toHaveAttribute('aria-busy');
    expect(screen.getByText(/Sleep evidence has not loaded because the request is paused/)).toBeVisible();
    expect(metric(view.container, 'sleep-destinations')).toHaveAttribute('data-value-state', 'missing');
    expect(screen.queryByText('Retained source evidence')).not.toBeInTheDocument();
  });

  it('keeps successful empty responses and measured zero distinct from missing evidence', () => {
    const data = {
      ...sleepEfficiencyFixture(),
      state_distribution: [],
      sentry_comparison: [],
      recent_events: [],
      total_events: 0,
      battery_capacity_wh: NaN,
      base_cost_per_kwh: NaN,
    };
    const view = render(<SleepEvidenceOverview {...props({ data, isSuccess: true })} />, { wrapper: Provider });
    expect(metric(view.container, 'sleep-destinations')).toHaveAttribute('data-value-state', 'value');
    expect(metric(view.container, 'sleep-destinations').querySelector('[data-operational-value]')).toHaveTextContent('0');
    expect(metric(view.container, 'sleep-asleep-count-share')).toHaveAttribute('data-value-state', 'missing');
    expect(metric(view.container, 'sleep-duration-efficiency')).toHaveAttribute('data-value-state', 'missing');
    expect(screen.getByText('Source readings unavailable')).toBeVisible();
    expect(screen.queryByText('Retained source evidence')).not.toBeInTheDocument();

    view.rerender(<SleepEvidenceOverview {...props({
      data: { ...data, state_distribution: [{ state: 'online', count: 2, total_minutes: 0 }] },
      isSuccess: true,
    })} />);
    expect(metric(view.container, 'sleep-asleep-count-share')).toHaveAttribute('data-value-state', 'value');
    expect(metric(view.container, 'sleep-asleep-count-share').querySelector('[data-operational-value]')).toHaveTextContent('0');
    expect(screen.getByText('Available source readings')).toBeVisible();
  });

  it('preserves the payload through refresh failure, pause, active refresh and recovery including review details', () => {
    const data = sleepEfficiencyFixture();
    const before = structuredClone(data);
    const view = render(<SleepEvidenceOverview {...props({ data, isSuccess: true })} />, { wrapper: Provider });
    const readings = () => Array.from(view.container.querySelectorAll('[data-operational-value]'), node => node.textContent);
    const originalReadings = readings();
    view.rerender(<SleepEvidenceOverview {...props({ data, isError: true, error: new Error('private transport detail') })} />);
    expect(readings()).toEqual(originalReadings);
    expect(screen.getByText('Retained source evidence')).toBeVisible();
    expect(screen.getByText(/Sleep evidence could not refresh/)).toBeVisible();
    expect(screen.queryByTestId('sleep-query-initial-error')).not.toBeInTheDocument();
    expect(screen.queryByText('private transport detail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getAllByText(/Sleep evidence could not refresh/).length).toBeGreaterThan(0);
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close', exact: true })[0]);

    view.rerender(<SleepEvidenceOverview {...props({ data, fetchStatus: 'paused' })} />);
    expect(screen.getByText(/Refresh paused/)).toBeVisible();
    expect(screen.getByText('Retained source evidence')).toBeVisible();
    expect(readings()).toEqual(originalReadings);
    view.rerender(<SleepEvidenceOverview {...props({ data, isFetching: true, fetchStatus: 'fetching' })} />);
    expect(screen.queryByText('Loading source evidence')).not.toBeInTheDocument();
    expect(readings()).toEqual(originalReadings);
    view.rerender(<SleepEvidenceOverview {...props({ data, isSuccess: true })} />);
    expect(screen.getByText('Available source readings')).toBeVisible();
    expect(screen.queryByText('Retained source evidence')).not.toBeInTheDocument();
    expect(screen.queryByText(/Sleep evidence could not refresh|Refresh paused/)).not.toBeInTheDocument();
    expect(readings()).toEqual(originalReadings);
    expect(data).toEqual(before);
  });
});
