import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import WhatIfPage from './WhatIfPage';
import type { StatMetric } from '@/components/data-display/stat-reference';

const state = vi.hoisted(() => ({ listError: false, detailError: false, telemetryError: false, empty: false, loading: false, noEnergy: false, unknownSoc: false, retainedDetail: false, twoDrives: false, detailId: '', telemetryId: '', summary: vi.fn(), detailRetry: vi.fn(), telemetryRetry: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: 1 }) }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: () => undefined }));
vi.mock('@/hooks/useNumberFormatting', () => ({ useNumberFormatting: () => ({ fmtNumber: (v: number) => String(v) }) }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({ formatDistance: (v: number) => `${v} m`, formatEnergy: (v: number) => `${v} Wh`, formatDuration: (v: number) => `${v} s`, formatTemperature: (v: number) => `${v} C` }) }));
vi.mock('../components/operationalbrief-n-z/DrivingSummaryBrief', () => ({ DrivingSummaryBrief: (props: { metrics: readonly StatMetric[]; loading: boolean; unavailable: boolean; retained: boolean }) => { state.summary(props); return <div>Simulated drive outcome</div>; } }));
vi.mock('@/api/hooks/useDriving', () => {
  const drive = { id: 1, startTs: '2026-01-01T00:00:00Z', distanceM: 10000, durationS: 600, avgSpeedMps: 16.67, energyUsedWh: 2000, startBatteryPct: 80, endBatteryPct: 76 };
  const query = (data: unknown, error: boolean, loading = false) => ({ data, error: error ? new Error('source failed') : null, isError: error, isLoading: loading, isPending: loading, isFetching: loading, fetchStatus: loading ? 'fetching' : 'idle', dataUpdatedAt: 1, refetch: vi.fn() });
  return {
    useDrives: () => query(state.empty ? [] : state.twoDrives ? [drive, { ...drive, id: 2, distanceM: 20000 }] : [drive], state.listError),
    useDrive: (id: string) => { state.detailId = id; return { ...query((state.detailError && !state.retainedDetail) || state.empty || state.loading ? undefined : { ...drive, id: Number(id), energyUsedWh: state.noEnergy ? null : 2000, startBatteryPct: state.unknownSoc ? null : 80 }, state.detailError, state.loading), refetch: state.detailRetry }; },
    useDriveTelemetry: (id: string) => { state.telemetryId = id; return { ...query(state.telemetryError ? undefined : [], state.telemetryError), refetch: state.telemetryRetry }; },
  };
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><WhatIfPage /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { cleanup(); Object.assign(state, { listError: false, detailError: false, telemetryError: false, empty: false, loading: false, noEnergy: false, unknownSoc: false, retainedDetail: false, twoDrives: false, detailId: '', telemetryId: '' }); state.summary.mockClear(); state.detailRetry.mockClear(); state.telemetryRetry.mockClear(); });
describe('WhatIfPage independent source boundaries', () => {
  it('retains controls and both complete energy rails after a list refresh failure', () => {
    state.listError = true; mount();
    expect(screen.getByText('Knobs')).toBeTruthy();
    expect(screen.getByText('Actual drive')).toBeTruthy();
    expect(screen.getByText('What-if')).toBeTruthy();
    expect(screen.getAllByText('Aero drag')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Reset/ })).toBeTruthy();
  });
  it('keeps controls mounted and offers detail retry without pretending no energy', () => {
    state.detailError = true; mount();
    expect(screen.getByText('Knobs')).toBeTruthy();
    expect(screen.getByText('Energy breakdown')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /retry/i }).length).toBeGreaterThan(0);
  });
  it('explains incomplete telemetry while preserving valid model output', () => {
    state.telemetryError = true; mount();
    expect(screen.getByText(/Telemetry is incomplete/)).toBeTruthy();
    expect(screen.getByText('What-if')).toBeTruthy();
  });
  it('keeps original sections and browse recovery mounted with no drives', () => {
    state.empty = true; mount();
    expect(screen.getByText('Simulated drive outcome')).toBeTruthy();
    expect(screen.getByText('Knobs')).toBeTruthy();
    expect(screen.getByText('Energy breakdown')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Browse drives' }).getAttribute('href')).toBe('/drives');
  });
  it('keeps controls and energy section mounted during detail loading', () => {
    state.loading = true; mount();
    expect(screen.getByText('Knobs')).toBeTruthy();
    expect(screen.getByText('Energy breakdown')).toBeTruthy();
    expect(screen.queryByText('What-if')).toBeNull();
  });
});


