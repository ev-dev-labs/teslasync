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
 *
 * a11y: every switch is named by its label (via the forwarded
 * `aria-label`) and, when copy exists, described by its help text
 * (via `aria-describedby`). An empty registry renders a placeholder
 * rather than a blank panel.
 */

import { useTranslation } from 'react-i18next'
import { Toggle, GlassPanel, SectionTitle, Caption, Text } from '@/components/ui'
import { EmptyState } from '@/components/feedback'
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

  const legend = t(
    'ai.settings.feature.legend',
    'Per-feature opt-in (all default off)',
  )

  // Defensive: the registry is generated, but a bad tree-shake or a
  // partial test mock could leave the import undefined — never call
  // `.map` on something that might not be an array.
  const featureIds = AI_FEATURE_IDS ?? []

  return (
    <GlassPanel
      className="space-y-3 p-4 sm:p-5"
      aria-label={legend}
      data-testid="ai-feature-toggle-list"
    >
      <SectionTitle>{legend}</SectionTitle>
      {featureIds.length === 0 ? (
        // no-action: featureIds comes from the generated AI_FEATURE_IDS registry, which always ships entries in practice.
        <EmptyState
          message={t(
            'ai.settings.feature.empty',
            'No AI features are available yet.',
          )}
        />
      ) : (
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2 2xl:grid-cols-3">
          {featureIds.map((id) => {
            const meta = AI_FEATURES[id]
            const label = t(
              `ai.settings.feature.${id}.label`,
              // Fallback to registry name keeps the surface
              // self-describing even for newly added features whose
              // translations have not landed yet. The id is a final
              // guard if the registry entry itself is missing.
              meta?.name ?? id,
            )
            const description = t(
              `ai.settings.feature.${id}.description`,
              meta?.description ?? '',
            )
            const hasDescription = description.trim().length > 0
            const descriptionId = `ai-feature-desc-${id}`
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
                  {hasDescription ? (
                    <Caption id={descriptionId}>{description}</Caption>
                  ) : null}
                </div>
                <Toggle
                  checked={Boolean(values?.[id])}
                  onChange={(next) => onToggle(id, next)}
                  aria-label={label}
                  aria-describedby={hasDescription ? descriptionId : undefined}
                  data-testid={`ai-feature-toggle-${id}`}
                />
              </div>
            )
          })}
        </div>
      )}
    </GlassPanel>
  )
}
