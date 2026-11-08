import { lazy, Suspense, useEffect, useState, type RefObject } from 'react'
import { loadCommandPalette } from '@/components/ui/CommandPaletteTrigger'

const LazyCommandPalette = lazy(async () => {
  const module = await loadCommandPalette()
  return { default: module.CommandPalette }
})

export interface CommandPaletteHostProps {
  onOpen?: () => void
  returnFocusFallbackRef?: RefObject<HTMLElement | null>
  onPin?: (path: string) => void
  onUnpin?: (path: string) => void
}

/**
 * Defers the command center and its entity-search dependencies until the
 * first invocation. The first event becomes `initialOpen`; subsequent events
 * are handled by the mounted palette itself.
 */
export function CommandPaletteHost({ onOpen, returnFocusFallbackRef, onPin, onUnpin }: CommandPaletteHostProps) {
  const [activated, setActivated] = useState(false)

  useEffect(() => {
    if (activated) return
    const activate = () => setActivated(true)
    window.addEventListener('toggle-command-palette', activate)
    return () => window.removeEventListener('toggle-command-palette', activate)
  }, [activated])

  if (!activated) return null

  return (
    <Suspense fallback={null}>
      <LazyCommandPalette initialOpen onOpen={onOpen} returnFocusFallbackRef={returnFocusFallbackRef} onPin={onPin} onUnpin={onUnpin} />
    </Suspense>
  )
}
