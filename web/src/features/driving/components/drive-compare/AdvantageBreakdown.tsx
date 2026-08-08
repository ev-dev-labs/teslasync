import { useTranslation } from 'react-i18next';
import { Gauge, Info } from 'lucide-react';

import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { cn } from '@/lib/cn';

import type { CompareMetricKey, CompareRow, CompareSummary } from '../../lib/driveCompare';
import { CompareSectionBody, type CompareSectionState } from './CompareSectionBody';
import { useCompareMetricFormatter } from './useCompareMetricFormatter';

const FAIR_METRICS: ReadonlyArray<{
  key: Extract<CompareMetricKey, 'whPerKm' | 'regenShare' | 'score'>;
  labelKey: string;
  fallback: string;
}> = [
  { key: 'whPerKm', labelKey: 'driveCompare.m.consumption', fallback: 'Consumption' },
  { key: 'regenShare', labelKey: 'driveCompare.m.regenShare', fallback: 'Regen share' },
  { key: 'score', labelKey: 'driveCompare.m.score', fallback: 'Drive score' },
];

interface AdvantageBreakdownProps {
  rows: CompareRow[] | null;
  summary: CompareSummary | null;
  state: CompareSectionState;
  className?: string;
}

export function AdvantageBreakdown({
  rows,
  summary,
  state,
  className,
}: AdvantageBreakdownProps) {
  const { t } = useTranslation();
  const formatMetric = useCompareMetricFormatter();
  const items = rows ?? [];

  return (
    <GlassPanel className={cn('p-5', className)} data-testid="drive-compare-breakdown">
      <PanelTitle className="mb-1 flex items-center gap-2">
        <Gauge className="h-4 w-4 text-emerald-300" aria-hidden="true" />
        {t('driveCompare.breakdown.title', 'What decided it')}
      </PanelTitle>
      <Text as="p" variant="caption" className="mb-4">
        {summary
          ? t(
              'driveCompare.breakdown.count',
              '{{count}} of 3 fair metrics have data on both drives.',
              { count: summary.comparableCount },
            )
          : t('driveCompare.breakdown.subtitle', 'Fair, distance-aware advantages only')}
      </Text>
      <CompareSectionBody
        state={state}
        icon={<Info className="h-8 w-8" aria-hidden="true" />}
        className="min-h-48"
      >
        <div className="space-y-2">
          {FAIR_METRICS.map((metric) => {
            const row = items.find((candidate) => candidate.key === metric.key);
            const complete = row?.a != null && row.b != null;
            const delta = complete ? Math.abs(row.a! - row.b!) : null;
            const outcome = row?.winner === 'a'
              ? t('driveCompare.driveA', 'Drive A')
              : row?.winner === 'b'
                ? t('driveCompare.driveB', 'Drive B')
                : complete
                  ? t('driveCompare.breakdown.even', 'Even')
                  : t('driveCompare.breakdown.unavailable', 'Not comparable');
            const detail = row?.winner && delta != null
              ? t(
                  'driveCompare.breakdown.edge',
                  '{{value}} edge',
                  { value: formatMetric(metric.key, delta) },
                )
              : complete
                ? t('driveCompare.breakdown.noEdge', 'No measurable edge')
                : t('driveCompare.breakdown.needsBoth', 'Needs valid data from both drives');

            return (
              <div
                key={metric.key}
                className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <div className="min-w-0">
                  <Text as="div" variant="body">
                    {t(metric.labelKey, metric.fallback)}
                  </Text>
                  <Text as="div" variant="caption" className="truncate">
                    {detail}
                  </Text>
                </div>
                <Badge
                  variant={row?.winner ? 'success' : 'neutral'}
                  className={cn('shrink-0', row?.winner === 'b' && 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200')}
                >
                  {outcome}
                </Badge>
              </div>
            );
          })}
        </div>
        <Text as="p" variant="caption" className="mt-4">
          {t(
            'driveCompare.breakdown.note',
            'Regen is scored only on trips of at least 1 km; total energy and battery drop never award a winner.',
          )}
        </Text>
      </CompareSectionBody>
    </GlassPanel>
  );
}
