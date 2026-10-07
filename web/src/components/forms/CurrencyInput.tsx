/**
 * Shared `<CurrencyInput>` primitive.
 *
 * A currency-aware number field that:
 *   1. Stores its value in **integer micro-units** (1 USD = 1_000_000)
 *      to avoid floating-point round-trip loss across currencies that
 *      have 0/2/3/4 fractional digits — see `lib/currencyFormat.ts`.
 *   2. Renders the value formatted with `Intl.NumberFormat`'s `style:
 *      'currency'` so the symbol / position / decimal separator match
 *      the user's locale ("$1.50" vs "1,50 €").
 *   3. Parses user-typed text on blur / Enter, accepting:
 *        - the localized symbol on either side ("$1.50", "1,50 €")
 *        - the literal ISO code ("USD 1.50")
 *        - locale group separators ("1,234.56" en-US, "1.234,56" de-DE)
 *        - accounting parentheses for negatives ("($1.50)" → -1.5)
 *   4. Re-syncs from the parent's `valueMicro` whenever it changes
 *      WITHOUT clobbering text the user is currently typing — the
 *      resync only happens when the input is not focused.
 *
 * Use as a drop-in replacement for `<Input type="number">` patterns
 * that previously paired a raw number with a hand-rolled currency
 * symbol span.
 *
 * @example
 *   <CurrencyInput
 *     ariaLabel={t('settings.electricityCost', 'Electricity Cost (per kWh)')}
 *     valueMicro={form.tariffMicro}
 *     currency="USD"
 *     locale="en-US"
 *     onChange={({ valueMicro }) => setForm({ ...form, tariffMicro: valueMicro })}
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
import {
  currencySymbol,
  formatCurrencyMicro,
  parseCurrencyTextToMicro,
} from '@/lib/currencyFormat'

export interface CurrencyInputChangePayload {
  valueMicro: number | null
}

export interface CurrencyInputProps
  extends Omit<
    InputProps,
    'value' | 'onChange' | 'type' | 'suffix' | 'icon' | 'defaultValue' | 'aria-label'
  > {
  /** Canonical integer micro-units (1 major unit = 1_000_000). Null when empty. */
  valueMicro: number | null
  /** Called with the new canonical micro value (or null when blank). */
  onChange: (next: CurrencyInputChangePayload) => void
  /** ISO 4217 currency code: 'USD', 'EUR', 'GBP', etc. */
  currency: string
  /**
   * BCP-47 locale tag for `Intl.NumberFormat`. Defaults to
   * `navigator.language` in the browser, 'en-US' in non-browser
   * environments (SSR / vitest).
   */
  locale?: string
  /** Fractional digits to display. Storage keeps full micro precision. */
  precision?: number
  /**
   * Required for accessibility — pulled into both `aria-label` AND the
   * `<Input>`'s visible label when no `label` is supplied. Existing
   * pages with a separate `<SettingField label>` wrapper should still
   * pass `ariaLabel` so screen readers announce the field correctly.
   */
  ariaLabel: string
}

/**
 * CurrencyInput keeps a local text buffer separate from the parent's
 * canonical micro value so:
 *   - the user can type freely without each keystroke triggering a
 *     parse / re-format round-trip (which would jump the cursor);
 *   - the field re-syncs to the latest formatted display whenever the
 *     parent value, currency, locale, or precision changes — UNLESS
 *     the user is currently focused and editing.
 */
export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  function CurrencyInput(
    {
      valueMicro,
      onChange,
      currency,
      locale,
      precision,
      ariaLabel,
      onBlur,
      onKeyDown,
      onFocus,
      label,
      ...rest
    },
    ref,
  ) {
    const effectiveLocale = useMemo(() => resolveLocale(locale), [locale])
    const effectivePrecision = precision ?? 2

    const display = useMemo(
      () => formatCurrencyMicro(valueMicro, currency, effectiveLocale, effectivePrecision),
      [valueMicro, currency, effectiveLocale, effectivePrecision],
    )
    const symbol = useMemo(
      () => currencySymbol(currency, effectiveLocale),
      [currency, effectiveLocale],
    )

    const [text, setText] = useState<string>(display)

    // Track focus internally so an external value/locale/currency change
    // while the user is typing does NOT clobber the in-progress text.
    // A ref avoids the extra re-render that a `useState<boolean>` would
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
        const parsedMicro = parseCurrencyTextToMicro(raw, currency, effectiveLocale)
        onChange({ valueMicro: parsedMicro })
        // Renormalise the visible text to the canonical-rounded form so
        // typing "1.5001" → blur → "$1.50" feels predictable.
        setText(
          formatCurrencyMicro(parsedMicro, currency, effectiveLocale, effectivePrecision),
        )
      },
      [onChange, currency, effectiveLocale, effectivePrecision],
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
        aria-label={ariaLabel}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        icon={
          <span
            aria-hidden="true"
            className="text-xs text-[var(--text-muted)]"
            data-testid="currency-input-symbol"
          >
            {symbol}
          </span>
        }
        {...rest}
      />
    )
  },
)

/**
 * Resolve the BCP-47 locale tag. Prefers an explicit prop, then
 * `navigator.language`, then 'en-US'. Defensive against test/SSR
 * environments where `navigator` may be undefined.
 */
function resolveLocale(explicit?: string): string {
  if (explicit && explicit.trim()) return explicit
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language
  }
  return 'en-US'
}
