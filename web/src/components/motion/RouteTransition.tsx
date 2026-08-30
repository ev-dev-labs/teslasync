import { motion } from 'framer-motion'
import { type ReactNode, useRef } from 'react'
import { matchPath, useLocation } from 'react-router-dom'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { ROUTE_FOCUS_SCOPE_ATTR } from '@/lib/routeFocus'

/**
 * Route patterns where the page-transition cross-fade is suppressed. Drilling
 * from a list (`/drives`) into a detail (`/drives/123`) — and back out — feels
 * better when it is near-instant. Animating those transitions makes the UI
 * feel sluggish even at 120ms because the user is mentally focused on the same
 * content (a row → its expanded view).
 *
 * The check fires when EITHER the previous or current pathname matches any of
 * these patterns, so back-navigation (POP) is also skipped.
 *
 * Order does not matter — the first match wins.
 */
const DEFAULT_SKIP_PATTERNS: readonly string[] = [
  '/drives/:id',
  '/drives/:id/replay',
  '/charging/:id',
  '/vehicles/:id',
  '/vehicles/:id/access',
  '/trips/:id',
]

export interface RouteTransitionProps {
  children: ReactNode
  /**
   * Override the default list of route patterns that should NOT animate. When
   * either the previous or new pathname matches a pattern, the cross-fade is
   * suppressed for that navigation.
   *
   * Patterns use react-router v6 syntax (passed to `matchPath`).
   */
  skipPattern?: readonly string[]
}

/**
 * Adds a subtle entrance treatment on `pathname` change. Designed to be wrapped
 * around `<Outlet />` inside the layout so the chrome (sidebar, header) does
 * not animate alongside the page body.
 *
 * Behaviour:
 *   - 120ms ease-out fade + 4px y-translate. Subtle enough to feel polished
 *     without slowing the user down.
 *   - The next route mounts immediately. There is no exit animation delaying
 *     lazy-chunk evaluation or the destination page's data queries.
 *   - Re-keyed by `location.pathname` only — query/search/hash changes
 *     (filters, sort, anchors) never trigger a re-fade.
 *   - Honours `prefers-reduced-motion` via `useMotionPreference`. When the
 *     user has requested reduced motion, the fade collapses to a no-op.
 *   - List-detail navigations (`/drives` ↔ `/drives/:id`, etc.) skip the
 *     animation entirely so the drill-in / drill-back-out feel snappy.
 */
export function RouteTransition({ children, skipPattern = DEFAULT_SKIP_PATTERNS }: RouteTransitionProps) {
  const location = useLocation()
  const { reduce, durationMs } = useMotionPreference(120)
  const prevPathRef = useRef<string>(location.pathname)
  const hasMountedRef = useRef(false)

  const prevPath = prevPathRef.current
  const newPath = location.pathname

  const matchesSkip = (pathname: string): boolean =>
    skipPattern.some((pattern) => matchPath({ path: pattern, end: true }, pathname) != null)

  const skipForList = matchesSkip(prevPath) || matchesSkip(newPath)
  const effectiveDurationMs = reduce || skipForList ? 0 : durationMs
  const animateEntry = hasMountedRef.current && !reduce && !skipForList

  // Track the previous path AFTER computing skipForList so the next render
  // sees the correct prev. Using a ref (not state) avoids an extra re-render.
  prevPathRef.current = newPath
  hasMountedRef.current = true

  return (
    <motion.div
      key={newPath}
      {...{ [ROUTE_FOCUS_SCOPE_ATTR]: newPath }}
      initial={animateEntry ? { opacity: 0, y: 4 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: effectiveDurationMs / 1000, ease: 'easeOut' }}
      className="min-h-full"
    >
      {children}
    </motion.div>
  )
}
