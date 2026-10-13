import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { deriveDataState } from '@/api/dataState';
import type { DrivetrainHealthData, DrivingStats } from '@/types/driving';
import {
  formatEnergy, formatPower, formatTemperature, type UnitPref,
} from '@/lib/unitConversion';
import { DetailPanels } from './DetailPanels';
import { sensorsFor } from './model';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
        const template = typeof fallback === 'string' ? fallback : key;
        return template.replace(/{{(\w+)}}/g, (match, name: string) =>
          options?.[name] != null ? String(options[name]) : match);
      },
      i18n: { language: 'en' },
    }),
  };
});

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatTemperature: (value: number | null) => formatTemperature(value, preferences),
    formatPower: (value: number | null) => formatPower(value, preferences),
    formatEnergy: (value: number | null) => formatEnergy(value, preferences),
  }),
}));

vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtNumber: (value: number) => new Intl.NumberFormat('en-US').format(value),
  }),
}));

const preferences: UnitPref = {
  distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
  energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US', precision: 1,
};

const health: DrivetrainHealthData = {
  frontMotorTempC: 0, rearMotorTempC: null, inverterTempC: 48,
  batteryTempC: 30, motorStatus: 'Nominal', overallHealth: 'good',
};

const stats: DrivingStats = {
  totalDrives: 12, totalDistanceKm: 500, totalDurationS: 3600,
  avgEfficiencyWhKm: 150, avgSpeedKmh: 60, topSpeedKmh: 120,
  regenRatio: 0.15, regenEnergyWh: 2000, co2SavedKg: 30,
};

const power = { peakPower: 2500, avgPowerMax: 1500, minRegenPower: null };
const healthyState = deriveDataState({ data: health });
const drivesState = deriveDataState({ data: [power] }, { provenance: 'historical' });
const statsState = deriveDataState({ data: stats }, { provenance: 'historical' });
type Props = ComponentProps<typeof DetailPanels>;

function mount(overrides: Partial<Props> = {}) {
  const props: Props = {
    health, stats, sensors: sensorsFor(health), power,
    healthState: healthyState, drivesState, statsState, loading: false, ...overrides,
  };
  const view = render(<MemoryRouter><DetailPanels {...props} /></MemoryRouter>);
  return {
    ...view,
    update: (next: Partial<Props>) => {
      view.rerender(<MemoryRouter><DetailPanels {...props} {...next} /></MemoryRouter>);
    },
  };
}

function source(name: 'Power Summary' | 'Drive Statistics') {
  return within(screen.getByRole('group', { name }));
}

function reading(scope: ReturnType<typeof within>, label: string) {
  const term = scope.getByText(label, { selector: 'dt' });
  const value = term.parentElement?.querySelector('dd');
  if (!value) throw new Error(`Missing value for ${label}`);
  return value;
}

function expectHealthAndAdvice() {
  expect(reading(within(screen.getByLabelText('Temperature Details')), 'Front Motor'))
    .toHaveTextContent('0.0°C');
  expect(screen.getByText('Health Recommendations')).toBeInTheDocument();
  for (const key of ['regular-service', 'gentle-accel', 'precondition', 'monitor-temps']) {
    expect(document.querySelector(`[data-recommendation="${key}"]`)).toBeInTheDocument();
  }
}

