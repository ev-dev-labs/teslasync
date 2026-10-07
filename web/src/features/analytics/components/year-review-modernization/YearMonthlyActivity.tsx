import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChartContainer, ChartLegend, ComposedChart, Bar, Line, XAxis, YAxis,
  Tooltip, ResponsiveContainer, ChartTooltip, chartGrid, axisTick,
} from '@/components/charts';
import { containerPolicy, useCardPlacement } from '@/components/layout/layout-reference';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { cn } from '@/lib/cn';
import type { YearReview } from '@/api/types';
import { monthShortLabel } from './yearReviewPresentation';

interface Props {
  data?: YearReview;
  loading: boolean;
  error?: unknown;
  onRetry: () => void;
  emptyMessage: string;
}

/** Keep the full chart frame: ChartCard intentionally disables its export menu. */
export function YearMonthlyActivity({ data, loading, error, onRetry, emptyMessage }: Props) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const { unitPrefs } = useUnits();
  const { distance: distanceUnit, locale } = unitPrefs;
  const hidden = useHiddenSeries('year-monthly-chart');
  const placement = useCardPlacement();
  const height = containerPolicy(placement?.width ?? 0).chartHeight;
  const { reduce } = useMotionPreference();

  // Display boundary only. Ordering, rounding, energy column and source rows
  // are identical to the original; no sampling or new aggregate is introduced.
  const rows = useMemo(() => (data?.monthly_stats ?? []).map(m => ({
    month: monthShortLabel(m.month, locale),
    drives: m.drives ?? 0,
    distance: Math.round(convertDistanceFromSI((m.distance_km ?? 0) * 1000, distanceUnit)),
    energy: Math.round(m.energy_kwh ?? 0),
  })), [data?.monthly_stats, distanceUnit, locale]);
  const drivesName = t('yearReview.drives', 'drives');
  const distanceName = t('yearReview.distanceSeries', { unit: distanceUnit, defaultValue: 'Distance ({{unit}})' });

  return (
    <div data-card data-card-size={placement?.size ?? 'half'} data-card-resolved-span={placement?.span ?? 1}
      className={cn('flex min-w-0 flex-col', placement?.className)}>
      <ChartContainer
        title={t('yearReview.monthlyActivity', 'Monthly activity')}
        subtitle={data ? t('yearReview.avgPerWeek', { count: fmtInt(data.avg_drives_per_week ?? 0), defaultValue: '{{count}} drives per week on average' }) : undefined}
        ariaLabel={t('yearReview.monthlyActivityAria', 'Bar and line chart of monthly drives and distance across the year')}
        loading={loading}
        error={error}
        onRetry={onRetry}
        empty={rows.length === 0}
        emptyMessage={emptyMessage}
        height={height}
        mobileHeight={height}
        className="h-full"
        exportable
        exportFilename="year-review-monthly"
        data={rows}
        dataColumns={[
          { key: 'month', label: t('yearReview.month', 'Month') },
          { key: 'drives', label: drivesName },
          { key: 'distance', label: distanceName },
          { key: 'energy', label: t('yearReview.energyKwh', 'kWh') },
        ]}
        chartKey="year-monthly-chart"
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            {chartGrid}
            <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} minTickGap={32} />
            <YAxis yAxisId="left" tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis yAxisId="right" orientation="right" tick={axisTick} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip />} />
            <ChartLegend state={hidden} wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="left" dataKey="drives" name={drivesName} fill="#a78bfa" radius={[4, 4, 0, 0]} maxBarSize={36}
              animationDuration={reduce ? 0 : 800} hide={hidden.isHidden('drives')} />
            <Line yAxisId="right" type="monotone" dataKey="distance" name={distanceName} stroke="#22d3ee" strokeWidth={2} dot={false}
              animationDuration={reduce ? 0 : 800} hide={hidden.isHidden('distance')} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartContainer>
    </div>
  );
}
