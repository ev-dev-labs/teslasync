import { useTranslation } from 'react-i18next'
import { useDateFormat } from '@/hooks/useDateFormat'
import { useNumberFormatting } from '@/hooks/useNumberFormatting'
import { useUnits } from '@/hooks/useUnits'
import type { SmartSolarDecision } from '@/types/smartCharging'

export function useSolarChargingDisplay(decision: SmartSolarDecision | null | undefined) {
  const { t } = useTranslation()
  const { formatDateTime } = useDateFormat();
  const { fmtInt } = useNumberFormatting()
  const { formatPower } = useUnits()
  if (!decision) return null
  return {
    title: t('smartCharging.solar.opportunity', 'There may be surplus solar available to charge'),
    summary: t('smartCharging.solar.evidence', 'At least {{export}} was exported across {{samples}} readings since {{start}}. Your home battery was at {{backup}}% with a {{reserve}}% reserve. The plugged-in vehicle was at {{battery}}%, below its {{target}}% limit.', {
      export: formatPower(decision.minimum_export_w), samples: fmtInt(decision.sample_count),
      start: formatDateTime(decision.sample_start),
      backup: fmtInt(decision.backup_pct), reserve: fmtInt(decision.reserve_pct),
      battery: fmtInt(decision.battery_pct), target: fmtInt(decision.charge_limit_pct),
    }),
    rationale: t('smartCharging.solar.rationale', 'Repeated export readings show the home battery remains above its configured reserve.'),
    basis: t('smartCharging.solar.basis', 'Timestamped Tesla Energy readings and fresh shared vehicle signals'),
    timing: t('smartCharging.solar.timing', 'Evidence as of {{observed}}; advice expires at {{expires}}. Export can change. If you have not already started, review charging on the car while parked.', {
      observed: formatDateTime(decision.observed_at), expires: formatDateTime(decision.expires_at),
    }),
  }
}
