import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClimateState } from '@/types/vehicle-systems';

const BASE = Date.parse('2026-08-08T12:00:00.000Z');
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  history: undefined as unknown,
  historyHook: vi.fn(),
  temperatureUnit: '°C' as '°C' | '°F',
}));
const refetch = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: unknown) => {
      const text = typeof fallback === 'string' ? fallback : key;
      const values =
        options && typeof options === 'object'
          ? (options as Record<string, unknown>)
          : {};
      return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) =>
        values[name] != null ? String(values[name]) : '',
      );
    },
    i18n: { language: 'en-US', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/api/hooks/useVehicleSystems', () => ({
  useClimateHistory: (vehicleId: string) => {
    h.historyHook(vehicleId);
    return h.history;
  },
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: h.vehicleId }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      temperature: h.temperatureUnit,
      duration: 'min',
    },
    formatTemperature: (
      value: number | null | undefined,
      options?: { precision?: number },
    ) => {
      if (value == null || !Number.isFinite(value)) return '—';
      const converted = h.temperatureUnit === '°F' ? (value * 9) / 5 + 32 : value;
      return `${converted.toFixed(options?.precision ?? 1)}${h.temperatureUnit}`;
    },
    formatDuration: (
      value: number | null | undefined,
      options?: { precision?: number },
    ) =>
      value == null || !Number.isFinite(value)
        ? '—'
        : `${(value / 60).toFixed(options?.precision ?? 1)} min`,
  }),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select">Vehicle picker</div>,
}));

