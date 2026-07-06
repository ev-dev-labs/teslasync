// Natural-language dashboard composer for /power/dashboards.
// The Draft dashboard button POSTs to /api/v1/ai/power/dashboard/draft
// through useAiStream and streams output into AiOutputPanel.
// tool_result frames for `draft_dashboard_layout` are captured locally;
// the user must click "Apply to editor" before the draft touches the
// manual JSON composer. The manual composer and panel catalog remain the
// canonical surfaces, and withAiFeature removes this section when the
// feature is off. The button disabled state is computed from live state,
// so it guards double-submit without relying on a hardcoded disabled prop.

import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Button, Textarea } from '@/components/ui'
import { useAiStream, type AiStreamEvent } from '@/hooks/useAiStream'

/**
 * DashboardLayoutDraft is the typed payload the Helix panel
 * emits when the LLM successfully calls
 * `draft_dashboard_layout`. Mirrors the Go-side
 * DashboardLayoutDraft DTO in
 * internal/ai/tools/nl_dashboard_composer.go (json tags). The
 * field set is intentionally narrow: only the dashboard
 * envelope fields the DashboardsPage's deterministic composer
 * already owns.
 */
export interface DashboardLayoutDraft {
  prompt: string
  dashboard: DashboardEnvelope
  rationale: string
  referenced_panels: string[]
}

export interface DashboardEnvelope {
  title: string
  slots: DashboardSlot[]
}

export interface DashboardSlot {
  panel_name: string
  grid_pos: DashboardSlotGrid
}

export interface DashboardSlotGrid {
  x: number
  y: number
  w: number
  h: number
}

export interface AINLDashboardComposerProps {
  /**
   * onApply is invoked when the user clicks "Apply to editor"
   * with the typed draft the LLM proposed. The page wires this
   * to its existing setDashboardJson setter; the AI component
   * itself never writes editor state.
   */
  onApply: (draft: DashboardLayoutDraft) => void
}

/**
 * parseDashboardLayoutDraft narrows the untyped `tool_result.data`
 * payload emitted by the `draft_dashboard_layout` tool into a typed
 * {@link DashboardLayoutDraft}, or returns `null` when the envelope is
 * malformed. It is intentionally strict: a single missing or
 * wrong-typed top-level field collapses the whole parse to `null` so a
 * partial draft never reaches the editor. Individual slots that fail
 * validation are dropped (not the whole draft) so one bad panel from
 * the LLM does not discard the rest of the layout, and grid
 * coordinates must be finite numbers (`NaN`/`Infinity` are rejected)
 * so a nonsensical position can never be copied into the composer.
 *
 * Exported for direct unit testing — production code reaches it only
 * through {@link AINLDashboardComposer}'s stream `onEvent` handler.
 */
export function parseDashboardLayoutDraft(data: unknown): DashboardLayoutDraft | null {
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>
  if (obj.status !== 'ok') return null
  const draft = obj.draft
  if (!draft || typeof draft !== 'object') return null
  const d = draft as Record<string, unknown>
  if (typeof d.prompt !== 'string') return null
  if (typeof d.rationale !== 'string') return null
  const dashboard = d.dashboard
  if (!dashboard || typeof dashboard !== 'object') return null
  const dash = dashboard as Record<string, unknown>
  if (typeof dash.title !== 'string') return null
  const slots = Array.isArray(dash.slots)
    ? (dash.slots
        .map((s) => {
          if (!s || typeof s !== 'object') return null
          const sObj = s as Record<string, unknown>
          if (typeof sObj.panel_name !== 'string') return null
          const grid = sObj.grid_pos
          if (!grid || typeof grid !== 'object') return null
          const g = grid as Record<string, unknown>
          if (typeof g.x !== 'number' || !Number.isFinite(g.x)) return null
          if (typeof g.y !== 'number' || !Number.isFinite(g.y)) return null
          if (typeof g.w !== 'number' || !Number.isFinite(g.w)) return null
          if (typeof g.h !== 'number' || !Number.isFinite(g.h)) return null
          const slot: DashboardSlot = {
            panel_name: sObj.panel_name,
            grid_pos: { x: g.x, y: g.y, w: g.w, h: g.h },
          }
          return slot
        })
        .filter((s): s is DashboardSlot => s !== null))
    : []
  const panels = Array.isArray(d.referenced_panels)
    ? (d.referenced_panels.filter((s) => typeof s === 'string') as string[])
    : []
  return {
    prompt: d.prompt,
    dashboard: {
      title: dash.title,
      slots,
    },
    rationale: d.rationale,
    referenced_panels: panels,
  }
}

