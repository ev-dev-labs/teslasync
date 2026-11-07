import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import type { VehicleStateSummaryRow } from '@/api/hooks/useAnalytics';
import type { TimelineEvent } from '@/types/analytics';
import { fmtNumber } from '@/lib/numberFormat';
import StateTimelineWidget from './StateTimelineWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import type { WidgetSize } from './types';

type QueryFixture<T> = DataStateSource<T> & {
  refetch: () => Promise<void>;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
};

const mocks = vi.hoisted(() => ({
  summary: vi.fn<(id: string, range: { start?: string; end?: string }) => QueryFixture<VehicleStateSummaryRow[]>>(),
  timeline: vi.fn<(id: string) => QueryFixture<TimelineEvent[]>>(),
  vehicles: vi.fn<() => { data: { id: number }[] }>(),
  refreshSummary: vi.fn<() => Promise<void>>(),
  refreshTimeline: vi.fn<() => Promise<void>>(),
}));

vi.mock('@/api/hooks/useAnalytics', () => ({
  useStateSummary: mocks.summary,
  useTimeline: mocks.timeline,
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: mocks.vehicles }));
vi.mock('@/hooks/useTimeFormatPreference', () => ({
  useTimeFormatPreference: () => 'absolute',
}));
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const { createInstance } = await vi.importActual<typeof import('i18next')>('i18next');
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } });
  return { ...actual, useTranslation: () => ({ t: i18n.getFixedT('en'), i18n }) };
});

const packs = [
  ['v1', 'studio'], ['v2', 'elevated'], ['v3', 'precision'], ['v4', 'owner'],
  ['v5', 'iconic'], ['v6', 'expressive'], ['v7', 'pixel'],
] as const;
const wide: WidgetSize = { cols: 3, rows: 3 };
const full: WidgetSize = { cols: 2, rows: 2 };
const compact: WidgetSize = { cols: 1, rows: 2 };
const coverageNote = 'Percentages reflect returned observations, not necessarily every hour.';
const summaryLabel = 'driving: 3h 0m, 75%; idle: 1h 0m, 25%';
const summaryRows: VehicleStateSummaryRow[] = [
  { state: 'driving', total_seconds: 10_800, percentage: 75, transition_count: 3 },
  { state: 'idle', total_seconds: 3_600, percentage: 25, transition_count: 1 },
];
const timelineRows: TimelineEvent[] = [
  { id: 'drive', state: 'driving', startDate: '2026-11-06T08:00:00Z', durationMin: 100 },
  { id: 'short-sleep', state: 'asleep', startDate: '2026-11-06T09:40:00Z', durationMin: 0.1 },
  { id: 'charge', state: 'charging', startDate: '2026-11-06T09:40:06Z', durationMin: 50 },
];

function query<T>(
  data: T | undefined,
  refetch: () => Promise<void>,
  overrides: Partial<QueryFixture<T>> = {},
): QueryFixture<T> {
  return {
    data, refetch, error: null, isError: false, isLoading: false, isFetching: false,
    isStale: false, isPending: false, fetchStatus: 'idle', dataUpdatedAt: Date.now(),
    ...overrides,
  };
}

function tree(requestedPackId?: unknown, size = wide, vehicleId?: number) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={requestedPackId}>
        <StateTimelineWidget vehicleId={vehicleId} size={size} />
      </PackBoundary>
    </MemoryRouter>
  );
}

