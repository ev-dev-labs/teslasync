import { lazy, Suspense, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/runtime'

const ThemePicker = lazy(async () => {
  const module = await import('@/components/ui/ThemePicker')
  return { default: module.ThemePicker }
})

interface ThemeQuickSwitcherPopoverProps {
  coords: { top: number; left?: number; right?: number }
  popoverRef: RefObject<HTMLDivElement>
  onClose: () => void
  onCustomize: () => void
}

export function ThemeQuickSwitcherPopover({
  coords,
  popoverRef,
  onClose,
  onCustomize,
}: ThemeQuickSwitcherPopoverProps) {
  const { t } = useTranslation()

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={t('theme.openPicker', 'Open theme picker')}
      style={{
        position: 'fixed',
        top: coords.top,
        ...(coords.left !== undefined ? { left: coords.left } : {}),
        ...(coords.right !== undefined ? { right: coords.right } : {}),
      }}
      className="z-[80] w-[22rem] max-w-[calc(100vw-1rem)] rounded-panel border border-[var(--border-default)] bg-[var(--surface-1)] p-4 shadow-e3"
    >
      <Suspense
        fallback={
          <div
            role="status"
            aria-label={t('theme.loadingPicker', 'Loading theme picker…')}
            className="min-h-64 animate-pulse rounded-shape-md bg-[var(--surface-2)] motion-reduce:animate-none"
          />
        }
      >
        <ThemePicker compact showMode showCustom={false} onChange={onClose} onModeChange={onClose} />
      </Suspense>
      <div className="mt-3 flex justify-end border-t border-[var(--border-subtle)] pt-3">
        <Button
          type="button"
          variant="ghost"
          onClick={onCustomize}
          className="h-auto px-2 py-1 text-xs font-medium text-[var(--theme-primary)] hover:bg-transparent hover:brightness-110"
        >
          {t('theme.customize', 'Customize…')}
        </Button>
      </div>
    </div>,
    document.body,
  )
}
