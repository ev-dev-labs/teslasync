import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/runtime'
import { Icons } from '@/lib/icons'

const ThemeQuickSwitcherPopover = lazy(async () => {
  const module = await import('./ThemeQuickSwitcherPopover')
  return { default: module.ThemeQuickSwitcherPopover }
})

export function ThemeQuickSwitcher() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ top: number; bottom?: number; right: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (containerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      if (document.activeElement?.closest('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const owner = e.target instanceof Element
        ? e.target.closest('[role="dialog"], [role="alertdialog"]')
        : null
      if (owner && owner !== popoverRef.current) return
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // The command palette and the first-run banner can open the same picker.
  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener('open-theme-popover', handler)
    return () => window.removeEventListener('open-theme-popover', handler)
  }, [])

  useEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      setCoords({
        top: rect.bottom + 8,
        bottom: rect.top > window.innerHeight / 2 ? window.innerHeight - rect.top + 8 : undefined,
        right: window.innerWidth - rect.right,
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative inline-block" data-role="theme-popover">
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('theme.openPicker', 'Open theme picker')}
        onClick={() => setOpen(v => !v)}
        className="h-11 w-11 rounded-shape-md p-0 text-[var(--text-secondary)] hover:bg-[var(--control-bg)] hover:text-[var(--text-primary)] md:h-9 md:w-9"
      >
        <Icons.palette className="h-5 w-5" aria-hidden="true" />
      </Button>
      {open && coords && (
        <Suspense fallback={null}>
          <ThemeQuickSwitcherPopover
            coords={coords}
            popoverRef={popoverRef}
            triggerRef={triggerRef}
            onClose={() => setOpen(false)}
            onCustomize={() => {
              setOpen(false)
              navigate('/settings#appearance')
            }}
          />
        </Suspense>
      )}
    </div>
  )
}
