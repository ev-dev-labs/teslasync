// Reusable AI feature card scaffold.
//
// Every AI feature whose primary surface is a "header + Generate
// button + streaming output" card was duplicating ~50 lines of the
// same JSX (GlassPanel wrapper, flex header, AI badge pill,
// description, optional empty-state hint, action Button with
// streaming-aware label, AiOutputPanel). The duplication compounded
// as more features landed and the
// per-page result was visibly inconsistent: button placement, label
// styling, empty-state copy, and "Generating…" affordances all
// drifted between features even though the intent was identical.
//
// AIFeatureCard centralises that scaffold. It is parameterised by
// the per-feature labels (title / description / button / badge /
// empty hint), the lifecycle inputs (`stream`, `canStart`), an
// optional `inputSlot` for prompt-input features (textarea,
// search box) that render between the header and the action
// button, and an optional `children` slot for components that
// render extra domain-specific UI between the action button and
// the AiOutputPanel (e.g. AICrossRuleConflictDetection's conflicts
// list).
//
// What this component intentionally does NOT do:
//
// - Wrap with [withAiFeature]. That HOC adds the per-feature gate
//   (`data-testid="ai-feature-{slug}-root"`) which the off-mode
//   invariant tests assert against; we keep it at the call site so
//   each feature stays independently gateable and discoverable in
//   the registry.
// - Drive useAiStream. The stream is owned by the per-feature
//   component because every feature has its own URL, body shape,
//   and onEvent handler (some accumulate typed envelopes via
//   `tool_result` frames, e.g. AICrossRuleConflictDetection).
//
// Test contract preserved by this card (so the 38 existing per-
// feature test files keep passing without edits):
//
//   - Action button is rendered via [Button] with the universal
//     visible label "Ask Helix", but its
//     `aria-label` still includes the per-feature `buttonLabel`,
//     so `getByRole('button', { name: /<label>/ })` keeps
//     working. Anchored regexes (`/^Summarize$/i`) need to be
//     unanchored (`/Summarize/i`) because the accessible name
//     now reads "Ask Helix · <label>".
//   - Streaming-state button label is "Helix is thinking…"
//     wrapped with [AIThinkingDots] (the dots are `aria-hidden`).
//   - The `disabled` attribute mirrors `!canStart || streaming`,
//     and is paired with `aria-disabled` for screen-reader parity
//     (Rule W1-A: never a literal `disabled={true}`). While
//     streaming the button also carries `aria-busy="true"` so
//     assistive tech announces the in-flight state (idle drops the
//     attribute entirely rather than emitting `aria-busy="false"`).
//   - AiOutputPanel is rendered with the same `text/state/error`
//     props, so `getByTestId('ai-output-panel')` keeps working.

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { HelixMark } from '@/components/branding/HelixMark'
import { AiOutputPanel } from '@/components/ai/AiOutputPanel'
import { AIThinkingDots } from '@/components/ai/AIThinkingIndicator'
import { Button, GlassPanel } from '@/components/ui'
import type {
  AiStreamState,
  AiToolActivity,
  AiUsage,
} from '@/hooks/useAiStream'

// AIFeatureStream is the narrow slice of useAiStream's result shape
// that AIFeatureCard reads. We deliberately do NOT take the whole
// UseAiStreamResult so the primitive can be used with stub streams
// in unit tests without having to satisfy the cancel/limit fields.
export interface AIFeatureStream {
  state: AiStreamState
  text: string
  error: string | null
  activity?: AiToolActivity[]
  usage?: AiUsage | null
  start: () => void
}

export interface AIFeatureCardProps {
  /**
   * Card heading (required). Pass a translated string — the card
   * does not perform i18n lookups for the title because the i18n
   * key namespace is feature-specific.
   */
  title: string

  /**
   * One-paragraph description of what the AI feature does. Rendered
   * directly under the title, and re-used as the action button's
   * tooltip (`title` attribute) unless `buttonTitle` is supplied.
   */
  description: string

