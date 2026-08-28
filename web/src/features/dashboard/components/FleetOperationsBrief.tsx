import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  deriveCurrentVehicleStatus,
  type FleetStateEntry,
} from '@/api/hooks/useVehicles'
import { statusVariant } from '@/api/types'
import { Badge, Caption, Heading, Text } from '@/components/ui'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/cn'
import type { Vehicle } from '@/types/vehicle'

interface FleetOperationsBriefProps {
  vehicles: Vehicle[]
  selectedVehicle: Vehicle | null
  fleetStates: FleetStateEntry[] | undefined
}

const ACTIVE_STATES = new Set([
  'online',
  'driving',
  'charging',
  'parked',
  'updating',
])

export function FleetOperationsBrief({
  vehicles,
  selectedVehicle,
  fleetStates,
}: FleetOperationsBriefProps) {
  const { t } = useTranslation('dashboard')
  const liveStateReady = fleetStates !== undefined
  const stateByVehicleId = new Map(
    (fleetStates ?? []).map((entry) => [entry.vehicle.id, entry]),
  )
  const statusByVehicleId = new Map(
    vehicles.map((vehicle) => [
      vehicle.id,
      deriveCurrentVehicleStatus(stateByVehicleId.get(vehicle.id)),
    ]),
  )
  const reportingCount = liveStateReady
    ? vehicles.filter((vehicle) =>
        ACTIVE_STATES.has(statusByVehicleId.get(vehicle.id) ?? ''),
      ).length
    : 0
  const attentionCount = liveStateReady
    ? vehicles.filter((vehicle) => {
        const status = statusByVehicleId.get(vehicle.id)
        return status == null || status === 'offline'
      }).length
    : 0
  const scopeVehicle = selectedVehicle ?? vehicles[0] ?? null
  const selectedName =
    scopeVehicle?.display_name ||
    scopeVehicle?.vin ||
    t('operations.unnamedVehicle', 'Selected vehicle')
  const selectedStatus = scopeVehicle
    ? statusByVehicleId.get(scopeVehicle.id) ?? null
    : null
  const selectedState = !liveStateReady
    ? t('operations.checkingState', 'Checking live state')
    : selectedStatus ?? t('operations.unknownState', 'Unknown')
  const selectedHealthy =
    liveStateReady && selectedStatus != null && selectedStatus !== 'offline'
  const selectedId = scopeVehicle?.id

  const workflows = [
    {
      to: '/live',
      icon: Icons.map,
      label: t('operations.workflow.live', 'Live map'),
      description: t('operations.workflow.liveHelp', 'Position and movement'),
    },
    {
      to: '/notifications/alerts',
      icon: Icons.notificationsActive,
      label: t('operations.workflow.alerts', 'Review alerts'),
      description: t(
        'operations.workflow.alertsHelp',
        'Exceptions requiring attention',
      ),
    },
    {
      to: '/charging',
      icon: Icons.charging,
      label: t('operations.workflow.charging', 'Charging'),
      description: t(
        'operations.workflow.chargingHelp',
        'Sessions, cost, and readiness',
      ),
    },
    {
      to: '/battery',
      icon: Icons.battery,
      label: t('operations.workflow.battery', 'Battery'),
      description: t(
        'operations.workflow.batteryHelp',
        'Capacity and health evidence',
      ),
    },
  ]

  return (
    <section
      aria-labelledby="fleet-operations-brief-title"
      className="overflow-hidden rounded-panel border border-[var(--border-default)] bg-[var(--surface-1)] shadow-e1"
      data-testid="fleet-operations-brief"
    >
      <div className="flex flex-col gap-4 border-b border-[var(--border-default)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-6">
        <div>
          <Caption className="font-semibold uppercase tracking-[0.1em]">
            {t('operations.eyebrow', 'Operational brief')}
          </Caption>
          <Heading
            id="fleet-operations-brief-title"
            level="section"
            className="mt-1"
          >
            {t('operations.title', 'Fleet posture')}
          </Heading>
        </div>
        <Badge
          variant={
            !liveStateReady
              ? 'neutral'
              : attentionCount > 0
                ? 'warning'
                : 'success'
          }
          size="lg"
          dot
          className="self-start sm:self-auto"
        >
          {!liveStateReady
            ? t('operations.checkingFleet', 'Checking live state')
            : attentionCount > 0
              ? t('operations.attention', '{{count}} need attention', {
                  count: attentionCount,
                })
              : t('operations.ready', 'No active exceptions')}
        </Badge>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1.35fr)_minmax(30rem,0.65fr)]">
        <div className="border-b border-[var(--border-default)] p-5 lg:p-6 xl:border-b-0 xl:border-e">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <Caption>
                {t('operations.activeScope', 'Active vehicle scope')}
              </Caption>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Heading level="section">{selectedName}</Heading>
                <Badge
                  variant={
                    !liveStateReady
                      ? 'neutral'
                      : selectedStatus == null
                        ? 'warning'
                        : statusVariant(selectedStatus)
                  }
                  size="sm"
                  dot
                >
                  {selectedState}
                </Badge>
              </div>
              <Text
                as="p"
                variant="bodySm"
                className="mt-3 max-w-2xl leading-relaxed"
              >
                {!liveStateReady
                  ? t(
                      'operations.scopeChecking',
                      'Resolving the latest verified telemetry before assessing this vehicle.',
                    )
                  : selectedHealthy
                    ? t(
                        'operations.scopeHealthy',
                        'Vehicle data is reporting normally. Global pages and filters follow this selection.',
                      )
                    : selectedStatus === 'offline'
                      ? t(
                          'operations.scopeOffline',
                          'The selected vehicle is offline. Last-known records remain available while live controls wait for reconnection.',
                        )
                      : t(
                          'operations.scopeAttention',
                          'Current vehicle state could not be verified. Review telemetry health before relying on live controls.',
                        )}
              </Text>
            </div>

            {selectedId != null && (
              <Link
                to={`/vehicles/${selectedId}`}
                className={cn(
                  'inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-shape-md border px-4 text-sm font-medium transition-colors',
                  'border-[var(--control-border)] bg-[var(--control-bg)] text-[var(--text-primary)]',
                  'hover:border-[var(--control-border-hover)] hover:bg-[var(--control-bg-hover)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
                )}
              >
                {t('operations.openVehicle', 'Open vehicle')}
                <Icons.drillThrough className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}
          </div>

          <dl className="mt-6 grid grid-cols-2 overflow-hidden rounded-shape-lg border border-[var(--border-default)] bg-[var(--surface-2)] sm:grid-cols-4">
            <BriefMetric
              label={t('operations.metric.fleet', 'Fleet')}
              value={String(vehicles.length)}
              hint={t('operations.metric.fleetHelp', 'registered')}
            />
            <BriefMetric
              label={t('operations.metric.reporting', 'Reporting')}
              value={liveStateReady ? String(reportingCount) : '—'}
              hint={
                liveStateReady
                  ? t('operations.metric.reportingHelp', 'reachable now')
                  : t('operations.metric.resolvingHelp', 'checking live state')
              }
            />
            <BriefMetric
              label={t('operations.metric.attention', 'Attention')}
              value={liveStateReady ? String(attentionCount) : '—'}
              hint={
                liveStateReady
                  ? t('operations.metric.attentionHelp', 'exceptions')
                  : t('operations.metric.resolvingHelp', 'checking live state')
              }
              tone={
                !liveStateReady
                  ? 'default'
                  : attentionCount > 0
                    ? 'warning'
                    : 'positive'
              }
            />
            <BriefMetric
              label={t('operations.metric.scope', 'Scope')}
              value={selectedVehicle ? '1' : String(vehicles.length)}
              hint={
                selectedVehicle
                  ? t('operations.metric.scopeVehicle', 'selected vehicle')
                  : t('operations.metric.scopeFleet', 'entire fleet')
              }
            />
          </dl>
        </div>

        <div className="p-5 lg:p-6">
          <Caption className="font-semibold uppercase tracking-[0.1em]">
            {t('operations.workflows', 'Primary workflows')}
          </Caption>
          <nav
            aria-label={t('operations.workflows', 'Primary workflows')}
            className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1"
          >
            {workflows.map((workflow) => (
              <Link
                key={workflow.to}
                to={workflow.to}
                className="group flex min-h-14 items-center gap-3 rounded-shape-md border border-transparent px-3 py-2 transition-colors hover:border-[var(--border-default)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-shape-md border border-[var(--border-default)] bg-[var(--surface-2)] text-[var(--theme-primary)]">
                  <workflow.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <Text as="span" weight="medium">
                    {workflow.label}
                  </Text>
                  <Caption className="mt-0.5 block truncate">
                    {workflow.description}
                  </Caption>
                </span>
                <Icons.next
                  className="h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--text-secondary)]"
                  aria-hidden="true"
                />
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </section>
  )
}

function BriefMetric({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint: string
  tone?: 'default' | 'positive' | 'warning'
}) {
  return (
    <div className="border-b border-e border-[var(--border-default)] p-4 last:border-e-0 sm:border-b-0">
      <dt className="text-xs font-medium text-[var(--text-muted)]">{label}</dt>
      <dd
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums tracking-tight',
          tone === 'positive' && 'text-emerald-700 dark:text-emerald-300',
          tone === 'warning' && 'text-amber-700 dark:text-amber-300',
          tone === 'default' && 'text-[var(--text-primary)]',
        )}
      >
        {value}
        <Caption className="mt-1 block">{hint}</Caption>
      </dd>
    </div>
  )
}