async function presentation(container: HTMLElement, appearance: string) {
  return waitFor(() => {
    const element = container.querySelector<HTMLElement>(
      `[data-widget-family="segments"][data-widget-appearance="${appearance}"]`,
    );
    if (!element) throw new Error('The requested state composition presentation has not loaded');
    return element;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.refreshSummary.mockResolvedValue(undefined);
  mocks.refreshTimeline.mockResolvedValue(undefined);
  mocks.vehicles.mockReturnValue({ data: [{ id: 7 }] });
  mocks.summary.mockReturnValue(query(summaryRows, mocks.refreshSummary));
  mocks.timeline.mockReturnValue(query(timelineRows, mocks.refreshTimeline));
});

describe.each(packs)('StateTimelineWidget %s / %s', (packId, appearance) => {
  it('retains the actual duration headline, every summary segment, transition evidence and refresh action', async () => {
    const { container } = render(tree(packId, wide, 42));
    const selected = await presentation(container, appearance);
    expect(screen.getAllByRole('heading', { name: 'State timeline', level: 3 })).toHaveLength(1);
    expect(within(selected).getByText(coverageNote)).toBeInTheDocument();
    expect(within(selected).getAllByText('3h 0m')).toHaveLength(2);
    expect(within(selected).queryByRole('meter')).not.toBeInTheDocument();
    expect(within(selected).queryByRole('progressbar')).not.toBeInTheDocument();

    const composition = within(selected).getByRole('img', { name: summaryLabel });
    expect(composition.children).toHaveLength(2);
    expect((composition.children[0] as HTMLElement).style.width).toBe('75%');
    expect((composition.children[1] as HTMLElement).style.width).toBe('25%');
    const summaryList = within(selected).getAllByRole('list').find(list =>
      within(list).queryByText('3h 0m') != null);
    expect(summaryList).toBeDefined();
    const rows = within(summaryList!).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('driving');
    expect(rows[0]).toHaveTextContent('3h 0m');
    expect(rows[0]).toHaveTextContent('75.00%');
    expect(rows[1]).toHaveTextContent('idle');
    expect(rows[1]).toHaveTextContent('1h 0m');
    expect(rows[1]).toHaveTextContent('25.00%');

    const timeline = within(selected).getByRole('img', { name: /Vehicle state transitions over the last 24 hours/ });
    expect(timeline).toHaveAccessibleName(
      `Vehicle state transitions over the last 24 hours: driving: ${fmtNumber(100)} min; asleep: ${fmtNumber(0.1)} min; charging: ${fmtNumber(50)} min`,
    );
    expect(timeline.children).toHaveLength(2);
    expect(Number.parseFloat((timeline.children[0] as HTMLElement).style.width)).toBeCloseTo(100 / 150.1 * 100);
    expect(Number.parseFloat((timeline.children[1] as HTMLElement).style.width)).toBeCloseTo(50 / 150.1 * 100);
    expect(within(selected).getByText('Last 24 hours')).toBeInTheDocument();
    expect(within(selected).getByText(/asleep 0.1 min/)).toBeInTheDocument();
    expect(mocks.summary).toHaveBeenCalledTimes(1);
    expect(mocks.timeline).toHaveBeenCalledTimes(1);
    expect(mocks.summary).toHaveBeenLastCalledWith('42', {
      start: expect.any(String), end: expect.any(String),
    });
    expect(mocks.timeline).toHaveBeenLastCalledWith('42');
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(mocks.refreshSummary).toHaveBeenCalledOnce();
    expect(mocks.refreshTimeline).toHaveBeenCalledOnce();
    if (appearance === 'pixel') expect(selected.querySelector('.lucide-clock')).toBeInTheDocument();
  });

  it('keeps every compact fill and the five-cell legend policy without adding a full list or wide stripe', async () => {
    mocks.summary.mockReturnValue(query(
      ['driving', 'charging', 'asleep', 'idle', 'offline', 'unlisted'].map(state => ({
        state, total_seconds: 600, percentage: 100 / 6, transition_count: 1,
      })),
      mocks.refreshSummary,
    ));
    const { container } = render(tree(packId, compact));
    const selected = await presentation(container, appearance);
    expect(within(selected).getByRole('img').children).toHaveLength(6);
    expect(within(selected).queryByRole('list')).not.toBeInTheDocument();
    for (const state of ['driving', 'charging', 'asleep', 'idle', 'offline']) {
      expect(within(selected).getAllByText(state).length).toBeGreaterThan(0);
    }
    expect(within(selected).queryByText('unlisted')).not.toBeInTheDocument();
    expect(within(selected).getByTitle('unlisted: 17%')).toBeInTheDocument();
    expect(within(selected).queryByText('Last 24 hours')).not.toBeInTheDocument();
    expect(mocks.summary).toHaveBeenLastCalledWith('7', expect.objectContaining({
      start: expect.any(String), end: expect.any(String),
    }));
  });

  it('keeps invalid observations empty instead of inventing a zero duration or a 0..100 meter', async () => {
    mocks.summary.mockReturnValue(query([
      { state: 'driving', total_seconds: Number.NaN, percentage: 75, transition_count: 1 },
      { state: 'idle', total_seconds: 3600, percentage: 101, transition_count: 1 },
    ], mocks.refreshSummary));
    mocks.timeline.mockReturnValue(query([], mocks.refreshTimeline));
    const { container } = render(tree(packId, full));
    const selected = await presentation(container, appearance);
    const message = within(selected).getByText('No state data available');
    expect(message).toBeVisible();
    expect(within(selected).getByText(coverageNote)).toBeInTheDocument();
    expect(within(selected).queryByRole('img')).not.toBeInTheDocument();
    expect(within(selected).queryByRole('meter')).not.toBeInTheDocument();
    expect(within(selected).queryByText('0m')).not.toBeInTheDocument();
    expect(within(selected).queryByText('NaN')).not.toBeInTheDocument();
    const empty = message.closest<HTMLElement>('[role="status"]');
    expect(empty).not.toBeNull();
    fireEvent.click(within(empty!).getByRole('button', { name: 'Refresh' }));
    expect(mocks.refreshSummary).toHaveBeenCalledOnce();
    expect(mocks.refreshTimeline).toHaveBeenCalledOnce();
  });

  it('keeps summary history when transitions fail and retries only the affected section', async () => {
    mocks.timeline.mockReturnValue(query<TimelineEvent[]>(undefined, mocks.refreshTimeline, {
      isError: true, error: new Error('Transition source failed'),
    }));
    const { container } = render(tree(packId));
    const selected = await presentation(container, appearance);
    expect(within(selected).getByRole('img', { name: summaryLabel })).toBeVisible();
    const alert = within(selected).getByRole('alert');
    fireEvent.click(within(alert).getByRole('button'));
    expect(mocks.refreshTimeline).toHaveBeenCalledOnce();
    expect(mocks.refreshSummary).not.toHaveBeenCalled();
    expect(screen.getByTestId('stale-refresh-warning')).toBeVisible();
  });

  it('keeps transitions when summary history fails without inventing a headline', async () => {
    mocks.summary.mockReturnValue(query<VehicleStateSummaryRow[]>(undefined, mocks.refreshSummary, {
      isError: true, error: new Error('Summary source failed'),
    }));
    const { container } = render(tree(packId));
    const selected = await presentation(container, appearance);
    expect(within(selected).getByRole('img', { name: /Vehicle state transitions over the last 24 hours/ })).toBeVisible();
    expect(within(selected).queryByText('0m')).not.toBeInTheDocument();
    const alert = within(selected).getByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(mocks.refreshSummary).toHaveBeenCalledOnce();
    expect(mocks.refreshTimeline).not.toHaveBeenCalled();
  });

  it('retains both source plots and trust warnings after a background refresh failure', async () => {
    mocks.summary.mockReturnValue(query(summaryRows, mocks.refreshSummary, {
      isError: true, isStale: true, error: new Error('Summary refresh failed'),
    }));
    mocks.timeline.mockReturnValue(query(timelineRows, mocks.refreshTimeline, {
      isError: true, isStale: true, error: new Error('Transition refresh failed'),
    }));
    const { container } = render(tree(packId));
    const selected = await presentation(container, appearance);
    expect(within(selected).getAllByRole('img')).toHaveLength(2);
    expect(within(selected).getByRole('img', { name: summaryLabel })).toBeVisible();
    expect(screen.getByTestId('stale-refresh-warning')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(mocks.refreshSummary).toHaveBeenCalledOnce();
    expect(mocks.refreshTimeline).toHaveBeenCalledOnce();
  });
});

it.each([undefined, 'classic', 'not-a-pack'])('preserves Classic for %s without introducing a pack headline, note or scale', requested => {
  const { container } = render(tree(requested));
  expect(container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: summaryLabel })).toBeInTheDocument();
  expect(screen.getAllByText('3h 0m')).toHaveLength(1);
  expect(screen.getByText('Last 24 hours')).toBeInTheDocument();
  expect(screen.queryByText(coverageNote)).not.toBeInTheDocument();
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
});

