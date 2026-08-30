import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportFrontendError } from '@/lib/errorReporter'

interface OptionalSurfaceBoundaryProps {
  children: ReactNode
  /** Name used for log correlation, e.g. "AchievementCelebration". */
  name: string
}

interface OptionalSurfaceBoundaryState {
  failed: boolean
}

/**
 * Error boundary for a surface the application does not need.
 *
 * The shared {@link ErrorBoundary} is deliberately unsuitable here, in two
 * ways that both matter for an optional lazy surface:
 *
 * 1. **It force-reloads the page on a chunk error.** `componentDidCatch`
 *    schedules `window.location.reload()` five seconds after a
 *    `ChunkLoadError`. That is correct for a route the user asked for and
 *    cannot see — it is not correct for a celebration toast. A user mid-form
 *    would lose their work because a decorative chunk 404'd after a deploy.
 * 2. **`fallback={null}` does not render null.** `ErrorBoundary` checks
 *    `if (this.props.fallback)`, so a `null` fallback is falsy and the full
 *    error card renders anyway. `SectionErrorBoundary` forwards `null`
 *    straight into that same truthiness check, so it cannot express "render
 *    nothing" either.
 *
 * This boundary therefore: renders `null`, never reloads, never shows UI, and
 * reports once so the failure is still observable. It must only wrap content
 * whose absence is invisible to the user's task.
 *
 * State is sticky on purpose. `React.lazy` memoises a rejected import
 * permanently, so re-rendering the child after a chunk failure just replays
 * the same rejection; retrying would produce a failed request per event with
 * no possible recovery until the page reloads on its own terms.
 */
export class OptionalSurfaceBoundary extends Component<
  OptionalSurfaceBoundaryProps,
  OptionalSurfaceBoundaryState
> {
  state: OptionalSurfaceBoundaryState = { failed: false }

  static getDerivedStateFromError(): OptionalSurfaceBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Observability without user-facing noise. The reporter is a no-op outside
    // production and coalesces repeats, and this boundary only reports once
    // per instance because `failed` never resets.
    reportFrontendError(error, 'react')
    console.warn(
      `[OptionalSurfaceBoundary:${this.props.name}] optional surface suppressed`,
      { error: error.message, componentStack: info.componentStack },
    )
  }

  render() {
    if (this.state.failed) return null
    return this.props.children
  }
}
