import { type ReactNode, type HTMLAttributes, useState, useCallback, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'
import { type NeonColor, neonColorMap, tableTokens } from '../../lib/tokens'
import { ChevronUp, ChevronDown, X } from 'lucide-react'

// ── DataTable ──

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  sortable?: boolean
  className?: string
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyExtractor: (row: T) => string | number
  sortKey?: string
  sortDir?: 'asc' | 'desc'
  onSort?: (key: string) => void
  emptyMessage?: string
  className?: string
  compact?: boolean
}

/** Sortable glass-styled data table with consistent styling. */
export function DataTable<T>({
  columns, data, keyExtractor, sortKey, sortDir, onSort, emptyMessage = 'No data', className, compact,
}: DataTableProps<T>) {
  return (
    <div className={cn('overflow-x-auto rounded-xl', className)}>
      <table className={tableTokens.wrapper}>
        <thead>
          <tr className={tableTokens.head}>
            {columns.map(col => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  compact ? 'px-3 py-2' : tableTokens.headCell,
                  col.sortable && 'cursor-pointer select-none hover:text-[var(--text-secondary)]',
                  col.className,
                )}
                onClick={() => col.sortable && onSort?.(col.key)}
                onKeyDown={col.sortable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort?.(col.key) } } : undefined}
                aria-sort={col.sortable && sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                {...(col.sortable ? { tabIndex: 0, role: 'button' as const } : {})}
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {col.sortable && sortKey === col.key && (
                    sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={tableTokens.body}>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map(row => (
              <tr key={keyExtractor(row)} className={tableTokens.row}>
                {columns.map(col => (
                  <td key={col.key} className={cn(compact ? 'px-3 py-2' : tableTokens.cell, col.className)}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

// ── Modal ──

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const modalSizes = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
}

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/** Generic modal dialog with portal, backdrop, and accessibility attributes. */
export function Modal({ open, onClose, title, children, size = 'md', className }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const modal = modalRef.current
    if (!modal) return
    const previouslyFocused = document.activeElement as HTMLElement

    const focusable = modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    if (focusable.length) focusable[0].focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
    }

    modal.addEventListener('keydown', handleKeyDown)
    return () => {
      modal.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <AnimatePresence>
      <div ref={modalRef} className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title || 'Dialog'}>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2 }}
          className={cn('relative glass-panel w-full', modalSizes[size], className)}
        >
          {title && (
            <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
              <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.06] transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className={cn(!title && 'pt-6', 'px-6 py-4')}>
            {children}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  )
}

// ── Drawer (side panel) ──

interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  side?: 'left' | 'right'
  className?: string
}

/** Slide-in side panel. */
export function Drawer({ open, onClose, title, children, side = 'right', className }: DrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const drawer = drawerRef.current
    if (!drawer) return
    const previouslyFocused = document.activeElement as HTMLElement

    const focusable = drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    if (focusable.length) focusable[0].focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
    }

    drawer.addEventListener('keydown', handleKeyDown)
    return () => {
      drawer.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div ref={drawerRef} className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title || 'Panel'}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <motion.div
        initial={{ x: side === 'right' ? '100%' : '-100%' }}
        animate={{ x: 0 }}
        exit={{ x: side === 'right' ? '100%' : '-100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className={cn(
          'absolute top-0 bottom-0 w-full max-w-md glass-panel rounded-none border-0',
          side === 'right' ? 'right-0 border-l border-white/[0.06]' : 'left-0 border-r border-white/[0.06]',
          className,
        )}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
            <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.06] transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="overflow-y-auto p-6" style={{ maxHeight: title ? 'calc(100vh - 65px)' : '100vh' }}>
          {children}
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}

// ── ChartContainer ──

interface ChartContainerProps {
  title?: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  height?: number | string
  className?: string
}

/** Standardized wrapper for Recharts charts with title and responsive height. */
export function ChartContainer({ title, subtitle, actions, children, height = 300, className }: ChartContainerProps) {
  return (
    <div className={cn('glass-panel p-4 sm:p-6', className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between mb-4">
          <div>
            {title && <h3 className="section-title">{title}</h3>}
            {subtitle && <p className="mt-1 text-xs text-[var(--text-muted)]">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div style={{ height: typeof height === 'number' ? `${height}px` : height }}>
        {children}
      </div>
    </div>
  )
}

// ── MetricCard ──

interface MetricCardProps {
  label: string
  value: string | number
  icon?: ReactNode
  color?: NeonColor
  change?: { value: string; positive: boolean }
  subtitle?: string
  className?: string
}

/** Compact metric display card with icon, value, label, and optional trend. */
export function MetricCard({ label, value, icon, color = 'cyan', change, subtitle, className }: MetricCardProps) {
  const c = neonColorMap[color]
  return (
    <div className={cn('p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] transition-colors hover:border-white/[0.08] h-full', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="metric-label mb-1 text-[10px] truncate">{label}</p>
          <p className="text-xl font-bold tracking-tight text-[var(--text-primary)] truncate" title={String(value)}>{value}</p>
          {subtitle && <p className="mt-0.5 text-[10px] text-[var(--text-muted)] truncate">{subtitle}</p>}
          {change && (
            <p className={cn('mt-1 text-[10px] font-medium', change.positive ? 'text-neon-green' : 'text-neon-red')}>
              {change.positive ? '↑' : '↓'} {change.value}
            </p>
          )}
        </div>
        {icon && (
          <div className={cn('flex items-center justify-center rounded-lg p-1.5 ring-1 shrink-0', c.bg, c.ring)}>
            <div className={c.text}>{icon}</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── AlertBanner ──

interface AlertBannerProps extends HTMLAttributes<HTMLDivElement> {
  variant: 'info' | 'success' | 'warning' | 'danger'
  title?: string
  children: ReactNode
  onClose?: () => void
  icon?: ReactNode
}

const alertVariantMap: Record<string, { border: string; bg: string; text: string; titleText: string }> = {
  info:    { border: 'border-neon-cyan/20',   bg: 'bg-neon-cyan/5',   text: 'text-neon-cyan/80',   titleText: 'text-neon-cyan' },
  success: { border: 'border-neon-green/20',  bg: 'bg-neon-green/5',  text: 'text-neon-green/80',  titleText: 'text-neon-green' },
  warning: { border: 'border-neon-amber/20',  bg: 'bg-neon-amber/5',  text: 'text-neon-amber/80',  titleText: 'text-neon-amber' },
  danger:  { border: 'border-neon-red/20',    bg: 'bg-neon-red/5',    text: 'text-neon-red/80',    titleText: 'text-neon-red' },
}

/** Inline notification banner for info, success, warning, or error messages. */
export function AlertBanner({ variant, title, children, onClose, icon, className, ...props }: AlertBannerProps) {
  const v = alertVariantMap[variant]
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border p-4 backdrop-blur-sm', v.border, v.bg, className)} {...props}>
      {icon && <div className={cn('shrink-0 mt-0.5', v.titleText)}>{icon}</div>}
      <div className="flex-1 min-w-0">
        {title && <p className={cn('text-sm font-medium', v.titleText)}>{title}</p>}
        <div className={cn('text-xs', v.text, title && 'mt-0.5')}>{children}</div>
      </div>
      {onClose && (
        <button onClick={onClose} className={cn('shrink-0 rounded-lg p-1 transition-colors hover:bg-white/[0.06]', v.text)}>
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

// ── Accordion ──

interface AccordionProps {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  icon?: ReactNode
  badge?: ReactNode
  className?: string
}

/** Collapsible content section with animated reveal. */
export function Accordion({ title, children, defaultOpen = false, icon, badge, className }: AccordionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={cn('rounded-xl border border-white/[0.06] overflow-hidden', className)}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        {icon && <div className="text-[var(--text-muted)]">{icon}</div>}
        <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">{title}</span>
        {badge}
        <ChevronDown className={cn('h-4 w-4 text-[var(--text-muted)] transition-transform duration-200', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/[0.04] px-4 py-3">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── FormSection ──

interface FormSectionProps {
  title: string
  description?: string
  children: ReactNode
  className?: string
}

/** Labeled fieldset for grouping form controls with consistent spacing. */
export function FormSection({ title, description, children, className }: FormSectionProps) {
  return (
    <div className={cn('glass-panel p-5 sm:p-6 space-y-4', className)}>
      <div>
        <h3 className="section-title">{title}</h3>
        {description && <p className="mt-1 text-xs text-[var(--text-muted)]">{description}</p>}
      </div>
      <div className="space-y-4">
        {children}
      </div>
    </div>
  )
}

// ── InlineMetric ──

interface InlineMetricProps {
  icon: ReactNode
  value: string | number
  label?: string
  className?: string
}

/** Compact icon+value pair used in stat rows within cards. */
export function InlineMetric({ icon, value, label, className }: InlineMetricProps) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs text-[var(--text-muted)]', className)}>
      <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">{icon}</span>
      <span>{value}</span>
      {label && <span className="text-[var(--text-muted)]">{label}</span>}
    </span>
  )
}

// ── SortToggle (utility hook) ──

export function useSortToggle(defaultKey?: string, defaultDir: 'asc' | 'desc' = 'desc') {
  const [sortKey, setSortKey] = useState(defaultKey ?? '')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultDir)

  const onSort = useCallback((key: string) => {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }, [sortKey])

  const sortFn = useCallback(<T,>(data: T[], accessor: (row: T, key: string) => number | string) => {
    if (!sortKey) return data
    return [...data].sort((a, b) => {
      const av = accessor(a, sortKey)
      const bv = accessor(b, sortKey)
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [sortKey, sortDir])

  return { sortKey, sortDir, onSort, sortFn }
}
