import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Text } from '@/components/ui';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { NestedDrivingBrief } from '../operationalbrief-a-m/NestedDrivingBrief';

import type { ExplorerSummary } from '../../lib/explorer';

interface DiscoveryCadenceSummaryProps {
  summary: ExplorerSummary;
}

export function DiscoveryCadenceSummary({
  summary,
}: DiscoveryCadenceSummaryProps) {
  const { t } = useTranslation();
  const metrics: StatMetric[] = [
    { metricId: 'duration', occurrenceId: 'median-gap',
      label: t('explorer.coverage.medianGap', 'Median gap'),
      rawValue: summary.cadence.medianGapDays == null ? null : summary.cadence.medianGapDays * 86400,
      display: { formatter: raw => ({ value: t('explorer.coverage.days', '{{count}} days', { count: raw / 86400 }), unit: '' }) } },
    { metricId: 'duration', occurrenceId: 'longest-gap',
      label: t('explorer.coverage.longestGap', 'Longest gap'),
      rawValue: summary.cadence.longestGapDays == null ? null : summary.cadence.longestGapDays * 86400,
      display: { formatter: raw => ({ value: t('explorer.coverage.days', '{{count}} days', { count: raw / 86400 }), unit: '' }) } },
    { metricId: 'duration', occurrenceId: 'latest-gap',
      label: t('explorer.coverage.latestGap', 'Latest gap'),
      rawValue: summary.cadence.latestGapDays == null ? null : summary.cadence.latestGapDays * 86400,
      display: { formatter: raw => ({ value: t('explorer.coverage.days', '{{count}} days', { count: raw / 86400 }), unit: '' }) } },
  ];

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] p-4">
      <div className="flex items-center justify-between gap-2">
        <Text as="p" variant="label">
          {t('explorer.coverage.cadence', 'Discovery cadence')}
        </Text>
        <Badge
          variant={
            summary.evidence.cadenceSufficient ? 'success' : 'warning'
          }
        >
          {t(
            'explorer.coverage.discoveryCount',
            '{{count}} discoveries',
            { count: summary.cadence.discoveries },
          )}
        </Badge>
      </div>
      {summary.evidence.cadenceSufficient ? (
        <NestedDrivingBrief metrics={metrics}
          title={t('explorer.brief.cadenceTitle', 'Observed discovery intervals')}
          description={t('explorer.brief.cadenceScope', 'Intervals between first destination discoveries in returned history, not all vehicle travel.')}
          period={{ kind: 'unknown', label: t('explorer.coverage.discoveryCount', '{{count}} discoveries', { count: summary.cadence.discoveries }),
            reason: t('explorer.coverage.cadenceInsufficient', 'Three destination discoveries are required before interval cadence is reported.') }} />
      ) : (
        <div className="mt-4 flex items-start gap-2">
          <CalendarClock
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"
            aria-hidden="true"
          />
          <Text as="p" variant="bodySm">
            {t(
              'explorer.coverage.cadenceInsufficient',
              'Three destination discoveries are required before interval cadence is reported.',
            )}
          </Text>
        </div>
      )}
    </div>
  );
}
