import type { HTMLAttributeAnchorTarget, MouseEvent, MouseEventHandler } from 'react'
import {
  Link,
  NavLink,
  useNavigate,
  type LinkProps,
  type NavLinkProps,
  type RelativeRoutingType,
  type To,
} from 'react-router-dom'
import { useNavigationGuardContext } from './NavigationGuardProvider'

/**
 * Modifier-clicks (open in new tab/window) and middle-clicks bypass SPA
 * navigation entirely — the browser handles them natively. Skipping the
 * guard here is intentional: the dirty form stays mounted in the current
 * tab, no work is lost.
 */
function shouldSkipGuard(e: MouseEvent<HTMLAnchorElement>, target?: string): boolean {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return true
  if (e.button !== 0) return true
  if (target && target !== '' && target !== '_self') return true
  return false
}

/** Navigation-affecting subset of `<Link>` / `<NavLink>` props the guard forwards. */
interface GuardedNavConfig {
  onClick?: MouseEventHandler<HTMLAnchorElement>
  replace?: boolean
  state?: unknown
  relative?: RelativeRoutingType
  target?: HTMLAttributeAnchorTarget
}

/**
 * Shared click handler for {@link GuardedLink} and {@link GuardedNavLink}.
 *
 * Runs the caller's `onClick` first (so it can `preventDefault()` and take
 * over), bails out for native modifier / middle / new-tab clicks, then — for
 * a plain in-app click — suppresses the browser default and defers the actual
 * SPA navigation until the global unsaved-changes guard resolves.
 *
 * Returns a synchronous `void` handler (React's expected `onClick` shape); the
 * async confirm→navigate work is fired-and-tracked internally so a rejected
 * guard simply leaves the current route mounted.
 */
function useGuardedLinkClick(
  to: To,
  { onClick, replace, state, relative, target }: GuardedNavConfig,
): MouseEventHandler<HTMLAnchorElement> {
  const navigate = useNavigate()
  const { confirmIfDirty } = useNavigationGuardContext()
  return (e) => {
    onClick?.(e)
    if (e.defaultPrevented) return
    if (shouldSkipGuard(e, target)) return
    e.preventDefault()
    void confirmIfDirty().then((ok) => {
      if (ok) navigate(to, { replace, state, relative })
    })
  }
}

/**
 * Drop-in replacement for `react-router-dom`'s `<Link>` that prompts the
 * user when any registered {@link useNavigationGuard} reports dirty before
 * navigating. Cancels navigation if the user chooses "Keep editing".
 *
 * Preserves `replace`, `state`, `relative`, and `target` semantics; bails
 * out for modifier / middle clicks and `target="_blank"` so opening in a
 * new tab still works.
 */
export function GuardedLink({ to, onClick, children, replace, state, relative, target, ...rest }: LinkProps) {
  const handleClick = useGuardedLinkClick(to, { onClick, replace, state, relative, target })
  return (
    <Link
      to={to}
      replace={replace}
      state={state}
      relative={relative}
      target={target}
      {...rest}
      onClick={handleClick}
    >
      {children}
    </Link>
  )
}

/**
 * Drop-in replacement for `react-router-dom`'s `<NavLink>` (the
 * active-styling variant of `<Link>`). Same guard semantics as
 * {@link GuardedLink}; preserves `<NavLink>`'s function-as-children and
 * function-as-className API.
 */
export function GuardedNavLink({ to, onClick, children, replace, state, relative, target, ...rest }: NavLinkProps) {
  const handleClick = useGuardedLinkClick(to, { onClick, replace, state, relative, target })
  return (
    <NavLink
      to={to}
      replace={replace}
      state={state}
      relative={relative}
      target={target}
      {...rest}
      onClick={handleClick}
    >
      {children}
    </NavLink>
  )
}
