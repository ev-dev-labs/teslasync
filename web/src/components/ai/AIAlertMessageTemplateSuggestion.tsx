// Helix Alert Studio message-template advisor.
//
// Wiring contract:
//   - useAiStream targets POST /ai/alerts/message-template/draft
//     (the backend path after stripping the /api/v1 prefix).
//   - The primary action is disabled via a COMPUTED expression
//     (`!canStart || stream.state === 'streaming' || paused-confirm`),
//     never a literal `disabled={true}`.
//   - tool_result frames from validate_alert_message_template with
//     status=ok capture the proposed template; "Apply to editor"
//     copies it onto the parent via onApplyTemplate. Helix NEVER
//     persists — Alert Studio Save remains the only write path.
//   - cancel() runs on unmount so a stale stream cannot bleed.
//   - Wrapped with withAiFeature so the surface is ABSENT when
//     ai_mode='off' or the per-feature toggle is off (ADR-015 §I5).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Button } from '@/components/ui'
import type { AiStreamEvent } from '@/hooks/useAiStream'
import { useAiStream } from '@/hooks/useAiStream'

export interface AlertMessageTemplateProposal {
  template: string
  used_placeholders: string[]
  status: string
}

/** Alert dimensions Helix must ground the template against. */
export interface AlertMessageTemplateDimensions {
  kind?: string
  signal_name?: string
  op?: string
  severity?: string
  name?: string
  value_num?: number | null
  value_text?: string | null
  value_bool?: boolean | null
  value_min?: number | null
  value_max?: number | null
  metric_id?: string | null
  metric_window?: string | null
  metric_op?: string | null
  metric_threshold?: number | null
}

export interface AIAlertMessageTemplateSuggestionProps {
  /** Current Alert Studio draft dimensions Helix must ground against. */
  draft: AlertMessageTemplateDimensions
  /**
   * Called when the user clicks Apply. Copies the validated template
   * into the existing Message Template field. The AI panel never
   * writes to the API.
   */
  onApplyTemplate: (template: string) => void
  /** Disable the Helix action while a save mutation is in flight. */
  disabled?: boolean
}

function dimensionsReady(draft: AlertMessageTemplateDimensions): boolean {
  if (draft.kind === 'signal') {
    return Boolean(draft.signal_name?.trim()) && Boolean(draft.op?.trim())
  }
  if (draft.kind === 'computed_metric') {
    return Boolean(draft.metric_id?.trim())
  }
  return false
}

