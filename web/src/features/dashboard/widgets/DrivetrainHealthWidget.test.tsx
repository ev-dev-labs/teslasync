/**
 * DrivetrainHealthWidget — behaviour, branch + hardening coverage.
 *
 * The widget is the dashboard's drivetrain-health tile. It merges two data
 * sources — the drivetrain-health assessment (`useDrivetrainHealth`) and the
 * latest motor snapshot (`useMotorLatest`) — into a categorical assessment
 * plus four temperature readings. Its surface under test across every pack:
 *
 *   1. Categorical good / warning / critical / unknown assessments without
 *      fabricating numerical health scores.
 *   2. The SI→display temperature conversion the widget owns: health/motor
 *      emit °C; the widget converts to the user's unit with the REAL
 *      `convertTempFromSI`, so the °C and °F branches are genuinely exercised.
 *   3. Health-primary-then-motor source precedence and unknown readings.
 *   4. Responsive layout: standard renders a titled shell + assessment + readings;
 *      compact (cols ≤ 1) keeps its identity and drops the stat row.
 *   5. Loading / error / empty branches (never a blank panel), including the
 *      hardening that keeps the skeleton up while the default vehicle is still
 *      resolving from `useVehicles` (rather than flashing "No drivetrain data").
 *   6. Freshness-control refresh → refetch.
 *   7. Vehicle selection: an explicit `vehicleId` wins, otherwise the first
 *      vehicle from `useVehicles` is used.
 *
 * Strategy (mirrors AnalyticsSummaryWidget.test.tsx + BatteryDegradationTrendWidget.test.tsx):
 *   - The data hooks + useUnits are mocked with hoisted vi.fn()s so the network
 *     is never touched and every render is deterministic. The widget keeps the
 *     REAL number formatter, REAL convertTempFromSI, REAL WidgetShell and
 *     REAL shared status presentation, so conversions and pack selection
 *     are genuinely rendered.
 *   - react-i18next resolves the developer fallback string.
 *   - matchMedia is shimmed so framer-motion (via the freshness chip) settles.
 *   - Renders are wrapped in <MemoryRouter> because the error branch mounts
 *     <QueryError>, which calls useNavigate.
 *
 * user-event is intentionally NOT a dependency of this codebase (see
 * web/package.json) — interactions use fireEvent, consistent with the other
 * dashboard tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// jsdom lacks matchMedia; framer-motion (useReducedMotion, read by the
// freshness chip) reads it at module load. Report reduced motion so the
// freshness dot settles deterministically.
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
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

const { healthMock, motorMock, vehiclesMock, useUnitsMock } = vi.hoisted(() => ({
  healthMock: vi.fn(),
  motorMock: vi.fn(),
  vehiclesMock: vi.fn(),
  useUnitsMock: vi.fn(),
}));

// i18n → return the developer fallback string, interpolating `{{vars}}`.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const template = typeof fallback === 'string' ? fallback : key;
        const vars = (
          opts && typeof opts === 'object'
            ? opts
            : fallback && typeof fallback === 'object'
              ? fallback
              : undefined
        ) as Record<string, unknown> | undefined;
        if (!vars) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useDriving', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useDriving')>('@/api/hooks/useDriving');
  return { ...actual, useDrivetrainHealth: (...args: unknown[]) => healthMock(...args) };
});

vi.mock('@/api/hooks/useVehicles', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useVehicles')>('@/api/hooks/useVehicles');
  return {
    ...actual,
    useVehicles: () => vehiclesMock(),
    useMotorLatest: (...args: unknown[]) => motorMock(...args),
  };
});

vi.mock('@/hooks/useUnits', () => ({ useUnits: () => useUnitsMock() }));

import DrivetrainHealthWidget from './DrivetrainHealthWidget';
import type { WidgetSize } from './types';
import type { DrivetrainHealthData } from '@/types/driving';
import type { MotorSnapshot } from '@/api/types';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';

/* ── Fixtures ─────────────────────────────────────────────────────── */

