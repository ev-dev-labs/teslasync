import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MetricPreferences } from '@/lib/metric-reference';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { SavingsCalculator } from './SavingsCalculator';
import { gasComparison } from './fixtures.test-utils';
import { DEFAULT_GAS_PRICE, DEFAULT_MPG, DEFAULT_ELECTRICITY_RATE } from '../cost-analysis/constants';

const state = vi.hoisted(() => ({ currency: 'EUR' }));
vi.mock('./useStatFormatting', () => ({
  useStatFormatting: () => ({
    preferences: {
      units: { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
        energy: 'kWh', duration: 'min', power: 'kW' },
      currency: { kind: 'iso', value: state.currency },
    } satisfies MetricPreferences,
  }),
}));

const initial = getFormatterPreferences();
const props = {
  gasComparison, gasPrice: 3.5, mpg: 30, electricityRate: 0.13, distanceUnit: 'mi',
  period: { kind: 'unknown', label: 'Selected period' } as const,
  onGasPriceChange: vi.fn(), onMpgChange: vi.fn(), onElectricityRateChange: vi.fn(),
};
beforeEach(() => {
  state.currency = 'EUR';
  vi.clearAllMocks();
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});
afterEach(() => {
  cleanup();
  setGlobalLocale(initial.locale);
  setGlobalPrecision(initial.precision);
});

describe('SavingsCalculator USD assumptions', () => {
  it.each(['EUR', 'USD'])('discloses USD and preserves populated amounts with %s display preferences', currency => {
    state.currency = currency;
    const { container } = render(<SavingsCalculator {...props} />);
    expect(screen.getByText(/Assumptions and comparisons are in USD/)).toBeInTheDocument();
    expect(screen.getByLabelText('Gas price (USD/US gal)')).toHaveValue(3.5);
    expect(screen.getByLabelText('Gas car efficiency (mi/US gal)')).toHaveValue(30);
    expect(screen.getByLabelText('Electricity rate (USD/kWh)')).toHaveValue(0.13);
    expect(Array.from(container.querySelectorAll('[data-operational-value]')).map(node => node.textContent))
      .toEqual(['$350.00', '$88.75', '$261.25', '$21.77']);
    expect(container.textContent).not.toContain('€');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('group', { name: 'Gas Cost (equivalent)' })).toHaveTextContent('$0.35/mi');
    expect(within(dialog).getByRole('group', { name: 'EV Cost (actual)' })).toHaveTextContent('$0.09/mi');
    expect(within(dialog).getByRole('group', { name: 'Monthly Savings' })).toHaveTextContent('~$261.25 / year');
    expect(state.currency).toBe(currency);
  });

  it('keeps the disclosed assumptions editable and resettable without comparison data', () => {
    render(<SavingsCalculator {...props} gasComparison={null} />);
    expect(screen.getByText(/Assumptions and comparisons are in USD/)).toBeInTheDocument();
    expect(screen.getByText('Not enough data for comparison')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Gas price (USD/US gal)'), { target: { value: '4.25' } });
    fireEvent.change(screen.getByLabelText('Gas car efficiency (mi/US gal)'), { target: { value: '35' } });
    fireEvent.change(screen.getByLabelText('Electricity rate (USD/kWh)'), { target: { value: '0.2' } });
    expect(props.onGasPriceChange).toHaveBeenLastCalledWith(4.25);
    expect(props.onMpgChange).toHaveBeenLastCalledWith(35);
    expect(props.onElectricityRateChange).toHaveBeenLastCalledWith(0.2);
    fireEvent.click(screen.getByRole('button', { name: 'Reset Defaults' }));
    expect(props.onGasPriceChange).toHaveBeenLastCalledWith(DEFAULT_GAS_PRICE);
    expect(props.onMpgChange).toHaveBeenLastCalledWith(DEFAULT_MPG);
    expect(props.onElectricityRateChange).toHaveBeenLastCalledWith(DEFAULT_ELECTRICITY_RATE);
  });
});
