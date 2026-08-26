import type { MouseEvent, FocusEvent, PointerEvent } from 'react'
import type { LinkProps, NavLinkProps } from 'react-router-dom'
import { GuardedLink, GuardedNavLink } from '../feedback/GuardedLink'
import { prefetchRoute } from '@/lib/routePrefetch'

/**
 * Route-prefetching navigation link.
 *
 * Wraps {@link GuardedLink} (so the unsaved-changes navigation guard is
 * preserved) and additionally calls {@link prefetchRoute} on `mouseenter`
 * / `focus` / `pointerdown`. The lazy chunk for the destination route is eagerly fetched
 * the moment the user looks like they might navigate, so the actual
 * click resolves to a cached chunk and renders instantly.
 *
 * Use this component for in-app navigation in shared chrome (sidebar,
 * bottom tab bar, breadcrumbs, etc.) instead of `<Link>`, `<NavLink>`,
 * `<GuardedLink>`, or `<GuardedNavLink>`. The `auditPrefetchLink` lint
 * gate enforces this for the layout primitives.
 *
 * Modifier-clicks (open-in-new-tab) and `target="_blank"` work as usual:
 * the underlying `<GuardedLink>` already passes them through to the
 * browser without intercepting; prefetch is a side-effect on hover, not
 * on click, so it's harmless either way.
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

export function PrefetchLink({
  to,
  onMouseEnter,
  onFocus,
  onPointerDown,
  ...rest
}: PrefetchLinkProps) {
  const path = pathFromTo(to)
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
        prefetchRoute(path)
        onPointerDown?.(e)
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
  ...rest
}: PrefetchNavLinkProps) {
  const path = pathFromTo(to)
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
        prefetchRoute(path)
        onPointerDown?.(e)
      }}
    />
  )
}
