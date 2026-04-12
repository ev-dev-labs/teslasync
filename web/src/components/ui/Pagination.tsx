import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
}

/** Table pagination controls with first/prev/next/last buttons and optional page-size selector. */
export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, pageSizeOptions = [25, 50, 100] }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  return (
    <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center justify-between gap-2 sm:gap-3 pt-4">
      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <span className="whitespace-nowrap">Showing {total > 0 ? start : 0}–{end} of {total}</span>
        {onPageSizeChange && (
          <select
            value={pageSize}
            onChange={e => onPageSizeChange(Number(e.target.value))}
            className="rounded-md bg-white/[0.04] px-2 py-1 text-xs text-gray-300 outline-none ring-1 ring-white/[0.08]"
          >
            {pageSizeOptions.map(s => (
              <option key={s} value={s} className="bg-[var(--bg)]">{s} / page</option>
            ))}
          </select>
        )}
      </div>
      <div className="flex items-center gap-1 self-end sm:self-auto">
        <button onClick={() => onPageChange(1)} disabled={page <= 1}
          className="rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.06] disabled:opacity-30 disabled:pointer-events-none transition-colors">
          <ChevronsLeft className="h-4 w-4" />
        </button>
        <button onClick={() => onPageChange(page - 1)} disabled={page <= 1}
          className="rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.06] disabled:opacity-30 disabled:pointer-events-none transition-colors">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="px-3 text-xs font-medium text-gray-300">
          {page} / {totalPages}
        </span>
        <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}
          className="rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.06] disabled:opacity-30 disabled:pointer-events-none transition-colors">
          <ChevronRight className="h-4 w-4" />
        </button>
        <button onClick={() => onPageChange(totalPages)} disabled={page >= totalPages}
          className="rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.06] disabled:opacity-30 disabled:pointer-events-none transition-colors">
          <ChevronsRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
