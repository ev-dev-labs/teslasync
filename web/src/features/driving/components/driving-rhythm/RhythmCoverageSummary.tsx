import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import { MetricLabel, MetricValue, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';

import type { DrivingRhythm } from '../../lib/drivingRhythm';

interface RhythmCoverageSummaryProps {
  summary: DrivingRhythm;
}

export function RhythmCoverageSummary({
  summary,
}: RhythmCoverageSummaryProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl bg-[var(--surface-2)] p-3">
          <MetricValue>{fmtInt(summary.observed)}</MetricValue>
          <MetricLabel>
            {t('rhythm.method.returned', 'Rows returned')}
          </MetricLabel>
        </div>
        <div className="rounded-xl bg-[var(--surface-2)] p-3">
          <MetricValue>{fmtInt(summary.total)}</MetricValue>
          <MetricLabel>
            {t('rhythm.method.included', 'Valid starts included')}
          </MetricLabel>
        </div>
        <div className="rounded-xl bg-[var(--surface-2)] p-3">
          <MetricValue>{fmtInt(summary.invalidTimestampCount)}</MetricValue>
          <MetricLabel>
            {t('rhythm.method.invalid', 'Invalid timestamps')}
          </MetricLabel>
        </div>
        <div className="rounded-xl bg-[var(--surface-2)] p-3">
          <MetricValue>{fmtInt(summary.futureTimestampCount)}</MetricValue>
          <MetricLabel>
            {t('rhythm.method.future', 'Future timestamps')}
          </MetricLabel>
        </div>
      </div>
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
