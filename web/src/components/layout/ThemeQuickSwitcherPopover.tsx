import { lazy, Suspense, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/runtime'
import { cn } from '@/lib/cn'
import { typography } from '@/lib/tokens'
import { isFocusRestorable } from '@/hooks/useDialogFocus'
import { getShellFocusableElements } from './shellFocusTrap'

const ThemePicker = lazy(async () => {
  const module = await import('@/components/ui/ThemePicker')
  return { default: module.ThemePicker }
})

interface ThemeQuickSwitcherPopoverProps {
  coords: { top: number; bottom?: number; left?: number; right?: number }
  popoverRef: RefObject<HTMLDivElement>
  triggerRef: RefObject<HTMLButtonElement>
  onClose: () => void
  onCustomize: () => void
}

function ThemePickerContent({ onClose }: { onClose: () => void }) {
  const contentRef = useRef<HTMLDivElement>(null)

  // Suspense commits this effect only after the lazy picker's controls exist.
  useEffect(() => {
    const content = contentRef.current
    const dialog = content?.closest('[role="dialog"]')
    if (document.activeElement === dialog) {
      getShellFocusableElements(content)[0]?.focus()
    }
  }, [])

  return (
    <div ref={contentRef}>
      <ThemePicker compact showMode showCustom={false} onChange={onClose} onModeChange={onClose} />
    </div>
  )
}

export function ThemeQuickSwitcherPopover({
  coords,
  popoverRef,
  triggerRef,
  onClose,
  onCustomize,
}: ThemeQuickSwitcherPopoverProps) {
  const { t } = useTranslation()
  const restoreFocusRef = useRef(true)

  useLayoutEffect(() => {
    const dialog = popoverRef.current
    if (!dialog) return
    restoreFocusRef.current = true
    if (!document.activeElement?.closest('[aria-modal="true"]')) dialog.focus()

    return () => {
      const active = document.activeElement
      const ownsFocus = !active || active === document.body || dialog.contains(active)
      const anotherModal = document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')
      const trigger = triggerRef.current
      if (
        restoreFocusRef.current && ownsFocus && !anotherModal &&
        isFocusRestorable(trigger) &&
        getShellFocusableElements(trigger.parentElement).includes(trigger)
      ) {
        trigger.focus()
      }
    }
  }, [popoverRef, triggerRef])

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      tabIndex={-1}
      aria-label={t('theme.openPicker', 'Open theme picker')}
      style={{
        ...(coords.bottom === undefined ? { top: coords.top } : { bottom: coords.bottom }),
        maxHeight: `max(0px, calc(100dvh - ${coords.bottom ?? coords.top}px - 0.5rem - env(safe-area-inset-bottom, 0px)))`,
        ...(coords.left !== undefined ? { left: coords.left } : {}),
        ...(coords.right !== undefined ? { right: coords.right } : {}),
      }}
      className="fixed z-shell-panel w-theme-switcher max-w-shell-panel-viewport overflow-y-auto rounded-panel border border-[var(--border-default)] bg-[var(--surface-1)] p-4 shadow-e3"
    >
      <Suspense
        fallback={
          <div
            role="status"
            aria-label={t('theme.loadingPicker', 'Loading theme picker…')}
            className="min-h-64 rounded-shape-md bg-[var(--surface-2)]"
          />
        }
      >
        <ThemePickerContent onClose={onClose} />
      </Suspense>
      <div className="mt-3 flex justify-end border-t border-[var(--border-subtle)] pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          wrapLabel
          onClick={() => {
            restoreFocusRef.current = false
            onCustomize()
          }}
          className={cn(
            typography.role.label,
            typography.color.secondary,
            'min-h-11 min-w-11 px-3 py-2 md:min-h-9',
          )}
        >
          {t('theme.customize', 'Customize…')}
        </Button>
      </div>
    </div>,
    document.body,
  )
}
