import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { VehicleState } from '@/api/types';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { StreamingTelemetryDetails } from './StreamingTelemetryDetails';

const { formatEnergy } = vi.hoisted(() => ({
  formatEnergy: vi.fn((wh: number) => `${wh / 1000} kWh`),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatEnergy }),
}));

vi.mock('react-i18next', async () => ({
  ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
    i18n: { language: 'en' },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  setGlobalLocale('en-US');
  setGlobalPrecision(1);
});

function renderDetails(state: Partial<VehicleState>) {
  return render(<StreamingTelemetryDetails state={{ vehicle_id: 7, ...state } as VehicleState} />);
}

describe('StreamingTelemetryDetails', () => {
  it('shows all fields as unknown until supported firmware reports them', () => {
    renderDetails({});
    expect(screen.getAllByText('—')).toHaveLength(6);
    expect(screen.getByText('Accessory rail')).toBeInTheDocument();
    expect(screen.getByText('AEB operating state')).toBeInTheDocument();
    expect(screen.getByText('Semi vehicle mass')).toBeInTheDocument();
    expect(screen.queryByText('Off')).not.toBeInTheDocument();
    expect(formatEnergy).not.toHaveBeenCalled();
  });

  it('renders reported states and SI measurements without re-scaling counters', () => {
    renderDetails({
      accessory_rail: false,
      power_transfer_status: 'ChargeEnabled',
      automatic_emergency_braking_state: 'Unavailable',
      lifetime_dc_charge_energy_wh: 12500,
      rolling_resistance_coefficient: 0.006123456789,
      semi_vehicle_mass_kg: 36500.5,
    });
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getByText('ChargeEnabled')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByText('12.5 kWh')).toBeInTheDocument();
    expect(formatEnergy).toHaveBeenCalledWith(12500);
    expect(screen.getByText('0.00612')).toBeInTheDocument();
    expect(screen.getByText('36,500.5 kg')).toBeInTheDocument();
  });

  it('preserves reported zero independently of a missing measurement', () => {
    renderDetails({ accessory_rail: true, lifetime_dc_charge_energy_wh: 0 });
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByText('0 kWh')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(4);
  });

  it('does not present non-finite measurements as data', () => {
    renderDetails({
      lifetime_dc_charge_energy_wh: NaN,
      semi_vehicle_mass_kg: Infinity,
      rolling_resistance_coefficient: NaN,
    });
    expect(screen.getAllByText('—')).toHaveLength(6);
    expect(formatEnergy).not.toHaveBeenCalled();
  });
});
