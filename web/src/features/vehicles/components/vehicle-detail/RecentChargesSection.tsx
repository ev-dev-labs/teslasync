import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BatteryCharging, ChevronRight } from 'lucide-react'

import { BUTTON_BASE, DataTable, type Column, type MobileDataTablePresentation } from '@/components/ui'
import { LayoutCard } from '@/components/layout'
import { EmptyState } from '@/components/feedback'
import { formatDateTime } from '@/lib/dateFormat'

import { convertEnergyFromSI } from '@/lib/unitConversion'
import { useFormatting } from '@/hooks/useFormatting'
import type { ChargingSession } from '@/api/types'
import { durationStr } from './helpers'
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface RecentChargesSectionProps {
  sessions: ChargingSession[] | undefined
}

/** Resolve a charging session duration in minutes from canonical SI seconds. */
export function chargeDurationMinutes(session: ChargingSession): number {
  const seconds = session.duration_s
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
    return seconds / 60
  }
  const start = session.started_at ?? session.start_ts
  const end = session.ended_at ?? session.end_ts
  if (!start || !end) return 0
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return ms / 60_000
}

function useChargeColumns(): {
  columns: Column<ChargingSession>[]
  mobilePresentation: MobileDataTablePresentation<ChargingSession>
} {
  const { fmtNumber, precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const { t } = useTranslation()
  const { formatCurrency } = useFormatting()

  return useMemo(
    () => {
      const display: Record<string, (session: ChargingSession) => string> = {
        date: (s) => formatDateTime(s.started_at ?? s.start_ts),
        energy: (s) => `${fmtNumber(convertEnergyFromSI(s.total_energy_added_wh ?? 0, 'kWh'))} kWh`,
        duration: (s) => durationStr(chargeDurationMinutes(s)),
        cost: (s) => {
          const cost = s.cost ?? s.cost_decimal
          return cost != null ? formatCurrency(cost) : '—'
        },
        battery: (s) => {
          if (s.start_soc_pct == null) return '—'
          return s.end_soc_pct != null
            ? `${s.start_soc_pct}% → ${s.end_soc_pct}%`
            : `${s.start_soc_pct}%`
        },
      }
      const columns: Column<ChargingSession>[] = [
        {
          key: 'date',
          header: t('common.date', 'Date'),
          // The list endpoint sends `started_at`; `start_ts` is the dashboard /
          // live-detail alias. Coalesce so the date never collapses to "—".
          render: display.date,
        },
        {
          key: 'energy',
          align: 'right',
          header: t('common.energy', 'Energy'),
          render: display.energy,
          sortable: true,
        },
        {
          key: 'duration',
          align: 'right',
          header: t('common.duration', 'Duration'),
          render: display.duration,
        },
        {
          key: 'cost',
          align: 'right',
          header: t('common.cost', 'Cost'),
          // `cost_decimal` is the SI-canonical column; `cost` is the legacy alias.
          render: display.cost,
        },
        {
          key: 'battery',
          align: 'right',
          header: t('common.battery', 'Battery'),
          render: display.battery,
        },
      ]
      const mobilePresentation: MobileDataTablePresentation<ChargingSession> = {
        roles: { date: 'title', energy: 'primary', duration: 'meta', cost: 'meta', battery: 'meta' },
        displayValue: (session, key) => display[key]?.(session),
      }
      return { columns, mobilePresentation }
    },
    [t, formatCurrency, fmtNumber, displayPrecision, displayLocale],
  )
}

export function RecentChargesSection({ sessions }: RecentChargesSectionProps) {
  const { t } = useTranslation()
  const { columns: chargeColumns, mobilePresentation } = useChargeColumns()

  return (
    <LayoutCard
      title={t('common.recentCharges', 'Recent charges')}
      icon={<BatteryCharging className="h-4 w-4 text-emerald-300" aria-hidden="true" />}
      actions={<Link
          to="/charging"
          data-app-part="button"
          data-app-variant="ghost"
          className={`${BUTTON_BASE} min-h-11 min-w-11 shrink-0 gap-1 px-2 text-xs text-[var(--text-muted)] hover:text-emerald-300`}
        >
          {t('common.viewAll', 'View all')} <ChevronRight className="h-3 w-3" aria-hidden="true" />
        </Link>}
    >
      {sessions && sessions.length > 0 ? (
        <DataTable
          tableId="vehicles:detail-recent-charges"
          cardLayout
          columns={chargeColumns}
          mobileColumns={['date', 'energy', 'battery']}
          mobilePresentation={mobilePresentation}
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
    </LayoutCard>
  )
}
