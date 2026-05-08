import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Route, ChevronRight } from 'lucide-react'

import { GlassPanel, DataTable, type Column } from '@/components/ui'
import { EmptyState } from '@/components/feedback'
import { useUnits } from '@/hooks/useUnits'
import { convertDistanceFromSI, type DistanceUnitPref } from '@/lib/unitConversion'
import { formatDateTime } from '@/lib/dateFormat'
import { fmtNumber } from '@/lib/numberFormat'
import type { Drive } from '@/api/types'
import { durationStr } from './helpers'

interface RecentDrivesSectionProps {
  drives: Drive[] | undefined
}

function useDriveColumns(distanceUnit: DistanceUnitPref): Column<Drive>[] {
  const { t } = useTranslation()
  return [
    {
      key: 'date',
      header: t('common.date', 'Date'),
      render: (d) => formatDateTime(d.start_ts),
    },
    {
      key: 'distance',
      header: t('common.distance', 'Distance'),
      render: (d) => `${fmtNumber(convertDistanceFromSI(d.distance_m ?? 0, distanceUnit))} ${distanceUnit}`,
      sortable: true,
    },
    {
      key: 'duration',
      header: t('common.duration', 'Duration'),
      render: (d) => durationStr((d.duration_s ?? 0) / 60),
    },
    {
      key: 'battery',
      header: t('common.battery', 'Battery'),
      render: (d) =>
        d.start_battery_pct != null && d.end_battery_pct != null
          ? `${d.start_battery_pct}% → ${d.end_battery_pct}%`
          : '—',
    },
  ]
}

export function RecentDrivesSection({ drives }: RecentDrivesSectionProps) {
  const { t } = useTranslation()
  const { unitPrefs } = useUnits()
  const driveColumns = useDriveColumns(unitPrefs.distance)

  return (
    <GlassPanel className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Route className="h-4 w-4 text-[var(--neon-cyan)]" />
          <span className="text-lg font-bold text-[var(--text-primary)]">
            {t('common.recentDrives', 'Recent Drives')}
          </span>
        </div>
        <Link
          to="/drives"
          className="text-xs text-[var(--text-muted)] hover:text-[var(--neon-cyan)] transition-colors flex items-center gap-1"
        >
          {t('common.viewAll', 'View all')} <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
      {drives && drives.length > 0 ? (
        <DataTable
          tableId="vehicles:detail-recent-drives"
          columns={driveColumns}
          data={drives}
          keyExtractor={(d) => d.id}
          compact
          pagination
          emptyMessage={t('common.noDrives', 'No drives recorded yet')}
        />
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Route className="h-8 w-8" />}
          message={t('common.noDrives', 'No drives recorded yet')}
        />
      )}
    </GlassPanel>
  )
}
