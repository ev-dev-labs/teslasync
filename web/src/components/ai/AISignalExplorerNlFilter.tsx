// Phase-50 / 0044 — S3 Signal explorer natural-language filter.
// Phase-50 / W1 inline wiring (per slice prompt 0044) — wires the
// "Draft filter" button to POST
// /api/v1/ai/signals/filter/draft via the canonical useAiStream
// hook. The slice methodology forbids shipping the visual
// affordance without end-to-end SSE wiring; this component lands
// both in one commit so the on-mode wiring test
// (TestSignalExplorerNlFilterAIOnWiredCallsRoute) can prove the
// button actually opens an SSE stream against the registered
// backend route.
//
// AISignalExplorerNlFilter is the visible AI surface for the
// /signals/explorer page. It is rendered conditionally via
// withAiFeature('signal-explorer-nl-filter', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the
//     signal-explorer-nl-filter toggle is on, it renders an opt-in
//     section with a free-text prompt input and a "Draft filter"
//     button that POSTs to /api/v1/ai/signals/filter/draft. The
//     SSE response stream accumulates into the shared
//     AiOutputPanel; when the LLM emits a `tool_result` for
//     `draft_signal_filter`, the typed draft is captured locally
//     and an "Apply to filters" button appears, which copies the
//     draft into the page state via the `onApply` prop. The LLM
//     never edits filter state directly (ADR-015 §I8 propose-only).
//
// The component does NOT replace the deterministic SignalSelector,
// RangePicker, or PER_PAGE Select on SignalExplorerPage. That
// baseline content remains the canonical view visible to every
// user; this AI section is opt-in propose-only suggestion layered
// alongside.
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
//     callback, which the SignalExplorerPage wires into its
//     existing setSelectedSignals / setRange / setPerPage state
//     setters. The component itself does no global state writes.
//
// ADR-015 alignment:
//   - I3 baseline intact: this component never replaces the
//     deterministic SignalSelector / RangePicker / PER_PAGE
//     Select; it adds an opt-in proposal section alongside.
//   - I5 hidden UI:       the withAiFeature HOC returns null when
//     the feature is not enabled, so the section is entirely
//     absent from the DOM in off mode.
//   - I6 404 routes:      the backend route is guard-wrapped and
//     returns 404 in off mode; useAiStream surfaces that as
//     state='error' for the user, but the component is never
//     rendered in off mode at all because of I5.
//   - I8 propose-only:    the LLM never writes; the typed
//     SignalFilter it proposes is rendered here, and the user
//     must click the "Apply to filters" button to copy it into
//     the baseline form's state.

import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AiOutputPanel } from '@/components/ai/AiOutputPanel'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Button, GlassPanel, Textarea } from '@/components/ui'
import { useAiStream, type AiStreamEvent } from '@/hooks/useAiStream'

/**
 * SignalFilterDraft is the typed payload the AI side panel emits
 * when the LLM successfully calls `draft_signal_filter`. Mirrors
 * the Go-side SignalFilter DTO in
 * internal/ai/tools/signal_explorer_nl_filter.go (json tags). The
 * field set is intentionally narrow: only the fields the
 * SignalExplorerPage's deterministic filter form already owns.
 */
export interface SignalFilterDraft {
  vehicle_id: number
  signals: string[]
  range_preset: string
  per_page: number
}

export interface AISignalExplorerNlFilterProps {
  /**
   * vehicleId is the vehicle the LLM should scope its proposals
   * to. The backend handler binds this into the per-request
   * SignalCatalog scope so the LLM can ONLY propose signals from
   * that vehicle's catalog, AND can ONLY emit a SignalFilter whose
   * vehicle_id matches. A zero / negative value disables the
   * Draft button (the page hasn't picked a vehicle yet).
   */
  vehicleId: number

  /**
   * onApply is invoked when the user clicks "Apply to filters"
   * with the typed draft the LLM proposed. The page wires this
   * to its existing setSelectedSignals / setRange / setPerPage
   * setters; the AI component itself never writes page state.
   */
  onApply: (draft: SignalFilterDraft) => void
}

/**
 * parseSignalFilterDraft extracts a typed SignalFilterDraft from
 * a `tool_result` event's `data` payload. Returns null if the
 * shape doesn't match — defence-in-depth against a future
 * provider regression that emits malformed JSON. The successful
 * path is a permissive structural match (presence + types) rather
 * than a schema-equality check so a backwards-compatible field
 * addition (e.g. a future `live_mode` toggle) does not break
 * existing draft application.
 */
