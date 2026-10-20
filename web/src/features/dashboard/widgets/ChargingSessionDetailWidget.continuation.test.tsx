import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { queryResult, renderWidget } from '../components/continuation-dashboard-2/testSupport';
import ChargingSessionDetailWidget from './ChargingSessionDetailWidget';

const hooks = vi.hoisted(() => ({ vehicles: vi.fn(), sessions: vi.fn(), detail: vi.fn(), telemetry: vi.fn(), chart: vi.fn() }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => hooks.vehicles() }));
vi.mock('@/api/hooks/useCharging', () => ({
  useChargingSessions: (...args: unknown[]) => hooks.sessions(...args),
  useChargingSessionDetail: (...args: unknown[]) => hooks.detail(...args),
  useChargeTelemetry: (...args: unknown[]) => hooks.telemetry(...args),
}));
vi.mock('@/components/charts', async (original) => {
  const actual = await original<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    ...actual, ...chartTestDoubles,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    ComposedChart: (props: { data: unknown; children?: ReactNode }) => { hooks.chart(props); return <div>{props.children}</div>; },
    XAxis: () => null, YAxis: () => null, Area: () => null, Line: () => null, Tooltip: () => null,
    chartGrid: null, areaGradient: () => null,
  };
});

const sessions = [{ id: '1', startedAt: '2026-09-01T00:00:00Z' }, { id: '2', startedAt: '2026-09-02T00:00:00Z' }];
const telemetry = [{ created_at: '2026-09-02T12:00:00Z', power_w: 0, battery_level: 0, soc: null }];

beforeEach(() => {
  vi.clearAllMocks();
  hooks.vehicles.mockReturnValue(queryResult([{ id: 7 }]));
  hooks.sessions.mockReturnValue(queryResult(sessions));
  hooks.detail.mockReturnValue(queryResult({ total_energy_added_wh: 0, duration_min: 45, charger_type: 'AC' }));
  hooks.telemetry.mockReturnValue(queryResult(telemetry));
});

describe('latest charging detail and telemetry source boundaries', () => {
  it('keeps latest-session zero power/SOC telemetry when detail fails', () => {
    const retryDetail = vi.fn();
    const retryTelemetry = vi.fn();
    hooks.detail.mockReturnValue(queryResult(undefined, { isError: true, error: new Error('Detail offline'), refetch: retryDetail }));
    hooks.telemetry.mockReturnValue(queryResult(telemetry, { refetch: retryTelemetry }));
    renderWidget(<ChargingSessionDetailWidget size={{ cols: 2, rows: 4 }} />);
    expect(screen.getByRole('img', { name: 'Charging power and battery state of charge over the latest session' })).toBeVisible();
    expect(hooks.chart).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ power: 0, soc: 0 })],
    }));
    expect(hooks.detail).toHaveBeenCalledWith(2);
    expect(hooks.telemetry).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retryDetail).toHaveBeenCalledOnce();
    expect(retryTelemetry).not.toHaveBeenCalled();
  });

  it('keeps every detail measurement and duration when telemetry fails', () => {
    const retry = vi.fn();
    hooks.telemetry.mockReturnValue(queryResult(undefined, { isError: true, error: new Error('Telemetry offline'), refetch: retry }));
    renderWidget(<ChargingSessionDetailWidget size={{ cols: 2, rows: 4 }} />);
    for (const label of ['Energy added', 'Duration', 'Peak power', 'Charger']) expect(screen.getByText(label)).toBeVisible();
    expect(screen.getByText('45m')).toBeVisible();
    expect(screen.getByText('Charging telemetry could not be loaded.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('does not discard retained telemetry during a refresh failure', () => {
    hooks.telemetry.mockReturnValue(queryResult(telemetry, { isError: true, error: new Error('Telemetry offline') }));
    renderWidget(<ChargingSessionDetailWidget size={{ cols: 2, rows: 4 }} />);
    expect(screen.getByRole('img', { name: 'Charging power and battery state of charge over the latest session' })).toBeVisible();
    expect(screen.getByText('Previously loaded charging telemetry remains visible while it refreshes.')).toBeVisible();
    expect(screen.queryByText('Charging telemetry could not be loaded.')).not.toBeInTheDocument();
  });
});