function InnerSection(props: AINLDashboardComposerProps) {
  const { onApply } = props
  const { t } = useTranslation()

  const [prompt, setPrompt] = useState('')
  const [draft, setDraft] = useState<DashboardLayoutDraft | null>(null)

  const trimmed = prompt.trim()
  const hasPrompt = trimmed.length > 0

  const body = useMemo(() => ({ prompt: trimmed }), [trimmed])

  const onEvent = useCallback((ev: AiStreamEvent) => {
    // Only a SUCCESSFUL draft_dashboard_layout tool call can produce a
    // draft. A failed call (ok === false) may still carry a data
    // payload (the tool's error envelope); parsing it must never be
    // mistaken for a valid draft, so gate on `ev.ok` before parsing.
    if (ev.type === 'tool_result' && ev.ok && ev.name === 'draft_dashboard_layout') {
      const parsed = parseDashboardLayoutDraft(ev.data)
      if (parsed) setDraft(parsed)
    }
  }, [])

  const stream = useAiStream({
    url: '/ai/power/dashboard/draft',
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

  return (
    <AIFeatureCard
      title={t('powerDashboards.aiDrafter.title', 'Helix natural-language dashboard composer')}
      description={t(
        'powerDashboards.aiDrafter.description',
        'Describe the dashboard you want in plain English (e.g. "give me an overview dashboard with daily drives, current battery, and recent alerts"). Helix proposes a typed dashboard JSON draft built from the in-scope curated panel catalog you can apply to the editor with one click; it never pushes the dashboard to Grafana directly.',
      )}
      buttonLabel={t('powerDashboards.aiDrafter.button', 'Draft dashboard')}
      badgeLabel={t('powerDashboards.aiDrafter.badge', 'Helix')}
      canStart={hasPrompt}
      stream={stream}
      onAction={handleDraft}
      inputSlot={
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t(
            'powerDashboards.aiDrafter.promptPlaceholder',
            'e.g. give me an overview dashboard with daily drives, current battery, and recent alerts',
          )}
          rows={2}
          aria-label={t('powerDashboards.aiDrafter.promptLabel', 'Dashboard request')}
        />
      }
    >
      {draft && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={!canApply}
            aria-disabled={!canApply ? 'true' : 'false'}
            onClick={handleApply}
            title={t(
              'powerDashboards.aiDrafter.applyTooltip',
              'Copy the proposed dashboard JSON into the editor above. You can still edit it before clicking Copy to clipboard.',
            )}
          >
            {t('powerDashboards.aiDrafter.applyButton', 'Apply to editor')}
          </Button>
        </div>
      )}
    </AIFeatureCard>
  )
}
InnerSection.displayName = 'AINLDashboardComposerInner'

/**
 * AINLDashboardComposer renders the LLM nl-dashboard-composer
 * section only when the nl-dashboard-composer feature is
 * enabled. The wrapping div from {@link withAiFeature} carries
 * `data-testid="ai-feature-nl-dashboard-composer-root"`, which
 * the off-mode invariant test asserts against.
 */
export const AINLDashboardComposer = withAiFeature('nl-dashboard-composer', InnerSection)
AINLDashboardComposer.displayName = 'AINLDashboardComposer'
