/**
 * Restore-previous-selection panel.
 *
 * Surfaced ONLY when:
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

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'
import { Button, Caption, PanelTitle, Text } from '@/components/ui'
import { AI_FEATURES, isKnownAiFeature } from '@/ai/features'

interface Props {
  archived: Record<string, boolean>
  onConfirm: () => void
  onDecline: () => void
}

interface PreviewItem {
  /** Archived feature id — stable, unique React key. */
  id: string
  /** Human-facing label: the translated feature name, or the raw id. */
  label: string
}

/**
 * Builds the archived-feature preview list rendered under the prompt
 * so the user can decide WITHOUT having to mentally diff against the
 * current toggle list.
 *
 * Each entry keeps its originating feature `id` so the rendered list
 * can key on a guaranteed-unique value rather than the display label
 * (two features can resolve to the same translated name, which would
 * otherwise collide as React keys). Unknown IDs (a feature was removed
 * between archive and restore) fall back to the raw ID so the listing
 * is never blank. A null/undefined map is tolerated and yields an
 * empty list instead of throwing.
 */
function previewLabels(
  archived: Record<string, boolean> | null | undefined,
  translate: (id: string, fallback: string) => string,
): PreviewItem[] {
  const out: PreviewItem[] = []
  for (const [id, value] of Object.entries(archived ?? {})) {
    if (!value) continue
    out.push({
      id,
      label: isKnownAiFeature(id) ? translate(id, AI_FEATURES[id].name) : id,
    })
  }
  return out
}

export function AIRestorePanel({ archived, onConfirm, onDecline }: Props) {
  const { t } = useTranslation('settings')
  const items = useMemo(
    () =>
      previewLabels(archived, (id, fallback) =>
        t(`ai.settings.feature.${id}.label`, fallback),
      ),
    [archived, t],
  )

  return (
    <section
      role="alert"
      aria-live="polite"
      className="space-y-2 rounded-xl border border-purple-400/40 bg-purple-500/5 p-4 sm:p-5"
      data-testid="ai-restore-panel"
    >
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 text-purple-300" aria-hidden />
        <div className="min-w-0 flex-1">
          <PanelTitle>
            {t(
              'ai.settings.archive.title',
              'Restore previous Helix selection?',
            )}
          </PanelTitle>
          <Caption>
            {t(
              'ai.settings.archive.description',
              'You previously had these features enabled. Re-enable them now?',
            )}
          </Caption>
          {items.length > 0 && (
            <ul className="mt-2 list-inside list-disc space-y-0.5">
              {items.map((item) => (
                <Text as="li" key={item.id} variant="bodySm">
                  {item.label}
                </Text>
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
