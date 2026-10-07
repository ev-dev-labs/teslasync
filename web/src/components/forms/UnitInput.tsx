/**
 * Shared <UnitInput> primitive.
 *
 * A number-with-unit field that:
 *   1. Stores canonical meters, m/s, °C, kPa, Wh, percent, or
 *      currency-as-typed — see `lib/unitInput.ts`.
 *   2. Renders the value in the user's preferred display unit, derived
 *      from `useSettings()` on every render.
 *   3. Parses user-typed text on blur / Enter, accepting locale-aware
 *      decimal separators and tolerating the unit symbol in the input
 *      string ("60 mph", "75 kWh", "$1.23", "20°F").
 *   4. Rerenders the field when the user changes their unit
 *      preference, WITHOUT clobbering text the user is currently
 *      typing — the resync only happens when the input is not focused.
 *
 * Use as a drop-in replacement for `<Input type="number" suffix="…">`
 * patterns that previously paired a raw number with a hand-rolled
 * unit suffix span.
 *
 * @example
 *   <UnitInput
 *     label={t('chargePlanner.batteryCapacity', 'Battery Capacity')}
 *     unit="energy"
 *     value={batteryCapacityWh}
 *     onChange={setBatteryCapacityWh}
 *   />
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react'
import { Input, type InputProps } from '@/components/ui/runtime'
import { useSettings } from '@/hooks/useSettings'
import { useTranslation } from 'react-i18next'
import {
  formatForUnit,
  parseForUnit,
  unitSymbol,
  type UnitKind,
} from '@/lib/unitInput'

export interface UnitInputProps
  extends Omit<
    InputProps,
    'value' | 'onChange' | 'type' | 'suffix' | 'icon' | 'defaultValue'
  > {
  /** Canonical value: meters, m/s, °C, kPa, Wh, percent, or currency. */
  value: number | null
  /** Called with the canonical metric value (or null when blank). */
  onChange: (next: number | null) => void
  /** Which unit family this input represents. */
  unit: UnitKind
  /**
   * Pass `true` to disable locale-aware decimal/group separator
   * normalisation. Use as the Blocked-Path escape when input data
   * uses ambiguous separators that collide with the user's locale.
   */
  parseStrict?: boolean
  /** Keep parent validation and draft tracking current without replacing the text buffer. */
  commitOnChange?: boolean
}

/**
 * UnitInput keeps a local text buffer separate from the parent's
 * canonical value so:
 *   - the user can type freely without each keystroke triggering a
 *     parse / re-format round-trip (which would jump the cursor);
 *   - the field re-syncs to the latest canonical-formatted display
 *     whenever the parent value or the user's unit preference
 *     changes — UNLESS the user is currently focused and editing.
 */
export const UnitInput = forwardRef<HTMLInputElement, UnitInputProps>(
  function UnitInput(
    {
      value,
      onChange,
      unit,
      parseStrict,
      commitOnChange = false,
      onBlur,
      onKeyDown,
      onFocus,
      label,
      error,
      min,
      max,
      ...rest
    },
    ref,
  ) {
    const { settings } = useSettings()
    const { t } = useTranslation()
    const [editingPrefs, setEditingPrefs] = useState<{ unit: UnitKind; settings: typeof settings } | null>(null)
    const [parseError, setParseError] = useState<string | null>(null)

    const display = useMemo(
      () => formatForUnit(value, unit, settings),
      [value, unit, settings],
    )
    const symbol = useMemo(
      () => unitSymbol(editingPrefs?.unit ?? unit, editingPrefs?.settings ?? settings),
      [editingPrefs, unit, settings],
    )

    const [text, setText] = useState<string>(display)

    // Track focus internally so an external value/settings change while
    // the user is typing does NOT clobber the in-progress text. A ref
    // avoids the extra re-render that a `useState<boolean>` would
    // trigger on every focus/blur.
    const focusedRef = useRef(false)
    const dirtyRef = useRef(false)
    const parseValue = useCallback((raw: string) => {
      const parsed = parseForUnit(raw, editingPrefs?.unit ?? unit, editingPrefs?.settings ?? settings, { strict: !!parseStrict })
      if (parsed === null) return null
      if (min !== undefined && parsed < Number(min)) return null
      if (max !== undefined && parsed > Number(max)) return null
      return parsed
    }, [editingPrefs, unit, settings, parseStrict, min, max])

    // Resync local buffer when the formatted display changes — but only
    // when the user is NOT currently editing the field, so an external
    // setting change doesn't clobber in-progress input.
    useEffect(() => {
      if (focusedRef.current) return
      setText(display)
    }, [display])

    const commit = useCallback(
      (raw: string) => {
        const displayUnit = focusedRef.current ? editingPrefs?.unit ?? unit : unit
        const displaySettings = focusedRef.current ? editingPrefs?.settings ?? settings : settings
        if (!dirtyRef.current) {
          setText(formatForUnit(value, displayUnit, displaySettings))
          return
        }
        const parsed = parseValue(raw)
        if (parsed == null && raw.trim()) {
          setParseError(t('common.invalidNumber', 'Enter a valid number'))
          onChange(null)
          return
        }
        dirtyRef.current = false
        setParseError(null)
        onChange(parsed)
        setText(formatForUnit(parsed, displayUnit, displaySettings))
      },
      [editingPrefs, onChange, parseValue, settings, unit, value, t],
    )

    const handleFocus = useCallback(
      (e: FocusEvent<HTMLInputElement>) => {
        focusedRef.current = true
        setEditingPrefs({ unit, settings })
        onFocus?.(e)
      },
      [onFocus, unit, settings],
    )

    const handleBlur = useCallback(
      (e: FocusEvent<HTMLInputElement>) => {
        focusedRef.current = false
        commit(e.currentTarget.value)
        setEditingPrefs(null)
        onBlur?.(e)
      },
      [commit, onBlur],
    )

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          commit(e.currentTarget.value)
        }
        onKeyDown?.(e)
      },
      [commit, onKeyDown],
    )

    return (
      <Input
        ref={ref}
        label={label}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={text}
        error={error || parseError || undefined}
        onChange={(e) => {
          dirtyRef.current = true
          setParseError(null)
          setText(e.target.value)
          if (commitOnChange) {
            onChange(parseValue(e.target.value))
          }
        }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        suffix={symbol ? (
          <span
            aria-hidden="true"
            className="text-xs text-[var(--text-muted)]"
            data-testid="unit-input-symbol"
          >
            {symbol}
          </span>
        ) : undefined}
        {...rest}
      />
    )
  },
)
