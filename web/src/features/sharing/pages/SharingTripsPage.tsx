// Trip postcard and share-card image generation page.
//
// SharingTripsPage surfaces recent trips eligible for sharing, keeps the
// existing share-card management hints, and conditionally renders the opt-in
// AI image prompt drafter when AI mode and its feature toggle are enabled.
//
// The /sharing/trips route must keep working in AI-off mode (ADR-015 §I3).
// withAiFeature removes the AI card from the DOM when the feature is off.
//
// Selection model:
//   - The user picks one trip from the recent-trips list. The
//     picked trip's id is the input the AI card consumes. While
//     no trip is selected, the AI card still renders (so the
//     positive-control on-mode test can see it) but its button
//     is disabled with an emptyHint guiding the user to pick a
//     trip first — same UX as AISoftwareUpdateChangelogSummarizer
//     when no vehicle is in scope.
//
// Deliberate non-goals on this page:
//   - It does NOT replace the per-drive Share button workflow on
//     DriveDetailPage; the existing share-token flow that lands
//     at /s/:token is untouched.
//   - It does NOT render an editable share-card form. The
//     propose-only AI surface drafts an image prompt; the user
//     still uses the existing per-drive Share workflow to publish
//     a static share card.

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Route as RouteIcon, Calendar, MapPin, Zap, Clock } from 'lucide-react'

import { PageContainer } from '@/components/layout'
import { GlassPanel } from '@/components/ui'
import { EmptyState, Skeleton } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { InlineMetric } from '@/components/data-display'
import { useTrips } from '@/api/hooks/useTrips'
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle'
import { useUnits } from '@/hooks/useUnits'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDate } from '@/lib/dateFormat'
import { fmtInt, fmtNumber } from '@/lib/numberFormat'
import { convertDistanceFromSI } from '@/lib/unitConversion'
import { AITripPostcardShareCardImageGeneration } from '@/components/ai/AITripPostcardShareCardImageGeneration'

function formatDuration(startDate: string, endDate: string | null): string {
  if (!endDate) return '—'
  const ms = new Date(endDate).getTime() - new Date(startDate).getTime()
  const hours = Math.floor(ms / 3600000)
  const minsRaw = (ms % 3600000) / 60000
  if (hours === 0) return `${fmtInt(minsRaw)}m`
  return minsRaw >= 0.5 ? `${hours}h ${fmtInt(minsRaw)}m` : `${hours}h`
}

export default function SharingTripsPage() {
  const { t } = useTranslation()
  usePageTitle(t('sharing.trips.title', 'Share a trip'))

  const { vehicleId } = useSelectedVehicle()
  const { unitPrefs } = useUnits()

  const tripsQuery = useTrips({
    vehicle_id: vehicleId ?? undefined,
    limit: 20,
  })
  const { data: trips, isLoading } = tripsQuery
  const allTrips = useMemo(() => trips ?? [], [trips])

  // Selected-trip id. The recent-trips list is the only selector
  // on this page; clicking a row swaps the selection, which the
  // AI card consumes via the tripId prop.
  const [selectedTripId, setSelectedTripId] = useState<number | undefined>(
    undefined,
  )

  return (
    <PageContainer
      title={t('sharing.trips.title', 'Share a trip')}
      subtitle={t(
        'sharing.trips.subtitle',
        'Pick a recent trip to share as a static link, postcard, or image.',
      )}
      loading={isLoading}
    >
      {/* Recent trips list — the deterministic baseline list of
          shareable trips. Always rendered, regardless of AI
          mode. */}
      <FadeIn delay={0.05}>
        <GlassPanel className="p-4 sm:p-6">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
            {t('sharing.trips.recent.heading', 'Recent trips')}
          </h3>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          ) : allTrips.length === 0 ? (
            // no-action: trips are created automatically by the vehicle driving — no manual action available.
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
              {allTrips.map((trip) => {
                const isSelected = selectedTripId === trip.id
                const distanceDisplay = convertDistanceFromSI(
                  trip.total_distance_m,
                  unitPrefs.distance,
                )
                return (
                  <li key={trip.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected ? 'true' : 'false'}
                      onClick={() => setSelectedTripId(trip.id)}
                      className={
                        'w-full text-left rounded-xl border p-3 sm:p-4 transition-colors ' +
                        (isSelected
                          ? 'border-cyan-400/60 bg-cyan-500/5'
                          : 'border-[var(--border-subtle)] bg-white/[0.02] hover:border-[var(--border-strong)] hover:bg-white/[0.04]')
                      }
                    >
                      <div className="flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-cyan-500/10 flex items-center justify-center">
                            <RouteIcon className="h-4 w-4 text-cyan-300" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-[var(--text-primary)]">
                              {trip.name ??
                                `${t('sharing.trips.row.trip', 'Trip')} #${trip.id}`}
                            </p>
                            <div className="flex flex-wrap items-center gap-3 mt-0.5">
                              <InlineMetric
                                icon={<Calendar />}
                                value={formatDate(trip.start_date)}
                              />
                              <InlineMetric
                                icon={<Clock />}
                                value={formatDuration(
                                  trip.start_date,
                                  trip.end_date ?? null,
                                )}
                              />
                              <span className="text-[11px] text-[var(--text-muted)]">
                                {t(
                                  'sharing.trips.row.drives',
                                  '{{count}} drives',
                                  { count: trip.drive_count },
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 sm:gap-6 text-right w-full sm:w-auto justify-end">
                          <div>
                            <p className="text-sm font-bold text-[var(--text-primary)]">
                              <MapPin className="inline h-3 w-3 mr-1 text-cyan-300" />
                              {fmtInt(distanceDisplay)} {unitPrefs.distance}
                            </p>
                          </div>
                          <div>
                            <p className="text-sm font-bold text-amber-300">
                              <Zap className="inline h-3 w-3 mr-1" />
                              {fmtNumber(trip.total_energy_wh)} Wh
                            </p>
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </GlassPanel>
      </FadeIn>

      {/* Static share-card hint — surfaces the canonical baseline
          publishing workflow (per-drive Share button) so a user
          who lands here without AI on still sees how to share. */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-4 sm:p-6 mt-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
            {t(
              'sharing.trips.staticHint.heading',
              'Static share cards',
            )}
          </h3>
          <p className="text-sm text-[var(--text-secondary)]">
            {t(
              'sharing.trips.staticHint.body',
              'Every drive in TeslaSync can be published as a static, redacted share card from the drive detail page. Open a drive, click "Share", and copy the public link \u2014 anyone with the link can view the static card, no AI required.',
            )}
          </p>
        </GlassPanel>
      </FadeIn>

      {/* AI section — withAiFeature gates visibility. In off mode
          this renders null and is invisible to the DOM (ADR-015 §I5).
          In on mode it surfaces the propose-only Helix share-card
          image-prompt drafting card. */}
      <FadeIn delay={0.15}>
        <div className="mt-4">
          <AITripPostcardShareCardImageGeneration tripId={selectedTripId} />
        </div>
      </FadeIn>
    </PageContainer>
  )
}
