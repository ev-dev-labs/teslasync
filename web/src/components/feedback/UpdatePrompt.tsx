import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { GlassPanel } from '../ui/GlassPanel'
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
      className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-[9999] mx-auto max-w-md lg:inset-x-auto lg:right-4 lg:bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] lg:w-[28rem]"
    >
      <GlassPanel
        className={`!p-4 flex items-start gap-3 shadow-lg max-w-full ${
          required
            ? 'border border-amber-400/40 shadow-amber-400/10'
            : 'border border-neon-cyan/30 shadow-neon-cyan/10'
        }`}
      >
        <div
          className={`rounded-lg p-2 shrink-0 ${
            required ? 'bg-amber-400/10' : 'bg-neon-cyan/10'
          }`}
        >
          {required ? (
            <AlertTriangle className="h-5 w-5 text-amber-300" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-5 w-5 text-cyan-300" aria-hidden="true" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {required
              ? t('pwa.update.requiredTitle', 'Update required')
              : t('pwa.update.availableTitle', 'New version available')}
          </p>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
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
              className="truncate font-mono"
            >
              {update.release.runningBuildId}
            </dd>
            {serverVersion != null && (
              <>
                <dt>{t('pwa.update.serverLabel', 'Server')}</dt>
                <dd
                  data-testid="update-prompt-server-version"
                  className="truncate font-mono"
                >
                  {serverVersion}
                </dd>
              </>
            )}
          </dl>

          {update.blockedByUnsavedWork && (
            <p
              data-testid="update-prompt-unsaved"
              className="mt-2 text-xs text-amber-300"
            >
              {t(
                'pwa.update.unsavedBlocked',
                'Reload cancelled — finish or discard your unsaved changes first.',
              )}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
          {!required && (
            <Button
              variant="ghost"
              size="sm"
              onClick={update.deferUpdate}
              data-testid="update-prompt-later"
              className="text-[var(--text-secondary)]"
            >
              {t('pwa.later', 'Later')}
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
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
      </GlassPanel>
    </div>
  )
}

export default UpdatePrompt
