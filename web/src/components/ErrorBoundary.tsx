import { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw, Home, WifiOff } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  /** If true, show a more compact inline error instead of full-page */
  inline?: boolean
  /** Optional name for logging which boundary caught the error */
  name?: string
}

interface State {
  hasError: boolean
  error: Error | null
  retryCount: number
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, retryCount: 0 }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log structured error for observability
    console.error(`[ErrorBoundary${this.props.name ? `:${this.props.name}` : ''}]`, {
      error: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
      retryCount: this.state.retryCount,
    })
  }

  handleRetry = () => {
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

      const tooManyRetries = this.state.retryCount >= 3

      if (this.props.inline) {
        return (
          <div className="flex items-center gap-3 rounded-xl border border-tesla-red/20 bg-tesla-red/5 p-4">
            <AlertTriangle className="h-5 w-5 text-tesla-red shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-300">Component failed to load</p>
              <p className="text-xs text-[var(--text-muted)] truncate">{this.state.error?.message}</p>
            </div>
            <button onClick={this.handleRetry} className="glass-button text-xs shrink-0">
              <RefreshCw className="h-3 w-3" /> Retry
            </button>
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
              {isNetworkError ? 'Connection Lost' : 'Something went wrong'}
            </h2>
            <p className="text-sm text-[var(--text-secondary)] mb-2">
              {isNetworkError
                ? 'Unable to reach the server. Check your connection and try again.'
                : this.state.error?.message || 'An unexpected error occurred. Please try again.'}
            </p>
            {tooManyRetries && (
              <p className="text-xs text-[var(--text-muted)] mb-4">
                Multiple retries failed. Try refreshing the page or checking system status.
              </p>
            )}
            <div className="flex items-center justify-center gap-3 mt-6">
              <button
                onClick={this.handleRetry}
                className="neon-button text-sm"
              >
                <RefreshCw className="h-4 w-4" />
                {tooManyRetries ? 'Try Again Anyway' : 'Try Again'}
              </button>
              <a href="/" className="glass-button text-sm">
                <Home className="h-4 w-4" />
                Go Home
              </a>
            </div>
            {this.state.retryCount > 0 && (
              <p className="mt-4 text-[10px] text-gray-600">
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
