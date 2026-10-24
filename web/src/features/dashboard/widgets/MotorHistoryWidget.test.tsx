import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { MotorSnapshot } from '@/api/types';

const state = vi.hoisted(() => ({
  history: [] as MotorSnapshot[],
  query: { data: [] as MotorSnapshot[], isLoading: false, isFetching: false, isStale: false, isError: false, dataUpdatedAt: 1000, isPending: false },
  temperature: '°C',
  range: { start: '2026-05-04', end: '2026-05-10', startInstant: '2026-05-04T00:00:00Z', endInstantExclusive: '2026-05-11T00:00:00Z', presetId: '7d' },
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useMotorHistory: vi.fn((_vehicleId: number, query: unknown) => ({
    ...state.query,
    data: state.history,
    refetch: vi.fn(),
    query,
  })),
  useVehicles: () => ({ data: [{ id: 7 }], isLoading: false }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { temperature: state.temperature } }),
}));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => state.range,
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (value: unknown) => String(value),
    formatTime: (value: unknown) => String(value),
    formatDateShort: (value: unknown) => String(value),
  }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtNumber: (value: unknown, decimals = 0) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(decimals) : '—',
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) => {
      let text = typeof fallback === 'string' ? fallback : key;
      if (values) for (const [name, value] of Object.entries(values)) text = text.replace(`{{${name}}}`, String(value));
      return text;
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/components/charts', () => {
  return {
    useMeasuredAxisWidth: () => 40,
    ComposedChart: ({ data, children }: { data?: unknown[]; children?: ReactNode }) => (
      <div data-testid="motor-chart" data-rows={JSON.stringify(data ?? [])}>{children}</div>
    ),
    Line: (props: Record<string, unknown>) => (
      <div
        data-testid={props.dataKey === 'temperature' ? 'motor-line' : 'motor-torque-line'}
        data-key={String(props.dataKey)}
      />
    ),
    XAxis: () => <div />,
    YAxis: () => <div />,
    Tooltip: () => <div />,
    ReferenceArea: (props: Record<string, unknown>) => (
      <div data-testid="danger-area" data-y1={String(props.y1)} />
    ),
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    chartGrid: <div />,
    chartMargin: {},
    axisTick: {},
    axisTickSm: {},
    chartAnimation: {},
    ChartTooltip: () => null,
    ChartLegend: () => null,
    EmbeddedChart: ({ children }: { children: (ctx: { hiddenSeries: never }) => ReactNode }) => <>{children({ hiddenSeries: undefined as never })}</>,
    type: {},
  };
});

import MotorHistoryWidget from './MotorHistoryWidget';

function snapshot(overrides: Partial<MotorSnapshot> = {}): MotorSnapshot {
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

function renderWidget(size = { cols: 2, rows: 4 }) {
  return render(
    <MemoryRouter>
      <MotorHistoryWidget size={size} vehicleId={7} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.history = [];
  state.temperature = '°C';
  state.query = { ...state.query, isLoading: false, isFetching: false, isStale: false, isError: false, dataUpdatedAt: 1000, isPending: false };
});

describe('MotorHistoryWidget', () => {
  it('uses the shared 7-day range and passes both instants to the motor history query', async () => {
    state.history = [snapshot({ di_stator_temp: 45 })];
    renderWidget();
    const { useMotorHistory } = await import('@/api/hooks/useVehicles');
    expect(useMotorHistory).toHaveBeenCalledWith(7, {
      limit: 200,
      start: state.range.startInstant,
      end: state.range.endInstantExclusive,
    });
    expect(screen.getByText(/Stator temp · 7 days/)).toBeInTheDocument();
  });

  it('shows the measured peak in °C and a real not-reached danger state', () => {
    state.history = [
      snapshot({ ts: '2026-05-09T12:00:00Z', di_stator_temp: 82 }),
      snapshot({ ts: '2026-05-10T12:00:00Z', motor_temp_c_rear: 92 }),
    ];
    renderWidget();
    expect(screen.getByText('92')).toBeInTheDocument();
    expect(screen.getByText('Danger zone not reached')).toBeInTheDocument();
    expect(screen.getByTestId('danger-area')).toHaveAttribute('data-y1', '120');
  });

  it('converts canonical SI Celsius data to °F at the display boundary', () => {
    state.temperature = '°F';
    state.history = [snapshot({ di_stator_temp: 45 })];
    renderWidget();
    expect(screen.getByText('113')).toBeInTheDocument();
    expect(screen.getByTestId('danger-area')).toHaveAttribute('data-y1', '248');
  });

  it('renders truthful empty and compact states without fabrication', () => {
    renderWidget({ cols: 1, rows: 2 });
    expect(screen.getByText('No motor history')).toBeInTheDocument();
    expect(screen.getByText('Peak stator temp')).toBeInTheDocument();
  });

  it('plots only finite temperature samples and never substitutes zero for missing readings', () => {
    state.history = [
      snapshot({ ts: '2026-05-09T12:00:00Z', di_stator_temp: null, motor_temp_c_rear: null, motor_temp_c_front: 40 }),
      snapshot({ ts: '2026-05-10T12:00:00Z', di_stator_temp: null }),
    ];
    renderWidget();
    const chart = screen.getByTestId('motor-chart');
    const rows = JSON.parse(chart.getAttribute('data-rows') ?? '[]') as Array<{ temperature: number | null }>;
    expect(rows[0].temperature).toBe(40);
    expect(rows[1].temperature).toBeNull();
    expect(screen.getByTestId('motor-line')).toHaveAttribute('data-key', 'temperature');
  });
});
