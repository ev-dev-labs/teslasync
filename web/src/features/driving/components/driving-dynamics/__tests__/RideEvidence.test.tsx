import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Drive } from '@/types/driving';
import type { MotorStats } from '../helpers';
import RideOverview from '../RideOverview';
import PowertrainSummary from '../PowertrainSummary';

const state = vi.hoisted(() => ({
  length: 'km',
  temperature: 'C',
  precision: 3,
  isLoading: false,
  isError: false,
  error: null as Error | null,
  stats: null as MotorStats | null,
  retry: vi.fn(),
  hook: vi.fn(),
}));

vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''))
        : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/hooks/useSettings', async (original) => ({
  ...await original<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({
    settings: {
      unit_of_length: state.length,
      unit_of_temp: state.temperature,
      unit_of_pressure: 'bar',
      locale: 'en-US',
      decimal_precision: state.precision,
    },
  }),
}));

vi.mock('../useMotorStats', () => ({
  MOTOR_HISTORY_LIMIT: 200,
  useMotorStats: (vehicleId: number, window: unknown) => {
    state.hook(vehicleId, window);
    return {
      motorStats: state.stats,
      isLoading: state.isLoading,
      isError: state.isError,
      error: state.error,
      refetch: state.retry,
    };
  },
}));

const drive: Drive = {
  id: 82, vehicleId: 7,
  startTs: '2026-10-01T10:00:00Z', endTs: '2026-10-01T11:00:00Z',
  durationS: 3600, distanceM: 1609.344,
  startAddress: 'Home', endAddress: 'Office',
  startLat: null, startLon: null, endLat: null, endLon: null,
  startBatteryPct: 80, endBatteryPct: 74,
  energyUsedWh: 2345, regenEnergyWh: 456,
  avgSpeedMps: 10, maxSpeedMps: 20, avgPowerW: 22000,
  outsideTempAvgC: null, insideTempAvgC: null, score: null, endedStatus: null,
  createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T11:00:00Z',
};

const stats: MotorStats = {
  totalReadings: 18, avgTorque: 100, maxTorque: 260,
  avgPower: 22, peakPower: 42.345, minPower: 0, peakRegen: 12.456,
  avgMotorTemp: 40, maxMotorTemp: 49.123, highTorquePct: 12,
};

beforeEach(() => {
  state.length = 'km';
  state.temperature = 'C';
  state.precision = 3;
  state.isLoading = false;
  state.isError = false;
  state.error = null;
  state.stats = stats;
  state.hook.mockClear();
  state.retry.mockClear();
});

function renderRide(value: Drive | null = drive) {
  return render(<MemoryRouter><RideOverview drive={value} /></MemoryRouter>);
}

function renderEvidence() {
  return render(<MemoryRouter><PowertrainSummary vehicleId={7} historyQuery={{
    start: drive.startTs,
    end: drive.endTs!,
    refetchInterval: false,
    enabled: true,
  }} /></MemoryRouter>);
}

