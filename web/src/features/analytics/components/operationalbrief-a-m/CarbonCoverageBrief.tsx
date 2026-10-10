import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import type { CarbonSectionProps } from '../carbon-intelligence/types';
import { CarbonBriefBand } from './CarbonBriefBand';

export function CarbonCoverageBrief({ analysis, states, display }: CarbonSectionProps) {
  const { t } = useTranslation();
  const source = analysis.curve.source;
  const resolved = states.intensity.hasData;
  const values = [
    ['carbon.coverage.returned', 'Rows returned', source.returnedRows, 'carbon.coverage.expected', '24 expected clock-hours'],
    ['carbon.coverage.unique', 'Valid unique hours', source.validUniqueHours, 'carbon.coverage.uniqueHint', 'Canonical rows used in analysis'],
    ['carbon.coverage.invalidHours', 'Invalid hour rows', source.invalidHourRows, 'carbon.coverage.hourRange', 'Required integer 0–23'],
    ['carbon.coverage.invalidIntensity', 'Invalid intensity rows', source.invalidIntensityRows, 'carbon.coverage.intensityRule', 'Required finite non-negative value'],
    ['carbon.coverage.duplicates', 'Duplicate hour rows', source.duplicateHourRows, 'carbon.coverage.duplicateRule', 'First valid row retained deterministically'],
  ] as const;
  const metrics: StatMetric[] = values.map(([key, label, raw, contextKey, context], index) => ({
    metricId: 'count', occurrenceId: `carbon-coverage-${index}`, rawValue: resolved ? raw : null,
    label: t(key, label), context: t(contextKey, context),
    display: { formatter: value => ({ value: display.formatNumber(value), unit: '' }) },
  }));
  const coverage = source.coverageComplete
    ? t('carbon.coverage.complete', 'Coverage is complete: exactly one valid row exists for every backend/model clock-hour.')
    : source.missingHours.length > 0
      ? t('carbon.coverage.missing', 'Missing backend/model clock-hours: {{hours}}.', { hours: source.missingHours.map(display.formatHour).join(', ') })
      : t('carbon.coverage.incomplete', 'Coverage is incomplete because invalid or duplicate rows were returned.');
  return <CarbonBriefBand testId="carbon-curve-coverage" metrics={metrics} state={states.intensity}
    title={t('carbon.coverage.title', 'Curve source accounting and completeness')}
    description={t('carbon.source.intensityScope', 'Built-in, admin-editable static 24-hour model')}
    scope={<span>{t('carbon.source.intensityScope', 'Built-in, admin-editable static 24-hour model')}</span>}>
    <AlertBanner className="mt-4" variant={source.coverageComplete ? 'success' : 'warning'}>{coverage}</AlertBanner>
  </CarbonBriefBand>;
}
