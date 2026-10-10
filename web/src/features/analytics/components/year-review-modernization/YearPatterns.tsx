import { useTranslation } from 'react-i18next';
import { StatGroup } from '@/components/data-display/stat-reference';
import { Text, Caption } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import type { StatPeriod } from '@/lib/metric-reference';
import type { YearReview } from '@/api/types';
import { to12Hour } from './yearReviewPresentation';

export function YearPatterns({ data, period }: { data: YearReview; period: StatPeriod }) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';
  // Retain the existing specialist averages and their integer rounding.
  const avgDistance = convertDistanceFromSI((data.avg_distance_per_drive_km ?? 0) * 1000, distanceUnit);
  const avgEfficiency = distanceUnit === 'mi'
    ? (data.avg_efficiency_wh_km ?? 0) * 1.609344 : (data.avg_efficiency_wh_km ?? 0);
  const { hour12, isPM } = to12Hour(data.most_active_hour);
  const meridiem = isPM ? t('yearReview.pm', 'PM') : t('yearReview.am', 'AM');

  return (
    <>
      <div className="space-y-3">
        <div>
          <Caption>{t('yearReview.favoriteDay', 'Favorite driving day')}</Caption>
          <Text as="p" variant="body" className="break-words">{data.most_active_day_of_week || '—'}</Text>
        </div>
        <div>
          <Caption>{t('yearReview.peakHour', 'Peak driving hour')}</Caption>
          <Text as="p" variant="body" className="tabular-nums">{hour12} {meridiem}</Text>
        </div>
      </div>
      <StatGroup id="year-review-patterns" period={period} metrics={[
        { metricId: 'text', rawValue: fmtNumber(data.avg_drives_per_week ?? 0), label: t('yearReview.drivesWeek', 'drives/week') },
        { metricId: 'text', rawValue: fmtInt(avgDistance), label: t('yearReview.distancePerDrive', { unit: distanceUnit, defaultValue: '{{unit}}/drive avg' }) },
        { metricId: 'text', rawValue: fmtInt(avgEfficiency), label: `${efficiencyUnit} ${t('yearReview.avg', 'avg')}` },
      ]} />
    </>
  );
}
