import { useEffect, useId, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'
import { Input } from './Input'
import { Select } from './Select'
import { Text } from './Typography'
import { useNumberFormatting } from '@/hooks/useNumberFormatting'

export interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
}

/** Caller-owned pagination; counts remain row counts, never loaded-page counts. */
export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, pageSizeOptions = [25, 50, 100] }: PaginationProps) {
  const { t } = useTranslation()
  const { fmtInt } = useNumberFormatting()
  const inputId = useId()
  const configuredOptions = [...new Set((pageSizeOptions ?? []).filter(size => Number.isSafeInteger(size) && size > 0))]
  const safePageSize = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : (configuredOptions[0] ?? 25)
  const safeTotal = Number.isFinite(total) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(total))) : 0
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize))
  const safePage = Number.isFinite(page) ? Math.min(Math.max(1, Math.floor(page)), totalPages) : 1
  const start = safeTotal > 0 ? (safePage - 1) * safePageSize + 1 : 0
  const end = Math.min(safePage * safePageSize, safeTotal)
  const options = configuredOptions.includes(safePageSize) ? configuredOptions : [safePageSize, ...configuredOptions]
  const [destination, setDestination] = useState(String(safePage))
  const [invalidDestination, setInvalidDestination] = useState(false)
  useEffect(() => {
    setDestination(String(safePage))
    setInvalidDestination(false)
  }, [safePage, safePageSize, safeTotal])

  // Narrow containers keep the current page inline; the form preserves direct jumps.
  const pageSlots: (number | 'start-gap' | 'end-gap')[] = totalPages <= 5
    ? Array.from({ length: totalPages }, (_, index) => index + 1)
    : safePage <= 3
      ? [1, 2, 3, 'end-gap', totalPages]
      : safePage >= totalPages - 2
        ? [1, 'start-gap', totalPages - 2, totalPages - 1, totalPages]
        : [1, 'start-gap', safePage, 'end-gap', totalPages]
  const buttonClass = 'h-11 min-w-11 px-2 sm:h-9 sm:min-w-9'
  const edgeButtonClass = `${buttonClass} hidden @[15rem]/pagination:inline-flex`

  return (
    <nav aria-label={t('a11y.pagination', 'Pagination')}
      className="@container/pagination flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:justify-start">
        <Text variant="caption" className="tabular-nums" aria-live="polite" aria-atomic="true">
          {t('pagination.showing', 'Showing {{start}}–{{end}} of {{total}}', {
            start: fmtInt(start), end: fmtInt(end), total: fmtInt(safeTotal),
          })}
        </Text>
        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <Text variant="caption">{t('pagination.rows', 'Rows')}</Text>
            <Select value={safePageSize} size="sm" className="min-h-11 sm:min-h-9"
              aria-label={t('pagination.pageSize', 'Rows per page')}
              onChange={event => onPageSizeChange(Number(event.target.value))}
              options={options.map(size => ({
                value: String(size),
                label: t('pagination.rowsOption', '{{size}} / page', { size: fmtInt(size) }),
              }))} />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-x-4 sm:gap-y-2">
        <div className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-1 sm:flex sm:w-auto">
          <div className="flex gap-1">
            <Button type="button" variant="ghost" size="sm" className={edgeButtonClass}
              disabled={safePage === 1} onClick={() => onPageChange(1)} aria-label={t('pagination.first', 'First page')}>
              <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="sm" className={buttonClass}
              disabled={safePage === 1} onClick={() => onPageChange(safePage - 1)} aria-label={t('pagination.previous', 'Previous page')}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <div className="flex min-w-0 items-center justify-center gap-1">
            {pageSlots.map(slot => typeof slot === 'number' ? (
              <Button key={slot} type="button" variant={slot === safePage ? 'primary' : 'ghost'} size="sm"
                className={slot === safePage ? buttonClass : `${buttonClass} hidden @[27rem]/pagination:inline-flex`}
                onClick={() => { if (slot !== safePage) onPageChange(slot) }}
                aria-current={slot === safePage ? 'page' : undefined}
                aria-label={slot === safePage
                  ? t('pagination.currentPage', 'Page {{page}} of {{total}}', { page: fmtInt(slot), total: fmtInt(totalPages) })
                  : t('pagination.page', 'Page {{page}}', { page: fmtInt(slot) })}>
                {fmtInt(slot)}
              </Button>
            ) : <Text key={slot} variant="caption" className="hidden min-w-6 justify-center @[27rem]/pagination:flex" aria-hidden="true">…</Text>)}
          </div>
          <div className="col-start-3 row-start-1 flex gap-1">
            <Button type="button" variant="ghost" size="sm" className={buttonClass}
              disabled={safePage === totalPages} onClick={() => onPageChange(safePage + 1)} aria-label={t('pagination.next', 'Next page')}>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="sm" className={edgeButtonClass}
              disabled={safePage === totalPages} onClick={() => onPageChange(totalPages)} aria-label={t('pagination.last', 'Last page')}>
              <ChevronsRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
        <form className="flex max-w-full flex-wrap items-center justify-between gap-2 sm:justify-end" noValidate onSubmit={event => {
          event.preventDefault()
          const target = Number(destination)
          if (!/^\d+$/.test(destination.trim()) || !Number.isSafeInteger(target) || target < 1 || target > totalPages) {
            setInvalidDestination(true)
            return
          }
          setInvalidDestination(false)
          setDestination(String(target))
          if (target !== safePage) onPageChange(target)
        }}>
          <Text variant="caption">{t('pagination.goToPage', 'Go to page')}</Text>
          <div className="flex items-center gap-2">
            <div className="w-16">
              <Input id={inputId} size="sm" className="min-h-11 sm:min-h-9" type="text" inputMode="numeric" autoComplete="off"
                aria-label={t('pagination.goToPage', 'Go to page')}
                aria-invalid={invalidDestination || undefined} aria-describedby={invalidDestination ? `${inputId}-invalid` : undefined}
                value={destination} onChange={event => { setDestination(event.target.value); setInvalidDestination(false) }} />
            </div>
            <Button type="submit" variant="secondary" size="sm" className={buttonClass}>{t('pagination.go', 'Go')}</Button>
          </div>
          {invalidDestination && (
            <Text id={`${inputId}-invalid`} variant="error" role="alert" className="basis-full">
              {t('pagination.invalidPage', 'Enter a page from 1 to {{total}}.', { total: fmtInt(totalPages) })}
            </Text>
          )}
        </form>
      </div>
    </nav>
  )
}