  /**
   * Per-feature contextual hint describing what Helix will do
   * (e.g. "Summarize", "Detect conflicts", "Generate coaching").
   *
   * Visible button text is the universal Helix-branded CTA
   * ("Ask Helix") so every AI feature has one consistent
   * signature action. The per-feature verb is redundant with the
   * card title and description, so it is exposed through:
   *   - the button's `title` attribute for hover/tooltips, and
   *   - the button's `aria-label` so screen-reader users hear the
   *     specific Helix action.
   *
   * Keeping the prop required preserves the call-site contract and
   * keeps contextual a11y/tooltip text available without forcing
   * every callsite to invent a separate prop.
   */
  buttonLabel: string

  /**
   * Optional override for the badge text. Defaults to "Helix".
   */
  badgeLabel?: string

  /**
   * Optional empty-state hint text shown beneath the description
   * when `canStart` is false (e.g. "Waiting for a feedback row…").
   * Pass `undefined` to omit.
   */
  emptyHint?: string

  /**
   * Optional override for the action button's tooltip. Defaults to
   * `description` so screen-reader users get the same context the
   * sighted description provides.
   */
  buttonTitle?: string

  /**
   * Optional `data-testid` for the action button. Most features
   * locate the button via its visible label (`getByRole('button',
   * { name: ... })`) and don't need this; supply it when you have
   * multiple action buttons in the same feature card and need a
   * stable selector.
   */
  buttonTestId?: string

  /**
   * Whether the feature has the inputs it needs to fire the stream
   * (e.g. a row is selected, a window is non-empty). When false the
   * action button is disabled and the optional `emptyHint` shows.
   */
  canStart: boolean

  /**
   * Stream lifecycle handle from useAiStream. The card reads
   * `state` (to flip the button label and disable it while in
   * flight), `text/error` (to feed AiOutputPanel), and calls
   * `start()` on click.
   */
  stream: AIFeatureStream

  /**
   * Optional override for the click handler. Defaults to
   * `stream.start`. Use this when the per-feature component needs
   * to reset local state before firing (e.g. AICrossRuleConflict
   * clears its captured conflicts list before each detect).
   */
  onAction?: () => void

  /**
   * Where the action button sits relative to the header. `inline`
   * (default) places it on the right of the header row — the
   * compact layout used by most AI features. `below` places it on
   * its own right-aligned row beneath the header (or beneath the
   * `inputSlot` if one is supplied) — used by features whose
   * header text is too long to share a row, by features with an
   * input prompt, or by features that render extra context between
   * the header and the button.
   */
  buttonPlacement?: 'inline' | 'below'

  /**
   * Optional content rendered between the header and the action
   * button — typically a Textarea / Input for prompt-input
   * features (AINLDriveSearch, AINLSearch, AILifetimeStatsQA).
   * Implies `buttonPlacement='below'` when set; passing
   * `inputSlot` with `buttonPlacement='inline'` is a programming
   * error (the input would render below the button) and the card
   * still places the button below as a safety net.
   */
  inputSlot?: ReactNode

  /**
   * Optional content rendered between the action button and the
   * AiOutputPanel. Used by features that surface typed envelopes
   * (e.g. AICrossRuleConflictDetection's conflicts list).
   */
  children?: ReactNode
}

/**
 * AIBadge is the small cyan "Helix" pill rendered next to AI feature
 * titles. Exported separately so per-feature components that build
 * a custom header (rare) can still use the same visual treatment.
 *
 * The default label is "Helix" — TeslaSync's brand name for the AI
 * assistant. Per-feature callsites can override via the `label` prop
 * but should generally not (consistency across all surfaces is the
 * goal of consolidating the badge in one place).
 */
export function AIBadge({ label }: { label?: string }): JSX.Element {
  const { t } = useTranslation()
  const text = label ?? t('helix.badge', 'Helix')
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-xs font-medium text-cyan-300"
      title={t(
        'helix.tooltip',
        'Helix grounds responses in redacted TeslaSync data, application knowledge, and explicit tool evidence.',
      )}
      aria-label={t('helix.ariaLabel', 'Helix')}
    >
      <HelixMark
        className="h-3.5 w-3.5 text-cyan-300"
        aria-hidden="true"
      />
      {text}
    </span>
  )
}
AIBadge.displayName = 'AIBadge'

