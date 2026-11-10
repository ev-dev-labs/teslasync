/**
 * Own-suite tests for the TirePressureVisualWidget redesign.
 * Keeps vehicle resolution, SI pressure conversion, honest empty/error/retained
 * states, four-corner status, FreshnessDot refresh, and i18n/a11y behavior.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: unknown }) => <>{children as never}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return { ...actual, useVehicles: vi.fn(), useLatestTirePressure: vi.fn() };
});

vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

const pressurePreference = vi.hoisted(() => ({ unit: 'bar' as 'bar' | 'psi' }));
vi.mock('@/hooks/useSettings', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useSettings')>();
  return {
    ...actual,
    useSettings: () => {
      const result = actual.useSettings();
      return { ...result, settings: { ...result.settings, unit_of_pressure: pressurePreference.unit } };
    },
  };
});

import TirePressureVisualWidget from './TirePressureVisualWidget';
import { useVehicles, useLatestTirePressure } from '@/api/hooks/useVehicles';
import type { TirePressureSnapshot, Vehicle } from '@/api/types';
import type { WidgetProps, WidgetSize } from './types';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';

const mockVehicles = vi.mocked(useVehicles);
const mockLatest = vi.mocked(useLatestTirePressure);

function queryResult(
  over: Partial<ReturnType<typeof useLatestTirePressure>> = {},
): ReturnType<typeof useLatestTirePressure> {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  } as ReturnType<typeof useLatestTirePressure>;
}

function makeSnap(over: Partial<TirePressureSnapshot> = {}): TirePressureSnapshot {
  return {
    id: 1,
    vehicle_id: 1,
    front_left: 250_000,
    front_right: 250_000,
    rear_left: 250_000,
    rear_right: 250_000,
    created_at: '2026-07-06T00:00:00Z',
    ...over,
  };
}

async function renderWidget(size: WidgetSize, props: Partial<WidgetProps>, packId: PackId) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={packId}>
          <TirePressureVisualWidget size={size} {...props} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await act(async () => {
    if (packId !== 'classic') await import('./designPacks/families/TirePressureLayout');
  });
  return result;
}

beforeEach(() => {
  pressurePreference.unit = 'bar';
  const makeVehicle = (id: number): Vehicle => ({
    id, vehicle_id: id, vin: '', display_name: `Vehicle ${id}`, model: 'Model 3',
    trim_badging: '', exterior_color: '', wheel_type: '', state: 'online', healthy: true,
    created_at: '2026-07-06T00:00:00Z', updated_at: '2026-07-06T00:00:00Z',
  });
  mockVehicles.mockReturnValue({
    data: [makeVehicle(7), makeVehicle(9)],
    isLoading: false,
    error: null,
  } as ReturnType<typeof useVehicles>);
  mockLatest.mockReturnValue(queryResult({ data: makeSnap() }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe.each(PACK_IDS)('TirePressureVisualWidget redesign (%s)', (packId) => {
  const renderPackWidget = (size: WidgetSize, props: Partial<WidgetProps> = {}) =>
    renderWidget(size, props, packId);

  it('uses the selected vehicle and 10-second polling', async () => {
    await renderPackWidget({ cols: 2, rows: 2 }, { vehicleId: 42 });
    expect(mockLatest).toHaveBeenCalledWith(42, 10_000);
  });

  it('renders the current vehicle with four positioned Pa-derived corner readouts', async () => {
    const { container } = await renderPackWidget({ cols: 2, rows: 2 });
    expect(mockLatest).toHaveBeenCalledWith(7, 10_000);
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
    if (packId !== 'classic') {
      expect(container.querySelector('[data-tire-appearance]'))
        .toHaveAttribute('data-tire-appearance', PACK_APPEARANCES[packId]);
    }
    expect(screen.getByRole('heading', { name: 'Tire pressure', level: 3 })).toBeVisible();
    expect(screen.getAllByText('2.50')).toHaveLength(4);
    expect(screen.getByText('All normal')).toBeInTheDocument();
    expect(container.textContent).toContain('bar');
    expect(container.querySelector('[data-vehicle-studio]')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-pressure-status="success"]')).toHaveLength(4);
    for (const corner of ['FL', 'FR', 'RL', 'RR']) {
      expect(screen.getByRole('group', { name: corner })).toBeInTheDocument();
    }
  });

  it('converts 290000 Pa through the shared pressure format without fabrication', async () => {
    mockLatest.mockReturnValue(queryResult({
      data: makeSnap({
        front_left: 290_000, front_right: 290_000,
        rear_left: 290_000, rear_right: 290_000,
      }),
    }));
    await renderPackWidget({ cols: 2, rows: 2 });
    expect(screen.getAllByText('2.90')).toHaveLength(4);
  });

  it('uses the pressure preference without changing SI-derived severity', async () => {
    pressurePreference.unit = 'psi';
    const { container } = await renderPackWidget({ cols: 2, rows: 2 });
    expect(screen.getAllByText('36.26')).toHaveLength(4);
    expect(screen.getAllByText('psi').length).toBeGreaterThan(0);
    expect(screen.queryByText('bar')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-pressure-status="success"]')).toHaveLength(4);
    expect(screen.getByText('All normal')).toBeInTheDocument();
  });

  it('uses each corner SI status and an honest aggregate pill', async () => {
    mockLatest.mockReturnValue(queryResult({
      data: makeSnap({
        front_left: 250_000,
        front_right: 240_000,
        rear_left: 200_000,
        rear_right: null,
      }),
    }));
    const { container } = await renderPackWidget({ cols: 2, rows: 2 });
    expect(container.querySelectorAll('[data-pressure-status="success"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-pressure-status="warning"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-pressure-status="danger"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-pressure-status="neutral"]')).toHaveLength(1);
    for (const [corner, value] of [['FL', '2.50'], ['FR', '2.40'], ['RL', '2.00'], ['RR', '—']]) {
      expect(within(screen.getByRole('group', { name: corner })).getByText(value)).toBeInTheDocument();
    }
    expect(screen.getByText('Check pressure')).toBeInTheDocument();
  });

  it('does not suppress retained data on refresh failure', async () => {
    mockLatest.mockReturnValue(queryResult({
      data: makeSnap(),
      isError: true,
      error: new Error('offline'),
    }));
    const { container } = await renderPackWidget({ cols: 2, rows: 2 });
    expect(screen.getAllByText('2.50')).toHaveLength(4);
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'stale');
  });

  it('keeps retained readings visible while refreshing', async () => {
    mockLatest.mockReturnValue(queryResult({ data: makeSnap(), isFetching: true, isStale: true }));
    const { container } = await renderPackWidget({ cols: 2, rows: 2 });
    expect(screen.getAllByText('2.50')).toHaveLength(4);
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it('renders null corners as unknown instead of manufactured zero or critical readings', async () => {
    mockLatest.mockReturnValue(queryResult({
      data: makeSnap({ front_left: null, front_right: null, rear_left: null, rear_right: null }),
    }));
    const { container } = await renderPackWidget({ cols: 2, rows: 2 });
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(container.querySelectorAll('[data-pressure-status="neutral"]')).toHaveLength(4);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('distinguishes measured zero from invalid corner readings', async () => {
    mockLatest.mockReturnValue(queryResult({
      data: makeSnap({
        front_left: 0, front_right: Number.NaN,
        rear_left: Number.POSITIVE_INFINITY, rear_right: Number.NEGATIVE_INFINITY,
      }),
    }));
    const { container } = await renderPackWidget({ cols: 2, rows: 2 });
    expect(within(screen.getByRole('group', { name: 'FL' })).getByText('0.00')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(container.querySelectorAll('[data-pressure-status="neutral"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-pressure-status="danger"]')).toHaveLength(1);
    expect(screen.getByText('Check pressure')).toBeInTheDocument();
  });

  it('retains high-pressure warning and critical bands', async () => {
    mockLatest.mockReturnValue(queryResult({
      data: makeSnap({ front_left: 320_000, front_right: 350_000 }),
    }));
    const { container } = await renderPackWidget({ cols: 2, rows: 2 });
    expect(screen.getByRole('group', { name: 'FL' })).toHaveAttribute('data-pressure-status', 'warning');
    expect(screen.getByRole('group', { name: 'FR' })).toHaveAttribute('data-pressure-status', 'danger');
    expect(container.querySelectorAll('[data-pressure-status="success"]')).toHaveLength(2);
    expect(screen.getByText('Check pressure')).toBeInTheDocument();
  });

  it('keeps explicit loading and empty states', async () => {
    mockLatest.mockReturnValue(queryResult({ isLoading: true, data: undefined }));
    const first = await renderPackWidget({ cols: 2, rows: 2 });
    expect(first.container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    first.unmount();

    mockLatest.mockReturnValue(queryResult({ data: null }));
    await renderPackWidget({ cols: 1, rows: 1 });
    expect(screen.getByText('No tire pressure data')).toBeInTheDocument();
  });

  it('shows fatal fetch errors rather than an empty panel', async () => {
    mockLatest.mockReturnValue(queryResult({
      isError: true,
      error: new Error('TPMS unavailable'),
      data: undefined,
    }));
    await renderPackWidget({ cols: 2, rows: 2 });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No tire pressure data')).toBeNull();
  });

  it('keeps one title and four values in compact size and wires FreshnessDot refresh', async () => {
    const refetch = vi.fn();
    mockLatest.mockReturnValue(queryResult({ data: makeSnap(), refetch }));
    const { container } = await renderPackWidget({ cols: 1, rows: 1 });
    expect(screen.getAllByRole('heading', { name: 'Tire pressure', level: 3 })).toHaveLength(1);
    expect(screen.getAllByText('2.50')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('svg')).not.toHaveLength(0);
  });
});
