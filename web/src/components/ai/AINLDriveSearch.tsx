// Phase-50 / 0018 — N4 Natural-language drive search & replay.
// Phase-50 / W1 (slice 0065) — wired the Search button to
// POST /api/v1/ai/drives/search (feature id: nl-drive-search-replay).
// Phase-50 / refactor — switched to AIFeatureCard scaffold for
// visual + behavioural consistency across all AI features.

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
    url: '/ai/drives/search',
    body,
    onEvent: () => {},
  })
  return (
    <AIFeatureCard
      title={t('drives.aiSearch.title', 'Find a drive in natural language')}
      description={t(
        'drives.aiSearch.description',
        'Describe a drive (for example "last Friday\'s trip to the coast") and jump straight to its replay \u2014 the assistant only narrates your own drives.',
      )}
      buttonLabel={t('drives.aiSearch.searchButton', 'Search with Helix')}
      badgeLabel={t('drives.aiSearch.badge', 'Helix')}
      canStart={prompt.trim().length > 0}
      stream={stream}
      inputSlot={
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t(
            'drives.aiSearch.placeholder',
            'e.g. last Friday\'s trip to the coast',
          )}
          rows={3}
        />
      }
    />
  )
}
InnerSection.displayName = 'AINLDriveSearchInner'

export const AINLDriveSearch = withAiFeature('nl-drive-search-replay', InnerSection)
AINLDriveSearch.displayName = 'AINLDriveSearch'
