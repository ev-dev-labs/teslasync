import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useUnits } from '@/hooks/useUnits';
import type { WarrantyDistanceProjection } from '@/types/warrantyReminders';

export function useWarrantyReminderDisplay(projection?: WarrantyDistanceProjection | null) {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat('user');
  const { fmtInt } = useNumberFormatting();
  const { formatDistance } = useUnits();
  return projection ? formatWarrantyReminder(projection, t, formatDate, fmtInt, formatDistance) : null;
}

export function formatWarrantyReminder(
  projection: WarrantyDistanceProjection,
  t: TFunction,
  formatDate: (value: string) => string,
  fmtInt: (value: number) => string,
  formatDistance: (value: number) => string,
) {
  return {
    title: t('ownership.warranty.mileage.actionTitle', 'Review the approaching warranty distance limit'),
    summary: t('ownership.warranty.mileage.range', 'At the recent recorded pace, the distance limit may arrive between {{earliest}} and {{latest}}, before the calendar term ends on {{term}}.', {
      earliest: formatDate(projection.earliest_limit_at),
      latest: formatDate(projection.latest_limit_at),
      term: formatDate(projection.documented_term_end),
    }),
    basis: t('ownership.warranty.mileage.basis', '{{remaining}} remained at the last recorded odometer reading. The estimate uses {{days}} observation days from {{from}} to {{through}} and the terms you entered.', {
      remaining: formatDistance(projection.remaining_m), days: fmtInt(projection.observed_days),
      from: formatDate(projection.evidence_from), through: formatDate(projection.recorded_at),
    }),
    limitation: t('ownership.warranty.mileage.limitation', 'This is an estimated range, not a coverage decision. Check the original terms and current odometer before contacting the warranty provider.'),
  };
}
