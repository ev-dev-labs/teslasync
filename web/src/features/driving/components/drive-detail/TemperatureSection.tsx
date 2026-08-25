import { useMemo, type ReactNode } from 'react';
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

interface TempTileProps {
  label: string;
  valueClassName: string;
  children: ReactNode;
}

/** One metric tile in the temperature stat band. The value `<p>` is the
 *  immediate sibling of the label `<p>` so assistive tech (and the co-located
 *  tests) read the value straight back out of the labelled cell. */
function TempTile({ label, valueClassName, children }: TempTileProps) {
  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
      <p className="text-2xs text-[var(--text-muted)]">{label}</p>
      <p className={`text-sm font-bold ${valueClassName}`}>{children}</p>
    </div>
  );
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
    <FadeIn className="h-full">
      {/* chart-a11y:no-table dense per-sample temperature trace; min/avg stats appear above the chart in the stat tiles */}
      <ChartContainer
        title={t('driveDetail.temperatures', 'Temperatures')}
        ariaLabel={t('driveDetail.temperatures.aria', 'Inside, outside, driver and passenger temperature lines over the drive timeline')}
        height={310}
        className="h-full"
        chartKey="drive-detail-temperature"
      >
        {hasChart ? (
          <>
            <div className="grid grid-cols-3 gap-3 mb-3">
              {stats.avgOutsideTemp != null ? (
                <TempTile label={t('driveDetail.outsideTemp', 'Outside Temperature')} valueClassName="text-blue-400">
                  {fmtNumber(stats.avgOutsideTemp)}{tempUnit}
                </TempTile>
              ) : null}
              {stats.avgInsideTemp != null ? (
                <TempTile label={t('driveDetail.insideTemp', 'Inside Temperature')} valueClassName="text-orange-400">
                  {fmtNumber(stats.avgInsideTemp)}{tempUnit}
                </TempTile>
              ) : null}
              {driverAvg != null ? (
                <TempTile label={t('driveDetail.driverTemp', 'Driver Temperature')} valueClassName="text-rose-400">
                  {fmtNumber(driverAvg)}{tempUnit}
                </TempTile>
              ) : null}
              {passengerAvg != null ? (
                <TempTile label={t('driveDetail.passengerTemp', 'Passenger Temperature')} valueClassName="text-purple-400">
                  {fmtNumber(passengerAvg)}{tempUnit}
                </TempTile>
              ) : null}
              {stats.climateStatus != null ? (
                <TempTile label={t('driveDetail.climate', 'Climate')} valueClassName={stats.climateStatus === 'On' ? 'text-green-400' : 'text-[var(--text-muted)]'}>
                  {stats.climateStatus}
                </TempTile>
              ) : null}
              {stats.maxFanSpeed != null ? (
                <TempTile label={t('driveDetail.fanStatus', 'Fan Status')} valueClassName="text-cyan-400">
                  {t('driveDetail.avg', 'Avg')} {fmtInt(stats.avgFanSpeed)} · {t('driveDetail.max', 'Max')} {stats.maxFanSpeed}
                </TempTile>
              ) : null}
            </div>
            <ResponsiveContainer width="100%" height={220}>
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
