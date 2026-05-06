import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Network } from 'lucide-react'
import { Input, Badge, DataTable, type Column } from '@/components/ui'
import { ToolCard } from '../ToolCard'
import { HTTP_CODES } from '../constants'

export function HttpStatusTool() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return HTTP_CODES
    const q = search.toLowerCase()
    return HTTP_CODES.filter(
      (c) =>
        String(c.code).includes(q) ||
        c.text.toLowerCase().includes(q) ||
        c.desc.toLowerCase().includes(q),
    )
  }, [search])

  const columns: Column<{ code: number; text: string; desc: string }>[] = useMemo(
    () => [
      {
        key: 'code',
        header: t('Status Code'),
        sortable: true,
        render: (r) => (
          <Badge
            variant={r.code < 300 ? 'success' : r.code < 400 ? 'info' : r.code < 500 ? 'warning' : 'danger'}
            size="sm"
          >
            {r.code}
          </Badge>
        ),
      },
      { key: 'text', header: t('Status Text'), render: (r) => <span className="text-sm font-medium text-white">{r.text}</span> },
      { key: 'desc', header: t('Status Desc'), render: (r) => <span className="text-xs text-[var(--text-secondary)]">{r.desc}</span> },
    ],
    [t],
  )

  return (
    <ToolCard icon={Network} color="amber" title={t('Http Status')} description={t('Http Status Desc')}>
      <div className="space-y-3">
        <Input
          placeholder={t('Search Codes')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          icon={<Network className="h-4 w-4" />}
        />
        <DataTable
          tableId="admin:http-status-codes"
          columns={columns}
          data={filtered}
          keyExtractor={(r) => r.code}
          compact
          pagination
        />
      </div>
    </ToolCard>
  )
}
