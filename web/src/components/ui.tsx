import { motion, type HTMLMotionProps } from 'framer-motion'
import { type ReactNode } from 'react'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Calendar } from 'lucide-react'

// ── Re-export new component library ──
export { Badge, Button, IconBox, Toggle, Input, Select, Tooltip } from './ui/Atoms'
export type { BadgeVariant } from './ui/Atoms'
export { DataTable, Modal, Drawer, ChartContainer, MetricCard, AlertBanner, Accordion, FormSection, InlineMetric, useSortToggle } from './ui/Composites'
export type { Column } from './ui/Composites'

// === Animated containers ===

/** Fades in children with a slide-up animation. Optional delay for stagger orchestration. */
export function FadeIn({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

/** Container that staggers the entrance animation of its children. */
export function StaggerContainer({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: 0.06 } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

/** Child item inside a StaggerContainer — animates in sequence. */
export function StaggerItem({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 15 },
        show: { opacity: 1, y: 0, transition: { duration: 0.35 } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// === Glass panels ===

interface GlassPanelProps extends HTMLMotionProps<'div'> {
  children: ReactNode
  className?: string
  glow?: 'cyan' | 'red' | 'green' | 'purple' | 'none'
  hover?: boolean
}

/** Frosted-glass card panel with optional colored glow on hover. */
export function GlassPanel({ children, className = '', glow = 'none', hover = false, ...props }: GlassPanelProps) {
  const glowClasses = {
    cyan: 'hover:shadow-glow-sm hover:border-neon-cyan/20',
    red: 'hover:shadow-glow-red hover:border-tesla-red/20',
    green: 'hover:shadow-glow-green hover:border-neon-green/20',
    purple: 'hover:shadow-glow-purple hover:border-neon-purple/20',
    none: '',
  }

  return (
    <motion.div
      className={clsx(
        'glass-panel',
        hover && 'transition-all duration-300',
        hover && glowClasses[glow],
        className
      )}
      {...props}
    >
      {children}
    </motion.div>
  )
}

// === Stat card ===

interface StatCardProps {
  label: string
  value: string | number
  icon: ReactNode
  change?: { value: string; positive: boolean }
  color?: 'cyan' | 'red' | 'green' | 'purple' | 'amber'
  subtitle?: string
}

const colorMap = {
  cyan: { icon: 'text-neon-cyan', bg: 'bg-neon-cyan/10', ring: 'ring-neon-cyan/20', glow: 'shadow-[0_0_15px_rgba(0,240,255,0.1)]' },
  red: { icon: 'text-tesla-red', bg: 'bg-tesla-red/10', ring: 'ring-tesla-red/20', glow: 'shadow-[0_0_15px_rgba(227,25,55,0.1)]' },
  green: { icon: 'text-neon-green', bg: 'bg-neon-green/10', ring: 'ring-neon-green/20', glow: 'shadow-[0_0_15px_rgba(16,185,129,0.1)]' },
  purple: { icon: 'text-neon-purple', bg: 'bg-neon-purple/10', ring: 'ring-neon-purple/20', glow: 'shadow-[0_0_15px_rgba(168,85,247,0.1)]' },
  amber: { icon: 'text-neon-amber', bg: 'bg-neon-amber/10', ring: 'ring-neon-amber/20', glow: 'shadow-[0_0_15px_rgba(245,158,11,0.1)]' },
}

/** Displays a labeled metric value with icon, optional trend indicator, and colored accent. */
export function StatCard({ label, value, icon, change, color = 'cyan', subtitle }: StatCardProps) {
  const c = colorMap[color]
  return (
    <GlassPanel className={clsx('p-3 sm:p-5', c.glow)} hover glow={color === 'red' ? 'red' : color === 'green' ? 'green' : color === 'purple' ? 'purple' : 'cyan'}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="metric-label mb-1 sm:mb-2 text-[10px] sm:text-xs truncate">{label}</p>
          <p className="stat-value text-xl sm:text-3xl">{value}</p>
          {subtitle && <p className="mt-1 text-[10px] sm:text-xs text-[var(--text-muted)] truncate">{subtitle}</p>}
          {change && (
            <p className={clsx('mt-1 sm:mt-2 text-[10px] sm:text-xs font-medium', change.positive ? 'text-neon-green' : 'text-neon-red')}>
              {change.positive ? '↑' : '↓'} {change.value}
            </p>
          )}
        </div>
        <div className={clsx('rounded-lg sm:rounded-xl p-1.5 sm:p-2.5 ring-1 shrink-0', c.bg, c.ring)}>
          <div className={c.icon}>{icon}</div>
        </div>
      </div>
    </GlassPanel>
  )
}

// === Page header ===

/** Standard page header with gradient title, decorative underline, optional subtitle and action buttons. */
export function PageHeader({ title, subtitle, actions, icon }: { title: string; subtitle?: string; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <FadeIn>
      <div className="mb-6 sm:mb-8 flex flex-col gap-3 sm:gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-start gap-3">
          {icon && <div className="mt-1">{icon}</div>}
          <div>
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight bg-gradient-to-r from-white via-white to-gray-400 bg-clip-text text-transparent">{title}</h1>
            <div className="mt-1.5 sm:mt-2 h-0.5 w-12 sm:w-16 rounded-full bg-gradient-to-r from-neon-cyan to-neon-purple opacity-60" />
            {subtitle && <p className="mt-1.5 sm:mt-2 text-xs sm:text-sm" style={{ color: 'var(--text-secondary)' }}>{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 sm:gap-3">{actions}</div>}
      </div>
    </FadeIn>
  )
}

// === Status badge ===

/** Colored dot + label badge indicating a vehicle's current status. */
export function StatusBadge({ status, size = 'sm' }: { status: 'online' | 'offline' | 'asleep' | 'driving' | 'charging' | 'updating'; size?: 'sm' | 'md' }) {
  const config = {
    online: { color: 'bg-neon-green', text: 'text-neon-green', label: 'Online', glow: 'shadow-[0_0_6px_rgba(16,185,129,0.4)]' },
    offline: { color: 'bg-gray-500', text: 'text-[var(--text-secondary)]', label: 'Offline', glow: '' },
    asleep: { color: 'bg-neon-blue', text: 'text-neon-blue', label: 'Asleep', glow: 'shadow-[0_0_6px_rgba(79,70,229,0.4)]' },
    driving: { color: 'bg-neon-cyan', text: 'text-neon-cyan', label: 'Driving', glow: 'shadow-[0_0_6px_rgba(0,240,255,0.4)]' },
    charging: { color: 'bg-neon-green', text: 'text-neon-green', label: 'Charging', glow: 'shadow-[0_0_6px_rgba(16,185,129,0.4)]' },
    updating: { color: 'bg-neon-amber', text: 'text-neon-amber', label: 'Updating', glow: 'shadow-[0_0_6px_rgba(245,158,11,0.4)]' },
  }
  const c = config[status]
  return (
    <div className="flex items-center gap-2">
      <span className={clsx('rounded-full', c.color, c.glow, size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5')} />
      <span className={clsx('font-medium', c.text, size === 'sm' ? 'text-xs' : 'text-sm')}>{c.label}</span>
    </div>
  )
}

// === Progress ring ===

/** Animated SVG circular progress indicator with percentage label. */
export function ProgressRing({ value, max = 100, size = 80, strokeWidth = 4, color = '#00f0ff', label }: { value: number; max?: number; size?: number; strokeWidth?: number; color?: string; label?: string }) {
  const pct = Math.min((value / max) * 100, 100)
  const r = (size - strokeWidth * 2) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (pct / 100) * circ

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={strokeWidth} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: 'easeOut' }}
          style={{ filter: `drop-shadow(0 0 6px ${color})` }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-sm font-bold text-[var(--text-primary)]">{Math.round(pct)}%</span>
        {label && <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">{label}</span>}
      </div>
    </div>
  )
}

// === Sparkline ===

/** Tiny inline SVG line chart for showing trends in a compact space. */
export function Sparkline({ data, color = '#00f0ff', height = 30, width = 100 }: { data: number[]; color?: string; height?: number; width?: number }) {
  if (!data.length) return null
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const points = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * height}`).join(' ')

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={`sg-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
      <polyline points={`0,${height} ${points} ${width},${height}`} fill={`url(#sg-${color.replace('#', '')})`} stroke="none" />
    </svg>
  )
}

// === Loading skeleton ===

/** Shimmering placeholder block used as a loading skeleton. */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={clsx('rounded-xl bg-white/[0.03] animate-skeleton-wave relative overflow-hidden', className)}>
      <div className="absolute inset-0 animate-shimmer" style={{
        background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)',
        backgroundSize: '200% 100%',
      }} />
    </div>
  )
}

/** Skeleton shaped like a chart area — shows animated bars growing. */
export function ChartSkeleton({ className = '', bars = 7 }: { className?: string; bars?: number }) {
  return (
    <div className={clsx('rounded-xl bg-white/[0.02] p-4 flex items-end gap-2', className)}>
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className="flex-1 rounded-t bg-white/[0.04] animate-skeleton-wave"
          style={{
            height: `${25 + Math.sin(i * 0.9) * 20 + Math.random() * 30}%`,
            animationDelay: `${i * 0.1}s`,
          }}
        />
      ))}
    </div>
  )
}