it('preserves the same source readings while changing packs and returning to Classic', async () => {
  const view = render(tree('classic', full, 42));
  for (const [packId, appearance] of packs) {
    view.rerender(tree(packId, full, 42));
    const selected = await presentation(view.container, appearance);
    expect(within(selected).getByRole('img', { name: summaryLabel })).toBeInTheDocument();
    expect(mocks.summary).toHaveBeenLastCalledWith('42', expect.any(Object));
    expect(mocks.timeline).toHaveBeenLastCalledWith('42');
  }
  view.rerender(tree('classic', full, 42));
  expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: summaryLabel })).toBeInTheDocument();
  expect(mocks.refreshSummary).not.toHaveBeenCalled();
  expect(mocks.refreshTimeline).not.toHaveBeenCalled();
});

it('keeps a measured zero distinct from an absent observation', async () => {
  mocks.summary.mockReturnValue(query([
    { state: 'driving', total_seconds: 0, percentage: 0, transition_count: 0 },
    { state: 'idle', total_seconds: 3600, percentage: 100, transition_count: 1 },
  ], mocks.refreshSummary));
  const { container } = render(tree('v7', full));
  const selected = await presentation(container, 'pixel');
  expect(within(selected).getAllByText('0m')).toHaveLength(2);
  expect(within(selected).getByRole('img', { name: 'driving: 0m, 0%; idle: 1h 0m, 100%' })).toBeInTheDocument();
});

