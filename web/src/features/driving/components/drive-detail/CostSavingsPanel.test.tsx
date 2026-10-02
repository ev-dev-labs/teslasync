import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CostSavingsPanel } from './CostSavingsPanel';
import { driveFixture, statsFixture } from './detailTestFixtures';
const settings = vi.hoisted(() => ({
  current: { unit_of_length: 'km', base_cost_per_kwh: 0.12, currency_symbol: '$', decimal_precision: 2, gas_efficiency_mpg: 25, gas_price_per_unit: 0, gas_unit: 'gallon' },
}));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: settings.current }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_, token: string) => String(opts?.[token] ?? token)),
  }),
}));
const value = (label: string) => within(screen.getByRole('rowheader', { name: label }).closest('tr')!).getByRole('cell').textContent;
beforeEach(() => {
  Object.assign(settings.current, { unit_of_length: 'km', base_cost_per_kwh: 0.12, currency_symbol: '$', gas_efficiency_mpg: 25, gas_price_per_unit: 0, gas_unit: 'gallon' });
});

describe('Configured-rate cost estimates', () => {
  it('keeps all cost rows visible, with explicit unknown gas comparison and estimate caveat', () => {
    render(<CostSavingsPanel drive={driveFixture({ distanceM: 50000, energyUsedWh: 10000 })} stats={statsFixture()} />);
    expect(value('Trip cost')).toBe('$1.20');
    expect(value('Cost / km')).toBe('$0.024');
    expect(value('Gas cost (equivalent)')).toBe('—');
    expect(value('Savings vs gas')).toBe('—');
    expect(screen.getByText(/not a charging invoice/)).toBeInTheDocument();
  });

  it('uses SI meters and user-selected miles with the real formatting hook', () => {
    Object.assign(settings.current, { unit_of_length: 'mi', gas_price_per_unit: 4 });
    render(<CostSavingsPanel drive={driveFixture({ distanceM: 40233.6, energyUsedWh: 10000 })} stats={statsFixture()} />);
    expect(value('Cost / mi')).toBe('$0.048');
    expect(value('Gas cost (equivalent)')).toBe('$4.00');
    expect(value('Savings vs gas')).toBe('$2.80');
    expect(value('Savings %')).toBe('70.00%');
  });

  it('shows negative savings instead of hiding an unfavorable comparison', () => {
    Object.assign(settings.current, { gas_efficiency_mpg: 100, gas_price_per_unit: 1 });
    render(<CostSavingsPanel drive={driveFixture({ distanceM: 40233.6, energyUsedWh: 100000 })} stats={statsFixture()} />);
    expect(value('Trip cost')).toBe('$12.00');
    expect(value('Gas cost (equivalent)')).toBe('$0.25');
    expect(value('Savings vs gas')).toBe('$-11.75');
  });

  it('does not divide by zero distance', () => {
    render(<CostSavingsPanel drive={driveFixture({ distanceM: 0 })} stats={statsFixture()} />);
    expect(value('Trip cost')).toBe('$0.96');
    expect(value('Cost / km')).toBe('—');
  });

  it('distinguishes known zero energy from missing energy and tolerates null arrays', () => {
    const drive = driveFixture({ energyUsedWh: 0 });
    Object.assign(drive, { telemetry: null, positions: null });
    const { rerender } = render(<CostSavingsPanel drive={drive} stats={statsFixture()} />);
    expect(value('Trip cost')).toBe('$0.00');
    rerender(<CostSavingsPanel drive={driveFixture({ energyUsedWh: null, avgPowerW: null })} stats={statsFixture()} />);
    expect(value('Trip cost')).toBe('—');
  });

  it('honors configured currency and gas-liter conversions', () => {
    Object.assign(settings.current, { currency_symbol: '€', gas_price_per_unit: 1, gas_unit: 'liter' });
    render(<CostSavingsPanel drive={driveFixture({ distanceM: 40233.6, energyUsedWh: 10000 })} stats={statsFixture()} />);
    expect(value('Trip cost')).toBe('€1.20');
    expect(value('Gas cost (equivalent)')).toBe('€3.79');
  });
});
