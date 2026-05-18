// Phase-50 / 0053 — P2 Helix quiet-hours suggestion advisor.
//
// W1 inline wiring (P11/P12):
//   - useAiStream targets POST /ai/settings/quiet-hours/draft
//     (the backend path after stripping the /api/v1 prefix).
//   - The primary action button is disabled via a COMPUTED expression
//     (`stream.state === 'streaming' || stream.state === 'paused-confirm'`),
//     never a literal `disabled` or `disabled={true}` (Rule W1-A).
//   - tool_result frames carrying a typed QuietHoursWindowProposal
//     are captured in component state; clicking "Apply to form"
//     copies the proposed scalars onto the parent form via the
//     onApplyDraft callback. The AI panel NEVER persists state
//     directly — the baseline QuietHoursPanel Save button remains
//     the sole write path (ADR-015 §I3 + §I8 propose-only contract).
//   - cancel() runs on unmount (dedicated useEffect with explicit
//     cancelStream dep so internal stream ticks do not wipe the
//     captured proposal mid-stream).
//   - Component is wrapped with withAiFeature so it is ABSENT
//     (returns null) when ai_mode='off' or the per-feature toggle
//     is off (ADR-015 §I5 hidden UI).
//
// HX (Helix UX) contract:
//   - The surface renders through the shared AIFeatureCard
//     scaffold — NOT a bespoke GlassPanel + Button + AiOutputPanel
//     composition.
//   - The per-feature verb "Suggest quiet hours" is passed via
//     `buttonLabel`. The card composes the accessible name as
//     "Ask Helix · Suggest quiet hours".
//   - User-visible i18n keys say "Helix", not "AI" (per the HX
//     addendum).
//
// ADR-015 alignment:
//   - I3 baseline intact: this component never replaces the
//     deterministic QuietHoursPanel; it adds an opt-in proposal
//     section above it whose only mutation path is "Apply to
//     form" → seeds the panel's draft → user clicks the canonical
//     Save button on the panel.
//   - I5 hidden UI:       the withAiFeature HOC returns null when
//     the feature is not enabled, so the section is entirely
//     absent from the DOM in off mode.
//   - I6 404 routes:      the backend route is guard-wrapped and
//     returns 404 in off mode; useAiStream surfaces that as
//     state='error' for the user, but the component is never
//     rendered in off mode at all because of I5.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Button } from '@/components/ui'
import type { AiStreamEvent } from '@/hooks/useAiStream'
import { useAiStream } from '@/hooks/useAiStream'
import type { QuietHoursWindowInput } from '@/api/types'

// QuietHoursDraftProposal is the typed envelope the AI tool
// returns. Mirrors the backend QuietHoursWindowProposal struct
// in internal/ai/tools/quiet_hours_suggestion.go but holds only
// the fields the baseline form consumes — keeping it narrow
// here prevents the Helix panel from over-writing fields the
// user did not consent to changing.
export interface QuietHoursDraftProposal {
  start_local: string
  end_local: string
  timezone: string
  weekdays: number
  bypass_severities: string[]
  status: string
  existing_windows_count: number
}

export interface AIQuietHoursSuggestionProps {
  /**
   * Called when the user clicks "Apply to form" on a captured
   * proposal. The parent (QuietHoursPage) forwards the typed
   * scalars into QuietHoursPanel via its `seedDraft` prop. The
   * AI panel never writes to the API directly — the user
   * clicks the canonical Save button on the panel next.
   */
  onApplyDraft: (patch: QuietHoursWindowInput) => void
}

