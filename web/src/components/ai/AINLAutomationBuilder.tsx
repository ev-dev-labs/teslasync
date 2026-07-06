// Natural-language automation builder.
// The Draft button streams from POST /api/v1/ai/automations/draft.

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Textarea } from '@/components/ui'
import { useAiStream } from '@/hooks/useAiStream'

// MaxPromptChars mirrors the backend handler's builderMaxPromptChars
// cap (internal/api/aiautomation/handler.go). Enforcing it at the
// textarea keeps an over-long prompt from bouncing off a 400 at the
// wire — keep the two values in sync.
const MaxPromptChars = 4096

interface InnerSectionProps {
  /**
   * vehicleId surfaced by the parent AutomationBuilderPage. Optional
   * because the active-vehicle context may be unresolved at first
   * paint; when absent — or not a valid positive id — we still render
   * the section (the AI gate has already passed) but the Draft button
   * stays disabled because the backend scopes drafting to a single
   * vehicle and rejects vehicle_id <= 0.
   */
  vehicleId?: number
}

function InnerSection({ vehicleId }: InnerSectionProps) {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState('')

  // The backend handler requires vehicle_id > 0 (it returns a 400 for
  // anything <= 0). A bare `vehicleId != null` gate would enable the
  // Draft button for 0 / negative / NaN ids and POST a guaranteed-400
  // body, so normalise to a finite positive number here.
  const numericVehicleId =
    typeof vehicleId === 'number' && Number.isFinite(vehicleId) ? vehicleId : 0
  const haveVehicle = numericVehicleId > 0

  const trimmedPrompt = prompt.trim()
  const havePrompt =
    trimmedPrompt.length > 0 && trimmedPrompt.length <= MaxPromptChars

  const body = useMemo(
    () => ({ vehicle_id: numericVehicleId, prompt: trimmedPrompt }),
    [numericVehicleId, trimmedPrompt],
  )
  const stream = useAiStream({
    url: '/ai/automations/draft',
    body,
    onEvent: () => {},
  })

  // Empty-state affordance: when the Draft button is disabled, explain
  // WHICH precondition is missing rather than leaving a bare, silent
  // disabled control. The vehicle gate is the coarser precondition, so
  // it is reported first; AIFeatureCard only shows the hint while
  // `canStart` is false, so it disappears the moment both gates pass.
  const emptyHint = !haveVehicle
    ? t(
        'automations.builder.aiBuilder.noVehicle',
        'Pick a vehicle above to let Helix draft an automation for it.',
      )
    : !havePrompt
      ? t(
          'automations.builder.aiBuilder.noPrompt',
          'Describe the automation you want Helix to draft.',
        )
      : undefined

  return (
    <AIFeatureCard
      title={t('automations.builder.aiBuilder.title', 'Draft from natural language')}
      description={t(
        'automations.builder.aiBuilder.description',
        'Describe the automation you want and get a typed graph draft you can review and save below.',
      )}
      buttonLabel={t('automations.builder.aiBuilder.draftButton', 'Draft automation')}
      badgeLabel={t('automations.builder.aiBuilder.badge', 'Helix')}
      emptyHint={emptyHint}
      canStart={haveVehicle && havePrompt}
      stream={stream}
      inputSlot={
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          maxLength={MaxPromptChars}
          aria-label={t(
            'automations.builder.aiBuilder.inputLabel',
            'Automation description',
          )}
          placeholder={t(
            'automations.builder.aiBuilder.placeholder',
            'e.g. precondition the cabin to 22°C when I leave work on weekdays',
          )}
        />
      }
    />
  )
}
InnerSection.displayName = 'AINLAutomationBuilderInner'

export const AINLAutomationBuilder = withAiFeature('nl-automation-builder', InnerSection)
AINLAutomationBuilder.displayName = 'AINLAutomationBuilder'
