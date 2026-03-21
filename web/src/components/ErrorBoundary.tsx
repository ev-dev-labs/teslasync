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
  errorInfo: React.ErrorInfo | null
  retryCount: number
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null, retryCount: 0 }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo })
    console.error('TeslaSync Error:', {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      boundary: this.props.name ?? 'unnamed',
      retryCount: this.state.retryCount,
    })
  }

  handleRetry = () => {
    this.setState(prev => ({
      hasError: false,
      error: null,
      errorInfo: null,
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
          <div className="flex items-center gap-3 rounded-xl border border-tesla-red/20 bg-tesla-red/5 p-4" role="alert">
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
        <div className="min-h-[400px] flex items-center justify-center p-8" role="alert">
          <div className="max-w-md text-center">
            <div className="h-16 w-16 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
              {isNetworkError ? (
                <WifiOff className="h-8 w-8 text-red-500" />
              ) : (
                <AlertTriangle className="h-8 w-8 text-red-500" />
              )}
            </div>
            <h2 className="text-xl font-bold mb-2" style={{color:'var(--text-primary)'}}>
              {isNetworkError ? 'Connection Lost' : 'Something went wrong'}
            </h2>
            <p className="text-sm mb-2" style={{color:'var(--text-secondary)'}}>
              {isNetworkError
                ? 'Unable to reach the server. Check your connection and try again.'
                : this.state.error?.message || 'An unexpected error occurred'}
            </p>
            {tooManyRetries && (
              <p className="text-xs text-[var(--text-muted)] mb-4">
                Multiple retries failed. Try refreshing the page or checking system status.
              </p>
            )}
            <div className="flex gap-3 justify-center mt-4">
              <button onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-neon-cyan/15 text-neon-cyan ring-1 ring-neon-cyan/25 hover:bg-neon-cyan/25">
                Try Again
              </button>
              <button onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-white/5 text-[var(--text-secondary)] ring-1 ring-white/10 hover:bg-white/10">
                Reload Page
              </button>
              <a href="/" className="px-4 py-2 rounded-lg text-sm font-medium bg-white/5 text-[var(--text-secondary)] ring-1 ring-white/10 hover:bg-white/10 inline-flex items-center gap-1.5">
                <Home className="h-4 w-4" />
                Go Home
              </a>
            </div>
            {this.state.retryCount > 0 && (
              <p className="mt-4 text-[10px] text-gray-600">
                Retry attempt {this.state.retryCount}
              </p>
            )}
            {import.meta.env.DEV && this.state.error?.stack && (
              <details className="mt-4 text-left">
                <summary className="text-xs cursor-pointer text-[var(--text-muted)]">Stack Trace</summary>
                <pre className="mt-2 p-3 rounded-lg text-[10px] overflow-auto max-h-48"
                  style={{background:'var(--surface-2)',color:'var(--text-muted)'}}>
                  {this.state.error.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
