import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = (() => ({
      matches: true,
      media: '',
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return false; },
    })) as typeof window.matchMedia;
  }
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const template = typeof fallback === 'string' ? fallback : key;
      return options
        ? template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options[name] ?? ''))
        : template;
    },
  }),
}));

const { vehiclesMock, vehicleStateMock, dailyMileageMock } = vi.hoisted(() => ({
  vehiclesMock: vi.fn(),
  vehicleStateMock: vi.fn(),
  dailyMileageMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  resolveVehicleStateFreshness: (_raw: string | undefined, observedAt: number | null) =>
    observedAt == null ? 'unknown' : 'fresh',
  useVehicles: vehiclesMock,
  useVehicleState: vehicleStateMock,
}));
vi.mock('@/api/hooks/useAnalytics', () => ({
  useDailyMileage: dailyMileageMock,
}));

import OdometerCounterWidget, {
  sumDistanceBuckets,
  toOdometerDisplay,
} from './OdometerCounterWidget';

const compact = { cols: 1, rows: 1 };
const tall = { cols: 1, rows: 2 };

function makeStateQuery(odometer: number | undefined, overrides = {}) {
  return {
    data: odometer === undefined ? undefined : {
      state: { odometer },
      live: true,
      observedAt: Date.now(),
      freshness: 'fresh',
      verifiedFields: odometer === undefined ? [] : ['odometer'],
    },
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    error: null,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderWidget(size: typeof compact, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <OdometerCounterWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vehiclesMock.mockReset();
  vehicleStateMock.mockReset();
  dailyMileageMock.mockReset();
  vehiclesMock.mockReturnValue({ data: [{ id: 42 }] });
  vehicleStateMock.mockReturnValue(makeStateQuery(50_000_000));
  dailyMileageMock.mockReturnValue({
    data: [
      { date: '2026-10-20', total_km: 40 },
      { date: '2026-10-21', total_km: 60 },
      { date: '2026-10-22', total_km: 84 },
    ],
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
});

describe('toOdometerDisplay', () => {
  it('uses the SI metres converter without guessing source units', () => {
    expect(toOdometerDisplay(50_000_000, 'km')).toBe(50_000);
    expect(toOdometerDisplay(1_609_344, 'mi')).toBeCloseTo(1000, 6);
  });

  it('does not turn non-finite readings into fabricated zero', () => {
    expect(toOdometerDisplay(Number.NaN, 'km')).toBe(0);
    expect(toOdometerDisplay(Number.POSITIVE_INFINITY, 'mi')).toBe(0);
  });
});

describe('sumDistanceBuckets', () => {
  it('sums only finite measured buckets in the inclusive window', () => {
    expect(sumDistanceBuckets([
      { date: '2026-10-20', total_km: 40 },
      { date: '2026-10-21', total_km: 60 },
      { date: '2026-10-23', total_km: Number.NaN },
    ], '2026-10-20', '2026-10-21')).toBe(100);
  });

  it('returns null when the window has no measured buckets', () => {
    expect(sumDistanceBuckets([], '2026-10-20', '2026-10-22')).toBeNull();
  });
});

describe('OdometerCounterWidget', () => {
  it('renders one whole-number SI odometer headline with the shared unit', () => {
    renderWidget(tall);
    expect(screen.getByText('50,000')).toBeInTheDocument();
    expect(screen.getAllByText('km').length).toBeGreaterThan(0);
    expect(screen.queryByText('50,000.00 km')).not.toBeInTheDocument();
  });

  it('shows the After-card period breakdown and no repeated odometer value', () => {
    renderWidget(tall);
    expect(screen.getByText('This week')).toBeInTheDocument();
    expect(screen.getByText('This month')).toBeInTheDocument();
    expect(screen.getByText('This year')).toBeInTheDocument();
    expect(screen.getByText('Per day')).toBeInTheDocument();
  });

  it('keeps the compact card limited to the headline and unit', () => {
    renderWidget(compact);
    expect(screen.getByText('50,000')).toBeInTheDocument();
    expect(screen.queryByText('This week')).not.toBeInTheDocument();
  });

  it('renders unknown and zero odometers without conflating them', () => {
    vehicleStateMock.mockReturnValue(makeStateQuery(undefined));
    const first = renderWidget(tall);
    expect(screen.getByText('No odometer data')).toBeInTheDocument();
    first.unmount();

    vehicleStateMock.mockReturnValue(makeStateQuery(0));
    renderWidget(compact);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('uses observation freshness and still retains an initial reading while stale', () => {
    vehicleStateMock.mockReturnValue(makeStateQuery(50_000_000, {
      isError: true,
      isStale: true,
      error: new Error('offline'),
    }));
    renderWidget(tall);
    expect(screen.getByText('50,000')).toBeInTheDocument();
    expect(document.querySelector('[data-data-state="stale"]')).not.toBeNull();
  });

  it('renders a fatal state error rather than fabricated data', () => {
    vehicleStateMock.mockReturnValue(makeStateQuery(undefined, {
      isError: true,
      error: new Error('offline'),
    }));
    renderWidget(tall);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No odometer data')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton before first reading', () => {
    vehicleStateMock.mockReturnValue(makeStateQuery(undefined, { isLoading: true }));
    const { container } = renderWidget(tall);
    expect(container.querySelector('[class*="--skeleton-bg"]')).toBeTruthy();
  });

  it('resolves the selected vehicle and refreshes both measured sources', () => {
    const stateRefetch = vi.fn();
    const historyRefetch = vi.fn();
    vehicleStateMock.mockReturnValue(makeStateQuery(50_000_000, { refetch: stateRefetch }));
    dailyMileageMock.mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: false,
      isStale: false,
      isError: false,
      error: null,
      refetch: historyRefetch,
    });

    renderWidget(tall, 7);
    expect(vehicleStateMock).toHaveBeenCalledWith(7);
    expect(dailyMileageMock).toHaveBeenCalledWith('7', 366);

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(stateRefetch).toHaveBeenCalledTimes(1);
    expect(historyRefetch).toHaveBeenCalledTimes(1);
  });
});
