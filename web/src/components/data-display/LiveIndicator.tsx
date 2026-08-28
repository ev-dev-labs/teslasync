import { Wifi, WifiOff, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLiveConnection } from '@/hooks/useLiveConnection'
import { useConnectionAnnouncement } from '@/hooks/useConnectionAnnouncement'
import { formatRelativeTime } from '@/lib/dateFormat'
import { cn } from '@/lib/cn'

/**
 * Visual variants for `<LiveIndicator>`:
 *   - `pill`    → colored chip with icon, label, and freshness timestamp
 *   - `dot`     → bare colored dot, no text (use in dense headers)
 *   - `compact` → colored chip with icon + label, but no timestamp
 */
export type LiveIndicatorVariant = 'pill' | 'dot' | 'compact'

interface LiveIndicatorProps {
  variant?: LiveIndicatorVariant
  className?: string
}

interface VariantConfig {
  icon: typeof Wifi
  /** Tailwind text utility, e.g. `text-emerald-300`. */
  text: string
  /** Tailwind background utility, e.g. `bg-emerald-500/10`. */
  bg: string
  /** Tailwind background utility for the bare dot variant. */
  dot: string
  label: string
  spin?: boolean
}

/**
 * `<LiveIndicator>` — at-a-glance health of the live-data pipeline.
 * Renders the four states surfaced by `useLiveConnection`:
 *   - `connected`    → emerald `Wifi`, "Live · Xs ago"
 *   - `reconnecting` → amber spinning `Loader2`, "Reconnecting…"
 *   - `disconnected` → rose `WifiOff`, "Offline"
 *   - `unknown`      → muted `WifiOff`, "Unknown"
 * NOT to be confused with `<FreshnessIndicator>` — that component reflects
 * the AGE of a single data point, this one reflects the HEALTH OF THE WIRE.
 * Use `variant="dot"` in compact navigation headers and the app shell;
 * `variant="compact"` next to `<PageHeader>` actions on data-heavy pages;
 * `variant="pill"` (default) when there is room for a freshness stamp.
 */
export function LiveIndicator({ variant = 'pill', className }: LiveIndicatorProps) {
  const { status, lastMessageAt } = useLiveConnection()
  const { t } = useTranslation()
  // A11Y-06: colour and icon alone cannot tell a screen-reader user that
  // the wire dropped and the numbers on screen are now stale. Governed
  // so a flapping connection speaks at most once per 10 s.
  useConnectionAnnouncement(status, { label: t('live.scope', 'Live data') })

  const cfg: Record<typeof status, VariantConfig> = {
    connected: {
      icon: Wifi,
      text: 'text-emerald-300',
      bg: 'bg-emerald-500/10',
      dot: 'bg-emerald-400',
      label: t('live.connected', 'Live'),
    },
    reconnecting: {
      icon: Loader2,
      text: 'text-amber-300',
      bg: 'bg-amber-500/10',
      dot: 'bg-amber-400',
      label: t('live.reconnecting', 'Reconnecting…'),
      spin: true,
    },
    disconnected: {
      icon: WifiOff,
      text: 'text-rose-300',
      bg: 'bg-rose-500/10',
      dot: 'bg-rose-400',
      label: t('live.disconnected', 'Offline'),
    },
    unknown: {
      icon: WifiOff,
      text: 'text-[var(--text-muted)]',
      bg: 'bg-white/[0.03]',
      dot: 'bg-[var(--surface-2)]',
      label: t('live.unknown', 'Unknown'),
    },
  }
  const v = cfg[status]
  const Icon = v.icon

  if (variant === 'dot') {
    return (
      <span
        role="status"
        aria-label={v.label}
        title={v.label}
        className={cn('inline-block h-2 w-2 rounded-full shrink-0', v.dot, className)}
      />
    )
  }

  return (
    <span
      role="status"
      aria-label={v.label}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-white/[0.05] px-2 py-0.5 text-xs',
        v.bg,
        v.text,
        className,
      )}
    >
      <Icon className={cn('h-3 w-3 shrink-0', v.spin && 'animate-spin')} aria-hidden />
      <span>{v.label}</span>
      {variant === 'pill' && status === 'connected' && lastMessageAt && (
        <span className="text-[var(--text-muted)]">· {formatRelativeTime(lastMessageAt)}</span>
      )}
    </span>
  )
}
