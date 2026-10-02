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
import { Table, Text } from '@/components/ui';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { useUnits } from '@/hooks/useUnits';
import type { ChartDataPoint, DriveStats } from './types';
import type { DriveDetail } from '@/types/driving';

interface PowerProfileChartProps {
  chartData: ChartDataPoint[];
  stats: DriveStats;
  drive?: DriveDetail;
}

export function PowerProfileChart({ chartData, drive }: PowerProfileChartProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const syncProps = useSyncedCursor();
  const syncedX = useSyncedReferenceLineX();

  // A single sample can't form an area — treat 0/1 points (or a missing
  // array) as "no chart" so an undefined `chartData` degrades to the empty
  // state instead of throwing on `.length`.
  const powers = (chartData ?? []).map((row) => row.power).filter((value): value is number => value != null && Number.isFinite(value));
  const speeds = (chartData ?? []).map((row) => row.speed).filter((value): value is number => value != null && value > 0 && Number.isFinite(value));
  const hasChart = powers.length > 1;
  const max = powers.length ? powers.reduce((result, value) => Math.max(result, value), -Infinity) : null;
  const min = powers.length ? powers.reduce((result, value) => Math.min(result, value), Infinity) : null;
  const mean = powers.length ? powers.reduce((sum, value) => sum + value, 0) / powers.length : null;
  const minMoving = speeds.length ? speeds.reduce((result, value) => Math.min(result, value), Infinity) : null;

  return (
    <FadeIn>
      {/* chart-a11y:no-table dense per-sample power trace; max/regen/avg stats appear below the chart */}
      <ChartContainer
        title={t('driveDetail.powerProfile', 'Power profile')}
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
      <div className="mt-3 space-y-2">
        <Text as="p" variant="caption">{t('driveDetail.report.powerMethod', 'Power samples preserve sign: positive draw, negative regeneration. Peak values require observations.')}</Text>
        <Table aria-label={t('driveDetail.powerProfile', 'Power profile')}>
          <tbody>
            <tr><th scope="row">{t('driveDetail.maxPower', 'Maximum power')}</th><td>{max != null ? `${fmtInt(max)} kW` : '—'}</td></tr>
            <tr><th scope="row">{t('driveDetail.maxRegen', 'Maximum regen')}</th><td>{min != null && min < 0 ? `${fmtInt(min)} kW` : min != null ? '0 kW' : '—'}</td></tr>
            <tr><th scope="row">{t('driveDetail.report.sampleMeanPower', 'Mean sampled power')}</th><td>{mean != null ? `${fmtNumber(mean)} kW` : '—'}</td></tr>
            <tr><th scope="row">{t('driveDetail.avgPower', 'Average power')}</th><td>{drive?.avgPowerW != null && Number.isFinite(drive.avgPowerW) ? `${fmtNumber(drive.avgPowerW / 1000)} kW` : '—'}</td></tr>
            <tr><th scope="row">{t('driveDetail.minSpeed', 'Minimum moving speed')}</th><td>{minMoving != null ? `${fmtNumber(minMoving)} ${unitPrefs.speed}` : '—'}</td></tr>
          </tbody>
        </Table>
      </div>
    </FadeIn>
  );
}
