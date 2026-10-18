import { useTranslation } from 'react-i18next';
import { StatGroup } from '@/components/data-display/stat-reference';
import { Text, Caption } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { formatDayKey, ymdInTz } from '@/lib/dateFormat';
import type { YearReviewDriveHighlight } from '@/api/types';
import type { StatPeriod } from '@/lib/metric-reference';
import { recordDuration } from './yearReviewPresentation';

export function YearDriveRecord({ drive, id, period }: {
  drive: YearReviewDriveHighlight | null;
  id: string;
  period: StatPeriod;
}) {
  const { fmtInt, locale } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';
  const distanceDisplay = fmtInt(convertDistanceFromSI((drive?.distance_km ?? 0) * 1000, distanceUnit));
  const durationDisplay = recordDuration((drive?.duration_s ?? 0) / 60);
  const efficiencyWhKm = drive?.efficiency_wh_km ?? 0;
  const efficiencyDisplay = efficiencyWhKm > 0
    ? fmtInt(distanceUnit === 'mi' ? efficiencyWhKm * 1.609344 : efficiencyWhKm) : '—';
  const dayKey = drive?.date;
  const dateDisplay = dayKey && /^\d{4}-\d{2}-\d{2}$/.test(dayKey)
    && !dayKey.startsWith('0000-') && ymdInTz(new Date(`${dayKey}T12:00:00Z`), 'UTC') === dayKey
    ? formatDayKey(dayKey, { locale }) : '—';

  if (!drive) return <EmptyState
    message={t('yearReview.noDriveData', 'No drive data for this year')}
    actionTo={{ label: t('statistics.viewDrives', 'View drives'), to: '/drives' }}
  />;
  return (
    <>
      <div className="min-w-0 space-y-2">
        <Text as="p" variant="bodySm" className="break-words">{drive.start_address || '—'}</Text>
        <Text as="p" variant="bodySm" className="break-words">
          <span aria-hidden="true">→ </span>{drive.end_address || '—'}
        </Text>
      </div>
      <StatGroup id={id} period={period} metrics={[
        { metricId: 'text', rawValue: distanceDisplay, label: distanceUnit },
        { metricId: 'text', rawValue: durationDisplay, label: t('yearReview.duration', 'duration') },
        { metricId: 'text', rawValue: efficiencyDisplay, label: efficiencyUnit },
      ]} />
      <Caption className="break-words">{dateDisplay}</Caption>
    </>
  );
}
