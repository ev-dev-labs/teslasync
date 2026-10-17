// Static busy feedback while AiOutputPanel waits for the first SSE delta.
// Labels and skeletons remain visible in every motion/bandwidth mode.

import { useTranslation } from 'react-i18next'

import { HelixMark } from '@/components/branding/HelixMark'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { cn } from '@/lib/cn'

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
  const { reduce } = useMotionPreference()
  // Fall back to the default when no override is given OR the override is
  // empty/whitespace — a role="status" live region must never announce a
  // blank string, and an empty label would render a caption-less indicator.
  const text = label?.trim() ? label : t('helix.thinkingStatusLabel', 'Helix is thinking')
  return (
    <div
      className={cn('flex flex-col gap-3', reduce && 'animate-none')}
      data-testid="ai-thinking-indicator"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
        <HelixMark
          className="h-4 w-4"
          aria-hidden="true"
        />
        <span className="font-medium">{text}</span>
        <span className="inline-flex items-end gap-1" aria-hidden="true">
          <span className="inline-block h-1 w-1 rounded-full bg-current" />
          <span className="inline-block h-1 w-1 rounded-full bg-current" />
          <span className="inline-block h-1 w-1 rounded-full bg-current" />
        </span>
      </div>
      <div className="flex flex-col gap-2" aria-hidden="true">
        <div
          className="h-3 w-full rounded-md bg-[var(--skeleton-bg)]"
        />
        <div
          className="h-3 w-11/12 rounded-md bg-[var(--skeleton-bg)]"
        />
        <div
          className="h-3 w-9/12 rounded-md bg-[var(--skeleton-bg)]"
        />
      </div>
    </div>
  )
}
AIThinkingIndicator.displayName = 'AIThinkingIndicator'

/**
 * AIThinkingDots is the compact in-button thinking indicator —
 * three small static dots after a label, suitable for use as
 * the streaming-state label on an action button. The full
 * skeleton-line indicator [AIThinkingIndicator] is too tall for
 * a button row.
 */
export function AIThinkingDots({ label }: { label: string }): JSX.Element {
  const { reduce } = useMotionPreference()
  return (
    <span className={cn('inline-flex min-w-0 max-w-full items-center gap-1.5', reduce && 'animate-none')}>
      <span className="min-w-0 break-words">{label}</span>
      <span className="inline-flex shrink-0 items-end gap-0.5" aria-hidden="true">
        <span className="inline-block h-1 w-1 rounded-full bg-current" />
        <span className="inline-block h-1 w-1 rounded-full bg-current" />
        <span className="inline-block h-1 w-1 rounded-full bg-current" />
      </span>
    </span>
  )
}
AIThinkingDots.displayName = 'AIThinkingDots'