function parseSignalFilterDraft(data: unknown): SignalFilterDraft | null {
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>
  // The backend tool envelope wraps the typed filter in
  // `{draft, status, validation_error, source}`. Reject anything
  // whose status is not exactly "ok" — invalid drafts must not
  // become Apply-able even if a partial filter is present.
  if (obj.status !== 'ok') return null
  const draft = obj.draft
  if (!draft || typeof draft !== 'object') return null
  const d = draft as Record<string, unknown>
  if (typeof d.vehicle_id !== 'number') return null
  if (!Array.isArray(d.signals)) return null
  if (!d.signals.every((s) => typeof s === 'string')) return null
  if (typeof d.range_preset !== 'string') return null
  if (typeof d.per_page !== 'number') return null
  return {
    vehicle_id: d.vehicle_id,
    signals: d.signals as string[],
    range_preset: d.range_preset,
    per_page: d.per_page,
  }
}

/**
 * InnerSection is the always-rendered body of the AI signal
 * explorer NL filter card. The surrounding {@link withAiFeature}
 * HOC handles the visibility gate; this component only describes
 * the surface's appearance.
 */
function InnerSection(props: AISignalExplorerNlFilterProps) {
  const { vehicleId, onApply } = props
  const { t } = useTranslation()

  const [prompt, setPrompt] = useState('')
  const [draft, setDraft] = useState<SignalFilterDraft | null>(null)

  const trimmed = prompt.trim()
  const hasPrompt = trimmed.length > 0
  const hasVehicle = vehicleId > 0

  // The body is captured at start() time by useAiStream's internal
  // JSON.stringify; useMemo keeps the reference stable so the
  // hook's identity-tracking dependency array does not churn on
  // every keystroke.
  const body = useMemo(
    () => ({ vehicle_id: vehicleId, prompt: trimmed }),
    [vehicleId, trimmed],
  )

  // Capture typed `draft_signal_filter` tool results so the user
  // can click "Apply to filters" without re-parsing the SSE log.
  // We also clear any prior draft on a fresh run so a previous
  // proposal doesn't leak into a new prompt's result.
  const onEvent = useCallback((ev: AiStreamEvent) => {
    if (ev.type === 'tool_result' && ev.name === 'draft_signal_filter') {
      const parsed = parseSignalFilterDraft(ev.data)
      if (parsed) setDraft(parsed)
    }
  }, [])

  const stream = useAiStream({
    url: '/ai/signals/filter/draft',
    body,
    onEvent,
  })

  const isStreaming = stream.state === 'streaming'
  const canDraft = !isStreaming && hasPrompt && hasVehicle
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

  const description = t(
    'signalExplorer.aiFilter.description',
    'Describe the filter in plain English (e.g. "battery level for yesterday"). The LLM proposes a typed filter you can apply with one click; it never edits the form directly.',
  )

  return (
    <GlassPanel>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-white/90">
                {t(
                  'signalExplorer.aiFilter.title',
                  'AI natural-language filter',
                )}
              </h3>
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-xs font-medium text-cyan-300"
                title={t(
                  'chatbot.llm.indicatorTooltip',
                  'Responses are generated by an LLM with redacted vehicle context.',
                )}
                aria-label={t('chatbot.llm.indicator', 'AI mode')}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-300"
                  aria-hidden="true"
                />
                {t('signalExplorer.aiFilter.badge', 'AI')}
              </span>
            </div>
            <p className="text-sm text-white/60">{description}</p>
          </div>
        </div>

        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t(
            'signalExplorer.aiFilter.promptPlaceholder',
            'e.g. show me battery level for yesterday',
          )}
          rows={2}
          aria-label={t(
            'signalExplorer.aiFilter.promptLabel',
            'Filter request',
          )}
        />

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!canDraft}
            aria-disabled={!canDraft ? 'true' : 'false'}
            onClick={handleDraft}
            title={description}
          >
            {isStreaming
              ? t('ai.common.generating', 'Generating\u2026')
              : t('signalExplorer.aiFilter.button', 'Draft filter')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!canApply}
            aria-disabled={!canApply ? 'true' : 'false'}
            onClick={handleApply}
            title={t(
              'signalExplorer.aiFilter.applyTooltip',
              'Copy the proposed filter into the form above. You can still edit it before clicking Explore.',
            )}
          >
            {t('signalExplorer.aiFilter.applyButton', 'Apply to filters')}
          </Button>
        </div>

        <AiOutputPanel
          text={stream.text}
          state={stream.state}
          error={stream.error}
        />
      </div>
    </GlassPanel>
  )
}
InnerSection.displayName = 'AISignalExplorerNlFilterInner'

/**
 * AISignalExplorerNlFilter renders the LLM signal-explorer NL
 * filter section only when the signal-explorer-nl-filter feature
 * is enabled. The wrapping div from {@link withAiFeature} carries
 * `data-testid="ai-feature-signal-explorer-nl-filter-root"`,
 * which the off-mode invariant test asserts against.
 */
export const AISignalExplorerNlFilter = withAiFeature(
  'signal-explorer-nl-filter',
  InnerSection,
)
AISignalExplorerNlFilter.displayName = 'AISignalExplorerNlFilter'
