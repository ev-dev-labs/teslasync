// Trip postcard and share-card image generation page.
//
// SharingTripsPage surfaces recent trips eligible for sharing in a full-width
// bento: a KPI band, a selectable recent-trips list (the hero), a live
// "share preview" of the picked trip, the static share-card hint, and — when
// AI mode and its feature toggle are enabled — the opt-in Helix image-prompt
// drafter.
//
// The /sharing/trips route must keep working in AI-off mode (ADR-015 §I3):
// withAiFeature removes the AI card from the DOM when the feature is off,
// while every deterministic section keeps rendering.
//
// Selection model:
//   - The user picks one trip from the recent-trips list. The *resolved*
//     selected trip (looked up in the current list) feeds BOTH the
//     SelectedTripPreview panel and the AI card's tripId prop, so the two can
//     never disagree: if the pick falls out of the list (e.g. a vehicle switch
//     swaps the trips) both fall back to the empty state. While no trip is
//     resolved the AI card still renders (so the positive-control on-mode test
//     can see it) but its button is disabled with an emptyHint guiding the user
//     to pick a trip first.
//
// Deliberate non-goals on this page:
//   - It does NOT replace the per-drive Share button workflow on
//     DriveDetailPage; the existing share-token flow at /s/:token is untouched.
//   - It does NOT render an editable share-card form. The propose-only AI
//     surface drafts an image prompt; the user still uses the existing
//     per-drive Share workflow to publish a static share card.

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Route as RouteIcon, Share2, Zap, Car, RefreshCw } from 'lucide-react'

import { PageContainer } from '@/components/layout'
import { GlassPanel, Button, PanelTitle, Text } from '@/components/ui'
import { MetricCard } from '@/components/data-display'
import { EmptyState, Skeleton, QueryError } from '@/components/feedback'
import { VehicleSelect } from '@/components/forms'
import { FadeIn } from '@/components/motion'
import { useTrips } from '@/api/hooks/useTrips'
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle'
import { useUnits } from '@/hooks/useUnits'
import { usePageTitle } from '@/hooks/usePageTitle'
import { fmtInt } from '@/lib/numberFormat'
import { AITripPostcardShareCardImageGeneration } from '@/components/ai/AITripPostcardShareCardImageGeneration'
import {
  TripShareRow,
  SelectedTripPreview,
  aggregateTripKpis,
} from '../components/sharing-trips'

