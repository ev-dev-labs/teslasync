import {
  StatusAwareError,
  type StatusAwareErrorProps,
} from './_StatusAwareError'

export type QueryErrorProps = StatusAwareErrorProps

/**
 * Status-aware recovery surface for failed data queries.
 *
 * The shared classifier distinguishes authentication, permission, timeout,
 * unsupported, unavailable, server, request, offline, and network failures.
 */
export function QueryError(props: QueryErrorProps) {
  return <StatusAwareError {...props} />
}
