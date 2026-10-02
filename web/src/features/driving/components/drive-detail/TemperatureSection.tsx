import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import {
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  AREA_DEFAULTS,
  LineChart, Line, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  useSyncedCursor, useSyncedReferenceLineX,
} from '@/components/charts';
import { chartTokens } from '@/lib/tokens';
import { FadeIn } from '@/components/motion';
import { Table } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { LEGEND_STYLE } from './helpers';
import type { ChartDataPoint, DriveStats } from './types';

interface TemperatureSectionProps {
  chartData: ChartDataPoint[];
  stats: DriveStats;
}

/** Arithmetic mean of a numeric series, or null when the series is empty.
 *  Mirrors the averaging `useDriveDetailData` applies to the inside/outside
 *  series so the driver/passenger tiles stay consistent with the rest. */
function meanOrNull(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function TemperatureSection({ chartData, stats }: TemperatureSectionProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const tempUnit = unitPrefs.temperature;
  const syncProps = useSyncedCursor();
  const syncedX = useSyncedReferenceLineX();
  const hidden = useHiddenSeries('drive-detail-temperature');

  const points = chartData ?? [];
  const outsideTemps = stats.outsideTemps ?? [];
  const insideTemps = stats.insideTemps ?? [];
  const driverTemps = stats.driverTemps ?? [];
  const passengerTemps = stats.passengerTemps ?? [];

  const driverAvg = useMemo(() => meanOrNull(driverTemps), [driverTemps]);
  const passengerAvg = useMemo(() => meanOrNull(passengerTemps), [passengerTemps]);

  const hasChart = points.length > 1 && stats.hasAnyTemp;

  return (
    <FadeIn className="space-y-3">
      <Table aria-label={t('driveDetail.temperatures', 'Temperatures')}>
        <tbody>
          {[
            { id: 'outside', label: t('driveDetail.outsideTemp', 'Outside temperature'), value: stats.avgOutsideTemp },
            { id: 'inside', label: t('driveDetail.insideTemp', 'Inside temperature'), value: stats.avgInsideTemp },
            { id: 'driver', label: t('driveDetail.driverTemp', 'Driver temperature'), value: driverAvg },
            { id: 'passenger', label: t('driveDetail.passengerTemp', 'Passenger temperature'), value: passengerAvg },
          ].map((row) => <tr key={row.id}><th scope="row">{row.label}</th><td className="tabular-nums">{row.value != null ? `${fmtNumber(row.value)}${tempUnit}` : '—'}</td></tr>)}
          <tr><th scope="row">{t('driveDetail.climate', 'Climate')}</th><td>{stats.climateStatus == null ? '—' : stats.climateStatus === 'On' ? t('driveDetail.report.climateOn', 'On') : stats.climateStatus === 'Off' ? t('driveDetail.report.climateOff', 'Off') : t('driveDetail.report.climateMostlyOff', 'Mostly off')}</td></tr>
          <tr><th scope="row">{t('driveDetail.fanStatus', 'Fan status')}</th><td>{stats.maxFanSpeed != null ? `${t('driveDetail.avg', 'Avg')} ${fmtInt(stats.avgFanSpeed)} · ${t('driveDetail.max', 'Max')} ${fmtInt(stats.maxFanSpeed)}` : '—'}</td></tr>
        </tbody>
      </Table>
      {/* chart-a11y:no-table dense per-sample temperature trace; min/avg stats appear above the chart in the stat tiles */}
      <ChartContainer
        title={t('driveDetail.temperatures', 'Temperatures')}
        ariaLabel={t('driveDetail.temperatures.aria', 'Inside, outside, driver and passenger temperature lines over the drive timeline')}
        height={310}
        chartKey="drive-detail-temperature"
      >
        {hasChart ? (
          <>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={points}
                syncId={syncProps.syncId}
                syncMethod={syncProps.syncMethod}
                onMouseMove={syncProps.onMouseMove}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend state={hidden} wrapperStyle={LEGEND_STYLE} />
                {outsideTemps.length > 0 ? (
                  <Line {...AREA_DEFAULTS} dataKey="outsideTemp" stroke="#3b82f6" name={`${t('driveDetail.outside', 'Outside')} ${tempUnit}`} hide={hidden.isHidden('outsideTemp')} />
                ) : null}
                {insideTemps.length > 0 ? (
                  <Line {...AREA_DEFAULTS} dataKey="insideTemp" stroke="#f97316" name={`${t('driveDetail.inside', 'Inside')} ${tempUnit}`} hide={hidden.isHidden('insideTemp')} />
                ) : null}
                {driverTemps.length > 0 ? (
                  <Line {...AREA_DEFAULTS} dataKey="driverTemp" stroke="#fb7185" name={`${t('driveDetail.driver', 'Driver')} ${tempUnit}`} hide={hidden.isHidden('driverTemp')} />
                ) : null}
                {passengerTemps.length > 0 ? (
                  <Line {...AREA_DEFAULTS} dataKey="passengerTemp" stroke="#a855f7" name={`${t('driveDetail.passenger', 'Passenger')} ${tempUnit}`} hide={hidden.isHidden('passengerTemp')} />
                ) : null}
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
              </LineChart>
            </ResponsiveContainer>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
            <Activity className="h-8 w-8 opacity-20" aria-hidden="true" />
            <p className="text-xs">{t('driveDetail.noTemperatureData', 'No temperature telemetry is available for this drive.')}</p>
          </div>
        )}
      </ChartContainer>
    </FadeIn>
  );
}
