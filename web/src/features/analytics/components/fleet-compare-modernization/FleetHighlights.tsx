import { useTranslation } from 'react-i18next';
import { StatStrip, type StatMetric } from '@/components/data-display/stat-reference';
import { Skeleton } from '@/components/feedback';

export interface FleetHighlight {
  id: string;
  label: string;
  value: string;
  loading: boolean;
}

/**
 * These are specialist A-vs-B presentations, not numeric deltas. A generic
 * efficiency/currency formatter has not proved equivalence to the originals.
 * Text metrics preserve those formatters without pretending a pair is one SI
 * measurement, or silently assigning lifetime provenance to current battery.
 */
export function FleetHighlights({ items }: { items: readonly FleetHighlight[] }) {
  const { t } = useTranslation();
  const provenance = t(
    'comparison.highlightContext.provenance',
    'Battery readings are snapshots; efficiency, charging cost and CO₂ saved are lifetime statistics.',
  );
  const metrics: StatMetric[] = items.map(item => ({
    metricId: 'text',
    occurrenceId: item.id,
    label: item.label,
    description: provenance,
    rawValue: item.loading ? null : item.value,
    context: item.loading ? <Skeleton lines={1} /> : undefined,
  }));

  return (
    <StatStrip
      id="fleet-compare-highlights"
      metrics={metrics}
      period={{
        kind: 'unknown',
        label: t('comparison.highlightContext.period', 'Snapshot and lifetime comparison'),
        reason: provenance,
      }}
    />
  );
}
