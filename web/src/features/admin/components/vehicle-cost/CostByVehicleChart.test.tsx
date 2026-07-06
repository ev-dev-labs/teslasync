/**
 * CostByVehicleChart — hero "ingest cost by vehicle" panel contract.
 *
 * The panel renders a horizontal bar chart of estimated ingest bytes per
 * vehicle (heaviest consumer first) and owns its own loading / empty / error
 * states so it never gates the rest of the page. Recharts inside
 * `ResponsiveContainer` gets a 0×0 box in jsdom and never paints the inner
 * SVG, so — like the sibling SmallMultiplesChart / XRayTopFields suites — these
 * tests assert against the always-present panel shell and the four mutually
 * exclusive state branches rather than chart pixels:
 *   - the always-on shell (labelled heading + decorative aria-hidden icon),
 *   - the loading branch (Skeleton, and its "keep stale data" guard),
 *   - the error branch (QueryError alert with a working Retry, taking priority
 *     over both loading and any stale bars),
 *   - the empty branch (a real EmptyState, never a blank panel),
 *   - the data branch (the accessible `role="img"` chart region), and
 *   - null-safety against undefined / null `bars` (the hardening under test).
 *
 * `react-i18next` is stubbed so `t(key, 'Default')` yields the English default;
 * assertions then read against the real copy. `useOnlineStatus` is pinned
 * online so QueryError renders its network `role="alert"` branch with an
 * enabled Retry (mirrors XRayTopFields.test / QueryError.test). Everything
 * else — GlassPanel, PanelTitle, Skeleton, EmptyState, QueryError — renders for
 * real.
 */
import { type ComponentProps, type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

import { CostByVehicleChart } from './CostByVehicleChart';
import type { VehicleCostBar } from './helpers';

function makeBar(overrides: Partial<VehicleCostBar> = {}): VehicleCostBar {
  return {
    vehicle_id: 1,
    name: 'Model 3',
    bytes: 1024,
    rows: 100,
    rate: 5,
    failures: 0,
    ...overrides,
  };
}

type Props = ComponentProps<typeof CostByVehicleChart>;

function renderChart(overrides: Partial<Props> = {}) {
  const onRetry = overrides.onRetry ?? vi.fn();
  const props: Props = {
    bars: [],
    loading: false,
    error: null,
    ...overrides,
    onRetry,
  };
  const utils = render(
    <MemoryRouter>
      <CostByVehicleChart {...props} />
    </MemoryRouter>,
  );
  return { ...utils, onRetry };
}

const HEADING = /ingest cost by vehicle/i;
const CHART_LABEL = /horizontal bar chart of estimated ingest bytes/i;
const EMPTY_COPY = /no ingest volume recorded in this window yet/i;

describe('CostByVehicleChart — panel shell', () => {
  it('always renders the labelled heading and a decorative (aria-hidden) icon while loading', () => {
    const { container } = renderChart({ loading: true });

    expect(
      screen.getByRole('heading', { name: HEADING }),
    ).toBeInTheDocument();
    // The lucide title icon is decorative and hidden from assistive tech.
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('keeps the heading even when there is no data to show', () => {
    renderChart({ bars: [] });
    expect(
      screen.getByRole('heading', { name: HEADING }),
    ).toBeInTheDocument();
  });
});

describe('CostByVehicleChart — loading', () => {
  it('renders a skeleton and no chart / empty / error while loading with no data', () => {
    const { container } = renderChart({ loading: true, bars: [] });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    // Loading-with-no-data strictly precedes the empty and data branches.
    expect(screen.queryByRole('img', { name: CHART_LABEL })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the chart (not a skeleton) when refetching over existing bars', () => {
    // `loading && items.length === 0` gates the skeleton, so non-empty bars
    // suppress it and the panel updates progressively instead of flashing.
    const { container } = renderChart({
      loading: true,
      bars: [makeBar()],
    });

    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(
      screen.getByRole('img', { name: CHART_LABEL }),
    ).toBeInTheDocument();
  });
});

describe('CostByVehicleChart — error', () => {
  it('renders a QueryError alert with a Retry that invokes onRetry', () => {
    const { onRetry } = renderChart({ error: new Error('boom') });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/can't reach server/i)).toBeInTheDocument();

    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('prioritises the error over stale bars (no chart is rendered)', () => {
    renderChart({
      error: new Error('down'),
      bars: [makeBar({ name: 'ShouldNotRender' })],
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: CHART_LABEL })).toBeNull();
  });

  it('prioritises the error over the loading skeleton', () => {
    const { container } = renderChart({
      error: new Error('nope'),
      loading: true,
      bars: [],
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    // The error branch is evaluated first, so no skeleton paints underneath it.
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });
});

describe('CostByVehicleChart — empty state', () => {
  it('renders an EmptyState (never a blank panel) when there are no bars', () => {
    renderChart({ bars: [] });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(EMPTY_COPY)).toBeInTheDocument();
    // No chart region and no skeleton in the settled-empty branch.
    expect(screen.queryByRole('img', { name: CHART_LABEL })).toBeNull();
  });
});

describe('CostByVehicleChart — data branch', () => {
  it('renders the chart as an accessible labelled image region', () => {
    renderChart({ bars: [makeBar(), makeBar({ vehicle_id: 2, name: 'Model Y' })] });

    const chart = screen.getByRole('img', { name: CHART_LABEL });
    expect(chart).toBeInTheDocument();
    // Data branch is mutually exclusive with the loading / empty / error UI.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('CostByVehicleChart — null-safety', () => {
  it('treats undefined bars as empty without crashing', () => {
    renderChart({ bars: undefined as unknown as VehicleCostBar[] });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(EMPTY_COPY)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: CHART_LABEL })).toBeNull();
  });

  it('treats null bars as empty without crashing', () => {
    renderChart({ bars: null as unknown as VehicleCostBar[] });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: CHART_LABEL })).toBeNull();
  });

  it('falls through to the skeleton when loading with null bars (no crash)', () => {
    const { container } = renderChart({
      loading: true,
      bars: null as unknown as VehicleCostBar[],
    });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