function makeHealth(overrides: Partial<DrivetrainHealthData> = {}): DrivetrainHealthData {
  return {
    frontMotorTempC: 55,
    rearMotorTempC: 60,
    inverterTempC: 40,
    batteryTempC: 25,
    motorStatus: 'Nominal',
    overallHealth: 'good',
    ...overrides,
  };
}

function makeMotor(overrides: Partial<MotorSnapshot> = {}): MotorSnapshot {
  return {
    ts: '2024-01-01T00:00:00Z',
    created_at: '2024-01-01T00:00:00Z',
    torque_nm_front: null,
    torque_nm_rear: null,
    di_torque: null,
    motor_rpm_front: null,
    motor_rpm_rear: null,
    motor_temp_c_front: 50,
    motor_temp_c_rear: 52,
    inverter_temp_c: 45,
    inverter_temp_rear: null,
    heatsink_temp_front: null,
    heatsink_temp_rear: null,
    motor_current_front: null,
    motor_current_rear: null,
    state_front: 'Drive',
    state_rear: null,
    shift_state: null,
    vbat_front: null,
    vbat_rear: null,
    di_stator_temp: 48,
    ...overrides,
  };
}

interface FakeQuery {
  data?: unknown;
  error: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

function makeQuery(overrides: Partial<FakeQuery> = {}): FakeQuery {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function setTemp(temperature: '°C' | '°F') {
  useUnitsMock.mockReturnValue({ unitPrefs: { temperature } });
}

function renderWidgetForPack(size: WidgetSize, vehicleId: number | undefined, packId: PackId) {
  return render(
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <DrivetrainHealthWidget size={size} vehicleId={vehicleId} />
      </PackBoundary>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  healthMock.mockReset();
  motorMock.mockReset();
  vehiclesMock.mockReset();
  useUnitsMock.mockReset();

  healthMock.mockReturnValue(makeQuery({ data: makeHealth() }));
  motorMock.mockReturnValue(makeQuery({ data: makeMotor() }));
  vehiclesMock.mockReturnValue({ data: [{ id: 7 }], isLoading: false });
  setTemp('°C');
});

/* ── Specs ────────────────────────────────────────────────────────── */

describe.each(PACK_IDS)('DrivetrainHealthWidget (%s)', (packId) => {
  async function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }, vehicleId?: number) {
    const result = renderWidgetForPack(size, vehicleId, packId);
    const shell = result.container.querySelector('[data-widget-pack]');
    expect(shell).toHaveAttribute('data-widget-pack', packId);
    if (packId !== 'classic' && shell?.getAttribute('data-data-state') !== 'initial') {
      await waitFor(() => {
        expect(result.container.querySelector('[data-status-appearance]'))
          .toHaveAttribute('data-status-appearance', PACK_APPEARANCES[packId]);
      });
    }
    return result;
  }

  it('keeps five real drivetrain operands, source precedence and invalid telemetry without inventing an assessment', async () => {
    healthMock.mockReturnValue(makeQuery({ data: makeHealth({ frontMotorTempC: 0 }) }));
    motorMock.mockReturnValue(makeQuery({ data: makeMotor({ di_stator_temp: Number.NaN }) }));
    await renderWidget();
    const readings = within(screen.getByTestId('dashboard-drivetrain-readings-brief'));
    expect(readings.getByText('0 °C')).toBeVisible();
    expect(readings.queryByText('50 °C')).not.toBeInTheDocument();
    const stator = readings.getAllByRole('listitem').find(item => within(item).queryByText('Stator temp'));
    expect(stator).toBeDefined();
    expect(stator).not.toHaveTextContent(/NaN|Infinity|°C/);
    expect(screen.getAllByText('Healthy').length).toBeGreaterThan(0);
    expect(screen.getByText('Assessment from available telemetry; not a mechanical inspection.')).toBeInTheDocument();
  });

  it('never infers health from a motor snapshot without an assessment', async () => {
    healthMock.mockReturnValue(makeQuery({ data: null }));
    motorMock.mockReturnValue(makeQuery({ data: makeMotor({ di_stator_temp: null }) }));
    await renderWidget();
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.getAllByText(/52.*°C/).length).toBeGreaterThan(0);
  });

