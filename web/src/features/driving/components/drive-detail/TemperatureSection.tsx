import { useTranslation } from 'react-i18next';
import { Thermometer, Activity } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import {
  ChartTooltip,
  LineChart, Line, Legend,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';
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

  return (
    <FadeIn>
      <GlassPanel className="p-6">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
          <Thermometer className="h-4 w-4 text-orange-400" /> {t('driveDetail.temperatures', 'Temperatures')}
        </h3>
        {stats.hasAnyTemp && (
          <div className="grid grid-cols-3 gap-3 mb-4">
            {stats.avgOutsideTemp != null && (
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                <p className="text-[9px] text-[var(--text-muted)]">{t('driveDetail.outsideTemp', 'Outside Temperature')}</p>
                <p className="text-sm font-bold text-blue-400">{fmtNumber(stats.avgOutsideTemp)}{tempUnit}</p>
              </div>
            )}
            {stats.avgInsideTemp != null && (
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                <p className="text-[9px] text-[var(--text-muted)]">{t('driveDetail.insideTemp', 'Inside Temperature')}</p>
                <p className="text-sm font-bold text-orange-400">{fmtNumber(stats.avgInsideTemp)}{tempUnit}</p>
              </div>
            )}
            {stats.driverTemps.length > 0 && (
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                <p className="text-[9px] text-[var(--text-muted)]">{t('driveDetail.driverTemp', 'Driver Temperature')}</p>
                <p className="text-sm font-bold text-rose-400">{fmtNumber(stats.driverTemps.reduce((a, b) => a + b, 0) / stats.driverTemps.length)}{tempUnit}</p>
              </div>
            )}
            {stats.passengerTemps.length > 0 && (
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                <p className="text-[9px] text-[var(--text-muted)]">{t('driveDetail.passengerTemp', 'Passenger Temperature')}</p>
                <p className="text-sm font-bold text-purple-400">{fmtNumber(stats.passengerTemps.reduce((a, b) => a + b, 0) / stats.passengerTemps.length)}{tempUnit}</p>
              </div>
            )}
            {stats.climateStatus != null && (
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                <p className="text-[9px] text-[var(--text-muted)]">{t('driveDetail.climate', 'Climate')}</p>
                <p className={`text-sm font-bold ${stats.climateStatus === 'On' ? 'text-green-400' : 'text-[var(--text-muted)]'}`}>{stats.climateStatus}</p>
              </div>
            )}
            {stats.maxFanSpeed != null && (
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                <p className="text-[9px] text-[var(--text-muted)]">{t('driveDetail.fanStatus', 'Fan Status')}</p>
                <p className="text-sm font-bold text-cyan-400">{t('driveDetail.avg', 'Avg')} {fmtInt(stats.avgFanSpeed)} · Max {stats.maxFanSpeed}</p>
              </div>
            )}
          </div>
        )}
        <div className="h-56">
          {chartData.length > 1 && stats.hasAnyTemp ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={LEGEND_STYLE} />
                {stats.outsideTemps.length > 0 && (
                  <Line type="monotone" dataKey="outsideTemp" stroke="#3b82f6" strokeWidth={2} dot={false} name={`${t('driveDetail.outside', 'Outside')} ${tempUnit}`} connectNulls />
                )}
                {stats.insideTemps.length > 0 && (
                  <Line type="monotone" dataKey="insideTemp" stroke="#f97316" strokeWidth={2} dot={false} name={`${t('driveDetail.inside', 'Inside')} ${tempUnit}`} connectNulls />
                )}
                {stats.driverTemps.length > 0 && (
                  <Line type="monotone" dataKey="driverTemp" stroke="#fb7185" strokeWidth={2} dot={false} name={`${t('driveDetail.driver', 'Driver')} ${tempUnit}`} connectNulls />
                )}
                {stats.passengerTemps.length > 0 && (
                  <Line type="monotone" dataKey="passengerTemp" stroke="#a855f7" strokeWidth={2} dot={false} name={`${t('driveDetail.passenger', 'Passenger')} ${tempUnit}`} connectNulls />
                )}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
              <Activity className="h-8 w-8 opacity-20" />
              <p className="text-xs">{t('driveDetail.noChartData', 'No telemetry data available')}</p>
            </div>
          )}
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