function InnerSection({
  draft,
  onApplyTemplate,
  disabled,
}: AIAlertMessageTemplateSuggestionProps) {
  const { t } = useTranslation()
  const [proposal, setProposal] = useState<AlertMessageTemplateProposal | null>(null)

  const body = useMemo(
    () => ({
      kind: draft.kind,
      signal_name: draft.signal_name,
      op: draft.op,
      severity: draft.severity,
      name: draft.name,
      value_num: draft.value_num ?? undefined,
      value_text: draft.value_text ?? undefined,
      value_bool: draft.value_bool ?? undefined,
      value_min: draft.value_min ?? undefined,
      value_max: draft.value_max ?? undefined,
      metric_id: draft.metric_id ?? undefined,
      metric_window: draft.metric_window ?? undefined,
      metric_op: draft.metric_op ?? undefined,
      metric_threshold: draft.metric_threshold ?? undefined,
    }),
    [
      draft.kind,
      draft.signal_name,
      draft.op,
      draft.severity,
      draft.name,
      draft.value_num,
      draft.value_text,
      draft.value_bool,
      draft.value_min,
      draft.value_max,
      draft.metric_id,
      draft.metric_window,
      draft.metric_op,
      draft.metric_threshold,
    ],
  )

  const handleEvent = useCallback((ev: AiStreamEvent) => {
    if (
      ev.type === 'tool_result' &&
      ev.name === 'validate_alert_message_template' &&
      ev.ok
    ) {
      const data = ev.data as
        | {
            status?: string
            template?: string
            used_placeholders?: unknown
          }
        | undefined
      if (
        !data ||
        data.status !== 'ok' ||
        typeof data.template !== 'string' ||
        data.template.trim() === ''
      ) {
        return
      }
      const used = Array.isArray(data.used_placeholders)
        ? data.used_placeholders.filter((k): k is string => typeof k === 'string')
        : []
      setProposal({
        template: data.template,
        used_placeholders: used,
        status: data.status,
      })
    }
  }, [])

  const scopeKey = `${draft.kind ?? ''}:${draft.signal_name ?? ''}:${draft.op ?? ''}:${draft.metric_id ?? ''}`
  const stream = useAiStream({
    url: '/ai/alerts/message-template/draft',
    body,
    onEvent: handleEvent,
    scopeKey,
  })

  const { cancel: cancelStream } = stream

  useEffect(() => {
    return () => {
      cancelStream()
      setProposal(null)
    }
  }, [cancelStream])

  const isBusy =
    stream.state === 'streaming' || stream.state === 'paused-confirm'
  const canStart =
    !disabled && dimensionsReady(draft) && stream.state !== 'paused-confirm'

  const handleSuggest = useCallback(() => {
    if (isBusy || !canStart) {
      return
    }
    setProposal(null)
    stream.start()
  }, [isBusy, canStart, stream])

  const handleApply = useCallback(() => {
    if (!proposal) {
      return
    }
    onApplyTemplate(proposal.template)
  }, [proposal, onApplyTemplate])

  return (
    <AIFeatureCard
      title={t(
        'notifications.alertStudio.aiTemplate.title',
        'Suggest a message template',
      )}
      description={t(
        'notifications.alertStudio.aiTemplate.description',
        'Ask Helix to write a distinctive Tesla-owner notification body from the alert dimensions you already selected — not a bland threshold line. Helix uses the same placeholder catalog as the editor and never saves — Apply copies the draft into the field below, then you click Save.',
      )}
      buttonLabel={t(
        'notifications.alertStudio.aiTemplate.suggestButton',
        'Suggest template',
      )}
      badgeLabel={t('notifications.alertStudio.aiTemplate.badge', 'Helix')}
      emptyHint={t(
        'notifications.alertStudio.aiTemplate.emptyHint',
        'Choose a signal or computed metric (and operator) first so Helix can ground the template.',
      )}
      canStart={canStart}
      stream={stream}
      onAction={handleSuggest}
      buttonPlacement="below"
      buttonTestId="ai-feature-alert-message-template-suggestion-suggest"
    >
      {proposal && (
        <>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={proposal == null || isBusy}
              aria-disabled={proposal == null || isBusy ? 'true' : 'false'}
              onClick={handleApply}
              data-testid="ai-feature-alert-message-template-suggestion-apply"
            >
              {t(
                'notifications.alertStudio.aiTemplate.applyButton',
                'Apply to editor',
              )}
            </Button>
          </div>
          <div
            role="status"
            className="rounded-md border border-emerald-300/30 bg-emerald-300/5 p-3 text-sm text-emerald-300"
          >
            <div className="font-medium">
              {t(
                'notifications.alertStudio.aiTemplate.previewLabel',
                'Proposed template (review before applying):',
              )}
            </div>
            <p className="mt-1 font-mono text-xs text-[var(--text-secondary)]">
              {proposal.template}
            </p>
            {proposal.used_placeholders.length > 0 && (
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                {t(
                  'notifications.alertStudio.aiTemplate.previewPlaceholders',
                  'Placeholders: {{keys}}',
                  { keys: proposal.used_placeholders.join(', ') },
                )}
              </p>
            )}
          </div>
        </>
      )}
    </AIFeatureCard>
  )
}
InnerSection.displayName = 'AIAlertMessageTemplateSuggestionInner'

export const AIAlertMessageTemplateSuggestion = withAiFeature(
  'alert-message-template-suggestion',
  InnerSection,
)
AIAlertMessageTemplateSuggestion.displayName = 'AIAlertMessageTemplateSuggestion'
