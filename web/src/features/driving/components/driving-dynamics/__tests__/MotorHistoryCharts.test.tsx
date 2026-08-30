/**
 * MotorHistoryCharts — behaviour, empty-state gating, and a11y coverage.
 *
 * The component renders three motor-telemetry traces (power/regen area,
 * front+rear torque line, front+rear rpm line) inside shared
 * <ChartContainer> figures. Recharts' <ResponsiveContainer> measures 0×0
 * under jsdom, so the plotted SVG never paints — assertions therefore
 * target the always-present container chrome (figure name = title,
 * inner role="img" = ariaLabel) and the "Awaiting motor telemetry data"
 * placeholder that each chart falls back to.
 *
 * Regression pinned here (hardening done alongside this suite): a chart
 * used to render whenever `motorHistory.length > 0`, which left an
 * axis-only blank frame when the sampled window carried the *other*
 * signals but not this chart's series (e.g. a torque-only telemetry
 * burst, or a car that never reports per-axle rpm). Each chart now gates
 * on "has at least one finite value in any of its series" so those cases
 * degrade to the placeholder instead of a mute frame — while a genuine
 * `0` reading still counts as data.
 *
 * i18n is stubbed to return the English fallback; <ChartContainer>'s
 * export + annotation hooks are mocked so the container renders without a
 * live backend. `useSettings` / `useTimezone` are already globally stubbed
 * in src/test-setup.ts, which makes `useDateFormat().formatTime` hermetic.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') return fallbackOrOpts;
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') return o.defaultValue;
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// <ChartContainer> reaches html2canvas-pro / FileSaver territory via
// useChartExport and the annotation query hooks — stub both to no-ops that
// match the production return shape (mirrors the shared ChartContainer tests).
vi.mock('@/hooks/useChartExport', () => ({
  useChartExport: () => ({
    chartRef: { current: null },
    exportPNG: vi.fn(),
    exportSVG: vi.fn(),
    copyToClipboard: vi.fn(async () => 'copied' as const),
    exporting: false,
  }),
}));

vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotationsAsData: () => ({ annotations: [] }),
  useCreateAnnotation: () => ({ mutate: vi.fn() }),
  useDeleteAnnotation: () => ({ mutate: vi.fn() }),
}));

import MotorHistoryCharts from '../MotorHistoryCharts';
import type { MotorSnapshot } from '@/api/types';

// The charts now own the ['motor-history', …] query (shared with
// useMotorStats) instead of receiving rows as a prop, so they refresh as new
// telemetry lands. The fetch is stubbed and driven from `mockMotorHistory`.
let mockMotorHistory: MotorSnapshot[] | undefined;

vi.mock('@/api/hooks/useVehicles', () => ({
  useMotorHistory: () => ({
    data: mockMotorHistory,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
  }),
}));

const AWAITING = 'Awaiting motor telemetry data...';

const POWER_TITLE = /Motor Power Over Time/;
const TORQUE_TITLE = /Motor Torque History/;
const RPM_TITLE = /Motor RPM History/;

/**
 * Full-shape MotorSnapshot factory: every required series field defaults to
 * null so a bare `snap()` models a sample that carries *no* plottable value.
 * Individual tests opt specific series in via overrides.
 */
function snap(overrides: Partial<MotorSnapshot> = {}): MotorSnapshot {
  return {
    ts: '2026-05-10T12:00:00Z',
    created_at: '2026-05-10T12:00:00Z',
    torque_nm_front: null,
    torque_nm_rear: null,
    di_torque: null,
    motor_rpm_front: null,
    motor_rpm_rear: null,
    motor_temp_c_front: null,
    motor_temp_c_rear: null,
    inverter_temp_c: null,
    inverter_temp_rear: null,
    heatsink_temp_front: null,
    heatsink_temp_rear: null,
    motor_current_front: null,
    motor_current_rear: null,
    state_front: null,
    state_rear: null,
    shift_state: null,
    vbat_front: null,
    vbat_rear: null,
    ...overrides,
  };
}

/** A sample with every chart's series populated. */
function fullSnap(ts: string): MotorSnapshot {
  return snap({
    ts,
    created_at: ts,
    power_kw: 120,
    regen_kw: 15,
    torque_nm_front: 210,
    torque_nm_rear: 260,
    motor_rpm_front: 4200,
    motor_rpm_rear: 4800,
  });
}

// Two required identical props the component accepts but does not consume for
// these native-unit charts (kW / Nm / RPM). Passed for API fidelity.
const commonProps = { toSpeedDisplay: (v: number) => v, speedUnit: 'mph' };

