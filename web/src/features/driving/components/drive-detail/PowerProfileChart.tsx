import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import {
  ChartContainer, ChartTooltip,
  AREA_DEFAULTS, areaGradient,
  AreaChart, Area, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  useSyncedCursor, useSyncedReferenceLineX,
} from '@/components/charts';
import { chartTokens } from '@/lib/tokens';
import { FadeIn } from '@/components/motion';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type { ChartDataPoint, DriveStats } from './types';

interface PowerProfileChartProps {
  chartData: ChartDataPoint[];
  stats: DriveStats;
}

export function PowerProfileChart({ chartData, stats }: PowerProfileChartProps) {
  const { t } = useTranslation();
  const syncProps = useSyncedCursor();
  const syncedX = useSyncedReferenceLineX();

  // A single sample can't form an area — treat 0/1 points (or a missing
  // array) as "no chart" so an undefined `chartData` degrades to the empty
  // state instead of throwing on `.length`.
  const hasChart = (chartData ?? []).length > 1;

  return (
    <FadeIn>
      {/* chart-a11y:no-table dense per-sample power trace; max/regen/avg stats appear below the chart */}
      <ChartContainer
        title={t('driveDetail.powerProfile', 'Power Profile')}
        ariaLabel={t('driveDetail.powerProfile.aria', 'Drive power profile area chart over time')}
        height={220}
      >
        {hasChart ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              syncId={syncProps.syncId}
              syncMethod={syncProps.syncMethod}
              onMouseMove={syncProps.onMouseMove}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
              {areaGradient('powerGrad', '#f59e0b')}
              <Area {...AREA_DEFAULTS} dataKey="power" stroke="#f59e0b" fill="url(#powerGrad)" name={`${t('driveDetail.power', 'Power')} kW`} />
              {syncedX != null && (
                <ReferenceLine
                  x={syncedX}
                  stroke={chartTokens.cursor.stroke}
                  strokeWidth={chartTokens.cursor.strokeWidth}
                  strokeDasharray={chartTokens.cursor.strokeDasharray}
                  ifOverflow="hidden"
                  isFront
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
            <Activity className="h-8 w-8 opacity-20" />
            <p className="text-xs">{t('driveDetail.noChartData', 'No telemetry data available')}</p>
          </div>
        )}
      </ChartContainer>
      {hasChart && (
        <div className="mt-3 flex items-center justify-center gap-6 text-xs text-[var(--text-secondary)]">
          <span>{t('driveDetail.maxPower', 'Max Power')}: <strong className="text-amber-400">{fmtInt(stats.powerMax)} kW</strong></span>
          <span>{t('driveDetail.maxRegen', 'Max Regen')}: <strong className="text-cyan-400">{fmtInt(stats.powerMin)} kW</strong></span>
          <span>{t('driveDetail.avgLabel', 'Avg')}: <strong className="text-[var(--text-primary)]">{fmtNumber(stats.avgPower)} kW</strong></span>
        </div>
      )}
    </FadeIn>
  );
}
