import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Route, ChevronRight } from 'lucide-react'

import { GlassPanel, DataTable, PanelTitle, useSortToggle, type Column } from '@/components/ui'
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

/** Stable empty reference so an absent `drives` prop never churns the sort memo. */
const EMPTY_DRIVES: Drive[] = []

function useDriveColumns(distanceUnit: DistanceUnitPref): Column<Drive>[] {
  const { t } = useTranslation()
  return useMemo(
    () => [
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
          d.start_soc_pct != null && d.end_soc_pct != null
            ? `${d.start_soc_pct}% → ${d.end_soc_pct}%`
            : '—',
      },
    ],
    [t, distanceUnit],
  )
}

export function RecentDrivesSection({ drives }: RecentDrivesSectionProps) {
  const { t } = useTranslation()
  const { unitPrefs } = useUnits()
  const driveColumns = useDriveColumns(unitPrefs.distance)

  // The Distance column advertises `sortable`, so wire the shared sort toggle
  // and re-order with a null/NaN-safe SI accessor (metres). Until a header is
  // clicked `sortKey` is empty and `sortFn` returns the API order untouched,
  // preserving the reverse-chronological order the endpoint already emits.
  const { sortKey, sortDir, onSort, sortFn } = useSortToggle()
  const sortedDrives = useMemo(
    () => sortFn(drives ?? EMPTY_DRIVES, (d, key) => (key === 'distance' ? d.distance_m ?? 0 : 0)),
    [drives, sortFn],
  )

  return (
    <GlassPanel className="p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Route className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('common.recentDrives', 'Recent Drives')}
        </PanelTitle>
        <Link
          to="/drives"
          className="flex items-center gap-1 text-xs text-[var(--text-muted)] transition-colors hover:text-cyan-300"
        >
          {t('common.viewAll', 'View all')} <ChevronRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
      {sortedDrives.length > 0 ? (
        <DataTable
          tableId="vehicles:detail-recent-drives"
          columns={driveColumns}
          data={sortedDrives}
          keyExtractor={(d) => d.id}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
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
