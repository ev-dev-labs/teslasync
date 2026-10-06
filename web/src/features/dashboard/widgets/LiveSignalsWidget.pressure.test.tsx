import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  getGlobalLocale,
  getGlobalPrecision,
  setGlobalLocale,
  setGlobalPrecision,
} from '@/lib/numberFormat';
import {
  useVehicles,
  useMotorLatest,
  useClimateLatest,
  useSecurityLatest,
  useLatestTirePressure,
} from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import LiveSignalsWidget from './LiveSignalsWidget';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: vi.fn(),
  useMotorLatest: vi.fn(),
  useClimateLatest: vi.fn(),
  useSecurityLatest: vi.fn(),
  useLatestTirePressure: vi.fn(),
}));
vi.mock('@/hooks/useSettings', () => ({ useSettings: vi.fn() }));
vi.mock('./WidgetShell', () => ({
  WidgetShell: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

const ORIGINAL_TIRES = {
  front_left: 280000,
  front_right: 285000,
  rear_left: 290000,
  rear_right: 295000,
};
const WHEELS = ['FL', 'FR', 'RL', 'RR'] as const;
const SIZE = { cols: 2, rows: 2 };

function query<T>(data: T) {
  return {
    data, error: null, isLoading: false, isFetching: false, isStale: false,
    isError: false, dataUpdatedAt: 1, refetch: vi.fn(),
  };
}

function selectPreferences(
  pressure: 'bar' | 'psi' = 'bar',
  temperature: 'C' | 'F' = 'C',
  precision = 2,
) {
  vi.mocked(useSettings).mockReturnValue({
    settings: {
      unit_of_length: 'km', unit_of_temp: temperature,
      unit_of_pressure: pressure, decimal_precision: precision, locale: 'en-US',
    },
  } as unknown as ReturnType<typeof useSettings>);
  // Exercise the real subscribed formatter store, not Settings persistence.
  setGlobalLocale('en-US');
  setGlobalPrecision(precision);
}

function setup() {
  vi.mocked(useVehicles).mockReturnValue(query([{ id: 7 }]) as unknown as ReturnType<typeof useVehicles>);
  vi.mocked(useMotorLatest).mockReturnValue(query({
    di_torque: 245, di_stator_temp: 60, gear: 'D',
  }) as unknown as ReturnType<typeof useMotorLatest>);
  vi.mocked(useClimateLatest).mockReturnValue(query({
    inside_temp: 20, outside_temp: 10, hvac_power: true,
  }) as unknown as ReturnType<typeof useClimateLatest>);
  vi.mocked(useSecurityLatest).mockReturnValue(query({
    locked: true, sentry_mode: true,
  }) as unknown as ReturnType<typeof useSecurityLatest>);
  vi.mocked(useLatestTirePressure).mockReturnValue(
    query({ ...ORIGINAL_TIRES }) as unknown as ReturnType<typeof useLatestTirePressure>,
  );
  selectPreferences();
}

function expectRow(label: string, value: string) {
  const labelNode = screen.getByText(label, { exact: true });
  const row = labelNode.closest('dt')?.nextElementSibling;
  if (!(row instanceof HTMLElement)) throw new Error(`Missing row for ${label}`);
  expect(within(row).getByText(value, { exact: true })).toBeInTheDocument();
}

function expectTires(values: readonly string[]) {
  expect(values).toHaveLength(4);
  WHEELS.forEach((wheel, index) => expectRow(wheel, values[index]));
}

let priorPrecision: number;
let priorLocale: string;
beforeEach(() => {
  priorPrecision = getGlobalPrecision();
  priorLocale = getGlobalLocale();
  vi.clearAllMocks();
  setup();
});
afterEach(() => {
  cleanup();
  setGlobalPrecision(priorPrecision);
  setGlobalLocale(priorLocale);
});

describe('LiveSignalsWidget — raw Pascal display boundary', () => {
  it.each([
    { preference: 'bar' as const, values: ['2.80 bar', '2.85 bar', '2.90 bar', '2.95 bar'] },
    { preference: 'psi' as const, values: ['40.61 psi', '41.34 psi', '42.06 psi', '42.79 psi'] },
  ])('renders all four original Pa readings as $preference', ({ preference, values }) => {
    selectPreferences(preference);
    render(<LiveSignalsWidget vehicleId={7} size={SIZE} />);
    expectTires(values);
    expectRow('Temp', '60.00°C');
    expectRow('Cabin', '20.00°C');
    expectRow('Outside', '10.00°C');
    expectRow('Torque', '245.00 Nm');
    expect(screen.getByText('Locked', { exact: true })).toBeInTheDocument();
    expect(vi.mocked(useLatestTirePressure)).toHaveBeenCalledWith(7, 5000);
  });

  it.each([
    { name: 'null', value: null },
    { name: 'undefined', value: undefined },
    { name: 'NaN', value: Number.NaN },
    { name: 'Infinity', value: Number.POSITIVE_INFINITY },
    { name: '-Infinity', value: Number.NEGATIVE_INFINITY },
  ])('keeps every invalid $name pressure row unavailable', ({ value }) => {
    vi.mocked(useLatestTirePressure).mockReturnValue(query({
      front_left: value, front_right: value, rear_left: value, rear_right: value,
    }) as unknown as ReturnType<typeof useLatestTirePressure>);
    render(<LiveSignalsWidget vehicleId={7} size={SIZE} />);
    expectTires(['—', '—', '—', '—']);
    expect(screen.getAllByText('—', { exact: true })).toHaveLength(4);
    expectRow('Cabin', '20.00°C');
  });

  it.each([
    { precision: 0, values: ['3 bar', '3 bar', '3 bar', '3 bar'], temp: '60°C' },
    { precision: 1, values: ['2.8 bar', '2.9 bar', '2.9 bar', '3.0 bar'], temp: '60.0°C' },
    { precision: 3, values: ['2.800 bar', '2.850 bar', '2.900 bar', '2.950 bar'], temp: '60.000°C' },
  ])('preserves selected formatter precision $precision', ({ precision, values, temp }) => {
    selectPreferences('bar', 'C', precision);
    render(<LiveSignalsWidget vehicleId={7} size={SIZE} />);
    expectTires(values);
    expectRow('Temp', temp);
  });

  it('updates preference and precision without changing raw inputs or temperature math', () => {
    const { rerender } = render(<LiveSignalsWidget vehicleId={7} size={SIZE} />);
    expectTires(['2.80 bar', '2.85 bar', '2.90 bar', '2.95 bar']);
    act(() => selectPreferences('psi', 'F', 3));
    rerender(<LiveSignalsWidget vehicleId={7} size={SIZE} />);
    expectTires(['40.611 psi', '41.336 psi', '42.061 psi', '42.786 psi']);
    expectRow('Temp', '140.000°F');
    expectRow('Cabin', '68.000°F');
    expectRow('Outside', '50.000°F');
    expectRow('Torque', '245.000 Nm');
  });
});
