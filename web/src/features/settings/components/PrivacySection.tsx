/**
 * Phase-46 / Prompt 51 — Privacy section.
 *
 * Surfaces user-controllable client-side privacy switches. The first
 * (and currently only) entry is "Clear recently viewed pages", which
 * wipes the LRU maintained by `lib/recentPages` for the current
 * browser. Other client-only history surfaces (command frecency,
 * silenced confirms, draft index, …) already have their own controls
 * elsewhere; this section is the home for primitives that don't fit a
 * narrower bucket.
 *
 * The "Clear" action is gated behind a `<ConfirmDialog>` because it is
 * irreversible and can erase weeks of accumulated convenience without
 * an undo path. The dialog reuses the existing `silenceKey` machinery
 * so users on shared workstations who want a one-click flow can opt in
 * after the first confirmation.
 *
 * NOTE: SettingsPage.tsx is outside this prompt's allowed-files regex,
 * so this component ships as a standalone file. Mounting under a
 * `<section id="privacy">` anchor is a follow-up prompt; until then,
 * the same primitive can be invoked via the command palette's Recent
 * section by deleting items individually (or, for batch wipe,
 * developer-tools `localStorage.removeItem('teslasync:recent-pages:v1')`).
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldCheck, Trash2 } from 'lucide-react'
import { GlassPanel, IconBox, Button, ConfirmDialog } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { useToast } from '@/components/feedback/Toast'
import {
  clearRecentPages,
  getRecentPages,
  subscribeRecentPages,
} from '@/lib/recentPages'

const CONFIRM_SILENCE_KEY = 'clear-recent-pages'

export function PrivacySection() {
  const { t } = useTranslation()
  const toast = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [count, setCount] = useState<number>(() => getRecentPages().length)

  // Live-update the row counter so users on the same page in two tabs
  // see the count drop after a clear in either tab.
  useEffect(() => {
    setCount(getRecentPages().length)
    return subscribeRecentPages(() => setCount(getRecentPages().length))
  }, [])

  const handleConfirm = () => {
    clearRecentPages()
    setConfirmOpen(false)
    toast.success(
      t('recentPages.cleared', 'Recent pages cleared'),
    )
  }

  return (
    <FadeIn>
      <GlassPanel
        className="p-5"
        data-testid="privacy-section"
      >
        <div className="flex items-start gap-4">
          <IconBox color="cyan">
            <ShieldCheck className="h-5 w-5" />
          </IconBox>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {t('privacy.title', 'Privacy')}
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {t(
                'privacy.subtitle',
                'Manage local browsing history surfaces. These settings only affect this browser.',
              )}
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] p-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-[14rem]">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {t('recentPages.clearTitle', 'Recently viewed pages')}
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {t(
                  'recentPages.clearBody',
                  'Wipe the list of pages used by the dashboard widget and the Recent section in the command palette.',
                )}
              </p>
              <p
                className="text-[11px] text-[var(--text-muted)] mt-2 tabular-nums"
                data-testid="privacy-recent-count"
              >
                {t('recentPages.storedCount', { count, defaultValue: `${count} entries stored` })}
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => setConfirmOpen(true)}
              disabled={count === 0}
              data-testid="privacy-clear-recent-pages"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t('recentPages.clearButton', 'Clear recent pages')}
            </Button>
          </div>
        </div>

        <ConfirmDialog
          open={confirmOpen}
          variant="warning"
          title={t('recentPages.clearConfirmTitle', 'Clear recent pages?')}
          message={t(
            'recentPages.clearConfirmBody',
            'This will wipe the list immediately. The dashboard widget and palette Recent section will be empty until you visit new pages.',
          )}
          confirmLabel={t('recentPages.clearConfirmCta', 'Clear pages')}
          cancelLabel={t('common.cancel', 'Cancel')}
          silenceKey={CONFIRM_SILENCE_KEY}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmOpen(false)}
        />
      </GlassPanel>
    </FadeIn>
  )
}

export default PrivacySection
