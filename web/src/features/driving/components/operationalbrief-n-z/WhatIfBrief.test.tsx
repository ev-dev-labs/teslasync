import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Drive } from '@/types/driving';
import type { UnitPref } from '@/lib/unitConversion';
import { DEFAULT_KNOBS, simulateWhatIf } from '../../lib/whatIfModel';
import WhatIfPage from '../../pages/WhatIfPage';
import { makeBriefDrive } from './drivingBrief.fixtures';

const h = vi.hoisted(() => ({ drive: undefined as Drive | undefined, loading: false, refetch: vi.fn() }));
const unitPrefs: UnitPref = {
  distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
  energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US',
};
vi.mock('@/api/hooks/useDriving', () => {
  const query = <T,>(data: T) => ({
    data, isLoading: h.loading, isPending: h.loading, isSuccess: !h.loading,
    isError: false, error: null, isFetching: h.loading, dataUpdatedAt: h.drive ? 1 : 0,
    refetch: h.refetch,
  });
  return {
    useDrives: () => query(h.drive ? [h.drive] : []),
    useDrive: () => query(h.drive),
    useDriveTelemetry: () => query([]),
  };
});
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: 7 }) }));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs,
    formatDistance: (raw: number) => `${(raw / 1000).toFixed(2)} km`,
    formatEnergy: (raw: number) => `${(raw / 1000).toFixed(2)} kWh`,
    formatDuration: (raw: number) => `${raw.toFixed(2)} s`,
    formatTemperature: (raw: number) => `${raw.toFixed(2)} °C`,
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><WhatIfPage /></QueryClientProvider></MemoryRouter>);
}
beforeEach(() => {
  h.drive = makeBriefDrive(1, 10_000, { energyUsedWh: 2000 });
  h.loading = false;
});

describe('What-If — real summary preserves the simulation and its controls', () => {
  it('displays the unchanged model output and keeps the drive picker, reset and energy breakdown', () => {
    const expected = simulateWhatIf(h.drive, [], DEFAULT_KNOBS);
    renderPage();
    const brief = screen.getByTestId('what-if-brief');
    expect(brief.querySelector('[data-operational-metric="scenario-energy"] [data-operational-value]')).toHaveTextContent(`${(expected.scenario.total / 1000).toFixed(2)} kWh`);
    expect(brief.querySelector('[data-operational-metric="scenario-duration"] [data-operational-value]')).toHaveTextContent(`${expected.scenarioDurationS.toFixed(2)} s`);
    expect(screen.getByRole('combobox', { name: 'Choose a drive' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
    expect(screen.getByText('Energy breakdown')).toBeInTheDocument();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText(`was ${(expected.baseline.total / 1000).toFixed(2)} kWh`)).toBeInTheDocument();
  });

  it('keeps the real summary shell busy without presenting neutral model zeros while loading', () => {
    h.drive = undefined;
    h.loading = true;
    renderPage();
    const brief = screen.getByTestId('what-if-brief');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(brief.querySelector('[data-operational-metric="scenario-energy"]')).toHaveAttribute('data-value-state', 'missing');
  });

  it('keeps unavailable energy distinct from a measured scenario and retains the recovery drive picker', () => {
    h.drive = makeBriefDrive(1, 10_000, { energyUsedWh: null });
    renderPage();
    expect(screen.getByTestId('what-if-brief').querySelector('[data-operational-metric="scenario-energy"]')).toHaveAttribute('data-value-state', 'missing');
    expect(screen.getByText('This drive lacks the energy data needed to simulate.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Choose a drive' })).toBeInTheDocument();
  });
});
