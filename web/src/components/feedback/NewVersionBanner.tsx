import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { useVersionWatcher } from '@/hooks/useVersionWatcher'

/**
 * Soft "new version available" banner.
 *
 * Surfaced when {@link useVersionWatcher} detects that the backend has
 * been redeployed since the SPA first booted. The user can either:
 *   • Reload — pulls the new HTML + fresh chunk hashes, eliminating any
 *     subsequent ChunkLoadError before it can happen.
 *   • Later — dismisses the banner for THIS specific new version. If the
 *     server is redeployed again afterwards, the banner reappears for
 *     the newer version.
 *
 * Per-version dismissal is keyed on the `latestVersion` string so a user
 * who deferred a reload still sees the banner for the next deploy. The
 * dismissal is stored in `sessionStorage` so the user does NOT have to
 * re-dismiss across page navigations within the same tab, but a new tab
 * starts fresh (a 24h-stale tab is exactly the case we want to nudge).
 */

const SESSION_DISMISS_KEY = 'teslasync:new-version-dismissed-for'

export function NewVersionBanner() {
  const { t } = useTranslation()
  const { newVersionAvailable, latestVersion } = useVersionWatcher()
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    try {
      return window.sessionStorage.getItem(SESSION_DISMISS_KEY)
    } catch {
      return null
    }
  })

  // If the banner is dismissed for v1.0 but the next poll bumps to v1.1,
  // the dismissal does NOT carry forward — we want to nudge the user
  // again. Reset the local dismissal whenever `latestVersion` no longer
  // matches the stored dismissal target.
  useEffect(() => {
    if (!latestVersion) return
    if (dismissedVersion && dismissedVersion !== latestVersion) {
      setDismissedVersion(null)
    }
  }, [latestVersion, dismissedVersion])

  if (!newVersionAvailable) return null
  if (latestVersion && dismissedVersion === latestVersion) return null

  const handleReload = () => {
    window.location.reload()
  }

  const handleLater = () => {
    if (latestVersion) {
      try {
        window.sessionStorage.setItem(SESSION_DISMISS_KEY, latestVersion)
      } catch {
        /* private mode / quota — fall through, in-memory dismissal still works */
      }
      setDismissedVersion(latestVersion)
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="new-version-banner"
      className="fixed bottom-4 right-4 z-[80] flex max-w-sm items-center gap-3 rounded-xl border border-emerald-500/30 bg-[var(--surface-overlay)] px-4 py-3 shadow-lg shadow-emerald-500/10"
    >
      <div className="rounded-lg bg-emerald-500/10 p-2 shrink-0">
        <Sparkles className="h-4 w-4 text-emerald-300" aria-hidden />
      </div>
      <p className="flex-1 text-sm text-[var(--text-primary)]">
        {t('app.newVersion.message', 'A new version of TeslaSync is available.')}
      </p>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="ghost" onClick={handleLater}>
          {t('app.newVersion.later', 'Later')}
        </Button>
        <Button size="sm" variant="primary" onClick={handleReload}>
          {t('app.newVersion.reload', 'Reload')}
        </Button>
      </div>
    </div>
  )
}

export default NewVersionBanner
