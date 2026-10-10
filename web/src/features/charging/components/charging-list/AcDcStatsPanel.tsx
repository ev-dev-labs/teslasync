import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { GlassPanel, DataTable, type Column } from '@/components/ui';
import { Currency } from '@/components/data-display';
import { fmtWithUnit } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { formatDuration } from '../ChargingSessionCard';
import type { AcDcBreakdown, AcDcBucket } from './helpers';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { ChargingSummaryBrief } from '../operationalbrief-all/ChargingSummaryBrief';

interface AcDcStatsPanelProps {
  breakdown: AcDcBreakdown;
}

interface AcDcTableRow {
  label: string;
  color: string;
  energy: number;
  cost: number | null;
  count: number;
  totalDuration: number;
  freeCount: number;
  freeEnergy: number;
}

const AC_COLOR = '#3b82f6';
const DC_COLOR = '#f59e0b';

const EMPTY_BUCKET: AcDcBucket = {
  energy: 0,
  energyUsed: 0,
  cost: 0,
  count: 0,
  totalDuration: 0,
  freeCount: 0,
  freeEnergy: 0,
};

/**
 * Render an energy figure (already in kWh) at a human scale: values ≥ 1000 kWh
 * switch to MWh so fleet-scale totals stay legible. Nullish / non-finite inputs
 * degrade to "0.00 kWh" instead of leaking `NaN`/`undefined` into the UI.
 */
export function formatEnergyDisplay(kwh: number | null | undefined): string {
  const v = typeof kwh === 'number' && Number.isFinite(kwh) ? kwh : 0;
  return v >= 1000 ? fmtWithUnit(v / 1000, 'MWh') : fmtWithUnit(v, 'kWh');
}

export function AcDcStatsPanel({ breakdown }: AcDcStatsPanelProps) {
  const { fmtPercent, fmtWithUnit } = useNumberFormatting();
  const { t } = useTranslation();

  const acEnergy = breakdown?.ac?.energy ?? 0;
  const dcEnergy = breakdown?.dc?.energy ?? 0;
  const totalEnergy = breakdown?.total?.energy ?? 0;
  const freeCount = breakdown?.total?.freeCount ?? 0;
  const freeEnergy = breakdown?.total?.freeEnergy ?? 0;

  // Guard the split-bar geometry: a zero total would divide to NaN and emit an
  // invalid `NaN%` grid-template, collapsing the bar into garbage.
  const hasEnergy = totalEnergy > 0;
  const acPct = hasEnergy ? (acEnergy / totalEnergy) * 100 : 0;
  const dcPct = hasEnergy ? (dcEnergy / totalEnergy) * 100 : 0;

  return (
    <GlassPanel className="h-full p-5">
      <h3 className="section-title flex items-center gap-2 mb-4">
        <Zap className="h-4 w-4 text-amber-300" aria-hidden="true" />
        {t('charging.stats.chargingByType', 'Charging stats by type')}
      </h3>

      {/* Energy Split Bar */}
      <div className="mb-4">
        <p className="text-2xs text-[var(--text-muted)] mb-1.5">
          {t('charging.stats.energySplitLabel', 'Energy split (AC vs DC)')}
        </p>
        {hasEnergy ? (
          <>
            <div
              className="grid h-4 rounded-full overflow-hidden"
              role="img"
              aria-label={t('charging.stats.energySplitAria', 'Energy split: {{ac}}% AC, {{dc}}% DC', {
                ac: Math.round(acPct),
                dc: Math.round(dcPct),
              })}
              style={{ gridTemplateColumns: `${acPct}% ${dcPct}%` }}
            >
              {acEnergy > 0 && (
                <div className="col-start-1 flex items-center justify-center text-2xs font-bold text-[var(--text-primary)] bg-blue-500">
                  AC {fmtPercent(acPct)}
                </div>
              )}
              {dcEnergy > 0 && (
                <div className="col-start-2 flex items-center justify-center text-2xs font-bold text-[var(--text-primary)] bg-amber-500">
                  DC {fmtPercent(dcPct)}
                </div>
              )}
            </div>
            <div className="flex justify-between text-2xs text-[var(--text-muted)] mt-1">
              <span>AC: {formatEnergyDisplay(acEnergy)}</span>
              <span>Total: {formatEnergyDisplay(totalEnergy)}</span>
              <span>DC: {formatEnergyDisplay(dcEnergy)}</span>
            </div>
          </>
        ) : (
          <p className="text-2xs text-[var(--text-muted)] text-center py-2">
            {t('charging.stats.noEnergyData', 'No energy recorded for these sessions yet.')}
          </p>
        )}
      </div>

      {/* Stats Table */}
      <div className="overflow-x-auto">
        <AcDcTable ac={breakdown?.ac} dc={breakdown?.dc} />
      </div>

      {/* Free charging total */}
      {freeCount > 0 && (
        <ChargingSummaryBrief className="mt-3"
          title={t('charging.table.freeCharged', 'Free charged')}
          metrics={[
            { metricId: 'count', occurrenceId: 'free-sessions', rawValue: freeCount,
              label: t('charging.table.freeCharged', 'Free charged'),
              display: { formatter: raw => ({ value: t('charging.stats.freeSessions', '{{count}} sessions', { count: raw }), unit: '' }) } },
            { metricId: 'energy', occurrenceId: 'free-energy', rawValue: freeEnergy * 1000,
              label: t('charging.table.freeEnergy', 'Free energy'),
              display: { formatter: raw => ({ value: fmtWithUnit(raw / 1000, 'kWh'), unit: '' }) } },
          ]}
          period={{ kind: 'unknown', label: t('charging.brief.loadedSessions', 'Loaded charging sessions'),
            reason: t('charging.brief.freeScope', 'Recorded zero-cost sessions in the loaded AC/DC history; unknown costs are not counted as free.') }} />
      )}
    </GlassPanel>
  );
}

