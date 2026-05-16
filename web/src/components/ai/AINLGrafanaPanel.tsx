// Phase-50 / 0058 — PU2 Natural-language Grafana panel.
// Phase-50 / W1 inline wiring (per slice prompt 0058) — wires the
// "Draft panel" button to POST /api/v1/ai/power/grafana-panel/draft
// via the canonical useAiStream hook. The slice methodology
// forbids shipping the visual affordance without end-to-end SSE
// wiring; this component lands both in one commit so the on-mode
// wiring test (TestNlGrafanaPanelAIOnWiredCallsRoute) can prove
// the button actually opens an SSE stream against the registered
// backend route.
//
// AINLGrafanaPanel is the visible AI surface for the
// /power/grafana page. It is rendered conditionally via
// withAiFeature('nl-grafana-panel', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the nl-grafana-panel
//     toggle is on, it renders an opt-in section with a free-text
//     prompt input and a "Draft panel" button that POSTs to
//     /api/v1/ai/power/grafana-panel/draft. The SSE response
//     stream accumulates into the shared AiOutputPanel; when the
//     LLM emits a `tool_result` for `draft_grafana_panel`, the
//     typed draft is captured locally and an "Apply to editor"
//     button appears, which copies the draft (formatted as
//     pretty-printed JSON) into the page state via the `onApply`
//     prop. The LLM never edits editor state directly
//     (ADR-015 §I8 propose-only).
//
// The component does NOT replace the deterministic manual JSON
// editor or curated catalog viewer on GrafanaPanelPage. That
// baseline content remains the canonical view visible to every
// user; this AI section is an opt-in propose-only suggestion
// layered alongside.
//
// Render contract (P11/P12 — Wired-or-absent, No-placeholder-buttons):
//   - useAiStream is called unconditionally at the top of the body
//     (Hooks-rules safe).
//   - The Draft button's disabled prop is a COMPUTED expression
//     (`!canDraft`), never a literal `disabled` or
//     `disabled={true}`.
//   - Double-submit protection: stream.start() is a no-op while
//     state === 'streaming' (the hook coalesces; the button is
//     also visually disabled to mirror the state machine).
//   - The streamed text accumulates into AiOutputPanel which
//     renders the SSE delta stream as-it-arrives.
//   - The captured draft is applied via the `onApply` prop's
//     callback, which the GrafanaPanelPage wires into its
//     existing setPanelJson state setter. The component itself
//     does no global state writes.
//
// ADR-015 alignment:
//   - I3 baseline intact: this component never replaces the
//     deterministic manual JSON editor or curated catalog viewer;
//     it adds an opt-in proposal section alongside.
//   - I5 hidden UI:       the withAiFeature HOC returns null when
//     the feature is not enabled, so the section is entirely
//     absent from the DOM in off mode.
//   - I6 404 routes:      the backend route is guard-wrapped and
//     returns 404 in off mode; useAiStream surfaces that as
//     state='error' for the user, but the component is never
//     rendered in off mode at all because of I5.
//   - I8 propose-only:    the LLM never writes; the typed
//     GrafanaPanelDraft it proposes is rendered here, and the
//     user must click the "Apply to editor" button to copy it
//     into the baseline editor's state, then explicitly click
//     the baseline Copy to clipboard button to export.

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

function parseGrafanaPanelDraft(data: unknown): GrafanaPanelDraft | null {
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
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={!canApply}
            aria-disabled={!canApply ? 'true' : 'false'}
            onClick={handleApply}
            title={t(
              'powerGrafana.aiDrafter.applyTooltip',
              'Copy the proposed panel JSON into the editor above. You can still edit it before clicking Copy to clipboard.',
            )}
          >
            {t('powerGrafana.aiDrafter.applyButton', 'Apply to editor')}
          </Button>
        </div>
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
