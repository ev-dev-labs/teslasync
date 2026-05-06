import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChargingSession } from '@/api/types';
import {
  ChartContainer,
  ChartTooltip,
  chartGrid,
  axisTickSm,
  AREA_DEFAULTS,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from '@/components/charts';
import { useChartPalette } from '@/hooks/useChartPalette';
import { isDcSession, avg } from './helpers';
import type { MonthlySpeed } from './types';

interface SpeedTrendChartProps {
  sessions: ChargingSession[];
}

export default function SpeedTrendChart({ sessions }: SpeedTrendChartProps) {
  const { t } = useTranslation();
  const palette = useChartPalette();

  const monthlyTrend = useMemo((): MonthlySpeed[] => {
    if (!sessions.length) return [];
    const byMonth = new Map<string, { dc: number[]; ac: number[] }>();
    sessions.forEach((s) => {
      const month = (s.start_ts ?? '').slice(0, 7);
      if (!byMonth.has(month)) byMonth.set(month, { dc: [], ac: [] });
      const group = byMonth.get(month)!;
      const power = s.charger_power_kw_max ?? 0;
      if (isDcSession(s)) group.dc.push(power);
      else group.ac.push(power);
    });
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, { dc, ac }]) => ({
        month,
        dcAvgKw: Math.round(avg(dc) * 10) / 10,
        acAvgKw: Math.round(avg(ac) * 10) / 10,
      }));
  }, [sessions]);

  return (
    <ChartContainer
      title={t('charging.curve.speedTrend', 'Charging Speed Trend')}
      subtitle={t(
        'charging.curve.speedTrendDesc',
        'Monthly average DC vs AC charge rate',
      )}
      ariaLabel={t(
        'charging.curve.speedTrend.aria',
        'Monthly average DC and AC charging speed line chart',
      )}
      data={monthlyTrend.map((m) => ({ month: m.month, dcAvgKw: m.dcAvgKw, acAvgKw: m.acAvgKw }))}
      dataColumns={[
        { key: 'month', label: t('charging.curve.col.month', 'Month') },
        { key: 'dcAvgKw', label: t('charging.curve.col.dcAvgKw', 'DC Avg kW') },
        { key: 'acAvgKw', label: t('charging.curve.col.acAvgKw', 'AC Avg kW') },
      ]}
      height={280}
      exportable
      exportFilename="charging-speed-trend"
    >
      <ResponsiveContainer width="100%" height={280}>
        <LineChart
          data={monthlyTrend}
          margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
        >
          <CartesianGrid {...chartGrid} />
          <XAxis dataKey="month" tick={axisTickSm} />
          <YAxis
            tick={axisTickSm}
            label={{
              value: t('charging.curve.avgKw', 'Avg kW'),
              angle: -90,
              position: 'insideLeft',
              style: { fill: 'rgba(255,255,255,0.4)', fontSize: 11 },
            }}
          />
          <Tooltip content={<ChartTooltip />} />
          <Line
            {...AREA_DEFAULTS}
            dataKey="dcAvgKw"
            name={t('charging.curve.dcAvg', 'DC Avg')}
            stroke={palette[0]}
            dot={{ r: 3, fill: palette[0] }}
            unit=" kW"
          />
          <Line
            {...AREA_DEFAULTS}
            dataKey="acAvgKw"
            name={t('charging.curve.acAvg', 'AC Avg')}
            stroke={palette[1]}
            dot={{ r: 3, fill: palette[1] }}
            unit=" kW"
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-3 flex gap-4 px-2">
        <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <span className="inline-block h-2 w-3 rounded-sm bg-[#00f0ff]" />
          {t('charging.curve.dcFast', 'DC Fast')}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <span className="inline-block h-2 w-3 rounded-sm bg-emerald-500" />
          {t('charging.curve.acHome', 'AC / Home')}
        </div>
      </div>
    </ChartContainer>
  );
}
