import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { GlassPanel, DataTable, type Column } from '@/components/ui';
import { fmtNumber, fmtPercent, fmtWithUnit } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { formatDuration } from '../ChargingSessionCard';
import type { AcDcBreakdown, AcDcBucket } from './helpers';

interface AcDcStatsPanelProps {
  breakdown: AcDcBreakdown;
}

interface AcDcTableRow {
  label: string;
  color: string;
  energy: number;
  cost: number;
  count: number;
  totalDuration: number;
  freeCount: number;
  freeEnergy: number;
}

export function AcDcStatsPanel({ breakdown }: AcDcStatsPanelProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel className="p-5">
      <h3 className="section-title flex items-center gap-2 mb-4">
        <Zap className="h-4 w-4 text-neon-amber" />
        {t('charging.stats.chargingByType', 'Charging Stats by Type')}
      </h3>

      {/* Energy Split Bar */}
      <div className="mb-4">
        <p className="text-[10px] text-[var(--text-muted)] mb-1.5">
          {t('charging.stats.energySplitLabel', 'Energy Split (AC vs DC)')}
        </p>
        <div
          className="grid h-4 rounded-full overflow-hidden"
          style={{ gridTemplateColumns: `${(breakdown.ac.energy / breakdown.total.energy) * 100}% ${(breakdown.dc.energy / breakdown.total.energy) * 100}%` }}
        >
          {breakdown.ac.energy > 0 && (
            <div className="flex items-center justify-center text-[9px] font-bold text-[var(--text-primary)] bg-blue-500">
              AC {fmtPercent((breakdown.ac.energy / breakdown.total.energy) * 100)}
            </div>
          )}
          {breakdown.dc.energy > 0 && (
            <div className="flex items-center justify-center text-[9px] font-bold text-[var(--text-primary)] bg-amber-500">
              DC {fmtPercent((breakdown.dc.energy / breakdown.total.energy) * 100)}
            </div>
          )}
        </div>
        <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-1">
          <span>AC: {breakdown.ac.energy >= 1000 ? fmtWithUnit(breakdown.ac.energy / 1000, 'MWh') : fmtWithUnit(breakdown.ac.energy, 'kWh')}</span>
          <span>Total: {breakdown.total.energy >= 1000 ? fmtWithUnit(breakdown.total.energy / 1000, 'MWh') : fmtWithUnit(breakdown.total.energy, 'kWh')}</span>
          <span>DC: {breakdown.dc.energy >= 1000 ? fmtWithUnit(breakdown.dc.energy / 1000, 'MWh') : fmtWithUnit(breakdown.dc.energy, 'kWh')}</span>
        </div>
      </div>

      {/* Stats Table */}
      <div className="overflow-x-auto">
        <AcDcTable ac={breakdown.ac} dc={breakdown.dc} />
      </div>

      {/* Free charging total */}
      {breakdown.total.freeCount > 0 && (
        <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-center gap-4 text-xs text-[var(--text-secondary)]">
          <span>{t('charging.table.freeCharged', 'Free charged')}: <strong className="text-emerald-300">{breakdown.total.freeCount} sessions</strong></span>
          <span>{t('charging.table.freeEnergy', 'Free energy')}: <strong className="text-emerald-300">{fmtWithUnit(breakdown.total.freeEnergy, 'kWh')}</strong></span>
        </div>
      )}
    </GlassPanel>
  );
}

function AcDcTable({ ac, dc }: { ac: AcDcBucket; dc: AcDcBucket }) {
  const { t } = useTranslation();
  const data: AcDcTableRow[] = [
    { label: t('charging.table.acCharging', 'AC Charging'), color: '#3b82f6', ...ac },
    { label: t('charging.table.dcCharging', 'DC Charging'), color: '#f59e0b', ...dc },
  ].filter((r) => r.count > 0);

  const columns: Column<AcDcTableRow>[] = [
    { key: 'type', header: t('charging.table.type', 'Type'), render: (r) => <span className={cn('font-medium', r.color === '#3b82f6' ? 'text-blue-500' : 'text-amber-500')}>{r.label}</span> },
    { key: 'sessions', header: t('charging.table.sessionCount', 'Sessions'), render: (r) => <span className="text-[var(--text-primary)]">{r.count}</span>, className: 'text-right' },
    { key: 'energy', header: t('charging.table.energy', 'Energy'), render: (r) => <span className="text-[var(--text-primary)]">{r.energy >= 1000 ? fmtWithUnit(r.energy / 1000, 'MWh') : fmtWithUnit(r.energy, 'kWh')}</span>, className: 'text-right' },
    { key: 'cost', header: t('charging.table.cost', 'Cost'), render: (r) => <span className="text-amber-300">${fmtNumber(r.cost)}</span>, className: 'text-right' },
    { key: 'perKwh', header: t('charging.table.costPerKwh', '$/kWh'), render: (r) => <span className="text-[var(--text-secondary)]">${r.energy > 0 ? fmtNumber(r.cost / r.energy) : '—'}</span>, className: 'text-right' },
    { key: 'avgEnergy', header: t('charging.table.avgEnergy', 'Avg Energy'), render: (r) => <span className="text-[var(--text-secondary)]">{fmtWithUnit(r.energy / r.count, 'kWh')}</span>, className: 'text-right' },
    { key: 'avgTime', header: t('charging.table.avgTime', 'Avg Time'), render: (r) => <span className="text-[var(--text-secondary)]">{formatDuration(r.totalDuration / r.count)}</span>, className: 'text-right' },
    { key: 'free', header: t('charging.table.free', 'Free'), render: (r) => <span className="text-emerald-300">{r.freeCount > 0 ? `${r.freeCount} (${fmtWithUnit(r.freeEnergy, 'kWh')})` : '—'}</span>, className: 'text-right' },
  ];

  return (
    <DataTable<AcDcTableRow>
      columns={columns}
      data={data}
      keyExtractor={(r) => r.label}
      compact
      pagination
    />
  );
}
