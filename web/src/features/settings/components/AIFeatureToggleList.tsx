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

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Toggle, GlassPanel, SectionTitle, Caption, Text, Input, Button } from '@/components/ui'
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

const CATEGORIES = ['all', 'enabled', 'chat', 'alerts', 'driving', 'energy', 'operations', 'insights'] as const
type Category = (typeof CATEGORIES)[number]

function categoryFor(id: AiFeatureId): Exclude<Category, 'all' | 'enabled'> {
  if (/chatbot|rag-help|voice-mode|nl-search|lifetime-stats-qa/.test(id)) return 'chat'
  if (/alert|automation|rule|quiet-hours|inbox-auto|geofence/.test(id)) return 'alerts'
  if (/drive|trip|route|location|speed-profile/.test(id)) return 'driving'
  if (/charg|battery|range|energy|cost|tco|temperature|vampire|tire-pressure|preheat/.test(id)) return 'energy'
  if (/__|provider|redaction|log-|trace|repair|mqtt|feedback|incident|sql-|grafana|safety-setting/.test(id)) return 'operations'
  return 'insights'
}

export function AIFeatureToggleList({ values, onToggle }: Props) {
  const { t } = useTranslation('settings')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<Category>('all')
  const [expanded, setExpanded] = useState<ReadonlySet<AiFeatureId>>(() => new Set())

  const legend = t(
    'ai.settings.feature.legend',
    'Per-feature opt-in (all default off)',
  )

  // Defensive: the registry is generated, but a bad tree-shake or a
  // partial test mock could leave the import undefined — never call
  // `.map` on something that might not be an array.
  const featureIds = AI_FEATURE_IDS ?? []
  const enabledCount = featureIds.filter(id => Boolean(values?.[id])).length
  const query = search.trim().toLocaleLowerCase()
  const matching = featureIds.filter(id => {
    if (category === 'enabled' && !values?.[id]) return false
    if (category !== 'all' && category !== 'enabled' && categoryFor(id) !== category) return false
    if (!query) return true
    const meta = AI_FEATURES[id]
    const label = t(`ai.settings.feature.${id}.label`, meta?.name ?? id)
    const description = t(`ai.settings.feature.${id}.description`, meta?.description ?? '')
    return `${label} ${description} ${id}`.toLocaleLowerCase().includes(query)
  })

  const categoryLabel = (id: Category) => t(`ai.settings.feature.category.${id}`, {
    all: 'All',
    enabled: 'Enabled',
    chat: 'Chat & help',
    alerts: 'Alerts & automation',
    driving: 'Driving & trips',
    energy: 'Energy & charging',
    operations: 'System & tools',
    insights: 'Insights & reports',
  }[id])

  const renderFeature = (id: AiFeatureId) => {
    const meta = AI_FEATURES[id]
    const label = t(`ai.settings.feature.${id}.label`, meta?.name ?? id)
    const description = t(`ai.settings.feature.${id}.description`, meta?.description ?? '')
    const hasDescription = description.trim().length > 0
    const descriptionId = `ai-feature-desc-${id}`
    const isExpanded = expanded.has(id)
    return (
      <div
        key={id}
        className="flex min-w-0 items-start gap-3 border-b border-[var(--border-default)] px-3 py-3 last:border-b-0 hover:bg-[var(--surface-hover)]"
        data-testid={`ai-feature-row-${id}`}
      >
        <div className="min-w-0 flex-1">
          <Text as="div" variant="bodySm" className="font-medium">
            {label}
          </Text>
          {hasDescription && (
            <>
              <Caption id={descriptionId} className={isExpanded ? 'mt-1 block' : 'mt-1 block line-clamp-2'}>
                {description}
              </Caption>
              {description.length > 135 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-expanded={isExpanded}
                  aria-controls={descriptionId}
                  onClick={() => setExpanded(previous => {
                    const next = new Set(previous)
                    if (next.has(id)) next.delete(id)
                    else next.add(id)
                    return next
                  })}
                  className="mt-1 min-h-6 px-0 text-xs text-[var(--theme-primary)]"
                >
                  {isExpanded
                    ? t('ai.settings.feature.less', 'Less detail')
                    : t('ai.settings.feature.more', 'More detail')}
                </Button>
              )}
            </>
          )}
        </div>
        <Toggle
          checked={Boolean(values?.[id])}
          onChange={next => onToggle(id, next)}
          aria-label={label}
          aria-describedby={hasDescription ? descriptionId : undefined}
          data-testid={`ai-feature-toggle-${id}`}
        />
      </div>
    )
  }

  return (
    <GlassPanel
      className="space-y-4 p-4 sm:p-5"
      aria-label={legend}
      data-testid="ai-feature-toggle-list"
    >
      <SectionTitle>{legend}</SectionTitle>
      <Text as="p" variant="bodySm">
        {t('ai.settings.feature.guidance', 'Find a feature by name or task, then enable only what you need. Expand a row for technical details.')}
      </Text>
      {featureIds.length === 0 ? (
        // no-action: featureIds comes from the generated AI_FEATURE_IDS registry, which always ships entries in practice.
        <EmptyState
          message={t(
            'ai.settings.feature.empty',
            'No AI features are available yet.',
          )}
        />
      ) : (
        <div className="space-y-4">
          <Input
            type="search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            label={t('ai.settings.feature.search', 'Search AI features')}
            placeholder={t('ai.settings.feature.searchHint', 'Try chat, charging, alerts…')}
          />
          <div role="group" aria-label={t('ai.settings.feature.filters', 'Feature categories')} className="flex flex-wrap gap-2">
            {CATEGORIES.map(id => (
              <Button
                key={id}
                type="button"
                size="sm"
                variant={category === id ? 'primary' : 'ghost'}
                aria-pressed={category === id}
                onClick={() => setCategory(id)}
                className="min-h-9 rounded-shape-lg border border-[var(--border-default)] px-3"
              >
                {categoryLabel(id)}{id === 'enabled' ? ` (${enabledCount})` : ''}
              </Button>
            ))}
          </div>
          <Caption role="status" className="block">
            {t('ai.settings.feature.showing', '{{count}} of {{total}} features', {
              count: matching.length,
              total: featureIds.length,
            })}
          </Caption>
          {matching.length === 0 ? (
            <div className="rounded-shape-lg border border-[var(--border-default)] p-4">
              <Text as="p" variant="bodySm">
                {t('ai.settings.feature.noMatches', 'No features match. Try another term or choose All.')}
              </Text>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-x-4 lg:grid-cols-2">
              {(category === 'all' && !query
                ? CATEGORIES.filter((id): id is Exclude<Category, 'all' | 'enabled'> => id !== 'all' && id !== 'enabled')
                : [category]
              ).map(group => {
                const items = category === 'all' && !query
                  ? matching.filter(id => categoryFor(id) === group)
                  : matching
                if (items.length === 0) return null
                return (
                  <div key={group} className="col-span-full mb-2">
                    {category === 'all' && !query && (
                      <SectionTitle className="mb-2 mt-3">{categoryLabel(group)}</SectionTitle>
                    )}
                    <div className="grid grid-cols-1 gap-x-4 rounded-shape-lg border border-[var(--border-default)] bg-[var(--surface-1)] lg:grid-cols-2">
                      {items.map(renderFeature)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </GlassPanel>
  )
}
