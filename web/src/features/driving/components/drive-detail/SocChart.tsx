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
import type { ChartDataPoint } from './types';

interface SocChartProps {
  chartData: ChartDataPoint[];
}

export function SocChart({ chartData }: SocChartProps) {
  const { t } = useTranslation();
  const syncProps = useSyncedCursor();
  const syncedX = useSyncedReferenceLineX();

  // `chartData` is typed non-null, but the drive-detail data hook can hand
  // down `undefined` transiently (drive still loading) — guard before `.length`
  // so a mid-fetch render never throws on the missing array.
  const points = chartData ?? [];
  const hasSeries = points.length > 1;

  return (
    <FadeIn className="h-full">
      {/* chart-a11y:no-table dense per-sample SOC trace; start/end SOC visible in the drive summary tiles */}
      <ChartContainer
        title={t('driveDetail.socOverTime', 'SOC % Over Time')}
        ariaLabel={t('driveDetail.socOverTime.aria', 'State of charge percent over time area chart')}
        height={220}
        className="h-full"
      >
        {hasSeries ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={points}
              syncId={syncProps.syncId}
              syncMethod={syncProps.syncMethod}
              onMouseMove={syncProps.onMouseMove}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
              <Tooltip content={<ChartTooltip />} />
              {areaGradient('socGrad', '#10b981')}
              <Area {...AREA_DEFAULTS} dataKey="battery" stroke="#10b981" fill="url(#socGrad)" name={`${t('driveDetail.soc', 'SOC')} %`} />
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
            <Activity className="h-8 w-8 opacity-20" aria-hidden="true" />
            <p className="text-xs">{t('driveDetail.noChartData', 'No telemetry data available')}</p>
          </div>
        )}
      </ChartContainer>
    </FadeIn>
  );
}