describe('DetailPanels independent source trust', () => {
  it('preserves legacy inputs, all detail readings, methodology and general advice', () => {
    mount();
    const temperatures = within(screen.getByLabelText('Temperature Details'));
    expect(reading(temperatures, 'Front Motor')).toHaveTextContent('0.0°C');
    expect(reading(temperatures, 'Rear Motor')).toHaveTextContent('—');
    expect(reading(temperatures, 'Inverter')).toHaveTextContent('48.0°C');
    expect(reading(temperatures, 'Battery')).toHaveTextContent('30.0°C');
    expect(reading(source('Power Summary'), 'Peak Power')).toHaveTextContent('2.5 kW');
    expect(reading(source('Power Summary'), 'Avg Peak Power')).toHaveTextContent('1.5 kW');
    expect(reading(source('Power Summary'), 'Max Regen')).toHaveTextContent('—');
    expect(reading(source('Drive Statistics'), 'Total Regen')).toHaveTextContent('2.0 kWh');
    expect(reading(source('Drive Statistics'), 'CO₂ Saved')).toHaveTextContent('30 kg');
    expect(screen.getByText(/Per-drive regen power is not supplied/)).toBeInTheDocument();
    expect(screen.getByText(/backend battery-module proxies/)).toBeInTheDocument();
    expectHealthAndAdvice();
  });

  it('loads drives independently without replacing statistics or health', () => {
    const view = mount({
      drivesState: deriveDataState({ isLoading: true }),
      drivesLoading: true, drivesEmpty: true,
    });
    expect(source('Power Summary').queryByText('Peak Power')).not.toBeInTheDocument();
    expect(source('Power Summary').queryByText('No data')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Power Summary' })).toHaveAttribute('aria-busy', 'true');
    expect(reading(source('Drive Statistics'), 'Total Regen')).toHaveTextContent('2.0 kWh');
    expectHealthAndAdvice();
    view.update({ drivesState, drivesLoading: false, drivesEmpty: false });
    expect(reading(source('Power Summary'), 'Peak Power')).toHaveTextContent('2.5 kW');
  });

  it('loads statistics independently without replacing drive power or health', () => {
    const view = mount({
      stats: undefined, statsState: deriveDataState({ isLoading: true }),
      statsLoading: true, statsEmpty: true,
    });
    expect(source('Drive Statistics').queryByText('Total Regen')).not.toBeInTheDocument();
    expect(source('Drive Statistics').queryByText('No drive statistics available yet')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Drive Statistics' })).toHaveAttribute('aria-busy', 'true');
    expect(reading(source('Power Summary'), 'Peak Power')).toHaveTextContent('2.5 kW');
    expectHealthAndAdvice();
    view.update({ stats, statsState, statsLoading: false, statsEmpty: false });
    expect(reading(source('Drive Statistics'), 'Total Regen')).toHaveTextContent('2.0 kWh');
  });

  it.each([
    { name: 'drive failure', label: 'Power Summary' as const, stateProp: 'drivesState' as const, missingLabel: 'Peak Power' },
    { name: 'statistics failure', label: 'Drive Statistics' as const, stateProp: 'statsState' as const, missingLabel: 'Total Regen' },
  ])('keeps unaffected neighbors and retries only the source after $name', ({ label, stateProp, missingLabel }) => {
    const retry = vi.fn();
    mount({
      [stateProp]: deriveDataState({ error: new Error('Request failed'), refetch: retry }),
    });
    expect(source(label).getByRole('alert')).toBeInTheDocument();
    expect(source(label).queryByText(missingLabel)).not.toBeInTheDocument();
    fireEvent.click(source(label).getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    const neighbor = label === 'Power Summary' ? 'Drive Statistics' : 'Power Summary';
    expect(reading(source(neighbor), neighbor === 'Power Summary' ? 'Peak Power' : 'Total Regen'))
      .toHaveTextContent(neighbor === 'Power Summary' ? '2.5 kW' : '2.0 kWh');
    expectHealthAndAdvice();
  });

  it('shows authoritative drive emptiness and independent refresh while statistics remain usable', () => {
    const retry = vi.fn();
    mount({
      drivesState: deriveDataState({ data: [], refetch: retry }),
      drivesEmpty: true,
    });
    expect(source('Power Summary').getByText('No data')).toBeInTheDocument();
    expect(source('Power Summary').queryByText('Peak Power')).not.toBeInTheDocument();
    fireEvent.click(source('Power Summary').getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reading(source('Drive Statistics'), 'CO₂ Saved')).toHaveTextContent('30 kg');
    expectHealthAndAdvice();
  });

  it('shows authoritative statistics emptiness without replacing drive power', () => {
    const retry = vi.fn();
    mount({
      stats: undefined,
      statsState: deriveDataState({ data: null, refetch: retry }),
      statsEmpty: true,
    });
    expect(source('Drive Statistics').getByText('No drive statistics available yet')).toBeInTheDocument();
    expect(source('Drive Statistics').queryByText('Total Regen')).not.toBeInTheDocument();
    fireEvent.click(source('Drive Statistics').getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reading(source('Power Summary'), 'Peak Power')).toHaveTextContent('2.5 kW');
    expectHealthAndAdvice();
  });

  it.each([
    { name: 'retained drive refresh', label: 'Power Summary' as const, stateProp: 'drivesState' as const, loadingProp: 'drivesLoading' as const, data: [power] },
    { name: 'retained statistics refresh', label: 'Drive Statistics' as const, stateProp: 'statsState' as const, loadingProp: 'statsLoading' as const, data: stats },
  ])('retains all readings and source-specific recovery after $name', ({ label, stateProp, loadingProp, data }) => {
    const retry = vi.fn();
    const retained = deriveDataState<unknown>({
      data, error: new Error('Refresh failed'), dataUpdatedAt: 1000, refetch: retry,
    }, { provenance: 'historical', now: () => 2000 });
    mount({ [stateProp]: retained, [loadingProp]: true });
    expect(source(label).getByText('Previously loaded data remains visible while affected sources recover.'))
      .toBeInTheDocument();
    expect(source(label).queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(source(label).getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reading(source('Power Summary'), 'Peak Power')).toHaveTextContent('2.5 kW');
    expect(reading(source('Drive Statistics'), 'Total Regen')).toHaveTextContent('2.0 kWh');
    expectHealthAndAdvice();
    expect(retained.updatedAt).toBe(1000);
    expect(retained.data).toBe(data);
  });

  it('retains paused readings without claiming a source failure or erasing neighbors', () => {
    mount({
      drivesState: deriveDataState({ data: [power], fetchStatus: 'paused' }),
      statsState: deriveDataState({ data: stats, fetchStatus: 'paused' }),
    });
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2);
    expect(screen.getAllByTestId('stale-refresh-warning')[0]).toHaveAttribute('data-refresh-blocked', 'true');
    expect(reading(source('Power Summary'), 'Peak Power')).toHaveTextContent('2.5 kW');
    expect(reading(source('Drive Statistics'), 'CO₂ Saved')).toHaveTextContent('30 kg');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText("You're offline")).not.toBeInTheDocument();
    expectHealthAndAdvice();
  });

  it('keeps measured zero, valid negative power and unknown gaps distinct without changing raw SI', () => {
    const rawPower = { peakPower: 0, avgPowerMax: -2500, minRegenPower: null };
    const rawStats = { ...stats, regenEnergyWh: 0, co2SavedKg: 0 };
    const view = mount({
      power: rawPower, stats: rawStats,
      drivesState: deriveDataState({ data: [rawPower] }),
      statsState: deriveDataState({ data: rawStats }),
    });
    expect(reading(source('Power Summary'), 'Peak Power')).toHaveTextContent('0.0 kW');
    expect(reading(source('Power Summary'), 'Avg Peak Power')).toHaveTextContent('-2.5 kW');
    expect(reading(source('Power Summary'), 'Max Regen')).toHaveTextContent('—');
    expect(reading(source('Drive Statistics'), 'Total Regen')).toHaveTextContent('0.0 kWh');
    expect(reading(source('Drive Statistics'), 'CO₂ Saved')).toHaveTextContent('0 kg');
    expect(rawPower).toEqual({ peakPower: 0, avgPowerMax: -2500, minRegenPower: null });
    expect(rawStats.regenEnergyWh).toBe(0);
    view.update({ power: { peakPower: null, avgPowerMax: null, minRegenPower: null }, stats: undefined });
    expect(reading(source('Power Summary'), 'Peak Power')).toHaveTextContent('—');
    expect(reading(source('Drive Statistics'), 'Total Regen')).toHaveTextContent('—');
    expect(reading(source('Drive Statistics'), 'CO₂ Saved')).toHaveTextContent('—');
    expect(source('Power Summary').queryByText('No data')).not.toBeInTheDocument();
  });

  it('keeps health failure source-local and retains every unconditional care tip', () => {
    mount({
      health: undefined, sensors: sensorsFor(undefined),
      healthState: deriveDataState({ error: new Error('Health unavailable') }),
    });
    expect(within(screen.getByLabelText('Temperature Details')).getByRole('alert')).toBeInTheDocument();
    expect(reading(source('Power Summary'), 'Peak Power')).toHaveTextContent('2.5 kW');
    expect(reading(source('Drive Statistics'), 'Total Regen')).toHaveTextContent('2.0 kWh');
    expect(screen.getByText(/No active assessment is available/)).toBeInTheDocument();
    expect(document.querySelectorAll('[data-recommendation]')).toHaveLength(4);
  });
});
