import { useCallback, useEffect, useRef } from 'react'
import type { MouseEvent, FocusEvent, PointerEvent } from 'react'
import type { LinkProps, NavLinkProps } from 'react-router-dom'
import { GuardedLink, GuardedNavLink } from '../feedback/GuardedLink'
import { prefetchRoute, schedulePrefetch } from '@/lib/routePrefetch'

/**
 * Route-prefetching navigation link.
 *
 * Wraps {@link GuardedLink} (so the unsaved-changes navigation guard is
 * preserved) and additionally warms the destination's lazy chunk the moment
 * the user looks like they might navigate, so the actual click resolves to a
 * cached chunk and renders instantly.
 *
 * Intent signals, by input modality
 * ---------------------------------
 * - **mouse / keyboard** — `mouseenter` and `focus` are unambiguous intent,
 *   so the chunk download starts immediately.
 * - **touch / pen** — there is no hover. `pointerdown` is the only pre-click
 *   signal, but a pointerdown that becomes a scroll, long-press, or drag is
 *   NOT navigation intent. We therefore *schedule* the prefetch and cancel it
 *   on `pointerup`, `pointercancel`, or `pointerleave`, so a flick-scroll past
 *   a list of links does not fan out into a burst of chunk downloads.
 *
 * Cancellation clears the pending timer before the dynamic import begins, so
 * a cancelled intent can never resolve late and apply a stale update. Any
 * still-pending intent is also cancelled on unmount.
 *
 * All prefetching additionally respects the user's Data Saver preference and
 * 2G-class connections via `shouldPrefetchRoutes()` in `lib/routePrefetch`.
 *
 * Use this component for in-app navigation in shared chrome (sidebar,
 * bottom tab bar, breadcrumbs, etc.) instead of `<Link>`, `<NavLink>`,
 * `<GuardedLink>`, or `<GuardedNavLink>`. The `auditPrefetchLink` lint
 * gate enforces this for the layout primitives.
 *
 * Modifier-clicks (open-in-new-tab) and `target="_blank"` work as usual:
 * the underlying `<GuardedLink>` already passes them through to the
 * browser without intercepting.
 *
 * NOTE: deliberately not `forwardRef`: the underlying `GuardedLink` is
 * a plain function component that does not forward refs, so accepting a
 * ref here would silently drop it. None of the current call sites
 * require an `<a>` ref.
 */
export type PrefetchLinkProps = LinkProps
export type PrefetchNavLinkProps = NavLinkProps

function pathFromTo(to: LinkProps['to']): string {
  if (typeof to === 'string') return to
  return to?.pathname ?? ''
}

/** Shared intent wiring for both link variants. */
function usePrefetchIntent(path: string) {
  const cancelRef = useRef<(() => void) | null>(null)

  const cancelPending = useCallback(() => {
    cancelRef.current?.()
    cancelRef.current = null
  }, [])

  // A pending touch intent must not outlive the element that started it.
  useEffect(() => cancelPending, [cancelPending])

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLAnchorElement>) => {
      cancelPending()
      // Mouse already prefetched on `mouseenter`; re-scheduling would only
      // add latency. Touch and pen get the debounced path.
      if (event.pointerType === 'mouse') {
        prefetchRoute(path)
        return
      }
      cancelRef.current = schedulePrefetch(path)
    },
    [cancelPending, path],
  )

  return { cancelPending, onPointerDown }
}

export function PrefetchLink({
  to,
  onMouseEnter,
  onFocus,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  ...rest
}: PrefetchLinkProps) {
  const path = pathFromTo(to)
  const intent = usePrefetchIntent(path)
  return (
    <GuardedLink
      to={to}
      {...rest}
      onMouseEnter={(e: MouseEvent<HTMLAnchorElement>) => {
        prefetchRoute(path)
        onMouseEnter?.(e)
      }}
      onFocus={(e: FocusEvent<HTMLAnchorElement>) => {
        prefetchRoute(path)
        onFocus?.(e)
      }}
      onPointerDown={(e: PointerEvent<HTMLAnchorElement>) => {
        intent.onPointerDown(e)
        onPointerDown?.(e)
      }}
      onPointerUp={(e: PointerEvent<HTMLAnchorElement>) => {
        intent.cancelPending()
        onPointerUp?.(e)
      }}
      onPointerCancel={(e: PointerEvent<HTMLAnchorElement>) => {
        intent.cancelPending()
        onPointerCancel?.(e)
      }}
      onPointerLeave={(e: PointerEvent<HTMLAnchorElement>) => {
        intent.cancelPending()
        onPointerLeave?.(e)
      }}
    />
  )
}

/** Active-state variant of {@link PrefetchLink} for primary navigation. */
export function PrefetchNavLink({
  to,
  onMouseEnter,
  onFocus,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  ...rest
}: PrefetchNavLinkProps) {
  const path = pathFromTo(to)
  const intent = usePrefetchIntent(path)
  return (
    <GuardedNavLink
      to={to}
      {...rest}
      onMouseEnter={(e: MouseEvent<HTMLAnchorElement>) => {
        prefetchRoute(path)
        onMouseEnter?.(e)
      }}
      onFocus={(e: FocusEvent<HTMLAnchorElement>) => {
        prefetchRoute(path)
        onFocus?.(e)
      }}
      onPointerDown={(e: PointerEvent<HTMLAnchorElement>) => {
        intent.onPointerDown(e)
        onPointerDown?.(e)
      }}
      onPointerUp={(e: PointerEvent<HTMLAnchorElement>) => {
        intent.cancelPending()
        onPointerUp?.(e)
      }}
      onPointerCancel={(e: PointerEvent<HTMLAnchorElement>) => {
        intent.cancelPending()
        onPointerCancel?.(e)
      }}
      onPointerLeave={(e: PointerEvent<HTMLAnchorElement>) => {
        intent.cancelPending()
        onPointerLeave?.(e)
      }}
    />
  )
}