vi.mock('@/components/charts', () => ({
  Bar: () => null,
  BarChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  ChartContainer: ({
    children,
    title,
    ariaLabel,
  }: {
    children: ReactNode;
    title: string;
    ariaLabel: string;
  }) => (
    <div>
      <h4>{title}</h4>
      <div role="img" aria-label={ariaLabel}>{children}</div>
    </div>
  ),
  ChartTooltip: () => null,
  Legend: () => null,
  Line: () => null,
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Scatter: () => null,
  ScatterChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

import CabinThermalPage from './CabinThermalPage';

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function query(overrides: Partial<QueryStub> = {}): QueryStub {
  const isLoading = overrides.isLoading ?? false;
  const isError = overrides.isError ?? false;
  return {
    data: undefined,
    isLoading,
    isSuccess: overrides.isSuccess ?? (!isLoading && !isError),
    isError,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: BASE,
    refetch,
    ...overrides,
  };
}

function soak(
  startOffsetMin = 0,
  startC = 40,
  ambientC = 20,
  tauMin = 90,
): ClimateState[] {
  return Array.from({ length: 12 }, (_, index) => ({
    timestamp: new Date(BASE + (startOffsetMin + index * 10) * 60_000).toISOString(),
    insideTemp:
      ambientC + (startC - ambientC) * Math.exp(-(index * 10) / tauMin),
    outsideTemp: ambientC,
    hvacPower: false,
    isAcOn: false,
  }));
}

function allRejected(count: number): ClimateState[] {
  return Array.from({ length: count }, (_, windowIndex) =>
    Array.from({ length: 4 }, (_, sampleIndex) => ({
      timestamp: new Date(
        BASE + (windowIndex * 120 + sampleIndex * 10) * 60_000,
      ).toISOString(),
      insideTemp: 21.5 - sampleIndex * 0.1,
      outsideTemp: 20,
      hvacPower: false,
      isAcOn: false,
    })),
  ).flat();
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/cabin-thermal']}>
      <CabinThermalPage />
    </MemoryRouter>,
  );
}

const sectionIds = [
  'cabin-thermal-kpis',
  'cabin-thermal-source-coverage',
  'cabin-thermal-segmentation',
  'cabin-thermal-disposition',
  'cabin-thermal-rejections',
  'cabin-thermal-funnel',
  'cabin-thermal-thresholds',
  'cabin-thermal-candidate-directory',
  'cabin-thermal-fit-quality',
  'cabin-thermal-direction-profile',
  'cabin-thermal-accepted-directory',
  'cabin-thermal-prediction',
  'cabin-thermal-accounting',
  'cabin-thermal-methodology',
] as const;

function expectEverySection(): void {
  for (const id of sectionIds) {
    expect(screen.getByTestId(id)).toBeInTheDocument();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  h.vehicleId = 7;
  h.temperatureUnit = '°C';
  h.history = query({ data: soak() });
});

describe('CabinThermalPage', () => {
  it('renders all fourteen persistent analytical shells with accepted evidence', () => {
    renderPage();

    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Cabin Thermal Model',
    })).toBeInTheDocument();
    expectEverySection();
    expect(h.historyHook).toHaveBeenLastCalledWith('7');
    expect(screen.getByText('Passive-soak curve')).toBeInTheDocument();
  });

  it('keeps every shell and the vehicle control visible without a vehicle', () => {
    h.vehicleId = null;
    h.history = query();
    renderPage();

    expectEverySection();
    expect(screen.getByTestId('vehicle-select')).toBeInTheDocument();
    expect(h.historyHook).toHaveBeenLastCalledWith('');
    expect(screen.getByText(
      'Select a vehicle to analyze its returned climate history.',
    )).toBeInTheDocument();
  });

  it('keeps every shell visible while loading with one live query status', () => {
    h.history = query({ isLoading: true, isSuccess: false });
    renderPage();

    expectEverySection();
    expect(screen.getAllByRole('status', {
      name: 'Loading cabin thermal evidence',
    })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('shows one retry surface for an initial error without removing shells', () => {
    h.history = query({
      isError: true,
      isSuccess: false,
      error: new Error('history unavailable'),
    });
    renderPage();

    expectEverySection();
    expect(screen.getAllByText("Can't reach server")).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows cached evidence with one refresh warning and retry', () => {
    h.history = query({
      data: soak(),
      isError: true,
      isSuccess: false,
      error: new Error('refresh unavailable'),
    });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'Climate history could not refresh. Showing the most recently loaded thermal evidence.',
    )).toBeInTheDocument();
    expect(screen.getByText('Passive-soak curve')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps all shells informative for an empty successful response', () => {
    h.history = query({ data: [] });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'The climate endpoint returned no rows, so no thermal claim is made.',
    )).toBeInTheDocument();
    expect(within(screen.getByTestId('cabin-thermal-kpis')).getAllByText('0').length)
      .toBeGreaterThan(0);
  });

  it('turns 83 rejected windows into a dense diagnostic workspace', () => {
    h.history = query({ data: allRejected(83) });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'No candidate passed every gate. Rejections below are diagnostics only and do not support a τ estimate.',
    )).toBeInTheDocument();
    expect(screen.getByText(
      'Showing 50 of 83 candidates; 33 omitted by the 50-window display cap.',
    )).toBeInTheDocument();
    expect(screen.getAllByText('Initial gap below threshold').length)
      .toBeGreaterThan(0);
    expect(screen.queryByText('Passive-soak curve')).toBeNull();
  });

  it('survives hostile runtime rows and exposes exclusion accounting', () => {
    h.history = query({
      data: [
        { timestamp: 'bad', insideTemp: 30, outsideTemp: 20 },
        { timestamp: new Date(BASE).toISOString(), insideTemp: Number.NaN, outsideTemp: 20 },
        { timestamp: new Date(BASE + 1).toISOString(), insideTemp: 30, outsideTemp: Number.POSITIVE_INFINITY },
      ],
    });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'Rows were returned, but timestamp or temperature validation excluded every row.',
    )).toBeInTheDocument();
    expect(screen.getByText('Invalid timestamp')).toBeInTheDocument();
    expect(screen.getByText('Nonfinite inside temperature')).toBeInTheDocument();
    expect(screen.getByText('Nonfinite outside temperature')).toBeInTheDocument();
  });

  it('converts SI temperatures at the render boundary', () => {
    h.temperatureUnit = '°F';
    h.history = query({ data: soak() });
    renderPage();

    expect(screen.getByText(/113°F cabin/)).toBeInTheDocument();
    expect(screen.getByText(/5\.4°F/)).toBeInTheDocument();
    expect(screen.getAllByText(/°F/).length).toBeGreaterThan(1);
  });
});
