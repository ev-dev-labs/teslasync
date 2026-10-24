import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const NOW = Date.now();
let mockTempUnit: '°C' | '°F' = '°C';
let mockMotor: MotorQuery = makeQuery();
let mockVehicles: { data: Vehicle[] | undefined } = { data: [] };
const mockMotorHook = vi.fn();
const mockDynamicsHook = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const template = typeof fallback === 'string' ? fallback : key;
      return options ? template.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options[name] ?? '')) : template;
    },
  }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { temperature: mockTempUnit } }),
}));

vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return {
    ...actual,
    useVehicles: () => mockVehicles,
    useMotorLatest: (id: number, interval?: number) => {
      mockMotorHook(id, interval);
      return mockMotor;
    },
    useDriveDynamicsLatest: (id: number, interval?: number) => {
      mockDynamicsHook(id, interval);
      return mockMotor.data && 'lateral_accel' in mockMotor.data
        ? { data: {
            lateral_acceleration: (mockMotor.data as Record<string, unknown>).lateral_accel,
            longitudinal_acceleration: (mockMotor.data as Record<string, unknown>).longitudinal_accel,
          } }
        : { data: null };
    },
  };
});

import MotorPerformanceWidget, { torqueColor } from './MotorPerformanceWidget';
import type { WidgetSize } from './types';
import type { MotorSnapshot } from '@/api/types';
import type { Vehicle } from '@/types/vehicle';

interface MotorQuery {
  data: MotorSnapshot | null | undefined;
  isLoading: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };

function makeMotor(overrides: Partial<MotorSnapshot> & Record<string, unknown> = {}): MotorSnapshot {
  return {
    ts: '2026-07-05T12:00:00Z', created_at: '2026-07-05T12:00:00Z',
    torque_nm_front: null, torque_nm_rear: null, di_torque: null,
    motor_rpm_front: null, motor_rpm_rear: null,
    motor_temp_c_front: null, motor_temp_c_rear: null,
    inverter_temp_c: null, inverter_temp_rear: null,
    heatsink_temp_front: null, heatsink_temp_rear: null,
    motor_current_front: null, motor_current_rear: null,
    state_front: null, state_rear: null, shift_state: null,
    vbat_front: null, vbat_rear: null, di_stator_temp: null, gear: null,
    ...overrides,
  } as MotorSnapshot;
}

function makeQuery(overrides: Partial<MotorQuery> = {}): MotorQuery {
  return {
    data: makeMotor(), isLoading: false, error: null, isFetching: false,
    isStale: false, isError: false, dataUpdatedAt: NOW, refetch: vi.fn(), ...overrides,
  };
}

function renderWidget(size: WidgetSize, opts: { query?: MotorQuery; vehicles?: Vehicle[]; vehicleId?: number; tempUnit?: '°C' | '°F' } = {}) {
  mockMotor = opts.query ?? makeQuery();
  mockVehicles = { data: opts.vehicles ?? [] };
  mockTempUnit = opts.tempUnit ?? '°C';
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MotorPerformanceWidget vehicleId={opts.vehicleId} size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockMotor = makeQuery();
  mockVehicles = { data: [] };
  mockTempUnit = '°C';
  mockMotorHook.mockClear();
  mockDynamicsHook.mockClear();
});
afterEach(cleanup);

describe('MotorPerformanceWidget redesign', () => {
  it('uses one headline torque value and verified secondary motor readings', () => {
    renderWidget(FULL, { query: makeQuery({ data: makeMotor({
      di_torque: 150, di_stator_temp: 30, gear: 'D',
      lateral_accel: 0.35, longitudinal_accel: -0.12,
    }) }) });
    expect(screen.getByText('Motor performance')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getAllByText('Nm')).toHaveLength(1);
    expect(screen.getByText('Stator temp')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('Gear state')).toBeInTheDocument();
    expect(within(screen.getByText('Gear state').closest('[data-operational-metric]') ?? document.body).getByText('D')).toBeInTheDocument();
    expect(screen.getByText('0.35')).toBeInTheDocument();
    expect(screen.getByText('-0.12')).toBeInTheDocument();
  });

  it('uses SI-to-display temperature conversion without mixing units', () => {
    renderWidget(FULL, { tempUnit: '°F', query: makeQuery({ data: makeMotor({ di_stator_temp: 30 }) }) });
    expect(screen.getByText('86')).toBeInTheDocument();
    expect(screen.getByText('°F')).toBeInTheDocument();
  });

  it('formats unknown readings as honest placeholders and never fabricates a zero', () => {
    renderWidget(FULL, { query: makeQuery({ data: makeMotor() }) });
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('shows a useful parked informational empty state', () => {
    renderWidget(FULL, { query: makeQuery({ data: null }) });
    expect(screen.getByText('No motor data')).toBeInTheDocument();
  });

  it('keeps retained data after a refresh failure and exposes freshness refresh', () => {
    const refetch = vi.fn();
    renderWidget(FULL, { query: makeQuery({
      data: makeMotor({ di_torque: 125 }), isError: true, isStale: true, dataUpdatedAt: NOW - 180_000, refetch,
    }) });
    expect(screen.getByText('125')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('uses the compact one-headline layout', () => {
    renderWidget(COMPACT, { query: makeQuery({ data: makeMotor({ di_torque: 150, gear: 'D' }) }) });
    expect(screen.getByRole('heading', { name: 'Motor performance', level: 3 })).toBeVisible();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('Torque')).toBeInTheDocument();
  });

  it('polls resolved vehicles at the live interval', () => {
    renderWidget(FULL, { vehicleId: 7 });
    expect(mockMotorHook).toHaveBeenCalledWith(7, 5000);
    expect(mockDynamicsHook).toHaveBeenCalledWith(7, 5000);
    mockMotorHook.mockClear();
    renderWidget(FULL, { vehicles: [{ id: 3 } as Vehicle] });
    expect(mockMotorHook).toHaveBeenCalledWith(3, 5000);
  });

  it('retains neutral status color separation in the torque helper', () => {
    expect(torqueColor(150)).toBe('#10b981');
    expect(torqueColor(250)).toBe('#f59e0b');
    expect(torqueColor(500)).toBe('#ef4444');
  });
});
