// Optional Helix proposal panel for the Grafana editor.
// Contract:
//   - Hidden entirely when ai_mode='off' or the feature toggle is disabled.
//   - POSTs to /api/v1/ai/power/grafana-panel/draft and streams into AiOutputPanel.
//   - Captures `draft_grafana_panel` tool results locally; the LLM never mutates editor state.
//   - Applies drafts only through the `onApply` callback, after explicit user action.
//   - useAiStream stays unconditional; the Draft button derives disabled state from `!canDraft`.

import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Button, Textarea } from '@/components/ui'
import { useAiStream, type AiStreamEvent } from '@/hooks/useAiStream'

/**
 * GrafanaPanelDraft is the typed payload the Helix panel emits
 * when the LLM successfully calls `draft_grafana_panel`. Mirrors
 * the Go-side GrafanaPanelDraft DTO in
 * internal/ai/tools/nl_grafana_panel.go (json tags). The field
 * set is intentionally narrow: only the panel envelope fields the
 * GrafanaPanelPage's deterministic editor already owns.
 */
export interface GrafanaPanelDraft {
  prompt: string
  panel: GrafanaPanelEnvelope
  rationale: string
  referenced_tables: string[]
}

export interface GrafanaPanelEnvelope {
  title: string
  type: string
  datasource: GrafanaDatasourceRef
  targets: GrafanaPanelTarget[]
  grid_pos: GrafanaPanelGridPos
}

export interface GrafanaDatasourceRef {
  type: string
  uid: string
}

export interface GrafanaPanelTarget {
  ref_id: string
  raw_sql?: string
  expr?: string
  format?: string
}

export interface GrafanaPanelGridPos {
  x: number
  y: number
  w: number
  h: number
}

export interface AINLGrafanaPanelProps {
  /**
   * onApply is invoked when the user clicks "Apply to editor"
   * with the typed draft the LLM proposed. The page wires this
   * to its existing setPanelJson setter; the AI component itself
   * never writes editor state.
   */
  onApply: (draft: GrafanaPanelDraft) => void
}

/**
 * parseGrafanaPanelDraft narrows the untyped `draft_grafana_panel`
 * tool-result payload ({@link AiStreamEvent}'s `data`) into a typed
 * {@link GrafanaPanelDraft}, or returns `null` when the envelope is
 * missing, its `status` is not `'ok'`, or any required field is absent
 * or the wrong type. The narrowing is intentionally strict: a
 * partially-formed draft is dropped whole rather than applied with
 * holes, so the editor never receives a panel it cannot round-trip.
 *
 * Exported for the unit test — production code reaches it only through
 * the component's `onEvent` handler (mirrors {@link parseSSEFrame} in
 * useAiStream, which is likewise exported solely for its test).
 */
export function parseGrafanaPanelDraft(data: unknown): GrafanaPanelDraft | null {
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>
  if (obj.status !== 'ok') return null
  const draft = obj.draft
  if (!draft || typeof draft !== 'object') return null
  const d = draft as Record<string, unknown>
  if (typeof d.prompt !== 'string') return null
  if (typeof d.rationale !== 'string') return null
  const panel = d.panel
  if (!panel || typeof panel !== 'object') return null
  const p = panel as Record<string, unknown>
  if (typeof p.title !== 'string') return null
  if (typeof p.type !== 'string') return null
  const ds = p.datasource
  if (!ds || typeof ds !== 'object') return null
  const dsObj = ds as Record<string, unknown>
  if (typeof dsObj.type !== 'string') return null
  if (typeof dsObj.uid !== 'string') return null
  const targets = Array.isArray(p.targets)
    ? (p.targets
        .map((t) => {
          if (!t || typeof t !== 'object') return null
          const tObj = t as Record<string, unknown>
          if (typeof tObj.ref_id !== 'string') return null
          const target: GrafanaPanelTarget = { ref_id: tObj.ref_id }
          if (typeof tObj.raw_sql === 'string') target.raw_sql = tObj.raw_sql
          if (typeof tObj.expr === 'string') target.expr = tObj.expr
          if (typeof tObj.format === 'string') target.format = tObj.format
          return target
        })
        .filter((t): t is GrafanaPanelTarget => t !== null))
    : []
  const gridPos = p.grid_pos
  if (!gridPos || typeof gridPos !== 'object') return null
  const gp = gridPos as Record<string, unknown>
  if (typeof gp.x !== 'number' || typeof gp.y !== 'number') return null
  if (typeof gp.w !== 'number' || typeof gp.h !== 'number') return null
  const tables = Array.isArray(d.referenced_tables)
    ? (d.referenced_tables.filter((s) => typeof s === 'string') as string[])
    : []
  return {
    prompt: d.prompt,
    panel: {
      title: p.title,
      type: p.type,
      datasource: { type: dsObj.type, uid: dsObj.uid },
      targets,
      grid_pos: { x: gp.x, y: gp.y, w: gp.w, h: gp.h },
    },
    rationale: d.rationale,
    referenced_tables: tables,
  }
}

