import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { Text, Caption } from '@/components/ui';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import type { StatPeriod } from '@/lib/metric-reference';
import type { YearReview } from '@/api/types';
import { to12Hour } from '../year-review-modernization/yearReviewPresentation';

export function YearPatternsBrief({ data, period, retained }: { data: YearReview; period: StatPeriod; retained?: boolean }) {
  const { t } = useTranslation();
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';
  const { hour12, isPM } = to12Hour(data.most_active_hour);
  const meridiem = isPM ? t('yearReview.pm', 'PM') : t('yearReview.am', 'AM');
  const metrics: StatMetric[] = [
    { metricId: 'rate', occurrenceId: 'year-drives-per-week', rawValue: data.avg_drives_per_week,
      label: t('yearReview.drivesWeek', 'drives/week'), display: { formatter: raw => ({ value: fmtNumber(raw), unit: '' }) } },
    { metricId: 'distance', occurrenceId: 'year-distance-per-drive',
      rawValue: data.avg_distance_per_drive_km == null ? null : data.avg_distance_per_drive_km * 1000,
      label: t('yearReview.distancePerDrive', { unit: distanceUnit, defaultValue: '{{unit}}/drive avg' }),
      display: { formatter: raw => ({ value: fmtInt(convertDistanceFromSI(raw, distanceUnit)), unit: '' }) } },
    { metricId: 'efficiency', occurrenceId: 'year-average-efficiency',
      rawValue: data.avg_efficiency_wh_km == null ? null : data.avg_efficiency_wh_km / 1000,
      label: `${efficiencyUnit} ${t('yearReview.avg', 'avg')}`,
      display: { formatter: raw => ({ value: fmtInt(distanceUnit === 'mi' ? raw * 1000 * 1.609344 : raw * 1000), unit: '' }) } },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  return <div id="year-review-patterns" className="space-y-3">
    <div className="space-y-3">
      <div><Caption>{t('yearReview.favoriteDay', 'Favorite driving day')}</Caption>
        <Text as="p" variant="body" className="break-words">{data.most_active_day_of_week || '—'}</Text></div>
      <div><Caption>{t('yearReview.peakHour', 'Peak driving hour')}</Caption>
        <Text as="p" variant="body" className="tabular-nums">{hour12} {meridiem}</Text></div>
    </div>
    <OperationalBrief compact testId="year-review-patterns-brief"
      eyebrow={t('yearReview.title', 'Year in review')} title={t('yearReview.drivingPatterns', 'Your driving patterns')}
      description={t('yearReview.brief.patternsDescription', 'Calendar-year driving averages; integer distance and efficiency retain the original specialist rounding.')}
      statusLabel={retained ? t('yearReview.brief.retained', 'Retained year evidence') : t('yearReview.brief.available', 'Recorded year evidence')}
      statusTone={retained ? 'warning' : 'neutral'}
      metrics={operationalMetrics} scope={period.label} provenance={t('yearReview.title', 'Year in review')} />
  </div>;
}
