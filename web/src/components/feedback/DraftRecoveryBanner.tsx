import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AlertBanner } from './AlertBanner'
import { Button } from '../ui/Button'
import { formatRelativeTime } from '@/lib/dateFormat'

export interface DraftRecoveryBannerProps {
  /** Whether the editor was hydrated from a stored draft. */
  hasDraft: boolean
  /** When the draft was last persisted. Used for the "from N minutes ago" copy. */
  draftSavedAt: Date | null
  /**
   * "Use draft" handler — present-only banner, the draft has already been
   * applied to the editor on hydration. Most callers can pass a no-op or
   * leave it undefined (the banner handles dismissal internally).
   */
  onRestore?: () => void
  /** "Discard draft" handler — caller should call discardDraft() from the form-draft hook. */
  onDiscard: () => void
  /** Customize the noun in the banner copy (e.g. "rule", "automation", "settings"). */
  itemNoun?: string
}

/**
 * DraftRecoveryBanner — reassuring inline notice rendered at the top of an
 * editor when the form was hydrated from `useFormDraft`.
 *
 * Tells the user "we restored your unsaved work from N minutes ago" and
 * offers two affordances:
 *  1. **Use draft** — dismisses the banner. The draft is already applied
 *     (that's the point of hydration on mount), so this is a UX-only
 *     acknowledgement.
 *  2. **Discard draft** — calls `onDiscard` so the parent can reset the
 *     editor to a clean baseline and clear the stored draft.
 *
 * Renders nothing when `hasDraft` is false or the user has dismissed the
 * banner via either action.
 */
export function DraftRecoveryBanner({
  hasDraft,
  draftSavedAt,
  onRestore,
  onDiscard,
  itemNoun,
}: DraftRecoveryBannerProps) {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = useState(false)

  // When the underlying draft is cleared (discarded upstream or the form was
  // saved), reset the local acknowledgement so a *subsequent* draft surfaces
  // the banner again. Without this, an always-mounted host (e.g. the settings
  // form, which never unmounts the banner) that dismisses once would suppress
  // every future recovery banner for the page's lifetime.
  useEffect(() => {
    if (!hasDraft) setDismissed(false)
  }, [hasDraft])

  if (!hasDraft || dismissed) return null

  const when = draftSavedAt
    ? formatRelativeTime(draftSavedAt)
    : t('draft.unknownTime', 'a moment ago')

  const message = itemNoun
    ? t('draft.restoredItem', '{{noun}} draft restored from {{when}}.', {
        noun: itemNoun,
        when,
      })
    : t('draft.restored', 'Draft restored from {{when}}.', { when })

  const handleRestore = () => {
    setDismissed(true)
    onRestore?.()
  }

  const handleDiscard = () => {
    setDismissed(true)
    onDiscard()
  }

  return (
    <AlertBanner
      variant="info"
      icon={<Info className="h-4 w-4" aria-hidden="true" />}
      role="status"
      aria-live="polite"
      data-testid="draft-recovery-banner"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex-1 min-w-0">{message}</span>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRestore}
            data-testid="draft-recovery-use"
          >
            {t('draft.useDraft', 'Use draft')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleDiscard}
            data-testid="draft-recovery-discard"
          >
            {t('draft.discardDraft', 'Discard draft')}
          </Button>
        </div>
      </div>
    </AlertBanner>
  )
}
