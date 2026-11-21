import { useTranslation } from 'react-i18next';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { usePressureFormat } from '@/hooks/usePressureFormat';
import type { ColdTireCorner, ColdTireDrift } from '@/types/coldTireReview';

export function useColdTireLabels(): Record<ColdTireCorner, string> {
  const { t } = useTranslation();
  return {
    front_left: t('tireDifferentialDrift.corner.fl', 'Front left'),
    front_right: t('tireDifferentialDrift.corner.fr', 'Front right'),
    rear_left: t('tireDifferentialDrift.corner.rl', 'Rear left'),
    rear_right: t('tireDifferentialDrift.corner.rr', 'Rear right'),
  };
}

export function useColdTireDisplay(drift: ColdTireDrift | null | undefined) {
  const { t } = useTranslation();
  const labels = useColdTireLabels();
  const { formatDateTime } = useDateFormat('user');
  const { fmtInt } = useNumberFormatting();
  const { formatPressureValue } = usePressureFormat();
  if (!drift || !labels[drift.corner]) return null;
  return {
    title: t('tireDifferentialDrift.coldReview.cardTitle', 'Check one tire manually'),
    summary: t('tireDifferentialDrift.coldReview.cardSummary', '{{wheel}} fell by at least {{drop}} relative to the other tires across {{checks}} comparable cold checks.', {
      wheel: labels[drift.corner], drop: formatPressureValue(drift.relative_drop_pa), checks: fmtInt(drift.count),
    }),
    basis: t('tireDifferentialDrift.coldReview.cardBasis', 'You entered cold gauge readings from {{start}} to {{end}}. The latest reading on this tire was {{pressure}}.', {
      start: formatDateTime(drift.baseline_at), end: formatDateTime(drift.observed_at), pressure: formatPressureValue(drift.last_gauge_pressure_pa),
    }),
    limitation: t('tireDifferentialDrift.coldReview.cardLimit', 'Check it cold with a gauge and follow the vehicle’s own guidance. This pattern does not diagnose a leak, set a target pressure, or replace a vehicle warning.'),
  };
}
