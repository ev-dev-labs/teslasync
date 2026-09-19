import { RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PackSelection } from '@/api/hooks/useAlertPacks'
import { Button, Tooltip } from '@/components/ui'
import { hasPackDeliveryOverride, resetPackDelivery } from './packDelivery'

interface Props {
  selection: PackSelection
  disabled: boolean
  onChange: (selection: PackSelection) => void
}

export default function PackRuleResetButton({ selection, disabled, onChange }: Props) {
  const { t } = useTranslation()
  const overridden = hasPackDeliveryOverride(selection)
  const label = t('alertPacks.resetMaster', 'Reset delivery to pack defaults')
  return <Tooltip content={label}>
    <Button variant="ghost" className="h-11 w-11 shrink-0 px-0" aria-label={label} disabled={disabled || !overridden}
      onClick={() => onChange(resetPackDelivery(selection))}>
      <RotateCcw className="h-4 w-4" aria-hidden="true" />
    </Button>
  </Tooltip>
}
