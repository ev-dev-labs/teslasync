import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const { weeklyDigestMock, vehiclesMock, unitsMock } = vi.hoisted(() => ({
  weeklyDigestMock: vi.fn(),
  vehiclesMock: vi.fn(),
  unitsMock: vi.fn(),
}));

vi.mock('@/api/hooks/useAnalytics', () => ({
  useWeeklyDigest: (vehicleId: string) => weeklyDigestMock(vehicleId),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => vehiclesMock(),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => unitsMock(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, options?: Record<string, unknown>) =>
      fallback && options
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, key) => String(options[key] ?? ''))
        : fallback ?? _key,
  }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: false, durationMs: 250 }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: (value: unknown) => String(value) }),
}));

import WeeklyDigestWidget from './WeeklyDigestWidget';
import type { WidgetSize } from './types';

const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };

function makeDigest(overrides: Record<string, unknown> = {}) {
  return {
    drives: 8,
    distanceKm: 100,
    cost: 3.5,
    efficiency: 250,
    prevDrives: 5,
    prevDistanceKm: 80,
    prevCost: 2.8,
    prevEfficiency: 300,
    energyWh: 25000,
    prevEnergyWh: 20000,
    ...overrides,
  };
}

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: makeDigest(),
    isLoading: false,
    isPending: false,
    isFetching: false,
    isStale: false,
    isError: false,
    error: null,
    dataUpdatedAt: Date.parse('2026-07-05T12:00:00.000Z'),
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderWidget(size: WidgetSize = FULL, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <WeeklyDigestWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vehiclesMock.mockReturnValue({
    data: [{ id: 7, display_name: 'Car' }],
    dataUpdatedAt: Date.parse('2026-07-05T12:00:00.000Z'),
    isFetching: false,
    isStale: false,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  });
  unitsMock.mockReturnValue({
    unitPrefs: {
      distance: 'mi',
      speed: 'mph',
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
    },
  });
  weeklyDigestMock.mockReturnValue(query());
});

afterEach(cleanup);

describe('WeeklyDigestWidget — After card', () => {
  it('renders one source-backed comparison row per metric with previous-week lines', () => {
    renderWidget();
    expect(screen.getByRole('heading', { name: 'This week', level: 3 })).toBeVisible();
    for (const label of ['Distance', 'Drives', 'Energy', 'Efficiency']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText(/Last week|last week/i).length).toBeGreaterThanOrEqual(4);
  });

  it('uses the miles preference without repeating a canonical value or unit', () => {
    renderWidget();
    expect(screen.getByText('62')).toBeInTheDocument();
    expect(screen.getAllByText('mi').length).toBeGreaterThan(0);
    expect(screen.getByText('402')).toBeInTheDocument();
    expect(screen.getAllByText('Wh/mi').length).toBeGreaterThan(0);
    expect(screen.queryByText(/647|648/)).not.toBeInTheDocument();
  });

  it('uses kilometres and Wh/km in the km preference', () => {
    unitsMock.mockReturnValue({
      unitPrefs: { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar', energy: 'kWh', locale: 'en-US' },
    });
    renderWidget();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getAllByText('km').length).toBeGreaterThan(0);
    expect(screen.getByText('250')).toBeInTheDocument();
    expect(screen.getAllByText('Wh/km').length).toBeGreaterThan(0);
  });

  it('clamps compact cards to Distance and Drives', () => {
    renderWidget(COMPACT);
    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('Drives')).toBeInTheDocument();
    expect(screen.queryByText('Energy')).not.toBeInTheDocument();
    expect(screen.queryByText('Efficiency')).not.toBeInTheDocument();
  });

  it('preserves missing measurements without zero-fabricating their rows or deltas', () => {
    weeklyDigestMock.mockReturnValue(query({
      data: makeDigest({ distanceKm: undefined, efficiency: undefined }),
    }));
    renderWidget();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Drives')).toBeInTheDocument();
    expect(screen.getByText('Energy')).toBeInTheDocument();
  });

  it('renders loading, empty, and initial-error states through WidgetShell', () => {
    weeklyDigestMock.mockReturnValue(query({ data: undefined, isLoading: true }));
    const view = renderWidget();
    expect(view.container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();

    cleanup();
    weeklyDigestMock.mockReturnValue(query({ data: undefined, isLoading: false }));
    renderWidget();
    expect(screen.getByText('No weekly data yet')).toBeInTheDocument();

    cleanup();
    weeklyDigestMock.mockReturnValue(query({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('offline'),
    }));
    renderWidget();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('keeps retained metrics and exposes freshness refresh on background failure', () => {
    const q = query({ isError: true, error: new Error('offline') });
    weeklyDigestMock.mockReturnValue(q);
    renderWidget();
    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /^Refresh/i })[0]);
    expect(q.refetch).toHaveBeenCalledTimes(1);
  });

  it('resolves vehicle scope and exposes exactly one freshness refresh control', () => {
    renderWidget(FULL, 3);
    expect(weeklyDigestMock).toHaveBeenCalledWith('3');
    expect(screen.getAllByRole('button', { name: /^Refresh/i })).toHaveLength(1);
  });
});
