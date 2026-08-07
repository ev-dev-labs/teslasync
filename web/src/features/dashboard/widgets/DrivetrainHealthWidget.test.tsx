/**
 * DrivetrainHealthWidget — behaviour, branch + hardening coverage.
 *
 * The widget is the dashboard's drivetrain-health tile. It merges two data
 * sources — the drivetrain-health assessment (`useDrivetrainHealth`) and the
 * latest motor snapshot (`useMotorLatest`) — into a health gauge plus a
 * four-up temperature / drive-state stat row. Its surface under test:
 *
 *   1. The gauge mapping: `overallHealth` → score (good 95 / warning 60 /
 *      critical 25) → arc colour (green / amber / red), and the descriptive
 *      status label BELOW the ring. (Regression guard: the label used to be
 *      `${fmtInt(score)}` — it duplicated the numeric score already shown in
 *      the gauge centre instead of describing the health state, unlike every
 *      sibling gauge widget which uses `label` for a descriptor.)
 *   2. The SI→display temperature conversion the widget owns: health/motor
 *      emit °C; the widget converts to the user's unit with the REAL
 *      `convertTempFromSI`, so the °C and °F branches are genuinely exercised.
 *   3. The health-primary-then-motor `??` fallback chain for each stat, and the
 *      em-dash placeholder when a reading is absent.
 *   4. Responsive layout: standard renders a titled shell + gauge + stat row;
 *      compact (cols ≤ 1) drops the title and the stat row.
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
 *     REAL number formatter, REAL convertTempFromSI, and REAL LinearGauge /
 *     WidgetShell, so conversions + the gauge arc are genuinely rendered
 *     (LinearGauge is pure SVG — no recharts ResponsiveContainer to shim).
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
import { render, screen, fireEvent } from '@testing-library/react';
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
import { gaugeColor } from '@/test/gaugeTestUtils';

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

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <DrivetrainHealthWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

/** The fill colour the LinearGauge is painted with. */
function gaugeArc(container: HTMLElement): string | undefined {
  return gaugeColor(container);
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

describe('DrivetrainHealthWidget', () => {
  it('renders the titled shell, health gauge and four stats in °C', () => {
    const { container } = renderWidget();

    expect(screen.getByText('Drivetrain Health')).toBeInTheDocument();

    // The gauge status label is descriptive (regression guard: it previously
    // duplicated the numeric score) and the score appears exactly once.
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getAllByText('95')).toHaveLength(1);

    // Stats: health-primary temps + motor-sourced stator + drive state.
    expect(screen.getByText('Motor Temp')).toBeInTheDocument();
    expect(screen.getByText('55')).toBeInTheDocument();
    expect(screen.getByText('Stator Temp')).toBeInTheDocument();
    expect(screen.getByText('48')).toBeInTheDocument();
    expect(screen.getByText('Inverter')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('Drive State')).toBeInTheDocument();
    expect(screen.getByText('Drive')).toBeInTheDocument();

    // The three temperature stats carry the °C unit.
    expect(screen.getAllByText('°C')).toHaveLength(3);

    // Good health → green arc.
    expect(gaugeArc(container)).toBe('#10b981');
  });

  it('maps warning health to a 60 score, amber arc and "Warning" label', () => {
    healthMock.mockReturnValue(makeQuery({ data: makeHealth({ overallHealth: 'warning' }) }));
    const { container } = renderWidget();

    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
    expect(gaugeArc(container)).toBe('#f59e0b');
  });

  it('maps critical health to a 25 score, red arc and "Critical" label', () => {
    healthMock.mockReturnValue(makeQuery({ data: makeHealth({ overallHealth: 'critical' }) }));
    const { container } = renderWidget();

    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(gaugeArc(container)).toBe('#ef4444');
  });

  it('applies the real SI→°F conversion at the display boundary', () => {
    setTemp('°F');
    renderWidget();

    // 55°C → 131°F; every temperature stat now reads in °F.
    expect(screen.getByText('131')).toBeInTheDocument();
    expect(screen.getAllByText('°F')).toHaveLength(3);

    // The Celsius reading + unit must be gone once converted.
    expect(screen.queryByText('55')).not.toBeInTheDocument();
    expect(screen.queryByText('°C')).not.toBeInTheDocument();
  });

  it('fills temperature gaps from the motor snapshot when health omits them', () => {
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
    renderWidget();

    // Motor Temp falls back to motor_temp_c_front, Inverter to inverter_temp_c.
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('44')).toBeInTheDocument();
    expect(screen.getByText('33')).toBeInTheDocument();
    expect(screen.getByText('Park')).toBeInTheDocument();
  });

  it('drops the title and stats in the compact 1-column layout', () => {
    renderWidget({ cols: 1, rows: 1 });

    // The gauge (with its status label) still renders.
    expect(screen.getByText('Healthy')).toBeInTheDocument();

    // Compact hides the title and the stat row.
    expect(screen.queryByText('Drivetrain Health')).not.toBeInTheDocument();
    expect(screen.queryByText('Motor Temp')).not.toBeInTheDocument();
  });

  it('shows the empty state (keeping the titled shell) when both sources are empty', () => {
    healthMock.mockReturnValue(makeQuery({ data: null }));
    motorMock.mockReturnValue(makeQuery({ data: null }));
    renderWidget();

    expect(screen.getByText('Drivetrain Health')).toBeInTheDocument();
    expect(screen.getByText('No drivetrain data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();

    // No gauge / stats while empty.
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    expect(screen.queryByText('Motor Temp')).not.toBeInTheDocument();
  });

  it('shows the empty state without a title in the compact layout', () => {
    healthMock.mockReturnValue(makeQuery({ data: null }));
    motorMock.mockReturnValue(makeQuery({ data: null }));
    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('No drivetrain data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Drivetrain Health')).not.toBeInTheDocument();
  });

  it('renders a skeleton placeholder while a source query is loading', () => {
    healthMock.mockReturnValue(makeQuery({ isLoading: true, data: undefined, dataUpdatedAt: 0 }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    // No header/gauge while loading.
    expect(screen.queryByText('Drivetrain Health')).not.toBeInTheDocument();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
  });

  it('surfaces the shared error panel when the health query fails', () => {
    healthMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, data: undefined, dataUpdatedAt: 0 }),
    );
    renderWidget();

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // The error panel replaces the gauge + header (and its refresh control).
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  });

  it('refetches when the freshness refresh control is activated', () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    healthMock.mockReturnValue(
      makeQuery({ data: makeHealth(), refetch, dataUpdatedAt: Date.now() }),
    );
    renderWidget();

    const refresh = screen.getByRole('button', { name: 'Refresh' });
    expect(refetch).not.toHaveBeenCalled();
    fireEvent.click(refresh);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to the first vehicle when no vehicleId prop is supplied', () => {
    renderWidget();

    // Health takes the stringified id; motor-latest takes the numeric id.
    expect(healthMock).toHaveBeenCalledWith('7');
    expect(motorMock).toHaveBeenCalledWith(7);
  });

  it('uses the explicit vehicleId prop over the vehicle list', () => {
    renderWidget({ cols: 2, rows: 2 }, 42);

    expect(healthMock).toHaveBeenCalledWith('42');
    expect(motorMock).toHaveBeenCalledWith(42);
  });

  it('is null-safe: null temperatures render em-dash placeholders without crashing', () => {
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

    expect(() => renderWidget()).not.toThrow();

    // The three temperature stats collapse to the em-dash placeholder.
    expect(screen.getAllByText('—')).toHaveLength(3);
    // Drive State still resolves from the health motorStatus fallback.
    expect(screen.getByText('Nominal')).toBeInTheDocument();
  });

  it('keeps the skeleton up while the default vehicle is still resolving', () => {
    // No vehicleId prop + vehicles still loading: the health/motor queries are
    // disabled (data undefined, not loading), so without the vehicles-loading
    // gate the widget would flash "No drivetrain data".
    vehiclesMock.mockReturnValue({ data: undefined, isLoading: true });
    healthMock.mockReturnValue(makeQuery({ data: undefined, dataUpdatedAt: 0 }));
    motorMock.mockReturnValue(makeQuery({ data: undefined, dataUpdatedAt: 0 }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('No drivetrain data')).not.toBeInTheDocument();
  });
});