function AcDcTable({ ac, dc }: { ac?: AcDcBucket; dc?: AcDcBucket }) {
  const { fmtWithUnit } = useNumberFormatting();
  const { t } = useTranslation();
  const data: AcDcTableRow[] = [
    { label: t('charging.table.acCharging', 'AC charging'), color: AC_COLOR, ...(ac ?? EMPTY_BUCKET) },
    { label: t('charging.table.dcCharging', 'DC charging'), color: DC_COLOR, ...(dc ?? EMPTY_BUCKET) },
  ].filter((r) => r.count > 0);

  const columns: Column<AcDcTableRow>[] = [
    { key: 'type', header: t('charging.table.type', 'Type'), render: (r) => <span className={cn('font-medium', r.color === AC_COLOR ? 'text-blue-500' : 'text-amber-500')}>{r.label}</span> },
    { key: 'sessions', header: t('charging.table.sessionCount', 'Sessions'), render: (r) => <span className="text-[var(--text-primary)]">{r.count}</span>, align: 'right' },
    { key: 'energy', header: t('charging.table.energy', 'Energy'), render: (r) => <span className="text-[var(--text-primary)]">{formatEnergyDisplay(r.energy)}</span>, align: 'right' },
    { key: 'cost', header: t('charging.table.cost', 'Cost'), render: (r) => r.cost != null ? <Currency value={r.cost} className="text-amber-300" /> : <span className="text-[var(--text-secondary)]">—</span>, align: 'right' },
    { key: 'perKwh', header: t('charging.table.costPerKwh', '$/kWh'), render: (r) => r.energy > 0 && r.cost != null ? <Currency value={r.cost / r.energy} className="text-[var(--text-secondary)]" /> : <span className="text-[var(--text-secondary)]">—</span>, align: 'right' },
    { key: 'avgEnergy', header: t('charging.table.avgEnergy', 'Avg energy'), render: (r) => <span className="text-[var(--text-secondary)]">{fmtWithUnit(r.count > 0 ? r.energy / r.count : 0, 'kWh')}</span>, align: 'right' },
    { key: 'avgTime', header: t('charging.table.avgTime', 'Avg time'), render: (r) => <span className="text-[var(--text-secondary)]">{formatDuration(r.count > 0 ? r.totalDuration / r.count : 0)}</span>, align: 'right' },
    { key: 'free', header: t('charging.table.free', 'Free'), render: (r) => <span className="text-emerald-300">{r.freeCount > 0 ? `${r.freeCount} (${fmtWithUnit(r.freeEnergy, 'kWh')})` : '—'}</span>, align: 'right' },
  ];

  return (
    <DataTable<AcDcTableRow>
      tableId="charging:ac-dc-stats"
      caption={t('charging.stats.chargingByType', 'Charging stats by type')}
      columns={columns}
      mobileColumns={['type', 'energy', 'cost']}
      data={data}
      keyExtractor={(r) => r.label}
      emptyMessage={t('charging.stats.noData', 'No AC/DC charging data')}
      compact
      pagination
    />
  );
}
