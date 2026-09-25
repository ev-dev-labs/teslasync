import type { KeyboardEvent, PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { clampSidebarWidth, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH } from './sidebarWidth'

interface SidebarResizeHandleProps {
  width: number
  onResize: (width: number) => void
}

export function SidebarResizeHandle({ width, onResize }: SidebarResizeHandleProps) {
  const { t } = useTranslation()

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const direction = getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1
    onResize(clampSidebarWidth(direction === 1 ? event.clientX : window.innerWidth - event.clientX))
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1
    let next: number
    switch (event.key) {
      case 'ArrowLeft':
        next = width - 16 * direction
        break
      case 'ArrowRight':
        next = width + 16 * direction
        break
      case 'Home':
        next = MIN_SIDEBAR_WIDTH
        break
      case 'End':
        next = MAX_SIDEBAR_WIDTH
        break
      default:
        return
    }
    event.preventDefault()
    onResize(clampSidebarWidth(next))
  }

  return (
    // A focusable ARIA separator is the standard keyboard-operable splitter.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('nav.resizeSidebar', 'Resize sidebar')}
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      aria-valuenow={width}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onKeyDown={handleKeyDown}
      className="group/resize absolute inset-y-0 end-0 z-20 hidden w-2 translate-x-1/2 cursor-col-resize touch-none outline-none xl:block"
    >
      <span aria-hidden className="absolute inset-y-0 start-1/2 w-0.5 -translate-x-1/2 bg-transparent transition-colors group-hover/resize:bg-[var(--theme-primary)] group-focus-visible/resize:bg-[var(--theme-primary)]" />
    </div>
  )
}
