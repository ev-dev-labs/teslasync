import { useMemo } from 'react'
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

/**
 * Resolve a charging session's duration in minutes.
 *
 * The `/charging?vehicle_id=…` list endpoint that feeds this section serializes
 * the raw `charging_sessions` row — `started_at` + `ended_at`, with NO
 * precomputed `duration_min` (that field only exists on the dashboard-activity
 * shape). Reading `s.duration_min` verbatim therefore rendered a permanent
 * "0m" for every row. Prefer an explicit, positive `duration_min` when a caller
 * does supply one, otherwise derive it from the start/end timestamps. An
 * in-progress session (no `ended_at`), a reversed pair, or an unparseable
 * timestamp collapses to 0 so `durationStr` renders "0m" instead of throwing or
 * printing "NaN".
 */
export function chargeDurationMinutes(session: ChargingSession): number {
  const explicit = session.duration_min
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) {
    return explicit
  }
  const start = session.started_at ?? session.start_ts
  const end = session.ended_at ?? session.end_ts
  if (!start || !end) return 0
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return ms / 60_000
}

function useChargeColumns(): Column<ChargingSession>[] {
  const { t } = useTranslation()
  const { formatCurrency } = useFormatting()

  return useMemo<Column<ChargingSession>[]>(
    () => [
      {
        key: 'date',
        header: t('common.date', 'Date'),
        // The list endpoint sends `started_at`; `start_ts` is the dashboard /
        // live-detail alias. Coalesce so the date never collapses to "—".
        render: (s) => formatDateTime(s.started_at ?? s.start_ts),
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
        render: (s) => durationStr(chargeDurationMinutes(s)),
      },
      {
        key: 'cost',
        header: t('common.cost', 'Cost'),
        // `cost_decimal` is the SI-canonical column; `cost` is the legacy alias.
        render: (s) => {
          const cost = s.cost ?? s.cost_decimal
          return cost != null ? formatCurrency(cost) : '—'
        },
      },
      {
        key: 'battery',
        header: t('common.battery', 'Battery'),
        render: (s) => {
          if (s.start_soc_pct == null) return '—'
          return s.end_soc_pct != null
            ? `${s.start_soc_pct}% → ${s.end_soc_pct}%`
            : `${s.start_soc_pct}%`
        },
      },
    ],
    [t, formatCurrency],
  )
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
