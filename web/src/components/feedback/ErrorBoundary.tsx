import { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw, Home, WifiOff } from 'lucide-react'
import i18n from 'i18next'
import { Button } from '../ui/Button'
import { Heading, Text } from '../ui/Typography'
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
    // Forward the captured error to the central reporter BEFORE any
    // recovery logic so it ships even if the
    // chunk-load reload below succeeds (and tears down the page).
    reportFrontendError(error, 'react')

    // Log structured error for observability
    console.error(`[ErrorBoundary${this.props.name ? `:${this.props.name}` : ''}]`, {
      error: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
      retryCount: this.state.retryCount,
    })

    // Stale-chunk recovery.
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
          <div className="flex flex-wrap items-center gap-3 rounded-shape-md border border-[var(--semantic-danger-border)] bg-[var(--semantic-danger-bg)] p-4">
            <AlertTriangle className="h-5 w-5 text-[var(--semantic-danger)] shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <Text as="p" variant="bodySm">
                {i18n.t('errorBoundary.inlineTitle', 'Component failed to load')}
              </Text>
              <Text as="p" variant="caption" className="whitespace-pre-wrap break-words">{this.state.error?.message}</Text>
            </div>
            <Button variant="secondary" size="sm" wrapLabel onClick={this.handleRetry} className="shrink-0 max-md:min-h-11">
              <RefreshCw className="h-3 w-3 shrink-0" aria-hidden="true" /> {i18n.t('errorBoundary.retry', 'Retry')}
            </Button>
          </div>
        )
      }

      return (
        <div className="flex items-center justify-center min-h-error-fallback p-8">
          <div className="text-center max-w-md min-w-0">
            <div className="mx-auto mb-6 rounded-shape-md bg-[var(--semantic-danger-bg)] p-5 border border-[var(--semantic-danger-border)] w-fit">
              {isNetworkError ? (
                <WifiOff className="h-10 w-10 text-[var(--semantic-danger)]" aria-hidden="true" />
              ) : (
                <AlertTriangle className="h-10 w-10 text-[var(--semantic-danger)]" aria-hidden="true" />
              )}
            </div>
            <Heading level="section" className="mb-2 break-words">
              {isChunkError
                ? i18n.t('errorBoundary.chunkTitle', 'New Version Deployed')
                : isNetworkError
                ? i18n.t('errorBoundary.connectionTitle', 'Connection Lost')
                : i18n.t('errorBoundary.title', 'Something went wrong')}
            </Heading>
            <Text as="p" variant="bodySm" className="mb-2 whitespace-pre-wrap break-words">
              {isChunkError
                ? i18n.t('errorBoundary.chunkBody', 'A new version was deployed. Click Reload to load the latest assets.')
                : isNetworkError
                ? i18n.t('errorBoundary.connectionBody', 'Unable to reach the server. Check your connection and try again.')
                : this.state.error?.message || i18n.t('errorBoundary.body', 'An unexpected error occurred. Please try again.')}
            </Text>
            {tooManyRetries && (
              <Text as="p" variant="caption" className="mb-4 break-words">
                {i18n.t('errorBoundary.retriesExceeded', 'Multiple retries failed. Try refreshing the page or checking system status.')}
              </Text>
            )}
            <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
              <Button
                onClick={this.handleRetry}
                variant="primary"
                wrapLabel
                className="max-md:min-h-11"
              >
                <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
                {tooManyRetries
                  ? i18n.t('errorBoundary.tryAgainAnyway', 'Try Again Anyway')
                  : i18n.t('errorBoundary.tryAgain', 'Try Again')}
              </Button>
              <Button variant="secondary" wrapLabel className="max-md:min-h-11" onClick={() => { window.location.href = '/' }}>
                <Home className="h-4 w-4 shrink-0" aria-hidden="true" />
                {i18n.t('errorBoundary.goHome', 'Go Home')}
              </Button>
            </div>
            {this.state.retryCount > 0 && (
              <Text as="p" variant="caption" className="mt-4 break-words">
                {i18n.t('errorBoundary.retryAttempt', { count: this.state.retryCount, defaultValue: 'Retry attempt {{count}}' })}
              </Text>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
