import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle, Copy } from 'lucide-react'
import { Button, type ButtonProps } from './Button'
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
 *
 * Accessibility: when `iconOnly` is set, an `aria-label` is provided that
 * mirrors the visible state. `aria-live="polite"` lets screen readers announce
 * the Copy → Copied transition without interrupting the user.
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
  className,
}: CopyButtonProps) {
  const { t } = useTranslation()
  // Pull the toast helper without throwing — degrades gracefully when
  // rendered outside a `<ToastProvider>` (e.g. isolated component tests).
  const toast = useOptionalToast()
  const [copied, setCopied] = useState(false)

  const copyLabel = t('common.copyButton.copy', 'Copy')
  const copiedLabel = t('common.copyButton.copied', 'Copied')

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      onCopy?.()
      if (withToast) {
        toast?.success(t('common.copyButton.successToast', 'Copied to clipboard'))
      }
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      if (withToast) {
        toast?.error(t('common.copyButton.errorToast', 'Failed to copy'))
      }
      console.error('CopyButton: clipboard write failed', err)
    }
  }, [text, withToast, onCopy, toast, t])

  const visibleLabel = iconOnly ? null : (label ?? (copied ? copiedLabel : copyLabel))
  const icon = copied
    ? <CheckCircle className="h-3.5 w-3.5" />
    : <Copy className="h-3.5 w-3.5" />

  // Resolve the assistive label. When the visible text already conveys the
  // action, we skip aria-label so screen readers don't double-announce.
  const resolvedAriaLabel = ariaLabel
    ?? (iconOnly ? (copied ? copiedLabel : (label ?? copyLabel)) : undefined)

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleCopy}
      icon={icon}
      disabled={disabled}
      title={title}
      aria-label={resolvedAriaLabel}
      aria-live="polite"
      className={className}
    >
      {visibleLabel}
    </Button>
  )
}
