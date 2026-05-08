import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BatteryCharging, ChevronRight } from 'lucide-react'

import { GlassPanel, DataTable, type Column } from '@/components/ui'
import { EmptyState } from '@/components/feedback'
import { formatDateTime } from '@/lib/dateFormat'
import { fmtNumber } from '@/lib/numberFormat'
import type { ChargingSession } from '@/api/types'
import { durationStr } from './helpers'

interface RecentChargesSectionProps {
  sessions: ChargingSession[] | undefined
}

function useChargeColumns(): Column<ChargingSession>[] {
  const { t } = useTranslation()
  return [
    {
      key: 'date',
      header: t('common.date', 'Date'),
      render: (s) => formatDateTime(s.start_ts),
    },
    {
      key: 'energy',
      header: t('common.energy', 'Energy'),
      render: (s) => `${fmtNumber(s.total_energy_added_wh)} kWh`,
      sortable: true,
    },
    {
      key: 'duration',
      header: t('common.duration', 'Duration'),
      render: (s) => durationStr(s.duration_min),
    },
    {
      key: 'cost',
      header: t('common.cost', 'Cost'),
      render: (s) => (s.cost != null ? `$${fmtNumber(s.cost)}` : '—'),
    },
    {
      key: 'battery',
      header: t('common.battery', 'Battery'),
      render: (s) =>
        s.end_soc_pct != null
          ? `${s.start_soc_pct}% → ${s.end_soc_pct}%`
          : `${s.start_soc_pct}%`,
    },
  ]
}

export function RecentChargesSection({ sessions }: RecentChargesSectionProps) {
  const { t } = useTranslation()
  const chargeColumns = useChargeColumns()

  return (
    <GlassPanel className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BatteryCharging className="h-4 w-4 text-[var(--neon-green)]" />
          <span className="text-lg font-bold text-[var(--text-primary)]">
            {t('common.recentCharges', 'Recent Charges')}
          </span>
        </div>
        <Link
          to="/charging"
          className="text-xs text-[var(--text-muted)] hover:text-[var(--neon-green)] transition-colors flex items-center gap-1"
        >
          {t('common.viewAll', 'View all')} <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
      {sessions && sessions.length > 0 ? (
        <DataTable
          tableId="vehicles:detail-recent-charges"
          columns={chargeColumns}
          data={sessions}
          keyExtractor={(s) => s.id}
          compact
          pagination
          emptyMessage={t('common.noCharges', 'No charging sessions recorded yet')}
        />
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<BatteryCharging className="h-8 w-8" />}
          message={t('common.noCharges', 'No charging sessions recorded yet')}
        />
      )}
    </GlassPanel>
  )
}
