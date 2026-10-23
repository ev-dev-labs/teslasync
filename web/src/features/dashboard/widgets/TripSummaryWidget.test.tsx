/**
 * TripSummaryWidget redesign tests.
 * Owns trip binding, SI conversion, timezone-backed weekday labels, branches,
 * freshness, and honest null/empty/error behavior.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.hoisted(() => {
  if (typeof window !== 'undefined') {
    window.matchMedia = ((query: string) => ({
      matches: /prefers-reduced-motion/.test(query),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return false; },
    })) as unknown as typeof window.matchMedia;
  }
});

const { tripsMock, useUnitsMock, refetch } = vi.hoisted(() => ({
  tripsMock: vi.fn(),
  useUnitsMock: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const template = typeof fallback === 'string' ? fallback : key;
        const vars = opts && typeof opts === 'object' ? opts as Record<string, unknown> : undefined;
        return vars
          ? template.replace(/{{(\w+)}}/g, (_m, name: string) => name in vars ? String(vars[name]) : `{{${name}}}`)
          : template;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useTrips', async () => {
  const actual = await vi.importActual('@/api/hooks/useTrips');
  return { ...actual, useTrips: (...args: unknown[]) => tripsMock(...args) };
});
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => useUnitsMock() }));
vi.mock('@/hooks/useDateLabels', () => ({
  useDateLabels: () => ({ formatWeekdayName: () => 'Sun' }),
}));

import TripSummaryWidget from './TripSummaryWidget';
import type { Trip } from '@/api/types';
import type { WidgetSize } from './types';

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 1, vehicle_id: 7, name: 'Seattle → Home',
    start_date: '2026-01-01T10:00:00Z', end_date: '2026-01-01T10:31:00Z',
    started_at: '2026-01-01T10:00:00Z', ended_at: '2026-01-01T10:31:00Z',
    total_distance_m: 28_646, total_energy_wh: 4300, total_duration_s: 1860,
    total_cost: 0, drive_count: 2, charge_count: 0, created_at: '2026-01-01T10:00:00Z',
    ...overrides,
  };
}

function query(data?: Trip[], overrides: Record<string, unknown> = {}) {
  return {
    data, error: null, isLoading: false, isFetching: false, isStale: false,
    isError: false, dataUpdatedAt: Date.now(), refetch,
    ...overrides,
  };
}

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }) {
  return render(<MemoryRouter><TripSummaryWidget size={size} /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useUnitsMock.mockReturnValue({
    unitPrefs: { distance: 'mi', energy: 'kWh', duration: 'h' },
  });
  tripsMock.mockReturnValue(query([makeTrip()]));
});

describe('TripSummaryWidget redesign', () => {
  it('renders the After hierarchy: route, weekday and duration, then distance/energy/stops', () => {
    renderWidget();
    expect(screen.getByText('Seattle → Home')).toBeInTheDocument();
    expect(screen.getByText(/Sun ·/)).toBeInTheDocument();
    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('Energy')).toBeInTheDocument();
    expect(screen.getByText('Stops')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('mi')).toBeInTheDocument();
    expect(screen.getByText('4.3')).toBeInTheDocument();
    expect(screen.getByText('kWh')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('uses km SI conversion and keeps stops honest', () => {
    useUnitsMock.mockReturnValue({ unitPrefs: { distance: 'km', energy: 'Wh', duration: 'h' } });
    tripsMock.mockReturnValue(query([makeTrip({ total_distance_m: 50_000, total_energy_wh: 0, charge_count: 0 })]));
    renderWidget();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('km')).toBeInTheDocument();
    expect(screen.getAllByText('0')).toHaveLength(2);
    expect(screen.getByText('Wh')).toBeInTheDocument();
  });

  it('does not fabricate partial or missing values', () => {
    tripsMock.mockReturnValue(query([{
      id: 1, name: 'Sparse Trip', start_date: '2026-01-01T10:00:00Z', end_date: null,
    } as unknown as Trip]));
    renderWidget();
    expect(screen.getByText('Sparse Trip')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  it('uses the unnamed fallback for blank names', () => {
    tripsMock.mockReturnValue(query([makeTrip({ name: '   ' })]));
    renderWidget();
    expect(screen.getByText('Unnamed trip')).toBeInTheDocument();
  });

  it('preserves retained data and refreshes on the freshness control during an error', () => {
    tripsMock.mockReturnValue(query([makeTrip()], {
      error: new Error('offline'), isError: true, isStale: true,
    }));
    renderWidget();
    expect(screen.getByText('Seattle → Home')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state', () => {
    tripsMock.mockReturnValue(query([]));
    renderWidget();
    expect(screen.getByText('No trips recorded yet')).toBeInTheDocument();
  });

  it('shows the fatal error without the empty state', () => {
    tripsMock.mockReturnValue(query(undefined, { error: new Error('boom'), isError: true, dataUpdatedAt: 0 }));
    renderWidget();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No trips recorded yet')).not.toBeInTheDocument();
  });

  it('requests exactly five recent trips', () => {
    renderWidget();
    expect(tripsMock).toHaveBeenCalledWith({ limit: 5 });
  });
});
