/**
 * Phase-50 / 0003 — F2 Settings UI for AI.
 *
 * Restore-previous-selection panel. Surfaced ONLY when:
 *   1. The user is currently in a non-off mode (otherwise there is
 *      no point offering a restore — they need to enable AI first).
 *   2. The server returned a non-empty `ai_features_archived`
 *      snapshot from a prior mode→off transition.
 *   3. The user has not declined this prompt in the current
 *      session.
 *
 * Per ADR-015 §I7, restore is **never silent**. The Confirm button
 * applies the archived selection AND issues a save; Decline simply
 * dismisses for the session (re-opening the page resurfaces it
 * unless the archive was cleared by an explicit save).
 */

import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'
import { Button, Caption, Subhead } from '@/components/ui'
import { AI_FEATURES, isKnownAiFeature } from '@/ai/features'

interface Props {
  archived: Record<string, boolean>
  onConfirm: () => void
  onDecline: () => void
}

/**
 * Renders a comma-separated preview of the archived feature names
 * so the user can decide WITHOUT having to mentally diff against
 * the current toggle list. Unknown IDs (a feature was removed
 * between archive and restore) fall back to the raw ID so the
 * listing is never blank.
 */
function previewLabels(
  archived: Record<string, boolean>,
  translate: (id: string, fallback: string) => string,
): string[] {
  const out: string[] = []
  for (const [id, value] of Object.entries(archived)) {
    if (!value) continue
    if (isKnownAiFeature(id)) {
      out.push(translate(id, AI_FEATURES[id].name))
    } else {
      out.push(id)
    }
  }
  return out
}

export function AIRestorePanel({ archived, onConfirm, onDecline }: Props) {
  const { t } = useTranslation('settings')
  const labels = previewLabels(archived, (id, fallback) =>
    t(`ai.settings.feature.${id}.label`, fallback),
  )

  return (
    <section
      role="alert"
      aria-live="polite"
      className="rounded-md border border-purple-400/40 bg-purple-500/5 p-4 space-y-2"
      data-testid="ai-restore-panel"
    >
      <div className="flex items-start gap-2">
        <Sparkles className="h-4 w-4 text-purple-300 mt-0.5" aria-hidden />
        <div className="flex-1 min-w-0">
          <Subhead>
            {t(
              'ai.settings.archive.title',
              'Restore previous AI selection?',
            )}
          </Subhead>
          <Caption>
            {t(
              'ai.settings.archive.description',
              'You previously had these features enabled. Re-enable them now?',
            )}
          </Caption>
          {labels.length > 0 && (
            <ul className="mt-2 list-disc list-inside text-xs text-[var(--text-secondary)]">
              {labels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onDecline}
          data-testid="ai-restore-decline"
        >
          {t('ai.settings.archive.decline', 'No thanks')}
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={onConfirm}
          data-testid="ai-restore-confirm"
        >
          {t('ai.settings.archive.restore', 'Restore selection')}
        </Button>
      </div>
    </section>
  )
}
