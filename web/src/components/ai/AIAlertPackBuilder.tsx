import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Badge, Button, Caption, GlassPanel, PanelTitle, Text, Textarea } from '@/components/ui'
import { useAiStream, type AiStreamEvent } from '@/hooks/useAiStream'
import type { AlertPack } from '@/api/hooks/useAlertPacks'

interface Proposal {
  name: string
  template_ids: string[]
  rationale: string
}

interface Props {
  catalog: AlertPack
  onApply: (pack: AlertPack) => void
}

function Inner({ catalog, onApply }: Props) {
  const { t } = useTranslation()
  const [goal, setGoal] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const handleEvent = useCallback((event: AiStreamEvent) => {
    if (event.type !== 'tool_result' || event.name !== 'propose_alert_pack') return
    // Invalidate an earlier proposal when a later tool call fails.
    setProposal(null)
    if (!event.ok || !event.data || typeof event.data !== 'object') return
    const data = event.data as Record<string, unknown>
    if (data.status !== 'ok' || typeof data.name !== 'string' || typeof data.rationale !== 'string' || !Array.isArray(data.template_ids)) return
    const ids = data.template_ids.filter((id): id is string => typeof id === 'string')
    if (ids.length < 2 || ids.length > catalog.rules.length || ids.length !== data.template_ids.length || new Set(ids).size !== ids.length
      || ids.some(id => !catalog.rules.some(template => template.id === id))) return
    setProposal({ name: data.name, rationale: data.rationale, template_ids: ids })
  }, [catalog.rules])
  const stream = useAiStream({
    url: '/ai/alerts/packs/draft',
    body: { goal },
    scopeKey: goal,
    onEvent: handleEvent,
  })
  const { cancel } = stream
  useEffect(() => () => cancel(), [cancel])
  const busy = stream.state === 'streaming' || stream.state === 'paused-confirm'
  return (
    <AIFeatureCard
      title={t('alertPacks.aiTitle', 'Build a custom pack with Helix')}
      description={t('alertPacks.aiDescription', 'Describe your goal, from a focused group to comprehensive coverage. Helix selects supported rules; you review defaults and individual overrides before installing.')}
      buttonLabel={t('alertPacks.aiGenerate', 'Suggest an alert pack')}
      canStart={goal.trim().length >= 5 && goal.trim().length <= 2000 && !busy}
      stream={{ ...stream, start: () => { setProposal(null); stream.start() } }}
      inputSlot={<Textarea label={t('alertPacks.goal', 'What would you like to keep an eye on?')} value={goal} maxLength={2000}
        disabled={busy} onChange={event => { setGoal(event.target.value); setProposal(null) }}
        placeholder={t('alertPacks.goalExample', 'For example: a low-noise group for charging and battery on longer trips')} />}
    >
      {proposal && (
        <GlassPanel className="min-w-0 space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PanelTitle className="break-words">{proposal.name}</PanelTitle>
            <Caption>{t('alertPacks.proposedCount', '{{count}} proposed rules', { count: proposal.template_ids.length })}</Caption>
          </div>
          <Text as="p" variant="bodySm" className="break-words">{proposal.rationale}</Text>
          <div className="flex max-h-64 flex-wrap gap-2 overflow-y-auto" aria-label={t('alertPacks.proposedRules', 'Proposed rules')}>
            {proposal.template_ids.map(id => {
            const template = catalog.rules.find(rule => rule.id === id)
            return <Badge key={id} className="max-w-full whitespace-normal break-words">{t(`alertPacks.rules.${id}.name`, template?.rule.name ?? id)}</Badge>
          })}</div>
          <div className="flex flex-wrap gap-2 border-t border-[var(--border-default)] pt-3">
          <Button disabled={busy || Boolean(stream.error)} onClick={() => onApply({
            ...catalog, name: proposal.name,
            rules: proposal.template_ids.flatMap(id => catalog.rules.filter(rule => rule.id === id)),
          })}>{t('alertPacks.aiReview', 'Review this proposed pack')}</Button>
          </div>
        </GlassPanel>
      )}
    </AIFeatureCard>
  )
}

export const AIAlertPackBuilder = withAiFeature('alert-pack-builder', Inner)
export default AIAlertPackBuilder
