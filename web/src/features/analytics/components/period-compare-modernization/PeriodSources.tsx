import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import type { PeriodStats } from '@/api/hooks/usePeriodStats';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { Heading, Text } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useUnits } from '@/hooks/useUnits';
import { cn } from '@/lib/cn';
import { convertDistanceFromSI } from '@/lib/unitConversion';

interface PeriodSourcesProps {
  stateA: DataState<PeriodStats>;
  stateB: DataState<PeriodStats>;
  retryA: () => void;
  retryB: () => void;
}

/** Preserve the usable operand while its independent comparison window loads. */
export function PeriodSources({ stateA, stateB, retryA, retryB }: PeriodSourcesProps) {
  const { t } = useTranslation();
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { unitPrefs } = useUnits();
  // Read the existing CardGrid's placement, not another measurement/provider.
  const placement = useCardPlacement();
  const sources = [
    { id: 'period-a', label: t('compare.periodA', 'Period A'), state: stateA, retry: retryA },
    { id: 'period-b', label: t('compare.periodB', 'Period B'), state: stateB, retry: retryB },
  ];
  return (
    <div className="space-y-3">
      <Text as="p" variant="bodySm">
        {t('compare.sources.awaitingPair', 'Comparison requires both periods. Available period values remain visible below.')}
      </Text>
      <div className={cn('grid min-w-0 grid-cols-1 gap-4', placement && placement.width >= 640 && 'grid-cols-2')}>
        {sources.map(({ id, label, state, retry }) => {
          const data = state.data;
          // Match the original display conversion, without manufacturing values
          // for an absent source. Raw query payloads are never modified.
          const distance = data?.total_distance != null
            ? convertDistanceFromSI(data.total_distance * 1000, unitPrefs.distance) : null;
          const efficiency = data?.avg_efficiency != null
            ? data.avg_efficiency * (unitPrefs.distance === 'mi' ? 1.609344 : 1) : null;
          const rows = [
            { key: 'distance', label: t('compare.totalDistance', 'Total distance'), value: distance, unit: unitPrefs.distance },
            { key: 'drives', label: t('compare.totalDrives', 'Total drives'), value: data?.total_drives, unit: '', count: true },
            { key: 'energy', label: t('compare.energyUsed', 'Energy used'), value: data?.energy_used, unit: 'kWh' },
            { key: 'efficiency', label: t('compare.avgEfficiency', 'Avg efficiency'), value: efficiency, unit: unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km' },
            { key: 'cost', label: t('compare.totalCost', 'Total cost'), value: data?.total_cost, unit: '$' },
            { key: 'co2', label: t('compare.co2Saved', 'CO₂ saved'), value: data?.co2_saved, unit: 'kg' },
          ];
          return (
            <section key={id} aria-labelledby={`${id}-source-title`} className="min-w-0 space-y-3">
              <Heading id={`${id}-source-title`} level="panel">{label}</Heading>
              {data ? (
                <dl className="space-y-2">
                  {rows.map(row => (
                    <div key={row.key} className="flex min-w-0 flex-wrap justify-between gap-x-3 gap-y-1">
                      <Text as="dt" variant="bodySm">{row.label}</Text>
                      <Text as="dd" variant="bodySm" className="break-words tabular-nums">
                        {row.value != null
                          ? `${row.count ? fmtInt(row.value) : fmtNumber(row.value)} ${row.unit}`.trim()
                          : '—'}
                      </Text>
                    </div>
                  ))}
                </dl>
              ) : state.fatalError ? (
                <QueryError error={state.fatalError} onRetry={retry} />
              ) : state.isRefreshBlocked ? (
                <EmptyState message={t('compare.sources.paused', 'This period is waiting for a connection. No values are available yet.')} />
              ) : (
                <Skeleton lines={6} />
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
