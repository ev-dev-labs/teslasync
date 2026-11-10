import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VehicleSpecsWidget from './VehicleSpecsWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}));

const state = vi.hoisted(() => ({
  vehicles: [] as Array<{ id: number }>,
  specs: null as Record<string, unknown> | null,
  config: null as Record<string, unknown> | null,
  specsError: null as Error | null,
  configError: null as Error | null,
  specsLoading: false,
  configLoading: false,
  specsFetching: false,
  configFetching: false,
  specsRefetch: vi.fn(),
  configRefetch: vi.fn(),
  updatedAt: 1_700_000_000_000,
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({
    data: state.vehicles,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: state.updatedAt,
    refetch: vi.fn(),
  }),
  useVehicleSpecs: () => ({
    data: state.specs == null ? null : { data: state.specs, fetched_at: '2026-01-01T00:00:00Z' },
    isLoading: state.specsLoading,
    isFetching: state.specsFetching,
    isStale: false,
    isError: state.specsError != null,
    error: state.specsError,
    dataUpdatedAt: state.updatedAt,
    refetch: state.specsRefetch,
  }),
  useVehicleConfigLatest: () => ({
    data: state.config,
    isLoading: state.configLoading,
    isFetching: state.configFetching,
    isStale: false,
    isError: state.configError != null,
    error: state.configError,
    dataUpdatedAt: state.updatedAt,
    refetch: state.configRefetch,
  }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatEnergy: (value: number | null | undefined, options?: { precision?: number }) =>
      value == null ? '—' : `${(value / 1000).toFixed(options?.precision ?? 1)} kWh`,
  }),
}));

function props(cols = 2) {
  return { vehicleId: 7, size: { cols, rows: 2 } };
}

function widget(packId: PackId, cols = 2) {
  return (
    <PackBoundary requestedPackId={packId}>
      <VehicleSpecsWidget {...props(cols)} />
    </PackBoundary>
  );
}

async function expectPresentation(container: HTMLElement, packId: PackId) {
  expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
  if (packId === 'classic') {
    expect(container.querySelector('[data-status-appearance]')).toBeNull();
  } else {
    await waitFor(() => {
      expect(container.querySelector('[data-status-appearance]')).toHaveAttribute(
        'data-status-appearance',
        PACK_APPEARANCES[packId],
      );
    });
  }
}

async function renderWidget(packId: PackId, cols = 2) {
  const result = render(widget(packId, cols));
  if (state.specs != null || state.config != null) {
    await expectPresentation(result.container, packId);
  }
  return result;
}

