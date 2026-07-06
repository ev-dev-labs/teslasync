// One selectable trip row in the Sharing → Trips recent-trips listbox.
// Extracted from SharingTripsPage so the page stays a thin orchestrator and
// the row's selection + null-safety live in one tested place.

import { useTranslation } from 'react-i18next'
import { Route as RouteIcon, Calendar, MapPin, Zap, Clock, Car } from 'lucide-react'

import { Text, SelectableCard } from '@/components/ui'
import { InlineMetric } from '@/components/data-display'
import { formatDate } from '@/lib/dateFormat'
import type { Trip } from '@/api/types'
import type { UnitFormatter } from '@/hooks/useUnits'
import { tripDurationSeconds, formatTripDuration } from './helpers'

interface TripShareRowProps {
  trip: Trip
  selected: boolean
  onSelect: (id: number) => void
  /** SI-aware distance formatter from `useUnits()` — input is meters. */
  formatDistance: UnitFormatter
  /** SI-aware energy formatter from `useUnits()` — input is watt-hours. */
  formatEnergy: UnitFormatter
}

/**
 * Renders a single `role="option"` inside the parent `role="listbox"`.
 * Clicking swaps the page-level selection; the whole row is a ≥44px touch
 * target and reflects selection with both a border/background change AND
 * `aria-selected` so status is not conveyed by color alone.
 */
export function TripShareRow({
  trip,
  selected,
  onSelect,
  formatDistance,
  formatEnergy,
}: TripShareRowProps) {
  const { t } = useTranslation()
  // Fall back to a stable "Trip #<id>" label when the trip has no usable name.
  // A bare `??` would let an empty or whitespace-only `name` through, producing
  // a blank visible title AND an empty `aria-label` on the option — so guard on
  // trimmed content, not just null/undefined.
  const name =
    trip.name && trip.name.trim().length > 0
      ? trip.name
      : `${t('sharing.trips.row.trip', 'Trip')} #${trip.id}`

  return (
    <li>
      <SelectableCard
        role="option"
        selected={selected}
        aria-label={name}
        onClick={() => onSelect(trip.id)}
      >
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-500/10"
            >
              <RouteIcon className="h-4 w-4 text-cyan-300" />
            </span>
            <div className="min-w-0">
              <Text as="p" size="sm" weight="semibold" color="primary" className="truncate">
                {name}
              </Text>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <InlineMetric
                  icon={<Calendar aria-hidden="true" />}
                  value={formatDate(trip.start_date)}
                />
                <InlineMetric
                  icon={<Clock aria-hidden="true" />}
                  value={formatTripDuration(tripDurationSeconds(trip))}
                />
                <InlineMetric
                  icon={<Car aria-hidden="true" />}
                  value={t('sharing.trips.row.drives', '{{count}} drives', {
                    count: trip.drive_count ?? 0,
                  })}
                />
              </div>
            </div>
          </div>
          <div className="flex w-full items-center justify-end gap-4 sm:w-auto sm:gap-6">
            <Text
              as="span"
              size="sm"
              weight="medium"
              color="primary"
              className="inline-flex items-center gap-1"
            >
              <MapPin className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
              {formatDistance(trip.total_distance_m)}
            </Text>
            <Text
              as="span"
              size="sm"
              weight="medium"
              className="inline-flex items-center gap-1 text-amber-300"
            >
              <Zap className="h-3.5 w-3.5" aria-hidden="true" />
              {formatEnergy(trip.total_energy_wh)}
            </Text>
          </div>
        </div>
      </SelectableCard>
    </li>
  )
}
