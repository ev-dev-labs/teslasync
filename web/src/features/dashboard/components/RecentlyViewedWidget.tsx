/**
 * Recently viewed widget.
 *
 * Lightweight "back to where I was" surface for the dashboard. Renders
 * the top {@link RECENT_PAGES_DISPLAY_LIMIT} entries from the
 * client-side `recentPages` store as a list of clickable links. Updates
 * live via `subscribeRecentPages` so navigating in another tab (or
 * elsewhere in this tab) refreshes the panel without a hard reload.
 *
 * The widget is intentionally additive — empty-state shows a
 * non-actionable placeholder rather than a CTA, because the "action"
 * (visit a page) is the rest of the app. The audit-empty-state script
 * forbids cta-less EmptyState usage in feature pages, so we render a
 * plain panel with a `<p>` hint instead.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  BatteryCharging,
  CalendarDays,
  Car,
  Clock,
  Compass,
  FileText,
  MapPinned,
  Route,
} from 'lucide-react'
import { GlassPanel } from '@/components/ui/GlassPanel'
import {
  getRecentPages,
  subscribeRecentPages,
  type RecentEntry,
  type RecentPageKind,
} from '@/lib/recentPages'

const RECENT_PAGES_DISPLAY_LIMIT = 5

function iconForKind(kind: RecentPageKind): React.ReactNode {
  switch (kind) {
    case 'vehicle':
      return <Car className="h-3.5 w-3.5" />
    case 'drive':
      return <Route className="h-3.5 w-3.5" />
    case 'charging':
      return <BatteryCharging className="h-3.5 w-3.5" />
    case 'trip':
      return <Compass className="h-3.5 w-3.5" />
    case 'geofence':
      return <MapPinned className="h-3.5 w-3.5" />
    case 'year-review':
      return <CalendarDays className="h-3.5 w-3.5" />
    default:
      return <FileText className="h-3.5 w-3.5" />
  }
}function formatRelative(
  visitedAt: number,
  now: number,
  t: TFunction,
): string {
  const diffMs = Math.max(0, now - visitedAt)
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return t('recentPages.justNow', 'Just now')
  if (min < 60) return `${min}${t('recentPages.shortMinute', 'm')}`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}${t('recentPages.shortHour', 'h')}`
  const day = Math.floor(hr / 24)
  return `${day}${t('recentPages.shortDay', 'd')}`
}

/** Subscribes to the recent-pages store and re-renders on changes. */
function useRecentPages(limit: number): RecentEntry[] {
  const [entries, setEntries] = useState<RecentEntry[]>(() =>
    getRecentPages(limit),
  )
  useEffect(() => {
    setEntries(getRecentPages(limit))
    return subscribeRecentPages(() => setEntries(getRecentPages(limit)))
  }, [limit])
  return entries
}

export interface RecentlyViewedWidgetProps {
  /**
   * Optional override of the visit cap shown. Defaults to
   * {@link RECENT_PAGES_DISPLAY_LIMIT}. Useful for embedding this widget
   * elsewhere with a different visual budget.
   */
  limit?: number
  /** Optional className passthrough for the outer panel. */
  className?: string
}

export function RecentlyViewedWidget({
  limit = RECENT_PAGES_DISPLAY_LIMIT,
  className,
}: RecentlyViewedWidgetProps = {}) {
  const { t } = useTranslation()
  const entries = useRecentPages(limit)
  const now = Date.now()

  return (
    <GlassPanel
      className={className ?? 'p-4'}
      data-testid="recently-viewed-widget"
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="section-title flex items-center gap-2">
          <Clock className="h-4 w-4 text-cyan-300" />
          {t('recentPages.widgetTitle', 'Recently Viewed')}
        </h3>
      </div>
      {entries.length === 0 ? (
        <p
          className="text-xs text-[var(--text-muted)] py-3 text-center"
          data-testid="recently-viewed-empty"
        >
          {t(
            'recentPages.empty',
            'Pages you visit will appear here for quick access.',
          )}
        </p>
      ) : (
        // Responsive grid: 1 col on narrow viewports, 2 col ≥sm, 3 col ≥lg.
        // Cuts widget height to ~⅓ on the dashboard's typical wide layout
        // without changing per-row content. Each row drops the icon-chip
        // background and uses tighter padding so individual entries no
        // longer feel like primary navigation tiles.
        <ul
          className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="recently-viewed-list"
        >
          {entries.map((entry) => (
            <li key={entry.path}>
              <Link
                to={entry.path}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
                data-testid={`recently-viewed-row-${entry.path}`}
              >
                <span
                  className="flex-shrink-0 text-cyan-300"
                  aria-hidden="true"
                >
                  {iconForKind(entry.kind)}
                </span>
                <span className="flex-1 min-w-0 truncate font-medium">
                  {entry.title}
                </span>
                <span className="flex-shrink-0 text-[10px] tabular-nums text-[var(--text-muted)]">
                  {formatRelative(entry.visited_at, now, t)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  )
}

export default RecentlyViewedWidget
