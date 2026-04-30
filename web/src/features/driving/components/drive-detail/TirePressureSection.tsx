import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import {
  ChartTooltip, AREA_DEFAULTS,
  LineChart, Line, Legend,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber } from '@/lib/numberFormat';
import { LEGEND_STYLE } from './helpers';
import type { ChartDataPoint, DriveStats } from './types';

interface TirePressureSectionProps {
  chartData: ChartDataPoint[];
  stats: DriveStats;
}

export function TirePressureSection({ chartData, stats }: TirePressureSectionProps) {
  const { t } = useTranslation();
  const { pressureUnit } = useSettings();

  const tpVals = (key: 'tireFl' | 'tireFr' | 'tireRl' | 'tireRr') => {
    const vals = chartData.map((d) => d[key]).filter((v): v is number => v != null && v > 0);
    return { min: vals.length > 0 ? Math.min(...vals) : null, max: vals.length > 0 ? Math.max(...vals) : null };
  };
  const fl = tpVals('tireFl'), fr = tpVals('tireFr'), rl = tpVals('tireRl'), rr = tpVals('tireRr');
  const tpStats = [
    { label: t('driveDetail.frontLeft', 'Front Left'), color: '#3b82f6', ...fl },
    { label: t('driveDetail.frontRight', 'Front Right'), color: '#10b981', ...fr },
    { label: t('driveDetail.rearLeft', 'Rear Left'), color: '#f59e0b', ...rl },
    { label: t('driveDetail.rearRight', 'Rear Right'), color: '#ef4444', ...rr },
  ];

  return (
    <FadeIn>
      <GlassPanel className="p-6">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
          <Activity className="h-4 w-4 text-cyan-400" /> {t('driveDetail.tirePressure', 'Tire Pressure During Drive')}
        </h3>
        {stats.hasTirePressure ? (
          <>
            <div className="grid grid-cols-4 gap-3 mb-4">
              {tpStats.map((tp) => (
                <div key={tp.label} className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                  <p className="text-[9px] text-[var(--text-muted)]">{tp.label}</p>
                  <p className="text-sm font-bold" style={{ color: tp.color }}>
                    {tp.min != null ? `${fmtNumber(tp.min)}–${fmtNumber(tp.max!)} ${pressureUnit}` : '—'}
                  </p>
                </div>
              ))}
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={LEGEND_STYLE} />
                  {chartData.some((d) => d.tireFl !== null) && (
                    <Line {...AREA_DEFAULTS} dataKey="tireFl" stroke="#3b82f6" name={`FL (${pressureUnit})`} />
                  )}
                  {chartData.some((d) => d.tireFr !== null) && (
                    <Line {...AREA_DEFAULTS} dataKey="tireFr" stroke="#10b981" name={`FR (${pressureUnit})`} />
                  )}
                  {chartData.some((d) => d.tireRl !== null) && (
                    <Line {...AREA_DEFAULTS} dataKey="tireRl" stroke="#f59e0b" name={`RL (${pressureUnit})`} />
                  )}
                  {chartData.some((d) => d.tireRr !== null) && (
                    <Line {...AREA_DEFAULTS} dataKey="tireRr" stroke="#ef4444" name={`RR (${pressureUnit})`} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : (
          <div className="h-56 flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
            <Activity className="h-8 w-8 opacity-20" />
            <p className="text-xs">{t('driveDetail.noChartData', 'No telemetry data available')}</p>
          </div>
        )}
      </GlassPanel>
    </FadeIn>
  );
}
