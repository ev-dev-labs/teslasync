import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BatteryCharging, ChevronRight } from 'lucide-react'

import { GlassPanel, DataTable, PanelTitle, type Column } from '@/components/ui'
import { EmptyState } from '@/components/feedback'
import { formatDateTime } from '@/lib/dateFormat'
import { fmtNumber } from '@/lib/numberFormat'
import { convertEnergyFromSI } from '@/lib/unitConversion'
import { useFormatting } from '@/hooks/useFormatting'
import type { ChargingSession } from '@/api/types'
import { durationStr } from './helpers'

interface RecentChargesSectionProps {
  sessions: ChargingSession[] | undefined
}

function useChargeColumns(): Column<ChargingSession>[] {
  const { t } = useTranslation()
  const { formatCurrency } = useFormatting()
  return [
    {
      key: 'date',
      header: t('common.date', 'Date'),
      render: (s) => formatDateTime(s.start_ts),
    },
    {
      key: 'energy',
      header: t('common.energy', 'Energy'),
      render: (s) => `${fmtNumber(convertEnergyFromSI(s.total_energy_added_wh ?? 0, 'kWh'))} kWh`,
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
      render: (s) => (s.cost != null ? formatCurrency(s.cost) : '—'),
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
      <div className="mb-4 flex items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <BatteryCharging className="h-4 w-4 text-emerald-300" aria-hidden="true" />
          {t('common.recentCharges', 'Recent Charges')}
        </PanelTitle>
        <Link
          to="/charging"
          className="flex items-center gap-1 text-xs text-[var(--text-muted)] transition-colors hover:text-emerald-300"
        >
          {t('common.viewAll', 'View all')} <ChevronRight className="h-3 w-3" aria-hidden="true" />
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
