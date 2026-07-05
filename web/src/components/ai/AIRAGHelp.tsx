// RAG-backed app help.
// The Ask button posts to /api/v1/ai/help/query.
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
  // the button only fires on a non-empty question, and the query we send
  // never carries the leading/trailing padding the user happened to type.
  const trimmedPrompt = prompt.trim()
  const body = useMemo(() => ({ prompt: trimmedPrompt }), [trimmedPrompt])
  const stream = useAiStream({
    url: '/ai/help/query',
    body,
    onEvent: () => {},
  })
  return (
    <AIFeatureCard
      title={t('help.aiHelp.title', 'Ask the help assistant')}
      description={t(
        'help.aiHelp.description',
        'Ask a natural-language question about the application and the assistant will answer using the project\u2019s own documentation, runbooks, and i18n strings \u2014 with explicit citations to each source.',
      )}
      buttonLabel={t('help.aiHelp.askButton', 'Ask the assistant')}
      badgeLabel={t('help.aiHelp.badge', 'Helix')}
      canStart={trimmedPrompt.length > 0}
      stream={stream}
      inputSlot={
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t(
            'help.aiHelp.placeholder',
            'e.g. How do I enable energy cost forecasting?',
          )}
          aria-label={t('help.aiHelp.inputLabel', 'Ask a question about the app')}
          rows={3}
        />
      }
    />
  )
}
InnerSection.displayName = 'AIRAGHelpInner'

export const AIRAGHelp = withAiFeature('rag-help', InnerSection)
AIRAGHelp.displayName = 'AIRAGHelp'