/** Skeleton shaped like a stat card with a number and label. */
export function StatSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-${count} gap-3`}>
      {Array.from({ length: count }).map((_, i) => (
        <GlassPanel key={i} className="p-4 space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-7 w-24" />
        </GlassPanel>
      ))}
    </div>
  )
}

// === Page loader (for Suspense fallback) ===

/** Full-page spinning loader, suitable as a React Suspense fallback. */
export function PageLoader() {
  return (
    <div className="flex items-center justify-center py-32">
      <div className="relative">
        <div className="h-16 w-16 rounded-full border-2 border-white/[0.06]" />
        <div className="absolute inset-0 h-16 w-16 rounded-full border-2 border-t-neon-cyan border-r-transparent border-b-transparent border-l-transparent animate-spin" style={{ filter: 'drop-shadow(0 0 8px rgba(0,240,255,0.4))' }} />
        <div className="absolute inset-2 h-12 w-12 rounded-full border-2 border-t-transparent border-r-neon-purple border-b-transparent border-l-transparent animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s', filter: 'drop-shadow(0 0 6px rgba(168,85,247,0.3))' }} />
      </div>
    </div>
  )
}

// === Empty state ===

/** Centered empty-state placeholder with icon, title, and description. */
export function EmptyState({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="relative mb-6">
        <div className="absolute inset-0 animate-ping rounded-2xl bg-neon-cyan/5" style={{ animationDuration: '3s' }} />
        <div className="absolute -inset-3 rounded-3xl bg-gradient-to-b from-neon-cyan/5 to-transparent blur-xl" />
        <div className="relative rounded-2xl bg-white/[0.03] p-6 ring-1 ring-white/[0.08] backdrop-blur-sm">
          <div className="text-[var(--text-secondary)]">{icon}</div>
        </div>
      </div>
      <h3 className="text-lg font-semibold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-[var(--text-muted)] leading-relaxed">{description}</p>
    </div>
  )
}

// === Query Error Banner ===

/** Inline error banner for failed API queries. Shows message + retry button. */
export function QueryError({ error, onRetry }: { error: Error | null; onRetry?: () => void }) {
  if (!error) return null
  return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 mb-6 backdrop-blur-sm">
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5 rounded-lg bg-red-500/10 p-2">
          <svg className="h-4 w-4 text-red-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-red-300">Failed to load data</p>
          <p className="text-xs text-red-400/70 mt-0.5 truncate">{error.message}</p>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="shrink-0 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 transition-colors"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  )
}

// === Confirm modal ===

/** Modal dialog for confirming destructive or important actions. */
export function ConfirmModal({ open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'danger', onConfirm, onCancel }: {
  open: boolean; title: string; message: string; confirmLabel?: string; cancelLabel?: string; variant?: 'danger' | 'warning'; onConfirm: () => void; onCancel: () => void;
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="relative glass-panel p-6 max-w-sm w-full mx-4"
      >
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">{title}</h3>
        <p className="text-sm text-[var(--text-secondary)] mb-6">{message}</p>
        <div className="flex items-center gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg hover:bg-white/5 transition-all">{cancelLabel}</button>
          <button onClick={onConfirm} className={clsx('px-4 py-2 text-sm font-medium rounded-lg transition-all',
            variant === 'danger' ? 'bg-neon-red/20 text-neon-red ring-1 ring-neon-red/30 hover:bg-neon-red/30' : 'bg-neon-amber/20 text-neon-amber ring-1 ring-neon-amber/30 hover:bg-neon-amber/30'
          )}>{confirmLabel}</button>
        </div>
      </motion.div>
    </div>
  )
}

// === Tab navigation ===

/** Horizontal tab navigation bar with icon support. */
export function TabNav({ tabs, active, onChange }: { tabs: { key: string; label: string; icon?: ReactNode }[]; active: string; onChange: (key: string) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-xl bg-white/[0.02] p-1 border border-white/[0.06] overflow-x-auto scrollbar-thin">
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={clsx(
            'flex items-center gap-1.5 sm:gap-2 rounded-lg px-2.5 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium transition-all duration-200 whitespace-nowrap shrink-0',
            active === t.key
              ? 'bg-white/[0.08] text-[var(--text-primary)] shadow-sm'
              : 'text-[var(--text-muted)] hover:text-gray-300'
          )}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  )
}

// === Date Range Filter ===

interface DateRangeFilterProps {
  startDate: string
  endDate: string
  onStartDateChange: (date: string) => void
  onEndDateChange: (date: string) => void
  onApply?: () => void
  presets?: boolean
}

/** Date range picker with quick-select presets (7d, 30d, 90d, 1y, All). */
export function DateRangeFilter({ startDate, endDate, onStartDateChange, onEndDateChange, onApply, presets = true }: DateRangeFilterProps) {
  const applyPreset = (days: number | null) => {
    const end = new Date()
    const endStr = end.toISOString().split('T')[0]
    onEndDateChange(endStr)
    if (days === null) {
      onStartDateChange('2015-01-01')
    } else {
      const start = new Date()
      start.setDate(start.getDate() - days)
      onStartDateChange(start.toISOString().split('T')[0])
    }
    onApply?.()
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2 sm:px-3 py-1.5 ring-1 ring-white/[0.08] w-full sm:w-auto">
        <Calendar className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0 hidden sm:block" />
        <input
          type="date"
          value={startDate}
          onChange={e => onStartDateChange(e.target.value)}
          className="bg-transparent text-xs text-[var(--text-primary)] outline-none [color-scheme:dark] min-w-0 flex-1 sm:flex-none"
        />
        <span className="text-gray-600 text-xs">→</span>
        <input
          type="date"
          value={endDate}
          onChange={e => onEndDateChange(e.target.value)}
          className="bg-transparent text-xs text-[var(--text-primary)] outline-none [color-scheme:dark] min-w-0 flex-1 sm:flex-none"
        />
      </div>
      {onApply && (
        <button onClick={onApply} className="neon-button px-3 py-1.5 text-xs font-medium">Apply</button>
      )}
      {presets && (
        <div className="flex items-center gap-1">
          {[
            { label: '7d', days: 7 },
            { label: '30d', days: 30 },
            { label: '90d', days: 90 },
            { label: '1y', days: 365 },
            { label: 'All', days: null },
          ].map(p => (
            <button
              key={p.label}
              onClick={() => applyPreset(p.days)}
              className="rounded-md px-2 py-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/[0.06] transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// === Pagination ===

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
}

/** Table pagination controls with first/prev/next/last buttons and optional page-size selector. */
export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, pageSizeOptions = [25, 50, 100] }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  return (
    <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center justify-between gap-2 sm:gap-3 pt-4">
      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <span className="whitespace-nowrap">Showing {total > 0 ? start : 0}–{end} of {total}</span>
        {onPageSizeChange && (
          <select
            value={pageSize}
            onChange={e => onPageSizeChange(Number(e.target.value))}
            className="rounded-md bg-white/[0.04] px-2 py-1 text-xs text-gray-300 outline-none ring-1 ring-white/[0.08]"
          >
            {pageSizeOptions.map(s => (
              <option key={s} value={s} className="bg-[var(--bg)]">{s} / page</option>
            ))}
          </select>
        )}
      </div>
      <div className="flex items-center gap-1 self-end sm:self-auto">
        <button onClick={() => onPageChange(1)} disabled={page <= 1}
          className="rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.06] disabled:opacity-30 disabled:pointer-events-none transition-colors">
          <ChevronsLeft className="h-4 w-4" />
        </button>
        <button onClick={() => onPageChange(page - 1)} disabled={page <= 1}
          className="rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.06] disabled:opacity-30 disabled:pointer-events-none transition-colors">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="px-3 text-xs font-medium text-gray-300">
          {page} / {totalPages}
        </span>
        <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}
          className="rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.06] disabled:opacity-30 disabled:pointer-events-none transition-colors">
          <ChevronRight className="h-4 w-4" />
        </button>
        <button onClick={() => onPageChange(totalPages)} disabled={page >= totalPages}
          className="rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.06] disabled:opacity-30 disabled:pointer-events-none transition-colors">
          <ChevronsRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
