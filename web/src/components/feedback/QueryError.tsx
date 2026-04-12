/** Inline error banner for failed API queries. Shows message + retry button. */
export function QueryError({ error, onRetry }: { error: Error | null; onRetry?: () => void }) {
  if (!error) return null
  return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 mb-6 backdrop-blur-sm">
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5 rounded-lg bg-red-500/10 p-2">
          <svg className="h-4 w-4 text-red-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-red-300">Failed to load data</p>
          <p className="text-xs text-red-400/70 mt-0.5 truncate">{error.message}</p>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="shrink-0 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 transition-colors"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  )
}