  it('keeps a retained categorical assessment visible after a failed refresh', async () => {
    healthMock.mockReturnValue(makeQuery({ data: makeHealth(), isError: true, error: new Error('refresh') }));
    const { container } = await renderWidget();
    expect(screen.getAllByText('Healthy').length).toBeGreaterThan(0);
    expect(container.querySelector('[data-data-state="stale"]')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('role', 'status');
  });

  it('renders the titled shell, categorical assessment and four stats in °C', async () => {
    await renderWidget();

    expect(screen.getByText('Drivetrain health')).toBeInTheDocument();

    expect(screen.getAllByText('Healthy').length).toBeGreaterThan(0);
    expect(screen.queryByText('95')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();

    expect(screen.queryAllByText(/Motor temp|Front motor/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/55.*°C/).length).toBeGreaterThan(0);
    expect(screen.getByText('Stator temp')).toBeInTheDocument();
    expect(screen.getAllByText(/48.*°C/).length).toBeGreaterThan(0);
    expect(screen.getByText('Inverter')).toBeInTheDocument();
    expect(screen.getAllByText(/40.*°C/).length).toBeGreaterThan(0);

    expect(screen.getAllByText(/^-?\d+(?:\.\d+)? °C$/)).toHaveLength(4);
  });

  it('reports warning categorically without fabricating a numeric score', async () => {
    healthMock.mockReturnValue(makeQuery({ data: makeHealth({ overallHealth: 'warning' }) }));
    await renderWidget();

    expect(screen.getAllByText('Warning').length).toBeGreaterThan(0);
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('reports a critical assessment without inventing a percentage', async () => {
    healthMock.mockReturnValue(makeQuery({ data: makeHealth({ overallHealth: 'critical' }) }));
    await renderWidget();

    expect(screen.getAllByText('Critical').length).toBeGreaterThan(0);
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('applies the real SI→°F conversion at the display boundary', async () => {
    setTemp('°F');
    await renderWidget();

    // 55°C → 131°F; every temperature stat now reads in °F.
    expect(screen.getAllByText(/131.*°F/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^-?\d+ °F$/)).toHaveLength(4);

    // The Celsius reading + unit must be gone once converted.
    expect(screen.queryByText('55.00')).not.toBeInTheDocument();
    expect(screen.queryByText('°C')).not.toBeInTheDocument();
  });

  it('fills temperature gaps from the motor snapshot when health omits them', async () => {
    healthMock.mockReturnValue(
      makeQuery({ data: makeHealth({ frontMotorTempC: null, inverterTempC: null }) }),
    );
    motorMock.mockReturnValue(
      makeQuery({
        data: makeMotor({
          motor_temp_c_front: 30,
          inverter_temp_c: 44,
          di_stator_temp: 33,
          state_front: 'Park',
        }),
      }),
    );
    await renderWidget();

    // Motor Temp falls back to motor_temp_c_front, Inverter to inverter_temp_c.
    expect(screen.getAllByText(/30.*°C/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/44.*°C/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/33.*°C/).length).toBeGreaterThan(0);
  });

  it('keeps the heading while omitting detailed stats in the compact layout', async () => {
    await renderWidget({ cols: 1, rows: 1 });

    expect(screen.getAllByText('Healthy').length).toBeGreaterThan(0);

    expect(screen.getByRole('heading', { name: 'Drivetrain health' })).toBeInTheDocument();
    expect(screen.queryAllByText(/Motor temp|Front motor/)).toHaveLength(0);
  });

  it('shows the empty state (keeping the titled shell) when both sources are empty', async () => {
    healthMock.mockReturnValue(makeQuery({ data: null }));
    motorMock.mockReturnValue(makeQuery({ data: null }));
    await renderWidget();

    expect(screen.getByText('Drivetrain health')).toBeInTheDocument();
    expect(screen.getByText('No drivetrain data')).toBeInTheDocument();
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);

    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    expect(screen.queryAllByText(/Motor temp|Front motor/).length).toBeGreaterThan(0);
  });

  it('keeps the compact heading when both sources are empty', async () => {
    healthMock.mockReturnValue(makeQuery({ data: null }));
    motorMock.mockReturnValue(makeQuery({ data: null }));
    await renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('No drivetrain data')).toBeInTheDocument();
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Drivetrain health' })).toBeInTheDocument();
  });

  it('keeps motor evidence visible while the assessment is loading', async () => {
    healthMock.mockReturnValue(makeQuery({ isLoading: true, data: undefined, dataUpdatedAt: 0 }));
    const { container } = await renderWidget();

    expect(container.querySelector('[data-data-state="partial"]')).toBeInTheDocument();
    expect(screen.getAllByText(/48.*°C/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Drivetrain health')).toBeInTheDocument();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
  });

  it('retains motor evidence when the assessment initially fails', async () => {
    healthMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, data: undefined, dataUpdatedAt: 0 }),
    );
    await renderWidget();

    expect(screen.getByRole('alert')).toHaveTextContent('The drivetrain assessment could not be loaded.');
    expect(screen.getAllByText(/48.*°C/).length).toBeGreaterThan(0);

    // Only the failed assessment is replaced; the motor evidence stays visible.
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Refresh/i }).length).toBeGreaterThan(0);
  });

