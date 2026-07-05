// Animated AI thinking indicator.
//
// Replaces the plain-text "Generating…" placeholder shown while
// AiOutputPanel waits for the first SSE delta.
//
// AIThinkingIndicator renders three shimmering skeleton lines
// (decreasing widths to mimic prose) underneath an animated
// "Helix is thinking" label with bouncing dots. Both halves use
// existing tailwind animation tokens (`shimmer`, `pulse`,
// `pulse-slow`) so no new keyframes are introduced. The cyan tint
// matches the AI badge so the visual language is consistent across
// every AI surface.
//
// The component is reduced-motion-aware: when the user has
// `prefers-reduced-motion`, the dots stop bouncing and the lines
// drop the shimmer (the static skeleton is still visible). This is
// implemented purely via tailwind's `motion-safe:` variant —
// nothing JS-side checks the media query.

import { useTranslation } from 'react-i18next'

import { HelixMark } from '@/components/branding/HelixMark'

export interface AIThinkingIndicatorProps {
  /**
   * Optional override for the leading label (default
   * `t('helix.thinking', 'Helix is thinking')`). Pass a translated
   * string when the surrounding feature wants a domain-specific
   * verb (e.g. "Helix is summarising" for a summary card). An empty
   * or whitespace-only value falls back to the default so the status
   * live region is never announced blank.
   */
  label?: string
}

/**
 * AIThinkingIndicator is the streaming-but-empty state shown while
 * the SSE connection is open and we are waiting for the first
 * `delta.text` frame. Pair with [AiOutputPanel]'s `pendingChild`
 * prop, or render directly inside any AI surface that needs to
 * convey "the model is working" before the first token arrives.
 */
export function AIThinkingIndicator({
  label,
}: AIThinkingIndicatorProps): JSX.Element {
  const { t } = useTranslation()
  // Fall back to the default when no override is given OR the override is
  // empty/whitespace — a role="status" live region must never announce a
  // blank string, and an empty label would render a caption-less indicator.
  const text = label?.trim() ? label : t('helix.thinking', 'Helix is thinking')
  return (
    <div
      className="flex flex-col gap-3"
      data-testid="ai-thinking-indicator"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-sm text-cyan-300/90">
        <HelixMark
          className="h-4 w-4 text-cyan-300 motion-safe:animate-pulse"
          aria-hidden="true"
        />
        <span className="font-medium">{text}</span>
        <span className="inline-flex items-end gap-1" aria-hidden="true">
          <span className="motion-safe:animate-bounce motion-safe:[animation-delay:-0.3s] inline-block h-1 w-1 rounded-full bg-cyan-300" />
          <span className="motion-safe:animate-bounce motion-safe:[animation-delay:-0.15s] inline-block h-1 w-1 rounded-full bg-cyan-300" />
          <span className="motion-safe:animate-bounce inline-block h-1 w-1 rounded-full bg-cyan-300" />
        </span>
      </div>
      <div className="flex flex-col gap-2" aria-hidden="true">
        <div
          className="h-3 w-full rounded-md motion-safe:animate-shimmer bg-[linear-gradient(90deg,rgba(255,255,255,0.04)_0%,rgba(0,240,255,0.10)_50%,rgba(255,255,255,0.04)_100%)] bg-[length:200%_100%]"
        />
        <div
          className="h-3 w-11/12 rounded-md motion-safe:animate-shimmer bg-[linear-gradient(90deg,rgba(255,255,255,0.04)_0%,rgba(0,240,255,0.10)_50%,rgba(255,255,255,0.04)_100%)] bg-[length:200%_100%] [animation-delay:0.3s]"
        />
        <div
          className="h-3 w-9/12 rounded-md motion-safe:animate-shimmer bg-[linear-gradient(90deg,rgba(255,255,255,0.04)_0%,rgba(0,240,255,0.10)_50%,rgba(255,255,255,0.04)_100%)] bg-[length:200%_100%] [animation-delay:0.6s]"
        />
      </div>
    </div>
  )
}
AIThinkingIndicator.displayName = 'AIThinkingIndicator'

/**
 * AIThinkingDots is the compact in-button thinking indicator —
 * three small bouncing dots after a label, suitable for use as
 * the streaming-state label on an action button. The full
 * skeleton-line indicator [AIThinkingIndicator] is too tall for
 * a button row.
 */
export function AIThinkingDots({ label }: { label: string }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{label}</span>
      <span className="inline-flex items-end gap-0.5" aria-hidden="true">
        <span className="motion-safe:animate-bounce motion-safe:[animation-delay:-0.3s] inline-block h-1 w-1 rounded-full bg-current" />
        <span className="motion-safe:animate-bounce motion-safe:[animation-delay:-0.15s] inline-block h-1 w-1 rounded-full bg-current" />
        <span className="motion-safe:animate-bounce inline-block h-1 w-1 rounded-full bg-current" />
      </span>
    </span>
  )
}
AIThinkingDots.displayName = 'AIThinkingDots'
