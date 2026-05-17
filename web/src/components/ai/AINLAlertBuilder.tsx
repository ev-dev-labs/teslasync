// Phase-50 / 0015 — N1 NL alert builder.
// Phase-50 / W1 (slice 0065) — wired the Draft button to
// POST /api/v1/ai/alerts/rules/draft.

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
    url: '/ai/alerts/rules/draft',
    body,
    onEvent: () => {},
  })
    return (
    <AIFeatureCard
      title={t('notifications.alertStudio.aiBuilder.title', 'Draft from natural language')}
      description={t(
                'notifications.alertStudio.aiBuilder.description',
                'Describe the alert you want and get a typed AlertRule draft you can review and save below.',
              )}
      buttonLabel={t('notifications.alertStudio.aiBuilder.draftButton', 'Draft alert')}
      badgeLabel={t('notifications.alertStudio.aiBuilder.badge', 'Helix')}
      canStart={vehicleId != null && prompt.trim().length > 0}
      stream={stream}
      inputSlot={
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t(
            'notifications.alertStudio.aiBuilder.placeholder',
            'e.g. alert me if battery cell voltage spread is over 50 mV',
          )}
          rows={3}
        />
      }
    />
  )
}
InnerSection.displayName = 'AINLAlertBuilderInner'

export const AINLAlertBuilder = withAiFeature('nl-alert-builder', InnerSection)
AINLAlertBuilder.displayName = 'AINLAlertBuilder'
