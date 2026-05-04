import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen } from 'lucide-react'
import { Input, Badge, DataTable, type Column } from '@/components/ui'
import { ToolCard } from '../ToolCard'
import { CopyButton } from '@/components/ui'
import { TESLA_ENDPOINTS } from '../constants'

export function TeslaApiRefTool() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return TESLA_ENDPOINTS
    const q = search.toLowerCase()
    return TESLA_ENDPOINTS.filter(
      (e) =>
        e.method.toLowerCase().includes(q) ||
        e.path.toLowerCase().includes(q) ||
        e.desc.toLowerCase().includes(q),
    )
  }, [search])

  const columns: Column<{ method: string; path: string; desc: string }>[] = useMemo(
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
          placeholder={t('Search Endpoints')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          icon={<BookOpen className="h-4 w-4" />}
        />
        <DataTable
          tableId="admin:tesla-api-ref"
          columns={columns}
          data={filtered}
          keyExtractor={(r) => r.path}
          compact
          pagination
        />
      </div>
    </ToolCard>
  )
}
