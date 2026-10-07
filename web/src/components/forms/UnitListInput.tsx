import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input, type InputProps } from '@/components/ui/runtime'
import { useSettings } from '@/hooks/useSettings'
import { formatUnitList, parseUnitList, unitSymbol, type UnitKind, type UnitInputSettings } from '@/lib/unitInput'

interface UnitListInputProps extends Omit<InputProps, 'value' | 'onChange' | 'type' | 'suffix'> {
  values: readonly number[]
  unit: UnitKind
  onChange: (values: number[] | null) => void
}

export function UnitListInput({ values, unit, onChange, error, ...rest }: UnitListInputProps) {
  const { settings } = useSettings()
  const { t } = useTranslation()
  const display = formatUnitList(values, unit, settings)
  const [text, setText] = useState(display)
  const [editing, setEditing] = useState<{ unit: UnitKind; settings: UnitInputSettings } | null>(null)
  const [invalid, setInvalid] = useState(false)
  const focused = useRef(false)
  const dirty = useRef(false)
  const prefs = editing?.settings ?? settings
  const inputUnit = editing?.unit ?? unit

  useEffect(() => {
    if (!focused.current) setText(display)
  }, [display])

  return (
    <Input
      {...rest}
      type="text"
      value={text}
      suffix={unitSymbol(inputUnit, prefs)}
      hint={t('common.unitListHint', 'Separate values with semicolons')}
      error={error || (invalid ? t('common.invalidNumber', 'Enter a valid number') : undefined)}
      onFocus={event => {
        focused.current = true
        setEditing({ unit, settings })
        rest.onFocus?.(event)
      }}
      onChange={event => {
        dirty.current = true
        setText(event.target.value)
        const parsed = parseUnitList(event.target.value, inputUnit, prefs)
        setInvalid(parsed === null)
        onChange(parsed)
      }}
      onBlur={event => {
        focused.current = false
        if (dirty.current) {
          const parsed = parseUnitList(event.currentTarget.value, inputUnit, prefs)
          setInvalid(parsed === null)
          if (parsed !== null) {
            dirty.current = false
            setText(formatUnitList(parsed, unit, settings))
          }
        } else {
          setText(display)
        }
        setEditing(null)
        rest.onBlur?.(event)
      }}
    />
  )
}
