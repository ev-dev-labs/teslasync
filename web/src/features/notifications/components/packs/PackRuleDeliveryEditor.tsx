import { useTranslation } from 'react-i18next'
import type { PackSelection } from '@/api/hooks/useAlertPacks'
import { Checkbox, Input, Select } from '@/components/ui'
import { getAlertBehaviorOptions } from '../../lib/alertDelivery'
import type { PackDelivery } from './packDelivery'

interface Props {
  selection: PackSelection
  master: PackDelivery
  disabled: boolean
  field: 'cooldown' | 'behavior' | 'title'
  compact?: boolean
  onChange: (selection: PackSelection) => void
}

export default function PackRuleDeliveryEditor({ selection, master, disabled, onChange, field, compact = false }: Props) {
  const { t } = useTranslation()
  const cooldown = selection.cooldown_s ?? master.cooldown_s
  if (field === 'cooldown') return <Input id={`pack-${selection.template_id}-cooldown`}
      label={compact ? undefined : t('notifications.alertStudio.editor.cooldownLabel', 'Cooldown (minutes)')} className="h-11"
      aria-label={t('alertPacks.cooldown', 'Minimum minutes between notifications')}
      type="number" min={1} max={10080} step={1} value={Number.isNaN(cooldown) ? '' : cooldown / 60} disabled={disabled}
      onChange={event => onChange({ ...selection, cooldown_s: event.target.value === '' ? NaN : Number(event.target.value) * 60 })} />
  if (field === 'title') return <div className="flex min-h-11 items-center">
    <Checkbox label={compact ? undefined : t('alertPacks.includeTitle', 'Include title in notifications')}
      aria-label={t('alertPacks.includeTitle', 'Include title in notifications')}
      checked={selection.include_title ?? master.include_title} disabled={disabled}
      onChange={include_title => onChange({ ...selection, include_title })} />
  </div>
  return <Select id={`pack-${selection.template_id}-behavior`}
      label={compact ? undefined : t('alertPacks.behavior', 'Alert behavior')}
      aria-label={t('alertPacks.behavior', 'Alert behavior')} className="h-11"
      value={selection.trigger_mode ?? master.trigger_mode} disabled={disabled}
      options={getAlertBehaviorOptions(t)}
      onChange={event => onChange({ ...selection, trigger_mode: event.target.value === 'repeat' ? 'repeat' : 'once' })} />
}
