import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Route } from 'lucide-react';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { QueryError } from '@/components/feedback';
import {
  ChartContainer, ChartTooltip, ChartGradient,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  axisTickSm, chartGrid, chartAnimation,
} from '@/components/charts';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtNumber, safeNumber } from '@/lib/numberFormat';
import type { TripDetail } from '@/api/types';

interface TripDrivesChartProps {
  trip: TripDetail | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}

/**
 * Hero visual for the Trip Detail page: a horizontal bar chart of distance
 * per drive, derived from the trip's `drives[]` breakdown. Distance is
 * converted to the user's unit at the display boundary.
 */
export function TripDrivesChart({ trip, isLoading, isError, error, onRetry }: TripDrivesChartProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();

  const title = t('trips.detail.chart.title', 'Distance by Drive');
  const distanceLabel = `${t('trips.detail.distance', 'Distance')} (${unitPrefs.distance})`;

  const chartData = useMemo(
    () =>
      (trip?.drives ?? []).map((d, i) => ({
        name: t('trips.detail.chart.driveLabel', 'Drive {{n}}', { n: i + 1 }),
        // safeNumber (not `?? 0`) also coerces NaN/Infinity to 0 so a corrupt
        // reading never feeds a broken bar to Recharts at the display boundary.
        distance: convertDistanceFromSI(safeNumber(d.distance_m), unitPrefs.distance),
      })),
    [trip?.drives, unitPrefs.distance, t],
  );

  const dataColumns = useMemo(
    () => [
      { key: 'name', label: t('trips.detail.chart.col.drive', 'Drive') },
      {
        key: 'distance',
        label: distanceLabel,
        format: (v: unknown) => fmtNumber(v as number, 1),
      },
    ],
    [t, distanceLabel],
  );

  if (isError) {
    return (
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-3 flex items-center gap-2">
          <Route className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {title}
        </PanelTitle>
        <QueryError
          error={error}
          resourceName={t('trips.detail.resourceName', 'Trip')}
          listHref="/trips"
          onRetry={onRetry}
        />
      </GlassPanel>
    );
  }

  const chartHeight = chartData.length > 0
    ? Math.max(220, Math.min(chartData.length * 34 + 48, 520))
    : 280;

  return (
    <ChartContainer
      title={title}
      ariaLabel={t('trips.detail.chart.aria', 'Distance travelled per drive within this trip, as a horizontal bar chart')}
      loading={isLoading && !trip}
      empty={!isLoading && chartData.length === 0}
      height={chartHeight}
      exportFilename="teslasync-trip-drives"
      data={chartData}
      dataColumns={dataColumns}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" {...chartAnimation}>
          <defs>
            <ChartGradient id="tripDriveGrad" color="#00f0ff" opacity={0.8} />
          </defs>
          {chartGrid}
          <XAxis type="number" tick={axisTickSm} />
          <YAxis dataKey="name" type="category" tick={axisTickSm} width={72} />
          <Tooltip content={<ChartTooltip />} />
          <Bar
            dataKey="distance"
            name={distanceLabel}
            fill="url(#tripDriveGrad)"
            radius={[0, 4, 4, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