it('retains loading and fatal source recovery instead of presenting a successful empty reading', () => {
  mocks.summary.mockReturnValue(query<VehicleStateSummaryRow[]>(undefined, mocks.refreshSummary, {
    isLoading: true,
  }));
  mocks.timeline.mockReturnValue(query<TimelineEvent[]>(undefined, mocks.refreshTimeline, {
    isLoading: true,
  }));
  const view = render(tree('v3'));
  expect(screen.getByRole('heading', { name: 'State timeline' })).toBeVisible();
  expect(view.container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  expect(screen.queryByText('No state data available')).not.toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  mocks.summary.mockReturnValue(query<VehicleStateSummaryRow[]>(undefined, mocks.refreshSummary, {
    isError: true, error: new Error('Summary unavailable'),
  }));
  mocks.timeline.mockReturnValue(query<TimelineEvent[]>(undefined, mocks.refreshTimeline, {
    isError: true, error: new Error('Transitions unavailable'),
  }));
  view.rerender(tree('v3'));
  expect(screen.getByRole('alert')).toBeVisible();
  expect(screen.queryByText('No state data available')).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('alert')).getByRole('button'));
  expect(mocks.refreshSummary).toHaveBeenCalledOnce();
  expect(mocks.refreshTimeline).toHaveBeenCalledOnce();
});

it('keeps independently loading summary and transition sections distinct from empty history', async () => {
  mocks.summary.mockReturnValue(query<VehicleStateSummaryRow[]>(undefined, mocks.refreshSummary, {
    isLoading: true,
  }));
  const view = render(tree('v1'));
  let selected = await presentation(view.container, 'studio');
  expect(within(selected).getByText('Last 24 hours')).toBeInTheDocument();
  expect(within(selected).queryByText('No state data available')).not.toBeInTheDocument();
  expect(selected.querySelector('[class*="--skeleton-bg"]')).toBeInTheDocument();

  mocks.summary.mockReturnValue(query(summaryRows, mocks.refreshSummary));
  mocks.timeline.mockReturnValue(query<TimelineEvent[]>(undefined, mocks.refreshTimeline, {
    isLoading: true,
  }));
  view.rerender(tree('v1'));
  selected = await presentation(view.container, 'studio');
  expect(within(selected).getByRole('img', { name: summaryLabel })).toBeVisible();
  expect(within(selected).queryByText('No state data available')).not.toBeInTheDocument();
  expect(selected.querySelector('[class*="--skeleton-bg"]')).toBeInTheDocument();
});

it('retains fleet discovery navigation when there is no selected or discovered vehicle', async () => {
  mocks.vehicles.mockReturnValue({ data: [] });
  mocks.summary.mockReturnValue(query([], mocks.refreshSummary));
  mocks.timeline.mockReturnValue(query([], mocks.refreshTimeline));
  const { container } = render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={
          <PackBoundary requestedPackId="v4"><StateTimelineWidget size={full} /></PackBoundary>
        } />
        <Route path="/vehicles" element={<div>Fleet destination</div>} />
      </Routes>
    </MemoryRouter>,
  );
  await presentation(container, 'owner');
  fireEvent.click(screen.getByRole('link', { name: 'Fleet' }));
  expect(screen.getByText('Fleet destination')).toBeInTheDocument();
  expect(mocks.summary).toHaveBeenLastCalledWith('', expect.any(Object));
  expect(mocks.timeline).toHaveBeenLastCalledWith('');
});
