// Natural-language automation builder.
// The Draft button streams from POST /api/v1/ai/automations/draft.

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Textarea } from '@/components/ui'
import { useAiStream } from '@/hooks/useAiStream'

interface InnerSectionProps {
  vehicleId?: number
}

function InnerSection({ vehicleId }: InnerSectionProps) {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState('')
  const body = useMemo(
    () => ({ vehicle_id: vehicleId ?? 0, prompt }),
    [vehicleId, prompt],
  )
  const stream = useAiStream({
    url: '/ai/automations/draft',
    body,
    onEvent: () => {},
  })
    return (
    <AIFeatureCard
      title={t('automations.builder.aiBuilder.title', 'Draft from natural language')}
      description={t(
                'automations.builder.aiBuilder.description',
                'Describe the automation you want and get a typed graph draft you can review and save below.',
              )}
      buttonLabel={t('automations.builder.aiBuilder.draftButton', 'Draft automation')}
      badgeLabel={t('automations.builder.aiBuilder.badge', 'Helix')}
      canStart={vehicleId != null && prompt.trim().length > 0}
      stream={stream}
      inputSlot={
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t(
            'automations.builder.aiBuilder.placeholder',
            'e.g. precondition the cabin to 22°C when I leave work on weekdays',
          )}
          rows={3}
        />
      }
    />
  )
}
InnerSection.displayName = 'AINLAutomationBuilderInner'

export const AINLAutomationBuilder = withAiFeature('nl-automation-builder', InnerSection)
AINLAutomationBuilder.displayName = 'AINLAutomationBuilder'
