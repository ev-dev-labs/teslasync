import { useTranslation } from 'react-i18next'
import { Button, Text, Toggle } from '@/components/ui'
import { useDateFormat } from '@/hooks/useDateFormat'
import type { PersonalDeliveryDevice } from '@/types/personalDelivery'

interface Props {
  device: PersonalDeliveryDevice
  index: number
  current: boolean
  disabled: boolean
  available: boolean
  family: 'charging' | 'commute'
  onChange: (id: number, enabled: boolean) => void
  onRemove: (id: number) => void
}

export function PersonalDeliveryDeviceRow({
  device, index, current, disabled, available, family, onChange, onRemove,
}: Props) {
  const { t } = useTranslation()
  const { formatDateTime } = useDateFormat('user')
  const name = current
    ? t('smartCharging.delivery.thisDevice', 'This browser')
    : t('smartCharging.delivery.deviceNumber', 'Device {{number}}', { number: index + 1 })
  const enabled = family === 'commute' ? device.commute_enabled : device.charging_enabled

  return (
    <article className="space-y-3 border-t border-[var(--border-subtle)] pt-4">
      <Text as="p" variant="body" weight="semibold">{name}</Text>
      <Text as="p" variant="bodySm">
        {device.verified
          ? t('smartCharging.delivery.verified', 'Verified for this account.')
          : t('smartCharging.delivery.pending', 'Waiting for this browser to confirm its subscription.')}
        {' '}
        {t('smartCharging.delivery.added', 'Added {{when}}.', { when: formatDateTime(device.created_at) })}
      </Text>
      <div>
        <Toggle
          label={family === 'commute'
            ? t('smartCommute.delivery.toggle', 'Allow commute traffic notifications on {{device}}', { device: name })
            : t('smartCharging.delivery.chargingToggle', 'Allow charging readiness notifications on {{device}}', { device: name })}
          checked={enabled ?? false}
          disabled={disabled || !device.verified || (!enabled && (!available || (family === 'commute' && !current)))}
          onChange={(checked) => onChange(device.id, checked)}
        />
      </div>
      <Button wrapLabel variant="secondary" size="sm" disabled={disabled}
        onClick={() => onRemove(device.id)}>
        {t('smartCharging.delivery.disconnectDevice', 'Disconnect {{device}}', { device: name })}
      </Button>
    </article>
  )
}
