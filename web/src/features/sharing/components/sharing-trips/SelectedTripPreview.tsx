// Redacted "share preview" panel for the currently selected trip. Shows the
// exact reduced summary that a static share card / Helix draft would expose —
// distance, duration, energy, drives, charges, cost — never raw coordinates.
// Renders an EmptyState (panel still visible) when no trip is picked.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MapPin, ShieldCheck } from 'lucide-react'

import { GlassPanel, PanelTitle, Text } from '@/components/ui'
import { KVList, Currency } from '@/components/data-display'
import { EmptyState } from '@/components/feedback'
import { formatDate } from '@/lib/dateFormat'
import { fmtInt } from '@/lib/numberFormat'
import type { Trip } from '@/api/types'
import type { UnitFormatter } from '@/hooks/useUnits'
import { tripDurationSeconds, formatTripDuration } from './helpers'

interface SelectedTripPreviewProps {
  trip: Trip | null
  /** SI-aware distance formatter from `useUnits()` — input is meters. */
  formatDistance: UnitFormatter
  /** SI-aware energy formatter from `useUnits()` — input is watt-hours. */
  formatEnergy: UnitFormatter
}

/**
 * Context panel that fills the bento column beside the recent-trips list on
 * wide screens. Purely presentational — the parent owns the selection state.
 */
export function SelectedTripPreview({
  trip,
  formatDistance,
  formatEnergy,
}: SelectedTripPreviewProps) {
  const { t } = useTranslation()

  // Derive the redacted KVList rows once per (trip, formatter, locale) change.
  // The parent re-renders on every selection/vehicle toggle; the `useUnits()`
  // formatters are referentially stable, so memoising keeps us from rebuilding
  // the row array — including the nested <Currency> element — on unrelated
  // re-renders.
  const items = useMemo(
    () =>
      trip
        ? [
            {
              label: t('sharing.trips.preview.distance', 'Distance'),
              value: formatDistance(trip.total_distance_m),
            },
            {
              label: t('sharing.trips.preview.duration', 'Duration'),
              value: formatTripDuration(tripDurationSeconds(trip)),
            },
            {
              label: t('sharing.trips.preview.energy', 'Energy'),
              value: formatEnergy(trip.total_energy_wh),
            },
            {
              label: t('sharing.trips.preview.drives', 'Drives'),
              value: fmtInt(trip.drive_count ?? 0),
            },
            {
              label: t('sharing.trips.preview.charges', 'Charges'),
              value: fmtInt(trip.charge_count ?? 0),
            },
            ...((trip.total_cost ?? 0) > 0
              ? [
                  {
                    label: t('sharing.trips.preview.cost', 'Cost'),
                    value: <Currency value={trip.total_cost} />,
                  },
                ]
              : []),
          ]
        : [],
    [trip, formatDistance, formatEnergy, t],
  )

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('sharing.trips.preview.heading', 'Share preview')}
      </PanelTitle>

      {trip ? (
        <div className="space-y-3">
          <div className="min-w-0">
            <Text as="p" size="sm" weight="semibold" color="primary" className="truncate">
              {trip.name ?? `${t('sharing.trips.row.trip', 'Trip')} #${trip.id}`}
            </Text>
            <Text as="p" variant="caption">
              {formatDate(trip.start_date)}
              {trip.end_date ? ` – ${formatDate(trip.end_date)}` : ''}
            </Text>
          </div>

          <KVList items={items} />

          <Text as="p" variant="helper" className="flex items-start gap-1.5">
            <ShieldCheck
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300"
              aria-hidden="true"
            />
            {t(
              'sharing.trips.preview.privacy',
              'Only this redacted summary is shared — never raw coordinates or addresses.',
            )}
          </Text>
        </div>
      ) : (
        // no-action: selection-gated — the recent-trips list beside this panel is the only
        // selector; clicking a row there fills this preview, so there is nothing to trigger here.
        <EmptyState
          icon={<MapPin className="h-10 w-10" />}
          message={t(
            'sharing.trips.preview.empty',
            'Select a trip above to preview what you\u2019ll share.',
          )}
        />
      )}
    </GlassPanel>
  )
}
