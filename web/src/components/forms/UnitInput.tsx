/**
 * Shared <UnitInput> primitive.
 *
 * A number-with-unit field that:
 *   1. Stores its value in TeslaSync's canonical metric (miles, mph,
 *      °C, kWh, percent, currency-as-typed) — see `lib/unitInput.ts`.
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
 *     value={batteryCapacityKwh}
 *     onChange={setBatteryCapacityKwh}
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
  /** Canonical metric value (miles, mph, °C, kWh, percent, or currency). */
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
      onBlur,
      onKeyDown,
      onFocus,
      label,
      ...rest
    },
    ref,
  ) {
    const { settings } = useSettings()

    const display = useMemo(
      () => formatForUnit(value, unit, settings),
      [value, unit, settings],
    )
    const symbol = useMemo(
      () => unitSymbol(unit, settings),
      [unit, settings],
    )

    const [text, setText] = useState<string>(display)

    // Track focus internally so an external value/settings change while
    // the user is typing does NOT clobber the in-progress text. A ref
    // avoids the extra re-render that a `useState<boolean>` would
    // trigger on every focus/blur.
    const focusedRef = useRef(false)

    // Resync local buffer when the formatted display changes — but only
    // when the user is NOT currently editing the field, so an external
    // setting change doesn't clobber in-progress input.
    useEffect(() => {
      if (focusedRef.current) return
      setText(display)
    }, [display])

    const commit = useCallback(
      (raw: string) => {
        const parsed = parseForUnit(raw, unit, settings, { strict: !!parseStrict })
        onChange(parsed)
        // Renormalise the visible text to the canonical-rounded form so
        // typing "60.0001" → blur → "60" feels predictable.
        setText(formatForUnit(parsed, unit, settings))
      },
      [onChange, parseStrict, settings, unit],
    )

    const handleFocus = useCallback(
      (e: FocusEvent<HTMLInputElement>) => {
        focusedRef.current = true
        onFocus?.(e)
      },
      [onFocus],
    )

    const handleBlur = useCallback(
      (e: FocusEvent<HTMLInputElement>) => {
        focusedRef.current = false
        commit(e.currentTarget.value)
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
        onChange={(e) => setText(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        suffix={
          <span
            aria-hidden="true"
            className="text-xs text-[var(--text-muted)]"
            data-testid="unit-input-symbol"
          >
            {symbol}
          </span>
        }
        {...rest}
      />
    )
  },
)
