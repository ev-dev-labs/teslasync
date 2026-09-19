import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Input, Select } from '@/components/ui'
import type { PackSelection } from '@/api/hooks/useAlertPacks'

export type PackDelivery = Required<Pick<PackSelection, 'cooldown_s' | 'trigger_mode' | 'include_title'>>

interface Props {
  value: PackDelivery
  onChange: (value: PackDelivery) => void
  disabled: boolean
}

export default function PackDeliveryControls({ value, onChange, disabled }: Props) {
  const { t } = useTranslation()
  const id = useId()
  return (
    <>
        <Input id={`${id}-cooldown`} label={t('alertPacks.cooldownCompact', 'Cooldown (min)')}
          aria-label={t('alertPacks.masterCooldown', 'Default cooldown (minutes)')} className="h-11"
          type="number" min={1} max={10080} step={1} value={Number.isNaN(value.cooldown_s) ? '' : value.cooldown_s / 60}
          disabled={disabled} onChange={e => onChange({ ...value, cooldown_s: e.target.value === '' ? NaN : Number(e.target.value) * 60 })} />
        <Select id={`${id}-mode`} label={t('alertPacks.masterBehavior', 'Default alert behavior')}
          aria-label={t('alertPacks.masterBehavior', 'Default alert behavior')} className="h-11"
          value={value.trigger_mode} disabled={disabled}
          options={[
            { value: 'once', label: t('alertPacks.onceShort', 'Once per condition') },
            { value: 'repeat', label: t('alertPacks.repeatShort', 'Repeat while active') },
          ]}
          onChange={e => onChange({ ...value, trigger_mode: e.target.value === 'repeat' ? 'repeat' : 'once' })} />
        <Select id={`${id}-title`} label={t('alertPacks.titleColumn', 'Include title')}
          aria-label={t('alertPacks.defaultTitle', 'Default title inclusion')} className="h-11"
          value={String(value.include_title)} disabled={disabled}
          options={[{ value: 'true', label: t('common.yes', 'Yes') }, { value: 'false', label: t('common.no', 'No') }]}
          onChange={event => onChange({ ...value, include_title: event.target.value === 'true' })} />
    </>
  )
}
