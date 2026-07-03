import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  ChartTooltip, chartGrid, axisTick,
} from '@/components/charts';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtInt } from '@/lib/numberFormat';
import type { YearReview } from '@/api/types';

interface Props {
  data: YearReview;
}

/** Month-by-month drives (bars) and distance (line) across the year. */
export function YearMonthlyChart({ data }: Props) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { distance: distanceUnit, locale } = unitPrefs;

  const rows = useMemo(() => {
    return (data.monthly_stats ?? []).map((m) => ({
      month: new Date(2000, (m.month ?? 1) - 1, 1).toLocaleString(locale, { month: 'short' }),
      drives: m.drives ?? 0,
      distance: Math.round(convertDistanceFromSI((m.distance_km ?? 0) * 1000, distanceUnit)),
      energy: Math.round((m.energy_wh ?? 0) / 1000),
    }));
  }, [data.monthly_stats, distanceUnit, locale]);

  const drivesName = t('yearReview.drives', 'drives');
  const distanceName = t('yearReview.distanceSeries', { unit: distanceUnit, defaultValue: 'Distance ({{unit}})' });

  return (
    <ChartContainer
      title={t('yearReview.monthlyActivity', 'Monthly activity')}
      subtitle={t('yearReview.avgPerWeek', { count: fmtInt(data.avg_drives_per_week ?? 0), defaultValue: '{{count}} drives per week on average' })}
      ariaLabel={t('yearReview.monthlyActivityAria', 'Bar and line chart of monthly drives and distance across the year')}
      empty={rows.length === 0}
      exportable
      exportFilename="year-review-monthly"
      data={rows}
      dataColumns={[
        { key: 'month', label: t('yearReview.month', 'Month') },
        { key: 'drives', label: drivesName },
        { key: 'distance', label: distanceName },
        { key: 'energy', label: t('yearReview.energyKwh', 'kWh') },
      ]}
    >
      <div className="h-64 sm:h-72 xl:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            {chartGrid}
            <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} />
            <YAxis yAxisId="left" tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis yAxisId="right" orientation="right" tick={axisTick} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="left" dataKey="drives" name={drivesName} fill="#a78bfa" radius={[4, 4, 0, 0]} maxBarSize={36} animationDuration={800} />
            <Line yAxisId="right" type="monotone" dataKey="distance" name={distanceName} stroke="#22d3ee" strokeWidth={2} dot={false} animationDuration={800} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartContainer>
  );
}
