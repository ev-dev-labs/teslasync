// Phase-50 / W1 (slice 0065) — shared streaming-output renderer.
//
// Every AI feature whose primary render contract is a piece of
// streamed narrative or proposal text (delta-accumulated via
// useAiStream's built-in text accumulator) wants the same output
// presentation: a bordered panel showing the streamed text as it
// arrives, an animated "Generating…" affordance while the SSE is
// open, and an inline error message if the stream ended in `error`
// state. This helper centralises that JSX so the per-feature
// component files only have to describe their domain-specific
// header + body + Generate button.
//
// The panel renders nothing when no stream has been started (text
// empty AND state is idle); once a stream has run at least once,
// the panel stays visible so the user can re-read the output even
// after the stream closes. That matches the lifecycle of
// `useAiStream` (`state` goes idle → streaming → done / error).
//
// Markdown rendering is intentionally NOT applied here. The
// upstream LLM strategies are prompted to emit plain prose (or
// short structured proposals); rendering markdown would require a
// sanitiser. `whitespace-pre-wrap` preserves paragraph breaks and
// is sufficient for the current prompts.

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { AiStreamState } from '@/hooks/useAiStream'

export interface AiOutputPanelProps {
  /** Accumulated `delta.text` payload from useAiStream. */
  text: string
  /** Current stream lifecycle state. */
  state: AiStreamState
  /** Terminal error message; only read when state === 'error'. */
  error: string | null
  /**
   * Optional override of the body shown when the stream is open
   * but no text has arrived yet. Default is a small "Generating…"
   * label. Pass `null` to omit.
   */
  pendingChild?: ReactNode | null
}

export function AiOutputPanel({
  text,
  state,
  error,
  pendingChild,
}: AiOutputPanelProps): JSX.Element | null {
  const { t } = useTranslation()
  const hasAnything = text.length > 0 || state === 'streaming' || state === 'error' || state === 'done'
  if (!hasAnything) return null
  return (
    <div
      className="rounded-lg border border-white/10 bg-white/[0.02] p-4"
      data-testid="ai-output-panel"
    >
      {state === 'error' ? (
        <p className="text-sm text-red-300">
          <span className="font-medium">{t('ai.common.errorLabel', 'AI error:')}</span>{' '}
          {error ?? t('ai.common.errorUnknown', 'unknown')}
        </p>
      ) : text.length === 0 && state === 'streaming' ? (
        pendingChild === undefined ? (
          <p className="text-sm text-white/60">{t('ai.common.generating', 'Generating…')}</p>
        ) : (
          pendingChild
        )
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/85">{text}</p>
      )}
    </div>
  )
}
AiOutputPanel.displayName = 'AiOutputPanel'
