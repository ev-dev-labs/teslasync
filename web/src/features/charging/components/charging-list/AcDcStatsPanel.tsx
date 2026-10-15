import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { GlassPanel, DataTable, Caption, SectionTitle, type Column } from '@/components/ui';
import { Currency } from '@/components/data-display';
import { fmtWithUnit } from '@/lib/numberFormat';
import { formatDuration } from '../ChargingSessionCard';
import type { AcDcBreakdown, AcDcBucket } from './helpers';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useFormatting } from '@/hooks/useFormatting';
import { ChargingSummaryBrief } from '../operationalbrief-all/ChargingSummaryBrief';

interface AcDcStatsPanelProps {
  breakdown?: AcDcBreakdown | null;
}

interface AcDcTableRow {
  label: string;
  id: 'ac' | 'dc';
  energy: number;
  cost: number | null;
  count: number;
  totalDuration: number;
  freeCount: number;
  freeEnergy: number;
}

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
 * switch to MWh so fleet-scale totals stay legible. Unknown readings remain
 * distinct from measured zero.
 */
export function formatEnergyDisplay(kwh: number | null | undefined): string {
  if (!isFiniteNumber(kwh)) return '—';
  return kwh >= 1000 ? fmtWithUnit(kwh / 1000, 'MWh') : fmtWithUnit(kwh, 'kWh');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function AcDcStatsPanel({ breakdown }: AcDcStatsPanelProps) {
  const { fmtPercent, fmtWithUnit } = useNumberFormatting();
  const { t } = useTranslation();

  const acEnergy = breakdown?.ac?.energy;
  const dcEnergy = breakdown?.dc?.energy;
  const totalEnergy = breakdown?.total?.energy;
  const freeCount = breakdown?.total?.freeCount ?? 0;
  const freeEnergy = breakdown?.total?.freeEnergy;

  // Guard the split-bar geometry: a zero total would divide to NaN and emit an
  // invalid `NaN%` grid-template, collapsing the bar into garbage.
  const hasEnergy = isFiniteNumber(totalEnergy) && totalEnergy > 0
    && isFiniteNumber(acEnergy) && acEnergy >= 0
    && isFiniteNumber(dcEnergy) && dcEnergy >= 0;
  const acPct = hasEnergy ? (acEnergy / totalEnergy) * 100 : 0;
  const dcPct = hasEnergy ? (dcEnergy / totalEnergy) * 100 : 0;

  return (
    <GlassPanel className="h-full p-5">
      <SectionTitle as="h3" className="flex items-center gap-2 mb-4">
        <Zap className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
        {t('charging.stats.chargingByType', 'Charging stats by type')}
      </SectionTitle>

      {/* Energy Split Bar */}
      <div className="mb-4">
        <Caption as="p" className="mb-1.5">
          {t('charging.stats.energySplitLabel', 'Energy split (AC vs DC)')}
        </Caption>
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
                <div className="col-start-1 flex items-center justify-center text-xs text-[var(--text-primary)] bg-[var(--surface-3)]">
                  {t('charging.detail.ac', 'AC')} {fmtPercent(acPct)}
                </div>
              )}
              {dcEnergy > 0 && (
                <div className="col-start-2 flex items-center justify-center text-xs text-[var(--text-primary)] bg-[var(--surface-2)]">
                  {t('charging.detail.dc', 'DC')} {fmtPercent(dcPct)}
                </div>
              )}
            </div>
            <div className="flex flex-wrap justify-between gap-2 text-xs text-[var(--text-secondary)] mt-1">
              <span>{t('charging.detail.ac', 'AC')}: {formatEnergyDisplay(acEnergy)}</span>
              <span>{t('Total', 'Total')}: {formatEnergyDisplay(totalEnergy)}</span>
              <span>{t('charging.detail.dc', 'DC')}: {formatEnergyDisplay(dcEnergy)}</span>
            </div>
          </>
        ) : (
          <Caption as="p" className="text-center py-2">
            {totalEnergy === 0 && isFiniteNumber(acEnergy) && acEnergy === 0
              && isFiniteNumber(dcEnergy) && dcEnergy === 0
              ? t('charging.stats.noEnergyData', 'No energy recorded for these sessions yet.')
              : t('common.noReading', 'No reading')}
          </Caption>
        )}
      </div>

      {/* Stats Table */}
      <div className="overflow-x-auto">
        <AcDcTable ac={breakdown?.ac} dc={breakdown?.dc} />
      </div>

      {/* Free charging total */}
      {isFiniteNumber(freeCount) && freeCount > 0 && (
        <ChargingSummaryBrief className="mt-3"
          title={t('charging.table.freeCharged', 'Free charged')}
          metrics={[
            { metricId: 'count', occurrenceId: 'free-sessions', rawValue: freeCount,
              label: t('charging.table.freeCharged', 'Free charged'),
              display: { formatter: raw => ({ value: t('charging.stats.freeSessions', '{{count}} sessions', { count: raw }), unit: '' }) } },
            { metricId: 'energy', occurrenceId: 'free-energy', rawValue: isFiniteNumber(freeEnergy) ? freeEnergy * 1000 : null,
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
  const { fmtWithUnit, fmtNumber } = useNumberFormatting();
  const { currencySymbol } = useFormatting();
  const { t } = useTranslation();
  const data: AcDcTableRow[] = [
    { label: t('charging.table.acCharging', 'AC charging'), id: 'ac' as const, ...(ac ?? EMPTY_BUCKET) },
    { label: t('charging.table.dcCharging', 'DC charging'), id: 'dc' as const, ...(dc ?? EMPTY_BUCKET) },
  ].filter((r) => isFiniteNumber(r.count) && r.count > 0);

  const columns: Column<AcDcTableRow>[] = [
    { key: 'type', header: t('charging.table.type', 'Type'), render: (r) => <span className="font-medium text-[var(--text-primary)]">{r.label}</span> },
    { key: 'sessions', header: t('charging.table.sessionCount', 'Sessions'), render: (r) => <span className="text-[var(--text-primary)]">{r.count}</span>, align: 'right' },
    { key: 'energy', header: t('charging.table.energy', 'Energy'), render: (r) => <span className="text-[var(--text-primary)]">{formatEnergyDisplay(r.energy)}</span>, align: 'right' },
    { key: 'cost', header: t('charging.table.cost', 'Cost'), render: (r) => isFiniteNumber(r.cost) ? <Currency value={r.cost} className="text-[var(--text-primary)]" /> : <span className="text-[var(--text-secondary)]">—</span>, align: 'right' },
    { key: 'perKwh', header: t('charging.table.costPerKwh', '$/kWh'), render: (r) => isFiniteNumber(r.energy) && r.energy > 0 && isFiniteNumber(r.cost) ? <Currency value={r.cost / r.energy} className="text-[var(--text-secondary)]" /> : <span className="text-[var(--text-secondary)]">—</span>, align: 'right' },
    { key: 'avgEnergy', header: t('charging.table.avgEnergy', 'Avg energy'), render: (r) => <span className="text-[var(--text-secondary)]">{isFiniteNumber(r.energy) ? fmtWithUnit(r.energy / r.count, 'kWh') : '—'}</span>, align: 'right' },
    { key: 'avgTime', header: t('charging.table.avgTime', 'Avg time'), render: (r) => <span className="text-[var(--text-secondary)]">{isFiniteNumber(r.totalDuration) && r.totalDuration >= 0 ? formatDuration(r.totalDuration / r.count) : '—'}</span>, align: 'right' },
    { key: 'free', header: t('charging.table.free', 'Free'), render: (r) => <span className="text-[var(--text-secondary)]">{isFiniteNumber(r.freeCount) && r.freeCount > 0 ? `${r.freeCount} (${isFiniteNumber(r.freeEnergy) ? fmtWithUnit(r.freeEnergy, 'kWh') : '—'})` : '—'}</span>, align: 'right' },
  ];

  return (
    <DataTable<AcDcTableRow>
      tableId="charging:ac-dc-stats"
      caption={t('charging.stats.chargingByType', 'Charging stats by type')}
      columns={columns}
      mobileColumns={['type', 'energy', 'cost']}
      mobilePresentation={{
        roles: { type: 'title', energy: 'primary', cost: 'meta' },
        displayValue: (row, key) => {
          switch (key) {
            case 'type': return row.label;
            case 'energy': return formatEnergyDisplay(row.energy);
            case 'cost': return isFiniteNumber(row.cost) ? `${currencySymbol}${fmtNumber(row.cost)}` : '—';
            default: return undefined;
          }
        },
      }}
      rowLabel={(row) => row.label}
      data={data}
      keyExtractor={(r) => r.id}
      emptyMessage={t('charging.stats.noData', 'No AC/DC charging data')}
      compact
      pagination
    />
  );
}