describe('WhatIfPage preserved scenario actions and physical inputs', () => {
  it('selects the first recorded drive and sends subsequent selection to both independent hooks', () => {
    state.twoDrives = true; mount();
    const picker = screen.getByRole('combobox', { name: 'Choose a drive' });
    expect(picker).toHaveValue('1');
    expect(state.detailId).toBe('1');
    expect(state.telemetryId).toBe('1');
    fireEvent.change(picker, { target: { value: '2' } });
    expect(picker).toHaveValue('2');
    expect(state.detailId).toBe('2');
    expect(state.telemetryId).toBe('2');
  });

  it('preserves all four accessible knobs, physical bounds and reset defaults', () => {
    mount();
    const speed = screen.getByRole('slider', { name: 'Average speed' });
    const ambient = screen.getByRole('slider', { name: 'Ambient temperature' });
    const tires = screen.getByRole('combobox', { name: 'Tire pressure' });
    const climate = screen.getByRole('switch', { name: 'Climate (HVAC)' });
    expect(speed).toHaveAttribute('min', '0.8');
    expect(speed).toHaveAttribute('max', '1.2');
    expect(speed).toHaveAttribute('step', '0.05');
    expect(ambient).toHaveAttribute('min', '-10');
    expect(ambient).toHaveAttribute('max', '40');
    expect(ambient).toHaveAttribute('step', '1');
    fireEvent.change(speed, { target: { value: '1.2' } });
    fireEvent.change(ambient, { target: { value: '-10' } });
    fireEvent.change(tires, { target: { value: 'low' } });
    fireEvent.click(climate);
    expect(speed).toHaveValue('1.2');
    expect(ambient).toHaveAttribute('aria-valuetext', '-10 C');
    expect(tires).toHaveValue('low');
    expect(climate).toHaveAttribute('aria-checked', 'false');
    fireEvent.change(tires, { target: { value: 'high' } });
    expect(tires).toHaveValue('high');
    fireEvent.click(screen.getByRole('button', { name: /Reset/ }));
    expect(speed).toHaveValue('1');
    expect(ambient).toHaveValue('18');
    expect(tires).toHaveValue('nominal');
    expect(climate).toHaveAttribute('aria-checked', 'true');
  });

  it('recomputes raw Wh and seconds and preserves signed savings versus extra cost', () => {
    mount();
    const initial = state.summary.mock.lastCall?.[0].metrics as readonly StatMetric[];
    expect(initial[0].context).toBe('was 2000 Wh');
    fireEvent.click(screen.getByRole('switch', { name: 'Climate (HVAC)' }));
    const saving = state.summary.mock.lastCall?.[0].metrics as readonly StatMetric[];
    expect(saving[0].rawValue).toBeLessThan(initial[0].rawValue as number);
    expect(screen.getByText(/This would save/)).toHaveTextContent('Wh');
    fireEvent.click(screen.getByRole('button', { name: /Reset/ }));
    fireEvent.change(screen.getByRole('slider', { name: 'Average speed' }), { target: { value: '1.2' } });
    const fast = state.summary.mock.lastCall?.[0].metrics as readonly StatMetric[];
    expect(fast[2].rawValue).toBeCloseTo(10000 / (16.67 * 1.2));
    expect(screen.getByText(/This would cost an extra/)).toHaveTextContent('Wh');
  });

  it('preserves unknown arrival as null rather than fabricating zero battery', () => {
    state.unknownSoc = true; mount();
    const metrics = state.summary.mock.lastCall?.[0].metrics as readonly StatMetric[];
    expect(metrics[1].rawValue).toBeNull();
    expect(metrics[1].context).toBeUndefined();
    expect(screen.getByText('What-if')).toBeTruthy();
  });

  it('retains detail output on refresh error while accurately marking retained evidence', () => {
    state.detailError = true; state.retainedDetail = true; mount();
    expect(screen.getByText('Actual drive')).toBeTruthy();
    expect(screen.getByText('What-if')).toBeTruthy();
    expect(state.summary.mock.lastCall?.[0].retained).toBe(true);
  });

  it('keeps every section mounted with missing energy and reports unavailable metrics', () => {
    state.noEnergy = true; mount();
    expect(screen.getByText('Knobs')).toBeTruthy();
    expect(screen.getByText('Energy breakdown')).toBeTruthy();
    expect(screen.getAllByText('This drive lacks the energy data needed to simulate.')).toHaveLength(2);
    expect(state.summary.mock.lastCall?.[0].unavailable).toBe(true);
    expect(state.summary.mock.lastCall?.[0].metrics.every((metric: StatMetric) => metric.rawValue == null)).toBe(true);
  });
});
