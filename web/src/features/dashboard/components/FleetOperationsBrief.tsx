import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { type FleetServerSummary, type FleetStateEntry } from '@/api/hooks/useVehicles'
import { statusVariant } from '@/api/types'
import { Badge, Caption, Heading, Text } from '@/components/ui'
import { DataProvenanceBadge } from '@/components/data-display'
import { PrefetchLink } from '@/components/layout'
import { VisuallyHidden } from '@/components/a11y'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/cn'
import type { Vehicle } from '@/types/vehicle'

import {
  PostureDrillThrough,
  PostureActions,
  PostureTaxonomy,
  PostureWorkflows,
  buildFleetPosture,
  formatObservationAge,
} from './fleet-posture'

interface FleetOperationsBriefProps {
  vehicles: Vehicle[]
  selectedVehicle: Vehicle | null
  fleetStates: FleetStateEntry[] | undefined
  /**
   * The SERVER's own posture roll-up of the same batch, derived against the
   * request-level instant with the same trust precedence as the items.
   *
   * The panel uses it as the authoritative aggregate while it still agrees
   * with the same response's per-vehicle classifications. The client
   * derivation takes over after a reading ages across the freshness boundary
   * between polls.
   */
  summary?: FleetServerSummary | null
  /** True while the first fleet-state batch is still in flight. */
  isPending?: boolean
  /**
   * Transport failure of the batch itself. Distinct from a per-vehicle
   * failure: this one means we could not read ANY vehicle, and the panel says
   * so instead of rendering a confident, fully-populated fleet of unknowns.
   */
  isError?: boolean
  /** Re-read the authoritative fleet-state batch after an operator action. */
  onRetry?: () => Promise<unknown> | void
  /** True while the authoritative retry is in flight. */
  isRetrying?: boolean
}

/**
 * Fleet Posture.
 *
 * The bug this panel exists to prevent: the dashboard hero said "Charging"
 * while this panel said "Unknown" for the same car. Both now derive status
 * from the SAME trust-aware contract (`describeFleetState` →
 * `deriveCurrentVehicleStatus`), so they cannot disagree.
 *
 * Everything here is stated, never implied:
 *   - the six-way taxonomy separates claims about the VEHICLE (offline) from
 *     claims about our EVIDENCE (unverified / last-known / no-state /
 *     unreachable);
 *   - verified coverage is shown as "N of M verified";
 *   - the age shown is the OLDEST real backend observation in the fleet — a
 *     summary is only as fresh as its stalest member — and never a request
 *     completion time;
 *   - colour is never the sole carrier of meaning (icon + text everywhere);
 *   - the headline is inside an `aria-live="polite"` region so a screen-reader
 *     user hears posture changes without polling the page.
 */
