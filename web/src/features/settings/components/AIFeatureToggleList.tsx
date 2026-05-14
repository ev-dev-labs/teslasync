/**
 * Phase-50 / 0003 — F2 Settings UI for AI.
 *
 * Per-feature opt-in toggles. **Generated** by mapping over
 * `AI_FEATURE_IDS` from the canonical TS registry — never
 * hand-listed. Per the prompt: "Adding a feature in F0's registry
 * automatically adds the toggle here."
 *
 * i18n: each toggle's copy lives at
 *   `ai.settings.feature.<id>.label`
 *   `ai.settings.feature.<id>.description`
 * with a fallback to the registry's `name` / `description` so
 * adding a feature without translations still renders sensibly.
 */

import { useTranslation } from 'react-i18next'
import { Toggle, Subhead, Caption } from '@/components/ui'
import {
  AI_FEATURE_IDS,
  AI_FEATURES,
  type AiFeatureId,
} from '@/ai/features'

interface Props {
  values: Record<AiFeatureId, boolean>
  onToggle: (id: AiFeatureId, value: boolean) => void
}

export function AIFeatureToggleList({ values, onToggle }: Props) {
  const { t } = useTranslation('settings')

  return (
    <section
      className="space-y-2 rounded-md border border-[var(--border-subtle)] p-4"
      aria-label={t(
        'ai.settings.feature.legend',
        'Per-feature opt-in (all default off)',
      )}
      data-testid="ai-feature-toggle-list"
    >
      <Subhead>
        {t(
          'ai.settings.feature.legend',
          'Per-feature opt-in (all default off)',
        )}
      </Subhead>
      <div className="space-y-2">
        {AI_FEATURE_IDS.map((id) => {
          const meta = AI_FEATURES[id]
          const label = t(
            `ai.settings.feature.${id}.label`,
            // Fallback to registry name keeps the surface
            // self-describing even for newly added features whose
            // translations have not landed yet.
            meta.name,
          )
          const description = t(
            `ai.settings.feature.${id}.description`,
            meta.description,
          )
          return (
            <div
              key={id}
              className="flex items-start justify-between gap-3 rounded-sm px-2 py-2 hover:bg-[var(--surface-hover)]"
              data-testid={`ai-feature-row-${id}`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--text-primary)]">
                  {label}
                </div>
                <Caption>{description}</Caption>
              </div>
              <Toggle
                checked={Boolean(values[id])}
                onChange={(next) => onToggle(id, next)}
                aria-label={label}
                data-testid={`ai-feature-toggle-${id}`}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}