  it('refetches both sources when the freshness refresh control is activated', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    const refetchMotor = vi.fn().mockResolvedValue(undefined);
    healthMock.mockReturnValue(
      makeQuery({ data: makeHealth(), refetch, dataUpdatedAt: Date.now() }),
    );
    motorMock.mockReturnValue(makeQuery({ data: makeMotor(), refetch: refetchMotor }));
    await renderWidget();

    const refresh = screen.getByRole('button', { name: /^Refresh/i });
    expect(refetch).not.toHaveBeenCalled();
    expect(refetchMotor).not.toHaveBeenCalled();
    fireEvent.click(refresh);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetchMotor).toHaveBeenCalledTimes(1);
  });

  it('falls back to the first vehicle when no vehicleId prop is supplied', async () => {
    await renderWidget();

    // Health takes the stringified id; motor-latest takes the numeric id.
    expect(healthMock).toHaveBeenCalledWith('7');
    expect(motorMock).toHaveBeenCalledWith(7);
  });

  it('uses the explicit vehicleId prop over the vehicle list', async () => {
    await renderWidget({ cols: 2, rows: 2 }, 42);

    expect(healthMock).toHaveBeenCalledWith('42');
    expect(motorMock).toHaveBeenCalledWith(42);
  });

  it('is null-safe: null temperatures remain unknown without fabricating readings', async () => {
    healthMock.mockReturnValue(
      makeQuery({
        data: makeHealth({
          frontMotorTempC: null,
          rearMotorTempC: null,
          inverterTempC: null,
          motorStatus: 'Nominal',
        }),
      }),
    );
    motorMock.mockReturnValue(makeQuery({ data: null }));

    await renderWidget();

    expect(screen.queryByText('—')).not.toBeInTheDocument();
    const readings = within(screen.getByTestId('dashboard-drivetrain-readings-brief'));
    expect(readings.getAllByText('Unknown')).toHaveLength(4);
    expect(readings.queryByText(/°C/)).not.toBeInTheDocument();
  });

  it('keeps the skeleton up while the default vehicle is still resolving', async () => {
    // No vehicleId prop + vehicles still loading: the health/motor queries are
    // disabled (data undefined, not loading), so without the vehicles-loading
    // gate the widget would flash "No drivetrain data".
    vehiclesMock.mockReturnValue({ data: undefined, isLoading: true });
    healthMock.mockReturnValue(makeQuery({ data: undefined, dataUpdatedAt: 0 }));
    motorMock.mockReturnValue(makeQuery({ data: undefined, dataUpdatedAt: 0 }));
    const { container } = await renderWidget();

    expect(container.querySelector('[class*="--skeleton-bg"]')).toBeInTheDocument();
    expect(screen.queryByText('No drivetrain data')).not.toBeInTheDocument();
  });
});
