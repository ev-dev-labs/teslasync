import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui'
import { useUnits } from '@/hooks/useUnits'
import type { VehicleState } from '@/api/types'

interface LiveStateIndicatorsProps {
  state: VehicleState
}

export function LiveStateIndicators({ state }: LiveStateIndicatorsProps) {
  const { t } = useTranslation()
  const { formatSpeed } = useUnits()

  return (
    <div className="flex flex-wrap gap-2">
      <Badge variant={state.speed > 0 ? 'success' : 'neutral'} dot size="lg">
        {t('common.speed', 'Speed')}: {formatSpeed(state.speed, { precision: 0 })}
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