describe('Selected-ride outcome', () => {
  it('prioritizes route and recorded energy before telemetry details', () => {
    renderRide();
    expect(screen.getByText('Home → Office')).toBeInTheDocument();
    const energy = screen.getByText('Energy used').parentElement!;
    expect(within(energy).getByText('2.345 kWh')).toBeInTheDocument();
    expect(screen.getByText('0.456 kWh')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open trip details' })).toHaveAttribute('href', '/drives/82');
    expect(screen.queryByText(/score/i)).toBeNull();
  });

  it('uses settings distance, speed, and precision in imperial mode', () => {
    state.length = 'mi';
    renderRide();
    expect(screen.getByText('1.000 mi')).toBeInTheDocument();
    expect(screen.getByText(/22.369 mph/)).toBeInTheDocument();
    expect(screen.getByText('2.345 kWh')).toBeInTheDocument();
  });

  it('leaves unknown energy and speeds unknown, never zero', () => {
    renderRide({ ...drive, energyUsedWh: null, regenEnergyWh: null, avgSpeedMps: null, maxSpeedMps: null });
    expect(screen.getByText('Energy used').parentElement).toHaveTextContent('—');
    expect(screen.getByText('Energy recovered').parentElement).toHaveTextContent('—');
    expect(screen.getByText('Average / peak speed: — / —')).toBeInTheDocument();
    expect(screen.queryByText('0.000 kWh')).toBeNull();
  });

  it('shows genuine zero energy as zero', () => {
    renderRide({ ...drive, energyUsedWh: 0 });
    expect(screen.getByText('0.000 kWh')).toBeInTheDocument();
  });

  it('labels an open drive and missing destination without inventing a completed endpoint', () => {
    renderRide({ ...drive, endTs: null, endAddress: null });
    expect(screen.getByText('In progress · totals may change')).toBeInTheDocument();
    expect(screen.getByText('Home → On the road')).toBeInTheDocument();
  });

  it('keeps its shell and a selection-specific empty state without a ride', () => {
    renderRide(null);
    expect(screen.getByTestId('dynamics-ride-overview')).toBeInTheDocument();
    expect(screen.getByText('Choose a trip with recorded data to review its outcome.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('Powertrain evidence boundaries', () => {
  it('uses only the selected timestamp window and reports sample coverage', () => {
    renderEvidence();
    expect(state.hook).toHaveBeenCalledWith(7, expect.objectContaining({
      start: drive.startTs, end: drive.endTs, refetchInterval: false,
    }));
    expect(screen.getByRole('heading', { name: 'Powertrain summary' })).toBeInTheDocument();
    expect(screen.getByText(/Up to 200 motor samples/)).toBeInTheDocument();
    expect(screen.getByText(/not a time-weighted or complete-trip assessment/)).toBeInTheDocument();
    expect(screen.getByText(/42.345 kW/)).toBeInTheDocument();
    expect(screen.getByText(/12.456 kW/)).toBeInTheDocument();
    expect(screen.getByText(/historical inputs/)).toBeInTheDocument();
    expect(screen.queryByText(/Grok|\bAI\b|excellent driving|healthy/i)).toBeNull();
  });

  it('formats temperature with the selected preference and precision', () => {
    state.temperature = 'F';
    renderEvidence();
    expect(screen.getByText(/120.421°F/)).toBeInTheDocument();
    expect(screen.queryByText(/°°/)).toBeNull();
  });

  it('does not replace missing historical telemetry with current vehicle readings', () => {
    state.stats = null;
    renderEvidence();
    expect(screen.getByTestId('dynamics-powertrain-summary')).toBeInTheDocument();
    expect(screen.getByText(/No motor samples in this drive window/)).toBeInTheDocument();
    expect(screen.queryByText(/Peak sampled power/)).toBeNull();
  });

  it('retains per-signal unknowns inside a partial motor snapshot', () => {
    state.stats = { ...stats, peakPower: null, peakRegen: null, maxMotorTemp: null };
    renderEvidence();
    expect(screen.getByText(/Peak sampled power —; peak sampled regen —/)).toBeInTheDocument();
    expect(screen.getByText(/hottest recorded motor —/)).toBeInTheDocument();
  });

  it('keeps the neutral heading and loading status before samples arrive', () => {
    state.stats = null;
    state.isLoading = true;
    renderEvidence();
    expect(screen.getByRole('heading', { name: 'Powertrain summary' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading selected-drive evidence' })).toBeInTheDocument();
    expect(screen.queryByText(/No motor samples/)).toBeNull();
  });

  it('surfaces an independent source failure with a working retry', () => {
    state.stats = null;
    state.isError = true;
    state.error = new Error('History unavailable');
    renderEvidence();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(state.retry).toHaveBeenCalledOnce();
    expect(screen.queryByText(/No motor samples/)).toBeNull();
  });
});