export function FleetOperationsBrief({
  vehicles,
  selectedVehicle,
  fleetStates,
  summary = null,
  isPending = false,
  isError = false,
  onRetry = () => undefined,
  isRetrying = false,
}: FleetOperationsBriefProps) {
  const { t } = useTranslation()

  const posture = useMemo(
    () => buildFleetPosture(vehicles, fleetStates, Date.now(), summary),
    [vehicles, fleetStates, summary],
  )
  // Two different questions, and collapsing them is what would make the panel
  // lie in one direction or the other:
  //   `resolving`      — nothing has been classified yet, so per-vehicle
  //                      claims (the active scope block) are still unknown;
  //   `totalsPending`  — nothing can be TOTALLED yet. A server summary is
  //                      usable only with the entries from the same resolved
  //                      snapshot, never as a detached success-shaped fallback.
  const resolving = isPending || posture.pending
  const totalsPending = resolving && !posture.fromServerSummary
  const oldestObservedLabel = formatObservationAge(posture.oldestObservedAt, t)

  const scopeVehicle = selectedVehicle ?? vehicles[0] ?? null
  const selectedName =
    scopeVehicle?.display_name ||
    scopeVehicle?.vin ||
    t('dashboard.fleetPosture.unnamedVehicle', 'Selected vehicle')
  const scoped = scopeVehicle ? posture.byVehicleId.get(scopeVehicle.id) : undefined
  const scopedStatus = scoped?.status ?? null
  const scopedAge = formatObservationAge(scoped?.observedAt ?? null, t)

  /** One sentence an operator (or a screen reader) can act on. */
  const headline = totalsPending
    ? t('dashboard.fleetPosture.headline.resolving', 'Resolving live state for {{count}} vehicle(s).', {
      count: posture.total,
    })
    : isError
      ? t(
        'dashboard.fleetPosture.headline.unavailable',
        'Live state could not be read. Showing the last known readings, which are no longer being refreshed.',
      )
      : posture.attentionCount > 0
        ? t(
          'dashboard.fleetPosture.headline.attention',
          '{{verified}} of {{total}} vehicles verified. {{attention}} need attention.',
          {
            verified: posture.verifiedCount,
            total: posture.total,
            attention: posture.attentionCount,
          },
        )
        : t('dashboard.fleetPosture.headline.ok', 'All {{total}} vehicles verified from current telemetry.', {
          total: posture.total,
        })

  const BadgeIcon = totalsPending
    ? Icons.clock
    : isError || posture.attentionCount > 0
      ? Icons.warning
      : Icons.success
  const hasRetainedState = (fleetStates ?? []).some((entry) => entry.state != null)
  const dataProvenance = totalsPending
    ? 'unknown'
    : isError
      ? hasRetainedState ? 'cached' : 'unknown'
      : 'live'
  const dataStatus = totalsPending ? 'initial' : isError ? 'stale' : 'ok'

  return (
    <section
      aria-labelledby="fleet-operations-brief-title"
      className="overflow-hidden rounded-panel border border-[var(--border-default)] bg-[var(--surface-1)] shadow-e1"
      data-testid="fleet-operations-brief"
    >
      <div className="flex flex-col gap-4 border-b border-[var(--border-default)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 lg:px-6">
        <div className="min-w-0">
          <Caption className="font-semibold uppercase tracking-[0.1em]">
            {t('dashboard.fleetPosture.eyebrow', 'Operational brief')}
          </Caption>
          <Heading
            id="fleet-operations-brief-title"
            level="section"
            className="mt-1"
          >
            {t('dashboard.fleetPosture.title', 'Fleet posture')}
          </Heading>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DataProvenanceBadge
            provenance={dataProvenance}
            status={dataStatus}
            updatedAt={posture.oldestObservedAt}
          />
          {/* Icon + text: the badge never signals by colour alone. */}
          <Badge
            variant={
              totalsPending ? 'neutral' : isError || posture.attentionCount > 0 ? 'warning' : 'success'
            }
            size="lg"
            className="inline-flex max-w-full items-center gap-1.5 self-start sm:self-auto"
          >
            <BadgeIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {totalsPending
                ? t('dashboard.fleetPosture.badge.resolving', 'Checking live state')
                : isError
                  ? t('dashboard.fleetPosture.badge.unavailable', 'Live state unavailable')
                  : t('dashboard.fleetPosture.badge.verified', '{{verified}} of {{total}} verified', {
                    verified: posture.verifiedCount,
                    total: posture.total,
                  })}
            </span>
          </Badge>
        </div>
      </div>

      {/* Posture changes are announced, not just repainted. */}
      <VisuallyHidden as="p" liveRegion data-testid="fleet-posture-announcement">
        {headline}
      </VisuallyHidden>

      <div className="grid xl:grid-cols-[minmax(0,1.35fr)_minmax(24rem,0.65fr)]">
        <div className="border-b border-[var(--border-default)] p-4 sm:p-5 lg:p-6 xl:border-b-0 xl:border-e">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <Caption>
                {t('dashboard.fleetPosture.activeScope', 'Active vehicle scope')}
              </Caption>
              <div className="mt-2 flex flex-wrap items-center gap-2 sm:gap-3">
                <Heading level="section" className="min-w-0 break-words">{selectedName}</Heading>
                {scopedStatus != null ? (
                  <Badge variant={statusVariant(scopedStatus)} size="sm" dot>
                    {scopedStatus}
                  </Badge>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
                    <Icons.helpCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    {resolving
                      ? t('dashboard.fleetPosture.scope.checking', 'Checking')
                      : t('dashboard.fleetPosture.scope.unknown', 'Unknown')}
                  </span>
                )}
              </div>
              <Text as="p" variant="bodySm" className="mt-3 max-w-2xl leading-relaxed">
                {scopeExplanation(scoped?.condition, scopedStatus, resolving, t)}
              </Text>
              <Caption className="mt-2 block">
                {scopedAge
                  ? t('dashboard.fleetPosture.scope.observed', 'Last real observation {{age}}', { age: scopedAge })
                  : t('dashboard.fleetPosture.scope.noObservation', 'No verified observation time for this vehicle')}
              </Caption>
            </div>

            {scopeVehicle != null && (
              <PrefetchLink
                to={`/vehicles/${scopeVehicle.id}`}
                className={cn(
                  'inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-shape-md border px-4 text-sm font-medium transition-colors',
                  'border-[var(--control-border)] bg-[var(--control-bg)] text-[var(--text-primary)]',
                  'hover:border-[var(--control-border-hover)] hover:bg-[var(--control-bg-hover)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
                )}
              >
                {t('dashboard.fleetPosture.openVehicle', 'Open vehicle')}
                <Icons.drillThrough className="h-4 w-4" aria-hidden="true" />
              </PrefetchLink>
            )}
          </div>

          <dl className="mt-6 grid grid-cols-2 overflow-hidden rounded-shape-lg border border-[var(--border-default)] bg-[var(--surface-2)] sm:grid-cols-4">
            <BriefMetric
              label={t('dashboard.fleetPosture.metric.fleet', 'Fleet')}
              value={String(posture.total)}
              hint={t('dashboard.fleetPosture.metric.fleetHelp', 'registered')}
            />
            <BriefMetric
              label={t('dashboard.fleetPosture.metric.verified', 'Verified')}
              value={totalsPending ? '—' : `${posture.verifiedCount}/${posture.total}`}
              hint={
                totalsPending
                  ? t('dashboard.fleetPosture.metric.resolvingHelp', 'checking live state')
                  : t('dashboard.fleetPosture.metric.verifiedHelp', 'current telemetry')
              }
              tone={totalsPending ? 'default' : posture.verifiedCount === posture.total ? 'positive' : 'warning'}
            />
            <BriefMetric
              label={t('dashboard.fleetPosture.metric.attention', 'Attention')}
              value={totalsPending ? '—' : String(posture.attentionCount)}
              hint={
                totalsPending
                  ? t('dashboard.fleetPosture.metric.resolvingHelp', 'checking live state')
                  : t('dashboard.fleetPosture.metric.attentionHelp', 'exceptions')
              }
              tone={totalsPending ? 'default' : posture.attentionCount > 0 ? 'warning' : 'positive'}
            />
            <BriefMetric
              label={t('dashboard.fleetPosture.metric.oldest', 'Oldest reading')}
              value={oldestObservedLabel ?? '—'}
              hint={
                oldestObservedLabel
                  ? t('dashboard.fleetPosture.metric.oldestHelp', 'observed, not fetched')
                  : t('dashboard.fleetPosture.metric.oldestNone', 'no verified observation')
              }
            />
          </dl>

          <PostureTaxonomy counts={posture.counts} pending={totalsPending} />
        </div>

        <div className="p-4 sm:p-5 lg:p-6">
          <Caption className="font-semibold uppercase tracking-[0.1em]">
            {t('dashboard.fleetPosture.investigate', 'Investigate')}
          </Caption>
          <PostureActions
            posture={posture}
            vehicleId={scopeVehicle?.id}
            retrying={isRetrying}
            onRetry={onRetry}
          />
          <PostureDrillThrough vehicleId={scopeVehicle?.id} />
          <PostureWorkflows />
        </div>
      </div>
    </section>
  )
}