describe.each(PACK_IDS)('VehicleSpecsWidget — %s', packId => {
  beforeEach(() => {
    state.vehicles = [{ id: 7 }];
    state.specs = null;
    state.config = null;
    state.specsError = null;
    state.configError = null;
    state.specsLoading = false;
    state.configLoading = false;
    state.specsFetching = false;
    state.configFetching = false;
    state.specsRefetch.mockReset();
    state.configRefetch.mockReset();
  });

  it('renders the seven source-backed After rows in order without fabricated fields', async () => {
    state.specs = {
      car_type: 'Model 3',
      trim_badging: 'Long Range AWD',
      model_year: 2023,
      exterior_color: 'Midnight Silver',
      wheel_type: '18" Aero',
      battery_capacity_wh: 82_000,
      battery_type: 'NCA',
      motor_type: 'Dual',
      interior: 'Black',
    };

    await renderWidget(packId);

    expect(screen.getAllByRole('term').map(row => row.textContent)).toEqual([
      'Model', 'Year', 'Paint color', 'Wheels', 'Battery', 'Motors', 'Interior',
    ]);
    expect(screen.getAllByRole('definition').map(row => row.textContent)).toEqual([
      'Model 3 Long Range AWD', '2023', 'Midnight Silver', '18" Aero', '82 kWh · NCA', 'Dual', 'Black',
    ]);
    expect(screen.queryByText('Aux battery')).toBeNull();
    expect(screen.queryByText('Car version')).toBeNull();
  });

  it('uses config fallback values and keeps unknown fields as em dashes', async () => {
    state.specs = { car_type: 'Model Y' };
    state.config = { car_type: 'Fallback', trim: 'Performance', exterior_color: 'Red', wheel_type: 'Aero' };

    await renderWidget(packId);

    expect(screen.getAllByRole('definition').map(row => row.textContent)).toEqual([
      'Model Y Performance', '—', 'Red', 'Aero', '—', '—', '—',
    ]);
    expect(screen.queryByText(/undefined|NaN|null/)).toBeNull();
  });

  it('shows an empty state for no data and no fabricated placeholder card', async () => {
    const { container } = await renderWidget(packId);
    expect(screen.getByText('No specs available').closest('[role="status"]')).not.toBeNull();
    expect(screen.queryAllByRole('term')).toHaveLength(0);
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'false');
  });

  it('surfaces a source failure without replacing available data as an error-only view', async () => {
    state.specs = { car_type: 'Model S' };
    state.configError = new Error('config unavailable');
    const { container } = await renderWidget(packId);
    expect(screen.getAllByRole('definition')[0]).toHaveTextContent('Model S');
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('Previously loaded data remains visible');
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'stale');
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-motion-suppressed', 'true');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('renders compact model and trim hero only at one column', async () => {
    state.specs = { car_type: 'Model X', trim_badging: 'Plaid' };
    await renderWidget(packId, 1);
    expect(screen.getByText('Model X Plaid')).toBeInTheDocument();
    expect(screen.queryByText('Paint color')).toBeNull();
    expect(screen.queryByText('Battery')).toBeNull();
  });

  it('refreshes both source reads from the freshness control', async () => {
    state.specs = { car_type: 'Model 3' };
    await renderWidget(packId);
    const refresh = await screen.findByRole('button', { name: /^Refresh/i });
    fireEvent.click(refresh);
    await waitFor(() => {
      expect(state.specsRefetch).toHaveBeenCalledTimes(1);
      expect(state.configRefetch).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps initial loading, fatal failure, retry and config-only recovery distinct', async () => {
    state.specsLoading = true;
    state.configLoading = true;
    const { container, rerender } = await renderWidget(packId);
    const shell = container.querySelector('[data-widget-pack]');
    expect(shell).toHaveAttribute('data-data-state', 'initial');
    expect(shell).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No specs available')).toBeNull();
    expect(screen.queryAllByRole('term')).toHaveLength(0);

    state.specsLoading = false;
    state.configLoading = false;
    state.specsError = new Error('specs unavailable');
    state.configError = new Error('config unavailable');
    rerender(widget(packId));
    expect(shell).toHaveAttribute('data-data-state', 'initialFailure');
    expect(shell).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.specsRefetch).toHaveBeenCalledTimes(1);
    expect(state.configRefetch).toHaveBeenCalledTimes(1);

    state.specsError = null;
    state.configError = null;
    state.config = { car_type: 'Model Y', trim: 'Performance', exterior_color: 'Red', wheel_type: 'Aero' };
    rerender(widget(packId));
    await expectPresentation(container, packId);
    expect(shell).toHaveAttribute('data-data-state', 'ok');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('definition').map(row => row.textContent)).toEqual([
      'Model Y Performance', '—', 'Red', 'Aero', '—', '—', '—',
    ]);
  });

  it('retains the formatted specs and selected layout while both sources refresh', async () => {
    state.specs = { car_type: 'Model 3', battery_capacity_wh: 82_000 };
    const { container, rerender } = await renderWidget(packId);
    state.specsFetching = true;
    state.configFetching = true;
    rerender(widget(packId));
    await expectPresentation(container, packId);
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByRole('definition')).toHaveLength(7);
    expect(screen.getByText('82 kWh')).toBeInTheDocument();
    expect(screen.queryByText('No specs available')).toBeNull();
    expect(state.specsRefetch).not.toHaveBeenCalled();
    expect(state.configRefetch).not.toHaveBeenCalled();
  });

  it('distinguishes real zero capacity and a single motor from unknown or invalid values', async () => {
    state.specs = { car_type: 'Model 3', battery_capacity_wh: 0, dual_motor: false };
    const { container, rerender } = await renderWidget(packId);
    expect(screen.getAllByRole('definition')[4]).toHaveTextContent('0 kWh');
    expect(screen.getAllByRole('definition')[5]).toHaveTextContent('Single');

    for (const capacity of [null, -1, Number.NaN, Number.POSITIVE_INFINITY, '82000']) {
      state.specs = { car_type: 'Model 3', battery_capacity_wh: capacity };
      rerender(widget(packId));
      await expectPresentation(container, packId);
      expect(screen.getAllByRole('definition')[4]).toHaveTextContent('—');
      expect(screen.getAllByRole('definition')[5]).toHaveTextContent('—');
      expect(screen.queryByText(/NaN|Infinity|undefined|null/)).toBeNull();
    }
  });
});
