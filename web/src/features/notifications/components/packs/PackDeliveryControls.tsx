import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Caption, Input, Select } from '@/components/ui'
import type { PackSelection } from '@/api/hooks/useAlertPacks'

export type PackDelivery = Required<Pick<PackSelection, 'cooldown_s' | 'trigger_mode' | 'include_title'>>

interface Props {
  value: PackDelivery
  onChange: (value: PackDelivery) => void
  disabled: boolean
  master?: boolean
  compact?: boolean
}

export default function PackDeliveryControls({ value, onChange, disabled, master = false, compact = false }: Props) {
  const { t } = useTranslation()
  const id = useId()
  return (
    <div className="@container space-y-2">
      <div className="grid gap-3 @sm:grid-cols-2">
        <Input id={`${id}-cooldown`} label={master ? t('alertPacks.masterCooldown', 'Master cooldown (minutes)') : t('alertPacks.cooldown', 'Minimum minutes between notifications')}
          type="number" min={1} max={10080} step={1} value={Number.isNaN(value.cooldown_s) ? '' : value.cooldown_s / 60}
          disabled={disabled} onChange={e => onChange({ ...value, cooldown_s: e.target.value === '' ? NaN : Number(e.target.value) * 60 })} />
        <Select id={`${id}-mode`} label={master ? t('alertPacks.masterBehavior', 'Master alert behavior') : t('alertPacks.behavior', 'Alert behavior')}
          value={value.trigger_mode} disabled={disabled}
          options={[
            { value: 'once', label: compact ? t('alertPacks.onceShort', 'Once per condition') : t('alertPacks.behaviorOnce', 'Once until condition resets') },
            { value: 'repeat', label: compact ? t('alertPacks.repeatShort', 'Repeat while active') : t('alertPacks.behaviorRepeat', 'Repeat after cooldown while active') },
          ]}
          onChange={e => onChange({ ...value, trigger_mode: e.target.value === 'repeat' ? 'repeat' : 'once' })} />
      </div>
      {!compact && <Caption className="block">{value.trigger_mode === 'repeat'
        ? t('alertPacks.repeat', 'Repeats while the condition remains true, no more often than the cooldown. Changed-value rules still require a new change.')
        : t('alertPacks.once', 'Fires once when the condition becomes true; resets when it becomes false. Changed-value rules fire on each change, subject to cooldown.')}</Caption>}
    </div>
  )
}