function InnerSection(props: AINLGrafanaPanelProps) {
  const { onApply } = props
  const { t } = useTranslation()

  const [prompt, setPrompt] = useState('')
  const [draft, setDraft] = useState<GrafanaPanelDraft | null>(null)

  const trimmed = prompt.trim()
  const hasPrompt = trimmed.length > 0

  const body = useMemo(() => ({ prompt: trimmed }), [trimmed])

  const onEvent = useCallback((ev: AiStreamEvent) => {
    if (ev.type === 'tool_result' && ev.name === 'draft_grafana_panel') {
      const parsed = parseGrafanaPanelDraft(ev.data)
      if (parsed) setDraft(parsed)
    }
  }, [])

  const stream = useAiStream({
    url: '/ai/power/grafana-panel/draft',
    body,
    onEvent,
  })

  const isStreaming = stream.state === 'streaming'
  const canDraft = !isStreaming && hasPrompt
  const canApply = !!draft && !isStreaming

  const handleDraft = useCallback(() => {
    if (!canDraft) return
    setDraft(null)
    stream.start()
  }, [canDraft, stream])

  const handleApply = useCallback(() => {
    if (!canApply || !draft) return
    onApply(draft)
  }, [canApply, draft, onApply])

  // Null-safe, memoised view of the captured draft's referenced
  // tables so the review list below never re-creates the array on an
  // unrelated re-render and never calls .join/.length on undefined
  // (parse always yields an array, but the render stays defensive).
  const referencedTables = useMemo(() => draft?.referenced_tables ?? [], [draft])

  return (
    <AIFeatureCard
      title={t('powerGrafana.aiDrafter.title', 'Helix natural-language Grafana panel drafter')}
      description={t(
        'powerGrafana.aiDrafter.description',
        'Describe the panel you want in plain English (e.g. "show me a daily time series of how far I drove this month"). Helix proposes a typed Grafana panel JSON draft you can apply to the editor with one click; it never pushes the panel to Grafana directly.',
      )}
      buttonLabel={t('powerGrafana.aiDrafter.button', 'Draft panel')}
      badgeLabel={t('powerGrafana.aiDrafter.badge', 'Helix')}
      canStart={hasPrompt}
      stream={stream}
      onAction={handleDraft}
      inputSlot={
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t(
            'powerGrafana.aiDrafter.promptPlaceholder',
            'e.g. show me a daily time series of how far I drove this month',
          )}
          rows={2}
          aria-label={t('powerGrafana.aiDrafter.promptLabel', 'Grafana panel request')}
        />
      }
    >
      {draft && (
        <>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={!canApply}
              aria-disabled={!canApply ? 'true' : 'false'}
              onClick={handleApply}
              data-testid="ai-feature-nl-grafana-panel-apply"
              title={t(
                'powerGrafana.aiDrafter.applyTooltip',
                'Copy the proposed panel JSON into the editor above. You can still edit it before clicking Copy to clipboard.',
              )}
            >
              {t('powerGrafana.aiDrafter.applyButton', 'Apply to editor')}
            </Button>
          </div>
          <div
            role="group"
            aria-label={t(
              'powerGrafana.aiDrafter.previewLabel',
              'Proposed Grafana panel (review before applying)',
            )}
            data-testid="ai-feature-nl-grafana-panel-draft"
            className="rounded-md border border-cyan-300/30 bg-cyan-300/5 p-3 text-sm text-[var(--text-secondary)]"
          >
            <div className="font-medium text-[var(--text-primary)]">
              {draft.panel.title.trim().length > 0
                ? draft.panel.title
                : t('powerGrafana.aiDrafter.previewUntitled', 'Untitled panel')}
            </div>
            <ul className="mt-1 list-inside list-disc text-xs">
              <li>
                {t('powerGrafana.aiDrafter.previewType', 'Panel type:')}{' '}
                {draft.panel.type}
              </li>
              <li>
                {t('powerGrafana.aiDrafter.previewDatasource', 'Datasource:')}{' '}
                {draft.panel.datasource.type} ({draft.panel.datasource.uid})
              </li>
              <li>
                {t('powerGrafana.aiDrafter.previewTargets', 'Query targets:')}{' '}
                {draft.panel.targets?.length ?? 0}
              </li>
              {referencedTables.length > 0 && (
                <li>
                  {t('powerGrafana.aiDrafter.previewTables', 'Referenced tables:')}{' '}
                  {referencedTables.join(', ')}
                </li>
              )}
            </ul>
          </div>
        </>
      )}
    </AIFeatureCard>
  )
}
InnerSection.displayName = 'AINLGrafanaPanelInner'

/**
 * AINLGrafanaPanel renders the LLM nl-grafana-panel section only
 * when the nl-grafana-panel feature is enabled. The wrapping div
 * from {@link withAiFeature} carries
 * `data-testid="ai-feature-nl-grafana-panel-root"`, which the
 * off-mode invariant test asserts against.
 */
export const AINLGrafanaPanel = withAiFeature('nl-grafana-panel', InnerSection)
AINLGrafanaPanel.displayName = 'AINLGrafanaPanel'