export default function SharingTripsPage() {
  const { t } = useTranslation()
  usePageTitle(t('sharing.trips.title', 'Share a trip'))

  const { vehicleId } = useSelectedVehicle()
  const { formatDistance, formatEnergy } = useUnits()

  const tripsQuery = useTrips({ vehicle_id: vehicleId ?? undefined, limit: 20 })
  const { data: trips, isLoading, error, refetch } = tripsQuery
  const allTrips = useMemo(() => trips ?? [], [trips])

  // Selected-trip id. The recent-trips list is the only selector on this page;
  // clicking a row swaps the selection, which the preview panel + AI card
  // consume via the tripId prop.
  const [selectedTripId, setSelectedTripId] = useState<number | undefined>(undefined)
  const selectedTrip = useMemo(
    () => allTrips.find((trip) => trip.id === selectedTripId) ?? null,
    [allTrips, selectedTripId],
  )

  const kpis = useMemo(() => aggregateTripKpis(allTrips), [allTrips])
  const coldLoading = isLoading && allTrips.length === 0
  // Surface the destructive error banner only when there is nothing cached to
  // show. On a background-refetch failure TanStack Query keeps the last good
  // data, so we keep rendering it (the header freshness badge already signals
  // the staleness) instead of blowing the list + totals away with a full-panel
  // error.
  const showError = !!error && allTrips.length === 0

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <VehicleSelect
        ariaLabel={t('sharing.trips.selectVehicle', 'Select vehicle')}
      />
      <Button
        variant="ghost"
        onClick={() => refetch()}
        aria-label={t('common.refresh', 'Refresh')}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  )

  return (
    <PageContainer
      title={t('sharing.trips.title', 'Share a trip')}
      subtitle={t(
        'sharing.trips.subtitle',
        'Pick a recent trip to share as a static link, postcard, or image.',
      )}
      actions={actions}
      query={tripsQuery}
    >
      {/* 1 — KPI band: full-width responsive metric grid. On a hard error
          (nothing cached) the band degrades to a QueryError panel instead of
          showing misleading zero totals. */}
      <FadeIn>
        {showError ? (
          <GlassPanel className="p-4 sm:p-5">
            <QueryError
              error={error}
              onRetry={() => refetch()}
              resourceName={t('sharing.trips.resource', 'Trips')}
            />
          </GlassPanel>
        ) : (
          <section
            aria-label={t('sharing.trips.kpis', 'Trip totals')}
            className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
          >
            {coldLoading ? (
              [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[74px] rounded-xl" />)
            ) : (
              <>
                <MetricCard
                  label={t('sharing.trips.kpi.shareable', 'Shareable trips')}
                  value={fmtInt(kpis.count)}
                  icon={<Share2 className="h-5 w-5" />}
                  color="cyan"
                />
                <MetricCard
                  label={t('sharing.trips.kpi.distance', 'Total distance')}
                  value={formatDistance(kpis.totalDistanceM)}
                  icon={<RouteIcon className="h-5 w-5" />}
                  color="green"
                />
                <MetricCard
                  label={t('sharing.trips.kpi.energy', 'Total energy')}
                  value={formatEnergy(kpis.totalEnergyWh)}
                  icon={<Zap className="h-5 w-5" />}
                  color="amber"
                />
                <MetricCard
                  label={t('sharing.trips.kpi.drives', 'Total drives')}
                  value={fmtInt(kpis.totalDrives)}
                  icon={<Car className="h-5 w-5" />}
                  color="purple"
                />
              </>
            )}
          </section>
        )}
      </FadeIn>

      {/* 2 — Main bento: recent-trips list (hero) + share preview / static hint */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <RouteIcon className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('sharing.trips.recent.heading', 'Recent trips')}
            </PanelTitle>
            {coldLoading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}
              </div>
            ) : showError ? (
              <QueryError
                error={error}
                onRetry={() => refetch()}
                resourceName={t('sharing.trips.resource', 'Trips')}
              />
            ) : allTrips.length === 0 ? (
              // no-action: trips are created automatically by driving — no manual action available.
              <EmptyState
                icon={<RouteIcon className="h-12 w-12" />}
                message={t(
                  'sharing.trips.recent.empty',
                  'No recent trips. Drive your vehicle to populate this list.',
                )}
              />
            ) : (
              <ul
                className="space-y-2"
                role="listbox"
                aria-label={t('sharing.trips.recent.heading', 'Recent trips')}
                data-testid="sharing-trips-recent-list"
              >
                {allTrips.map((trip) => (
                  <TripShareRow
                    key={trip.id}
                    trip={trip}
                    selected={selectedTripId === trip.id}
                    onSelect={setSelectedTripId}
                    formatDistance={formatDistance}
                    formatEnergy={formatEnergy}
                  />
                ))}
              </ul>
            )}
          </GlassPanel>

          <div className="space-y-4 xl:col-span-1">
            <SelectedTripPreview
              trip={selectedTrip}
              formatDistance={formatDistance}
              formatEnergy={formatEnergy}
            />

            {/* Static share-card hint — the canonical baseline publishing
                workflow (per-drive Share button) so a user who lands here
                without AI on still sees how to share. */}
            <GlassPanel className="p-4 sm:p-5">
              <PanelTitle className="mb-2">
                {t('sharing.trips.staticHint.heading', 'Static share cards')}
              </PanelTitle>
              <Text as="p" size="sm" color="secondary" className="max-w-prose">
                {t(
                  'sharing.trips.staticHint.body',
                  'Every drive in TeslaSync can be published as a static, redacted share card from the drive detail page. Open a drive, click "Share", and copy the public link \u2014 anyone with the link can view the static card, no AI required.',
                )}
              </Text>
            </GlassPanel>
          </div>
        </section>
      </FadeIn>

      {/* 3 — AI section — withAiFeature gates visibility. In off mode this
          renders null and is invisible to the DOM (ADR-015 §I5). In on mode it
          surfaces the propose-only Helix share-card image-prompt drafting card.
          Feeds the *derived* selected trip's id (never the raw selection state)
          so a stale pick — e.g. after a vehicle switch swaps the list — cleanly
          disables the card instead of drafting against a trip that is no longer
          on screen, keeping it in lock-step with the SelectedTripPreview. */}
      <FadeIn delay={0.2}>
        <AITripPostcardShareCardImageGeneration tripId={selectedTrip?.id} />
      </FadeIn>
    </PageContainer>
  )
}
