import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MileageStats } from '@/types/analytics';
import MileageStatsWidget from './MileageStatsWidget';

const { useMileageStatsMock, useVehiclesMock, useUnitsMock } = vi.hoisted(() => ({
  useMileageStatsMock: vi.fn(),
  useVehiclesMock: vi.fn(),
  useUnitsMock: vi.fn(),
}));

vi.mock('@/api/hooks/useAnalytics', () => ({
  useMileageStats: (vehicleId: string) => useMileageStatsMock(vehicleId),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => useVehiclesMock(),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => useUnitsMock(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      const template = typeof defaultValue === 'string' ? defaultValue : key;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        opts?.[name] == null ? '' : String(opts[name]),
      );
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: /prefers-reduced-motion/.test(query),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

function makeStats(overrides: Partial<MileageStats> = {}): MileageStats {
  return {
    vehicle_id: 1,
    lifetime_km: 0,
    last_7d_km: 0,
    last_30d_km: 0,
    last_365d_km: 0,
    drive_count_lifetime: 0,
    drive_count_30d: 0,
    first_drive_at: null,
    last_drive_at: null,
    ...overrides,
  };
}

function makeQuery(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderWidget(cols = 2, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <MileageStatsWidget size={{ cols, rows: 2 }} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useVehiclesMock.mockReturnValue({ data: [{ id: 42 }] });
  useUnitsMock.mockReturnValue({ unitPrefs: { distance: 'km' } });
  useMileageStatsMock.mockReturnValue(makeQuery());
});

afterEach(cleanup);

describe('MileageStatsWidget redesign', () => {
  it('matches the After hierarchy with three average values and one milestone meter', () => {
    useMileageStatsMock.mockReturnValue(makeQuery({
      data: makeStats({ lifetime_km: 45000, last_30d_km: 900 }),
    }));

    renderWidget();

    expect(screen.getByRole('heading', { name: 'Mileage stats' })).toBeInTheDocument();
    expect(screen.getByText('Daily avg')).toBeInTheDocument();
    expect(screen.getByText('Weekly avg')).toBeInTheDocument();
    expect(screen.getByText('Monthly avg')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('210')).toBeInTheDocument();
    expect(screen.getByText('900')).toBeInTheDocument();
    expect(screen.getByTestId('mileage-milestone')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Next milestone' })).toHaveAttribute('aria-valuenow');
  });

  it('converts the shared SI payload to the selected distance unit without fabricating values', () => {
    useUnitsMock.mockReturnValue({ unitPrefs: { distance: 'mi' } });
    useMileageStatsMock.mockReturnValue(makeQuery({
      data: makeStats({ lifetime_km: 45000, last_30d_km: 900 }),
    }));

    renderWidget();

    expect(screen.getAllByText('mi').length).toBeGreaterThan(0);
    expect(screen.queryByText(/km$/)).not.toBeInTheDocument();
    expect(screen.getByText(/30,000 mi/)).toBeInTheDocument();
  });

  it('keeps unknown readings unknown instead of treating missing values as zero', () => {
    useMileageStatsMock.mockReturnValue(makeQuery({ data: {} as MileageStats }));

    renderWidget();

    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('10,000')).not.toBeInTheDocument();
  });

  it('uses compact one-column headline and shows an honest empty state', () => {
    useMileageStatsMock.mockReturnValue(makeQuery({
      data: makeStats({ lifetime_km: 45000, last_30d_km: 900 }),
    }));
    const compact = renderWidget(1);
    expect(compact.container.textContent).toContain('km/day');

    cleanup();
    useMileageStatsMock.mockReturnValue(makeQuery());
    renderWidget(1);
    expect(screen.getByText('No mileage data')).toBeInTheDocument();
  });

  it('retains cached data and exposes refresh freshness without replacing content on an error', () => {
    const refetch = vi.fn();
    useMileageStatsMock.mockReturnValue(makeQuery({
      data: makeStats({ lifetime_km: 45000, last_30d_km: 900 }),
      isError: true,
      error: new Error('transient'),
      refetch,
    }));

    const { container } = renderWidget();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(container.querySelector('[class*="--semantic-danger"].rounded-full')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('uses the explicit vehicle id and disables the query without a resolved vehicle', () => {
    renderWidget(2, 7);
    expect(useMileageStatsMock).toHaveBeenCalledWith('7');

    cleanup();
    useVehiclesMock.mockReturnValue({ data: [] });
    renderWidget(2);
    expect(useMileageStatsMock).toHaveBeenCalledWith('');
  });

  it('renders loading, initial error, and empty states', () => {
    useMileageStatsMock.mockReturnValue(makeQuery({ isLoading: true }));
    const loading = renderWidget();
    expect(loading.container.querySelector('[class*="--skeleton-bg"]')).toBeTruthy();

    cleanup();
    useMileageStatsMock.mockReturnValue(makeQuery({ isError: true, error: new Error('boom') }));
    renderWidget();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();

    cleanup();
    useMileageStatsMock.mockReturnValue(makeQuery());
    renderWidget();
    expect(screen.getByText('No mileage data')).toBeInTheDocument();
  });
});
