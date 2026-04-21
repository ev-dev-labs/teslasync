import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { fmtNumber, fmtPercent, fmtWithUnit } from '@/lib/numberFormat';
import { formatDateTime } from '@/lib/dateFormat';
import type { EfficiencyStats } from './helpers';

interface EfficiencyPanelProps {
  stats: EfficiencyStats;
}

export function EfficiencyPanel({ stats }: EfficiencyPanelProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel className="p-5">
      <h3 className="section-title flex items-center gap-2 mb-4">
        <Activity className="h-4 w-4 text-neon-green" />
        {t('charging.efficiency.title', 'Charging Efficiency')}
        <span className="text-xs text-[var(--text-muted)] font-normal ml-2">
          {t('charging.efficiency.hint', 'Wall-to-battery energy conversion')} ({stats.count} {t('charging.efficiency.sessionsWithData', 'sessions with data')})
        </span>
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <GlassPanel className="p-5 text-center">
          <p className="text-2xl font-bold text-neon-cyan">{fmtPercent(stats.avgEfficiency)}</p>
          <p className="text-[10px] text-[var(--text-muted)] mt-1">{t('charging.efficiency.average', 'Average Efficiency')}</p>
          <div className="mt-2 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
            <div className="h-full rounded-full bg-neon-cyan" style={{ width: `${Math.min(stats.avgEfficiency, 100)}%` }} />
          </div>
        </GlassPanel>
        <GlassPanel className="p-5 text-center">
          <p className="text-2xl font-bold text-neon-green">{fmtPercent(stats.best.efficiency)}</p>
          <p className="text-[10px] text-[var(--text-muted)] mt-1">{t('charging.efficiency.best', 'Best Session')}</p>
          <p className="text-[9px] text-[var(--text-muted)]">{formatDateTime(stats.best.date)}</p>
        </GlassPanel>
        <GlassPanel className="p-5 text-center">
          <p className="text-2xl font-bold text-neon-red">{fmtPercent(stats.worst.efficiency)}</p>
          <p className="text-[10px] text-[var(--text-muted)] mt-1">{t('charging.efficiency.worst', 'Worst Session')}</p>
          <p className="text-[9px] text-[var(--text-muted)]">{formatDateTime(stats.worst.date)}</p>
        </GlassPanel>
        <GlassPanel className="p-5 text-center">
          <p className="text-2xl font-bold text-neon-amber">{fmtWithUnit(stats.wallLoss, 'kWh')}</p>
          <p className="text-[10px] text-[var(--text-muted)] mt-1">{t('charging.efficiency.wallLoss', 'Wall-to-Battery Loss')}</p>
          <p className="text-[9px] text-[var(--text-muted)]">{fmtNumber(stats.totalUsed)} kWh → {fmtNumber(stats.totalAdded)} kWh</p>
        </GlassPanel>
      </div>
    </GlassPanel>
  );
}