function renderCharts(motorHistory: MotorSnapshot[] | undefined) {
  mockMotorHistory = motorHistory;
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MotorHistoryCharts vehicleId={1} {...commonProps} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MotorHistoryCharts', () => {
  it('renders all three motor-telemetry charts as titled, labelled figures', () => {
    renderCharts([fullSnap('2026-05-10T12:00:00Z'), fullSnap('2026-05-10T12:01:00Z')]);

    // Each <ChartContainer> is a <figure> named by its title heading.
    expect(screen.getByRole('figure', { name: POWER_TITLE })).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: TORQUE_TITLE })).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: RPM_TITLE })).toBeInTheDocument();

    // Subtitles render descriptive prose for each trace.
    expect(screen.getByText('Drive and regen power from motor telemetry')).toBeInTheDocument();
    expect(screen.getByText('Front and rear motor torque over time')).toBeInTheDocument();
    expect(screen.getByText('Front and rear motor RPM over time')).toBeInTheDocument();
  });

  it('exposes a screen-reader image role with a descriptive name for each chart body', () => {
    renderCharts([fullSnap('2026-05-10T12:00:00Z'), fullSnap('2026-05-10T12:01:00Z')]);

    // Each interactive chart is a named group so its legend controls do not
    // sit inside image semantics.
    expect(
      screen.getByRole('group', { name: 'Motor power and regen over time area chart' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Front and rear motor torque over time line chart' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Front and rear motor RPM over time line chart' }),
    ).toBeInTheDocument();
  });

  it('shows the awaiting-data placeholder in every chart when history is undefined', () => {
    // Null-safety: an undefined `motorHistory` must degrade to placeholders
    // (each useMemo guards with `motorHistory ?? []`) rather than throwing.
    expect(() => renderCharts(undefined)).not.toThrow();
    expect(screen.getAllByText(AWAITING)).toHaveLength(3);
    // The figures still render even with no data.
    expect(screen.getByRole('figure', { name: POWER_TITLE })).toBeInTheDocument();
  });

  it('shows the placeholder in every chart when history is an empty array', () => {
    renderCharts([]);
    expect(screen.getAllByText(AWAITING)).toHaveLength(3);
  });

  it('plots every chart (no placeholder) when all series carry values', () => {
    renderCharts([fullSnap('2026-05-10T12:00:00Z'), fullSnap('2026-05-10T12:01:00Z')]);
    // No chart falls back to the empty state when data is fully populated.
    expect(screen.queryByText(AWAITING)).toBeNull();
    expect(screen.getByRole('figure', { name: TORQUE_TITLE })).toBeInTheDocument();
  });

  it('falls back per-chart: renders power but places holders for the null torque/rpm series', () => {
    // A power-only window: power + regen present, torque + rpm all null.
    // Pre-hardening the torque/rpm charts would still render an axis-only
    // blank frame because the window has samples; now they degrade cleanly.
    renderCharts([
      snap({ power_kw: 90, regen_kw: 5 }),
      snap({ power_kw: 110, regen_kw: 0 }),
    ]);

    const powerFig = screen.getByRole('figure', { name: POWER_TITLE });
    const torqueFig = screen.getByRole('figure', { name: TORQUE_TITLE });
    const rpmFig = screen.getByRole('figure', { name: RPM_TITLE });

    // Power has data → no placeholder inside its figure.
    expect(within(powerFig).queryByText(AWAITING)).toBeNull();
    // Torque + rpm have no finite value → placeholder shown.
    expect(within(torqueFig).getByText(AWAITING)).toBeInTheDocument();
    expect(within(rpmFig).getByText(AWAITING)).toBeInTheDocument();
    // Exactly two placeholders overall.
    expect(screen.getAllByText(AWAITING)).toHaveLength(2);
  });

  it('treats a window whose samples are all null as empty (no axis-only blank frame)', () => {
    // Two samples exist but carry no series value at all. Every chart must
    // show the placeholder rather than a mute, line-less frame.
    renderCharts([snap(), snap()]);
    expect(screen.getAllByText(AWAITING)).toHaveLength(3);
  });

  it('treats a genuine zero reading as data rather than missing', () => {
    // 0 kW / 0 regen is a real, plottable reading (car stationary), so the
    // power chart must NOT collapse to the placeholder — guards against a
    // naive falsy check. Torque + rpm remain null → their placeholders show.
    renderCharts([snap({ power_kw: 0, regen_kw: 0 })]);

    const powerFig = screen.getByRole('figure', { name: POWER_TITLE });
    expect(within(powerFig).queryByText(AWAITING)).toBeNull();
    expect(screen.getAllByText(AWAITING)).toHaveLength(2);
  });

  it('renders power when only the regen half of the pair has a value', () => {
    // The power area chart plots two series (power, regen); a finite value
    // in EITHER is enough to plot. Here power_kw is missing but regen_kw
    // is present, so the chart renders and does not show the placeholder.
    renderCharts([snap({ regen_kw: 42 })]);

    const powerFig = screen.getByRole('figure', { name: POWER_TITLE });
    expect(within(powerFig).queryByText(AWAITING)).toBeNull();
    // Torque + rpm still null.
    expect(screen.getAllByText(AWAITING)).toHaveLength(2);
  });
});
