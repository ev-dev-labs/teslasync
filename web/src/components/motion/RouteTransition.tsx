import { AnimatePresence, motion } from 'framer-motion'
import { type ReactNode, useRef } from 'react'
import { matchPath, useLocation } from 'react-router-dom'
import { useMotionPreference } from '@/hooks/useMotionPreference'

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
 * Cross-fades the route content on `pathname` change. Designed to be wrapped
 * around `<Outlet />` inside the layout so the chrome (sidebar, header) does
 * not animate alongside the page body.
 *
 * Behaviour:
 *   - 120ms ease-out fade + 4px y-translate. Subtle enough to feel polished
 *     without slowing the user down.
 *   - `mode="wait"` ensures the outgoing page unmounts before the incoming
 *     mounts so two pages are never visually layered. The next page's
 *     `useEffect`s fire ~120ms later than they otherwise would, which is
 *     within the Suspense fallback budget.
 *   - `initial={false}` skips the entry animation on the very first render
 *     so we don't flash on cold page load.
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

  const prevPath = prevPathRef.current
  const newPath = location.pathname

  const matchesSkip = (pathname: string): boolean =>
    skipPattern.some((pattern) => matchPath({ path: pattern, end: true }, pathname) != null)

  const skipForList = matchesSkip(prevPath) || matchesSkip(newPath)
  const effectiveDurationMs = reduce || skipForList ? 0 : durationMs

  // Track the previous path AFTER computing skipForList so the next render
  // sees the correct prev. Using a ref (not state) avoids an extra re-render.
  prevPathRef.current = newPath

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={newPath}
        initial={reduce || skipForList ? false : { opacity: 0, y: 4 }}
        animate={reduce || skipForList ? { opacity: 1, y: 0 } : { opacity: 1, y: 0 }}
        exit={reduce || skipForList ? { opacity: 1, y: 0 } : { opacity: 0, y: -4 }}
        transition={{ duration: effectiveDurationMs / 1000, ease: 'easeOut' }}
        style={{ minHeight: '100%' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
