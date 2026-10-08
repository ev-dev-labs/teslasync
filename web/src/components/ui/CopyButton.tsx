import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle, Copy } from 'lucide-react'
import { Button, type ButtonProps } from './Button'
import { Icon } from './Icon'
import { useOptionalToast } from '@/components/feedback/Toast'

/**
 * CopyButton — one-click clipboard primitive.
 *
 * Promoted from `features/admin/components/devtools/CopyButton.tsx` to the shared
 * UI library so every page can use the same affordance instead of rolling its
 * own `navigator.clipboard.writeText` block.
 *
 * Defaults match the original component (ghost/sm, label toggles between
 * `Copy` / `Copied`) so existing callers don't need any changes beyond the
 * import path. New props are strictly opt-in:
 *   - `iconOnly`: drop the label for dense lists (rows, table cells).
 *   - `withToast`: also fire a toast on success/failure for prominent actions.
 *   - `label`: override the default Copy/Copied text (e.g. "Copy link").
 *   - `onCopyError`: expose clipboard failures for caller-owned manual-copy UI.
 *
 * Accessibility: when `iconOnly` is set, an `aria-label` is provided that
 * mirrors the visible state. Polite feedback announces successful copies even
 * when a custom label keeps the button's accessible name unchanged.
 */
export interface CopyButtonProps {
  /** The string to copy to clipboard. */
  text: string
  /** Override the default 'Copy' / 'Copied' button label. */
  label?: string
  /** Show only the icon (no text). Defaults to false. */
  iconOnly?: boolean
  /** Override variant; defaults to 'ghost'. */
  variant?: ButtonProps['variant']
  /** Override size; defaults to 'sm'. */
  size?: ButtonProps['size']
  /** When true, also fires a toast on success/failure. Defaults to false. */
  withToast?: boolean
  /** Optional aria-label override (auto-generated when iconOnly). */
  ariaLabel?: string
  /** Disable the button (e.g. when the text isn't ready). */
  disabled?: boolean
  /** Optional native title tooltip. */
  title?: string
  /** Called after a successful copy. */
  onCopy?: () => void
  /** Receives the original clipboard failure for caller-owned manual-copy UI. */
  onCopyError?: (error: unknown) => void
  className?: string
}

export function CopyButton({
  text,
  label,
  iconOnly = false,
  variant = 'ghost',
  size = 'sm',
  withToast = false,
  ariaLabel,
  disabled,
  title,
  onCopy,
  onCopyError,
  className,
}: CopyButtonProps) {
  const { t } = useTranslation()
  // Pull the toast helper without throwing — degrades gracefully when
  // rendered outside a `<ToastProvider>` (e.g. isolated component tests).
  const toast = useOptionalToast()
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyAttempt = useRef(0)

  const clearCopyTimer = useCallback(() => {
    if (copyTimer.current !== null) {
      clearTimeout(copyTimer.current)
      copyTimer.current = null
    }
  }, [])

  useEffect(() => {
    setCopied(false)
    return () => {
      // Invalidate pending writes as well as feedback for the previous text.
      copyAttempt.current += 1
      clearCopyTimer()
    }
  }, [text, clearCopyTimer])

  const copyLabel = t('common.copyButton.copy', 'Copy')
  const copiedLabel = t('common.copyButton.copied', 'Copied')

  const handleCopy = useCallback(async () => {
    const attempt = ++copyAttempt.current
    clearCopyTimer()
    try {
      await navigator.clipboard.writeText(text)
    } catch (err) {
      console.error('CopyButton: clipboard write failed', err)
      if (attempt !== copyAttempt.current) return
      setCopied(false)
      if (withToast) {
        toast?.error(t('common.copyButton.errorToast', 'Failed to copy'))
      }
      onCopyError?.(err)
      return
    }
    if (attempt !== copyAttempt.current) return
    setCopied(true)
    copyTimer.current = setTimeout(() => {
      copyTimer.current = null
      setCopied(false)
    }, 2000)
    onCopy?.()
    if (withToast) {
      toast?.success(t('common.copyButton.successToast', 'Copied to clipboard'))
    }
  }, [text, withToast, onCopy, onCopyError, toast, t, clearCopyTimer])

  const visibleLabel = iconOnly ? null : (label ?? (copied ? copiedLabel : copyLabel))
  const icon = <Icon icon={copied ? CheckCircle : Copy} size="sm" />

  // Resolve the assistive label. When the visible text already conveys the
  // action, we skip aria-label so screen readers don't double-announce.
  const resolvedAriaLabel = ariaLabel
    ?? (iconOnly ? (copied ? copiedLabel : (label ?? copyLabel)) : undefined)
  const hasFixedName = ariaLabel != null || (!iconOnly && label != null)

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        wrapLabel={!iconOnly}
        onClick={handleCopy}
        icon={icon}
        disabled={disabled}
        title={title}
        aria-label={resolvedAriaLabel}
        aria-live={hasFixedName ? undefined : 'polite'}
        className={className}
      >
        {visibleLabel}
      </Button>
      {hasFixedName && (
        <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {copied ? copiedLabel : ''}
        </span>
      )}
    </>
  )
}
