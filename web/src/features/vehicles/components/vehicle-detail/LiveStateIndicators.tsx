import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui'
import { useUnits } from '@/hooks/useUnits'
import type { VehicleState } from '@/api/types'

interface LiveStateIndicatorsProps {
  state: VehicleState
}

// Hoisted so the formatter options object is a stable reference rather than a
// fresh literal allocated on every render.
const SPEED_FORMAT = { precision: 0 } as const

export function LiveStateIndicators({ state }: LiveStateIndicatorsProps) {
  const { t } = useTranslation()
  const { formatSpeed } = useUnits()

  // The Fleet API serialises `speed` as null while the car is parked even
  // though the type models it as a number; coerce so a null/NaN value can't
  // silently skew the "moving" decision.
  const isMoving = (state.speed ?? 0) > 0

  return (
    <div
      className="flex flex-wrap gap-2"
      role="group"
      aria-label={t('vehicles.detail.liveState', 'Live State')}
    >
      <Badge variant={isMoving ? 'success' : 'neutral'} dot size="lg">
        {t('common.speed', 'Speed')}: {formatSpeed(state.speed, SPEED_FORMAT)}
      </Badge>
      <Badge variant={state.is_locked ? 'success' : 'danger'} dot size="lg">
        {state.is_locked ? t('common.locked', 'Locked') : t('common.unlocked', 'Unlocked')}
      </Badge>
      <Badge variant={state.sentry_mode ? 'warning' : 'neutral'} dot size="lg">
        {t('common.sentry', 'Sentry')}: {state.sentry_mode ? t('common.active', 'Active') : t('common.off', 'Off')}
      </Badge>
      <Badge variant={state.is_climate_on ? 'info' : 'neutral'} dot size="lg">
        {t('common.climate', 'Climate')}: {state.is_climate_on ? t('common.on', 'On') : t('common.off', 'Off')}
      </Badge>
      <Badge variant={state.is_charging ? 'warning' : 'neutral'} dot size="lg">
        {state.is_charging ? t('common.charging', 'Charging') : t('common.notCharging', 'Not Charging')}
      </Badge>
    </div>
  )
}
