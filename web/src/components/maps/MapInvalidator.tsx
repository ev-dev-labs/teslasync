import { useEffect } from 'react'
import { point, type Popup, type PopupEvent } from 'leaflet'
import { useMap } from 'react-leaflet'

export function MapInvalidator() {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()
    const popups = new Map<Element, { popup: Popup; maxWidth: number }>()
    let popupObserver: ResizeObserver | undefined
    let popupFrame: number | undefined
    const refreshPopup = ({ popup, maxWidth }: { popup: Popup; maxWidth: number }) => {
      const element = popup.getElement()
      const content = element?.querySelector<HTMLElement>('.leaflet-popup-content')
      if (container && element && content && container.clientWidth > 0) {
        const padding = point(popup.options.autoPanPadding ?? [5, 5])
        const left = point(popup.options.autoPanPaddingTopLeft ?? padding).x
        const right = point(popup.options.autoPanPaddingBottomRight ?? padding).x
        const chrome = element.offsetWidth - content.offsetWidth
        // Leaflet adds one pixel after clamping the content width.
        popup.options.maxWidth = Math.max(popup.options.minWidth ?? 50,
          Math.min(maxWidth, container.clientWidth - chrome - left - right - 1))
      }
      popup.update()
    }
    const observePopup = ({ popup }: PopupEvent) => {
      const element = popup.getElement()
      if (!element || typeof ResizeObserver === 'undefined') return
      popupObserver ??= new ResizeObserver(() => {
        if (popupFrame !== undefined || popups.size === 0) return
        // Updating an observed popup during delivery creates a resize loop in WebKit.
        popupFrame = requestAnimationFrame(() => {
          popupFrame = undefined
          for (const observed of popups.values()) refreshPopup(observed)
        })
      })
      if (!popups.has(element)) popups.set(element, { popup, maxWidth: popup.options.maxWidth ?? 300 })
      popupObserver.observe(element)
    }
    const releasePopup = ({ popup }: PopupEvent) => {
      const element = popup.getElement()
      if (!element) return
      popupObserver?.unobserve(element)
      const observed = popups.get(element)
      if (observed) popup.options.maxWidth = observed.maxWidth
      popups.delete(element)
    }
    if (container) {
      map.on('popupopen', observePopup)
      map.on('popupclose', releasePopup)
    }
    const invalidate = () => {
      map.invalidateSize({ animate: false })
      for (const observed of popups.values()) refreshPopup(observed)
    }
    const timer = setTimeout(invalidate, 100)
    const observer = container && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(invalidate)
      : undefined
    if (container && observer) observer.observe(container)
    return () => {
      clearTimeout(timer)
      observer?.disconnect()
      popupObserver?.disconnect()
      if (popupFrame !== undefined) cancelAnimationFrame(popupFrame)
      for (const { popup, maxWidth } of popups.values()) popup.options.maxWidth = maxWidth
      popups.clear()
      if (container) {
        map.off('popupopen', observePopup)
        map.off('popupclose', releasePopup)
      }
    }
  }, [map])
  return null
}
