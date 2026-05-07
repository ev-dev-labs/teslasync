import { useTranslation } from 'react-i18next';
import { Thermometer, Activity } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import {
  ChartTooltip,
  AREA_DEFAULTS,
  LineChart, Line, Legend, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  useSyncedCursor, useSyncedReferenceLineX,
} from '@/components/charts';
import { chartTokens } from '@/lib/tokens';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { LEGEND_STYLE } from './helpers';
import type { ChartDataPoint, DriveStats } from './types';

interface TemperatureSectionProps {
  chartData: ChartDataPoint[];
  stats: DriveStats;
}

export function TemperatureSection({ chartData, stats }: TemperatureSectionProps) {
  const { t } = useTranslation();
  const { tempUnit } = useSettings();
  const syncProps = useSyncedCursor();
  const syncedX = useSyncedReferenceLineX();

  return (
    <FadeIn className="h-full">
      <GlassPanel className="p-6 h-full">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
          <Thermometer className="h-4 w-4 text-orange-400" /> {t('driveDetail.temperatures', 'Temperatures')}
        </h3>
        {stats.hasAnyTemp ? (
          <div className="grid grid-cols-3 gap-3 mb-4">
            {stats.avgOutsideTemp != null ? (
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                <p className="text-[9px] text-[var(--text-muted)]">{t('driveDetail.outsideTemp', 'Outside Temperature')}</p>
                <p className="text-sm font-bold text-blue-400">{fmtNumber(stats.avgOutsideTemp)}{tempUnit}</p>
              </div>
            ) : null}
            {stats.avgInsideTemp != null ? (
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                <p className="text-[9px] text-[var(--text-muted)]">{t('driveDetail.insideTemp', 'Inside Temperature')}</p>
                <p className="text-sm font-bold text-orange-400">{fmtNumber(stats.avgInsideTemp)}{tempUnit}</p>
              </div>
            ) : null}
            {stats.driverTemps.length > 0 ? (
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                <p className="text-[9px] text-[var(--text-muted)]">{t('driveDetail.driverTemp', 'Driver Temperature')}</p>
                <p className="text-sm font-bold text-rose-400">{fmtNumber(stats.driverTemps.reduce((a, b) => a + b, 0) / stats.driverTemps.length)}{tempUnit}</p>
              </div>
            ) : null}
            {stats.passengerTemps.length > 0 ? (
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                <p className="text-[9px] text-[var(--text-muted)]">{t('driveDetail.passengerTemp', 'Passenger Temperature')}</p>
                <p className="text-sm font-bold text-purple-400">{fmtNumber(stats.passengerTemps.reduce((a, b) => a + b, 0) / stats.passengerTemps.length)}{tempUnit}</p>
              </div>
            ) : null}
            {stats.climateStatus != null ? (
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                <p className="text-[9px] text-[var(--text-muted)]">{t('driveDetail.climate', 'Climate')}</p>
                <p className={`text-sm font-bold ${stats.climateStatus === 'On' ? 'text-green-400' : 'text-[var(--text-muted)]'}`}>{stats.climateStatus}</p>
              </div>
            ) : null}
            {stats.maxFanSpeed != null ? (
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                <p className="text-[9px] text-[var(--text-muted)]">{t('driveDetail.fanStatus', 'Fan Status')}</p>
                <p className="text-sm font-bold text-cyan-400">{t('driveDetail.avg', 'Avg')} {fmtInt(stats.avgFanSpeed)} · Max {stats.maxFanSpeed}</p>
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Activity className="h-8 w-8" />}
            message={t('driveDetail.noTemperatureData', 'No temperature telemetry is available for this drive.')}
            className="py-6"
          />
        )}
        <div className="h-56">
          {chartData.length > 1 && stats.hasAnyTemp ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                syncId={syncProps.syncId}
                syncMethod={syncProps.syncMethod}
                onMouseMove={syncProps.onMouseMove}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={LEGEND_STYLE} />
                {stats.outsideTemps.length > 0 ? (
                  <Line {...AREA_DEFAULTS} dataKey="outsideTemp" stroke="#3b82f6" name={`${t('driveDetail.outside', 'Outside')} ${tempUnit}`} />
                ) : null}
                {stats.insideTemps.length > 0 ? (
                  <Line {...AREA_DEFAULTS} dataKey="insideTemp" stroke="#f97316" name={`${t('driveDetail.inside', 'Inside')} ${tempUnit}`} />
                ) : null}
                {stats.driverTemps.length > 0 ? (
                  <Line {...AREA_DEFAULTS} dataKey="driverTemp" stroke="#fb7185" name={`${t('driveDetail.driver', 'Driver')} ${tempUnit}`} />
                ) : null}
                {stats.passengerTemps.length > 0 ? (
                  <Line {...AREA_DEFAULTS} dataKey="passengerTemp" stroke="#a855f7" name={`${t('driveDetail.passenger', 'Passenger')} ${tempUnit}`} />
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
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Activity className="h-8 w-8" />}
              message={t('driveDetail.noChartData', 'No telemetry data available')}
              className="h-full py-0"
            />
          )}
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
