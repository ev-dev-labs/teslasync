import { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw, Home, WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { reportFrontendError } from '@/lib/errorReporter'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  inline?: boolean
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

const CHUNK_RELOAD_KEY = 'teslasync-chunk-reload'
const CHUNK_RELOAD_THROTTLE_MS = 60_000
const CHUNK_RELOAD_GRACE_MS = 5_000

function isChunkLoadError(error: Error): boolean {
  const msg = error.message?.toLowerCase() ?? ''
  return (
    error.name === 'ChunkLoadError' ||
    msg.includes('loading chunk') ||
    msg.includes('loading css chunk') ||
    msg.includes('dynamically imported module') ||
    msg.includes('failed to fetch dynamically imported module')
  )
}

function isNetworkError(error: Error | null): boolean {
  const msg = error?.message ?? ''
  return (
    msg.includes('fetch') ||
    msg.includes('network') ||
    msg.includes('offline') ||
    msg.includes('Failed to fetch')
  )
}

interface FallbackProps {
  error: Error | null
  retryCount: number
  inline: boolean
  onRetry: () => void
}

// Functional render — all user-facing strings flow through useTranslation()
// so language changes immediately re-render the fallback. The class shell
// below exists only because React's error-boundary lifecycle hooks
// (getDerivedStateFromError, componentDidCatch) are class-only.
function ErrorBoundaryFallback({ error, retryCount, inline, onRetry }: FallbackProps) {
  const { t } = useTranslation()
  const network = isNetworkError(error)
  const chunk = error ? isChunkLoadError(error) : false
  const tooManyRetries = retryCount >= 3

  if (inline) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-tesla-red/20 bg-tesla-red/5 p-4">
        <AlertTriangle className="h-5 w-5 text-tesla-red shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--text-secondary)]">
            {t('error.boundary.inlineTitle', 'Component failed to load')}
          </p>
          <p className="text-xs text-[var(--text-muted)] truncate">{error?.message}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onRetry} className="shrink-0">
          <RefreshCw className="h-3 w-3" /> {t('error.boundary.retry', 'Retry')}
        </Button>
      </div>
    )
  }

  const title = chunk
    ? t('error.boundary.chunkTitle', 'New Version Deployed')
    : network
    ? t('error.boundary.networkTitle', 'Connection Lost')
    : t('error.boundary.fullTitle', 'Something went wrong')

  const body = chunk
    ? t('error.chunkLoad.body', 'A new version was deployed. Click Reload to load the latest assets.')
    : network
    ? t('error.boundary.networkBody', 'Unable to reach the server. Check your connection and try again.')
    : error?.message || t('error.boundary.fullBody', 'An unexpected error occurred. Please try again.')

  return (
    <div className="flex items-center justify-center min-h-[400px] p-8">
      <div className="text-center max-w-md">
        <div className="mx-auto mb-6 rounded-2xl bg-tesla-red/10 p-5 ring-1 ring-tesla-red/20 w-fit">
          {network ? (
            <WifiOff className="h-10 w-10 text-tesla-red" />
          ) : (
            <AlertTriangle className="h-10 w-10 text-tesla-red" />
          )}
        </div>
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">{title}</h2>
        <p className="text-sm text-[var(--text-secondary)] mb-2">{body}</p>
        {tooManyRetries && (
          <p className="text-xs text-[var(--text-muted)] mb-4">
            {t('error.boundary.tooManyRetries', 'Multiple retries failed. Try refreshing the page or checking system status.')}
          </p>
        )}
        <div className="flex items-center justify-center gap-3 mt-6">
          <Button onClick={onRetry} variant="primary">
            <RefreshCw className="h-4 w-4" />
            {tooManyRetries
              ? t('error.boundary.tryAgainAnyway', 'Try Again Anyway')
              : t('error.boundary.tryAgain', 'Try Again')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              window.location.href = '/'
            }}
          >
            <Home className="h-4 w-4" />
            {t('error.boundary.goHome', 'Go Home')}
          </Button>
        </div>
        {retryCount > 0 && (
          <p className="mt-4 text-[10px] text-[var(--text-muted)]">
            {t('error.boundary.retryAttempt', 'Retry attempt {{count}}', { count: retryCount })}
          </p>
        )}
      </div>
    </div>
  )
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
    // recovery logic so it ships even if the chunk-load reload below
    // succeeds (and tears down the page).
    reportFrontendError(error, 'react')

    console.error(`[ErrorBoundary${this.props.name ? `:${this.props.name}` : ''}]`, {
      error: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
      retryCount: this.state.retryCount,
    })

    // Stale-chunk recovery — see history in git for the full rationale.
    // Summary: ChunkLoadError almost always means the server has redeployed
    // and the hashed asset no longer exists. The proactive <NewVersionBanner />
    // is the primary recovery path; this is the safety net for users who
    // dismissed the banner. Throttle reloads to 1/min/tab to defeat loops
    // on a genuinely broken server.
    if (isChunkLoadError(error)) {
      try {
        const lastReload = sessionStorage.getItem(CHUNK_RELOAD_KEY)
        const now = Date.now()
        if (!lastReload || now - Number(lastReload) > CHUNK_RELOAD_THROTTLE_MS) {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now))
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
          }, CHUNK_RELOAD_GRACE_MS)
        }
      } catch {
        // sessionStorage may throw in private mode / Safari quotas — fall
        // through to the rendered fallback; the banner remains the primary
        // recovery path.
      }
    }
  }

  handleRetry = () => {
    if (this.state.error && isChunkLoadError(this.state.error)) {
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
      return (
        <ErrorBoundaryFallback
          error={this.state.error}
          retryCount={this.state.retryCount}
          inline={Boolean(this.props.inline)}
          onRetry={this.handleRetry}
        />
      )
    }

    return this.props.children
  }
}
