import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Printer } from 'lucide-react'
import { Button, type ButtonProps } from './Button'

/**
 * PrintButton — opens the browser print dialog (`window.print()`) for the
 * current page.
 *
 * Pairs with the `@media print` block in `index.css` (Phase-40 / Prompt 54).
 * Pages render this in their `PageContainer` `actions` slot. The button
 * itself carries `data-print-hide` so it doesn't show on the printed page —
 * the print stylesheet hides it regardless of how the print dialog was
 * opened (button click vs. native Ctrl+P).
 *
 * Use `beforePrint` to flush UI state before printing — e.g. expand all
 * collapsed panels or switch to the tab the user actually wants on paper.
 * The callback is awaited and React is given one animation frame to flush
 * the resulting state changes before the print dialog opens.
 */
export interface PrintButtonProps {
  /** Override the default "Print" label. */
  label?: string
  /** Show only the printer icon (no text). */
  iconOnly?: boolean
  /**
   * Optional setup hook. Run before opening the print dialog (e.g. expand
   * collapsed sections). Sync or async — the dialog opens after the next
   * animation frame so state updates have a chance to commit.
   */
  beforePrint?: () => void | Promise<void>
  /** Variant override; defaults to 'ghost'. */
  variant?: ButtonProps['variant']
  /** Size override; defaults to 'sm'. */
  size?: ButtonProps['size']
  /** Optional aria-label override (auto-derived from label in iconOnly mode). */
  ariaLabel?: string
  /** Disable the trigger (e.g. while data is still loading). */
  disabled?: boolean
  className?: string
}

export function PrintButton({
  label,
  iconOnly = false,
  beforePrint,
  variant = 'ghost',
  size = 'sm',
  ariaLabel,
  disabled,
  className,
}: PrintButtonProps) {
  const { t } = useTranslation()
  const [printing, setPrinting] = useState(false)

  const printLabel = label ?? t('common.printButton.print', 'Print')

  const handleClick = useCallback(async () => {
    if (printing) return
    setPrinting(true)
    try {
      if (beforePrint) {
        await beforePrint()
      }
      // Give React one paint cycle to flush any pre-print state updates
      // (expanded panels, switched tabs) before the browser snapshots the
      // DOM for the print dialog.
      requestAnimationFrame(() => {
        try {
          window.print()
        } finally {
          setPrinting(false)
        }
      })
    } catch (err) {
      console.error('PrintButton: beforePrint failed', err)
      setPrinting(false)
    }
  }, [beforePrint, printing])

  const resolvedAriaLabel = ariaLabel ?? (iconOnly ? printLabel : undefined)

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleClick}
      icon={<Printer className="h-3.5 w-3.5" />}
      disabled={disabled}
      aria-label={resolvedAriaLabel}
      data-print-hide
      className={className}
    >
      {iconOnly ? null : printLabel}
    </Button>
  )
}
