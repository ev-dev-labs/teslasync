import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { AlertBanner } from './AlertBanner'
import { type PwaUpdateState } from '@/hooks/usePwaUpdate'

/**
 * The user-facing half of the update lifecycle (PWA-03).
 *
 * Renders nothing until a new build is genuinely available, then explains
 * WHAT changed (build id + backend version), and offers exactly two actions:
 * reload now, or later.
 *
 * Two behaviours are deliberate and load-bearing:
 *
 *  - **Nothing reloads on a timer.** The previous banner counted down from
 *    three seconds and reloaded itself, which discards unsaved work for any
 *    user who looked away. Reloading is always an explicit click.
 *  - **A required update cannot be dismissed.** When the contract handshake
 *    reports that the running assets predate the live API, "Later" would just
 *    leave the user clicking through broken pages, so the button is not
 *    rendered and the copy changes to explain why.
 */

export interface UpdatePromptProps {
  /**
   * Update lifecycle state, owned by the host (`ReloadPrompt`). Passed in
   * rather than read from `usePwaUpdate()` here so the hook is mounted
   * exactly once — a second instance would register a second
   * `registration.update()` interval and a second BroadcastChannel listener,
   * doubling every cross-tab reload.
   */
  state: PwaUpdateState
}

export function UpdatePrompt({ state: update }: UpdatePromptProps) {
  const { t } = useTranslation()

  if (!update.showPrompt) return null

  const required = update.updateRequired
  const serverVersion = update.release.latestServerVersion

  // Live-region urgency must match the stakes, and the role must not fight
  // the politeness setting. `role="alert"` carries an implicit
  // `aria-live="assertive"`, so pairing it with `aria-live="polite"` (as this
  // banner originally did) is contradictory: browsers resolve it
  // inconsistently and screen readers may drop the announcement entirely.
  //
  //  - REQUIRED update — the tab is running assets that no longer match the
  //    live API, so every subsequent interaction may misbehave. That warrants
  //    interrupting: role="alert" + assertive.
  //  - OPTIONAL update — informational, must never cut across whatever the
  //    user is reading: role="status" + polite.
  const liveRegionProps = required
    ? { role: 'alert' as const, 'aria-live': 'assertive' as const }
    : { role: 'status' as const, 'aria-live': 'polite' as const }

  return (
    <div
      {...liveRegionProps}
      data-testid="update-prompt"
      data-update-required={required ? 'true' : 'false'}
      className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-[9999] mx-auto max-w-md xl:inset-x-auto xl:right-4 xl:bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] xl:w-[28rem]"
    >
      <AlertBanner
        variant={required ? 'warning' : 'info'}
        title={required
          ? t('pwa.update.requiredTitle', 'Update required')
          : t('pwa.update.availableTitle', 'New version available')}
        icon={required ? <AlertTriangle className="h-5 w-5" /> : <RefreshCw className="h-5 w-5" />}
        className="max-w-full shadow-e2"
      >
        <p className="text-sm text-[var(--text-secondary)]">
          {required
            ? t(
                'pwa.update.requiredBody',
                'This tab is running an older app version than the server. Reload to stay in sync.',
              )
            : t(
                'pwa.update.availableBody',
                'A newer build has been downloaded and is ready to apply.',
              )}
        </p>

        {/* Release context — what is running now, and what the server says. */}
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs leading-tight text-[var(--text-muted)]">
          <dt>{t('pwa.update.runningLabel', 'Running')}</dt>
          <dd
            data-testid="update-prompt-running-build"
            className="min-w-0 font-mono [overflow-wrap:anywhere]"
          >
            {update.release.runningBuildId}
          </dd>
          {serverVersion != null && (
            <>
              <dt>{t('pwa.update.serverLabel', 'Server')}</dt>
              <dd
                data-testid="update-prompt-server-version"
                className="min-w-0 font-mono [overflow-wrap:anywhere]"
              >
                {serverVersion}
              </dd>
            </>
          )}
        </dl>

        {update.blockedByUnsavedWork && (
          <p
            data-testid="update-prompt-unsaved"
            className="mt-2 text-xs text-[var(--semantic-warning)]"
          >
            {t(
              'pwa.update.unsavedBlocked',
              'Reload cancelled — finish or discard your unsaved changes first.',
            )}
          </p>
        )}
        <div data-app-part="feedback-actions" className="mt-3 flex min-w-0 flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
          {!required && (
            <Button
              variant="ghost"
              size="sm"
              wrapLabel
              onClick={update.deferUpdate}
              data-testid="update-prompt-later"
              className="min-h-11 text-[var(--text-secondary)]"
            >
              {t('pwa.later', 'Later')}
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            wrapLabel
            className="min-h-11"
            onClick={() => {
              void update.applyUpdate()
            }}
            disabled={update.applying}
            data-testid="update-prompt-reload"
          >
            {update.applying
              ? t('pwa.update.applying', 'Reloading…')
              : t('pwa.reloadNow', 'Reload Now')}
          </Button>
        </div>
      </AlertBanner>
    </div>
  )
}

export default UpdatePrompt
