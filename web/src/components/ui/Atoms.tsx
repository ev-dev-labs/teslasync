import { type ReactNode, type ButtonHTMLAttributes, forwardRef, useId } from 'react'
import { cn } from '../../lib/cn'
import { type NeonColor, neonColorMap } from '../../lib/tokens'

// ── Badge ──

export type BadgeVariant = NeonColor | 'neutral'

interface BadgeProps {
  children: ReactNode
  color?: BadgeVariant
  size?: 'sm' | 'md'
  dot?: boolean
  className?: string
}

const neutralClasses = { text: 'text-[var(--text-secondary)]', bg: 'bg-white/[0.04]', ring: 'ring-white/[0.08]', dot: 'bg-gray-400' }

/** Colored pill badge for status labels, tags, and categories. */
export function Badge({ children, color = 'cyan', size = 'sm', dot = false, className }: BadgeProps) {
  const c = color === 'neutral' ? neutralClasses : neonColorMap[color]
  return (
    <span className={cn(
      'inline-flex items-center gap-1 font-semibold rounded-full ring-1',
      c.text, c.bg, c.ring,
      size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
      className,
    )}>
      {dot && <span className={cn('rounded-full shrink-0', c.dot, size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2')} />}
      {children}
    </span>
  )
}

// ── Button ──

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  loading?: boolean
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'neon-button',
  secondary: 'glass-button',
  danger: 'neon-button-red',
  ghost: 'inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/[0.06]',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: '!px-3 !py-1.5 !text-xs !gap-1.5',
  md: '',
  lg: '!px-6 !py-3 !text-base',
}

/** Multi-variant button wrapping the CSS neon-button / glass-button classes. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', icon, loading, children, className, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          variantClasses[variant],
          sizeClasses[size],
          (disabled || loading) && 'opacity-50 pointer-events-none',
          className,
        )}
        {...props}
      >
        {loading ? (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-25" />
            <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
          </svg>
        ) : icon ? (
          <span className="shrink-0">{icon}</span>
        ) : null}
        {children}
      </button>
    )
  }
)
Button.displayName = 'Button'

// ── IconBox ──

interface IconBoxProps {
  children: ReactNode
  color?: NeonColor
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const iconBoxSize = {
  sm: 'h-8 w-8 rounded-lg',
  md: 'h-10 w-10 rounded-xl',
  lg: 'h-12 w-12 rounded-xl',
}

/** Colored icon container with background ring. Replaces the repeated h-10 w-10 rounded-xl pattern. */
export function IconBox({ children, color = 'cyan', size = 'md', className }: IconBoxProps) {
  const c = neonColorMap[color]
  return (
    <div className={cn(
      'flex items-center justify-center ring-1 shrink-0',
      iconBoxSize[size],
      c.bg, c.ring, c.text,
      className,
    )}>
      {children}
    </div>
  )
}

// ── Toggle ──

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  description?: string
  disabled?: boolean
  className?: string
}

/** On/off toggle switch with optional label. */
export function Toggle({ checked, onChange, label, description, disabled, className }: ToggleProps) {
  return (
    <label className={cn('flex items-center gap-3 cursor-pointer select-none', disabled && 'opacity-50 pointer-events-none', className)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-neon-cyan/30 ring-1 ring-neon-cyan/40' : 'bg-white/[0.08] ring-1 ring-white/[0.08]',
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-5 w-5 rounded-full shadow-lg transition-transform duration-200 translate-y-0.5',
            checked ? 'translate-x-[22px] bg-neon-cyan shadow-[0_0_8px_rgba(0,240,255,0.4)]' : 'translate-x-0.5 bg-gray-400',
          )}
        />
      </button>
      {(label || description) && (
        <div>
          {label && <span className="text-sm font-medium text-[var(--text-primary)]">{label}</span>}
          {description && <p className="text-xs text-[var(--text-muted)]">{description}</p>}
        </div>
      )}
    </label>
  )
}

// ── Input ──

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  icon?: ReactNode
}

/** Glass-styled text input with optional label and error state. */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, className, ...props }, ref) => {
    const autoId = useId()
    const inputId = props.id || autoId
    return (
      <div className="space-y-1.5">
        {label && <label htmlFor={inputId} className="metric-label">{label}</label>}
        <div className="relative">
          {icon && <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">{icon}</div>}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'glass-input',
              icon && 'pl-10',
              error && 'border-neon-red/50 focus:border-neon-red focus:shadow-[0_0_15px_rgba(239,68,68,0.15)]',
              className,
            )}
            {...props}
          />
        </div>
        {error && <p className="text-xs text-neon-red">{error}</p>}
      </div>
    )
  }
)
Input.displayName = 'Input'

// ── Select ──

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: { value: string; label: string }[]
}

/** Glass-styled select dropdown with label support. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, className, ...props }, ref) => {
    const autoId = useId()
    const selectId = props.id || autoId
    return (
      <div className="space-y-1.5">
        {label && <label htmlFor={selectId} className="metric-label">{label}</label>}
        <select
          ref={ref}
          id={selectId}
          className={cn(
            'glass-input appearance-none pr-8',
            'bg-[length:16px] bg-[right_12px_center] bg-no-repeat',
            "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%236b7280'%3E%3Cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z'/%3E%3C/svg%3E\")]",
            error && 'border-neon-red/50',
            className,
          )}
          {...props}
        >
          {options.map(o => (
            <option key={o.value} value={o.value} className="bg-[var(--surface-1)] text-[var(--text-primary)]">{o.label}</option>
          ))}
        </select>
        {error && <p className="text-xs text-neon-red">{error}</p>}
      </div>
    )
  }
)
Select.displayName = 'Select'

// ── Tooltip ──

interface TooltipProps {
  content: string
  children: ReactNode
  side?: 'top' | 'bottom'
}

/** Lightweight hover tooltip. */
export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  return (
    <span className="relative group/tooltip inline-flex">
      {children}
      <span className={cn(
        'pointer-events-none absolute left-1/2 -translate-x-1/2 z-50 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium',
        'bg-surface-3 text-[var(--text-primary)] ring-1 ring-white/[0.08] shadow-lg backdrop-blur-sm',
        'opacity-0 scale-95 transition-all duration-150 group-hover/tooltip:opacity-100 group-hover/tooltip:scale-100',
        side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
      )}>
        {content}
      </span>
    </span>
  )
}
