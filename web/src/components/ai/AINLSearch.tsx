// Natural-language search surface. The Search button streams
// POST /api/v1/ai/search/query through useAiStream.

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Textarea } from '@/components/ui'
import { useAiStream } from '@/hooks/useAiStream'

// Stable no-op event sink hoisted to module scope so useAiStream's
// onEvent-tracking effect does not re-subscribe on every keystroke.
// This surface renders only the accumulated delta text (stream.text),
// so it has no need for per-event callbacks.
const noopEvent = () => {}

// Mirrors maxPromptChars in internal/api/aisearch/handler.go so the
// textarea can never submit a query the backend rejects with a 400,
// and caps token-cost amplification from an accidental paste.
const MAX_PROMPT_CHARS = 4096

function InnerSection() {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState('')
  const body = useMemo(() => ({ prompt }), [prompt])
  const stream = useAiStream({
    url: '/ai/search/query',
    body,
    onEvent: noopEvent,
  })

  // The backend trims and rejects an empty prompt with a 400
  // (internal/api/aisearch/handler.go), so keep the Search button
  // disabled until the query has non-whitespace content.
  const canStart = prompt.trim().length > 0

  return (
    <AIFeatureCard
      title={t('search.aiSearch.title', 'Search with natural language')}
      description={t(
        'search.aiSearch.description',
        'Describe what you are looking for and the assistant will surface drives, charging sessions, and alerts that match \u2014 citing each entity by name.',
      )}
      buttonLabel={t('search.aiSearch.searchButton', 'Search with Helix')}
      badgeLabel={t('search.aiSearch.badge', 'Helix')}
      emptyHint={t(
        'search.aiSearch.emptyHint',
        'Type a question above to search your drives, charging sessions, and alerts.',
      )}
      canStart={canStart}
      stream={stream}
      inputSlot={
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          aria-label={t('search.aiSearch.inputLabel', 'Search query')}
          placeholder={t(
            'search.aiSearch.placeholder',
            'e.g. drives last weekend over 200 km with phantom drain',
          )}
          maxLength={MAX_PROMPT_CHARS}
          rows={3}
        />
      }
    />
  )
}
InnerSection.displayName = 'AINLSearchInner'

export const AINLSearch = withAiFeature('nl-search', InnerSection)
AINLSearch.displayName = 'AINLSearch'
