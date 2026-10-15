import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { deriveDataState } from '@/api/dataState';
import { EfficiencyTemperatureTable } from './EfficiencyTemperatureTable';
import { buildEfficiencyModel, type TemperatureBucket } from './model';
import { fakeQuery, fakeUnits } from './fixtures';
// The table renders through a real I18nextProvider; use the real binding, not the global stub.
vi.unmock('react-i18next');

interface TableProps {
  data: TemperatureBucket[];
  columns: { key: string; header: ReactNode; render: (row: TemperatureBucket) => ReactNode }[];
  mobilePresentation: { displayValue: (row: TemperatureBucket, key: string) => string | number };
}

vi.mock('@/components/ui', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  DataTable: ({ data, columns, mobilePresentation }: TableProps) => <div>
    {columns.map(column => <div key={column.key} data-testid={`column-${column.key}`}>
      <span>{column.header}</span>
      {data.map(row => <div key={row.range} data-testid={`cell-${column.key}`}>
        {column.render(row)}
      </div>)}
    </div>)}
    {data.map(row => <div key={row.range} data-testid="mobile-efficiency">
      {mobilePresentation.displayValue(row, 'avgEff')}
    </div>)}
  </div>,
}));
vi.mock('@/components/layout/layout-reference', () => ({
  LayoutCard: ({ title, children }: { title: string; children: ReactNode }) =>
    <section aria-label={title}>{children}</section>,
}));
vi.mock('./EfficiencySource', () => ({
  EfficiencySource: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtInt: (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value),
    fmtNumber: (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value),
  }),
}));

afterEach(cleanup);

async function show(bucket: TemperatureBucket, miles = false, localized = false) {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en', fallbackLng: 'en', interpolation: { escapeValue: false },
    resources: { en: { translation: localized ? {
      efficiency: { ...en.efficiency, temperatureTable: {
        averageConsumption: '{{unit}} average',
        economy: 'economy in {{unit}}/kWh',
        totalDistance: '{{unit}} total',
        measurement: '{{unit}}: {{value}}',
      } },
    } : en } },
  });
  const units = fakeUnits(miles);
  const model = { ...buildEfficiencyModel([], units.unitPrefs), tempBuckets: [bucket] };
  const efficiencyConversion = vi.spyOn(model, 'toEfficiencyDisplay');
  const distanceConversion = vi.spyOn(model, 'toDistanceDisplay');
  const speedConversion = vi.spyOn(model, 'toSpeedDisplay');
  render(<I18nextProvider i18n={i18n}>
    <EfficiencyTemperatureTable model={model} units={units}
      source={{ state: deriveDataState(fakeQuery([bucket])), loading: false, malformed: false }} />
  </I18nextProvider>);
  return { efficiencyConversion, distanceConversion, speedConversion };
}

const bucket = (value: number | null): TemperatureBucket => ({
  range: '0–10°C', count: 2, avgEff: value, totalDist: value, avgSpeed: value,
});
const cell = (key: string) => screen.getByTestId(`cell-${key}`).textContent;

describe('EfficiencyTemperatureTable localized measurements', () => {
  it.each([false, true])('uses complete English headers and preferred units (miles=%s)', async miles => {
    await show(bucket(250), miles);
    expect(screen.getByTestId('column-avgEff')).toHaveTextContent(miles ? 'Avg Wh/mi' : 'Avg Wh/km');
    expect(screen.getByTestId('column-totalDist')).toHaveTextContent(miles ? 'Total mi' : 'Total km');
    expect(screen.getByTestId('column-kmPerKwh')).toHaveTextContent(miles ? 'mi/kWh' : 'km/kWh');
  });

  it('lets translations reorder whole headers and desktop/mobile measurements', async () => {
    await show(bucket(250), false, true);
    expect(screen.getByTestId('column-avgEff')).toHaveTextContent('Wh/km average');
    expect(screen.getByTestId('column-totalDist')).toHaveTextContent('km total');
    expect(screen.getByTestId('column-kmPerKwh')).toHaveTextContent('economy in km/kWh');
    expect(cell('avgSpeed')).toBe('km/h: 900');
    expect(screen.getByTestId('mobile-efficiency')).toHaveTextContent('Wh/km: 250');
  });

  it.each([null, undefined, NaN, Infinity, -Infinity, '250'])(
    'does not turn missing/invalid operands (%s) into measured zero', async value => {
      const row = bucket(null);
      for (const key of ['avgEff', 'totalDist', 'avgSpeed', 'count']) Reflect.set(row, key, value);
      const conversions = await show(row);
      for (const key of ['avgEff', 'kmPerKwh', 'totalDist', 'avgSpeed', 'count']) {
        expect(cell(key)).toBe('—');
      }
      expect(screen.getByTestId('mobile-efficiency')).toHaveTextContent('—');
      for (const conversion of Object.values(conversions)) expect(conversion).not.toHaveBeenCalled();
    },
  );

  it('keeps measured zero visible but does not divide by zero', async () => {
    await show(bucket(0));
    expect(cell('avgEff')).toBe('0');
    expect(cell('totalDist')).toBe('0');
    expect(cell('avgSpeed')).toBe('0 km/h');
    expect(cell('kmPerKwh')).toBe('—');
    expect(screen.getByTestId('mobile-efficiency')).toHaveTextContent('0 Wh/km');
  });

  it.each([-125.5, 125.5])('preserves signed fractional raw operands (%s)', async value => {
    const { efficiencyConversion, distanceConversion, speedConversion } = await show(bucket(value));
    expect(efficiencyConversion).toHaveBeenCalledWith(value);
    expect(distanceConversion).toHaveBeenCalledWith(value);
    expect(speedConversion).toHaveBeenCalledWith(value);
    expect(cell('avgEff')).toBe(value < 0 ? '-126' : '126');
    expect(cell('totalDist')).toBe(value < 0 ? '-0.13' : '0.13');
    expect(cell('avgSpeed')).toBe(value < 0 ? '-451.8 km/h' : '451.8 km/h');
    expect(cell('kmPerKwh')).toBe(value < 0 ? '—' : '7.97');
  });
});
