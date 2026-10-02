import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import {
  ChartContainer, ChartLegend, ChartTooltip,
  ComposedChart, Area, Line, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  useSyncedCursor, useSyncedReferenceLineX,
} from '@/components/charts';
import { chartTokens } from '@/lib/tokens';
import { FadeIn } from '@/components/motion';
import { Table } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import type { ChartDataPoint, DriveStats } from './types';

interface ElevationChartProps {
  chartData: ChartDataPoint[];
  stats: DriveStats;
}

export function ElevationChart({ chartData, stats }: ElevationChartProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const speedUnit = unitPrefs.speed;
  const syncProps = useSyncedCursor();
  const syncedX = useSyncedReferenceLineX();

  // Null-safe: the drive-detail derivation may hand us `undefined`/`[]` before
  // telemetry resolves, despite the non-optional prop type. Guard once so the
  // `.length` check and the recharts `data` prop never touch a nullish value,
  // and keep a stable reference so <ComposedChart> isn't fed a fresh array.
  const points = useMemo(() => chartData ?? [], [chartData]);
  const elevGain = stats?.elevGain ?? 0;
  const elevLoss = stats?.elevLoss ?? 0;
  const elevNet = elevGain - elevLoss;

  return (
    <FadeIn className="space-y-3">
      <Table aria-label={t('driveDetail.elevSummary', 'Elevation summary')}>
        <tbody>
          <tr><th scope="row">{t('driveDetail.gain', 'Gain')}</th><td>{points.some((row) => row.elevation != null) ? `${fmtNumber(elevGain)} m` : '—'}</td></tr>
          <tr><th scope="row">{t('driveDetail.loss', 'Loss')}</th><td>{points.some((row) => row.elevation != null) ? `${fmtNumber(elevLoss)} m` : '—'}</td></tr>
          <tr><th scope="row">{t('driveDetail.net', 'Net')}</th><td>{points.some((row) => row.elevation != null) ? `${fmtNumber(elevNet)} m` : '—'}</td></tr>
        </tbody>
      </Table>
      {/* chart-a11y:no-table dense per-sample elevation+speed trace; gain/loss/net stats appear above the chart */}
      <ChartContainer
        title={t('driveDetail.elevProfile', 'Elevation profile')}
        ariaLabel={t('driveDetail.elevProfile.aria', 'Elevation and speed area+line chart over the drive timeline')}
        chartKey="drive-detail-elevation"
        height={220}
      >
        {({ hiddenSeries }) => (
          points.filter((point) => point.elevation != null).length > 1 ? (
            <>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={points}
                syncId={syncProps.syncId}
                syncMethod={syncProps.syncMethod}
                onMouseMove={syncProps.onMouseMove}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis yAxisId="elev" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <YAxis yAxisId="speed" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend />
                <Area yAxisId="elev" type="monotone" dataKey="elevation" stroke="#10b981" fill="#10b981" fillOpacity={0.2} strokeWidth={2} name={`${t('driveDetail.elevation', 'Elevation')} (m)`} hide={hiddenSeries?.isHidden('elevation')} />
                <Line yAxisId="speed" type="monotone" dataKey="speed" stroke="#a855f7" strokeWidth={1.5} dot={false} name={`${t('driveDetail.speed', 'Speed')} (${speedUnit})`} strokeOpacity={0.6} hide={hiddenSeries?.isHidden('speed')} />
                {syncedX != null && (
                  <ReferenceLine
                    yAxisId="elev"
                    x={syncedX}
                    stroke={chartTokens.cursor.stroke}
                    strokeWidth={chartTokens.cursor.strokeWidth}
                    strokeDasharray={chartTokens.cursor.strokeDasharray}
                    ifOverflow="hidden"
                    isFront
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
            </>
          ) : (
            <div role="status" className="h-full flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
              <Activity className="h-8 w-8 opacity-20" aria-hidden="true" />
              <p className="text-xs">{t('driveDetail.noChartData', 'No telemetry data available')}</p>
            </div>
          )
        )}
      </ChartContainer>
    </FadeIn>
  );
}
