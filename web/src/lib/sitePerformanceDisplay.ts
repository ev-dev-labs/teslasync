import { useTranslation } from 'react-i18next'
import { useDateFormat } from '@/hooks/useDateFormat'
import { useUnits } from '@/hooks/useUnits'
import type { SmartChargingSitePerformanceReview } from '@/types/smartCharging'

export function useSitePerformanceDisplay(row: SmartChargingSitePerformanceReview | undefined | null) {
  const { t } = useTranslation()
  const { formatPower } = useUnits()
  const { formatDateTime } = useDateFormat()
  if (!row) return null
  return {
    title: t('smartCharging.sitePerformance.actionTitle', 'Charging has been slower at this place'),
    summary: t('smartCharging.sitePerformance.summary', '{{recentCount}} recent sessions averaged {{recent}} at {{place}}; the median across {{baselineCount}} comparable sessions was {{baseline}}.', {
      recentCount: row.recent_count,
      recent: formatPower(row.recent_w),
      place: row.place_name,
      baselineCount: row.baseline_count,
      baseline: formatPower(row.baseline_w),
    }),
    rationale: t('smartCharging.sitePerformance.rationale', 'Two recent sessions delivered materially less energy per elapsed hour than comparable sessions for the same vehicle and location.'),
    basis: t('smartCharging.sitePerformance.basis', 'Timestamped charging meter readings and similar charge levels and connector type'),
    dates: t('smartCharging.sitePerformance.dates', 'Evidence from {{from}} to {{through}}.', {
      from: formatDateTime(row.baseline_from_at), through: formatDateTime(row.observed_at),
    }),
    limitation: t('smartCharging.sitePerformance.limitation', 'Elapsed rates can include pauses. Review the current limit, schedule and site conditions; this is not a charger diagnosis.'),
  }
}
