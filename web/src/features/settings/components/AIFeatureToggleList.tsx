/**
 * Settings UI for AI feature toggles.
 *
 * Per-feature opt-in toggles. **Generated** by mapping over
 * `AI_FEATURE_IDS` from the canonical TS registry — never
 * hand-listed. Adding a feature to the registry automatically adds
 * the toggle here.
 *
 * i18n: each toggle's copy lives at
 *   `ai.settings.feature.<id>.label`
 *   `ai.settings.feature.<id>.description`
 * with a fallback to the registry's `name` / `description` so
 * adding a feature without translations still renders sensibly.
 */

import { useTranslation } from 'react-i18next'
import { Toggle, GlassPanel, SectionTitle, Caption, Text } from '@/components/ui'
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
    <GlassPanel
      className="space-y-3 p-4 sm:p-5"
      aria-label={t(
        'ai.settings.feature.legend',
        'Per-feature opt-in (all default off)',
      )}
      data-testid="ai-feature-toggle-list"
    >
      <SectionTitle>
        {t(
          'ai.settings.feature.legend',
          'Per-feature opt-in (all default off)',
        )}
      </SectionTitle>
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2 2xl:grid-cols-3">
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
              className="flex items-start justify-between gap-3 rounded-md px-2 py-2 hover:bg-[var(--surface-hover)]"
              data-testid={`ai-feature-row-${id}`}
            >
              <div className="min-w-0 flex-1">
                <Text as="div" size="sm" weight="medium" color="primary">
                  {label}
                </Text>
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
    </GlassPanel>
  )
}
