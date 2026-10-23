import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown, options?: Record<string, unknown>) => {
      const template = typeof defaultValue === 'string' ? defaultValue : key;
      return options
        ? template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options[name] ?? ''))
        : template;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

let distanceUnit: 'km' | 'mi';
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: distanceUnit } }),
}));

const mockUseVehicleState = vi.fn();
let vehicles: unknown[];
let stateResult: Record<string, unknown>;

vi.mock('@/api/hooks/useVehicles', async importActual => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return {
    ...actual,
    useVehicles: () => ({ data: vehicles }),
    useVehicleState: (id: number) => {
      mockUseVehicleState(id);
      return stateResult;
    },
  };
});

import RangeEstimateWidget, { formatRange } from './RangeEstimateWidget';
import type { DistanceUnitPref } from '@/lib/unitConversion';
import type { WidgetSize } from './types';

const NOW = Date.parse('2026-07-05T12:00:00.000Z');
const size: WidgetSize = { cols: 1, rows: 2 };

function makeState(rated_range: number | null = 500_000, ideal_range: number | null = 480_000) {
  return { state: { vehicle_id: 7, state: 'online', rated_range, ideal_range }, live: true };
}

function makeQuery(overrides: Record<string, unknown> = {}) {
  return {
    data: makeState(),
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: NOW,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderWidget(options: {
  vehicleId?: number;
  unit?: DistanceUnitPref;
  query?: Record<string, unknown>;
  vehicles?: unknown[];
} = {}) {
  distanceUnit = options.unit ?? 'km';
  vehicles = options.vehicles ?? [];
  stateResult = options.query ?? makeQuery();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RangeEstimateWidget vehicleId={options.vehicleId} size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  distanceUnit = 'km';
  vehicles = [];
  stateResult = makeQuery();
  mockUseVehicleState.mockClear();
});

afterEach(cleanup);

describe('formatRange', () => {
  it('uses canonical SI metres and honors km/mi preferences', () => {
    expect(formatRange(500_000, 'km')).toBe('500 km');
    expect(formatRange(482_803.2, 'mi')).toBe('300 mi');
    expect(formatRange(123_456, 'km')).toBe('123 km');
  });

  it('distinguishes a true zero from missing or malformed readings', () => {
    expect(formatRange(0, 'km')).toBe('0 km');
    expect(formatRange(null, 'km')).toBe('—');
    expect(formatRange(undefined, 'mi')).toBe('—');
    expect(formatRange(Number.NaN, 'km')).toBe('—');
  });
});

describe('RangeEstimateWidget target card', () => {
  it('shows one rated headline and one ideal row in km or mi', () => {
    renderWidget({ vehicleId: 7 });
    expect(screen.getByRole('heading', { name: 'Range', level: 3 })).toBeVisible();
    expect(screen.getByText('Rated range')).toBeInTheDocument();
    expect(screen.getByText('500 km')).toBeInTheDocument();
    expect(screen.getByText('Ideal range')).toBeInTheDocument();
    expect(screen.getByText('480 km')).toBeInTheDocument();
    expect(screen.queryByText('Realistic estimate')).not.toBeInTheDocument();
    expect(screen.queryByText(/last 30 days/)).not.toBeInTheDocument();
    cleanup();

    renderWidget({ vehicleId: 7, unit: 'mi', query: makeQuery({ data: makeState(482_803.2, 321_868.8) }) });
    expect(screen.getByText('300 mi')).toBeInTheDocument();
    expect(screen.getByText('200 mi')).toBeInTheDocument();
    expect(screen.queryByText(/km/)).not.toBeInTheDocument();
  });

  it('omits unavailable target fields and keeps unknown sections visible', () => {
    renderWidget({ vehicleId: 7, query: makeQuery({ data: makeState(null, null) }) });
    expect(screen.getByText('Rated range')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('Ideal range')).not.toBeInTheDocument();
    expect(screen.queryByText('Realistic estimate')).not.toBeInTheDocument();
  });

  it('preserves a zero range and does not turn it into missing data', () => {
    renderWidget({ vehicleId: 7, query: makeQuery({ data: makeState(0, 0) }) });
    expect(screen.getAllByText('0 km')).toHaveLength(2);
  });
});

describe('RangeEstimateWidget lifecycle', () => {
  it('resolves the explicit vehicle, fleet fallback, and disabled fallback', () => {
    renderWidget({ vehicleId: 9 });
    expect(mockUseVehicleState).toHaveBeenCalledWith(9);
    cleanup();

    renderWidget({ vehicles: [{ id: 3 }, { id: 5 }] });
    expect(mockUseVehicleState).toHaveBeenCalledWith(3);
    cleanup();

    renderWidget();
    expect(mockUseVehicleState).toHaveBeenCalledWith(0);
  });

  it('shows loading, empty, and query-error states without invented range values', () => {
    const loading = renderWidget({ query: makeQuery({ isLoading: true, data: undefined }) });
    expect(loading.container.querySelector('[class*="--skeleton-bg"]')).toBeTruthy();
    expect(screen.queryByText('Rated range')).not.toBeInTheDocument();
    cleanup();

    renderWidget({ query: makeQuery({ data: undefined }) });
    expect(screen.getByText('No range data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    cleanup();

    renderWidget({ query: makeQuery({ data: undefined, error: new Error('boom'), isError: true }) });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No range data')).not.toBeInTheDocument();
  });

  it('refreshes through the shared freshness action', () => {
    const refetch = vi.fn();
    renderWidget({ query: makeQuery({ refetch }) });
    fireEvent.click(screen.getAllByRole('button', { name: /^Refresh/i })[0]);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
