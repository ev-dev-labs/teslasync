import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/runtime'
import { formatRelativeTime } from '@/lib/dateFormat'
import type { DraftEntry } from '@/lib/draftIndex'

interface DraftRestoreReviewContentProps {
  drafts: DraftEntry[]
  handleResume: (entry: DraftEntry) => void
  handleDiscard: (entry: DraftEntry) => void
  handleDismiss: () => void
}

export function DraftRestoreReviewContent({ drafts, handleResume, handleDiscard, handleDismiss }: DraftRestoreReviewContentProps) {
  const { t } = useTranslation()
  return (
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            {t(
              'draft.recovery.modalBody',
              'These drafts were saved in your browser before this session. Resume to continue editing or discard to clear them.',
            )}
          </p>

          {drafts.length === 0 ? (
            <p
              className="text-sm text-[var(--text-muted)]"
              data-testid="draft-restore-modal-empty"
            >
              {t('draft.recovery.empty', 'No drafts to restore.')}
            </p>
          ) : (
            <ul className="space-y-2" data-testid="draft-restore-modal-list">
              {drafts.map((entry) => (
                <li
                  key={entry.storageKey}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--glass-border)] bg-[var(--surface-2)] px-3 py-2"
                  data-testid={`draft-restore-row-${entry.storageKey}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                      {entry.label || t('draft.recovery.fallbackLabel', 'Unsaved draft')}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)]">
                      {t('draft.recovery.savedAt', 'Saved {{when}}', {
                        when: formatRelativeTime(new Date(entry.savedAt)),
                      })}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleResume(entry)}
                      data-testid={`draft-restore-resume-${entry.storageKey}`}
                    >
                      {t('draft.recovery.resume', 'Resume')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDiscard(entry)}
                      data-testid={`draft-restore-discard-${entry.storageKey}`}
                    >
                      {t('draft.recovery.discard', 'Discard')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex justify-end pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDismiss}
              data-testid="draft-restore-modal-close"
            >
              {t('draft.recovery.close', 'Close')}
            </Button>
          </div>
        </div>
  )
}
