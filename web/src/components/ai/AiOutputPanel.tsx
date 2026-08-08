// Shared streaming-output renderer.
//
// Every AI feature whose primary render contract is a piece of
// streamed narrative or proposal text (delta-accumulated via
// useAiStream's built-in text accumulator) wants the same output
// presentation: a bordered panel showing the streamed text as it
// arrives, an animated [AIThinkingIndicator] (shimmering skeleton
// lines + bouncing-dot label) while the SSE is open and we are
// waiting for the first delta, and an inline error message if the
// stream ended in `error` state. This helper centralises that JSX
// so the per-feature component files only have to describe their
// domain-specific header + body + Generate button.
//
// The panel renders nothing when no stream has been started (text
// empty AND state is idle / paused-confirm); once a stream has run
// at least once, the panel stays visible so the user can re-read the
// output even after the stream closes. That matches the lifecycle of
// `useAiStream` (`state` goes idle → streaming → done / error).
//
// If the stream finishes (`state === 'done'`) without emitting any
// text we show an explicit empty-state line rather than an empty
// paragraph — a completed-but-silent model must never leave a blank
// panel behind.
//
// Markdown rendering is intentionally NOT applied here. The
// upstream LLM strategies are prompted to emit plain prose (or
// short structured proposals); rendering markdown would require a
// sanitiser. `whitespace-pre-wrap` preserves paragraph breaks and
// is sufficient for the current prompts.

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { HelixMark } from '@/components/branding/HelixMark'
import { AIThinkingIndicator } from '@/components/ai/AIThinkingIndicator'
import { HelixEvidenceTrail } from '@/components/ai/HelixEvidenceTrail'
import type {
  AiStreamState,
  AiToolActivity,
  AiUsage,
} from '@/hooks/useAiStream'

export interface AiOutputPanelProps {
  /** Accumulated `delta.text` payload from useAiStream. */
  text: string
  /** Current stream lifecycle state. */
  state: AiStreamState
  /** Terminal error message; only read when state === 'error'. */
  error: string | null
  /** Ordered privacy-safe provenance records from useAiStream. */
  activity?: AiToolActivity[]
  /** Terminal token accounting from useAiStream. */
  usage?: AiUsage | null
  /**
   * Optional override of the body shown when the stream is open
   * but no text has arrived yet. Default is the animated
   * [AIThinkingIndicator] (shimmering skeleton lines + dots).
   * Pass `null` to omit the placeholder entirely.
   */
  pendingChild?: ReactNode | null
}

export function AiOutputPanel({
  text,
  state,
  error,
  activity = [],
  usage = null,
  pendingChild,
}: AiOutputPanelProps): JSX.Element | null {
  const { t } = useTranslation()
  const hasAnything =
    text.length > 0 ||
    activity.length > 0 ||
    state === 'streaming' ||
    state === 'error' ||
    state === 'done'
  if (!hasAnything) return null
  return (
    <div
      className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] p-4"
      data-testid="ai-output-panel"
    >
      {state === 'error' ? (
        <p role="alert" className="text-sm text-red-300 flex items-start gap-2">
          <HelixMark
            className="h-4 w-4 text-red-300 shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <span>
            <span className="font-medium">{t('helix.errorLabel', 'Helix error:')}</span>{' '}
            {error ?? t('ai.common.errorUnknown', 'unknown')}
          </span>
        </p>
      ) : text.length === 0 && state === 'streaming' ? (
        pendingChild === undefined ? (
          <AIThinkingIndicator />
        ) : (
          pendingChild
        )
      ) : text.length === 0 ? (
        // Reachable only when state === 'done' with no accumulated text
        // (idle / paused-confirm without text return null above, streaming
        // and error are handled by the branches above). Show a placeholder
        // instead of an empty paragraph so the panel is never blank.
        <p className="text-sm text-[var(--text-muted)]">
          {t('ai.common.noOutput', 'No output was generated.')}
        </p>
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-primary)]">{text}</p>
      )}
      <HelixEvidenceTrail activity={activity} state={state} usage={usage} />
    </div>
  )
}
AiOutputPanel.displayName = 'AiOutputPanel'
