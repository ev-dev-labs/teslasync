import { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw, Home, WifiOff } from 'lucide-react'
import i18n from 'i18next'
import { Button } from '../ui/Button'
import { reportFrontendError } from '@/lib/errorReporter'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  /** If true, show a more compact inline error instead of full-page */
  inline?: boolean
  /** Optional name for logging which boundary caught the error */
  name?: string
  /**
   * When this value changes between renders, the boundary clears any
   * captured error and re-renders children. Pass `useLocation().pathname`
   * to auto-reset on route change without unmounting/remounting.
   */
  resetKey?: string | number
}

interface State {
  hasError: boolean
  error: Error | null
  retryCount: number
  lastResetKey: string | number | undefined
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      retryCount: 0,
      lastResetKey: props.resetKey,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  static getDerivedStateFromProps(nextProps: Props, prevState: State): Partial<State> | null {
    if (nextProps.resetKey === prevState.lastResetKey) {
      return null
    }
    if (prevState.hasError) {
      return {
        hasError: false,
        error: null,
        lastResetKey: nextProps.resetKey,
      }
    }
    return { lastResetKey: nextProps.resetKey }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Phase 46 / Prompt 01: forward the captured error to the central
    // reporter BEFORE any recovery logic so it ships even if the
    // chunk-load reload below succeeds (and tears down the page).
    reportFrontendError(error, 'react')

    // Log structured error for observability
    console.error(`[ErrorBoundary${this.props.name ? `:${this.props.name}` : ''}]`, {
      error: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
      retryCount: this.state.retryCount,
    })

    // Phase-45 / Prompt 11 — Stale-chunk recovery.
    //
    // A ChunkLoadError almost always means the server has redeployed and the
    // hashed asset the SPA tried to fetch no longer exists. The default
    // user-friendly path is the proactive <NewVersionBanner /> mounted in
    // the global Layout: it polls /system/version and offers an explicit
    // Reload affordance well before any chunk fails.
    //
    // If the boundary has nonetheless caught a chunk error (banner not yet
    // surfaced, or user dismissed it and then navigated to a stale route)
    // we still want a safety net so the user is not stuck on the fallback
    // forever. Wait 5 s — long enough for the banner to render and for the
    // user to click Reload themselves — then force a hard reload, throttled
    // to once per 60 s per tab to defeat reload loops on a server that is
    // actually broken (not just newly deployed).
    if (this.isChunkLoadError(error)) {
      const reloadKey = 'teslasync-chunk-reload'
      try {
        const lastReload = sessionStorage.getItem(reloadKey)
        const now = Date.now()
        if (!lastReload || now - Number(lastReload) > 60_000) {
          sessionStorage.setItem(reloadKey, String(now))
          window.setTimeout(() => {
            // Re-check after the grace period — the user may have already
            // clicked Reload in the banner, retried the boundary, or
            // navigated to a fresh route, in which case we MUST NOT yank
            // them back to a hard refresh.
            if (this.state.hasError) {
              console.warn(
                '[ErrorBoundary] Chunk load error not user-resolved within 5 s — forcing reload',
              )
              window.location.reload()
            }
          }, 5_000)
        }
      } catch {
        // sessionStorage may throw in private mode / Safari quotas — fall
        // through to the rendered fallback; the banner remains the primary
        // recovery path.
      }
    }
  }

  private isChunkLoadError(error: Error): boolean {
    const msg = error.message?.toLowerCase() ?? ''
    return (
      error.name === 'ChunkLoadError' ||
      msg.includes('loading chunk') ||
      msg.includes('loading css chunk') ||
      msg.includes('dynamically imported module') ||
      msg.includes('failed to fetch dynamically imported module')
    )
  }

  handleRetry = () => {
    // For chunk errors, do a full page reload to get new assets
    if (this.state.error && this.isChunkLoadError(this.state.error)) {
      window.location.reload()
      return
    }
    this.setState(prev => ({
      hasError: false,
      error: null,
      retryCount: prev.retryCount + 1,
    }))
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      const isNetworkError =
        this.state.error?.message?.includes('fetch') ||
        this.state.error?.message?.includes('network') ||
        this.state.error?.message?.includes('offline') ||
        this.state.error?.message?.includes('Failed to fetch')

      const isChunkError = this.state.error ? this.isChunkLoadError(this.state.error) : false

      const tooManyRetries = this.state.retryCount >= 3

      if (this.props.inline) {
        return (
          <div className="flex items-center gap-3 rounded-xl border border-tesla-red/20 bg-tesla-red/5 p-4">
            <AlertTriangle className="h-5 w-5 text-tesla-red shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--text-secondary)]">Component failed to load</p>
              <p className="text-xs text-[var(--text-muted)] truncate">{this.state.error?.message}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={this.handleRetry} className="shrink-0">
              <RefreshCw className="h-3 w-3" /> Retry
            </Button>
          </div>
        )
      }

      return (
        <div className="flex items-center justify-center min-h-[400px] p-8">
          <div className="text-center max-w-md">
            <div className="mx-auto mb-6 rounded-2xl bg-tesla-red/10 p-5 ring-1 ring-tesla-red/20 w-fit">
              {isNetworkError ? (
                <WifiOff className="h-10 w-10 text-tesla-red" />
              ) : (
                <AlertTriangle className="h-10 w-10 text-tesla-red" />
              )}
            </div>
            <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">
              {isChunkError ? 'New Version Deployed' : isNetworkError ? 'Connection Lost' : 'Something went wrong'}
            </h2>
            <p className="text-sm text-[var(--text-secondary)] mb-2">
              {isChunkError
                ? i18n.t('error.chunkLoad.body', 'A new version was deployed. Click Reload to load the latest assets.')
                : isNetworkError
                ? 'Unable to reach the server. Check your connection and try again.'
                : this.state.error?.message || 'An unexpected error occurred. Please try again.'}
            </p>
            {tooManyRetries && (
              <p className="text-xs text-[var(--text-muted)] mb-4">
                Multiple retries failed. Try refreshing the page or checking system status.
              </p>
            )}
            <div className="flex items-center justify-center gap-3 mt-6">
              <Button
                onClick={this.handleRetry}
                variant="primary"
              >
                <RefreshCw className="h-4 w-4" />
                {tooManyRetries ? 'Try Again Anyway' : 'Try Again'}
              </Button>
              <Button variant="secondary" onClick={() => { window.location.href = '/' }}>
                <Home className="h-4 w-4" />
                Go Home
              </Button>
            </div>
            {this.state.retryCount > 0 && (
              <p className="mt-4 text-[10px] text-[var(--text-muted)]">
                Retry attempt {this.state.retryCount}
              </p>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
