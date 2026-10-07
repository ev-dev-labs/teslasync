import type { StatMetric } from '@/components/data-display';
import { formatAge, type LiveSignalStats } from '../live-signal-inspector/liveSignalStats';

type Translate = (key: string, fallback: string) => string;

export function liveSignalMetrics(
  stats: LiveSignalStats,
  hasSnapshot: boolean,
  t: Translate,
): readonly StatMetric[] {
  return [
    { metricId: 'count', occurrenceId: 'total', rawValue: hasSnapshot ? stats.total : undefined,
      label: t('admin.liveSignals.kpi.total', 'Total signals'),
      description: t('admin.liveSignals.brief.totalContext', 'Fields in the returned snapshot, before table filters') },
    { metricId: 'count', occurrenceId: 'live', rawValue: hasSnapshot ? stats.live : undefined,
      label: t('admin.liveSignals.kpi.live', 'Live · L1'),
      description: t('admin.liveSignals.kpi.liveHint', 'Fresh in-process') },
    { metricId: 'count', occurrenceId: 'stale', rawValue: hasSnapshot ? stats.stale : undefined,
      label: t('admin.liveSignals.kpi.stale', 'Stale'),
      description: t('admin.liveSignals.kpi.staleHint', 'Past 2-min window') },
    { metricId: 'count', occurrenceId: 'legacy', rawValue: hasSnapshot ? stats.legacy : undefined,
      label: t('admin.liveSignals.kpi.legacy', 'Legacy · L2'),
      description: t('admin.liveSignals.kpi.legacyHint', 'Redis, unknown age') },
    { metricId: 'count', occurrenceId: 'numeric', rawValue: hasSnapshot ? stats.numeric : undefined,
      label: t('admin.liveSignals.kpi.numeric', 'Numeric fields'),
      description: t('admin.liveSignals.brief.numericContext', 'Fields classified as numeric in the returned snapshot') },
    { metricId: 'latency', occurrenceId: 'freshest',
      rawValue: hasSnapshot && stats.freshestAgeMs != null ? stats.freshestAgeMs / 1000 : undefined,
      label: t('admin.liveSignals.kpi.freshest', 'Freshest'),
      description: t('admin.liveSignals.kpi.freshestHint', 'Newest value age'),
      display: {
        // The shared metric retains seconds; the existing inspector formatter owns its compact age notation.
        formatter: seconds => ({ value: formatAge(seconds * 1000), unit: '' }),
      } },
  ];
}
