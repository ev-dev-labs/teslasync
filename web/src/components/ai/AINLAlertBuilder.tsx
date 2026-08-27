// Natural-language alert builder.
// The Draft button streams from POST /api/v1/ai/alerts/rules/draft.
//
// The deterministic AlertStudio form remains the baseline when AI is
// off; this opt-in surface only drafts a typed AlertRule that the user
// reviews and saves through the existing typed alerts handler.

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

// Mirrors builderMaxPromptChars in internal/api/aialert/handler.go so
// the textarea can never submit a prompt the backend rejects with a
// 400, and caps token-cost amplification from an accidental paste.
const MAX_PROMPT_CHARS = 4096

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
    onEvent: noopEvent,
    // AI-01: vehicle scope is part of stream identity — switching
    // vehicles aborts an in-flight draft and clears the previous
    // vehicle's proposal before the new scope streams in.
    scopeKey: vehicleId ?? null,
  })

  // The backend rejects vehicle_id <= 0 (aialert/handler.go), so the
  // Draft button stays disabled until a real vehicle is in scope AND
  // the prompt has non-whitespace content. Guarding `> 0` (not just
  // `!= null`) also keeps a NaN — which a parent could pass through a
  // number prop — from enabling a request the server would 400.
  const canStart = vehicleId != null && vehicleId > 0 && prompt.trim().length > 0

  return (
    <AIFeatureCard
      title={t('notifications.alertStudio.aiBuilder.title', 'Draft from natural language')}
      description={t(
        'notifications.alertStudio.aiBuilder.description',
        'Describe the alert you want and get a typed AlertRule draft you can review and save below.',
      )}
      buttonLabel={t('notifications.alertStudio.aiBuilder.draftButton', 'Draft alert')}
      badgeLabel={t('notifications.alertStudio.aiBuilder.badge', 'Helix')}
      emptyHint={t(
        'notifications.alertStudio.aiBuilder.emptyHint',
        'Choose a vehicle and describe the alert you want Helix to draft.',
      )}
      canStart={canStart}
      stream={stream}
      inputSlot={
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          aria-label={t(
            'notifications.alertStudio.aiBuilder.inputLabel',
            'Alert description',
          )}
          placeholder={t(
            'notifications.alertStudio.aiBuilder.placeholder',
            'e.g. alert me if battery cell voltage spread is over 50 mV',
          )}
          maxLength={MAX_PROMPT_CHARS}
          rows={3}
        />
      }
    />
  )
}
InnerSection.displayName = 'AINLAlertBuilderInner'

export const AINLAlertBuilder = withAiFeature('nl-alert-builder', InnerSection)
AINLAlertBuilder.displayName = 'AINLAlertBuilder'
