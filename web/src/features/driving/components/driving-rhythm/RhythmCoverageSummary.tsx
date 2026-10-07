import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import { Text } from '@/components/ui';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { NestedDrivingBrief } from '../operationalbrief-a-m/NestedDrivingBrief';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';


import type { DrivingRhythm } from '../../lib/drivingRhythm';

interface RhythmCoverageSummaryProps {
  summary: DrivingRhythm;
}

export function RhythmCoverageSummary({
  summary,
}: RhythmCoverageSummaryProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const metrics: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'returned', rawValue: summary.observed,
      label: t('rhythm.method.returned', 'Rows returned') },
    { metricId: 'count', occurrenceId: 'included', rawValue: summary.total,
      label: t('rhythm.method.included', 'Valid starts included') },
    { metricId: 'count', occurrenceId: 'invalid', rawValue: summary.invalidTimestampCount,
      label: t('rhythm.method.invalid', 'Invalid timestamps') },
    { metricId: 'count', occurrenceId: 'future', rawValue: summary.futureTimestampCount,
      label: t('rhythm.method.future', 'Future timestamps') },
  ];

  return (
    <div>
      <NestedDrivingBrief metrics={metrics}
        title={t('rhythm.brief.coverage', 'Observed-history coverage')}
        description={t('rhythm.method.coverage', 'All {{count}} drives in the selected dates were fetched across API pages and accounted for.', { count: summary.observed })}
        period={{ kind: 'unknown', label: `${summary.firstStartTs ?? '—'} – ${summary.lastStartTs ?? '—'} · ${summary.timeZone}`,
          reason: t('rhythm.brief.coverageScope', 'Included non-future starts define the observed span; the selected date scope may be wider.') }} />
      {summary.total === 0 ? (
        <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
          className="py-6"
          icon={<Info className="h-7 w-7" aria-hidden="true" />}
          message={
            summary.observed === 0
              ? t(
                  'rhythm.method.empty',
                  'Coverage will appear when the selected date scope returns drives.',
                )
              : t(
                  'rhythm.method.noIncluded',
                  'Returned rows were accounted for, but none had an eligible non-future start.',
                )
          }
        />
      ) : (
        <Text as="p" variant="bodySm" className="mt-4">
          {t(
            'rhythm.method.observedSpan',
            'Included span: {{first}} to {{last}} · distance available for {{measured}} of {{included}} included drives.',
            {
              first: formatDateTime(summary.firstStartTs, {
                locale: unitPrefs.locale,
                tz: summary.timeZone,
              }),
              last: formatDateTime(summary.lastStartTs, {
                locale: unitPrefs.locale,
                tz: summary.timeZone,
              }),
              measured: summary.distanceMeasuredDrives,
              included: summary.total,
            },
          )}
        </Text>
      )}
      <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-3">
        <Text as="p" variant="caption">
          {t(
            'rhythm.method.coverage',
            'All {{count}} drives in the selected dates were fetched across API pages and accounted for.',
            { count: summary.observed },
          )}
        </Text>
      </div>
    </div>
  );
}
