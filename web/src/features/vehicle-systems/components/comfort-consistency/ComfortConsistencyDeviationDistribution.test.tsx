import { render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';

import english from '@/i18n/en/locale-vehicle-systems.json';
import { formatTemperatureDelta } from '@/lib/unitConversion';
import { summarizeComfortConsistency } from '../../lib/comfortConsistency';
import { ComfortConsistencyDeviationDistribution } from './ComfortConsistencyDeviationDistribution';
import type { ComfortConsistencyQueryState } from './types';

interface ChartRow {
  band: string;
  samples: number;
}

const captured = vi.hoisted(() => ({
  chart: [] as ChartRow[],
  exportData: [] as ChartRow[],
}));

vi.mock('@/components/charts', async () => ({
  ...(await import('@/test/chartTestDoubles')).chartTestDoubles,
  EmbeddedChart: ({ children, data }: { children: ReactNode; data: ChartRow[] }) => {
    captured.exportData = data;
    return <div>{children}</div>;
  },
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BarChart: ({ children, data }: { children: ReactNode; data: ChartRow[] }) => {
    captured.chart = data;
    return <div>{children}</div>;
  },
  Bar: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const state: ComfortConsistencyQueryState = {
  vehicleSelected: true,
  isLoading: false,
  isResolved: true,
  error: null,
  refreshError: null,
  onRetry: vi.fn(),
};

describe('ComfortConsistencyDeviationDistribution', () => {
  it.each(['°C', '°F'] as const)(
    'labels the inclusive final bin with translated copy and preserves populated counts in %s',
    async (temperature) => {
      const i18n = createInstance();
      await i18n.init({
        lng: 'en',
        fallbackLng: 'en',
        resources: { en: { translation: english } },
        interpolation: { escapeValue: false },
      });
      const summary = summarizeComfortConsistency(
        [0, 0.25, 0.5, 1, 2, 3.99, 4, 5].map((deviation, index) => ({
          timestamp: new Date(Date.UTC(2026, 9, 14, 12, index)).toISOString(),
          hvacPower: true,
          insideTemp: 20 + deviation,
          driverTempSetting: 20,
          passengerTempSetting: 20,
        })),
        { comfortBandC: 1 },
      );
      const formatDelta = (value: number | null | undefined) =>
        formatTemperatureDelta(value, {
          distance: 'km',
          speed: 'km/h',
          temperature,
          pressure: 'kPa',
          energy: 'kWh',
          duration: 'min',
          power: 'kW',
          precision: 1,
          locale: 'en-US',
        });

      render(
        <I18nextProvider i18n={i18n}>
          <ComfortConsistencyDeviationDistribution
            summary={summary}
            state={state}
            formatDelta={formatDelta}
          />
        </I18nextProvider>,
      );

      expect(captured.chart).toEqual([
        { band: `${formatDelta(0)}-${formatDelta(0.5)}`, samples: 2 },
        { band: `${formatDelta(0.5)}-${formatDelta(1)}`, samples: 1 },
        { band: `${formatDelta(1)}-${formatDelta(2)}`, samples: 1 },
        { band: `${formatDelta(2)}-${formatDelta(4)}`, samples: 2 },
        { band: `At least ${formatDelta(4)}`, samples: 2 },
      ]);
      expect(captured.chart.at(-1)?.band).toBe(
        temperature === '°C' ? 'At least 4.0°C' : 'At least 7.2°F',
      );
      expect(captured.exportData).toEqual(captured.chart);
      expect(summary.deviationDistribution.at(-1)).toMatchObject({
        lowerC: 4,
        upperC: null,
        samples: 2,
      });
      for (const label of [
        'Sample mean', 'Sample median', 'Sample P90', 'Duration-weighted mean',
      ]) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
      for (const value of [
        summary.meanAbsDeviationC,
        summary.medianAbsDeviationC,
        summary.p90AbsDeviationC,
        summary.durationWeightedMeanAbsDeviationC,
      ]) {
        expect(screen.getAllByText(formatDelta(value)).length).toBeGreaterThan(0);
      }
    },
  );
});
