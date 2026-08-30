const PRINT_STYLESHEET_PATH = '/print.css'

/** Returns the same-origin stylesheet URL used by about:blank print windows. */
export function printStylesheetURL(): string {
  return new URL(PRINT_STYLESHEET_PATH, window.location.origin).toString()
}

/**
 * Defers browser printing until the print window has loaded its same-origin
 * stylesheet. Test doubles and older popup implementations print immediately.
 */
export function printWhenReady(printWindow: Window): void {
  if (typeof printWindow.addEventListener !== 'function') {
    printWindow.print()
    return
  }

  let printed = false
  const print = () => {
    if (printed) return
    printed = true
    printWindow.print()
  }
  printWindow.addEventListener('load', print, { once: true })
  window.setTimeout(print, 1_500)
}
