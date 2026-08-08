import { useTranslation } from 'react-i18next';
import { GitCompareArrows, Swords } from 'lucide-react';

import { EmptyState } from '@/components/feedback';
import { Badge, GlassPanel, HelpTooltip, PanelTitle, Text } from '@/components/ui';
import { formatDateShort } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';

import type { CompareMetricKey, CompareRow } from '../../lib/driveCompare';
import { CompareSectionBody, type CompareSectionState } from './CompareSectionBody';
import { useCompareMetricFormatter } from './useCompareMetricFormatter';

const METRIC_I18N: Record<CompareMetricKey, { key: string; fallback: string }> = {
  distanceM: { key: 'driveCompare.m.distance', fallback: 'Distance' },
  durationS: { key: 'driveCompare.m.duration', fallback: 'Duration' },
  avgSpeedMps: { key: 'driveCompare.m.avgSpeed', fallback: 'Avg speed' },
  maxSpeedMps: { key: 'driveCompare.m.maxSpeed', fallback: 'Top speed' },
  energyUsedWh: { key: 'driveCompare.m.energy', fallback: 'Energy used' },
  whPerKm: { key: 'driveCompare.m.consumption', fallback: 'Consumption' },
  regenShare: { key: 'driveCompare.m.regenShare', fallback: 'Regen share' },
  socUsed: { key: 'driveCompare.m.socUsed', fallback: 'Battery used' },
  outsideTempAvgC: { key: 'driveCompare.m.temp', fallback: 'Outside temp' },
  score: { key: 'driveCompare.m.score', fallback: 'Drive score' },
};

interface HeadToHeadGridProps {
  rows: CompareRow[] | null;
  startA: string | null;
  startB: string | null;
  state: CompareSectionState;
}

export function HeadToHeadGrid({ rows, startA, startB, state }: HeadToHeadGridProps) {
  const { t } = useTranslation();
  const formatMetric = useCompareMetricFormatter();
  const items = rows ?? [];

  return (
    <GlassPanel className="p-4 sm:p-5" data-testid="drive-compare-grid">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <GitCompareArrows className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('driveCompare.duel', 'Full head-to-head')}
        <HelpTooltip
          size="sm"
          i18nKey="help.driveCompare.body"
          defaultValue="Consumption, regen share, and drive score can decide the verdict when both drives have enough data. Trip totals remain neutral context."
          ariaLabel={t('help.driveCompare.iconLabel', 'More info about drive compare')}
        />
      </PanelTitle>
      <CompareSectionBody
        state={state}
        icon={<Swords className="h-8 w-8" aria-hidden="true" />}
        className="min-h-72"
      >
        {items.length > 0 ? (
          <div className="overflow-x-auto">
            <div
              role="table"
              aria-label={t('driveCompare.gridAria', 'Drive A and Drive B metric comparison')}
              className="min-w-[640px]"
            >
              <div role="rowgroup">
                <div
                  role="row"
                  className="grid grid-cols-[minmax(10rem,1.25fr)_minmax(12rem,1fr)_minmax(12rem,1fr)] border-b border-[var(--border-subtle)]"
                >
                  <div role="columnheader" className="px-4 py-3">
                    <Text variant="label">{t('driveCompare.metric', 'Metric')}</Text>
                  </div>
                  {([
                    ['a', t('driveCompare.driveA', 'Drive A'), startA],
                    ['b', t('driveCompare.driveB', 'Drive B'), startB],
                  ] as const).map(([side, label, start]) => (
                    <div key={side} role="columnheader" className="px-4 py-3 text-end">
                      <Text variant="label">{label}</Text>
                      <Text as="div" variant="caption">
                        {start ? formatDateShort(start) : '—'}
                      </Text>
                    </div>
                  ))}
                </div>
              </div>
              <div role="rowgroup">
                {items.map((row) => (
                  <div
                    key={row.key}
                    role="row"
                    className="grid grid-cols-[minmax(10rem,1.25fr)_minmax(12rem,1fr)_minmax(12rem,1fr)] border-b border-[var(--border-subtle)]/60 last:border-b-0"
                  >
                    <div role="rowheader" className="flex items-center px-4 py-3">
                      <Text variant="bodySm">
                        {t(METRIC_I18N[row.key].key, METRIC_I18N[row.key].fallback)}
                      </Text>
                    </div>
                    {(['a', 'b'] as const).map((side) => (
                      <div key={side} role="cell" className="px-4 py-3 text-end">
                        <span className="inline-flex items-center justify-end gap-2">
                          {row.winner === side ? (
                            <Badge variant="success">{t('driveCompare.winner', 'Winner')}</Badge>
                          ) : null}
                          <Text
                            variant="body"
                            mono
                            className={cn(row.winner === side && 'text-emerald-300')}
                          >
                            {formatMetric(row.key, row[side])}
                          </Text>
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <EmptyState /* no-action: the drive selectors above are the recovery surface. */
            message={t('driveCompare.noMetrics', 'No comparison metrics are available.')}
          />
        )}
      </CompareSectionBody>
    </GlassPanel>
  );
}
