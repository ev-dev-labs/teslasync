import { useTranslation } from 'react-i18next'
import { AlertTriangle, Car, Network, Radio, BookOpen } from 'lucide-react'
import { MetricCard } from '@/components/data-display'
import { TESLA_ENDPOINTS, TELEMETRY_FIELDS, REFERENCE_LINKS } from './constants'

interface DevToolsOverviewProps {
  /** Number of vehicles with fleet-telemetry configuration errors (live). */
  errorVinCount: number
  /** Number of vehicles in the fleet (live). */
  vehicleCount: number
  /** True while either live source is still resolving. */
  loading?: boolean
  /**
   * True when a live source failed with no data to fall back on. The two
   * live KPIs then render the "—" placeholder instead of a fabricated `0`
   * that would read as a healthy fleet. The static catalog KPIs are always
   * derived from local constants, so they stay truthful regardless.
   */
  errored?: boolean
}

// Catalog sizes are static — computed once from the shared constants so the
// KPI counts can never drift from the reference tables the tabs render.
const TELEMETRY_SIGNAL_COUNT = TELEMETRY_FIELDS.reduce(
  (sum, category) => sum + category.fields.length,
  0,
)

/**
 * DevToolsOverview — the always-visible KPI cockpit band. Mixes live fleet
 * health (telemetry errors, vehicle count) with the sizes of the developer
 * catalogs surfaced across the tabs, so the page opens with an at-a-glance
 * status summary instead of a bare tab strip.
 */
export function DevToolsOverview({ errorVinCount, vehicleCount, loading = false, errored = false }: DevToolsOverviewProps) {
  const { t } = useTranslation()

  const placeholder = '—'
  const errors = errorVinCount ?? 0
  const vehicles = vehicleCount ?? 0
  // Live metrics are unknown while loading or when the source errored with
  // no cached value — show the placeholder instead of a misleading count.
  const liveUnknown = loading || errored
  // While the error count is unknown, health-coding the icon green ("0 errors,
  // healthy") or red would contradict the "—" placeholder and imply a fleet
  // status we can't vouch for — fall back to a neutral tone until it resolves.
  const telemetryTone = liveUnknown ? 'cyan' : errors > 0 ? 'red' : 'green'

  return (
    <section
      aria-label={t('devtools.overview.title', 'Developer tools overview')}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-5"
    >
      <MetricCard
        label={t('devtools.overview.telemetryErrors', 'Telemetry Errors')}
        value={liveUnknown ? placeholder : errors}
        subtitle={t('devtools.overview.affectedVins', 'affected VINs')}
        icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
        color={telemetryTone}
      />
      <MetricCard
        label={t('devtools.overview.vehicles', 'Vehicles')}
        value={liveUnknown ? placeholder : vehicles}
        subtitle={t('devtools.overview.inFleet', 'in fleet')}
        icon={<Car className="h-5 w-5" aria-hidden="true" />}
        color="cyan"
      />
      <MetricCard
        label={t('devtools.overview.fleetEndpoints', 'Fleet API Endpoints')}
        value={TESLA_ENDPOINTS.length}
        subtitle={t('devtools.overview.documented', 'documented')}
        icon={<Network className="h-5 w-5" aria-hidden="true" />}
        color="blue"
      />
      <MetricCard
        label={t('devtools.overview.telemetrySignals', 'Telemetry Signals')}
        value={TELEMETRY_SIGNAL_COUNT}
        subtitle={t('devtools.overview.streamedFields', 'streamed fields')}
        icon={<Radio className="h-5 w-5" aria-hidden="true" />}
        color="purple"
      />
      <MetricCard
        label={t('devtools.overview.referenceDocs', 'Reference Docs')}
        value={REFERENCE_LINKS.length}
        subtitle={t('devtools.overview.externalLinks', 'external links')}
        icon={<BookOpen className="h-5 w-5" aria-hidden="true" />}
        color="amber"
      />
    </section>
  )
}
