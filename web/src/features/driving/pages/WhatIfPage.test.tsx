import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import WhatIfPage from './WhatIfPage';

const state = vi.hoisted(() => ({ listError: false, detailError: false, telemetryError: false, empty: false, loading: false }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: 1 }) }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: () => undefined }));
vi.mock('@/hooks/useNumberFormatting', () => ({ useNumberFormatting: () => ({ fmtNumber: (v: number) => String(v) }) }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({ formatDistance: (v: number) => `${v} m`, formatEnergy: (v: number) => `${v} Wh`, formatDuration: (v: number) => `${v} s`, formatTemperature: (v: number) => `${v} C` }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback, i18n: { language: 'en' } }) }));
vi.mock('../components/operationalbrief-n-z/DrivingSummaryBrief', () => ({ DrivingSummaryBrief: () => <div>Simulated drive outcome</div> }));
vi.mock('@/api/hooks/useDriving', () => {
  const drive = { id: 1, startTs: '2026-01-01T00:00:00Z', distanceM: 10000, durationS: 600, avgSpeedMps: 16.67, energyUsedWh: 2000, startSoc: 80, endSoc: 76 };
  const query = (data: unknown, error: boolean, loading = false) => ({ data, error: error ? new Error('source failed') : null, isError: error, isLoading: loading, isPending: loading, isFetching: loading, fetchStatus: loading ? 'fetching' : 'idle', dataUpdatedAt: 1, refetch: vi.fn() });
  return {
    useDrives: () => query(state.empty ? [] : [drive], state.listError),
    useDrive: () => query(state.detailError || state.empty || state.loading ? undefined : drive, state.detailError, state.loading),
    useDriveTelemetry: () => query(state.telemetryError ? undefined : [], state.telemetryError),
  };
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><WhatIfPage /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { cleanup(); Object.assign(state, { listError: false, detailError: false, telemetryError: false, empty: false, loading: false }); });
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