/** Plain-language reason the scoped vehicle is in the state it is in. */
function scopeExplanation(
  condition: string | undefined,
  status: string | null,
  resolving: boolean,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (resolving || condition == null || condition === 'pending') {
    return t(
      'dashboard.fleetPosture.scope.resolvingHelp',
      'Resolving the latest verified telemetry before assessing this vehicle.',
    )
  }
  switch (condition) {
    case 'live':
      return status === 'offline'
        ? t(
          'dashboard.fleetPosture.scope.offlineHelp',
          'The vehicle reported itself offline. Last-known records remain available while live controls wait for reconnection.',
        )
        : t(
          'dashboard.fleetPosture.scope.healthyHelp',
          'Vehicle data is reporting normally. Global pages and filters follow this selection.',
        )
    case 'unverified':
      return t(
        'dashboard.fleetPosture.scope.unverifiedHelp',
        'State was returned, but nothing current backs it. Values shown elsewhere may be a durable record rather than live telemetry.',
      )
    case 'stale':
      return t(
        'dashboard.fleetPosture.scope.staleHelp',
        'The refresh failed, so the last real reading is being retained. Its age keeps growing until telemetry returns.',
      )
    case 'missing':
      return t(
        'dashboard.fleetPosture.scope.missingHelp',
        'The backend answered and has no state for this vehicle yet. That is unknown, not offline.',
      )
    default:
      return t(
        'dashboard.fleetPosture.scope.failedHelp',
        'The live-state request failed. This is a fact about our pipeline, not about the vehicle.',
      )
  }
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
    <div className="border-b border-e border-[var(--border-default)] p-3 last:border-e-0 sm:border-b-0 sm:p-4">
      <dt className="text-xs font-medium text-[var(--text-muted)]">{label}</dt>
      <dd
        className={cn(
          'mt-1 text-xl font-semibold tabular-nums tracking-tight sm:text-2xl',
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
