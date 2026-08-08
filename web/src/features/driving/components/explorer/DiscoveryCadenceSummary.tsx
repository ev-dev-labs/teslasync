import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, MetricLabel, MetricValue, Text } from '@/components/ui';

import type { ExplorerSummary } from '../../lib/explorer';

interface DiscoveryCadenceSummaryProps {
  summary: ExplorerSummary;
}

export function DiscoveryCadenceSummary({
  summary,
}: DiscoveryCadenceSummaryProps) {
  const { t } = useTranslation();
  const days = (value: number | null) =>
    value == null
      ? '—'
      : t('explorer.coverage.days', '{{count}} days', {
          count: value,
        });
  const metrics: Array<[string, string]> = [
    [
      t('explorer.coverage.medianGap', 'Median gap'),
      days(summary.cadence.medianGapDays),
    ],
    [
      t('explorer.coverage.longestGap', 'Longest gap'),
      days(summary.cadence.longestGapDays),
    ],
    [
      t('explorer.coverage.latestGap', 'Latest gap'),
      days(summary.cadence.latestGapDays),
    ],
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
        <div className="mt-4 grid grid-cols-3 gap-2">
          {metrics.map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg bg-[var(--surface-2)] p-2"
            >
              <MetricValue>{value}</MetricValue>
              <MetricLabel>{label}</MetricLabel>
            </div>
          ))}
        </div>
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
