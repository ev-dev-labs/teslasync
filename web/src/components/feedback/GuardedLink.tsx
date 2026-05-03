import type { MouseEvent } from 'react'
import { Link, NavLink, useNavigate, type LinkProps, type NavLinkProps } from 'react-router-dom'
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
  const navigate = useNavigate()
  const { confirmIfDirty } = useNavigationGuardContext()
  return (
    <Link
      to={to}
      replace={replace}
      state={state}
      relative={relative}
      target={target}
      {...rest}
      onClick={async (e) => {
        if (onClick) onClick(e)
        if (e.defaultPrevented) return
        if (shouldSkipGuard(e, target)) return
        e.preventDefault()
        const ok = await confirmIfDirty()
        if (ok) navigate(to, { replace, state, relative })
      }}
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
  const navigate = useNavigate()
  const { confirmIfDirty } = useNavigationGuardContext()
  return (
    <NavLink
      to={to}
      replace={replace}
      state={state}
      relative={relative}
      target={target}
      {...rest}
      onClick={async (e) => {
        if (onClick) onClick(e)
        if (e.defaultPrevented) return
        if (shouldSkipGuard(e, target)) return
        e.preventDefault()
        const ok = await confirmIfDirty()
        if (ok) navigate(to, { replace, state, relative })
      }}
    >
      {children}
    </NavLink>
  )
}
