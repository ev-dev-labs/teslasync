import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from './Button'
import { CopyButton } from './CopyButton'
import { apiUrl } from '@/api/client'
import { maskFor, type MaskVariant } from '@/lib/maskValue'
import { cn } from '@/lib/cn'

/**
 * `<MaskedValue>` privacy primitive.
 *
 * Renders a sensitive string in masked form by default with a
 * click-to-reveal affordance. Used wherever the cleartext value is
 * occasionally needed for copy/paste or visual confirmation but should
 * never be shown to a casual screen-share viewer.
 *
 * Behavioural contract:
 *
 *   - Initial render is always masked. The `aria-label` describes the
 *     value semantically (e.g. "API key, click to reveal") so screen
 *     readers do not blurt out the raw value.
 *   - Clicking the eye toggle reveals the value AND, when
 *     `auditOnReveal=true`, fires a fire-and-forget POST to
 *     `/api/v1/audit/reveal` so the action is recorded in audit_logs.
 *     Audit failures NEVER block the UX.
 *   - The reveal auto-hides after 30 seconds. Manually toggling back
 *     also clears the timer.
 *   - The copy button (when `copyable`) always copies the underlying
 *     value, regardless of mask state. This is the primary reason the
 *     primitive exists — operators can still hand off the secret
 *     without a permanent on-screen reveal.
 *
 * Accessibility:
 *
 *   - The eye toggle is a real `<button>` with an aria-label that
 *     mirrors the current state ("Reveal value" / "Hide value").
 *   - The reveal does not read the raw value via `aria-live`; screen
 *     readers will still need explicit interaction with the toggle to
 *     know the value changed (this is intentional — broadcasting a
 *     newly-revealed secret over assistive tech defeats the purpose).
 *   - The masked text is wrapped in `<code>` so monospace rendering is
 *     consistent across all variants.
 *
 * Why default `auditOnReveal=false`:
 *
 *   - The privacy primitive shipped before the `POST /audit/reveal`
 *     route. The visible mask is the primary protection; audit-on-reveal
 *     should only be enabled once that route exists. The default is
 *     conservative so every reveal does not silently 404 in the meantime.
 */

export type MaskedValueVariant = MaskVariant

export interface MaskedValueProps {
  /** The raw value to mask. Empty/undefined renders an em-dash. */
  value: string | null | undefined
  /** Masking strategy — see `maskFor()` in `@/lib/maskValue`. */
  variant: MaskedValueVariant
  /** Override the variant's default visible-suffix length. */
  showLast?: number
  /** Render a copy button next to the toggle that copies the raw value. */
  copyable?: boolean
  /** When true, POSTs `/audit/reveal` on each reveal. Default: false. */
  auditOnReveal?: boolean
  /** Required: human-readable description for screen readers and tests. */
  ariaLabel: string
  /** Override the auto-hide duration (ms). Default: 30 000. */
  autoHideMs?: number
  /** Optional className for the outer wrapper. */
  className?: string
}

const DEFAULT_AUTO_HIDE_MS = 30_000

/**
 * Fire-and-forget audit POST. Plain `fetch` (NOT the resilient
 * pipeline) so a non-existent endpoint or transient backend failure
 * never opens a session-expired modal or otherwise interferes with
 * the reveal UX. Errors are swallowed by design.
 */
function postRevealAudit(variant: string): void {
  try {
    void fetch(apiUrl('/audit/reveal'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'masked_reveal', variant }),
      credentials: 'include',
      keepalive: true,
    }).catch(() => {
      /* silent: audit is defense-in-depth; never block reveal UX */
    })
  } catch {
    /* silent: same rationale as above for synchronous throw paths */
  }
}

export function MaskedValue({
  value,
  variant,
  showLast,
  copyable = false,
  auditOnReveal = false,
  ariaLabel,
  autoHideMs = DEFAULT_AUTO_HIDE_MS,
  className,
}: MaskedValueProps) {
  const { t } = useTranslation()
  const [revealed, setRevealed] = useState(false)
  const timerRef = useRef<number | null>(null)
  const reactId = useId()

  const raw = value ?? ''
  const masked = useMemo(() => maskFor(raw, variant, showLast), [raw, variant, showLast])

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // Always release the auto-hide timer on unmount so a teardown mid-reveal
  // does not leak a setTimeout that fires against an unmounted component.
  useEffect(() => () => clearTimer(), [clearTimer])

  const reveal = useCallback(() => {
    if (raw.length === 0) return
    setRevealed(true)
    clearTimer()
    if (auditOnReveal) {
      postRevealAudit(variant)
    }
    if (autoHideMs > 0) {
      timerRef.current = window.setTimeout(() => {
        setRevealed(false)
        timerRef.current = null
      }, autoHideMs)
    }
  }, [auditOnReveal, autoHideMs, clearTimer, raw, variant])

  const hide = useCallback(() => {
    setRevealed(false)
    clearTimer()
  }, [clearTimer])

  const toggleLabel = revealed
    ? t('mask.hide', 'Hide value')
    : t('mask.reveal', 'Reveal value')

  // Empty values render an em-dash (matching the rest of the UI's
  // missing-data convention) without a toggle — there is nothing to
  // reveal and rendering the toggle would be misleading.
  if (raw.length === 0) {
    return (
      <span
        className={cn('inline-flex items-center gap-1', className)}
        aria-label={ariaLabel}
      >
        <span className="text-[var(--text-muted)]">—</span>
      </span>
    )
  }

  return (
    <span
      className={cn('inline-flex items-center gap-1.5 align-middle', className)}
      aria-label={ariaLabel}
      data-testid="masked-value"
    >
      <code
        id={`masked-value-${reactId}`}
        className={cn(
          'font-mono text-sm break-all',
          revealed ? 'text-cyan-300' : 'text-[var(--text-secondary)]',
        )}
        data-revealed={revealed ? 'true' : 'false'}
      >
        {revealed ? raw : masked}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={revealed ? hide : reveal}
        aria-label={toggleLabel}
        aria-pressed={revealed}
        title={toggleLabel}
        className="!h-7 !min-h-0 !px-1.5"
      >
        {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </Button>
      {copyable ? (
        <CopyButton
          text={raw}
          iconOnly
          ariaLabel={t('mask.copy', 'Copy value')}
          className="!h-7 !min-h-0 !px-1.5"
        />
      ) : null}
    </span>
  )
}

/**
 * Test-only: re-export the post helper so tests can mock the network
 * layer without going through the React component's internals.
 */
export const __postRevealAuditForTests = postRevealAudit
