import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { neonColorMap, type NeonColor } from '@/lib/tokens'
import { Text, Caption } from './Typography'

export interface RadioCardProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'size'> {
  /** Primary label (bold). */
  label: ReactNode
  /** Optional secondary description line. */
  description?: ReactNode
  /** Optional leading icon. */
  icon?: ReactNode
  /** Accent hue for the selected state. Defaults to the app cyan. */
  accent?: NeonColor
  /** Controlled selected state. */
  checked: boolean
  /** Fires with the input's `value` when the user selects this card. */
  onChange: (value: string) => void
}

/**
 * Selectable option card built on a real `<input type="radio">`.
 *
 * The native radio (visually hidden) preserves keyboard arrow-navigation
 * within a `role="radiogroup"`, screen-reader semantics, and form
 * association; the visible card is driven by the controlled `checked`
 * prop. The raw `<input>` is intentional — `components/ui/` is the
 * sanctioned home for shared primitives (mirrors `Checkbox`/`Toggle`).
 */
export const RadioCard = forwardRef<HTMLInputElement, RadioCardProps>(
  (
    {
      label,
      description,
      icon,
      accent = 'cyan',
      checked,
      onChange,
      className,
      disabled,
      value,
      id,
      ...inputProps
    },
    ref,
  ) => {
    const autoId = useId()
    const inputId = id ?? autoId
    // Fall back to the documented cyan default if an out-of-contract accent
    // reaches us from an untyped (JS) caller. A shared primitive must never
    // hard-crash the page on `neonColorMap[bad].border` — degrade instead.
    const c = neonColorMap[accent] ?? neonColorMap.cyan
    return (
      <label htmlFor={inputId} className={cn('block', !disabled && 'cursor-pointer', className)}>
        <input
          ref={ref}
          id={inputId}
          type="radio"
          className="peer sr-only"
          value={value}
          checked={checked}
          disabled={disabled}
          onChange={(e) => {
            if (!disabled) onChange(e.target.value)
          }}
          {...inputProps}
        />
        <span
          className={cn(
            'flex min-h-11 items-start gap-2.5 rounded-lg border p-3 transition-colors',
            checked
              ? cn(c.border, c.bg)
              : 'border-[var(--border-subtle)] hover:border-[var(--border-strong)]',
            disabled && 'opacity-60',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-cyan-500 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-transparent',
            'forced-colors:border-[ButtonBorder]',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors',
              checked ? cn(c.border, c.text) : 'border-[var(--border-strong)]',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full transition-transform',
                checked ? c.dot : 'bg-transparent',
              )}
            />
          </span>
          {icon && (
            <span className={cn('mt-0.5 shrink-0', checked ? c.text : 'text-[var(--text-muted)]')}>
              {icon}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <Text as="span" size="sm" weight="medium" color="primary" className="block">
              {label}
            </Text>
            {description != null && <Caption className="mt-0.5 block">{description}</Caption>}
          </span>
        </span>
      </label>
    )
  },
)
RadioCard.displayName = 'RadioCard'
