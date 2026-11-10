import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const NOW = Date.now();
let mockTempUnit: '°C' | '°F' = '°C';
let mockMotor: MotorQuery = makeQuery();
let mockVehicles: { data: Vehicle[] | undefined } = { data: [] };
let mockDynamics: DriveDynamicsSnapshot | null = null;
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
      return { data: mockDynamics };
    },
  };
});

import MotorPerformanceWidget, { torqueColor } from './MotorPerformanceWidget';
import type { WidgetSize } from './types';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';
import type { DriveDynamicsSnapshot, MotorSnapshot } from '@/api/types';
import type { Vehicle } from '@/types/vehicle';
import { COLOR } from '@/lib/colors';

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

function makeMotor(overrides: Partial<MotorSnapshot> = {}): MotorSnapshot {
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
  };
}

function makeQuery(overrides: Partial<MotorQuery> = {}): MotorQuery {
  return {
    data: makeMotor(), isLoading: false, error: null, isFetching: false,
    isStale: false, isError: false, dataUpdatedAt: NOW, refetch: vi.fn(), ...overrides,
  };
}

interface RenderOptions {
  query?: MotorQuery;
  vehicles?: Vehicle[];
  vehicleId?: number;
  tempUnit?: '°C' | '°F';
  dynamics?: DriveDynamicsSnapshot | null;
}

function renderWidget(packId: PackId, size: WidgetSize, opts: RenderOptions = {}) {
  mockMotor = opts.query ?? makeQuery();
  mockVehicles = { data: opts.vehicles ?? [] };
  mockTempUnit = opts.tempUnit ?? '°C';
  mockDynamics = opts.dynamics ?? null;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MotorPerformanceWidget vehicleId={opts.vehicleId} size={size} />,
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <PackBoundary requestedPackId={packId}>{children}</PackBoundary>
          </MemoryRouter>
        </QueryClientProvider>
      ),
    },
  );
}

async function expectPresentation(container: HTMLElement, packId: PackId) {
  expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
  if (packId === 'classic') {
    expect(container.querySelector('[data-status-appearance]')).not.toBeInTheDocument();
  } else {
    await waitFor(() => {
      expect(container.querySelector('[data-status-appearance]'))
        .toHaveAttribute('data-status-appearance', PACK_APPEARANCES[packId]);
    });
  }
}

beforeEach(() => {
  mockMotor = makeQuery();
  mockVehicles = { data: [] };
  mockDynamics = null;
  mockTempUnit = '°C';
  mockMotorHook.mockClear();
  mockDynamicsHook.mockClear();
});
afterEach(cleanup);

