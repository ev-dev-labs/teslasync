import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import DriveScoreWidget from './DriveScoreWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';
import type { WidgetSize } from './types';

interface ScoreAnalytics {
  avg_efficiency_wh_km?: number | null;
}

interface ScoreQuery extends DataStateSource<ScoreAnalytics | null> {
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  isStale: boolean;
  error: Error | null;
  dataUpdatedAt: number;
  refetch: () => void;
}

const { fleetAnalyticsMock, units } = vi.hoisted(() => ({
  fleetAnalyticsMock: vi.fn<() => ScoreQuery>(),
  units: { distance: 'km' as 'km' | 'mi' },
}));

vi.mock('@/api/hooks/useAnalytics', () => ({ useFleetAnalytics: fleetAnalyticsMock }));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: units.distance } }),
}));

function makeQuery(
  data: ScoreAnalytics | null | undefined,
  overrides: Partial<Omit<ScoreQuery, 'data'>> = {},
): ScoreQuery {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isError: false,
    isStale: false,
    error: null,
    dataUpdatedAt: data ? Date.now() : 0,
    refetch: vi.fn(),
    ...overrides,
  };
}

function widget(packId: PackId, size: WidgetSize = { cols: 1, rows: 2 }) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <DriveScoreWidget size={size} />
      </PackBoundary>
    </MemoryRouter>
  );
}

async function expectPresentation(container: HTMLElement, packId: PackId) {
  expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
  if (packId === 'classic') {
    expect(container.querySelector('[data-instrument-family]')).toBeNull();
  } else {
    await waitFor(() => expect(container.querySelector('[data-instrument-family="ring"]'))
      .toHaveAttribute('data-instrument-appearance', PACK_APPEARANCES[packId]));
  }
}

beforeEach(() => {
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  units.distance = 'km';
  fleetAnalyticsMock.mockReset();
  fleetAnalyticsMock.mockReturnValue(makeQuery({ avg_efficiency_wh_km: 320 }));
});

describe.each(PACK_IDS)('DriveScoreWidget pack %s', packId => {
  it('preserves the score, canonical consumption, display units and refresh command when switching packs and sizes', async () => {
    const analytics = Object.freeze({ avg_efficiency_wh_km: 320 });
    const refetch = vi.fn();
    fleetAnalyticsMock.mockReturnValue(makeQuery(analytics, { refetch }));
    const view = render(widget('classic', { cols: 1, rows: 1 }));

    view.rerender(widget(packId, { cols: 1, rows: 1 }));
    await expectPresentation(view.container, packId);
    expect(screen.getByRole('heading', { name: 'Drive score', level: 3 })).toBeVisible();
    expect(screen.getByText('78')).toBeVisible();
    expect(screen.getByText('/100')).toBeVisible();
    expect(screen.getByText('320 Wh/km Avg')).toBeVisible();
    expect(fleetAnalyticsMock).toHaveBeenLastCalledWith(7);
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledOnce();

    units.distance = 'mi';
    view.rerender(widget(packId));
    await expectPresentation(view.container, packId);
    expect(screen.getByText('78')).toBeVisible();
    expect(screen.getByText('515 Wh/mi Avg')).toBeVisible();
    expect(analytics.avg_efficiency_wh_km).toBe(320);

    fleetAnalyticsMock.mockReturnValue(makeQuery({ avg_efficiency_wh_km: 500 }, { refetch }));
    view.rerender(widget(packId));
    expect(screen.getByText('50')).toBeVisible();
    expect(screen.getByText('805 Wh/mi Avg')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('preserves initial loading, fatal retry, retained-refresh warnings and recovery without blanking the score', async () => {
    const refetch = vi.fn();
    fleetAnalyticsMock.mockReturnValue(makeQuery(undefined, { isLoading: true, isFetching: true, refetch }));
    const view = render(widget(packId));
    const shell = () => view.container.querySelector('[data-widget-pack]');
    expect(shell()).toHaveAttribute('aria-busy', 'true');
    expect(shell()).toHaveAttribute('data-data-state', 'initial');
    expect(screen.queryByText('No drive score yet')).not.toBeInTheDocument();

    const error = new Error('Analytics unavailable');
    fleetAnalyticsMock.mockReturnValue(makeQuery(undefined, { isError: true, error, refetch }));
    view.rerender(widget(packId));
    expect(shell()).toHaveAttribute('data-data-state', 'initialFailure');
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();

    const analytics = Object.freeze({ avg_efficiency_wh_km: 320 });
    fleetAnalyticsMock.mockReturnValue(makeQuery(analytics, { refetch }));
    view.rerender(widget(packId));
    await expectPresentation(view.container, packId);
    expect(screen.getByText('78')).toBeVisible();
    expect(shell()).toHaveAttribute('data-data-state', 'ok');

    fleetAnalyticsMock.mockReturnValue(makeQuery(analytics, { isFetching: true, refetch }));
    view.rerender(widget(packId));
    expect(shell()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('78')).toBeVisible();

    fleetAnalyticsMock.mockReturnValue(makeQuery(analytics, { isError: true, isStale: true, error, refetch }));
    view.rerender(widget(packId));
    expect(shell()).toHaveAttribute('data-data-state', 'stale');
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('Previously loaded data remains visible');
    expect(screen.getByText('78')).toBeVisible();
    expect(screen.getByText('320 Wh/km Avg')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(2);

    fleetAnalyticsMock.mockReturnValue(makeQuery(analytics, { refetch }));
    view.rerender(widget(packId));
    expect(shell()).toHaveAttribute('data-data-state', 'ok');
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByText('78')).toBeVisible();
  });

  it('keeps absent, unknown, zero and invalid consumption distinct from a measured worst score', async () => {
    const view = render(widget(packId));
    await expectPresentation(view.container, packId);
    const unavailable: Array<ScoreAnalytics | null | undefined> = [
      undefined, null, {}, { avg_efficiency_wh_km: null },
      ...[0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]
        .map(avg_efficiency_wh_km => ({ avg_efficiency_wh_km })),
    ];

    for (const analytics of unavailable) {
      fleetAnalyticsMock.mockReturnValue(makeQuery(analytics));
      view.rerender(widget(packId));
      await expectPresentation(view.container, packId);
      expect(screen.getByText('No drive score yet')).toBeVisible();
      expect(screen.getByText('Complete a drive with measured energy and distance to calculate an efficiency score.')).toBeVisible();
      expect(screen.queryByText('/100')).not.toBeInTheDocument();
      expect(screen.queryByText(/NaN|Infinity|Wh\//)).not.toBeInTheDocument();
      expect(view.container.querySelector('[aria-valuenow]')).toBeNull();
    }

    fleetAnalyticsMock.mockReturnValue(makeQuery({ avg_efficiency_wh_km: 125 }));
    view.rerender(widget(packId));
    expect(screen.getByText('100')).toBeVisible();
    expect(screen.getByText('125 Wh/km Avg')).toBeVisible();
    expect(screen.queryByText('No drive score yet')).not.toBeInTheDocument();
  });
});
