import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Route, ChevronRight } from 'lucide-react'

import { GlassPanel, DataTable, PanelTitle, BUTTON_BASE, useSortToggle, type Column, type MobileDataTablePresentation } from '@/components/ui'
import { EmptyState } from '@/components/feedback'
import { useUnits } from '@/hooks/useUnits'
import { convertDistanceFromSI, type DistanceUnitPref } from '@/lib/unitConversion'
import { useDateFormat, type UseDateFormatResult } from '@/hooks/useDateFormat'

import type { Drive } from '@/api/types'
import { durationStr } from './helpers'
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface RecentDrivesSectionProps {
  drives: Drive[] | undefined
}

/** Stable empty reference so an absent `drives` prop never churns the sort memo. */
const EMPTY_DRIVES: Drive[] = []

function useDriveColumns(
  distanceUnit: DistanceUnitPref,
  { formatDateTime, locale, tz }: UseDateFormatResult,
): { columns: Column<Drive>[]; mobilePresentation: MobileDataTablePresentation<Drive> } {
  const { fmtNumber, precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const { t } = useTranslation()
  return useMemo(
    () => {
      const display: Record<string, (drive: Drive) => string> = {
        date: (d) => formatDateTime(d.start_ts),
        distance: (d) => `${fmtNumber(convertDistanceFromSI(d.distance_m ?? 0, distanceUnit))} ${distanceUnit}`,
        duration: (d) => durationStr((d.duration_s ?? 0) / 60),
        battery: (d) => d.start_soc_pct != null && d.end_soc_pct != null
          ? `${d.start_soc_pct}% → ${d.end_soc_pct}%`
          : '—',
      }
      const columns: Column<Drive>[] = [
        {
          key: 'date',
          header: t('common.date', 'Date'),
          render: display.date,
        },
        {
          key: 'distance',
          align: 'right',
          header: t('common.distance', 'Distance'),
          render: display.distance,
          sortable: true,
        },
        {
          key: 'duration',
          align: 'right',
          header: t('common.duration', 'Duration'),
          render: display.duration,
        },
        {
          key: 'battery',
          align: 'right',
          header: t('common.battery', 'Battery'),
          render: display.battery,
        },
      ]
      const mobilePresentation: MobileDataTablePresentation<Drive> = {
        roles: { date: 'title', distance: 'primary', duration: 'meta', battery: 'meta' },
        displayValue: (drive, key) => display[key]?.(drive),
      }
      return { columns, mobilePresentation }
    },
    [t, distanceUnit, fmtNumber, displayPrecision, displayLocale, formatDateTime, locale, tz],
  )
}

export function RecentDrivesSection({ drives }: RecentDrivesSectionProps) {
  const { t } = useTranslation()
  const { unitPrefs } = useUnits()
  const dateFormat = useDateFormat()
  const { columns: driveColumns, mobilePresentation } = useDriveColumns(unitPrefs.distance, dateFormat)

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
    <GlassPanel className="min-w-0 p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <PanelTitle className="flex items-center gap-2">
            <Route className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            {t('common.recentDrives', 'Recent drives')}
          </PanelTitle>
        </div>
        <Link
          to="/drives"
          className={`${BUTTON_BASE} min-h-11 min-w-11 shrink-0 gap-1 px-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]`}
        >
          {t('common.viewAll', 'View all')} <ChevronRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
      {sortedDrives.length > 0 ? (
        <DataTable
          tableId="vehicles:detail-recent-drives"
          name={t('common.recentDrives', 'Recent drives')}
          columns={driveColumns}
          mobilePresentation={mobilePresentation}
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
