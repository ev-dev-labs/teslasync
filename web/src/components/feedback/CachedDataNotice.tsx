import { CloudOff, Database } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { formatDateTime, formatRelative } from '@/lib/dateFormat'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { useServiceWorkerCacheStatus } from '@/hooks/useServiceWorkerBridge'

/**
 * Explicit "this is cached, and here is exactly when it was captured"
 * disclosure (PWA-02).
 *
 * The service worker keeps a narrow allowlist of authenticated read-only
 * endpoints so a phone that loses signal still shows the last known fleet
 * state instead of an error page. That is only acceptable if the UI never
 * lets the user mistake it for live data — a three-hour-old state of charge
 * presented as current is worse than no data at all.
 *
 * ## Two modes, two different honest answers
 *
 * - **Per-view** (`cachedAt` supplied): quotes that one timestamp.
 * - **Blanket** (`cachedAt` omitted): describes EVERY cached read the worker
 *   is holding. It leads with the OLDEST capture time, because that is the
 *   staleness ceiling of what the user may be looking at, and adds the newest
 *   as a range when the two differ. Quoting only the newest — as this
 *   component originally did — understates the age of every other panel on
 *   screen.
 *
 * ## Announcement policy
 *
 * `<OfflineBanner>` (mounted by `Layout`) already owns the polite live-region
 * announcement of the offline state itself. To avoid two regions firing at the
 * same instant, the blanket instance mounted at the application root passes
 * `announce={false}`: it renders as a labelled, non-live `role="note"` that a
 * screen-reader user can reach on demand, while the text still states the
 * offline condition explicitly and visibly. Standalone per-view usage keeps
 * the default `role="status"` live region.
 */

export interface CachedDataNoticeProps {
  /**
   * Epoch ms the data on screen was captured. Omit for the blanket mode,
   * which reads every cached entry from the service worker and reports the
   * oldest (plus a range when entries differ).
   */
  cachedAt?: number | null
  /** Render even while online — used by panels that knowingly show a snapshot. */
  alwaysShow?: boolean
  /**
   * Expose as a polite live region (`role="status"`). Set `false` where
   * another live region already announces the same transition; the notice
   * then renders as a non-live `role="note"` with an accessible name.
   * Defaults to `true`.
   */
  announce?: boolean
  className?: string
}

const SHELL =
  'flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-200'

export function CachedDataNotice({
  cachedAt,
  alwaysShow = false,
  announce = true,
  className,
}: CachedDataNoticeProps) {
  const { t } = useTranslation()
  const online = useOnlineStatus()
  const { oldestCachedAt, newestCachedAt, timestampedCount, entries } =
    useServiceWorkerCacheStatus()

  const perView = cachedAt !== undefined
  const effectiveCachedAt = perView ? cachedAt : oldestCachedAt
  const cachedCount = perView ? 1 : entries.length

  // One region, and it is either live or it is not — never both a live region
  // and a redundant aria-label on a roleless wrapper.
  const regionProps = announce
    ? { role: 'status' as const, 'aria-live': 'polite' as const }
    : {
        role: 'note' as const,
        'aria-live': 'off' as const,
        'aria-label': t('pwa.cache.regionLabel', 'Cached data disclosure'),
      }

  if (online && !alwaysShow) return null

  if (effectiveCachedAt == null && cachedCount === 0) {
    // Offline with nothing cached: say so plainly rather than implying that
    // something stale is on screen.
    if (online) return null
    return (
      <div
        {...regionProps}
        data-testid="cached-data-notice-empty"
        className={`${SHELL} ${className ?? ''}`}
      >
        <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          {t(
            'pwa.cache.offlineNoData',
            "You're offline and nothing is cached for this view.",
          )}
        </span>
      </div>
    )
  }

  const oldest = effectiveCachedAt == null ? null : new Date(effectiveCachedAt)
  // A range is only meaningful in blanket mode, and only when the spread is
  // real (more than one timestamped entry with different capture times).
  const showRange =
    !perView
    && oldest != null
    && newestCachedAt != null
    && timestampedCount > 1
    && newestCachedAt !== effectiveCachedAt

  return (
    <div
      {...regionProps}
      data-testid="cached-data-notice"
      data-cached-at={effectiveCachedAt ?? ''}
      data-cached-at-newest={showRange ? newestCachedAt : ''}
      data-scope={perView ? 'view' : 'blanket'}
      className={`${SHELL} ${className ?? ''}`}
    >
      <Database className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        {/* The offline state is stated explicitly in the visible text so it is
            exposed to every user, not inferred from a wrapper's aria-label. */}
        {!online && <>{t('pwa.offline.title', "You're offline")}. </>}
        {oldest == null
          ? t(
              'pwa.cache.cachedUnknown',
              'Showing cached data. The capture time is unknown — treat it as stale.',
            )
          : showRange
            ? t(
                'pwa.cache.cachedRange',
                'Showing cached data captured between {{oldestRelative}} ({{oldestAbsolute}}) and {{newestRelative}}.',
                {
                  oldestRelative: formatRelative(oldest),
                  oldestAbsolute: formatDateTime(oldest),
                  newestRelative: formatRelative(new Date(newestCachedAt)),
                },
              )
            : t('pwa.cache.cachedAt', 'Showing data cached {{relative}} ({{absolute}}).', {
                relative: formatRelative(oldest),
                absolute: formatDateTime(oldest),
              })}
      </span>
    </div>
  )
}

export default CachedDataNotice
