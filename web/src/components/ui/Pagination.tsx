import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
}

/**
 * Table pagination controls with first/prev/next/last buttons and optional
 * page-size selector.
 *
 * Accessibility: the control set is wrapped in a landmark `<nav>` so screen readers announce it as a pagination region. The
 * "showing X–Y of Z" copy lives inside `aria-live="polite"` so the count
 * update is announced as the user pages without stealing focus.
 */
export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, pageSizeOptions = [25, 50, 100] }: PaginationProps) {
  const { t } = useTranslation()
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  return (
    <nav
      aria-label={t('a11y.pagination', 'Pagination')}
      className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center justify-between gap-2 sm:gap-3 pt-4"
    >
      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <span className="whitespace-nowrap" aria-live="polite" aria-atomic="true">
          {t('pagination.showing', 'Showing {{start}}–{{end}} of {{total}}', { start: total > 0 ? start : 0, end, total })}
        </span>
        {onPageSizeChange && (
          <select
            value={pageSize}
            onChange={e => onPageSizeChange(Number(e.target.value))}
            aria-label={t('pagination.pageSize', 'Rows per page')}
            className="rounded-md bg-white/[0.04] px-2 py-1 text-xs text-[var(--text-secondary)] outline-none ring-1 ring-white/[0.08]"
          >
            {pageSizeOptions.map(s => (
              <option key={s} value={s} className="bg-[var(--bg)]">
                {t('pagination.perPage', '{{count}} / page', { count: s })}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex items-center gap-1 self-end sm:self-auto">
        <button onClick={() => onPageChange(1)} disabled={page <= 1}
          aria-label={t('pagination.first', 'First page')}
          className="rounded-md p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.06] disabled:opacity-30 disabled:pointer-events-none transition-colors">
          <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button onClick={() => onPageChange(page - 1)} disabled={page <= 1}
          aria-label={t('pagination.previous', 'Previous page')}
          className="rounded-md p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.06] disabled:opacity-30 disabled:pointer-events-none transition-colors">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <span
          className="px-3 text-xs font-medium text-[var(--text-secondary)]"
          aria-current="page"
          aria-label={t('pagination.currentPage', 'Page {{page}} of {{total}}', { page, total: totalPages })}
        >
          {page} / {totalPages}
        </span>
        <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}
          aria-label={t('pagination.next', 'Next page')}
          className="rounded-md p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.06] disabled:opacity-30 disabled:pointer-events-none transition-colors">
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
        <button onClick={() => onPageChange(totalPages)} disabled={page >= totalPages}
          aria-label={t('pagination.last', 'Last page')}
          className="rounded-md p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.06] disabled:opacity-30 disabled:pointer-events-none transition-colors">
          <ChevronsRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  )
}
