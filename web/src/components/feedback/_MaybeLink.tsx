import { forwardRef } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'

/**
 * A `<Link>` that degrades to a plain anchor outside a Router.
 *
 * The shared feedback surfaces — `<QueryError>`, `<RequiresAuth>`,
 * `<DataStateNotice>` — are rendered from places that legitimately have no
 * router context: dashboard widgets under an isolated error boundary, unit
 * tests that mount a single component, and the top-level `<ErrorBoundary>`
 * that catches a crash in the router itself.
 *
 * `<Link>` throws in all three ("Cannot destructure property 'basename' of
 * null"), which turns a helpful recovery link into a second, worse crash. A
 * shared error surface must be the most robust component in the app, not the
 * most demanding one, so it detects the context and falls back to a full-page
 * anchor. Same destination, one extra navigation.
 */
export interface MaybeLinkProps {
  to: string
  className?: string
  children: React.ReactNode
  onClick?: () => void
  'data-testid'?: string
  'data-error-help-link'?: string
}

export const MaybeLink = forwardRef<HTMLAnchorElement, MaybeLinkProps>(
  function MaybeLink({ to, children, ...rest }, ref) {
    // Hook order is stable: `useInRouterContext` is called unconditionally on
    // every render, and only the returned JSX branches.
    const inRouter = useInRouterContext()

    if (inRouter) {
      return (
        <Link ref={ref} to={to} {...rest}>
          {children}
        </Link>
      )
    }
    return (
      <a ref={ref} href={to} {...rest}>
        {children}
      </a>
    )
  },
)
