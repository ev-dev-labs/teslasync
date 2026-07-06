import { useTranslation } from 'react-i18next';
import { CalendarDays, Clock } from 'lucide-react';

import { GlassPanel, PanelTitle, Text, Caption, MetricValue } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type { YearReview } from '@/api/types';

interface Props {
  data: YearReview;
}

const KM_PER_MILE = 1.609344;

/**
 * Convert an hour-of-day into 12-hour clock parts. Telemetry can surface a
 * non-finite, fractional, negative, or out-of-range hour; truncating and
 * wrapping into [0, 23] keeps the label sane (never "NaN AM" / "-1 AM") while
 * preserving the correct label for every valid 0-23 input.
 */
function to12Hour(rawHour: number | null | undefined): { hour12: number; isPM: boolean } {
  const truncated = typeof rawHour === 'number' && Number.isFinite(rawHour) ? Math.trunc(rawHour) : 0;
  const hour = ((truncated % 24) + 24) % 24;
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return { hour12, isPM: hour >= 12 };
}

/** When and how the vehicle was driven across the year. */
export function YearPatternsPanel({ data }: Props) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  const avgDistance = convertDistanceFromSI((data.avg_distance_per_drive_km ?? 0) * 1000, distanceUnit);
  const avgEfficiency = distanceUnit === 'mi'
    ? (data.avg_efficiency_wh_km ?? 0) * KM_PER_MILE
    : (data.avg_efficiency_wh_km ?? 0);
  const { hour12, isPM } = to12Hour(data.most_active_hour);
  const meridiem = isPM ? t('yearReview.pm', 'PM') : t('yearReview.am', 'AM');

  const rows = [
    { icon: CalendarDays, label: t('yearReview.favoriteDay', 'Favorite driving day'), value: data.most_active_day_of_week || '—' },
    { icon: Clock, label: t('yearReview.peakHour', 'Peak driving hour'), value: `${hour12} ${meridiem}` },
  ];

  const stats = [
    { value: fmtNumber(data.avg_drives_per_week ?? 0, 1), unit: t('yearReview.drivesWeek', 'drives/week') },
    { value: fmtInt(avgDistance), unit: t('yearReview.distancePerDrive', { unit: distanceUnit, defaultValue: '{{unit}}/drive avg' }) },
    { value: fmtInt(avgEfficiency), unit: `${efficiencyUnit} ${t('yearReview.avg', 'avg')}` },
  ];

  return (
    <GlassPanel className="flex h-full flex-col gap-3 p-4 sm:p-5">
      <PanelTitle>{t('yearReview.drivingPatterns', 'Your driving patterns')}</PanelTitle>

      <div className="space-y-2">
        {rows.map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-center gap-3 rounded-xl bg-white/[0.03] p-3">
            <Icon className="h-5 w-5 shrink-0 text-indigo-300" aria-hidden="true" />
            <div className="min-w-0">
              <Caption>{label}</Caption>
              <Text size="sm" weight="semibold" color="primary" className="block truncate">{value}</Text>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-auto grid grid-cols-3 gap-2 pt-1 text-center">
        {stats.map((s) => (
          <div key={s.unit}>
            <MetricValue className="text-lg sm:text-xl">{s.value}</MetricValue>
            <Caption className="block">{s.unit}</Caption>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}
