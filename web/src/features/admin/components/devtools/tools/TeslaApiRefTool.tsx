import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen } from 'lucide-react'
import { Input, Badge, DataTable, CopyButton, type Column } from '@/components/ui'
import { ToolCard } from '../ToolCard'
import { TESLA_ENDPOINTS } from '../constants'

interface TeslaEndpoint {
  method: string
  path: string
  desc: string
}

export function TeslaApiRefTool() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')

  const searchLabel = t('Search Endpoints')

  const filtered = useMemo(() => {
    // Trim before matching so stray leading/trailing whitespace in the query
    // (e.g. a pasted " wake ") doesn't silently reduce every row to no match.
    const q = search.trim().toLowerCase()
    if (!q) return TESLA_ENDPOINTS
    return TESLA_ENDPOINTS.filter(
      (e) =>
        e.method.toLowerCase().includes(q) ||
        e.path.toLowerCase().includes(q) ||
        e.desc.toLowerCase().includes(q),
    )
  }, [search])

  const columns: Column<TeslaEndpoint>[] = useMemo(
    () => [
      {
        key: 'method',
        header: t('Method'),
        render: (r) => (
          <Badge variant={r.method === 'GET' ? 'info' : 'warning'} size="sm">
            {r.method}
          </Badge>
        ),
      },
      {
        key: 'path',
        header: t('Path'),
        render: (r) => (
          <div className="flex items-center gap-1">
            <code className="text-xs font-mono text-cyan-300">{r.path}</code>
            <CopyButton text={r.path} />
          </div>
        ),
      },
      { key: 'desc', header: t('Endpoint Desc'), render: (r) => <span className="text-xs text-[var(--text-secondary)]">{r.desc}</span> },
    ],
    [t],
  )

  return (
    <ToolCard icon={BookOpen} color="cyan" title={t('Tesla Api Ref')} description={t('Tesla Api Ref Desc')}>
      <div className="space-y-3">
        <Input
          type="search"
          aria-label={searchLabel}
          placeholder={searchLabel}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          icon={<BookOpen aria-hidden="true" className="h-4 w-4" />}
        />
        <DataTable
          tableId="admin:tesla-api-ref"
          columns={columns}
          data={filtered}
          keyExtractor={(r) => r.path}
          emptyMessage={t('devtools.teslaApiRef.noResults', 'No endpoints match your search')}
          compact
          pagination
        />
      </div>
    </ToolCard>
  )
}
