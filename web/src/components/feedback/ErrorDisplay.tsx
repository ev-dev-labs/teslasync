import {
  StatusAwareError,
  type StatusAwareErrorProps,
} from './_StatusAwareError'

export type ErrorDisplayProps = StatusAwareErrorProps

/**
 * Status-aware recovery surface for mutation and imperative request failures.
 * Supports the same classification as QueryError plus compact inline chrome.
 */
export function ErrorDisplay(props: ErrorDisplayProps) {
  return <StatusAwareError {...props} />
}