/**
 * AIFeatureCard renders the standard AI feature scaffold:
 * GlassPanel → header (title + AI badge + description + optional
 * empty hint) → optional inputSlot → action Button → optional
 * children → AiOutputPanel (which renders [AIThinkingIndicator]
 * with shimmering skeleton lines while the stream is open and no
 * text has arrived).
 *
 * Pair with `withAiFeature('feature-id', ...)` at the call site so
 * the card is hidden when the per-feature flag is off.
 */
export function AIFeatureCard({
  title,
  description,
  buttonLabel,
  badgeLabel,
  emptyHint,
  buttonTitle,
  buttonTestId,
  canStart,
  stream,
  onAction,
  buttonPlacement = 'inline',
  inputSlot,
  children,
}: AIFeatureCardProps): JSX.Element {
  const { t } = useTranslation()
  const isStreaming = stream.state === 'streaming'
  const buttonDisabled = !canStart || isStreaming
  // inputSlot implies button-below — placing a button above an
  // input below is never the intended layout, so we coerce.
  const effectivePlacement: 'inline' | 'below' = inputSlot
    ? 'below'
    : buttonPlacement

  // Universal Helix CTA. The visible label is the same across
  // every AI feature surface ("Ask Helix" idle / "Helix is
  // thinking…" streaming) so the brand reads as a single,
  // recognisable action — like "Hey Google" or "Alexa" — rather
  // than 38 different verbs scattered across the app. The
  // per-feature `buttonLabel` ("Summarize", "Generate coaching",
  // …) is still surfaced as both the hover tooltip and the
  // button's aria-label so the contextual hint is preserved for
  // pointer + screen-reader users alike. The `aria-label`
  // override means accessibility-name regex assertions in tests
  // continue to work against the per-feature verb (no need to
  // rewrite the existing `getByRole('button', { name: /<verb>/ })`
  // contracts).
  const askHelixLabel = t('helix.askHelix', 'Ask Helix')
  const thinkingLabel = t('helix.thinking', 'Helix is thinking…')
  const button = (
    <Button
      variant="outline"
      size="sm"
      icon={
        <HelixMark
          className={
            isStreaming
              ? 'h-3.5 w-3.5 motion-safe:animate-pulse'
              : 'h-3.5 w-3.5'
          }
          aria-hidden="true"
        />
      }
      className="gap-1.5 whitespace-nowrap shrink-0 border-cyan-400/40 bg-cyan-500/5 text-cyan-100 dark:border-cyan-400/40 hover:border-cyan-400/70 hover:bg-cyan-500/15 hover:text-[var(--text-primary)] focus-visible:ring-cyan-400/60 transition-all"
      disabled={buttonDisabled}
      aria-disabled={buttonDisabled ? 'true' : 'false'}
      aria-busy={isStreaming || undefined}
      aria-label={`${askHelixLabel} · ${buttonLabel}`}
      onClick={() => (onAction ? onAction() : stream.start())}
      title={buttonTitle ?? buttonLabel}
      data-testid={buttonTestId}
    >
      {isStreaming ? (
        <AIThinkingDots label={thinkingLabel} />
      ) : (
        askHelixLabel
      )}
    </Button>
  )

  return (
    <GlassPanel className="p-5">
      <div className="space-y-4">
        <div
          className={
            effectivePlacement === 'inline'
              ? 'flex items-center justify-between gap-4'
              : 'flex items-start justify-between gap-4'
          }
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
              <AIBadge label={badgeLabel} />
            </div>
            <p className="text-sm text-[var(--text-secondary)]">{description}</p>
            {!canStart && emptyHint && (
              <p className="text-xs text-[var(--text-muted)]">{emptyHint}</p>
            )}
          </div>
          {effectivePlacement === 'inline' && button}
        </div>
        {inputSlot}
        {effectivePlacement === 'below' && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {button}
          </div>
        )}
        {children}
        <AiOutputPanel
          text={stream.text}
          state={stream.state}
          error={stream.error}
          activity={stream.activity}
          usage={stream.usage}
        />
      </div>
    </GlassPanel>
  )
}
AIFeatureCard.displayName = 'AIFeatureCard'
