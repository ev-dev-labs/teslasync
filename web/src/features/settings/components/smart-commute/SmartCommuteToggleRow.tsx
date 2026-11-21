import { useId } from 'react'
import { HelperText, Text, Toggle } from '@/components/ui'

interface Props {
  label: string
  description: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}

export function SmartCommuteToggleRow({ label, description, checked, disabled, onChange }: Props) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-4">
      <div className="min-w-0">
        <Text id={`${id}-label`} as="p" variant="label">{label}</Text>
        <HelperText id={`${id}-description`} className="mt-1">{description}</HelperText>
      </div>
      <Toggle checked={checked} disabled={disabled} onChange={onChange}
        aria-labelledby={`${id}-label`} aria-describedby={`${id}-description`} className="shrink-0" />
    </div>
  )
}
