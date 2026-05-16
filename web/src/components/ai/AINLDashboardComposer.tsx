// Phase-50 / 0059 — PU3 Natural-language dashboard composer.
// Phase-50 / W1 inline wiring (per slice prompt 0059) — wires the
// "Draft dashboard" button to POST /api/v1/ai/power/dashboard/draft
// via the canonical useAiStream hook. The slice methodology
// forbids shipping the visual affordance without end-to-end SSE
// wiring; this component lands both in one commit so the on-mode
// wiring test (TestNlDashboardComposerAIOnWiredCallsRoute) can
// prove the button actually opens an SSE stream against the
// registered backend route.
//
// AINLDashboardComposer is the visible AI surface for the
// /power/dashboards page. It is rendered conditionally via
// withAiFeature('nl-dashboard-composer', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the
//     nl-dashboard-composer toggle is on, it renders an opt-in
//     section with a free-text prompt input and a "Draft
//     dashboard" button that POSTs to
//     /api/v1/ai/power/dashboard/draft. The SSE response
//     stream accumulates into the shared AiOutputPanel; when
//     the LLM emits a `tool_result` for `draft_dashboard_layout`,
//     the typed draft is captured locally and an "Apply to
//     editor" button appears, which copies the draft (formatted
//     as pretty-printed JSON) into the page state via the
//     `onApply` prop. The LLM never edits editor state directly
//     (ADR-015 §I8 propose-only).
//
// The component does NOT replace the deterministic manual JSON
// dashboard composer or curated panel catalog viewer on
// DashboardsPage. That baseline content remains the canonical
// view visible to every user; this AI section is an opt-in
// propose-only suggestion layered alongside.
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
//     callback, which the DashboardsPage wires into its
//     existing setDashboardJson state setter. The component
//     itself does no global state writes.
//
// ADR-015 alignment:
//   - I3 baseline intact: this component never replaces the
//     deterministic manual JSON dashboard composer or curated
//     catalog viewer; it adds an opt-in proposal section
//     alongside.
//   - I5 hidden UI:       the withAiFeature HOC returns null
//     when the feature is not enabled, so the section is
//     entirely absent from the DOM in off mode.
//   - I6 404 routes:      the backend route is guard-wrapped
//     and returns 404 in off mode; useAiStream surfaces that as
//     state='error' for the user, but the component is never
//     rendered in off mode at all because of I5.
//   - I8 propose-only:    the LLM never writes; the typed
//     DashboardLayoutDraft it proposes is rendered here, and
//     the user must click the "Apply to editor" button to copy
//     it into the baseline composer's state, then explicitly
//     click the baseline Copy to clipboard button to export.

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

function parseDashboardLayoutDraft(data: unknown): DashboardLayoutDraft | null {
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
          if (typeof g.x !== 'number' || typeof g.y !== 'number') return null
          if (typeof g.w !== 'number' || typeof g.h !== 'number') return null
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
    if (ev.type === 'tool_result' && ev.name === 'draft_dashboard_layout') {
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
