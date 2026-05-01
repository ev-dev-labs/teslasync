import { useTranslation } from 'react-i18next'
import { Headphones, Navigation2, MapPin } from 'lucide-react'
import { GlassPanel, Badge } from '@/components/ui'
import { useSettings } from '@/hooks/useSettings'
import { cleanNil } from '@/lib/cleanNil'
import { fmtNumber, fmtInt } from '@/lib/numberFormat'
import type { MediaSnapshot, LocationSnapshot } from '@/api/types'

interface MediaNavigationPanelProps {
  mediaData: MediaSnapshot | null | undefined
  locationData: LocationSnapshot | null | undefined
}

export function MediaNavigationPanel({ mediaData, locationData }: MediaNavigationPanelProps) {
  const { t } = useTranslation()
  const { convertDistance, distanceUnit } = useSettings()

  return (
    <GlassPanel className="p-6 h-full">
      <h3 className="section-title flex items-center gap-2 mb-5">
        <Headphones className="h-4 w-4 text-purple-300" /> {t('telemetry.mediaNav', 'Media & Navigation')}
      </h3>
      <div className="space-y-5">
        {/* Now Playing */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
            Now Playing
          </p>
          {mediaData ? (
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-2">
              <p className="text-sm font-bold text-[var(--text-primary)] truncate">
                {cleanNil(mediaData.now_playing_title) || 'Nothing playing'}
              </p>
              <p className="text-xs text-[var(--text-secondary)] truncate">
                {cleanNil(mediaData.now_playing_artist) || 'Unknown artist'}
              </p>
              <div className="flex items-center gap-2">
                {cleanNil(mediaData.playback_source) && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-[var(--text-muted)]">
                    {cleanNil(mediaData.playback_source)}
                  </span>
                )}
                {cleanNil(mediaData.playback_status) && (
                  <Badge
                    color={
                      mediaData.playback_status === 'Playing'
                        ? 'green'
                        : mediaData.playback_status === 'Paused'
                          ? 'amber'
                          : 'neutral'
                    }
                  >
                    {cleanNil(mediaData.playback_status)}
                  </Badge>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">No media data</p>
          )}
        </div>

        {/* Navigation destination */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 flex items-center gap-1">
            <Navigation2 className="h-3 w-3" /> Navigation
          </p>
          {locationData ? (
            <div className="space-y-3">
              {locationData.destination_name ? (
                <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4">
                  <p className="text-sm font-bold text-[var(--text-primary)] truncate flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-neon-cyan flex-shrink-0" />
                    {locationData.destination_name}
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-[var(--text-secondary)]">
                    {locationData.miles_to_arrival != null && (
                      <span>
                        {fmtNumber(convertDistance(locationData.miles_to_arrival))}{' '}
                        {distanceUnit}
                      </span>
                    )}
                    {locationData.minutes_to_arrival != null && (
                      <span>{fmtInt(locationData.minutes_to_arrival)} min</span>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[var(--text-muted)]">No active destination</p>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                {locationData.located_at_home && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                    🏠 Home
                  </span>
                )}
                {locationData.located_at_work && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    🏢 Work
                  </span>
                )}
                {locationData.located_at_favorite && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
                    ⭐ Favorite
                  </span>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">No location data</p>
          )}
        </div>
      </div>
    </GlassPanel>
  )
}
