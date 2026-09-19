import { RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PackSelection } from '@/api/hooks/useAlertPacks'
import { Button, Tooltip } from '@/components/ui'

interface Props {
  selection: PackSelection
  disabled: boolean
  onChange: (selection: PackSelection) => void
}

export default function PackRuleResetButton({ selection, disabled, onChange }: Props) {
  const { t } = useTranslation()
  const overridden = selection.cooldown_s != null || selection.trigger_mode != null || selection.include_title != null
  const label = t('alertPacks.resetMaster', 'Reset delivery to pack defaults')
  return <Tooltip content={label}>
    <Button variant="ghost" className="h-11 w-11 shrink-0 px-0" aria-label={label} disabled={disabled || !overridden}
      onClick={() => {
        const { cooldown_s: _cooldown, trigger_mode: _mode, include_title: _title, ...rest } = selection
        onChange(rest)
      }}>
      <RotateCcw className="h-4 w-4" aria-hidden="true" />
    </Button>
  </Tooltip>
}
