import { useTranslation } from 'react-i18next'
import type { PackSelection } from '@/api/hooks/useAlertPacks'
import { Button, Caption, Input, Select } from '@/components/ui'
import type { PackDelivery } from './PackDeliveryControls'

interface Props {
  selection: PackSelection
  master: PackDelivery
  disabled: boolean
  onChange: (selection: PackSelection) => void
}

export default function PackRuleDeliveryEditor({ selection, master, disabled, onChange }: Props) {
  const { t } = useTranslation()
  const cooldown = selection.cooldown_s ?? master.cooldown_s
  const overridden = selection.cooldown_s != null || selection.trigger_mode != null || selection.include_title != null
  return <div className="space-y-2">
    <Input id={`pack-${selection.template_id}-cooldown`} label={t('alertPacks.cooldownCompact', 'Cooldown (min)')}
      aria-label={t('alertPacks.cooldown', 'Minimum minutes between notifications')}
      type="number" min={1} max={10080} step={1} value={Number.isNaN(cooldown) ? '' : cooldown / 60} disabled={disabled}
      onChange={event => onChange({ ...selection, cooldown_s: event.target.value === '' ? NaN : Number(event.target.value) * 60 })} />
    <Select id={`pack-${selection.template_id}-behavior`} label={t('alertPacks.behavior', 'Alert behavior')}
      value={selection.trigger_mode ?? ''} disabled={disabled}
      options={[
        { value: '', label: t('alertPacks.masterBehaviorValue', 'Master: {{behavior}}', { behavior: master.trigger_mode === 'once' ? t('alertPacks.onceTiny', 'Once') : t('alertPacks.repeatTiny', 'Repeat') }) },
        { value: 'once', label: t('alertPacks.onceShort', 'Once per condition') },
        { value: 'repeat', label: t('alertPacks.repeatShort', 'Repeat while active') },
      ]}
      onChange={event => {
        const { trigger_mode: _mode, ...rest } = selection
        onChange(event.target.value === '' ? rest : { ...selection, trigger_mode: event.target.value === 'repeat' ? 'repeat' : 'once' })
      }} />
    <div className="flex flex-wrap items-center gap-1">
      <Caption>{selection.cooldown_s == null ? t('alertPacks.masterCooldownShort', 'Cooldown follows master') : t('alertPacks.individualShort', 'Individual')}</Caption>
      {overridden && <Button variant="ghost" size="sm" disabled={disabled} onClick={() => {
        const { cooldown_s: _cooldown, trigger_mode: _mode, include_title: _title, ...rest } = selection
        onChange(rest)
      }}>{t('alertPacks.resetMaster', 'Reset to master')}</Button>}
    </div>
  </div>
}
