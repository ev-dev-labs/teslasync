// Natural-language drive search and replay.
// The Search button posts to /api/v1/ai/drives/search.
// Uses AIFeatureCard for visual and behavioral consistency across AI features.

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Textarea } from '@/components/ui'
import { useAiStream } from '@/hooks/useAiStream'

function InnerSection() {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState('')
  // Trim once so the enable-gate (canStart) and the POST body agree:
  // the button only fires on a non-empty query, and the query we send
  // never carries the leading/trailing padding the user happened to type.
  const trimmedPrompt = prompt.trim()
  const body = useMemo(() => ({ prompt: trimmedPrompt }), [trimmedPrompt])
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
      canStart={trimmedPrompt.length > 0}
      stream={stream}
      inputSlot={
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t(
            'drives.aiSearch.placeholder',
            'e.g. last Friday\'s trip to the coast',
          )}
          aria-label={t(
            'drives.aiSearch.inputLabel',
            'Describe the drive to find',
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