function InnerSection({ onApplyDraft }: AIQuietHoursSuggestionProps) {
  const { t } = useTranslation()
  const [proposal, setProposal] = useState<QuietHoursDraftProposal | null>(null)

  // Body is the empty object — the backend reads the user's
  // identity from the ForwardAuth subject and applies
  // deterministic defaults for timezone / window_days. A future
  // edit may surface those knobs in the UI; for now an empty
  // body matches the most common case (one click → one
  // recommendation in the user's local timezone over the
  // trailing 30 days).
  //
  // useMemo so useAiStream's deps are stable across renders.
  const body = useMemo(() => ({}), [])

  const handleEvent = useCallback((ev: AiStreamEvent) => {
    if (
      ev.type === 'tool_result' &&
      ev.name === 'draft_quiet_hours_window' &&
      ev.ok
    ) {
      const data = ev.data as
        | {
            start_local?: string
            end_local?: string
            timezone?: string
            weekdays?: number
            bypass_severities?: string[]
            status?: string
            existing_windows_count?: number
          }
        | undefined
      if (
        !data ||
        typeof data.start_local !== 'string' ||
        typeof data.end_local !== 'string' ||
        typeof data.timezone !== 'string' ||
        typeof data.weekdays !== 'number' ||
        !Array.isArray(data.bypass_severities)
      ) {
        return
      }
      setProposal({
        start_local: data.start_local,
        end_local: data.end_local,
        timezone: data.timezone,
        weekdays: data.weekdays,
        bypass_severities: data.bypass_severities.filter(
          (s): s is string => typeof s === 'string',
        ),
        status: typeof data.status === 'string' ? data.status : 'ok',
        existing_windows_count:
          typeof data.existing_windows_count === 'number'
            ? data.existing_windows_count
            : 0,
      })
    }
  }, [])

  const stream = useAiStream({
    url: '/ai/settings/quiet-hours/draft',
    body,
    onEvent: handleEvent,
  })

  // Pull cancel out so the cleanup effect's deps stay narrow.
  // The hook returns a stable cancel reference, so destructuring
  // here keeps the effect dep on cancelStream only. Including
  // the whole stream object would re-run the cleanup on every
  // internal state tick of useAiStream and wipe the captured
  // proposal mid-stream.
  const { cancel: cancelStream } = stream

  // Cancel + reset on unmount so a stale stream cannot bleed
  // proposals into a subsequent mount of the panel. Dedicated
  // effect so the cleanup deps stay explicit (Rule of Hooks /
  // W1 §6).
  useEffect(() => {
    return () => {
      cancelStream()
      setProposal(null)
    }
  }, [cancelStream])

  const isBusy =
    stream.state === 'streaming' || stream.state === 'paused-confirm'

  const handleSuggest = useCallback(() => {
    if (isBusy) {
      return // double-submit no-op
    }
    setProposal(null)
    stream.start()
  }, [isBusy, stream])

  const handleApply = useCallback(() => {
    if (!proposal) {
      return
    }
    onApplyDraft({
      enabled: true,
      start_local: proposal.start_local,
      end_local: proposal.end_local,
      timezone: proposal.timezone,
      weekdays: proposal.weekdays,
      bypass_severities: proposal.bypass_severities,
    })
  }, [proposal, onApplyDraft])

  return (
    <AIFeatureCard
      title={t(
        'notifications.quietHours.aiSuggestion.title',
        'Suggest a quiet-hours window from your notification history',
      )}
      description={t(
        'notifications.quietHours.aiSuggestion.description',
        'Ask Helix to recommend ONE quiet-hours window based on the trailing 30 days of your notification cadence. Helix never reads individual notification titles or messages — it consults a per-hour aggregate of non-critical events to find the sparsest interval. Apply the recommendation to seed the form below; you remain in control of the Save button.',
      )}
      buttonLabel={t(
        'notifications.quietHours.aiSuggestion.button',
        'Suggest quiet hours',
      )}
      badgeLabel={t('notifications.quietHours.aiSuggestion.badge', 'Helix')}
      canStart={stream.state !== 'paused-confirm'}
      stream={stream}
      onAction={handleSuggest}
      buttonPlacement="below"
      buttonTestId="ai-feature-quiet-hours-suggestion-suggest"
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
              data-testid="ai-feature-quiet-hours-suggestion-apply"
            >
              {t(
                'notifications.quietHours.aiSuggestion.applyButton',
                'Apply to form',
              )}
            </Button>
          </div>
          <div className="rounded-md border border-emerald-300/30 bg-emerald-300/5 p-3 text-sm text-emerald-300">
            <div className="font-medium">
              {t(
                'notifications.quietHours.aiSuggestion.previewLabel',
                'Proposed window (review before saving):',
              )}
            </div>
            <ul className="mt-1 list-inside list-disc text-xs text-[var(--text-secondary)]">
              <li>
                {t(
                  'notifications.quietHours.aiSuggestion.previewWindow',
                  'Window: {{start}} → {{end}} ({{tz}})',
                  {
                    start: proposal.start_local,
                    end: proposal.end_local,
                    tz: proposal.timezone,
                  },
                )}
              </li>
              <li>
                {t(
                  'notifications.quietHours.aiSuggestion.previewWeekdays',
                  'Weekday bitmask: {{weekdays}}',
                  { weekdays: proposal.weekdays },
                )}
              </li>
              <li>
                {t(
                  'notifications.quietHours.aiSuggestion.previewBypass',
                  'Bypass severities: {{severities}}',
                  { severities: proposal.bypass_severities.join(', ') },
                )}
              </li>
              {proposal.status === 'insufficient_history' && (
                <li className="text-amber-300">
                  {t(
                    'notifications.quietHours.aiSuggestion.previewInsufficientHistory',
                    'Helix had insufficient notification history; this is a conservative default.',
                  )}
                </li>
              )}
              {proposal.existing_windows_count > 0 && (
                <li className="text-[var(--text-secondary)]">
                  {t(
                    'notifications.quietHours.aiSuggestion.previewExistingCount',
                    'You already have {{count}} quiet-hours window(s) configured.',
                    { count: proposal.existing_windows_count },
                  )}
                </li>
              )}
            </ul>
          </div>
        </>
      )}
    </AIFeatureCard>
  )
}
InnerSection.displayName = 'AIQuietHoursSuggestionInner'

/**
 * AIQuietHoursSuggestion renders the LLM quiet-hours advisor
 * section only when the quiet-hours-suggestion feature is
 * enabled. The wrapping div from {@link withAiFeature} carries
 * `data-testid="ai-feature-quiet-hours-suggestion-root"`, which
 * the off-mode invariant test asserts against.
 */
export const AIQuietHoursSuggestion = withAiFeature(
  'quiet-hours-suggestion',
  InnerSection,
)
AIQuietHoursSuggestion.displayName = 'AIQuietHoursSuggestion'
