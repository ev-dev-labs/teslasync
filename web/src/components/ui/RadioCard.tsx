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
  /** Accent identity for the checked indicator. Defaults to the app cyan. */
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
      'aria-describedby': describedBy,
      ...inputProps
    },
    ref,
  ) => {
    const autoId = useId()
    const inputId = id ?? autoId
    const descriptionId = description != null ? `${inputId}-description` : undefined
    // Fall back to the documented cyan default if an out-of-contract accent
    // reaches us from an untyped (JS) caller. A shared primitive must never
    // hard-crash the page on `neonColorMap[bad].border` — degrade instead.
    const c = neonColorMap[accent] ?? neonColorMap.cyan
    return (
      <label htmlFor={inputId} className={cn('block min-w-0', disabled ? 'cursor-not-allowed' : 'cursor-pointer', className)}>
        <input
          ref={ref}
          id={inputId}
          type="radio"
          className="peer sr-only"
          value={value}
          checked={checked}
          disabled={disabled}
          aria-describedby={[describedBy, descriptionId].filter(Boolean).join(' ') || undefined}
          onChange={(e) => {
            if (!disabled) onChange(e.target.value)
          }}
          {...inputProps}
        />
        <span
          className={cn(
            'flex min-h-11 min-w-0 items-start gap-3 rounded-panel border p-3 text-start transition-colors duration-fast motion-reduce:transition-none',
            checked
              ? 'border-[var(--control-border-hover)] bg-[var(--control-bg)]'
              : 'border-[var(--control-border)] bg-surface-1',
            !disabled && 'hover:border-[var(--control-border-hover)] hover:bg-[var(--control-bg-hover)]',
            disabled && 'opacity-60',
            'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus-ring)]',
            'forced-colors:border-[ButtonText] forced-colors:bg-[ButtonFace] forced-colors:peer-focus-visible:outline-[Highlight]',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-fast motion-reduce:transition-none',
              checked ? c.text : 'text-[var(--text-secondary)]',
              'border-current forced-colors:text-[ButtonText]',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                checked ? cn(c.dot, 'forced-colors:bg-[ButtonText]') : 'bg-transparent',
              )}
            />
          </span>
          {icon && (
            <span className="mt-0.5 shrink-0 text-[var(--text-secondary)] forced-colors:text-[ButtonText]">
              {icon}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <Text as="span" size="sm" weight="medium" color="primary" className="block break-words">
              {label}
            </Text>
            {description != null && <Caption id={descriptionId} className="mt-0.5 block break-words">{description}</Caption>}
          </span>
        </span>
      </label>
    )
  },
)
RadioCard.displayName = 'RadioCard'
