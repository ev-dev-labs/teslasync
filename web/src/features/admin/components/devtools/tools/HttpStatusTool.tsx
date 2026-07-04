import { useState, useMemo, useCallback } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Network } from 'lucide-react'
import { Input, Badge, DataTable, useSortToggle, type Column } from '@/components/ui'
import { ToolCard } from '../ToolCard'
import { HTTP_CODES } from '../constants'

type HttpCode = { code: number; text: string; desc: string }

/**
 * Map an HTTP status code to a semantic Badge variant: 2xx success, 3xx info,
 * 4xx warning (client error), 5xx danger (server error). Anything below 200 is
 * treated as informational so an unexpected value never crashes the render.
 */
function badgeVariant(code: number): 'success' | 'info' | 'warning' | 'danger' {
  if (code >= 200 && code < 300) return 'success'
  if (code >= 400 && code < 500) return 'warning'
  if (code >= 500) return 'danger'
  return 'info'
}

export function HttpStatusTool() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  // Default to code-ascending so the initial order matches the source catalog;
  // wiring sortKey/sortDir/onSort is what makes the sortable header actually do
  // something (DataTable sorts nothing on its own — the caller owns the data).
  const { sortKey, sortDir, onSort, sortFn } = useSortToggle('code', 'asc')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matches = !q
      ? HTTP_CODES
      : HTTP_CODES.filter(
          (c) =>
            String(c.code).includes(q) ||
            c.text.toLowerCase().includes(q) ||
            c.desc.toLowerCase().includes(q),
        )
    return sortFn(matches, (row) => row.code)
  }, [search, sortFn])

  const handleSearch = useCallback((e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value), [])

  const columns: Column<HttpCode>[] = useMemo(
    () => [
      {
        key: 'code',
        header: t('devtools.utils.httpStatusCode', 'Status Code'),
        sortable: true,
        render: (r) => (
          <Badge variant={badgeVariant(r.code)} size="sm">
            {r.code}
          </Badge>
        ),
      },
      {
        key: 'text',
        header: t('devtools.utils.httpStatusText', 'Status Text'),
        render: (r) => <span className="text-sm font-medium text-[var(--text-primary)]">{r.text}</span>,
      },
      {
        key: 'desc',
        header: t('devtools.utils.httpStatusDescription', 'Description'),
        render: (r) => <span className="text-xs text-[var(--text-secondary)]">{r.desc}</span>,
      },
    ],
    [t],
  )

  return (
    <ToolCard
      icon={Network}
      color="amber"
      title={t('devtools.utils.httpStatus', 'HTTP Status')}
      description={t('devtools.utils.httpStatusDesc', 'Reference for HTTP response status codes')}
    >
      <div className="space-y-3">
        <Input
          aria-label={t('devtools.utils.httpStatusSearch', 'Search status codes')}
          placeholder={t('devtools.utils.httpStatusSearchPlaceholder', 'Search codes')}
          value={search}
          onChange={handleSearch}
          icon={<Network className="h-4 w-4" aria-hidden="true" />}
        />
        <DataTable
          tableId="admin:http-status-codes"
          columns={columns}
          data={filtered}
          keyExtractor={(r) => r.code}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          emptyMessage={t('devtools.utils.httpStatusEmpty', 'No status codes match your search')}
          compact
          pagination
        />
      </div>
    </ToolCard>
  )
}
