import { useTranslation } from 'react-i18next'
import { Headphones, Navigation2, MapPin } from 'lucide-react'
import { GlassPanel, Badge } from '@/components/ui'
import { useUnits } from '@/hooks/useUnits'
import { cleanNil } from '@/lib/cleanNil'
import { fmtNumber, fmtInt } from '@/lib/numberFormat'
import type { MediaSnapshot, LocationSnapshot } from '@/api/types'
import { convertDistanceFromSI } from '@/lib/unitConversion';

interface MediaNavigationPanelProps {
  mediaData: MediaSnapshot | null | undefined
  locationData: LocationSnapshot | null | undefined
}

export function MediaNavigationPanel({ mediaData, locationData }: MediaNavigationPanelProps) {
  const { t } = useTranslation()
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);

  const mediaTitle = cleanNil(mediaData?.now_playing_title);
  const mediaArtist = cleanNil(mediaData?.now_playing_artist);
  const mediaSource = cleanNil(mediaData?.playback_source);
  const mediaStatus = cleanNil(mediaData?.playback_status);

  return (
    <GlassPanel className="p-6 h-full">
      <h3 className="section-title flex items-center gap-2 mb-5">
        <Headphones className="h-4 w-4 text-purple-300" aria-hidden="true" /> {t('telemetry.mediaNav', 'Media & Navigation')}
      </h3>
      <div className="space-y-5">
        {/* Now Playing */}
        <div>
          <p className="text-2xs uppercase tracking-wider text-[var(--text-muted)] mb-2">
            {t('telemetry.nowPlaying', 'Now Playing')}
          </p>
          {mediaData ? (
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-2">
              <p className="text-sm font-bold text-[var(--text-primary)] truncate">
                {mediaTitle || t('telemetry.nothingPlaying', 'Nothing playing')}
              </p>
              <p className="text-xs text-[var(--text-secondary)] truncate">
                {mediaArtist || t('telemetry.unknownArtist', 'Unknown artist')}
              </p>
              <div className="flex items-center gap-2">
                {mediaSource && (
                  <span className="text-2xs px-2 py-0.5 rounded-full bg-[var(--surface-2)] text-[var(--text-muted)]">
                    {mediaSource}
                  </span>
                )}
                {mediaStatus && (
                  <Badge
                    variant={
                      mediaStatus === 'Playing'
                        ? 'success'
                        : mediaStatus === 'Paused'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {mediaStatus}
                  </Badge>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">{t('telemetry.noMediaData', 'No media data')}</p>
          )}
        </div>

        {/* Navigation destination */}
        <div>
          <p className="text-2xs uppercase tracking-wider text-[var(--text-muted)] mb-2 flex items-center gap-1">
            <Navigation2 className="h-3 w-3" aria-hidden="true" /> {t('telemetry.navigation', 'Navigation')}
          </p>
          {locationData ? (
            <div className="space-y-3">
              {locationData.destination_name ? (
                <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4">
                  <p className="text-sm font-bold text-[var(--text-primary)] truncate flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-cyan-300 flex-shrink-0" aria-hidden="true" />
                    {locationData.destination_name}
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-[var(--text-secondary)]">
                    {locationData.miles_to_arrival != null && (
                      <span>
                        {fmtNumber(toDistanceDisplay(locationData.miles_to_arrival))}{' '}
                        {distanceUnit}
                      </span>
                    )}
                    {locationData.minutes_to_arrival != null && (
                      <span>{fmtInt(locationData.minutes_to_arrival)} {t('common.minShort', 'min')}</span>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[var(--text-muted)]">{t('telemetry.noActiveDestination', 'No active destination')}</p>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                {locationData.located_at_home && (
                  <span className="inline-flex items-center gap-1 text-2xs font-medium px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                    <span aria-hidden="true">🏠</span> {t('telemetry.placeHome', 'Home')}
                  </span>
                )}
                {locationData.located_at_work && (
                  <span className="inline-flex items-center gap-1 text-2xs font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    <span aria-hidden="true">🏢</span> {t('telemetry.placeWork', 'Work')}
                  </span>
                )}
                {locationData.located_at_favorite && (
                  <span className="inline-flex items-center gap-1 text-2xs font-medium px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
                    <span aria-hidden="true">⭐</span> {t('telemetry.placeFavorite', 'Favorite')}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">{t('telemetry.noLocationData', 'No location data')}</p>
          )}
        </div>
      </div>
    </GlassPanel>
  )
}