describe.each(PACK_IDS)('MotorPerformanceWidget %s', (packId) => {
  it('uses its shared presentation with one torque headline and all secondary readings', async () => {
    const { container } = renderWidget(packId, FULL, { query: makeQuery({ data: makeMotor({
      di_torque: 150, di_stator_temp: 30, gear: 'D',
    }) }), dynamics: { lateral_acceleration: 0.35, longitudinal_acceleration: -0.12 } });
    await expectPresentation(container, packId);
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

  it('uses SI-to-display temperature conversion without mixing units', async () => {
    const { container } = renderWidget(packId, FULL, { tempUnit: '°F', query: makeQuery({ data: makeMotor({ di_stator_temp: 30 }) }) });
    await expectPresentation(container, packId);
    expect(screen.getByText('86')).toBeInTheDocument();
    expect(screen.getByText('°F')).toBeInTheDocument();
    expect(screen.queryByText('°C')).not.toBeInTheDocument();
  });

  it('formats unknown readings as honest placeholders and never fabricates a zero', async () => {
    const { container } = renderWidget(packId, FULL, { query: makeQuery({ data: makeMotor() }) });
    await expectPresentation(container, packId);
    expect(screen.getAllByText('—')).toHaveLength(5);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('Nm')).not.toBeInTheDocument();
    expect(screen.queryByText('°C')).not.toBeInTheDocument();
    expect(screen.queryByText('g')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it.each([FULL, COMPACT])('shows a useful parked informational empty state at %j', (size) => {
    renderWidget(packId, size, { query: makeQuery({ data: null }) });
    expect(screen.getByText('No motor data')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Motor performance' })).toBeVisible();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('keeps retained data after a refresh failure and exposes freshness refresh', async () => {
    const refetch = vi.fn();
    const { container } = renderWidget(packId, FULL, { query: makeQuery({
      data: makeMotor({ di_torque: 125 }), error: new Error('Refresh failed'),
      isError: true, isStale: true, dataUpdatedAt: NOW - 180_000, refetch,
    }) });
    await expectPresentation(container, packId);
    expect(screen.getByText('125')).toBeInTheDocument();
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'stale');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('uses the compact one-headline layout', async () => {
    const { container } = renderWidget(packId, COMPACT, { query: makeQuery({ data: makeMotor({ di_torque: 150, gear: 'D' }) }) });
    await expectPresentation(container, packId);
    expect(screen.getByRole('heading', { name: 'Motor performance', level: 3 })).toBeVisible();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('Torque')).toBeInTheDocument();
    expect(screen.queryByText('Gear state')).not.toBeInTheDocument();
  });

  it('polls resolved vehicles at the live interval', () => {
    const selected = renderWidget(packId, FULL, { vehicleId: 7 });
    expect(mockMotorHook).toHaveBeenCalledWith(7, 5000);
    expect(mockDynamicsHook).toHaveBeenCalledWith(7, 5000);
    selected.unmount();
    mockMotorHook.mockClear();
    mockDynamicsHook.mockClear();
    renderWidget(packId, FULL, { vehicles: [{ id: 3 } as Vehicle] });
    expect(mockMotorHook).toHaveBeenCalledWith(3, 5000);
    expect(mockDynamicsHook).toHaveBeenCalledWith(3, 5000);
  });

  it('preserves measured zeros and a parked gear instead of treating them as missing', async () => {
    const { container } = renderWidget(packId, FULL, {
      query: makeQuery({ data: makeMotor({ di_torque: 0, di_stator_temp: 0, gear: 'P' }) }),
      dynamics: { lateral_acceleration: 0, longitudinal_acceleration: 0 },
    });
    await expectPresentation(container, packId);
    expect(screen.getAllByText('0')).toHaveLength(2);
    expect(screen.getAllByText('0.00')).toHaveLength(2);
    expect(screen.getByText('Nm')).toBeInTheDocument();
    expect(screen.getByText('°C')).toBeInTheDocument();
    expect(screen.getAllByText('g')).toHaveLength(2);
    expect(screen.getByText('P')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('keeps signed braking torque and fallback motor temperature and gear', async () => {
    const { container } = renderWidget(packId, FULL, {
      tempUnit: '°F',
      query: makeQuery({ data: makeMotor({ di_torque: -80, motor_temp_c_front: 20, shift_state: 'R' }) }),
    });
    await expectPresentation(container, packId);
    expect(screen.getByText('-80')).toBeInTheDocument();
    expect(screen.getByText('Nm')).toBeInTheDocument();
    expect(screen.getByText('68')).toBeInTheDocument();
    expect(screen.getByText('°F')).toBeInTheDocument();
    expect(screen.getByText('R')).toBeInTheDocument();
  });

  it('rejects non-finite readings and a blank gear without inventing units or zeros', async () => {
    const { container } = renderWidget(packId, FULL, {
      query: makeQuery({ data: makeMotor({ di_torque: NaN, di_stator_temp: Infinity, gear: ' ' }) }),
      dynamics: { lateral_acceleration: -Infinity, longitudinal_acceleration: NaN },
    });
    await expectPresentation(container, packId);
    expect(screen.getAllByText('—')).toHaveLength(5);
    expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('Nm')).not.toBeInTheDocument();
    expect(screen.queryByText('°C')).not.toBeInTheDocument();
    expect(screen.queryByText('g')).not.toBeInTheDocument();
  });

  it('shows initial loading before resolving to its selected presentation', async () => {
    const view = renderWidget(packId, FULL, {
      query: makeQuery({ data: undefined, isLoading: true, isFetching: true, dataUpdatedAt: 0 }),
    });
    expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');
    expect(view.container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'initial');
    expect(screen.queryByText('No motor data')).not.toBeInTheDocument();
    expect(screen.queryByText('Torque')).not.toBeInTheDocument();

    mockMotor = makeQuery({ data: makeMotor({ di_torque: 150 }) });
    view.rerender(<MotorPerformanceWidget size={FULL} />);
    await expectPresentation(view.container, packId);
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'false');
  });

  it('offers retry for an initial failure without presenting missing data as empty or zero', () => {
    const refetch = vi.fn();
    const { container } = renderWidget(packId, FULL, {
      query: makeQuery({
        data: undefined, isError: true, error: new Error('Motor request failed'), dataUpdatedAt: 0, refetch,
      }),
    });
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'initialFailure');
    expect(screen.queryByText('No motor data')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

it('retains neutral status color separation in the torque helper', () => {
  expect(torqueColor(150)).toBe(COLOR.GOOD);
  expect(torqueColor(250)).toBe(COLOR.WARN);
  expect(torqueColor(500)).toBe(COLOR.BAD);
});
