import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Route, ChevronRight } from 'lucide-react'

import { GlassPanel, DataTable, type Column } from '@/components/ui'
import { EmptyState } from '@/components/feedback'
import { useSettings } from '@/hooks/useSettings'
import { formatDateTime } from '@/lib/dateFormat'
import { fmtNumber } from '@/lib/numberFormat'
import type { Drive } from '@/api/types'
import { durationStr } from './helpers'

interface RecentDrivesSectionProps {
  drives: Drive[] | undefined
}

function useDriveColumns(convertDistance: (v: number) => number, distanceUnit: string): Column<Drive>[] {
  const { t } = useTranslation()
  return [
    {
      key: 'date',
      header: t('common.date', 'Date'),
      render: (d) => formatDateTime(d.start_date),
    },
    {
      key: 'distance',
      header: t('common.distance', 'Distance'),
      render: (d) => `${fmtNumber(convertDistance(d.distance))} ${distanceUnit}`,
      sortable: true,
    },
    {
      key: 'duration',
      header: t('common.duration', 'Duration'),
      render: (d) => durationStr(d.duration_min),
    },
    {
      key: 'battery',
      header: t('common.battery', 'Battery'),
      render: (d) =>
        d.start_battery_level != null && d.end_battery_level != null
          ? `${d.start_battery_level}% → ${d.end_battery_level}%`
          : '—',
    },
  ]
}

export function RecentDrivesSection({ drives }: RecentDrivesSectionProps) {
  const { t } = useTranslation()
  const { convertDistance, distanceUnit } = useSettings()
  const driveColumns = useDriveColumns(convertDistance, distanceUnit)

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
          columns={driveColumns}
          data={drives}
          keyExtractor={(d) => d.id}
          compact
          pagination
          emptyMessage={t('common.noDrives', 'No drives recorded yet')}
        />
      ) : (
        <EmptyState
          icon={<Route className="h-8 w-8" />}
          message={t('common.noDrives', 'No drives recorded yet')}
        />
      )}
    </GlassPanel>
  )
}
