import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { fmtNumber, fmtPercent, fmtWithUnit, safeNumber } from '@/lib/numberFormat';
import { formatDateTime } from '@/lib/dateFormat';
import type { EfficiencyStats } from './helpers';

interface EfficiencyPanelProps {
  stats: EfficiencyStats;
}

export function EfficiencyPanel({ stats }: EfficiencyPanelProps) {
  const { t } = useTranslation();

  // Clamp the average-efficiency bar into a valid [0, 100] progress width so a
  // non-finite / undefined / negative / over-100 value can never emit `NaN%`
  // or an out-of-range fill. `safeNumber` collapses null/undefined/NaN/±∞ to 0.
  // Memoised so the inline width style stays referentially stable per render.
  const bar = useMemo(() => {
    const pct = Math.max(0, Math.min(safeNumber(stats.avgEfficiency), 100));
    return { pct, style: { width: `${pct}%` } };
  }, [stats.avgEfficiency]);

  const sessionCount = stats.count ?? 0;

  return (
    <GlassPanel className="p-5">
      <h3 className="section-title flex items-center gap-2 mb-4">
        <Activity className="h-4 w-4 text-neon-green" aria-hidden="true" />
        {t('charging.efficiency.title', 'Charging Efficiency')}
        <span className="text-xs text-[var(--text-muted)] font-normal ml-2">
          {t('charging.efficiency.hint', 'Wall-to-battery energy conversion')} ({sessionCount} {t('charging.efficiency.sessionsWithData', 'sessions with data')})
        </span>
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <GlassPanel className="p-5 text-center">
          <p className="text-2xl font-bold text-cyan-300">{fmtPercent(stats.avgEfficiency)}</p>
          <p className="text-2xs text-[var(--text-muted)] mt-1">{t('charging.efficiency.average', 'Average Efficiency')}</p>
          <div
            className="mt-2 h-1.5 rounded-full bg-white/[0.05] overflow-hidden"
            role="progressbar"
            aria-valuenow={Math.round(bar.pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('charging.efficiency.averageBar', 'Average charging efficiency')}
          >
            <div className="h-full rounded-full bg-neon-cyan" style={bar.style} />
          </div>
        </GlassPanel>
        <GlassPanel className="p-5 text-center">
          <p className="text-2xl font-bold text-emerald-300">{fmtPercent(stats.best?.efficiency)}</p>
          <p className="text-2xs text-[var(--text-muted)] mt-1">{t('charging.efficiency.best', 'Best Session')}</p>
          <p className="text-2xs text-[var(--text-muted)]">{formatDateTime(stats.best?.date)}</p>
        </GlassPanel>
        <GlassPanel className="p-5 text-center">
          <p className="text-2xl font-bold text-rose-300">{fmtPercent(stats.worst?.efficiency)}</p>
          <p className="text-2xs text-[var(--text-muted)] mt-1">{t('charging.efficiency.worst', 'Worst Session')}</p>
          <p className="text-2xs text-[var(--text-muted)]">{formatDateTime(stats.worst?.date)}</p>
        </GlassPanel>
        <GlassPanel className="p-5 text-center">
          <p className="text-2xl font-bold text-amber-300">{fmtWithUnit(stats.wallLoss, 'kWh')}</p>
          <p className="text-2xs text-[var(--text-muted)] mt-1">{t('charging.efficiency.wallLoss', 'Wall-to-Battery Loss')}</p>
          <p className="text-2xs text-[var(--text-muted)]">{fmtNumber(stats.totalUsed)} kWh → {fmtNumber(stats.totalAdded)} kWh</p>
        </GlassPanel>
      </div>
    </GlassPanel>
  );
}
