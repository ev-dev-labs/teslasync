// Phase-50 / 0017 — N3 Natural-language search.
// Phase-50 / W1 (slice 0065) — wired the Search button to
// POST /api/v1/ai/search/query.

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Textarea } from '@/components/ui'
import { useAiStream } from '@/hooks/useAiStream'

function InnerSection() {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState('')
  const body = useMemo(() => ({ prompt }), [prompt])
  const stream = useAiStream({
    url: '/ai/search/query',
    body,
    onEvent: () => {},
  })
    return (
    <AIFeatureCard
      title={t('search.aiSearch.title', 'Search with natural language')}
      description={t(
                'search.aiSearch.description',
                'Describe what you are looking for and the assistant will surface drives, charging sessions, and alerts that match \u2014 citing each entity by name.',
              )}
      buttonLabel={t('search.aiSearch.searchButton', 'Search with Helix')}
      badgeLabel={t('search.aiSearch.badge', 'Helix')}
      canStart={prompt.trim().length > 0}
      stream={stream}
      inputSlot={
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t(
            'search.aiSearch.placeholder',
            'e.g. drives last weekend over 200 km with phantom drain',
          )}
          rows={3}
        />
      }
    />
  )
}
InnerSection.displayName = 'AINLSearchInner'

export const AINLSearch = withAiFeature('nl-search', InnerSection)
AINLSearch.displayName = 'AINLSearch'
