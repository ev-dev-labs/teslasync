import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference';
import type { UseUnitsResult } from '@/hooks/useUnits';
import type { DriveDnaModel } from '../../lib/driveDNA';
import { NestedDrivingBrief } from '../operationalbrief-a-m/NestedDrivingBrief';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface DriveDnaCadenceMetricsProps {
  model: DriveDnaModel;
  units: UseUnitsResult;
}

export function DriveDnaCadenceMetrics({ model, units }: DriveDnaCadenceMetricsProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const evidence = model.sample;
  const cadencePrecision = Math.max(3, units.unitPrefs.precision ?? 0);
  const metrics: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'returned-rows', rawValue: evidence.returnedRows,
      label: t('driveDna.coverage.returnedRows', 'Rows returned'),
      description: t('driveDna.coverage.returnedRowsHint', 'Endpoint response') },
    { metricId: 'count', occurrenceId: 'valid-rows', rawValue: evidence.validRows,
      label: t('driveDna.coverage.validRows', 'Valid timestamp rows'),
      description: t('driveDna.coverage.validRowsHint', 'Analytical timeline') },
    { metricId: 'duration', occurrenceId: 'observed-span', rawValue: evidence.observedSpanS,
      label: t('driveDna.coverage.observedSpan', 'Observed span'),
      description: t('driveDna.coverage.observedSpanHint', 'First to last timestamp'),
      display: { formatter: raw => ({ value: units.formatDuration(raw), unit: '' }) } },
    { metricId: 'duration', occurrenceId: 'median-interval', rawValue: evidence.medianIntervalS,
      label: t('driveDna.coverage.medianInterval', 'Median interval'),
      description: t('driveDna.coverage.medianIntervalHint', 'Adjacent emissions'),
      display: { formatter: raw => ({ value: units.formatDuration(raw, { precision: cadencePrecision }), unit: '' }) } },
    { metricId: 'duration', occurrenceId: 'largest-gap', rawValue: evidence.largestGapS,
      label: t('driveDna.coverage.largestGap', 'Largest gap'),
      description: t('driveDna.coverage.largestGapHint', 'Irregular cadence evidence'),
      display: { formatter: raw => ({ value: units.formatDuration(raw, { precision: cadencePrecision }), unit: '' }) } },
    { metricId: 'count', occurrenceId: 'timestamp-issues', rawValue: evidence.invalidTimestampCount,
      label: t('driveDna.coverage.timestampIssues', 'Timestamp issues'),
      description: t('driveDna.coverage.timestampIssueHint', 'Invalid / duplicate'),
      display: { formatter: raw => ({ value: t('driveDna.coverage.timestampIssueValue', '{{invalid}} / {{duplicate}}', {
        invalid: fmtInt(raw), duplicate: fmtInt(evidence.duplicateTimestampCount),
      }), unit: '' }) },
      context: t('driveDna.coverage.timestampIssueValue', '{{invalid}} / {{duplicate}}', {
        invalid: fmtInt(evidence.invalidTimestampCount), duplicate: fmtInt(evidence.duplicateTimestampCount),
      }) },
  ];
  return <NestedDrivingBrief metrics={metrics}
    title={t('driveDna.brief.cadence', 'Telemetry cadence')}
    description={t('driveDna.brief.cadenceScope', 'Returned drive telemetry; valid timestamps define the observed span and adjacent-emission intervals.')}
    period={{ kind: 'unknown', label: t('driveDna.brief.cadence', 'Telemetry cadence'),
      reason: t('driveDna.brief.cadenceScope', 'Returned drive telemetry; valid timestamps define the observed span and adjacent-emission intervals.') }}
    preferences={{ units: units.unitPrefs, currency: { kind: 'symbol', value: '' } }} />;
}
